import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { validateProposal, applyPatch } from './pipeline_v5.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFile = path.join(__dirname, 'src/components/Task17Benchmark.tsx');

const PROMPT_TEMPLATE = `You are an autonomous accessibility remediation agent.
Analyze the supplied Axe-core violation and propose a safe, semantically correct source-level remediation.

SUPPORTED CAPABILITIES:
1. MODIFY_ATTRIBUTE
2. MULTI_NODE_REMEDIATION (Array of ADD/UPDATE/REMOVE attributes on multiple targets)
3. STRUCTURAL_REMEDIATION (Only REPLACE_TAG div -> button is supported)

If a safe, supported remediation cannot be determined, output action="ABORT" and state the reason.

Output ONLY a JSON object conforming to this schema (do NOT use markdown blocks, just raw JSON):
{
  "action": "MODIFY_ATTRIBUTE" | "MULTI_NODE_REMEDIATION" | "STRUCTURAL_REMEDIATION" | "ABORT",
  "reason": "explanation",
  "target": { "element": "tag", "file": "src/...", "line": 0, "column": 0 },
  "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
  "attribute": "attr_name",
  "value": "attr_value",
  "replacement": { "element": "button" },
  "operations": [
    { "target": {...}, "operation": "ADD", "attribute": "attr", "value": "val" }
  ]
}

Target details:
Violation Rule: {RULE}
Target Element: {ELEMENT}
File: {FILE}
Line: {LINE}
Column: {COLUMN}

Context snippet:
{CONTEXT}`;

const cases = [
  { id: "case1", rule: "image-alt", element: "img", lineMatcher: "<img id=\"c1-img\"", gtMulti: false },
  { id: "case2", rule: "input-image-alt", element: "input", lineMatcher: "<input type=\"image\" id=\"c2-img\"", gtMulti: false },
  { id: "case3", rule: "button-name", element: "button", lineMatcher: "<button id=\"c3-btn\"", gtMulti: false },
  { id: "case4", rule: "label", element: "input", lineMatcher: "<input id=\"c4-input\"", gtMulti: false },
  { id: "case5", rule: "label", element: "input", lineMatcher: "<input id=\"c5-input\"", gtMulti: false },
  { id: "case6", rule: "label", element: "input", lineMatcher: "<input id=\"c6-input\"", gtMulti: true },
  { id: "case7", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c10-div\"", gtMulti: false },
  { id: "case8", rule: "aria-valid-attr", element: "div", lineMatcher: "<div id=\"c12-div\"", gtMulti: false },
  { id: "case9", rule: "empty-heading", element: "h1", lineMatcher: "<h1 id=\"c13-h1\"", gtMulti: false },
  { id: "case10", rule: "link-name", element: "a", lineMatcher: "<a id=\"c11-a\"", gtMulti: false },
  { id: "case11", rule: "nested-interactive", element: "button", lineMatcher: "<button id=\"c9-btn\"", gtAbort: true },
  { id: "case12", rule: "select-name", element: "select", lineMatcher: "<select id=\"c15-select\"", gtMulti: false },
  { id: "case13", rule: "tabindex", element: "div", lineMatcher: "<div id=\"c8-div\"", gtMulti: false },
  { id: "case14", rule: "tabindex", element: "a", lineMatcher: "<a id=\"c14-a\"", gtMulti: false }
];

async function run() {
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();
    
    let results = [];
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    for (const c of cases) {
        console.log(`\n============================`);
        console.log(`Starting ${c.id}`);
        
        fs.writeFileSync(targetFile, originalContent); // Reset file
        
        await page.goto('http://localhost:5173');
        await page.waitForTimeout(500);
        
        const baselineAxe = await new AxeBuilder({ page }).analyze();
        const hasViolation = baselineAxe.violations.some(v => v.id === c.rule);
        
        if (!hasViolation) {
            console.log(`❌ INVALID_EXPERIMENT: Baseline Axe missing for ${c.rule}`);
            results.push({ case: c.id, status: 'INVALID_EXPERIMENT' });
            continue;
        }

        const lines = originalContent.split('\n');
        const lineIdx = lines.findIndex(l => l.includes(c.lineMatcher));
        c.line = lineIdx + 1;
        c.column = lines[lineIdx].indexOf('<' + c.element);
        
        let startLine = Math.max(0, lineIdx - 4);
        let endLine = Math.min(lines.length - 1, lineIdx + 4);
        let contextSnippet = lines.slice(startLine, endLine + 1).map((l, i) => `${startLine + i + 1}: ${l}`).join('\n');

        let messages = [{
            role: "user",
            content: PROMPT_TEMPLATE.replace('{RULE}', c.rule)
                                    .replace('{ELEMENT}', c.element)
                                    .replace('{FILE}', 'src/components/Task17Benchmark.tsx')
                                    .replace('{LINE}', c.line)
                                    .replace('{COLUMN}', c.column)
                                    .replace('{CONTEXT}', contextSnippet)
        }];

        let attempts = 0;
        let finalStatus = "SAFE_ABORT";
        let validationResult = null;
        let pResult = null;
        
        while (attempts < 3) {
            attempts++;
            console.log(` Attempt ${attempts}...`);
            
            let responseText = "";
            try {
                const response = await fetch('http://localhost:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen2.5-coder:7b',
                        messages: messages,
                        format: 'json',
                        stream: false,
                        options: { temperature: 0.1 }
                    })
                });
                const data = await response.json();
                responseText = data.message.content;
            } catch (err) {
                console.error("API Error");
                break;
            }

            let parsed;
            try {
                let cleanJson = responseText;
                if (cleanJson.includes('```json')) {
                    cleanJson = cleanJson.split('```json')[1].split('```')[0];
                }
                parsed = JSON.parse(cleanJson);
                validationResult = validateProposal(parsed, targetFile);
            } catch (e) {
                validationResult = { valid: false, reason: "JSON_PARSE_FAILURE", message: "Invalid JSON" };
            }

            if (validationResult.isAbort) {
                console.log(`  Model aborted.`);
                finalStatus = "SAFE_ABORT";
                break;
            }

            if (validationResult.valid) {
                console.log(`  ✅ ACCEPTED`);
                pResult = applyPatch(parsed, targetFile, validationResult);
                if (!pResult.success) {
                    finalStatus = "PATCH_FAILURE";
                    break;
                }
                
                try {
                    execSync('npx tsc --noEmit', { stdio: 'ignore' });
                } catch (e) {
                    finalStatus = "BUILD_FAILURE";
                    break;
                }
                
                await page.reload();
                await page.waitForTimeout(500);
                const postAxe = await new AxeBuilder({ page }).analyze();
                const ruleResolved = !postAxe.violations.some(v => v.id === c.rule);
                const noNewViolations = postAxe.violations.length <= baselineAxe.violations.length; // rough check
                
                if (!ruleResolved) {
                    finalStatus = "AXE_UNRESOLVED";
                } else if (!noNewViolations) {
                    finalStatus = "NEW_AXE_VIOLATION";
                } else {
                    finalStatus = "SUCCESS";
                }
                break;
            } else {
                console.log(`  ❌ REJECTED: ${validationResult.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.message}\nRevise your proposal.` });
                finalStatus = validationResult.reason;
            }
        }
        
        console.log(`Final Status: ${finalStatus}`);
        results.push({ case: c.id, status: finalStatus, attempts });
    }
    
    fs.writeFileSync(targetFile, originalContent);
    await browser.close();
    
    console.log("\nResults:", results);
    fs.writeFileSync('task17_results.json', JSON.stringify(results, null, 2));
}

run().catch(console.error);

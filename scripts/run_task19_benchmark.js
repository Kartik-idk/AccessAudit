import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { parseMultiObjectResponse, validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFile = path.join(__dirname, 'src/components/Task18Benchmark.tsx');

const PROMPT_TEMPLATE = `You are an automated accessibility remediation agent.
You must remediate the accessibility violation identified by Axe-core.

You MUST reply with ONLY flat JSON objects. Do NOT output any conversational text.
If the remediation requires multiple target elements, you MUST output multiple independent flat JSON objects, one after the other.
Do NOT use nested arrays or nested replacement objects.

Schema for each object:
{
  "action": "MODIFY_ATTRIBUTE" | "STRUCTURAL_REMEDIATION" | "MULTI_NODE_REMEDIATION" | "ABORT",
  "reason": "explanation of remediation intent",
  "target_element": "tag",
  "file": "path/to/file",
  "line": 0,
  "column": 0,
  "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
  "attribute": "attr_name (if applicable)",
  "value": "attr_value (if applicable)",
  "replacement_tag": "button (only for REPLACE_TAG)"
}

Example single output:
{"action":"MODIFY_ATTRIBUTE","target_element":"span","file":"src/App.tsx","line":10,"column":5,"operation":"ADD","attribute":"id","value":"search-label","reason":"Fix missing id"}

Example multi-node output:
{"action":"MULTI_NODE_REMEDIATION","target_element":"span","file":"src/App.tsx","line":10,"column":5,"operation":"ADD","attribute":"id","value":"search-label","reason":"add id"}
{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/App.tsx","line":11,"column":5,"operation":"ADD","attribute":"aria-labelledby","value":"search-label","reason":"link to span"}

You must provide exactly one generation per attempt.

Target details:
Violation Rule: {RULE}
Target Element: {ELEMENT}
File: {FILE}
Line: {LINE}
Column: {COLUMN}

Context snippet:
{CONTEXT}`;

const cases = [
  // MODIFY_ATTRIBUTE
  { id: "case1", cat: "MODIFY_ATTRIBUTE", expectedOutcome: "REMEDIATION", rule: "image-alt", element: "img", lineMatcher: "<img id=\"c1-img\"" },
  { id: "case2", cat: "MODIFY_ATTRIBUTE", expectedOutcome: "REMEDIATION", rule: "button-name", element: "button", lineMatcher: "<button id=\"c2-btn\"" },
  { id: "case3", cat: "MODIFY_ATTRIBUTE", expectedOutcome: "REMEDIATION", rule: "aria-hidden-focus", element: "input", lineMatcher: "<input id=\"c3-input\"" },
  { id: "case4", cat: "MODIFY_ATTRIBUTE", expectedOutcome: "REMEDIATION", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c4-div\"" },
  { id: "case5", cat: "MODIFY_ATTRIBUTE", expectedOutcome: "SAFE_ABORT", rule: "empty-heading", element: "h1", lineMatcher: "<h1 id=\"c5-h1\"" },
  
  // MULTI_NODE_REMEDIATION
  { id: "case6", cat: "MULTI_NODE_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "label", element: "input", lineMatcher: "<input id=\"c6-input\"" },
  { id: "case7", cat: "MULTI_NODE_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "label", element: "input", lineMatcher: "<input id=\"c7-input\"" },
  { id: "case8", cat: "MULTI_NODE_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "label", element: "input", lineMatcher: "<input id=\"c8-input\"" },
  { id: "case9", cat: "MULTI_NODE_REMEDIATION", expectedOutcome: "SAFE_ABORT", rule: "label", element: "input", lineMatcher: "<input id=\"c9-input\"" },
  { id: "case10", cat: "MULTI_NODE_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "tabindex", element: "a", lineMatcher: "<a id=\"c10-a1\"" },
  
  // STRUCTURAL_REMEDIATION
  { id: "case11", cat: "STRUCTURAL_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "tabindex", element: "div", lineMatcher: "<div id=\"c11-div\"" },
  { id: "case12", cat: "STRUCTURAL_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c12-div\"" },
  { id: "case13", cat: "STRUCTURAL_REMEDIATION", expectedOutcome: "SAFE_ABORT", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c13-div\"" },
  { id: "case14", cat: "STRUCTURAL_REMEDIATION", expectedOutcome: "SAFE_ABORT", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c14-div\"" },
  { id: "case15", cat: "STRUCTURAL_REMEDIATION", expectedOutcome: "REMEDIATION", rule: "aria-roles", element: "div", lineMatcher: "<div id=\"c15-div\"" },
];

function checkSemanticGroundTruth(c, parsedObjs) {
    if (parsedObjs.length === 1 && parsedObjs[0].action === "ABORT") {
        if (c.expectedOutcome !== "SAFE_ABORT") {
            return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Model aborted, but case requires remediation." };
        }
        return { valid: true };
    }
    if (c.expectedOutcome === "SAFE_ABORT") {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Case requires SAFE_ABORT due to missing context." };
    }
    
    for (const p of parsedObjs) {
        if (p.value === "" && p.operation === "ADD") return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Empty strings are not valid remediations" };
        if (c.cat === "STRUCTURAL_REMEDIATION" && p.action !== "STRUCTURAL_REMEDIATION") {
            return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Case required structural remediation." };
        }
        if (c.cat === "MULTI_NODE_REMEDIATION" && p.action !== "MULTI_NODE_REMEDIATION") {
            return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Case required multi-node remediation." };
        }
    }
    return { valid: true };
}

async function run() {
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();
    
    let results = [];
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    for (const c of cases) {
        console.log(`\n============================`);
        console.log(`Starting ${c.id}`);
        
        fs.writeFileSync(targetFile, originalContent);
        
        await page.goto('http://localhost:5173');
        await page.waitForTimeout(500);
        
        const baselineAxe = await new AxeBuilder({ page }).analyze();
        const baseViolations = new Set();
        baselineAxe.violations.forEach(v => {
            v.nodes.forEach(n => {
                const targetMatch = n.html.match(/id="([^"]+)"/);
                if (targetMatch) {
                    baseViolations.add(`${v.id}::${targetMatch[1]}`);
                }
            });
        });
        
        const targetId = c.lineMatcher.match(/id="([^"]+)"/)[1];
        const targetVioStr = `${c.rule}::${targetId}`;
        
        if (!baseViolations.has(targetVioStr)) {
            console.log(`❌ INVALID_EXPERIMENT: Baseline Axe missing for ${targetVioStr}`);
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
                                    .replace('{FILE}', 'src/components/Task18Benchmark.tsx')
                                    .replace('{LINE}', c.line)
                                    .replace('{COLUMN}', c.column)
                                    .replace('{CONTEXT}', contextSnippet)
        }];

        let attempts = 0;
        let finalStatus = "UNRESOLVED";
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

            let parseRes = parseMultiObjectResponse(responseText);
            if (!parseRes.valid) {
                console.log(`  ❌ REJECTED: ${parseRes.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${parseRes.reason} - ${parseRes.message}\nRevise your proposal.` });
                finalStatus = parseRes.reason;
                continue;
            }

            validationResult = validateProposalBundle(parseRes.objects, targetFile);

            if (validationResult.isAbort) {
                console.log(`  Model aborted.`);
                if (c.expectedOutcome === 'SAFE_ABORT') {
                    finalStatus = "SUCCESS_SAFE_ABORT";
                } else {
                    finalStatus = "SAFE_ABORT"; // Failed, expected remediation
                }
                break;
            }

            if (validationResult.valid) {
                const gt = checkSemanticGroundTruth(c, parseRes.objects);
                if (!gt.valid) {
                    console.log(`  ✅ ACCEPTED BY GATEKEEPER`);
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: ${gt.reason}`);
                    messages.push({ role: "assistant", content: responseText });
                    messages.push({ role: "user", content: `Your proposal was rejected: ${gt.msg}\nRevise your proposal.` });
                    finalStatus = gt.reason;
                    fs.writeFileSync(targetFile, originalContent);
                    continue;
                }

                console.log(`  ✅ ACCEPTED BY GATEKEEPER`);
                pResult = applyPatchBundle(validationResult, targetFile);
                if (!pResult.success) {
                    finalStatus = "PATCH_FAILURE";
                    break;
                }
                
                try {
                    execSync('npx tsc --noEmit', { stdio: 'ignore', cwd: __dirname });
                } catch (e) {
                    finalStatus = "BUILD_FAILURE";
                    break;
                }
                
                await page.reload();
                await page.waitForTimeout(500);
                
                const survivingLoc = await page.locator(`[id="${targetId}"]`).count();
                if (survivingLoc === 0) {
                    finalStatus = "TARGET_REMOVED";
                    break;
                }
                const isVisible = await page.locator(`[id="${targetId}"]`).isVisible();
                if (!isVisible) {
                    finalStatus = "TARGET_HIDDEN";
                    break;
                }

                const postAxe = await new AxeBuilder({ page }).analyze();
                const postViolations = new Set();
                postAxe.violations.forEach(v => {
                    v.nodes.forEach(n => {
                        const targetMatch = n.html.match(/id="([^"]+)"/);
                        if (targetMatch) {
                            postViolations.add(`${v.id}::${targetMatch[1]}`);
                        }
                    });
                });
                
                let newViolations = 0;
                postViolations.forEach(v => { if (!baseViolations.has(v)) newViolations++; });
                
                let resolvedViolations = 0;
                let targetResolved = false;
                baseViolations.forEach(v => { 
                    if (!postViolations.has(v)) {
                        resolvedViolations++;
                        if (v === targetVioStr) targetResolved = true;
                    }
                });
                
                if (!targetResolved) {
                    finalStatus = "AXE_UNRESOLVED";
                } else if (newViolations > 0) {
                    finalStatus = "NEW_AXE_VIOLATION";
                } else {
                    if (c.expectedOutcome === 'SAFE_ABORT') {
                        finalStatus = "UNSAFE_ACCEPTANCE";
                    } else {
                        finalStatus = "SUCCESS";
                    }
                }
                break;
            } else {
                console.log(`  ❌ REJECTED: ${validationResult.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.reason} - ${validationResult.message}\nRevise your proposal.` });
                finalStatus = validationResult.reason;
            }
        }
        
        console.log(`Final Status: ${finalStatus}`);
        results.push({ case: c.id, cat: c.cat, status: finalStatus, attempts });
    }
    
    fs.writeFileSync(targetFile, originalContent);
    await browser.close();
    
    console.log("\nResults:", results);
    fs.writeFileSync('task19_results.json', JSON.stringify(results, null, 2));
}

run().catch(console.error);

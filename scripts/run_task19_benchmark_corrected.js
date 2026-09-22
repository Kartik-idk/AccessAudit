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

Violation:
{{VIOLATION}}

Target Element:
{{TARGET_HTML}}
File: {{TARGET_FILE}}
Line: {{TARGET_LINE}}
Column: {{TARGET_COL}}

Source Context:
{{SOURCE_CONTEXT}}`;

const benchmarkCases = [
    { name: "case1", cat: "MODIFY_ATTRIBUTE", targetSelector: "#c1-img", expectedOutcome: "REMEDIATION", line: 9, col: 9 },
    { name: "case2", cat: "MODIFY_ATTRIBUTE", targetSelector: "#c2-btn", expectedOutcome: "REMEDIATION", line: 14, col: 9 },
    { name: "case3", cat: "MODIFY_ATTRIBUTE", targetSelector: "#c3-input", expectedOutcome: "REMEDIATION", line: 19, col: 9 },
    { name: "case4", cat: "MODIFY_ATTRIBUTE", targetSelector: "#c4-div", expectedOutcome: "REMEDIATION", line: 24, col: 9 },
    { name: "case5", cat: "MODIFY_ATTRIBUTE", targetSelector: "#c5-h1", expectedOutcome: "SAFE_ABORT", line: 29, col: 9 },
    
    { name: "case6", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c6-input", expectedOutcome: "REMEDIATION", line: 41, col: 6 },
    { name: "case7", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c7-input", expectedOutcome: "REMEDIATION", line: 51, col: 6 },
    { name: "case8", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c8-input", expectedOutcome: "REMEDIATION", line: 61, col: 6 },
    { name: "case9", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c9-input", expectedOutcome: "SAFE_ABORT", line: 71, col: 6 },
    { name: "case10", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c10-a1", expectedOutcome: "REMEDIATION", line: 80, col: 6 },

    { name: "case11", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c11-div", expectedOutcome: "REMEDIATION", line: 92, col: 9 },
    { name: "case12", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c12-div", expectedOutcome: "REMEDIATION", line: 97, col: 9 },
    { name: "case13", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c13-div", expectedOutcome: "SAFE_ABORT", line: 104, col: 6 },
    { name: "case14", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c14-div", expectedOutcome: "SAFE_ABORT", line: 112, col: 4 },
    { name: "case15", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c15-div", expectedOutcome: "REMEDIATION", line: 121, col: 4 }
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

async function callOllama(messages) {
    const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen2.5-coder:7b',
            messages: messages,
            stream: false,
            options: { temperature: 0.1 }
        })
    });
    const data = await response.json();
    return data.message.content;
}

const originalSource = fs.readFileSync(targetFile, 'utf8');

async function run() {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    let results = [];

    // baseline
    execSync('npx tsc', {stdio: 'ignore'});
    await page.goto('http://localhost:5173');
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    const baselineViolations = baselineAxe.violations;

    for (const c of benchmarkCases) {
        console.log(`\n============================\nStarting ${c.name}`);
        fs.writeFileSync(targetFile, originalSource);
        execSync('npx tsc', {stdio: 'ignore'});
        await page.reload();

        let baselineTargetV = null;
        for (const v of baselineViolations) {
            for (const n of v.nodes) {
                if (n.target.includes(c.targetSelector)) {
                    baselineTargetV = v;
                    break;
                }
            }
            if (baselineTargetV) break;
        }

        if (!baselineTargetV) {
            console.log(`  ❌ INVALID_EXPERIMENT: No baseline axe violation for ${c.targetSelector}`);
            continue;
        }

        const tnode = await page.locator(c.targetSelector);
        const tHTML = await tnode.evaluate(el => el.outerHTML);
        
        let tl = c.line;
        let tc = c.col;

        let prompt = PROMPT_TEMPLATE
            .replace('{{VIOLATION}}', JSON.stringify({
                id: baselineTargetV.id,
                description: baselineTargetV.description,
                help: baselineTargetV.help
            }, null, 2))
            .replace('{{TARGET_HTML}}', tHTML)
            .replace('{{TARGET_FILE}}', 'src/components/Task18Benchmark.tsx')
            .replace('{{TARGET_LINE}}', tl)
            .replace('{{TARGET_COL}}', tc)
            .replace('{{SOURCE_CONTEXT}}', originalSource.split('\n').slice(Math.max(0, tl-10), tl+10).join('\n'));

        let messages = [
            { role: "system", content: "You are an expert accessibility engineer." },
            { role: "user", content: prompt }
        ];

        let finalStatus = "FAILED";
        let attempt = 1;
        let pResult = null;

        while (attempt <= 3) {
            console.log(` Attempt ${attempt}...`);
            const responseText = await callOllama(messages);
            
            let parseRes = parseMultiObjectResponse(responseText);
            if (!parseRes.valid) {
                console.log(`  ❌ REJECTED: ${parseRes.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${parseRes.reason} - ${parseRes.message}\nRevise your proposal.` });
                finalStatus = parseRes.reason;
                attempt++;
                continue;
            }

            let validationResult = validateProposalBundle(parseRes.objects, targetFile);

            if (!validationResult.valid) {
                console.log(`  ❌ REJECTED: ${validationResult.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.reason} - ${validationResult.message}\nRevise your proposal.` });
                finalStatus = validationResult.reason;
                attempt++;
                continue;
            }

            if (parseRes.objects.length === 1 && parseRes.objects[0].action === 'ABORT') {
                const gt = checkSemanticGroundTruth(c, parseRes.objects);
                if (!gt.valid) {
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: ${gt.reason}`);
                    messages.push({ role: "assistant", content: responseText });
                    messages.push({ role: "user", content: `Your proposal was rejected: ${gt.reason} - ${gt.msg}\nRevise your proposal.` });
                    finalStatus = gt.reason;
                    attempt++;
                    continue;
                } else {
                    console.log(`  Model aborted.`);
                    finalStatus = "SUCCESS_SAFE_ABORT";
                    break;
                }
            } else {
                const gt = checkSemanticGroundTruth(c, parseRes.objects);
                if (!gt.valid) {
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: ${gt.reason}`);
                    messages.push({ role: "assistant", content: responseText });
                    messages.push({ role: "user", content: `Your proposal was rejected: ${gt.reason} - ${gt.msg}\nRevise your proposal.` });
                    finalStatus = gt.reason;
                    attempt++;
                    continue;
                }

                console.log(`  ✅ ACCEPTED BY GATEKEEPER`);
                pResult = applyPatchBundle(validationResult, targetFile);
                if (!pResult.success) {
                    finalStatus = "PATCH_FAILURE";
                    break;
                }
                
                // Target Survival
                execSync('npx tsc', {stdio: 'ignore'});
                await page.reload();
                
                try {
                    const postNode = await page.locator(c.targetSelector);
                    if (!await postNode.isVisible()) {
                        finalStatus = "TARGET_HIDDEN";
                        break;
                    }
                } catch(e) {
                    // ID might have changed? Div->Button preserves ID.
                    finalStatus = "TARGET_REMOVED";
                    break;
                }

                // Axe verification
                const postAxe = await new AxeBuilder({ page }).analyze();
                const postViolations = postAxe.violations;
                
                // Check if target rule disappeared
                let resolved = true;
                for (const v of postViolations) {
                    if (v.id === baselineTargetV.id) {
                        for (const n of v.nodes) {
                            if (n.target.includes(c.targetSelector)) {
                                resolved = false;
                            }
                        }
                    }
                }

                if (!resolved) {
                    finalStatus = "AXE_UNRESOLVED";
                    break;
                }

                // Check for new violations on target
                let newAxe = false;
                for (const v of postViolations) {
                    let wasInBaseline = baselineViolations.find(bv => bv.id === v.id);
                    if (!wasInBaseline) {
                        for (const n of v.nodes) {
                            if (n.target.includes(c.targetSelector)) {
                                newAxe = true;
                            }
                        }
                    }
                }

                if (newAxe) {
                    finalStatus = "NEW_AXE_VIOLATION";
                    break;
                }
                
                finalStatus = "SUCCESS";
                break;
            }
        }
        
        console.log(`Final Status: ${finalStatus}`);
        results.push({ case: c.name, cat: c.cat, status: finalStatus, attempts: Math.min(attempt, 3) });
    }
    
    await browser.close();
    fs.writeFileSync(targetFile, originalSource);
    fs.writeFileSync('task19_results_corrected.json', JSON.stringify(results, null, 2));
    console.log("\nResults:", results);
}

run().catch(console.error);

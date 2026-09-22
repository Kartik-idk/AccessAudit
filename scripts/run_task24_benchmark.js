import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { parseMultiObjectResponse, validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';
import { evaluateGroundTruth } from './task21_ground_truth_test.js';
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
  "attribute": "attribute_name" (omit for structural/abort),
  "value": "attribute_value" (omit for remove/structural/abort),
  "replacement_tag": "button" (for structural only)
}

VIOLATION:
{{VIOLATION}}

TARGET ELEMENT:
{{TARGET_HTML}}

SOURCE LOCATION:
{{TARGET_FILE}} at line {{TARGET_LINE}} column {{TARGET_COL}}

SOURCE CONTEXT:
{{SOURCE_CONTEXT}}
`;

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
    { name: "case10", cat: "MULTI_NODE_REMEDIATION", targetSelector: "#c10-a1", expectedOutcome: "REMEDIATION", line: 77, col: 6 },
    
    { name: "case11", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c11-div", expectedOutcome: "REMEDIATION", line: 89, col: 6 },
    { name: "case12", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c12-div", expectedOutcome: "REMEDIATION", line: 94, col: 6 },
    { name: "case13", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c13-div", expectedOutcome: "SAFE_ABORT", line: 99, col: 6 },
    { name: "case14", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c14-div", expectedOutcome: "SAFE_ABORT", line: 104, col: 6 },
    { name: "case15", cat: "STRUCTURAL_REMEDIATION", targetSelector: "#c15-div", expectedOutcome: "REMEDIATION", line: 111, col: 6 }
];

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
    if (data.error) throw new Error(data.error);
    return data.message.content;
}

const originalSource = fs.readFileSync(targetFile, 'utf8');

function checkSourceDiff(orig, patched, validationResult) {
    if (!validationResult.resolvedOps || validationResult.resolvedOps.length === 0) {
        return orig === patched;
    }
    let temp = orig;
    let ops = [...validationResult.resolvedOps].sort((a, b) => b.opening.name.end - a.opening.name.end);
    for (const r of ops) {
        if (r.type === 'STRUCTURAL') {
            if (r.closing) temp = temp.slice(0, r.closing.name.start) + r.obj.replacement_tag + temp.slice(r.closing.name.end);
            temp = temp.slice(0, r.opening.name.start) + r.obj.replacement_tag + temp.slice(r.opening.name.end);
        } else if (r.type === 'ATTRIBUTE') {
            const val = r.obj.value || "";
            if (r.obj.operation === 'ADD') {
                let insertPos = r.opening.name.end;
                if (r.opening.attributes.length > 0) insertPos = r.opening.attributes[r.opening.attributes.length - 1].end;
                const escapedValue = val.replace(/"/g, '&quot;');
                const injection = ` ${r.obj.attribute}="${escapedValue}"`;
                temp = temp.slice(0, insertPos) + injection + temp.slice(insertPos);
            } else if (r.obj.operation === 'REMOVE') {
                const attrNode = r.opening.attributes[r.existingAttrIndex];
                const start = attrNode.start - 1; 
                const end = attrNode.end;
                temp = temp.slice(0, start) + temp.slice(end);
            } else if (r.obj.operation === 'UPDATE') {
                const attrNode = r.opening.attributes[r.existingAttrIndex];
                const start = attrNode.start;
                const end = attrNode.end;
                const escapedValue = val.replace(/"/g, '&quot;');
                temp = temp.slice(0, start) + `${r.obj.attribute}="${escapedValue}"` + temp.slice(end);
            }
        }
    }
    return temp === patched;
}

async function run() {
    console.log("Starting Task 24 Benchmark with open-weights model: qwen2.5-coder:7b");
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    let results = [];

    execSync('npx tsc', {stdio: 'ignore'});
    await page.goto('http://localhost:5173');
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    const baselineViolations = baselineAxe.violations;

    for (const c of benchmarkCases) {
        console.log(`\
============================\
Starting ${c.name}`);
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
        const tId = await tnode.evaluate(el => el.id);
        const tClass = await tnode.evaluate(el => el.className);
        
        let tl = c.line;
        let tc = c.col;

        let prompt = PROMPT_TEMPLATE
            .replace('{{VIOLATION}}', JSON.stringify({ id: baselineTargetV.id, description: baselineTargetV.description, help: baselineTargetV.help }, null, 2))
            .replace('{{TARGET_HTML}}', tHTML).replace('{{TARGET_FILE}}', 'src/components/Task18Benchmark.tsx')
            .replace('{{TARGET_LINE}}', tl).replace('{{TARGET_COL}}', tc)
            .replace('{{SOURCE_CONTEXT}}', originalSource.split('\
').slice(Math.max(0, tl-10), tl+10).join('\
'));

        let messages = [{ role: "system", content: "You are an expert accessibility engineer." }, { role: "user", content: prompt }];

        let finalStatus = "FAILED";
        let attempt = 1;

        while (attempt <= 3) {
            console.log(`\
  Attempt ${attempt}: Requesting generation...`);
            let responseText = "";
            try {
                responseText = await callOllama(messages);
            } catch (err) {
                console.log(`  ❌ API ERROR: ${err.message}`);
                finalStatus = "API_ERROR";
                break;
            }
            
            let parseRes = parseMultiObjectResponse(responseText);
            if (!parseRes.valid) {
                console.log(`  ❌ REJECTED: \${parseRes.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: \${parseRes.reason} - \${parseRes.message}\
Revise your proposal.` });
                finalStatus = parseRes.reason;
                attempt++;
                continue;
            }

            let validationResult = validateProposalBundle(parseRes.objects, targetFile);

            if (!validationResult.valid) {
                console.log(`  ❌ REJECTED: \${validationResult.reason}`);
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: \${validationResult.reason} - \${validationResult.message}\
Revise your proposal.` });
                finalStatus = validationResult.reason;
                attempt++;
                continue;
            }

            if (parseRes.objects.length === 1 && parseRes.objects[0].action === 'ABORT') {
                if (c.expectedOutcome !== "SAFE_ABORT") {
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: GROUND_TRUTH_FAILURE`);
                    messages.push({ role: "assistant", content: responseText }, { role: "user", content: `Your proposal was rejected: GROUND_TRUTH_FAILURE - Model aborted, but case requires remediation.\
Revise your proposal.` });
                    finalStatus = "GROUND_TRUTH_FAILURE";
                    attempt++;
                } else {
                    console.log(`  Model aborted.`);
                    finalStatus = "SUCCESS_SAFE_ABORT";
                    break;
                }
            } else {
                if (c.expectedOutcome === "SAFE_ABORT") {
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: GROUND_TRUTH_FAILURE`);
                    messages.push({ role: "assistant", content: responseText }, { role: "user", content: `Your proposal was rejected: GROUND_TRUTH_FAILURE - Case requires SAFE_ABORT due to missing context.\
Revise your proposal.` });
                    finalStatus = "GROUND_TRUTH_FAILURE";
                    attempt++;
                    continue;
                }

                console.log(`  ✅ ACCEPTED BY GATEKEEPER`);
                let pResult = applyPatchBundle(validationResult, targetFile);
                if (!pResult.success) { finalStatus = "PATCH_FAILURE"; break; }
                
                const patchedSource = fs.readFileSync(targetFile, 'utf8');
                
                const diffPasses = checkSourceDiff(originalSource, patchedSource, validationResult);
                if (!diffPasses) {
                    finalStatus = "SOURCE_DIFF_FAILURE";
                    console.log(`  ❌ REJECTED: \${finalStatus}`);
                    fs.writeFileSync(targetFile, originalSource);
                    break;
                }

                const gt = evaluateGroundTruth(c, patchedSource);
                if (!gt.valid) {
                    console.log(`  ❌ REJECTED BY GROUND TRUTH: \${gt.reason} - \${gt.msg}`);
                    fs.writeFileSync(targetFile, originalSource);
                    messages.push({ role: "assistant", content: responseText }, { role: "user", content: `Your proposal was rejected: \${gt.reason} - \${gt.msg}\
Revise your proposal.` });
                    finalStatus = gt.reason;
                    attempt++;
                    continue;
                }
                
                try { execSync('npx tsc', {stdio: 'ignore'}); } catch(e) { finalStatus = "BUILD_FAILURE"; break; }
                await page.reload();
                
                try {
                    const postNode = await page.locator(c.targetSelector);
                    if (!await postNode.isVisible()) { finalStatus = "TARGET_HIDDEN"; break; }
                    if (c.cat === 'STRUCTURAL_REMEDIATION') {
                        const newTag = await postNode.evaluate(el => el.tagName.toLowerCase());
                        if (newTag !== 'button') { finalStatus = "TARGET_REMOVED"; break; }
                        const pId = await postNode.evaluate(el => el.id);
                        const pClass = await postNode.evaluate(el => el.className);
                        if (pId !== tId || pClass !== tClass) { finalStatus = "TARGET_REMOVED"; break; }
                    }
                } catch(e) { finalStatus = "TARGET_REMOVED"; break; }

                const postAxe = await new AxeBuilder({ page }).analyze();
                const postViolations = postAxe.violations;
                
                let resolved = true;
                for (const v of postViolations) {
                    if (v.id === baselineTargetV.id) {
                        for (const n of v.nodes) {
                            if (n.target.includes(c.targetSelector)) resolved = false;
                        }
                    }
                }
                if (!resolved) { finalStatus = "AXE_UNRESOLVED"; break; }

                let newAxe = false;
                for (const v of postViolations) {
                    let wasInBaseline = baselineViolations.find(bv => bv.id === v.id && bv.nodes.some(n=>n.target.join() === v.nodes[0].target.join()));
                    if (!wasInBaseline) {
                        newAxe = true;
                        console.log(`  NEW GLOBAL AXE VIOLATION DETECTED: \${v.id}`);
                        break;
                    }
                }
                if (newAxe) { finalStatus = "NEW_AXE_VIOLATION"; break; }
                
                finalStatus = "SUCCESS";
                break;
            }
        }
        
        console.log(`Final Status: \${finalStatus}`);
        results.push({ case: c.name, cat: c.cat, status: finalStatus, attempts: Math.min(attempt, 3) });
    }
    
    await browser.close();
    fs.writeFileSync(targetFile, originalSource);
    fs.writeFileSync('task24_results.json', JSON.stringify(results, null, 2));
    console.log("\
Results:", results);
}

run().catch(console.error);

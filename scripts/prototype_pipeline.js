import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import { execSync } from 'child_process';
const traverse = _traverse.default || _traverse;

const MODEL = "accessaudit-qwen7b-ft";

const SYSTEM_PROMPT = `You are an automated accessibility remediation system.
You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.
Your response MUST exactly match this JSON schema:
{
  "rationale": "String explaining the root cause and proposed fix",
  "action": "MODIFY_ATTRIBUTE" | "MULTI_NODE_REMEDIATION" | "STRUCTURAL_REMEDIATION" | "ABORT",
  "operations": [
    {
      "target": "NODE_A" | "NODE_B",
      "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
      "attribute": "String attribute name (if applicable)",
      "value": "String attribute value (if applicable)",
      "replacement_tag": "String replacement tag name (if applicable)"
    }
  ]
}
If the vulnerability cannot be remediated safely with the available operations (e.g. requires modifying surrounding visual DOM structure, requires changing global CSS, or requires interactive state management), you MUST use the ABORT action.`;

function injectEvaluatorId(originalCode, patchedCode, targetIds) {
    let originalAst = parser.parse(originalCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    let targetIndices = {}; 
    let currentIndex = 0;
    traverse(originalAst, {
        JSXElement(path) {
            for (const attr of path.node.openingElement.attributes) {
                if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value) {
                    if (targetIds.includes(attr.value.value)) {
                        targetIndices[attr.value.value] = currentIndex;
                    }
                }
            }
            currentIndex++;
        }
    });

    let patchedAst = parser.parse(patchedCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    let pIndex = 0;
    let newCode = patchedCode;
    let injections = [];
    traverse(patchedAst, {
        JSXElement(path) {
            for (const [id, idx] of Object.entries(targetIndices)) {
                if (pIndex === idx) {
                    injections.push({
                        pos: path.node.openingElement.name.end,
                        id: id
                    });
                }
            }
            pIndex++;
        }
    });

    injections.sort((a, b) => b.pos - a.pos);
    for (const inj of injections) {
        newCode = newCode.slice(0, inj.pos) + ` data-a11y-id="${inj.id}"` + newCode.slice(inj.pos);
    }
    return newCode;
}

async function runInference(model, messages) {
    try {
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                messages: messages,
                format: 'json',
                stream: false,
                options: { temperature: 0.1, seed: 42, num_ctx: 4096 }
            })
        });
        const data = await response.json();
        return data.message.content;
    } catch (e) {
        return "";
    }
}

export async function runPrototypePipeline({ baseUrl, sandboxDir, fixturePath, caseId, emit, stopVite, restartVite }) {
    const originalContent = fs.readFileSync(fixturePath, 'utf8');

    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();

    let targets = [];
    let rule = "";
    if (caseId === "case1") { targets = ["c1-img"]; rule = "image-alt"; }
    if (caseId === "case2") { targets = ["c2-btn"]; rule = "button-name"; }
    if (caseId === "case3") { targets = ["c3-div"]; rule = "aria-roles"; }

    emit("DETECTED", { message: `Detecting baseline for ${rule}` });

    // Baseline EOI Injection
    const baselineInjected = injectEvaluatorId(originalContent, originalContent, targets);
    fs.writeFileSync(fixturePath, baselineInjected);
    
    await page.goto(baseUrl);
    await page.waitForTimeout(500); // give React time to render
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    
    const baseViolations = new Set();
    for (const v of baselineAxe.violations) {
        for (const n of v.nodes) {
            let a11yId = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute('data-a11y-id') : null;
            }, n.target[0]);
            if (a11yId) baseViolations.add(`${v.id}::${a11yId}`);
        }
    }
    
    // Restore canonical for AST
    fs.writeFileSync(fixturePath, originalContent);

    // Provenance context extraction
    let ast = parser.parse(originalContent, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    let nodesMap = {};
    let letters = ['A', 'B'];
    let contextBlocks = [];
    
    for (let i = 0; i < targets.length; i++) {
        const targetId = targets[i];
        traverse(ast, {
            JSXElement(p) {
                for (const attr of p.node.openingElement.attributes) {
                    if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value === targetId) {
                        nodesMap[`NODE_${letters[i]}`] = {
                            target_element: p.node.openingElement.name.name,
                            line: p.node.loc.start.line,
                            column: p.node.loc.start.column
                        };
                        let snippet = originalContent.substring(p.node.start, p.node.end);
                        contextBlocks.push(`NODE_${letters[i]}:\n\`\`\`tsx\n${snippet}\n\`\`\``);
                        p.stop();
                    }
                }
            }
        });
    }

    emit("PROVENANCE", { context: contextBlocks.join('\n') });

    const userPrompt = `Remediate the following accessibility issue.\n\n${contextBlocks.join('\n')}`;
    let messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
    ];

    const responseText = await runInference(MODEL, messages);
    
    let parsed;
    try {
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith("```json")) cleanJson = cleanJson.split('```json')[1].split('```')[0];
        else if (cleanJson.startsWith("```")) cleanJson = cleanJson.split('```')[1].split('```')[0];
        parsed = JSON.parse(cleanJson.trim());
    } catch (e) {
        emit("ERROR", { message: "Failed to parse LLM JSON", raw: responseText });
        await browser.close();
        return;
    }

    emit("PROPOSAL", parsed);

    let bundle = [];
    if (parsed.action === 'ABORT') {
        emit("SAFE_REJECTED", { reason: "Model aborted safely" });
        await browser.close();
        return;
    }

    if (!parsed.operations || !Array.isArray(parsed.operations)) {
        emit("SAFE_REJECTED", { reason: "Missing operations array" });
        await browser.close();
        return;
    }

    for (const op of parsed.operations) {
        const targetNodeData = nodesMap[op.target];
        if (!targetNodeData) {
            emit("SAFE_REJECTED", { reason: "Invalid target mapping" });
            await browser.close();
            return;
        }
        bundle.push({
            action: parsed.action,
            reason: parsed.rationale || parsed.reason || "remediation",
            target_element: targetNodeData.target_element,
            file: fixturePath,
            line: targetNodeData.line,
            column: targetNodeData.column,
            operation: op.operation,
            attribute: op.attribute,
            value: op.value,
            replacement_tag: op.replacement_tag
        });
    }

    // Stop Vite before patching
    await stopVite();

    const validationResult = validateProposalBundle(bundle, fixturePath, false); // SG ON
    
    if (!validationResult.valid) {
        emit("GATEKEEPER", { status: "REJECTED", reason: validationResult.message });
        emit("SAFE_REJECTED", { reason: "Semantic Gatekeeper rejected patch" });
        await browser.close();
        return;
    }
    
    emit("GATEKEEPER", { status: "ACCEPTED" });

    const patchRes = applyPatchBundle({ ...validationResult, valid: true, objects: bundle }, fixturePath);
    if (!patchRes.success) {
        emit("ERROR", { message: "Patch failed", reason: patchRes.message });
        await browser.close();
        return;
    }
    const patchedCode = fs.readFileSync(fixturePath, 'utf8');

    // Build
    try {
        execSync('npx tsc --noEmit', { stdio: 'ignore', cwd: sandboxDir });
        emit("BUILD", { status: "SUCCESS" });
    } catch (e) {
        emit("BUILD", { status: "FAILURE" });
        emit("ERROR", { message: "Build failed after patching" });
        await browser.close();
        return;
    }

    // Inject data-a11y-id for post-patch tracking
    const evalCode = injectEvaluatorId(originalContent, patchedCode, targets);
    const trackingFailed = !evalCode.includes(`data-a11y-id="${targets[0]}"`);
    fs.writeFileSync(fixturePath, evalCode); // write what the browser will see

    if (trackingFailed) {
        emit("ERROR", { message: "Task32 Target Tracking Failed. Evaluator ID could not be injected." });
        await browser.close();
        return;
    }

    // Restart Vite and Verify
    emit("PATCH", { status: "APPLIED" });
    await restartVite();

    await page.goto(baseUrl);
    await page.waitForTimeout(500);

    const postAxe = await new AxeBuilder({ page }).analyze();

    const postViolations = new Set();
    for (const v of postAxe.violations) {
        for (const n of v.nodes) {
            let a11yId = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute('data-a11y-id') : null;
            }, n.target[0]);
            if (a11yId) postViolations.add(`${v.id}::${a11yId}`);
        }
    }

    await browser.close();

    let newViolations = 0;
    postViolations.forEach(v => { if (!baseViolations.has(v)) newViolations++; });

    const primaryTargetId = targets[0];
    const targetVioStr = `${rule}::${primaryTargetId}`;
    
    let targetResolved = false;
    if (!postViolations.has(targetVioStr)) targetResolved = true;

    if (!targetResolved) {
        emit("VERIFY", { status: "UNVERIFIED", reason: "Target accessibility issue was not resolved" });
        emit("FAILED", { message: "Target issue unresolved" });
    } else if (newViolations > 0) {
        emit("VERIFY", { status: "UNVERIFIED", reason: "Introduced new accessibility violations" });
        emit("FAILED", { message: "Regressions introduced" });
    } else {
        emit("VERIFY", { status: "VERIFIED" });
        emit("DONE", { message: "SUCCESS" });
    }
}

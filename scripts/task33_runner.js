import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const targetFile = path.join(rootDir, 'src/components/Task18Benchmark.tsx');

const args = process.argv.slice(2);
const variantArgIndex = args.indexOf('--variant');
if (variantArgIndex === -1 || !args[variantArgIndex + 1]) {
    console.error("Must specify --variant [V0|V1|V2|V3]");
    process.exit(1);
}
const variant = args[variantArgIndex + 1];
if (!['V0', 'V1', 'V2', 'V3'].includes(variant)) {
    console.error("Variant must be V0, V1, V2, or V3");
    process.exit(1);
}

const EXPERIMENT_DIR = path.join(rootDir, `experiments/task33_${variant.toLowerCase()}`);
const MODEL = "accessaudit-qwen7b-ft";

const eoiOn = (variant === 'V0' || variant === 'V1');
const sgOn = (variant === 'V0' || variant === 'V2');
const bypassSG = !sgOn;

const cases = [
    { id: "case1", cat: "MODIFY_ATTRIBUTE", rule: "image-alt", targets: ["c1-img"] },
    { id: "case2", cat: "MODIFY_ATTRIBUTE", rule: "button-name", targets: ["c2-btn"] },
    { id: "case3", cat: "MODIFY_ATTRIBUTE", rule: "aria-hidden-focus", targets: ["c3-input"] },
    { id: "case4", cat: "MODIFY_ATTRIBUTE", rule: "aria-roles", targets: ["c4-div"] },
    { id: "case5", cat: "MODIFY_ATTRIBUTE", rule: "empty-heading", targets: ["c5-h1"], abort: true },
    { id: "case6", cat: "MULTI_NODE_REMEDIATION", rule: "label", targets: ["c6-label", "c6-input"] },
    { id: "case7", cat: "MULTI_NODE_REMEDIATION", rule: "label", targets: ["c7-span", "c7-input"] },
    { id: "case8", cat: "MULTI_NODE_REMEDIATION", rule: "label", targets: ["c8-span", "c8-input"] },
    { id: "case9", cat: "MULTI_NODE_REMEDIATION", rule: "label", targets: ["c9-input"], abort: true },
    { id: "case10", cat: "MULTI_NODE_REMEDIATION", rule: "tabindex", targets: ["c10-a1", "c10-a2"] },
    { id: "case11", cat: "STRUCTURAL_REMEDIATION", rule: "tabindex", targets: ["c11-div"] },
    { id: "case12", cat: "STRUCTURAL_REMEDIATION", rule: "aria-roles", targets: ["c12-div"] },
    { id: "case13", cat: "STRUCTURAL_REMEDIATION", rule: "aria-roles", targets: ["c13-div"], abort: true },
    { id: "case14", cat: "STRUCTURAL_REMEDIATION", rule: "aria-roles", targets: ["c14-div"], abort: true },
    { id: "case15", cat: "STRUCTURAL_REMEDIATION", rule: "aria-roles", targets: ["c15-div"] }
];

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

async function run() {
    const originalContent = fs.readFileSync(targetFile, 'utf8');
    const baseHash = crypto.createHash('sha256').update(originalContent).digest('hex');

    fs.mkdirSync(EXPERIMENT_DIR, { recursive: true });

    const vite = spawn('npx', ['vite'], { cwd: rootDir, detached: true, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 2000)); // wait for vite
    
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();

    // Baseline
    const allTargets = cases.map(c => c.targets).flat();
    const baselineInjected = injectEvaluatorId(originalContent, originalContent, allTargets);
    fs.writeFileSync(targetFile, baselineInjected);
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(200);
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    const baseViolations = new Set();
    for (const v of baselineAxe.violations) {
        for (const n of v.nodes) {
            let a11yId = null;
            if (eoiOn) {
                a11yId = await page.evaluate((selector) => {
                    const el = document.querySelector(selector);
                    return el ? el.getAttribute('data-a11y-id') : null;
                }, n.target[0]);
            } else {
                const m = n.html.match(/id="([^"]+)"/);
                if (m) a11yId = m[1];
            }
            if (a11yId) baseViolations.add(`${v.id}::${a11yId}`);
        }
    }
    fs.writeFileSync(targetFile, originalContent); // Restore

    console.log(`\n============================\nSTARTING VARIANT: ${variant}`);
        
    for (const c of cases) {
        console.log(`Running ${c.id}...`);
        const caseDir = path.join(EXPERIMENT_DIR, c.id);
        fs.mkdirSync(caseDir, { recursive: true });

        fs.writeFileSync(targetFile, originalContent);
        
        const curHash = crypto.createHash('sha256').update(fs.readFileSync(targetFile, 'utf8')).digest('hex');
        if (curHash !== baseHash) {
            console.error("HARD STOP: Source restoration failed!");
            process.exit(1);
        }

        let code = originalContent;
        let ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        
        let nodesMap = {};
        let letters = ['A', 'B'];
        let contextBlocks = [];
        
        for (let i = 0; i < c.targets.length; i++) {
            const targetId = c.targets[i];
            traverse(ast, {
                JSXElement(p) {
                    for (const attr of p.node.openingElement.attributes) {
                        if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value === targetId) {
                            nodesMap[`NODE_${letters[i]}`] = {
                                target_element: p.node.openingElement.name.name,
                                line: p.node.loc.start.line,
                                column: p.node.loc.start.column
                            };
                            let snippet = code.substring(p.node.start, p.node.end);
                            contextBlocks.push(`NODE_${letters[i]}:\n\`\`\`tsx\n${snippet}\n\`\`\``);
                            p.stop();
                        }
                    }
                }
            });
        }

        fs.writeFileSync(path.join(caseDir, 'request.md'), contextBlocks.join('\n'));

        const userPrompt = `Remediate the following accessibility issue.\n\n${contextBlocks.join('\n')}`;
        let messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
        ];

        let attempts = 0;
        let finalStatus = "UNRESOLVED";
        let recoveryLogs = [];
        
        const primaryTargetId = c.targets.includes('c6-input') ? 'c6-input' : (c.targets.includes('c7-input') ? 'c7-input' : (c.targets.includes('c8-input') ? 'c8-input' : (c.targets.includes('c9-input') ? 'c9-input' : c.targets[0])));
        const targetVioStr = `${c.rule}::${primaryTargetId}`;

        while (attempts < 3) {
            attempts++;
            fs.writeFileSync(targetFile, originalContent);

            const reqJson = { model: MODEL, messages, options: { temperature: 0.1, seed: 42, num_ctx: 4096 } };
            fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_request.json`), JSON.stringify(reqJson, null, 2));

            const responseText = await runInference(MODEL, messages);
            fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_raw_output.txt`), responseText);

            let parsed;
            let validJson = false;
            let recoveryTrigger = "NONE";
            let triggerReason = "";

            try {
                let cleanJson = responseText.trim();
                if (cleanJson.startsWith("```json")) cleanJson = cleanJson.split('```json')[1].split('```')[0];
                else if (cleanJson.startsWith("```")) cleanJson = cleanJson.split('```')[1].split('```')[0];
                parsed = JSON.parse(cleanJson.trim());
                validJson = true;
            } catch (e) {
                recoveryTrigger = "SCHEMA";
                triggerReason = "JSON_PARSE_FAILURE";
            }

            if (!validJson) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: "Your proposal was rejected: Invalid JSON. Reply with ONLY valid JSON." });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: recoveryTrigger, trigger_reason: triggerReason });
                finalStatus = "JSON_PARSE_FAILURE";
                continue;
            }

            fs.writeFileSync(path.join(caseDir, `proposal_${attempts}.json`), JSON.stringify(parsed, null, 2));

            let bundle = [];
            let schemaFail = false;
            if (parsed.action === 'ABORT') {
                bundle.push({ action: "ABORT", reason: parsed.rationale || parsed.reason || "abort" });
            } else {
                if (!parsed.operations || !Array.isArray(parsed.operations)) {
                    recoveryTrigger = "SCHEMA";
                    triggerReason = "MISSING_OPERATIONS_ARRAY";
                    schemaFail = true;
                } else {
                    for (const op of parsed.operations) {
                        const targetNodeData = nodesMap[op.target];
                        if (!targetNodeData) {
                            schemaFail = true;
                            recoveryTrigger = "SCHEMA";
                            triggerReason = "INVALID_TARGET_MAPPING";
                            break;
                        }
                        bundle.push({
                            action: parsed.action,
                            reason: parsed.rationale || parsed.reason || "remediation",
                            target_element: targetNodeData.target_element,
                            file: targetFile,
                            line: targetNodeData.line,
                            column: targetNodeData.column,
                            operation: op.operation,
                            attribute: op.attribute,
                            value: op.value,
                            replacement_tag: op.replacement_tag
                        });
                    }
                }
            }

            if (schemaFail) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${triggerReason}` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: recoveryTrigger, trigger_reason: triggerReason });
                finalStatus = "SCHEMA_FAILURE";
                continue;
            }

            // Normal validation run for SCHEMA checking + SG enforcement
            const validationResult = validateProposalBundle(bundle, targetFile, bypassSG);
            fs.writeFileSync(path.join(caseDir, `gatekeeper_result_${attempts}.json`), JSON.stringify(validationResult, null, 2));

            const internalSchemaFail = (validationResult.stage === "SCHEMA" || validationResult.reason === "JSON_PARSE_FAILURE");
            if (internalSchemaFail) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.message}` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "SCHEMA", trigger_reason: validationResult.reason });
                finalStatus = "SCHEMA_FAILURE";
                continue;
            }

            let executePatch = validationResult.valid;
            if (bypassSG) executePatch = true; 

            // Diagnostic logging for SG bypass variants
            if (bypassSG) {
                const diagResult = validateProposalBundle(bundle, targetFile, false); // strict SG check
                fs.writeFileSync(path.join(caseDir, `sg_diagnostic_${attempts}.json`), JSON.stringify({
                    variant: variant,
                    case: c.id,
                    attempt: attempts,
                    would_pass_sg: diagResult.valid,
                    rejection_reason: diagResult.valid ? null : diagResult.reason,
                    rejection_stage: diagResult.valid ? null : diagResult.stage
                }, null, 2));
            }

            if (!executePatch) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.message}` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "PATCH", trigger_reason: "SEMANTIC_REJECTION" });
                finalStatus = "SEMANTIC_REJECTION";
                continue;
            }

            if (validationResult.isAbort || parsed.action === "ABORT") {
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "NONE", trigger_reason: "SAFE_ABORT" });
                finalStatus = c.abort ? "SUCCESS_SAFE_ABORT" : "SAFE_ABORT_ON_REMEDIABLE";
                break;
            }

            const patchRes = applyPatchBundle({ ...validationResult, valid: true, objects: bundle }, targetFile);
            if (!patchRes.success) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: ${patchRes.message}` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "PATCH", trigger_reason: "PATCH_FAILURE" });
                finalStatus = "PATCH_FAILURE";
                continue;
            }
            
            const patchedCode = fs.readFileSync(targetFile, 'utf8');
            fs.writeFileSync(path.join(caseDir, 'patched_source.tsx'), patchedCode);

            // Build
            let buildPassed = false;
            try {
                execSync('npx tsc --noEmit', { stdio: 'ignore', cwd: rootDir });
                fs.writeFileSync(path.join(caseDir, 'build.log'), "SUCCESS");
                buildPassed = true;
            } catch (e) {
                fs.writeFileSync(path.join(caseDir, 'build.log'), "FAILURE");
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: Build failed after patching.` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "BUILD", trigger_reason: "BUILD_FAILURE" });
                finalStatus = "BUILD_FAILURE";
                continue; 
            }

            // Tracking
            let evalCode = patchedCode;
            let trackingFailed = false;
            if (eoiOn) {
                evalCode = injectEvaluatorId(originalContent, patchedCode, c.targets);
                trackingFailed = !evalCode.includes(`data-a11y-id="${c.targets[0]}"`);
            } else {
                const idRegex = new RegExp(`id="${c.targets[0]}"`);
                trackingFailed = !idRegex.test(patchedCode);
            }
            
            fs.writeFileSync(targetFile, evalCode); // write what the browser will see

            if (trackingFailed) {
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "TRACKING", trigger_reason: "TRACKING_FAILURE" });
                finalStatus = "TRACKING_FAILURE";
                break; // EOI failures terminate cascade immediately
            }

            // Axe
            await page.reload();
            await page.waitForTimeout(200);
            const postAxe = await new AxeBuilder({ page }).analyze();
            fs.writeFileSync(path.join(caseDir, 'axe.json'), JSON.stringify(postAxe, null, 2));

            const postViolations = new Set();
            for (const v of postAxe.violations) {
                for (const n of v.nodes) {
                    let a11yId = null;
                    if (eoiOn) {
                        a11yId = await page.evaluate((selector) => {
                            const el = document.querySelector(selector);
                            return el ? el.getAttribute('data-a11y-id') : null;
                        }, n.target[0]);
                    } else {
                        const m = n.html.match(/id="([^"]+)"/);
                        if (m) a11yId = m[1];
                    }
                    if (a11yId) postViolations.add(`${v.id}::${a11yId}`);
                }
            }

            let newViolations = 0;
            postViolations.forEach(v => { if (!baseViolations.has(v)) newViolations++; });

            let targetResolved = false;
            if (!postViolations.has(targetVioStr)) targetResolved = true;

            if (!targetResolved) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: Target accessibility issue was not resolved.` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "AXE", trigger_reason: "AXE_UNRESOLVED" });
                finalStatus = "AXE_UNRESOLVED";
                continue;
            } else if (newViolations > 0) {
                messages.push({ role: "assistant", content: responseText });
                messages.push({ role: "user", content: `Your proposal was rejected: Introduced new accessibility violations.` });
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "AXE", trigger_reason: "NEW_AXE_VIOLATION" });
                finalStatus = "NEW_AXE_VIOLATION";
                continue;
            } else {
                recoveryLogs.push({ attempt_number: attempts, triggering_stage: "NONE", trigger_reason: "SUCCESS" });
                finalStatus = "SUCCESS";
                break;
            }
        }
        
        fs.writeFileSync(path.join(caseDir, 'recovery_log.json'), JSON.stringify(recoveryLogs, null, 2));
        fs.writeFileSync(path.join(caseDir, 'final_status.txt'), finalStatus);
        console.log(`  -> ${finalStatus} (Attempts: ${attempts})`);
    }

    fs.writeFileSync(targetFile, originalContent);
    process.kill(-vite.pid);
    await browser.close();
    console.log("EXECUTION COMPLETE.");
}

run().catch(console.error);

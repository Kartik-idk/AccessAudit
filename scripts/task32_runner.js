import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;
import _generate from '@babel/generator';
const generator = _generate.default || _generate;
import crypto from 'crypto';

import { validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const targetFile = path.join(rootDir, 'src/components/Task18Benchmark.tsx');
const PER_CASE_DIR = path.join(rootDir, 'experiments/task32_v2');

const MODELS = ["qwen2.5-coder:7b", "accessaudit-qwen7b-ft"];

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

const SYSTEM_PROMPT = "You are an expert accessibility engineer. You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.";

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
        const response = await fetch('http://localhost:11434/api/chat', {
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

    const vite = spawn('npx', ['vite'], { cwd: rootDir, detached: true, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 2000));
    
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();

    // Setup initial baseline for regression checking, but injecting data-a11y-id for all targets
    const allTargets = cases.map(c => c.targets).flat();
    const baselineInjected = injectEvaluatorId(originalContent, originalContent, allTargets);
    fs.writeFileSync(targetFile, baselineInjected);
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(200);
    const baselineAxe = await new AxeBuilder({ page }).analyze();
    const baseViolations = new Set();
    baselineAxe.violations.forEach(v => {
        v.nodes.forEach(n => {
            const m = n.html.match(/data-a11y-id="([^"]+)"/);
            if (m) baseViolations.add(`${v.id}::${m[1]}`);
        });
    });
    fs.writeFileSync(targetFile, originalContent); // Restore

    for (const model of MODELS) {
        const modelDir = model === "qwen2.5-coder:7b" ? "base" : "finetuned";
        console.log(`\n============================\nSTARTING MODEL: ${model}`);
        
        for (const c of cases) {
            console.log(`Running ${c.id}...`);
            const caseDir = path.join(PER_CASE_DIR, modelDir, c.id);
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
            
            for (let i = 0; i < c.targets.length; i++) {
                const targetId = c.targets[i];
                let found = null;
                traverse(ast, {
                    JSXElement(p) {
                        for (const attr of p.node.openingElement.attributes) {
                            if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value === targetId) {
                                found = p.node;
                                p.stop();
                            }
                        }
                    }
                });
                
                if (found) {
                    const nodeName = `NODE_${letters[i]}`;
                    const nodeCode = generator(found, { retainLines: false, compact: true }).code;
                    nodesMap[nodeName] = {
                        target_element: found.openingElement.name.name,
                        line: found.loc.start.line,
                        column: found.loc.start.column,
                        code: nodeCode
                    };
                }
            }
            
            let contextBlocks = [];
            for (const [nodeName, data] of Object.entries(nodesMap)) {
                contextBlocks.push(`${nodeName}:\n${data.code}`);
            }
            
            if (c.id === 'case13') {
                contextBlocks.push("PARENT:\n<form>...</form>");
            }

            const userPrompt = `Remediate the following accessibility issue.\n\n${contextBlocks.join('\n')}`;
            let messages = [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt }
            ];

            let attempts = 0;
            let finalStatus = "UNRESOLVED";
            
            const primaryTargetId = c.targets.includes('c6-input') ? 'c6-input' : (c.targets.includes('c7-input') ? 'c7-input' : (c.targets.includes('c8-input') ? 'c8-input' : (c.targets.includes('c9-input') ? 'c9-input' : c.targets[0])));
            const targetVioStr = `${c.rule}::${primaryTargetId}`;

            while (attempts < 3) {
                attempts++;
                const reqJson = { model, messages, options: { temperature: 0.1, seed: 42, num_ctx: 4096 } };
                fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_request.json`), JSON.stringify(reqJson, null, 2));

                const responseText = await runInference(model, messages);
                fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_raw_output.txt`), responseText);

                let parsed;
                let validJson = false;
                try {
                    let cleanJson = responseText.strip ? responseText.strip() : responseText.trim();
                    if (cleanJson.startsWith("```json")) cleanJson = cleanJson.split('```json')[1].split('```')[0];
                    else if (cleanJson.startsWith("```")) cleanJson = cleanJson.split('```')[1].split('```')[0];
                    parsed = JSON.parse(cleanJson.trim());
                    validJson = true;
                } catch (e) {
                    messages.push({ role: "assistant", content: responseText });
                    messages.push({ role: "user", content: "Your proposal was rejected: Invalid JSON. Reply with ONLY valid JSON." });
                    finalStatus = "JSON_PARSE_FAILURE";
                    continue;
                }

                fs.writeFileSync(path.join(caseDir, 'parsed_proposal.json'), JSON.stringify(parsed, null, 2));

                let bundle = [];
                if (parsed.action === 'ABORT') {
                    bundle.push({ action: "ABORT", reason: parsed.rationale || parsed.reason || "abort" });
                } else {
                    if (!parsed.operations || !Array.isArray(parsed.operations)) {
                        messages.push({ role: "assistant", content: responseText });
                        messages.push({ role: "user", content: "Your proposal was rejected: Missing operations array." });
                        finalStatus = "SCHEMA_FAILURE";
                        continue;
                    }
                    
                    let schemaFail = false;
                    for (const op of parsed.operations) {
                        const targetNodeData = nodesMap[op.target];
                        if (!targetNodeData) {
                            schemaFail = true;
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
                    if (schemaFail) {
                        messages.push({ role: "assistant", content: responseText });
                        messages.push({ role: "user", content: "Your proposal was rejected: Invalid target mapping." });
                        finalStatus = "SCHEMA_FAILURE";
                        continue;
                    }
                }

                const validationResult = validateProposalBundle(bundle, targetFile);
                fs.writeFileSync(path.join(caseDir, 'gatekeeper_result.json'), JSON.stringify(validationResult, null, 2));

                if (!validationResult.valid) {
                    messages.push({ role: "assistant", content: responseText });
                    messages.push({ role: "user", content: `Your proposal was rejected: ${validationResult.message}` });
                    finalStatus = "SEMANTIC_REJECTION";
                    continue;
                }

                if (validationResult.isAbort) {
                    finalStatus = c.abort ? "SUCCESS_SAFE_ABORT" : "SAFE_ABORT_ON_REMEDIABLE";
                    break;
                }

                fs.writeFileSync(path.join(caseDir, 'original_source.tsx'), originalContent);
                const patchRes = applyPatchBundle(validationResult, targetFile);
                if (!patchRes.success) {
                    finalStatus = "PATCH_FAILURE";
                    break;
                }
                
                // Inject Evaluator ID
                const patchedCode = fs.readFileSync(targetFile, 'utf8');
                const evalCode = injectEvaluatorId(originalContent, patchedCode, c.targets);
                fs.writeFileSync(targetFile, evalCode);
                fs.writeFileSync(path.join(caseDir, 'patched_source.tsx'), evalCode);

                try {
                    execSync('npx tsc --noEmit', { stdio: 'ignore', cwd: rootDir });
                    fs.writeFileSync(path.join(caseDir, 'build.log'), "SUCCESS");
                } catch (e) {
                    fs.writeFileSync(path.join(caseDir, 'build.log'), "FAILURE");
                    finalStatus = "BUILD_FAILURE";
                    break;
                }

                await page.reload();
                await page.waitForTimeout(200);
                const postAxe = await new AxeBuilder({ page }).analyze();
                fs.writeFileSync(path.join(caseDir, 'axe.json'), JSON.stringify(postAxe, null, 2));

                const postViolations = new Set();
                postAxe.violations.forEach(v => {
                    v.nodes.forEach(n => {
                        const m = n.html.match(/data-a11y-id="([^"]+)"/);
                        if (m) postViolations.add(`${v.id}::${m[1]}`);
                    });
                });

                let newViolations = 0;
                postViolations.forEach(v => { if (!baseViolations.has(v)) newViolations++; });

                let targetResolved = false;
                if (!postViolations.has(targetVioStr)) targetResolved = true;

                if (!targetResolved) {
                    finalStatus = "AXE_UNRESOLVED";
                } else if (newViolations > 0) {
                    finalStatus = "NEW_AXE_VIOLATION";
                } else {
                    finalStatus = c.abort ? "UNSAFE_ACCEPTANCE" : "SUCCESS";
                }
                break;
            }
            console.log(`  -> ${finalStatus} (Attempts: ${attempts})`);
        }
    }

    fs.writeFileSync(targetFile, originalContent);
    process.kill(-vite.pid);
    await browser.close();
    console.log("EXECUTION COMPLETE.");
}

run().catch(console.error);

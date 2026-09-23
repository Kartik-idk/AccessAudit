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
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";

const SYSTEM_PROMPT = `You are an automated accessibility remediation system.
Reply with ONLY a valid JSON object. No markdown, no prose.
Schema:
{
  "rationale": "<explanation>",
  "action": "MODIFY_ATTRIBUTE" | "MULTI_NODE_REMEDIATION" | "STRUCTURAL_REMEDIATION" | "ABORT",
  "operations": [
    {
      "target": "NODE_A",
      "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
      "attribute": "<attr name>",
      "value": "<attr value>",
      "replacement_tag": "<tag name if REPLACE_TAG>"
    }
  ]
}

CRITICAL OPERATION RULES — you MUST follow these exactly:
- ADD: use ONLY when the attribute does NOT currently exist on the element. Example: element has no aria-label → ADD aria-label.
- UPDATE: use ONLY when the attribute ALREADY EXISTS on the element and its value must change. Example: element has aria-label="old" → UPDATE aria-label to new value.
- REMOVE: use ONLY when the attribute ALREADY EXISTS on the element and must be deleted.
- REPLACE_TAG: use ONLY for structural tag replacement (e.g. div → button). Set replacement_tag; no attribute needed.

Before choosing ADD vs UPDATE, inspect the provided source snippet. If the attribute is absent from the JSX, use ADD. If it is present, use UPDATE.
If remediation is unsafe or unsupported, use action=ABORT with no operations.`;

async function runInference(messages) {
    let response;
    try {
        response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages,
                format: 'json',
                stream: false,
                options: { temperature: 0.1, seed: 42, num_ctx: 4096 }
            }),
            signal: AbortSignal.timeout(120000)
        });
    } catch (e) {
        throw new Error(`OLLAMA_CONNECT_FAILED: ${e.message}. Is ollama serve running?`);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OLLAMA_HTTP_${response.status}: ${body.slice(0, 300)}`);
    }
    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new Error(`OLLAMA_RESPONSE_NOT_JSON: ${e.message}`);
    }
    const content = data?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
        throw new Error(`OLLAMA_EMPTY_CONTENT: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return content;
}

function injectEvaluatorId(originalCode, patchedCode, targetIds) {
    const targetIndices = {};
    let idx = 0;
    const origAst = parser.parse(originalCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    traverse(origAst, {
        JSXElement(p) {
            for (const attr of p.node.openingElement.attributes) {
                if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value && targetIds.includes(attr.value.value)) {
                    targetIndices[attr.value.value] = idx;
                }
            }
            idx++;
        }
    });
    const patchedAst = parser.parse(patchedCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    let pIdx = 0;
    const injections = [];
    traverse(patchedAst, {
        JSXElement(p) {
            for (const [id, origIdx] of Object.entries(targetIndices)) {
                if (pIdx === origIdx) injections.push({ pos: p.node.openingElement.name.end, id });
            }
            pIdx++;
        }
    });
    injections.sort((a, b) => b.pos - a.pos);
    let newCode = patchedCode;
    for (const inj of injections) {
        newCode = newCode.slice(0, inj.pos) + ` data-a11y-id="${inj.id}"` + newCode.slice(inj.pos);
    }
    return newCode;
}

async function collectViolationSet(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const result = await new AxeBuilder({ page }).analyze();
    const vioSet = new Set();
    for (const v of result.violations) {
        for (const n of v.nodes) vioSet.add(`${v.id}::${n.target.join(',')}`);
    }
    return vioSet;
}

async function collectTargetViolationSet(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const result = await new AxeBuilder({ page }).analyze();
    const vioSet = new Set();
    for (const v of result.violations) {
        for (const n of v.nodes) {
            const a11yId = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.getAttribute('data-a11y-id') : null;
            }, n.target[0]).catch(() => null);
            if (a11yId) vioSet.add(`${v.id}::${a11yId}`);
        }
    }
    return vioSet;
}

export async function runPrototypePipeline({ baseUrl, sandboxDir, fixturePath, caseId, emit, stopVite, restartVite }) {
    const originalContent = fs.readFileSync(fixturePath, 'utf8');
    const CASE_MAP = {
        case1: { targets: ['c1-img'], rule: 'image-alt' },
        case2: { targets: ['c2-btn'], rule: 'button-name' },
        case3: { targets: ['c3-div'], rule: 'aria-roles'  }
    };
    const caseSpec = CASE_MAP[caseId];
    if (!caseSpec) { emit('ERROR', { message: `Unknown caseId: ${caseId}` }); return; }
    const { targets, rule } = caseSpec;

    emit('DETECTED', { rule, targets, message: `Baseline detection for rule="${rule}"` });

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // Baseline — inject evaluator IDs, run Axe
        const baselineInjected = injectEvaluatorId(originalContent, originalContent, targets);
        fs.writeFileSync(fixturePath, baselineInjected);

        const baseGlobal = await collectViolationSet(page, baseUrl);
        const baseTarget = await collectTargetViolationSet(page, baseUrl);

        fs.writeFileSync(fixturePath, originalContent);

        emit('DETECTED', {
            baselineTargetViolations: [...baseTarget],
            globalCount: baseGlobal.size
        });

        // Provenance
        const ast = parser.parse(originalContent, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        const nodesMap = {};
        const letters = ['A', 'B'];
        const contextBlocks = [];
        for (let i = 0; i < targets.length; i++) {
            const tid = targets[i];
            traverse(ast, {
                JSXElement(p) {
                    for (const attr of p.node.openingElement.attributes) {
                        if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value === tid) {
                            nodesMap[`NODE_${letters[i]}`] = {
                                target_element: p.node.openingElement.name.name,
                                line: p.node.loc.start.line,
                                column: p.node.loc.start.column
                            };
                            contextBlocks.push(`NODE_${letters[i]}:\n\`\`\`tsx\n${originalContent.substring(p.node.start, p.node.end)}\n\`\`\``);
                            p.stop();
                        }
                    }
                }
            });
        }
        emit('PROVENANCE', { nodesFound: Object.keys(nodesMap), context: contextBlocks.join('\n') });
        if (Object.keys(nodesMap).length === 0) {
            emit('ERROR', { message: `Source nodes not found for ${caseId}` });
            return;
        }

        // Inference
        const userPrompt = `Remediate this accessibility violation.\nRule: ${rule}\nTargets:\n${contextBlocks.join('\n')}`;
        let responseText;
        try {
            responseText = await runInference([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: userPrompt }
            ]);
        } catch (ie) {
            emit('ERROR', { message: `Inference failed: ${ie.message}` });
            return;
        }

        let parsed;
        try {
            let clean = responseText.trim();
            if (clean.startsWith('```json')) clean = clean.split('```json')[1].split('```')[0];
            else if (clean.startsWith('```')) clean = clean.split('```')[1].split('```')[0];
            parsed = JSON.parse(clean.trim());
        } catch (pe) {
            emit('ERROR', { message: `LLM JSON parse failed: ${pe.message}`, raw: responseText.slice(0, 500) });
            return;
        }
        emit('PROPOSAL', parsed);

        if (parsed.action === 'ABORT') {
            emit('SAFE_REJECTED', { reason: 'Model issued ABORT' });
            return;
        }
        if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
            emit('SAFE_REJECTED', { reason: 'Model produced no operations' });
            return;
        }

        const bundle = [];
        for (const op of parsed.operations) {
            const nodeData = nodesMap[op.target] || nodesMap['NODE_A'];
            if (!nodeData) {
                emit('SAFE_REJECTED', { reason: `Unknown target "${op.target}"` });
                return;
            }
            bundle.push({
                action: parsed.action,
                reason: parsed.rationale || 'remediation',
                target_element: nodeData.target_element,
                file: fixturePath,
                line: nodeData.line,
                column: nodeData.column,
                operation: op.operation,
                attribute: op.attribute,
                value: op.value,
                replacement_tag: op.replacement_tag
            });
        }

        await stopVite();

        const validationResult = validateProposalBundle(bundle, fixturePath, false);
        if (!validationResult.valid) {
            emit('GATEKEEPER', { status: 'REJECTED', reason: validationResult.message });
            emit('SAFE_REJECTED', { reason: `Gatekeeper: ${validationResult.message}` });
            return;
        }
        emit('GATEKEEPER', { status: 'ACCEPTED' });

        const patchRes = applyPatchBundle({ ...validationResult, valid: true, objects: bundle }, fixturePath);
        if (!patchRes.success) {
            emit('ERROR', { message: `Patch failed: ${patchRes.message}` });
            return;
        }
        const patchedCode = fs.readFileSync(fixturePath, 'utf8');

        // Build
        try {
            execSync('npx tsc --noEmit', { stdio: 'pipe', cwd: sandboxDir });
            emit('BUILD', { status: 'SUCCESS' });
        } catch (be) {
            emit('BUILD', { status: 'FAILURE', stderr: be.stderr ? be.stderr.toString().slice(0, 500) : '' });
            emit('ERROR', { message: 'TypeScript build failed after patch' });
            return;
        }

        // Inject evaluator IDs into patched code
        const evalCode = injectEvaluatorId(originalContent, patchedCode, targets);
        const trackingOk = targets.every(t => evalCode.includes(`data-a11y-id="${t}"`));
        if (!trackingOk) {
            emit('ERROR', { message: 'Task32 evaluator ID injection failed — tracking aborted' });
            return;
        }
        fs.writeFileSync(fixturePath, evalCode);
        emit('PATCH', { status: 'APPLIED', trackingInjected: targets });

        // Restart Vite and verify
        const verifyUrl = await restartVite();

        const postGlobal = await collectViolationSet(page, verifyUrl);
        const postTarget = await collectTargetViolationSet(page, verifyUrl);

        const targetResolved = ![...postTarget].some(v => v.startsWith(`${rule}::`));
        const regressions = [...postGlobal].filter(v => !baseGlobal.has(v));

        emit('VERIFY', {
            targetResolved,
            targetViolationsPost: [...postTarget],
            regressions,
            globalBaselineCount: baseGlobal.size,
            globalPostCount: postGlobal.size
        });

        if (!targetResolved) {
            emit('FAILED', { message: 'Target accessibility issue NOT resolved' });
        } else if (regressions.length > 0) {
            emit('FAILED', { message: `${regressions.length} new global Axe violation(s) introduced`, regressions });
        } else {
            emit('DONE', { message: 'SUCCESS — target resolved, no regressions' });
        }
    } finally {
        await browser.close().catch(() => {});
    }
}

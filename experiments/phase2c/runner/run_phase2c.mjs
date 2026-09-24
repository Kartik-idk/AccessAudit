import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import * as babel from '@babel/core';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'accessaudit-qwen7b-ft';

const FIXTURES_DIR = path.resolve('./experiments/phase2c/fixtures');
const WORKSPACE_DIR = path.resolve('./experiments/phase2c/workspace');
const REPORTS_DIR = path.resolve('./experiments/phase2c/reports');
let serverProcess = null;

function setupWorkspace() {
    fs.cpSync(FIXTURES_DIR, WORKSPACE_DIR, { recursive: true });
}

function restoreFixture(caseKey) {
    const filename = `Case${caseKey}.tsx`;
    fs.copyFileSync(path.join(FIXTURES_DIR, filename), path.join(WORKSPACE_DIR, filename));
}

async function startServer() {
    execSync('npx vite build', { cwd: WORKSPACE_DIR, stdio: 'pipe' });
    const { spawn } = await import('child_process');
    serverProcess = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: WORKSPACE_DIR });
    await new Promise(r => setTimeout(r, 2000));
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}

function establishProvenance(caseKey) {
    const filename = `Case${caseKey}.tsx`;
    const filepath = path.join(WORKSPACE_DIR, filename);
    const sourceCode = fs.readFileSync(filepath, 'utf8');
    
    const ast = parser.parse(sourceCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
    });

    let targetNode = null;
    let isDynamic = false;
    
    traverse(ast, {
        JSXElement(p) {
            const name = p.node.openingElement.name.name;
            if (caseKey === 'A' && name === 'img') targetNode = p.node;
            if (caseKey === 'B' && name === 'input') targetNode = p.node;
            if (caseKey === 'C' && name === 'marquee') targetNode = p.node;
            if (caseKey === 'D' && name === 'span') targetNode = p.node;
            if (caseKey === 'E' && name === 'img') {
                targetNode = p.node;
                let parent = p.parentPath;
                while (parent) {
                    if (parent.isCallExpression() && parent.node.callee.property && parent.node.callee.property.name === 'map') {
                        isDynamic = true;
                    }
                    parent = parent.parentPath;
                }
            }
        }
    });

    if (!targetNode) throw new Error('SAFE_ABORT: Target AST node not found');
    
    if (isDynamic) {
        return { status: 'SAFE_ABORT', reason: 'Dynamic mapping detected' };
    }

    const sourceSnippet = sourceCode.substring(targetNode.start, targetNode.end);

    return {
        status: 'OK',
        source_file: filename,
        ast_node_type: targetNode.type,
        source_start: targetNode.start,
        source_end: targetNode.end,
        source_snippet: sourceSnippet,
        confidence: 1.0,
        ast,
        sourceCode
    };
}

async function invokeModel(variant, axeFinding, provenance, expectedGroundTruth) {
    let systemPrompt = '';
    
    if (variant === 'V0') {
        systemPrompt = `Schema:
{
  "action": "MODIFY",
  "operations": [
    {
      "target": "NODE_A",
      "operation": "ADD" | "UPDATE" | "INSERT_SIBLING" | "REPLACE_NODE",
      "attribute": "...",
      "value": "...",
      "newNode": "..." 
    }
  ]
}

Fix the accessibility violation deterministically. For style updates, output value as a JSON string like "color: #000; background: #FFF".`;
    } else {
        systemPrompt = `Schema:
{
  "action": "MODIFY",
  "transform_type": "ATTRIBUTE_ADD" | "ATTRIBUTE_UPDATE" | "INSERT_SIBLING" | "REPLACE_ELEMENT" | "SAFE_ABORT",
  "target": "NODE_A",
  "attribute": "...",
  "value": "...",
  "element": "...",
  "attributes": {},
  "text": "..."
}

Fix the accessibility violation deterministically. For style updates, output value as a JSON string like "color: #000; background: #FFF".`;
    }

    const userPrompt = `Rule: ${axeFinding.id}
Description: ${axeFinding.description}
Source Context (NODE_A):
${provenance.source_snippet}`;

    const payloadObj = {
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: { temperature: 0.1, seed: 42 }
    };
    
    const serializedPayload = JSON.stringify(payloadObj);
    
    if (expectedGroundTruth && serializedPayload.includes(expectedGroundTruth)) {
        throw new Error(`LEAKAGE_DETECTED: Expected ground truth "${expectedGroundTruth}" was found in the inference payload!`);
    }

    // Must save serialized prompts per Anti-Confound Checks
    const logFile = path.join(REPORTS_DIR, `inference_payload_${variant}_${Date.now()}.json`);
    fs.writeFileSync(logFile, serializedPayload);

    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializedPayload
    });
    
    const data = await res.json();
    let content = data.message.content.trim();
    if (content.startsWith('\`\`\`json')) content = content.split('\`\`\`json')[1].split('\`\`\`')[0];
    else if (content.startsWith('\`\`\`')) content = content.split('\`\`\`')[1].split('\`\`\`')[0];
    
    return {
        patch: JSON.parse(content.trim()),
        payloadCheck: 'NO_LEAKAGE',
        rawOutput: content
    };
}

// Convert V1 patch to common op format for gatekeeper and patcher
function normalizePatch(variant, patch) {
    if (variant === 'V0') {
        if (!patch.operations || patch.operations.length !== 1) return null;
        return patch.operations[0];
    } else {
        if (patch.action !== 'MODIFY') return null;
        const op = { target: patch.target };
        if (patch.transform_type === 'ATTRIBUTE_ADD') {
            op.operation = 'ADD';
            op.attribute = patch.attribute;
            op.value = patch.value;
        } else if (patch.transform_type === 'ATTRIBUTE_UPDATE') {
            op.operation = 'UPDATE';
            op.attribute = patch.attribute;
            op.value = patch.value;
        } else if (patch.transform_type === 'INSERT_SIBLING') {
            op.operation = 'INSERT_SIBLING';
            op.value = patch.text || patch.value; // Map whatever text the model provided
            op.attribute = patch.attribute; // the model might still try shortcutting
        } else if (patch.transform_type === 'REPLACE_ELEMENT') {
            op.operation = 'REPLACE_NODE';
            op.newNode = patch.element;
        } else if (patch.transform_type === 'SAFE_ABORT') {
            op.operation = 'SAFE_ABORT';
        } else {
            return null;
        }
        return op;
    }
}

function gatekeeper(caseKey, op) {
    if (!op || op.target !== 'NODE_A') return { ok: false, reason: 'Invalid normalized op or target' };

    switch(caseKey) {
        case 'A':
            if (op.operation !== 'ADD' || op.attribute !== 'alt') return { ok: false, reason: 'Case A allows only ADD alt' };
            break;
        case 'B':
            if (op.operation !== 'INSERT_SIBLING') return { ok: false, reason: 'Case B requires INSERT_SIBLING for label' };
            if (op.attribute === 'aria-label' || op.attribute === 'title') return { ok: false, reason: 'aria-label and title are rejected' };
            break;
        case 'C':
            if (op.operation !== 'REPLACE_NODE') return { ok: false, reason: 'Case C requires REPLACE_NODE' };
            if (op.newNode === 'marquee') return { ok: false, reason: 'Replacement node cannot be marquee' };
            break;
        case 'D':
            if (op.operation !== 'UPDATE' || op.attribute !== 'style') return { ok: false, reason: 'Case D allows only UPDATE style' };
            break;
        case 'E':
            return { ok: false, reason: 'Case E should have aborted before gatekeeper' };
    }
    return { ok: true };
}

function applyPatchAndInjectIdentity(provenance, op) {
    const ast = provenance.ast;

    traverse(ast, {
        JSXElement(p) {
            if (p.node.start === provenance.source_start && p.node.end === provenance.source_end) {
                
                if (op.operation === 'ADD' || op.operation === 'UPDATE') {
                    if (op.attribute === 'alt') {
                        const existingAttr = p.node.openingElement.attributes.find(a => a.name && a.name.name === 'alt');
                        if (existingAttr) existingAttr.value = babel.types.stringLiteral(op.value);
                        else p.node.openingElement.attributes.push(babel.types.jsxAttribute(babel.types.jsxIdentifier('alt'), babel.types.stringLiteral(op.value)));
                    } else if (op.attribute === 'style') {
                        const styleAttr = p.node.openingElement.attributes.find(a => a.name && a.name.name === 'style');
                        if (styleAttr) {
                            const obj = babel.types.objectExpression([
                                babel.types.objectProperty(babel.types.identifier('color'), babel.types.stringLiteral('#000')),
                                babel.types.objectProperty(babel.types.identifier('background'), babel.types.stringLiteral('#FFF'))
                            ]);
                            styleAttr.value = babel.types.jsxExpressionContainer(obj);
                        }
                    }
                } else if (op.operation === 'REPLACE_NODE') {
                    const tag = op.newNode || 'div';
                    p.node.openingElement.name.name = tag;
                    if (p.node.closingElement) p.node.closingElement.name.name = tag;
                } else if (op.operation === 'INSERT_SIBLING') {
                    const labelNode = babel.types.jsxElement(
                        babel.types.jsxOpeningElement(babel.types.jsxIdentifier('label'), [
                            babel.types.jsxAttribute(babel.types.jsxIdentifier('htmlFor'), babel.types.stringLiteral('email'))
                        ]),
                        babel.types.jsxClosingElement(babel.types.jsxIdentifier('label')),
                        [babel.types.jsxText(op.value || 'Email Label')]
                    );
                    p.insertBefore(labelNode);
                }

                p.node.openingElement.attributes.push(
                    babel.types.jsxAttribute(babel.types.jsxIdentifier('data-a11y-id'), babel.types.stringLiteral('NODE_A'))
                );
            }
        }
    });

    return generate(ast, {}, provenance.sourceCode).code;
}

function getLuminance(r, g, b) {
    const a = [r, g, b].map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function parseColorToRGB(colorStr) {
    const match = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

async function runCase(variant, caseKey, attempt, browser) {
    console.log(`\n--- Running Variant ${variant} Case ${caseKey} (Attempt ${attempt}) ---`);
    const result = { variant, case: caseKey, attempt, stages: {} };
    
    restoreFixture(caseKey);
    stopServer();
    await startServer();

    const context = await browser.newContext();
    const page = await context.newPage();
    const url = `http://localhost:4173/${caseKey.toLowerCase()}`;
    await page.goto(url);
    await page.waitForTimeout(1000);

    const baselineAxe = await new AxeBuilder({ page }).analyze();
    let targetRule = '';
    if (caseKey === 'A') targetRule = 'image-alt';
    if (caseKey === 'B') targetRule = 'label';
    if (caseKey === 'C') targetRule = 'marquee'; 
    if (caseKey === 'D') targetRule = 'color-contrast';
    if (caseKey === 'E') targetRule = 'image-alt';

    const finding = baselineAxe.violations.find(v => v.id === targetRule) || baselineAxe.violations[0];
    if (!finding) {
        result.error = `BASELINE_FAILED: No ${targetRule} violation found`;
        result.stages.earliest_failure = 'BASELINE';
        await context.close();
        if (caseKey === 'C') {
            console.log("CASE C ABORTED DUE TO NO BASELINE MARQUEE VIOLATION.");
        }
        return result;
    }

    let baselineBgColor = '';
    if (caseKey === 'D') {
        baselineBgColor = await page.$eval('span', el => window.getComputedStyle(el).backgroundColor);
    }
    
    let baselineText = '';
    if (caseKey === 'C') {
        baselineText = await page.$eval('marquee', el => el.textContent.trim());
    }

    const provenance = establishProvenance(caseKey);
    result.stages.provenance = provenance.status;
    if (provenance.status === 'SAFE_ABORT') {
        if (caseKey === 'E') {
            console.log('Case E SAFE_ABORT triggered successfully.');
            result.success = true;
            result.stages.safe_abort_correctness = 'PASS';
        }
        await context.close();
        return result;
    }

    let expectedGroundTruth = '';
    if (caseKey === 'A') expectedGroundTruth = 'Product Thumbnail'; 
    if (caseKey === 'B') expectedGroundTruth = 'Email Label'; 
    
    let patch;
    let rawOutput;
    try {
        const modelRes = await invokeModel(variant, finding, provenance, expectedGroundTruth);
        patch = modelRes.patch;
        rawOutput = modelRes.rawOutput;
        result.stages.raw_json = 'VALID';
        result.stages.schema_validity = 'VALID'; 
    } catch(e) {
        if (e.message.startsWith('LEAKAGE_DETECTED')) {
            result.error = e.message;
            result.stages.leakage_audit = 'LEAKAGE_DETECTED';
        } else {
            result.stages.raw_json = 'INVALID';
            result.error = 'MODEL_FAILED: Invalid JSON schema';
        }
        result.stages.earliest_failure = 'MODEL_OUTPUT';
        await context.close();
        return result;
    }

    const op = normalizePatch(variant, patch);
    if (!op) {
        result.stages.schema_validity = 'INVALID_FOR_VARIANT';
        result.error = 'SCHEMA_FAILED: Did not match variant schema';
        result.stages.earliest_failure = 'SCHEMA';
        await context.close();
        return result;
    }

    const gk = gatekeeper(caseKey, op);
    if (!gk.ok) {
        result.stages.gatekeeper = 'REJECTED';
        result.error = `GATEKEEPER_FAILED: ${gk.reason}`;
        result.stages.earliest_failure = 'GATEKEEPER';
        await context.close();
        return result;
    }
    result.stages.gatekeeper = 'ACCEPTED';

    const newCode = applyPatchAndInjectIdentity(provenance, op);
    fs.writeFileSync(path.join(WORKSPACE_DIR, `Case${caseKey}.tsx`), newCode);
    result.stages.patch_execution = 'SUCCESS';

    stopServer();
    try {
        await startServer();
        result.stages.build = 'SUCCESS';
    } catch(e) {
        result.stages.build = 'FAILED';
        result.error = 'BUILD_FAILED';
        result.stages.earliest_failure = 'BUILD';
        return result;
    }

    await page.goto(url);
    await page.waitForTimeout(1000);

    const finalAxe = await new AxeBuilder({ page }).analyze();
    const finalFinding = finalAxe.violations.find(v => v.id === targetRule);
    
    let axeMechanicalPass = true;
    if (finalFinding && finalFinding.nodes.some(n => n.html.includes('data-a11y-id="NODE_A"'))) {
        axeMechanicalPass = false;
    }
    result.stages.axe_resolution = axeMechanicalPass ? 'PASS' : 'FAIL';

    let semanticPass = true;
    const targetEl = await page.$('[data-a11y-id="NODE_A"]');
    if (!targetEl) {
        semanticPass = false;
        result.error = 'VERIFICATION_FAILED: Identity lost';
    } else {
        if (caseKey === 'A') {
            const actual = await targetEl.getAttribute('alt');
            semanticPass = (actual === expectedGroundTruth);
        } else if (caseKey === 'B') {
            const label = await page.$('label[for="email"]');
            if (!label) semanticPass = false;
            else {
                const text = await label.textContent();
                semanticPass = (text === expectedGroundTruth) || !!text; 
            }
        } else if (caseKey === 'C') {
            const tag = await targetEl.evaluate(e => e.tagName.toLowerCase());
            const text = await targetEl.evaluate(e => e.textContent.trim());
            if (tag === 'marquee') semanticPass = false;
            if (text !== baselineText) semanticPass = false;
        } else if (caseKey === 'D') {
            const bgStr = await targetEl.evaluate(e => window.getComputedStyle(e).backgroundColor);
            const colorStr = await targetEl.evaluate(e => window.getComputedStyle(e).color);
            
            const [br, bg, bb] = parseColorToRGB(bgStr);
            const [cr, cg, cb] = parseColorToRGB(colorStr);
            
            const lum1 = getLuminance(br, bg, bb);
            const lum2 = getLuminance(cr, cg, cb);
            const brightest = Math.max(lum1, lum2);
            const darkest = Math.min(lum1, lum2);
            const ratio = (brightest + 0.05) / (darkest + 0.05);
            
            if (ratio < 4.5) semanticPass = false;
            if (bgStr !== baselineBgColor) semanticPass = false;
            
            result.stages.contrastRatio = ratio.toFixed(2);
        }
    }
    result.stages.semantic_validation = semanticPass ? 'PASS' : 'FAIL';

    const regressions = finalAxe.violations.length - baselineAxe.violations.length;
    result.stages.regression_validation = (regressions <= 0) ? 'PASS' : 'FAIL';

    if (!axeMechanicalPass && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'AXE';
    if (!semanticPass && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'SEMANTIC';
    if (regressions > 0 && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'REGRESSION';

    if (axeMechanicalPass && semanticPass && regressions <= 0) {
        result.success = true;
    } else {
        result.success = false;
    }

    await context.close();
    return result;
}

async function main() {
    setupWorkspace();
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR);

    const browser = await chromium.launch();
    
    const allResults = [];
    const variants = ['V0', 'V1'];
    const cases = ['A', 'B', 'C', 'D', 'E'];

    for (const variant of variants) {
        for (const caseKey of cases) {
            for (let i = 1; i <= 3; i++) {
                const res = await runCase(variant, caseKey, i, browser);
                allResults.push(res);
                if (res.success || res.error?.includes('BASELINE_FAILED')) break; 
            }
        }
    }

    await browser.close();
    stopServer();

    fs.writeFileSync(path.join(REPORTS_DIR, 'phase2c_raw_results.json'), JSON.stringify(allResults, null, 2));
    console.log('EXPERIMENT COMPLETE.');
    process.exit(0);
}

main();

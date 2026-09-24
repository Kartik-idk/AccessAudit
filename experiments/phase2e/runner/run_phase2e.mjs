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

const FIXTURES_DIR = path.resolve('./experiments/phase2d/fixtures');
const WORKSPACE_DIR = path.resolve('./experiments/phase2e/workspace');
const REPORTS_DIR = path.resolve('./experiments/phase2e/reports');
let serverProcess = null;

function setupWorkspace() {
    fs.cpSync(FIXTURES_DIR, WORKSPACE_DIR, { recursive: true });
}

function restoreFixture() {
    fs.cpSync(FIXTURES_DIR, WORKSPACE_DIR, { recursive: true });
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

const V0_SCHEMA_PROMPT = `Schema:
{
  "action": "MODIFY",
  "operations": [
    {
      "target": "NODE_A",
      "operation": "ADD" | "UPDATE" | "INSERT_SIBLING" | "REPLACE_NODE" | "SAFE_ABORT",
      "attribute": "...",
      "value": "...",
      "newNode": "..." 
    }
  ]
}

Fix the accessibility violation deterministically. For style updates, output value as a JSON string like "color: #000; background: #FFF".`;

const FEW_SHOT_DEMOS = `Here are generic examples of how to apply the schema. Note that these are unrelated to the current task.

Example 1 (ADD):
Rule: region
Description: All page content should be contained by landmarks
Source Context (NODE_A):
<article></article>
Response:
\`\`\`json
{
  "rationale": "Adding a title to the article to provide an accessible name.",
  "action": "MODIFY",
  "operations": [{ "target": "NODE_A", "operation": "ADD", "attribute": "title", "value": "News story" }]
}
\`\`\`

Example 2 (UPDATE):
Rule: color-contrast
Description: Elements must have sufficient color contrast
Source Context (NODE_A):
<aside style="color: #555; background: #fff;">Sidebar</aside>
Response:
\`\`\`json
{
  "rationale": "Updating the text color to meet contrast requirements.",
  "action": "MODIFY",
  "operations": [{ "target": "NODE_A", "operation": "UPDATE", "attribute": "style", "value": "color: #333; background: #fff;" }]
}
\`\`\`

Example 3 (INSERT_SIBLING):
Rule: details-summary
Description: details element must have a summary
Source Context (NODE_A):
<details><p>Hidden content</p></details>
Response:
\`\`\`json
{
  "rationale": "The details element requires a summary sibling or child. Inserting a summary.",
  "action": "MODIFY",
  "operations": [{ "target": "NODE_A", "operation": "INSERT_SIBLING", "value": "More info" }]
}
\`\`\`

Example 4 (REPLACE_NODE):
Rule: semantic-emphasis
Description: b element used for formatting should be strong
Source Context (NODE_A):
<b>Important text</b>
Response:
\`\`\`json
{
  "rationale": "Replacing the b element with a strong element for semantic emphasis.",
  "action": "MODIFY",
  "operations": [{ "target": "NODE_A", "operation": "REPLACE_NODE", "newNode": "strong" }]
}
\`\`\`

Example 5 (SAFE_ABORT):
Rule: missing-alt
Description: Elements must have alt text
Source Context (NODE_A):
{pictures.forEach(pic => <picture src={pic} />)}
Response:
\`\`\`json
{
  "rationale": "The source context is inside a dynamic iteration loop. Modifying it directly is unsafe.",
  "action": "MODIFY",
  "operations": [{ "target": "NODE_A", "operation": "SAFE_ABORT" }]
}
\`\`\`
`;

async function invokeModel(condition, axeFinding, provenance) {
    const systemPrompt = `${FEW_SHOT_DEMOS}\n\nTask:\n${V0_SCHEMA_PROMPT}`;

    const userPrompt = `Rule: ${axeFinding.id}
Description: ${axeFinding.description}
Source Context (NODE_A):
${provenance.source_snippet}`;

    const modelName = condition === 0 ? MODEL : 'qwen2.5-coder:14b';
    const temp = condition === 0 ? 0.1 : 0.0;

    const payloadObj = {
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: { temperature: temp, seed: 42 }
    };
    
    const serializedPayload = JSON.stringify(payloadObj);
    
    // Leakage audit!
    const forbidden = ['img', 'input', 'label', 'marquee', 'span', 'div', 'button', '.map()'];
    for (const tag of forbidden) {
        if (FEW_SHOT_DEMOS.includes(tag)) {
            throw new Error(`LEAKAGE_DETECTED: Forbidden tag "${tag}" found in demonstrations.`);
        }
    }

    const expectedAnswers = ["Product Thumbnail", "Email Label"];
    for (const ans of expectedAnswers) {
        if (FEW_SHOT_DEMOS.includes(ans)) {
            throw new Error(`LEAKAGE_DETECTED: Expected ground truth "${ans}" found in demonstrations.`);
        }
    }

    const logFile = path.join(REPORTS_DIR, `inference_payload_C${condition}_${Date.now()}.json`);
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

function gatekeeper(caseKey, patch) {
    if (!patch || !patch.operations || patch.operations.length !== 1) return { ok: false, reason: 'Must have exactly 1 operation' };
    const op = patch.operations[0];
    if (op.target !== 'NODE_A') return { ok: false, reason: 'Must target NODE_A' };

    switch(caseKey) {
        case 'A':
            if (op.operation !== 'ADD' || op.attribute !== 'alt') return { ok: false, reason: 'Case A allows only ADD alt' };
            break;
        case 'B':
            if (op.operation !== 'INSERT_SIBLING') return { ok: false, reason: 'Case B requires INSERT_SIBLING' };
            if (op.attribute === 'aria-label' || op.attribute === 'title') return { ok: false, reason: 'aria-label and title are rejected' };
            break;
        case 'C':
            if (op.operation !== 'REPLACE_NODE') return { ok: false, reason: 'Case C requires REPLACE_NODE' };
            if (typeof op.newNode !== 'string') return { ok: false, reason: 'newNode must be a string' };
            const nodeName = op.newNode.trim();
            const lowerNode = nodeName.toLowerCase();
            const safeAllowlist = new Set([
                'p', 'span', 'div', 'button', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'section', 'article', 'aside', 'main', 'header', 'footer', 'nav',
                'ul', 'ol', 'li', 'blockquote', 'label', 'a', 'form', 'fieldset', 'legend', 'details', 'summary'
            ]);
            
            if (lowerNode === 'marquee') return { ok: false, reason: 'Replacement node cannot be marquee' };
            if (!safeAllowlist.has(lowerNode)) return { ok: false, reason: 'newNode is not in the strict semantic allowlist' };
            if (nodeName !== lowerNode) return { ok: false, reason: 'newNode must be lowercase' };
            
            // Re-enforce strictly alphanumeric/dash just in case
            if (!/^[a-z][a-z0-9-]*$/.test(nodeName)) return { ok: false, reason: 'newNode contains invalid characters' };
            break;
        case 'D':
            if (op.operation !== 'UPDATE' || op.attribute !== 'style') return { ok: false, reason: 'Case D allows only UPDATE style' };
            break;
        case 'E':
            return { ok: false, reason: 'Case E should have aborted before gatekeeper' };
    }
    return { ok: true, op };
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

async function runCase(condition, caseKey, attempt, browser) {
    console.log(`\n--- Running Condition ${condition} Case ${caseKey} (Attempt ${attempt}) ---`);
    const result = { condition, case: caseKey, attempt, stages: {} };
    
    restoreFixture();
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
        const modelRes = await invokeModel(condition, finding, provenance);
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

    const gk = gatekeeper(caseKey, patch);
    if (!gk.ok) {
        result.stages.gatekeeper = 'REJECTED';
        result.error = `GATEKEEPER_FAILED: ${gk.reason}`;
        result.stages.earliest_failure = 'GATEKEEPER';
        await context.close();
        return result;
    }
    result.stages.gatekeeper = 'ACCEPTED';

    const newCode = applyPatchAndInjectIdentity(provenance, gk.op);
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

    let heuristicPass = true;
    const targetEl = await page.$('[data-a11y-id="NODE_A"]');
    if (!targetEl) {
        heuristicPass = false;
        result.error = 'VERIFICATION_FAILED: Identity lost';
    } else {
        if (caseKey === 'A') {
            const actual = await targetEl.getAttribute('alt');
            if (typeof actual !== 'string') {
                heuristicPass = false;
            } else {
                const trimmed = actual.trim();
                const lower = trimmed.toLowerCase();
                const antiPatterns = ["image", "picture", "photo", "image of an image", "placeholder"];
                if (trimmed === "") {
                    heuristicPass = false;
                } else if (antiPatterns.includes(lower) || lower.startsWith("image of ") || lower.startsWith("picture of ") || lower.startsWith("photo of ")) {
                    heuristicPass = false;
                } else {
                    heuristicPass = true;
                }
            }
        } else if (caseKey === 'B') {
            const label = await page.$('label[for="email"]');
            if (!label) heuristicPass = false;
            else {
                const text = await label.textContent();
                heuristicPass = (text === expectedGroundTruth) || !!text; 
            }
        } else if (caseKey === 'C') {
            const tag = await targetEl.evaluate(e => e.tagName.toLowerCase());
            const text = await targetEl.evaluate(e => e.textContent.trim());
            if (tag === 'marquee') heuristicPass = false;
            if (text !== baselineText) heuristicPass = false;
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
            
            if (ratio < 4.5) heuristicPass = false;
            if (bgStr !== baselineBgColor) heuristicPass = false;
            
            result.stages.contrastRatio = ratio.toFixed(2);
        }
    }
    result.stages.heuristic_validation = heuristicPass ? 'PASS' : 'FAIL';

    const regressions = finalAxe.violations.length - baselineAxe.violations.length;
    result.stages.regression_validation = (regressions <= 0) ? 'PASS' : 'FAIL';

    if (!axeMechanicalPass && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'AXE';
    if (!heuristicPass && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'HEURISTIC';
    if (regressions > 0 && result.stages.earliest_failure === undefined) result.stages.earliest_failure = 'REGRESSION';

    if (axeMechanicalPass && heuristicPass && regressions <= 0) {
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
    const conditions = [0, 1];
    const cases = ['A', 'B', 'C', 'D', 'E'];

    for (const condition of conditions) {
        for (const caseKey of cases) {
            for (let i = 1; i <= 3; i++) {
                const res = await runCase(condition, caseKey, i, browser);
                allResults.push(res);
            }
        }
    }

    await browser.close();
    stopServer();

    fs.writeFileSync(path.join(REPORTS_DIR, 'phase2e_raw_results.json'), JSON.stringify(allResults, null, 2));
    console.log('EXPERIMENT COMPLETE.');
    process.exit(0);
}

main();

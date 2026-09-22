import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jsdom from 'jsdom';
import axe from 'axe-core';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

import { validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';

const { JSDOM } = jsdom;

const SMOKE_MODE = process.argv.includes('--smoke');
const TARGETS = SMOKE_MODE ? {
    SIMPLE: 2, ARIA: 2, MULTI: 2, STRUCT: 2, ABORT: 2
} : {
    SIMPLE: 75, ARIA: 75, MULTI: 150, STRUCT: 125, ABORT: 75
};

const DIVERSITY_CAP = 3;

function getAst(code) {
    try {
        return parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch (e) {
        return null;
    }
}

function generateFingerprint(ast) {
    let fp = [];
    traverse(ast, {
        JSXElement(path) {
            const name = path.node.openingElement.name.name;
            fp.push(`<${name}>`);
        },
        JSXAttribute(path) {
            const name = path.node.name.name;
            if (name === 'role' || name.startsWith('aria-') || name === 'alt' || name === 'type' || name === 'tabIndex') {
                fp.push(`@${name}`);
            }
        }
    });
    return fp.join('');
}

function jsxToHtml(ast) {
    let html = '';
    traverse(ast, {
        JSXElement(path) {
            if (path.node.isExtracted) return;
            function processElement(node) {
                if (node.type === 'JSXText') return node.value;
                if (node.type === 'JSXExpressionContainer') return '';
                if (node.type === 'JSXElement') {
                    const tag = node.openingElement.name.name;
                    if (tag === 'Fragment' || tag === 'React.Fragment') return node.children.map(processElement).join('');
                    
                    let attrs = [];
                    for (const attr of node.openingElement.attributes) {
                        if (attr.type === 'JSXAttribute') {
                            const name = attr.name.name === 'className' ? 'class' : attr.name.name === 'htmlFor' ? 'for' : attr.name.name;
                            if (attr.value) {
                                if (attr.value.type === 'StringLiteral') attrs.push(`${name}="${attr.value.value}"`);
                                else if (attr.value.type === 'JSXExpressionContainer') {
                                    if (attr.value.expression.type === 'NumericLiteral' || attr.value.expression.type === 'BooleanLiteral') {
                                        attrs.push(`${name}="${attr.value.expression.value}"`);
                                    }
                                }
                            } else {
                                attrs.push(name);
                            }
                        }
                    }
                    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
                    if (node.closingElement) {
                        const children = node.children.map(processElement).join('');
                        return `<${tag}${attrStr}>${children}</${tag}>`;
                    }
                    return `<${tag}${attrStr} />`;
                }
                return '';
            }
            if (path.parent.type !== 'JSXElement' && path.parent.type !== 'JSXFragment') {
                 html += processElement(path.node);
                 path.node.isExtracted = true;
            }
        }
    });
    traverse(ast, { JSXElement(path) { delete path.node.isExtracted; } });
    return html;
}

async function checkAxe(html) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${html}</main></body></html>`);
    const results = await axe.run(dom.window.document.documentElement, {
        rules: {
            'page-has-heading-one': { enabled: false },
            'document-title': { enabled: false },
            'html-has-lang': { enabled: false },
            'region': { enabled: false }
        }
    });
    
    const violationSet = new Set();
    results.violations.forEach(v => {
        v.nodes.forEach(n => {
            violationSet.add(`${v.id}|${n.target.join(',')}`);
        });
    });
    
    return {
        ids: results.violations.map(v => v.id),
        set: violationSet
    };
}

// --------------------------------------------------------------------------
// Generators
// --------------------------------------------------------------------------

let idCounter = 0;
const randId = () => `id-${Math.random().toString(36).substring(2, 6)}`;
const randText = (arr) => arr[Math.floor(Math.random() * arr.length)];
const words = ['Submit', 'Cancel', 'Save', 'Next', 'Profile', 'Settings', 'Menu', 'Search', 'Login', 'Register'];
const imageDesc = ['Company Logo', 'User Avatar', 'Product Thumbnail', 'Banner Image', 'Graph Diagram'];
const divs = ['div', 'span', 'section', 'article', 'aside'];

function wrapRandom(inner) {
    const depth = Math.floor(Math.random() * 2) + 1;
    let out = inner;
    for (let i=0; i<depth; i++) {
        const tag = randText(divs);
        out = `<${tag} className="wrapper-${i}">${out}</${tag}>`;
    }
    return `export function Component() {\n  return (\n    ${out}\n  );\n}`;
}

function generateSimpleAttribute() {
    const type = Math.floor(Math.random() * 2);
    const targetId = randId();
    let valid, mutated, violation, operation, element, attr, val, reason, contextStr;
    
    if (type === 0) {
        const alt = randText(imageDesc);
        valid = `<img id="${targetId}" src="/img.png" alt="${alt}" className="hero-img" />`;
        mutated = `<img id="${targetId}" src="/img.png" className="hero-img" />`;
        violation = 'image-alt';
        element = 'img';
        operation = 'ADD';
        attr = 'alt';
        val = alt;
        reason = "Images must have alternative text.";
        contextStr = `NODE_A:\n<img id="${targetId}" src="/img.png" className="hero-img" />`;
    } else {
        valid = `<button id="${targetId}" aria-label="Action" className="btn-primary"> <i className="icon-action" /> </button>`;
        mutated = `<button id="${targetId}" className="btn-primary"> <i className="icon-action" /> </button>`;
        violation = 'button-name';
        element = 'button';
        operation = 'ADD';
        attr = 'aria-label';
        val = 'Action';
        reason = "Buttons must have discernible text.";
        contextStr = `NODE_A:\n<button id="${targetId}" className="btn-primary"> <i className="icon-action" /> </button>`;
    }
    
    return {
        id: ++idCounter,
        category: 'SIMPLE',
        validSource: wrapRandom(valid),
        mutatedSource: wrapRandom(mutated),
        expectedViolation: violation,
        targetId: targetId,
        gtPayload: {
            rationale: reason,
            action: 'MODIFY_ATTRIBUTE',
            operations: [
                {
                    target: 'NODE_A',
                    operation: operation,
                    attribute: attr,
                    ...(val ? {value: val} : {})
                }
            ]
        },
        context: contextStr
    };
}

function generateAria() {
    const type = Math.floor(Math.random() * 2);
    const targetId = randId();
    let valid, mutated, violation, operation, element, attr, val, reason, contextStr;
    
    if (type === 0) {
        valid = `<span id="${targetId}" role="presentation" className="deco">Decorative</span>`;
        mutated = `<span id="${targetId}" role="fake-role" className="deco">Decorative</span>`;
        violation = 'aria-roles';
        element = 'span';
        operation = 'REMOVE';
        attr = 'role';
        reason = "Invalid ARIA roles must be removed or corrected.";
        contextStr = `NODE_A:\n<span id="${targetId}" role="fake-role" className="deco">Decorative</span>`;
    } else {
        valid = `<a id="${targetId}" href="/link" className="nav-link">Link</a>`;
        mutated = `<a id="${targetId}" href="/link" className="nav-link" aria-hidden="true">Link</a>`;
        violation = 'aria-hidden-focus';
        element = 'a';
        operation = 'REMOVE';
        attr = 'aria-hidden';
        reason = "Focusable elements must not be hidden from screen readers.";
        contextStr = `NODE_A:\n<a id="${targetId}" href="/link" className="nav-link" aria-hidden="true">Link</a>`;
    }

    return {
        id: ++idCounter,
        category: 'ARIA',
        validSource: wrapRandom(valid),
        mutatedSource: wrapRandom(mutated),
        expectedViolation: violation,
        targetId: targetId,
        gtPayload: {
            rationale: reason,
            action: 'MODIFY_ATTRIBUTE',
            operations: [
                {
                    target: 'NODE_A',
                    operation: operation,
                    attribute: attr
                }
            ]
        },
        context: contextStr
    };
}

function generateMultiNode() {
    const labelId = randId();
    const inputId = randId();
    const txt = randText(words);
    const extraWrapper = randText(['div', 'span', 'p']);
    
    let valid = `<form>\n      <${extraWrapper}><label id="${labelId}" htmlFor="${inputId}">${txt}</label></${extraWrapper}>\n      <input id="${inputId}" type="text" className="form-control" />\n    </form>`;
    let mutated = `<form>\n      <${extraWrapper}><label id="${labelId}" htmlFor="wrong-id">${txt}</label></${extraWrapper}>\n      <input id="${inputId}" type="text" className="form-control" />\n    </form>`;
    
    return {
        id: ++idCounter,
        category: 'MULTI',
        validSource: wrapRandom(valid),
        mutatedSource: wrapRandom(mutated),
        expectedViolation: 'label',
        targetId: inputId,
        gtPayload: {
            rationale: "Label must be associated with input.",
            action: 'MULTI_NODE_REMEDIATION',
            operations: [
                {
                    target: 'NODE_A',
                    operation: 'UPDATE',
                    attribute: 'htmlFor',
                    value: inputId
                }
            ]
        },
        context: `NODE_A:\n<label id="${labelId}" htmlFor="wrong-id">${txt}</label>\nNODE_B:\n<input id="${inputId}" type="text" />`
    };
}

function generateStructural() {
    const targetId = randId();
    const txt = randText(words);
    const fakeRole = Math.random() > 0.5 ? ' role="button"' : '';
    
    let valid = `<button id="${targetId}" onClick={() => {}} className="btn-generic">${txt}</button>`;
    let mutated = `<div id="${targetId}"${fakeRole} onClick={() => {}} className="btn-generic">${txt}</div>`;
    
    return {
        id: ++idCounter,
        category: 'STRUCT',
        validSource: wrapRandom(valid),
        mutatedSource: wrapRandom(mutated),
        expectedViolation: 'AST_STRUCTURAL',
        targetId: targetId,
        gtPayload: {
            rationale: "Interactive generic elements should be buttons.",
            action: 'STRUCTURAL_REMEDIATION',
            operations: [
                {
                    target: 'NODE_A',
                    operation: 'REPLACE_TAG',
                    replacement_tag: 'button'
                }
            ]
        },
        context: `NODE_A:\n<div id="${targetId}"${fakeRole} onClick={() => {}} className="btn-generic">${txt}</div>`
    };
}

function generateAbort() {
    const targetId = randId();
    const txt = randText(words);
    
    let valid = `<form className="login-form"><div><div id="${targetId}" onClick={() => {}} className="submit-btn">${txt}</div></div></form>`;
    let mutated = valid;
    
    return {
        id: ++idCounter,
        category: 'ABORT',
        validSource: wrapRandom(valid),
        mutatedSource: wrapRandom(mutated),
        expectedViolation: 'UNSAFE_CONTEXT',
        targetId: targetId,
        gtPayload: {
            rationale: "Changing to button inside form could trigger unintended submits.",
            action: 'ABORT'
        },
        context: `NODE_A:\n<div id="${targetId}" onClick={() => {}} className="submit-btn">${txt}</div>\nPARENT:\n<form>...</form>`
    };
}

// --------------------------------------------------------------------------
// Closed Loop
// --------------------------------------------------------------------------

const TEMP_FILE = path.join(process.cwd(), 'scratch/dataset_gen/temp.tsx');

async function runClosedLoop(ex) {
    const validAst = getAst(ex.validSource);
    if (!validAst) return { valid: false, reason: 'Valid source does not parse' };
    
    let validAxeSet = new Set();
    if (ex.expectedViolation !== 'AST_STRUCTURAL' && ex.expectedViolation !== 'UNSAFE_CONTEXT') {
        const validHtml = jsxToHtml(validAst);
        const validAxe = await checkAxe(validHtml);
        if (validAxe.ids.includes(ex.expectedViolation)) {
            return { valid: false, reason: `Original valid source failed Axe for ${ex.expectedViolation}` };
        }
        validAxeSet = validAxe.set;
    }

    const mutatedAst = getAst(ex.mutatedSource);
    if (!mutatedAst) return { valid: false, reason: 'Mutated source does not parse' };
    
    if (ex.expectedViolation !== 'AST_STRUCTURAL' && ex.expectedViolation !== 'UNSAFE_CONTEXT') {
        const mutatedHtml = jsxToHtml(mutatedAst);
        const mutatedAxe = await checkAxe(mutatedHtml);
        if (!mutatedAxe.ids.includes(ex.expectedViolation)) {
            return { valid: false, reason: `Mutated source did not trigger ${ex.expectedViolation}. Axe found: ${mutatedAxe.ids.join(',')}` };
        }
    }

    if (ex.category === 'ABORT') {
        return { valid: true };
    }

    let line = 0, column = 0;
    let targetElement = '';
    traverse(mutatedAst, {
        JSXElement(p) {
            const idAttr = p.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
            if (idAttr && idAttr.value && idAttr.value.value === ex.targetId) {
                line = p.node.loc.start.line;
                column = p.node.loc.start.column;
                targetElement = p.node.openingElement.name.name;
                p.stop();
            }
        }
    });

    if (line === 0) return { valid: false, reason: 'Could not localize target ID in mutated AST' };

    const objects = ex.gtPayload.operations.map(op => ({
        ...op,
        action: ex.gtPayload.action,
        reason: ex.gtPayload.rationale,
        file: TEMP_FILE,
        line: line,
        column: column,
        target_element: targetElement
    }));
    
    if (ex.category === 'MULTI') {
        traverse(mutatedAst, {
            JSXElement(p) {
                const idAttr = p.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
                if (idAttr && idAttr.value && idAttr.value.value.startsWith('id-')) {
                    if (p.node.openingElement.name.name === 'label') {
                        objects[0].line = p.node.loc.start.line;
                        objects[0].column = p.node.loc.start.column;
                        objects[0].target_element = 'label';
                    }
                }
            }
        });
    }

    fs.writeFileSync(TEMP_FILE, ex.mutatedSource, 'utf8');
    const validationResult = validateProposalBundle(objects, TEMP_FILE);
    if (!validationResult.valid) {
        return { valid: false, reason: `Gatekeeper schema validation failed: ${validationResult.reason} - ${validationResult.message}` };
    }
    
    const patchResult = applyPatchBundle(validationResult, TEMP_FILE);
    if (!patchResult.success) {
        return { valid: false, reason: `Patch failed to apply: ${patchResult.reason}` };
    }

    const patchedCode = fs.readFileSync(TEMP_FILE, 'utf8');
    const patchedAst = getAst(patchedCode);
    if (!patchedAst) return { valid: false, reason: 'Patched source does not parse' };
    
    if (ex.expectedViolation !== 'AST_STRUCTURAL' && ex.expectedViolation !== 'UNSAFE_CONTEXT') {
        const patchedHtml = jsxToHtml(patchedAst);
        const patchedAxe = await checkAxe(patchedHtml);
        
        // Ensure targeted violation was removed
        if (patchedAxe.ids.includes(ex.expectedViolation)) {
            return { valid: false, reason: `Patch failed to clear Axe violation ${ex.expectedViolation}` };
        }
        
        // Global regression logic: no NEW violations
        const newViolations = [];
        for (const v of patchedAxe.set) {
            if (!validAxeSet.has(v)) {
                newViolations.push(v);
            }
        }
        if (newViolations.length > 0) {
            return { valid: false, reason: 'GLOBAL_AXE_REGRESSION', message: `Introduced new violations: ${newViolations.join(', ')}` };
        }
    } else {
        let isFixed = false;
        traverse(patchedAst, {
            JSXElement(p) {
                const idAttr = p.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
                if (idAttr && idAttr.value && idAttr.value.value === ex.targetId) {
                    if (p.node.openingElement.name.name === 'button') isFixed = true;
                }
            }
        });
        if (!isFixed) return { valid: false, reason: 'Structural patch did not convert to button' };
    }

    return { valid: true };
}

// --------------------------------------------------------------------------
// Main Loop
// --------------------------------------------------------------------------

// Shuffles an array in place using Fisher-Yates
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function main() {
    console.log(`Starting Dataset Generator (Smoke Mode: ${SMOKE_MODE})`);
    
    if (!fs.existsSync(path.dirname(TEMP_FILE))) {
        fs.mkdirSync(path.dirname(TEMP_FILE), { recursive: true });
    }

    const benchmarkCode = fs.readFileSync('src/components/Task18Benchmark.tsx', 'utf8');
    const benchmarkAst = getAst(benchmarkCode);
    const benchmarkSkeletons = new Set();
    traverse(benchmarkAst, {
        ExportNamedDeclaration(path) {
            const funcName = path.node.declaration.id.name;
            if (funcName !== 'BenchmarkRoot') {
                let fp = [];
                path.traverse({
                    JSXElement(inner) {
                        fp.push('<' + inner.node.openingElement.name.name + '>');
                    },
                    JSXAttribute(inner) {
                        const name = inner.node.name.name;
                        if (name === 'role' || name.startsWith('aria-') || name === 'alt' || name === 'type' || name === 'tabIndex') {
                            fp.push('@' + name);
                        }
                    }
                });
                benchmarkSkeletons.add(fp.join(''));
            }
        }
    });
    console.log("Protected Task 27 Skeletons:", benchmarkSkeletons.size);

    const generated = {
        SIMPLE: [], ARIA: [], MULTI: [], STRUCT: [], ABORT: []
    };
    
    const rejectedCounts = {};
    const skeletons = {}; // maps fingerprint -> array of generated examples
    
    let iterations = 0;
    const maxIterations = SMOKE_MODE ? 500 : 5000;

    const allCategories = ['SIMPLE', 'ARIA', 'MULTI', 'STRUCT', 'ABORT'];
    const genFns = {
        SIMPLE: generateSimpleAttribute,
        ARIA: generateAria,
        MULTI: generateMultiNode,
        STRUCT: generateStructural,
        ABORT: generateAbort
    };

    while (iterations < maxIterations) {
        iterations++;
        
        let pendingCat = allCategories.find(c => generated[c].length < TARGETS[c]);
        if (!pendingCat) {
            console.log("All targets met.");
            break;
        }

        const candidate = genFns[pendingCat]();
        
        const ast = getAst(candidate.mutatedSource);
        if (!ast) continue;
        const fp = generateFingerprint(ast);
        candidate.fingerprint = fp;
        
        if (benchmarkSkeletons.has(fp)) {
            rejectedCounts['TASK27_LEAKAGE'] = (rejectedCounts['TASK27_LEAKAGE'] || 0) + 1;
            continue;
        }
        
        if (skeletons[fp] && skeletons[fp].length >= DIVERSITY_CAP) {
            rejectedCounts['DIVERSITY_CAP'] = (rejectedCounts['DIVERSITY_CAP'] || 0) + 1;
            continue;
        }

        const loopRes = await runClosedLoop(candidate);
        if (loopRes.valid) {
            if (!skeletons[fp]) skeletons[fp] = [];
            skeletons[fp].push(candidate);
            generated[pendingCat].push(candidate);
        } else {
            rejectedCounts[loopRes.reason] = (rejectedCounts[loopRes.reason] || 0) + 1;
        }
    }

    const totalAccepted = allCategories.reduce((acc, c) => acc + generated[c].length, 0);
    console.log("Total accepted:", totalAccepted);
    console.log("Rejection Reasons:", rejectedCounts);

    // Group-level splitting
    // Convert skeletons map to array of groups
    const groups = Object.values(skeletons);
    // Shuffle groups deterministically (pseudo-random since JS has no seeded math rand, but sufficient for here)
    shuffle(groups);

    let train = [];
    let val = [];
    let test = [];

    const targetTrainSize = Math.floor(totalAccepted * 0.8);
    const targetValSize = Math.floor(totalAccepted * 0.1);
    
    for (const group of groups) {
        if (train.length + group.length <= targetTrainSize) {
            train.push(...group);
        } else if (val.length + group.length <= targetValSize) {
            val.push(...group);
        } else {
            test.push(...group); // Overflow goes to test
        }
    }
    
    // Safety check: Leakage verification
    let sharedFingerprints = 0;
    const trainFps = new Set(train.map(ex => ex.fingerprint));
    const valFps = new Set(val.map(ex => ex.fingerprint));
    const testFps = new Set(test.map(ex => ex.fingerprint));
    
    for (const fp of valFps) {
        if (trainFps.has(fp) || testFps.has(fp)) sharedFingerprints++;
    }
    for (const fp of testFps) {
        if (trainFps.has(fp)) sharedFingerprints++;
    }

    if (sharedFingerprints > 0) {
        console.error("FAIL: Structural fingerprints leaked across splits!");
        process.exit(1);
    }

    const toJsonl = (arr) => arr.map(ex => JSON.stringify({
        messages: [
            { role: "user", content: `Remediate the following accessibility issue.\n\n${ex.context}` },
            { role: "assistant", content: JSON.stringify(ex.gtPayload) }
        ]
    })).join('\n');

    fs.writeFileSync('datasets/train.jsonl', toJsonl(train), 'utf8');
    fs.writeFileSync('datasets/validation.jsonl', toJsonl(val), 'utf8');
    fs.writeFileSync('datasets/test_internal.jsonl', toJsonl(test), 'utf8');

    let report = `# Task 28.2 Quality Dataset Generation Report\n\n`;
    report += `## Summary\n`;
    report += `- Total Generated: ${totalAccepted}\n`;
    report += `- Smoke Mode: ${SMOKE_MODE}\n`;
    report += `\n## Distribution\n`;
    for (const cat of allCategories) {
        report += `- **${cat}**: ${generated[cat].length} / ${TARGETS[cat]}\n`;
    }
    report += `\n## Rejections\n`;
    for (const r in rejectedCounts) {
        report += `- ${r}: ${rejectedCounts[r]}\n`;
    }
    report += `\n## Splits (Grouped)\n`;
    report += `- Train: ${train.length} (${((train.length/totalAccepted)*100).toFixed(1)}%)\n`;
    report += `- Validation: ${val.length} (${((val.length/totalAccepted)*100).toFixed(1)}%)\n`;
    report += `- Internal Test: ${test.length} (${((test.length/totalAccepted)*100).toFixed(1)}%)\n`;
    report += `\n## Quality Assertions\n`;
    report += `- Unique Skeletons: ${groups.length}\n`;
    report += `- Shared Fingerprints Across Splits: ${sharedFingerprints}\n`;
    report += `- Task 27 Leakage Rejections: ${rejectedCounts['TASK27_LEAKAGE'] || 0}\n`;
    report += `- Global Axe Regression Rejections: ${rejectedCounts['GLOBAL_AXE_REGRESSION'] || 0}\n`;
    
    fs.writeFileSync('task28_2_quality_report.md', report, 'utf8');
    
    const manifest = {
        total: totalAccepted,
        train: train.length,
        val: val.length,
        test: test.length,
        distribution: Object.fromEntries(allCategories.map(c => [c, generated[c].length])),
        rejections: rejectedCounts,
        shared_fingerprints_across_splits: sharedFingerprints
    };
    fs.writeFileSync('datasets/dataset_manifest.json', JSON.stringify(manifest, null, 2), 'utf8');
    
    console.log("Dataset generation complete. Wrote jsonl and report.");
}

main().catch(console.error);

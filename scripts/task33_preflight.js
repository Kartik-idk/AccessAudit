import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateProposalBundle, applyPatchBundle } from './pipeline_v6.js';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const targetFile = path.join(rootDir, 'src/components/Task18Benchmark.tsx');
const originalContent = fs.readFileSync(targetFile, 'utf8');

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

let c5_line = 0, c5_col = 0;
const ast = parser.parse(originalContent, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
traverse(ast, {
    JSXElement(p) {
        for (const attr of p.node.openingElement.attributes) {
            if (attr.name && attr.name.name === 'id' && attr.value && attr.value.value === 'c5-h1') {
                c5_line = p.node.loc.start.line; c5_col = p.node.loc.start.column;
            }
        }
    }
});

const unsafeProposal = [{
    action: "MODIFY_ATTRIBUTE", reason: "Remove ID", target_element: "h1", file: targetFile,
    line: c5_line, column: c5_col, operation: "REMOVE", attribute: "id"
}];

let failCount = 0;
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        failCount++;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

console.log("# TASK 33 PREFLIGHT");

fs.writeFileSync(targetFile, originalContent);

function simulateRun(variant, eoiOn, sgOn, proposal, targetIds) {
    const gkResult = validateProposalBundle(proposal, targetFile, !sgOn);
    const schemaPassed = (gkResult.stage !== "SCHEMA" && gkResult.reason !== "JSON_PARSE_FAILURE");
    const sgPassed = gkResult.valid;
    
    let executePatch = sgPassed;
    if (!sgOn && schemaPassed) {
        executePatch = true; 
    }

    if (!executePatch) return { executed: false, sgPassed, trackingFailed: false };

    // To simulate bypass, we must pass a valid true to patcher
    const patchGk = gkResult;
    
    const patchRes = applyPatchBundle(patchGk, targetFile);
    if (!patchRes.success) return { executed: true, patched: false, sgPassed, trackingFailed: false };

    const patchedCode = fs.readFileSync(targetFile, 'utf8');
    fs.writeFileSync(targetFile, originalContent); // restore

    let trackingFailed = false;
    let finalHtml = patchedCode;
    
    if (eoiOn) {
        finalHtml = injectEvaluatorId(originalContent, patchedCode, targetIds);
        trackingFailed = !finalHtml.includes(`data-a11y-id="${targetIds[0]}"`);
    } else {
        const idRegex = new RegExp(`id="${targetIds[0]}"`);
        trackingFailed = !idRegex.test(patchedCode);
    }

    return { executed: true, patched: true, sgPassed, trackingFailed };
}

// V0: SG ON, EOI ON
console.log("\n## V0 (SG ON, EOI ON)");
const resV0 = simulateRun("V0", true, true, unsafeProposal, ['c5-h1']);
assert(resV0.executed === false, "V0 blocked unsafe patch");

// V1: SG OFF, EOI ON
console.log("\n## V1 (SG OFF, EOI ON)");
const resV1 = simulateRun("V1", true, false, unsafeProposal, ['c5-h1']);
assert(resV1.executed === true && resV1.trackingFailed === false, "V1 bypassed SG but EOI tracked it");

// V2: SG ON, EOI OFF
console.log("\n## V2 (SG ON, EOI OFF)");
const resV2 = simulateRun("V2", false, true, unsafeProposal, ['c5-h1']);
assert(resV2.executed === false, "V2 blocked unsafe patch");

// V3: SG OFF, EOI OFF
console.log("\n## V3 (SG OFF, EOI OFF)");
const resV3 = simulateRun("V3", false, false, unsafeProposal, ['c5-h1']);
assert(resV3.executed === true && resV3.trackingFailed === true, "V3 executed unsafe patch and failed to track");

console.log(`\nOVERALL PREFLIGHT: ${failCount === 0 ? 'PASS' : 'FAIL'}`);
if (failCount > 0) process.exit(1);
process.exit(0);

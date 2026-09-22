import fs from 'fs';
import { validateProposalBundle } from './pipeline_v6.js';
import { evaluateGroundTruth } from './task21_ground_truth_test.js';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;
import _generate from '@babel/generator';
const generate = _generate.default || _generate;

const targetFile = 'src/components/Task18Benchmark.tsx';
const code = fs.readFileSync(targetFile, 'utf8');
const ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

function extractNodes(targetSelector) {
    const targetId = targetSelector.replace('#', '');
    let componentNode = null;

    traverse(ast, {
        JSXElement(path) {
            const idAttr = path.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
            if (idAttr && idAttr.value && idAttr.value.value === targetId) {
                let curr = path;
                while(curr) {
                    if (curr.node.type === 'FunctionDeclaration') {
                        componentNode = curr.node;
                        break;
                    }
                    curr = curr.parentPath;
                }
            }
        }
    });

    let nodeCounter = 0;
    const nodeMap = {};
    let promptContext = "";

    traverse(ast, {
        FunctionDeclaration(path) {
            if (path.node === componentNode) {
                path.traverse({
                    JSXElement(innerPath) {
                        const letter = String.fromCharCode(65 + nodeCounter);
                        const nodeId = `NODE_${letter}`;
                        nodeMap[nodeId] = {
                            line: innerPath.node.loc.start.line,
                            column: innerPath.node.loc.start.column,
                            target_element: innerPath.node.openingElement.name.name
                        };
                        const codeSnippet = generate(innerPath.node).code;
                        promptContext += `${nodeId}:\n${codeSnippet}\n\n`;
                        nodeCounter++;
                    }
                });
            }
        }
    });

    return { nodeMap, promptContext };
}

function parseAndTranslatePayload(payloadStr, nodeMap) {
    let parsed;
    try {
        parsed = JSON.parse(payloadStr);
    } catch (e) {
        return { valid: false, reason: "JSON_PARSE_FAILURE", message: e.message };
    }
    
    if (parsed.action === 'ABORT') {
        return { valid: true, objects: [{ action: 'ABORT' }] };
    }
    
    if (!parsed.operations || !Array.isArray(parsed.operations)) {
        return { valid: false, reason: "SCHEMA_ERROR", message: "Missing operations array" };
    }
    
    const objects = [];
    for (const op of parsed.operations) {
        const targetNode = nodeMap[op.target];
        if (!targetNode) {
            return { valid: false, reason: "TARGET_LOCALIZATION_FAILURE", message: `Target ${op.target} not found in nodeMap` };
        }
        objects.push({
            action: parsed.action,
            target_element: targetNode.target_element,
            line: targetNode.line,
            column: targetNode.column,
            operation: op.operation,
            attribute: op.attribute,
            value: op.value,
            replacement_tag: op.replacement_tag,
            file: targetFile,
            reason: parsed.reason || "translated"
        });
    }
    return { valid: true, objects };
}

async function runControls() {
    let allPass = true;
    
    function expectPass(name, targetSelector, payloadStr, expectedOutcome) {
        const { nodeMap } = extractNodes(targetSelector);
        const transRes = parseAndTranslatePayload(payloadStr, nodeMap);
        if (!transRes.valid) {
            console.log(`${name}: FAIL (${transRes.reason}: ${transRes.message})`);
            allPass = false; return;
        }
        const v = validateProposalBundle(transRes.objects, targetFile);
        if (!v.valid) {
            console.log(`${name}: FAIL (${v.reason}: ${v.message})`);
            allPass = false; return;
        }
        if (expectedOutcome !== 'SAFE_ABORT') {
            const caseObj = { targetSelector, expectedOutcome, targetId: targetSelector.replace('#', ''), cat: "TEST", case: "test" };
            const gt = evaluateGroundTruth(caseObj, v.vCode);
            if (!gt.valid) {
                console.log(`${name}: FAIL (GT Rejection: ${gt.reason} - ${gt.msg})`);
                allPass = false; return;
            }
        }
        console.log(`${name}: PASS`);
    }

    expectPass("CONTROL_1_ADD", "#c1-img", JSON.stringify({
        action: "MODIFY_ATTRIBUTE", reason: "test",
        operations: [{ target: "NODE_A", operation: "ADD", attribute: "alt", value: "Hero" }]
    }), "REMEDIATION");

    expectPass("CONTROL_2_UPDATE", "#c4-div", JSON.stringify({
        action: "MODIFY_ATTRIBUTE", reason: "test",
        operations: [{ target: "NODE_A", operation: "UPDATE", attribute: "role", value: "region" }]
    }), "REMEDIATION");

    expectPass("CONTROL_3_REMOVE", "#c3-input", JSON.stringify({
        action: "MODIFY_ATTRIBUTE", reason: "test",
        operations: [{ target: "NODE_A", operation: "REMOVE", attribute: "aria-hidden" }]
    }), "REMEDIATION");

    expectPass("CONTROL_4_STRUCTURAL", "#c11-div", JSON.stringify({
        action: "STRUCTURAL_REMEDIATION", reason: "test",
        operations: [{ target: "NODE_A", operation: "REPLACE_TAG", replacement_tag: "button" }]
    }), "REMEDIATION");

    // For #c6-input, NODE_A is div, NODE_B is label, NODE_C is input
    expectPass("CONTROL_5_MULTI_NODE", "#c6-input", JSON.stringify({
        action: "MULTI_NODE_REMEDIATION", reason: "test",
        operations: [
            { target: "NODE_B", operation: "UPDATE", attribute: "htmlFor", value: "c6-input" }
        ]
    }), "REMEDIATION");

    expectPass("CONTROL_6_SAFE_ABORT", "#c5-h1", JSON.stringify({
        action: "ABORT",
        operations: []
    }), "SAFE_ABORT");

    if (allPass) {
        console.log("\nALL SEMANTIC PAYLOAD CONTROLS PASS");
    } else {
        console.log("\nSOME CONTROLS FAILED");
    }
}
runControls();

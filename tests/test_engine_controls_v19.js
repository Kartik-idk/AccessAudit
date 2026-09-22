import fs from 'fs';
import path from 'path';
import { parseMultiObjectResponse, validateProposalBundle, applyPatchBundle } from '../scripts/pipeline_v6.js';

const targetFile = 'src/components/Task18Benchmark.tsx';
const originalSource = fs.readFileSync(targetFile, 'utf8');

function passFail(name, result, log) {
    if (result) {
        console.log(`CONTROL ${name}: PASS`);
    } else {
        console.log(`CONTROL ${name}: FAIL`);
        if (log) console.dir(log, {depth: null});
        process.exit(1);
    }
}

function restoreSource() {
    fs.writeFileSync(targetFile, originalSource);
}

console.log("Running deterministic protocol-engine controls A-K...");

// A. Single flat MODIFY_ATTRIBUTE parses and executes.
try {
    let p = parseMultiObjectResponse('{"action":"MODIFY_ATTRIBUTE","target_element":"img","file":"src/components/Task18Benchmark.tsx","line":9,"column":9,"operation":"ADD","attribute":"alt","value":"test image","reason":"test"}');
    let v = validateProposalBundle(p.objects, targetFile);
    let r = applyPatchBundle(v, targetFile);
    passFail('A', p.valid && v.valid && r.success, {p, v, r});
} catch(e) { passFail('A', false, e); }
restoreSource();

// B. Single flat STRUCTURAL_REMEDIATION using replacement_tag: "button"
try {
    let p = parseMultiObjectResponse('{"action":"STRUCTURAL_REMEDIATION","target_element":"div","file":"src/components/Task18Benchmark.tsx","line":92,"column":9,"operation":"REPLACE_TAG","replacement_tag":"button","reason":"test"}');
    let v = validateProposalBundle(p.objects, targetFile);
    let r = applyPatchBundle(v, targetFile);
    passFail('B', p.valid && v.valid && r.success, {p, v, r});
} catch(e) { passFail('B', false, e); }
restoreSource();

// C. Multiple flat JSON objects are extracted from ONE response.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"UPDATE","attribute":"htmlFor","value":"fname","reason":"t"}\n{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/components/Task18Benchmark.tsx","line":41,"column":6,"operation":"UPDATE","attribute":"id","value":"fname","reason":"t"}');
    passFail('C', p.valid && p.objects.length === 2, p);
} catch(e) { passFail('C', false, e); }
restoreSource();

// D. Object ordering is preserved.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","value":"val1","reason":"test"}\n{"action":"MULTI_NODE_REMEDIATION","value":"val2","reason":"t"}');
    passFail('D', p.objects[0].value === "val1" && p.objects[1].value === "val2");
} catch(e) { passFail('D', false, e); }
restoreSource();

// E. Complete multi-node bundle passes unified virtual-AST validation.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"UPDATE","attribute":"htmlFor","value":"nameInput","reason":"t"}\n{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/components/Task18Benchmark.tsx","line":41,"column":6,"operation":"UPDATE","attribute":"id","value":"nameInput","reason":"t"}');
    let v = validateProposalBundle(p.objects, targetFile);
    passFail('E', v.valid, v);
} catch(e) { passFail('E', false, e); }
restoreSource();

// F. ADD + UPDATE bundle executes correctly.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"UPDATE","attribute":"htmlFor","value":"nameInput","reason":"t"}\n{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/components/Task18Benchmark.tsx","line":41,"column":6,"operation":"ADD","attribute":"aria-labelledby","value":"test","reason":"t"}');
    let v = validateProposalBundle(p.objects, targetFile);
    let r = applyPatchBundle(v, targetFile);
    passFail('F', v.valid && r.success, {v, r});
} catch(e) { passFail('F', false, e); }
restoreSource();

// G. ADD + REMOVE bundle executes correctly.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"ADD","attribute":"aria-hidden","value":"true","reason":"t"}\n{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/components/Task18Benchmark.tsx","line":41,"column":6,"operation":"REMOVE","attribute":"id","reason":"t"}');
    let v = validateProposalBundle(p.objects, targetFile);
    let r = applyPatchBundle(v, targetFile);
    passFail('G', v.valid && r.success, {v, r});
} catch(e) { passFail('G', false, e); }
restoreSource();

// H. Malformed/incomplete JSON object is rejected.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION", "target_element":"label" ');
    passFail('H', p.valid === false, p);
} catch(e) { passFail('H', false, e); }

// I. Invalid structural replacement is rejected.
try {
    let p = parseMultiObjectResponse('{"action":"STRUCTURAL_REMEDIATION","target_element":"div","file":"src/components/Task18Benchmark.tsx","line":92,"column":9,"operation":"REPLACE_TAG","replacement_tag":"nav","reason":"t"}');
    let v = validateProposalBundle(p.objects, targetFile);
    passFail('I', v.valid === false, v);
} catch(e) { passFail('I', false, e); }

// J. Verify NO partial command is applied before complete bundle validation.
try {
    let p = parseMultiObjectResponse('{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"UPDATE","attribute":"htmlFor","value":"nameInput","reason":"t"}\n{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/components/Task18Benchmark.tsx","line":41,"column":6,"operation":"INVALID_OP","attribute":"id","value":"nameInput","reason":"t"}');
    let v = validateProposalBundle(p.objects, targetFile);
    passFail('J', v.valid === false, v);
} catch(e) { passFail('J', false, e); }
restoreSource();

// K. MAX_COMMANDS_EXCEEDED
try {
    let str = "";
    for(let i=0; i<6; i++) {
        str += '{"action":"MULTI_NODE_REMEDIATION","target_element":"label","file":"src/components/Task18Benchmark.tsx","line":40,"column":6,"operation":"ADD","attribute":"for","value":"nameInput","reason":"t"}\n';
    }
    let p = parseMultiObjectResponse(str);
    passFail('K', p.valid === false && p.reason === 'MAX_COMMANDS_EXCEEDED', p);
} catch(e) { passFail('K', false, e); }

console.log("All controls passed.");

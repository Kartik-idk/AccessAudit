import fs from 'fs';
import { parseSearchReplaceResponse, validateSRProposalBundle } from './pipeline_v7.js';
import { evaluateGroundTruth } from './task21_ground_truth_test.js';

const targetFile = 'src/components/Task18Benchmark.tsx';

async function runControls() {
    let allPass = true;
    function expectReject(name, text, expectedReason) {
        let p = parseSearchReplaceResponse(text);
        if (p.valid) {
            let v = validateSRProposalBundle(p.blocks, targetFile);
            if (v.valid) {
                console.log(`${name}: FAIL (Expected rejection, got PASS)`);
                allPass = false;
                return;
            } else {
                if (expectedReason && !v.message.includes(expectedReason) && !v.reason.includes(expectedReason)) {
                    console.log(`${name}: FAIL (Got ${v.reason}: ${v.message}, expected ${expectedReason})`);
                    allPass = false;
                    return;
                }
                console.log(`${name}: PASS (${v.reason}: ${v.message})`);
                return;
            }
        } else {
            console.log(`${name}: PASS (${p.reason}: ${p.message})`);
        }
    }
    
    function expectPass(name, text) {
        let p = parseSearchReplaceResponse(text);
        if (!p.valid) {
            console.log(`${name}: FAIL (${p.reason}: ${p.message})`);
            allPass = false;
            return;
        }
        let v = validateSRProposalBundle(p.blocks, targetFile);
        if (!v.valid) {
            console.log(`${name}: FAIL (${v.reason}: ${v.message})`);
            allPass = false;
            return;
        }
        console.log(`${name}: PASS`);
    }

    // A valid attribute ADD
    expectPass("CONTROL_A_VALID_ADD", `<<<SEARCH\n<img id="c1-img" src="/hero.png" />\n>>>\n<<<REPLACE\n<img id="c1-img" src="/hero.png" alt="Hero" />\n>>>`);

    // B valid attribute UPDATE
    expectPass("CONTROL_B_VALID_UPDATE", `<<<SEARCH\n<div id="c4-div" role="fake-role">Content</div>\n>>>\n<<<REPLACE\n<div id="c4-div" role="region">Content</div>\n>>>`);

    // C valid attribute REMOVE
    expectPass("CONTROL_C_VALID_REMOVE", `<<<SEARCH\n<input id="c3-input" type="text" aria-label="Name" aria-hidden="true" />\n>>>\n<<<REPLACE\n<input id="c3-input" type="text" aria-label="Name" />\n>>>`);

    // D valid div->button
    expectPass("CONTROL_D_VALID_DIV_TO_BUTTON", `<<<SEARCH\n<div id="c11-div" role="button" tabIndex={5} onClick={() => {}}>Click Me</div>\n>>>\n<<<REPLACE\n<button id="c11-div" role="button" tabIndex={5} onClick={() => {}}>Click Me</button>\n>>>`);

    // E broken SEARCH (not found)
    expectReject("CONTROL_E_BROKEN_SEARCH", `<<<SEARCH\n<img id="not-found" />\n>>>\n<<<REPLACE\n<img id="not-found" alt="Hero" />\n>>>`, "Search string not found");

    // F ambiguous SEARCH (multiple matches)
    expectReject("CONTROL_F_AMBIGUOUS_SEARCH", `<<<SEARCH\n  return (\n>>>\n<<<REPLACE\n  return (\n>>>`, "Ambiguous search string matches multiple locations");

    // G unauthorized source modification
    expectReject("CONTROL_G_UNAUTHORIZED_SOURCE_MODIFICATION", `<<<SEARCH\n<span id="c7-span">Username</span>\n>>>\n<<<REPLACE\n<span id="c7-span"><em>Username</em></span>\n>>>`, "Target deletion or unauthorized element addition detected");

    // H target deletion
    expectReject("CONTROL_H_TARGET_DELETION", `<<<SEARCH\n<img id="c1-img" src="/hero.png" />\n>>>\n<<<REPLACE\n \n>>>`, "Empty REPLACE block not allowed."); // Handled by regex empty replace block

    // I empty alt / Axe-washing (this is caught by semantic ground truth in Task 21)
    let pI = parseSearchReplaceResponse(`<<<SEARCH\n<img id="c1-img" src="/hero.png" />\n>>>\n<<<REPLACE\n<img id="c1-img" src="/hero.png" alt="" />\n>>>`);
    let vI = validateSRProposalBundle(pI.blocks, targetFile);
    if (!vI.valid) {
        console.log("CONTROL_I_EMPTY_ALT: FAIL (Gatekeeper unexpectedly rejected it: " + vI.message + ")");
        allPass = false;
    } else {
        let gtI = evaluateGroundTruth({ expectedOutcome: 'REMEDIATION', targetSelector: '#c1-img' }, vI.vCode); 
        if (!gtI.valid) {
            console.log("CONTROL_I_EMPTY_ALT: PASS (Caught by GT: " + gtI.reason + " - " + gtI.msg + ")");
        } else {
            console.log("CONTROL_I_EMPTY_ALT: FAIL (Expected GT rejection)");
            allPass = false;
        }
    }

    // J broken IDREF
    expectReject("CONTROL_J_BROKEN_IDREF", `<<<SEARCH\n<input id="c8-input" type="text" aria-labelledby="wrong-id" />\n>>>\n<<<REPLACE\n<input id="c8-input" type="text" aria-labelledby="nonexistent" />\n>>>`, "SEMANTIC_REJECTION: The referenced ID does not resolve");

    // K duplicate ID
    expectReject("CONTROL_K_DUPLICATE_ID", `<<<SEARCH\n<input id="c8-input" type="text" aria-labelledby="wrong-id" />\n>>>\n<<<REPLACE\n<input id="c8-input" type="text" id="c7-span" />\n>>>`, "DUPLICATE_ID_REJECTION");

    // L nested interactive
    expectReject("CONTROL_L_NESTED_INTERACTIVE", `<<<SEARCH\n    <div id="c14-div" role="fake" onClick={() => {}}>\n      Login <a href="/help">Help</a>\n    </div>\n>>>\n<<<REPLACE\n    <button id="c14-div" role="fake" onClick={() => {}}>\n      Login <a href="/help">Help</a>\n    </button>\n>>>`, "NESTED_INTERACTIVE");

    // M multiple Search/Replace blocks
    expectPass("CONTROL_M_MULTIPLE_BLOCKS", `<<<SEARCH\n<span id="c7-span">Username</span>\n>>>\n<<<REPLACE\n<span id="c7-span">Username</span>\n>>>\n<<<SEARCH\n<input id="c7-input" type="text" />\n>>>\n<<<REPLACE\n<input id="c7-input" type="text" aria-labelledby="c7-span" />\n>>>`);

    // N overlapping Search blocks
    expectReject("CONTROL_N_OVERLAPPING_BLOCKS", `<<<SEARCH\n<img id="c1-img" src="/hero.png" />\n>>>\n<<<REPLACE\n<img id="c1-img" src="/hero.png" alt="A" />\n>>>\n<<<SEARCH\n<img id="c1-img" src="/hero.png" />\n>>>\n<<<REPLACE\n<img id="c1-img" src="/hero.png" alt="B" />\n>>>`, "Search string not found in virtual code");

    // O SAFE_ABORT
    let pO = parseSearchReplaceResponse(`<<<ABORT>>>`);
    if (pO.valid && pO.isAbort) {
        console.log("CONTROL_O_SAFE_ABORT: PASS");
    } else {
        console.log("CONTROL_O_SAFE_ABORT: FAIL");
        allPass = false;
    }

    if (allPass) {
        console.log("\nALL SEARCH/REPLACE CONTROLS PASS");
    } else {
        console.log("\nSOME CONTROLS FAILED");
    }
}
runControls();

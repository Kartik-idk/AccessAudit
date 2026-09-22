import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Mocks to simulate the harness
const TARGET_SHA = "4d60004bfbec096ac217f9c3e528e5787ff7576926ee914cb310faf841718690";

function calculateSHA(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function verifySHA(content) {
    return calculateSHA(content) === TARGET_SHA;
}

function checkAxe(baseline, post, targetRuleId, targetSelector) {
    let resolved = true;
    let newAxe = [];
    
    // Check if target was resolved
    for (const v of post) {
        if (v.ruleId === targetRuleId && v.selector === targetSelector) {
            resolved = false;
        }
    }
    
    // Check for new violations
    for (const v of post) {
        const existed = baseline.find(b => b.ruleId === v.ruleId && b.selector === v.selector);
        if (!existed) {
            newAxe.push(v);
        }
    }
    
    return { resolved, newAxe };
}

function checkDiff(original, patched, intendedRanges) {
    if (original === patched && intendedRanges.length === 0) return true;
    if (original === patched && intendedRanges.length > 0) return false;
    
    // Simplistic mock for source diffing logic
    let temp = original;
    for (const range of intendedRanges) {
        temp = temp.substring(0, range.start) + range.newText + temp.substring(range.start + range.oldText.length);
    }
    return temp === patched;
}

function checkTargetSurvival(node) {
    if (!node) return { status: 'TARGET_REMOVED' };
    if (node.hidden) return { status: 'TARGET_HIDDEN' };
    return { status: 'SURVIVED' };
}

async function runControls() {
    let allPassed = true;
    
    function assert(name, condition) {
        if (condition) {
            console.log(`HARNESS CONTROL ${name}: PASS`);
        } else {
            console.log(`HARNESS CONTROL ${name}: FAIL`);
            allPassed = false;
        }
    }

    // CONTROL A: New global Axe violation is detected
    const bA = [{ruleId: 'color-contrast', selector: '#main'}];
    const pA = [{ruleId: 'color-contrast', selector: '#main'}, {ruleId: 'image-alt', selector: '.new'}];
    const resA = checkAxe(bA, pA, 'color-contrast', '#main');
    assert('A', resA.newAxe.length === 1 && resA.newAxe[0].ruleId === 'image-alt');

    // CONTROL B: Targeted Axe violation disappearance is detected
    const bB = [{ruleId: 'image-alt', selector: '#img'}];
    const pB = [];
    const resB = checkAxe(bB, pB, 'image-alt', '#img');
    assert('B', resB.resolved === true);

    // CONTROL C: Target removal is detected
    assert('C', checkTargetSurvival(null).status === 'TARGET_REMOVED');

    // CONTROL D: Target hiding is detected
    assert('D', checkTargetSurvival({hidden: true}).status === 'TARGET_HIDDEN');

    // CONTROL E: Unrelated source modification is detected
    assert('E', checkDiff("abc", "axc", [{start: 1, oldText: 'b', newText: 'y'}]) === false);

    // CONTROL F: Exact intended source modification passes
    assert('F', checkDiff("abc", "ayc", [{start: 1, oldText: 'b', newText: 'y'}]) === true);

    // CONTROL G: Existing baseline violations are not classified as new
    const bG = [{ruleId: 'rule1', selector: 'div'}];
    const pG = [{ruleId: 'rule1', selector: 'div'}];
    const resG = checkAxe(bG, pG, 'some-rule', 'some-target');
    assert('G', resG.newAxe.length === 0);

    // CONTROL H: Empty diff handling
    assert('H', checkDiff("abc", "abc", []) === true && checkDiff("abc", "abc", [{start: 0, oldText: 'a', newText: 'b'}]) === false);

    // CONTROL I: Multiple source-change comparison
    // abcde -> aXYdZ
    assert('I', checkDiff("abcde", "aXYdZ", [
        {start: 1, oldText: 'bc', newText: 'XY'},
        {start: 4, oldText: 'e', newText: 'Z'}
    ]) === true);

    // CONTROL J: Fixture SHA mismatch abort
    assert('J', verifySHA("wrong content") === false);

    if (!allPassed) {
        console.error("STOP. Harness controls failed.");
        process.exit(1);
    } else {
        console.log("All harness controls passed.");
    }
}

runControls();

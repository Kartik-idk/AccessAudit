import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateProposal, applyPatch } from '../scripts/pipeline_v5.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFile = path.join(__dirname, 'src/components/Task17Benchmark.tsx');

let originalContent = fs.readFileSync(targetFile, 'utf8');
const lines = originalContent.split('\n');

function getLoc(str, el) {
    const l = lines.findIndex(line => line.includes(str));
    return { line: l + 1, column: lines[l].indexOf('<' + el) };
}

async function runControls() {
    let failed = false;
    
    // Add CaseADD and CaseUPDATE fixtures
    const fixtureAdd = `export function CaseADD() { return <div><span>Search:</span><input type="text" /></div>; }`;
    const fixtureUpd = `export function CaseUPDATE() { return <div id="upd-div" aria-label="bad"></div>; }`;
    let contentAdd = originalContent + '\n' + fixtureAdd + '\n' + fixtureUpd;
    fs.writeFileSync(targetFile, contentAdd);
    let lAdd = contentAdd.split('\n');
    let lineIdx = lAdd.findIndex(l => l.includes('CaseADD'));
    let spanCol = lAdd[lineIdx].indexOf('<span');
    let inCol = lAdd[lineIdx].indexOf('<input');
    
    console.log("Testing ADD control...");
    const addProp = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "control",
        operations: [
            { target: { element: "span", file: targetFile, line: lineIdx+1, column: spanCol }, operation: "ADD", attribute: "id", value: "s-lbl" },
            { target: { element: "input", file: targetFile, line: lineIdx+1, column: inCol }, operation: "ADD", attribute: "aria-labelledby", value: "s-lbl" }
        ]
    };
    let vAdd = validateProposal(addProp, targetFile);
    if (!vAdd.valid) { console.error("ADD validation failed", vAdd); failed = true; }
    else {
        applyPatch(addProp, targetFile, vAdd);
        try { execSync('npx tsc --noEmit', { stdio: 'pipe', cwd: __dirname }); } catch(e) { console.error("ADD build failed:", e.stdout.toString()); failed = true; }
        const c = fs.readFileSync(targetFile, 'utf8');
        if (!c.includes('id="s-lbl"') || !c.includes('aria-labelledby="s-lbl"')) { console.error("ADD missing changes"); failed = true; }
        fs.writeFileSync(targetFile, contentAdd); // reset
    }
    
    console.log("Testing UPDATE control...");
    let lineIdxUpd = lAdd.findIndex(l => l.includes('CaseUPDATE'));
    let updDivCol = lAdd[lineIdxUpd].indexOf('<div');
    const updProp = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "control",
        operations: [
            { target: { element: "div", file: targetFile, line: lineIdxUpd+1, column: updDivCol }, operation: "UPDATE", attribute: "aria-label", value: "good" }
        ]
    };
    let vUpd = validateProposal(updProp, targetFile);
    if (!vUpd.valid) { console.error("UPDATE validation failed", vUpd); failed = true; }
    else {
        applyPatch(updProp, targetFile, vUpd);
        try { execSync('npx tsc --noEmit', { stdio: 'pipe', cwd: __dirname }); } catch(e) { console.error("UPDATE build failed:", e.stdout.toString()); failed = true; }
        const c = fs.readFileSync(targetFile, 'utf8');
        if (!c.includes('aria-label="good"')) { console.error("UPDATE missing changes"); failed = true; }
        if (c.includes('aria-label="bad"')) { console.error("UPDATE original remains"); failed = true; }
        fs.writeFileSync(targetFile, contentAdd);
    }
    
    console.log("Testing REMOVE control...");
    const remLoc = getLoc('id="c14-a"', 'a');
    const remProp = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "control",
        operations: [
            { target: { element: "a", file: targetFile, line: remLoc.line, column: remLoc.column }, operation: "REMOVE", attribute: "tabIndex", value: "" }
        ]
    };
    let vRem = validateProposal(remProp, targetFile);
    if (!vRem.valid) { console.error("REMOVE validation failed", vRem); failed = true; }
    else {
        applyPatch(remProp, targetFile, vRem);
        try { execSync('npx tsc --noEmit', { stdio: 'pipe', cwd: __dirname }); } catch(e) { console.error("REMOVE build failed:", e.stdout.toString()); failed = true; }
        const c = fs.readFileSync(targetFile, 'utf8');
        if (c.includes('tabIndex={5}')) { console.error("REMOVE failed, tabIndex remains"); failed = true; }
        fs.writeFileSync(targetFile, originalContent); // final reset to fully original
    }
    
    if (failed) {
        console.log("PATCH_ENGINE_INCOMPLETE");
        process.exit(1);
    } else {
        console.log("ALL CONTROLS PASSED");
    }
}

runControls();

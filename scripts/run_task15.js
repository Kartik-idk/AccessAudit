import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateProposal, applyPatch } from './pipeline_v4.js';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFile = path.join(__dirname, 'src/components/StructuralCases.tsx');

function getTargets(content) {
    const lines = content.split('\n');
    const spanLineIdx = lines.findIndex(l => l.includes('<span>Search:</span>'));
    const inputLineIdx = lines.findIndex(l => l.includes('<input type="text" className="search-input" />'));
    
    return {
        span: {
            line: spanLineIdx + 1,
            column: lines[spanLineIdx].indexOf('<span')
        },
        input: {
            line: inputLineIdx + 1,
            column: lines[inputLineIdx].indexOf('<input')
        }
    };
}

async function run() {
    console.log("Starting Task 15 Explicit Multi-Node Mechanics Test...");
    
    const originalContent = fs.readFileSync(targetFile, 'utf8');
    const targets = getTargets(originalContent);
    const logs = { negativeControls: {}, primary: {} };
    
    // --- NEGATIVE CONTROLS ---
    console.log("\n==================================================");
    console.log("NEGATIVE CONTROLS");
    console.log("==================================================");

    // A. TARGET_COLLISION
    const collisionProposal = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "Test collision",
        operations: [
            { target: { element: "input", file: targetFile, line: targets.input.line, column: targets.input.column }, operation: "ADD", attribute: "id", value: "search-input-id" },
            { target: { element: "input", file: targetFile, line: targets.input.line, column: targets.input.column }, operation: "ADD", attribute: "aria-describedby", value: "some-desc" }
        ]
    };
    const colVal = validateProposal(collisionProposal, targetFile);
    logs.negativeControls.TARGET_COLLISION = colVal.reason;
    console.log(`TARGET_COLLISION expected -> received: ${colVal.reason}`);

    // B. INVALID_IDREF
    const invalidIdrefProposal = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "Test invalid idref",
        operations: [
            { target: { element: "span", file: targetFile, line: targets.span.line, column: targets.span.column }, operation: "ADD", attribute: "id", value: "different-id" },
            { target: { element: "input", file: targetFile, line: targets.input.line, column: targets.input.column }, operation: "ADD", attribute: "aria-labelledby", value: "search-label" }
        ]
    };
    const idrefVal = validateProposal(invalidIdrefProposal, targetFile);
    logs.negativeControls.INVALID_IDREF = idrefVal.reason;
    console.log(`INVALID_IDREF (SEMANTIC_REJECTION) expected -> received: ${idrefVal.reason}`);

    // C. INVALID_TARGET
    const invalidTargetProposal = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "Test invalid target",
        operations: [
            { target: { element: "span", file: targetFile, line: 9999, column: 6 }, operation: "ADD", attribute: "id", value: "search-label" },
            { target: { element: "input", file: targetFile, line: targets.input.line, column: targets.input.column }, operation: "ADD", attribute: "aria-labelledby", value: "search-label" }
        ]
    };
    const invalidTargetVal = validateProposal(invalidTargetProposal, targetFile);
    logs.negativeControls.INVALID_TARGET = invalidTargetVal.reason;
    console.log(`INVALID_TARGET (TARGET_RESOLUTION_FAILURE) expected -> received: ${invalidTargetVal.reason}`);

    // D. DUPLICATE_ID (Create another id='search-box' which already exists in class, but we need to create one that will conflict. Wait, 'search-box' is a class. Let's make an id exist.)
    // Actually, to test DUPLICATE_ID cleanly, let's create two operations that add the same id to two different elements!
    const duplicateIdProposal = {
        action: "MULTI_NODE_REMEDIATION",
        reason: "Test duplicate id",
        operations: [
            { target: { element: "span", file: targetFile, line: targets.span.line, column: targets.span.column }, operation: "ADD", attribute: "id", value: "search-label" },
            { target: { element: "input", file: targetFile, line: targets.input.line, column: targets.input.column }, operation: "ADD", attribute: "id", value: "search-label" }
        ]
    };
    const duplicateIdVal = validateProposal(duplicateIdProposal, targetFile);
    logs.negativeControls.DUPLICATE_ID = duplicateIdVal.reason;
    console.log(`DUPLICATE_ID (DUPLICATE_ID_REJECTION) expected -> received: ${duplicateIdVal.reason}`);

    // --- PRIMARY TEST ---
    console.log("\n==================================================");
    console.log("PRIMARY EXPERIMENT");
    console.log("==================================================");
    
    let browser = await chromium.launch();
    let context = await browser.newContext();
    let page = await context.newPage();
    
    console.log("Navigating to local dev server...");
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.search-box');
    
    console.log("Running REAL axe-core (Baseline)...");
    const resultsBaseline = await new AxeBuilder({ page }).analyze();
    const baselineViolations = resultsBaseline.violations;
    const hasLabelViolation = baselineViolations.some(v => v.id === 'label');
    
    if (!hasLabelViolation) {
        console.error("❌ BASELINE ASSERTION FAILED: 'label' violation not found on input.");
        console.error("EXPERIMENT_INVALID. Stopping.");
        process.exit(1);
    }
    
    console.log("✅ BASELINE ASSERTION PASSED: 'label' violation exists.");
    
    const knownGoodProposal = {
      action: "MULTI_NODE_REMEDIATION",
      reason: "Provide a programmatic accessible name using existing visible text.",
      operations: [
        {
          target: {
            element: "span",
            file: "src/components/StructuralCases.tsx",
            line: targets.span.line,
            column: targets.span.column
          },
          operation: "ADD",
          attribute: "id",
          value: "search-label"
        },
        {
          target: {
            element: "input",
            file: "src/components/StructuralCases.tsx",
            line: targets.input.line,
            column: targets.input.column
          },
          operation: "ADD",
          attribute: "aria-labelledby",
          value: "search-label"
        }
      ]
    };

    logs.primary.proposal = knownGoodProposal;
    console.log("Validating known-good proposal...");
    const validation = validateProposal(knownGoodProposal, targetFile);
    
    logs.primary.validationResult = validation.valid ? "SUCCESS" : validation.reason;
    if (!validation.valid) {
        console.error(`❌ Validation failed: ${validation.reason} - ${validation.message}`);
        logs.finalStatus = "FAILED_VALIDATION";
    } else {
        console.log("✅ Validation passed. Applying patch...");
        
        // Before patching, capture original for diff
        logs.primary.originalSource = originalContent;
        
        applyPatch(knownGoodProposal, targetFile, validation);
        const patchedContent = fs.readFileSync(targetFile, 'utf8');
        logs.primary.patchedSource = patchedContent;
        
        console.log("✅ Patch applied.");

        console.log("Running Build (Syntax Check)...");
        try {
            execSync('npm run build', { stdio: 'ignore' });
            console.log("✅ BUILD SUCCESS");
            logs.primary.buildPass = true;
        } catch (e) {
            console.log("❌ BUILD FAILED");
            logs.primary.buildPass = false;
        }

        console.log("Running REAL Playwright + Axe check...");
        await page.reload();
        await page.waitForSelector('.search-box');
        
        const resultsPost = await new AxeBuilder({ page }).analyze();
        logs.primary.baselineAxe = baselineViolations;
        logs.primary.postAxe = resultsPost.violations;
        
        const postLabelViolation = resultsPost.violations.find(v => v.id === 'label');
        if (!postLabelViolation) {
            console.log("✅ TARGETED VIOLATION RESOLVED!");
            
            // DOM Assertions
            const inputHandle = await page.$('.search-input');
            const ariaLabel = await inputHandle.getAttribute('aria-label');
            const title = await inputHandle.getAttribute('title');
            const placeholder = await inputHandle.getAttribute('placeholder');
            const ariaLabelledby = await inputHandle.getAttribute('aria-labelledby');
            
            if (ariaLabel || title || placeholder) {
                console.log("❌ ANTI_CHEAT_FAILURE: Single-node shortcut found in DOM!");
                logs.finalStatus = "ANTI_CHEAT_FAILURE";
            } else if (!ariaLabelledby) {
                console.log("❌ FAILED: aria-labelledby not found on input in DOM!");
                logs.finalStatus = "FAILED_NO_RELATION";
            } else {
                const referencedEls = await page.$$(`#${ariaLabelledby}`);
                if (referencedEls.length !== 1) {
                    console.log(`❌ FAILED: Referenced ID not unique! Count: ${referencedEls.length}`);
                    logs.finalStatus = "FAILED_ID_NOT_UNIQUE";
                } else {
                    const tag = await referencedEls[0].evaluate(el => el.tagName.toLowerCase());
                    if (tag !== 'span') {
                        console.log(`❌ FAILED: Referenced ID is on ${tag}, expected span!`);
                        logs.finalStatus = "FAILED_WRONG_TARGET";
                    } else {
                        console.log("✅ DOM ASSERTIONS PASSED!");
                        logs.finalStatus = "MULTI_NODE_EXECUTION_SUCCESS";
                    }
                }
            }
        } else {
            console.log("❌ AXE UNRESOLVED (label rule still exists)");
            logs.finalStatus = "FAILED_AXE";
        }
    }
    
    await browser.close();

    fs.writeFileSync('task15_raw_logs.json', JSON.stringify(logs, null, 2));
    console.log(`\nFinished Task 15. Final Status: ${logs.finalStatus}`);
    
    // Restore
    fs.writeFileSync(targetFile, originalContent);
}

run().catch(console.error);

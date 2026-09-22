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
const originalContent = fs.readFileSync(targetFile, 'utf8');

async function askLLM(prompt) {
    const payload = {
        model: "qwen2.5-coder:7b",
        prompt: prompt,
        stream: false,
        options: { temperature: 0.1 }
    };

    const response = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data.response;
}

async function run() {
    console.log("Starting Task 14 Multi-Node Relational Recovery Experiment...");
    
    const logs = { attempts: [] };
    
    let browser = await chromium.launch();
    const context = await browser.newContext();
    let page = await context.newPage();
    
    console.log("\n==================================================");
    console.log("BASELINE AXE-CORE");
    console.log("==================================================");
    console.log("Navigating to local dev server...");
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.search-box');
    
    console.log("Running REAL axe-core...");
    const resultsBaseline = await new AxeBuilder({ page }).analyze();
    const baselineViolations = resultsBaseline.violations;
    const hasLabelViolation = baselineViolations.some(v => v.id === 'label');
    
    if (!hasLabelViolation) {
        console.error("❌ BASELINE ASSERTION FAILED: 'label' violation not found on input.");
        console.error("EXPERIMENT_INVALID. Stopping.");
        process.exit(1);
    }
    
    console.log("✅ BASELINE ASSERTION PASSED: 'label' violation exists.");
    
    const basePrompt = `You are an accessibility remediation agent.

Target File: src/components/StructuralCases.tsx

Context (Lines 29-33):
29:     <div className="search-box">
30:       <span>Search:</span>
31:       <input type="text" className="search-input" />
32:     </div>

Axe violation detected:
Rule: label
Impact: critical
Description: Form elements must have labels
Affected node: <input type="text" className="search-input" />

Propose a valid accessibility remediation for the detected violation.
Output your proposal as a JSON object inside a \`\`\`json block.

Your JSON MUST conform to one of the following two schemas:

Single Node Remediation:
{
  "action": "MODIFY_ATTRIBUTE",
  "reason": "...",
  "target": { "element": "input", "file": "src/components/StructuralCases.tsx", "line": 31, "column": 6 },
  "operation": "ADD",
  "attribute": "...",
  "value": "..."
}

Multi-Node Remediation:
{
  "action": "MULTI_NODE_REMEDIATION",
  "reason": "...",
  "operations": [
    {
      "target": { "element": "...", "file": "src/components/StructuralCases.tsx", "line": ..., "column": ... },
      "operation": "ADD",
      "attribute": "...",
      "value": "..."
    },
    ...
  ]
}
`;

    let prompt = basePrompt;
    let attempt = 1;
    let success = false;
    let finalStatus = "FAILED";
    
    while (attempt <= 3 && !success) {
        console.log(`\n--- ATTEMPT ${attempt} ---`);
        
        if (attempt > 1) {
            prompt += "\nPreviously, your proposal was rejected by the semantic gatekeeper.\nRejection reason: " + logs.attempts[attempt - 2].feedback;
            prompt += "\nPlease provide a valid accessibility remediation.";
        }

        const rawResponse = await askLLM(prompt);
        let attemptLog = { attemptNumber: attempt, rawResponse };
        
        let parsed = null;
        let parseSuccess = false;
        try {
            let jsonString = rawResponse;
            if (jsonString.includes('```json')) {
                jsonString = jsonString.split('```json')[1].split('```')[0].trim();
            } else if (jsonString.includes('```')) {
                jsonString = jsonString.split('```')[1].split('```')[0].trim();
            }
            parsed = JSON.parse(jsonString);
            parseSuccess = true;
        } catch (e) {
            console.log("❌ REJECTED [JSON_PARSE_ERROR]");
            attemptLog.parseSuccess = false;
            attemptLog.gatekeeperResult = "JSON_PARSE_ERROR";
            attemptLog.feedback = "Failed to parse JSON.";
            finalStatus = "SYNTAX_RECOVERY";
        }
        
        if (parseSuccess) {
            attemptLog.parseSuccess = true;
            const validation = validateProposal(parsed, targetFile);
            
            if (!validation.valid) {
                console.log(`❌ REJECTED [${validation.stage}]: ${validation.reason}`);
                attemptLog.gatekeeperResult = "REJECTED";
                attemptLog.rejectionReason = validation.reason;
                attemptLog.feedback = validation.message;
                if (validation.stage === 'SCHEMA') finalStatus = "SCHEMA_RECOVERY";
                else if (validation.reason === 'TARGET_COLLISION') finalStatus = "TARGET_COLLISION";
                else if (validation.reason === 'ANTI_CHEAT_FAILURE') finalStatus = "ANTI_CHEAT_FAILURE";
                else if (validation.reason === 'SEMANTIC_REJECTION') finalStatus = "SEMANTIC_RECOVERY";
                else finalStatus = "TARGET_RECOVERY";
            } else if (validation.isAbort) {
                console.log("⚠️ SAFE ABORT");
                attemptLog.gatekeeperResult = "ABORTED";
                finalStatus = "SAFE_ABORT";
                break; // Safe abort ends the loop
            } else {
                console.log("✅ GATEKEEPER ACCEPTED");
                attemptLog.gatekeeperResult = "ACCEPTED";
                
                const patchResult = applyPatch(parsed, targetFile, validation);
                if (patchResult.success) {
                    console.log("✅ PATCH APPLIED");
                    attemptLog.patchSuccess = true;
                    
                    // Static HTML & Build
                    console.log("Running Build (Syntax Check)...");
                    try {
                        execSync('npm run build', { stdio: 'ignore' });
                        console.log("✅ BUILD SUCCESS");
                        attemptLog.buildPass = true;
                    } catch (e) {
                        console.log("❌ BUILD FAILED");
                        attemptLog.buildPass = false;
                        break;
                    }
                    
                    // Playwright + Axe
                    console.log("Running REAL Playwright + Axe check...");
                    await page.reload();
                    await page.waitForSelector('.search-box');
                    const resultsPost = await new AxeBuilder({ page }).analyze();
                    
                    const postLabelViolation = resultsPost.violations.find(v => v.id === 'label');
                    if (!postLabelViolation) {
                        console.log("✅ TARGETED VIOLATION RESOLVED!");
                        attemptLog.targetedResolved = true;
                        success = true;
                        
                        // DOM Assertions
                        const inputHandle = await page.$('.search-input');
                        const ariaLabel = await inputHandle.getAttribute('aria-label');
                        const title = await inputHandle.getAttribute('title');
                        const placeholder = await inputHandle.getAttribute('placeholder');
                        const ariaLabelledby = await inputHandle.getAttribute('aria-labelledby');
                        
                        if (ariaLabel || title || placeholder) {
                            console.log("❌ ANTI_CHEAT_FAILURE: Single-node shortcut found in DOM!");
                            finalStatus = "ANTI_CHEAT_FAILURE";
                            success = false;
                        } else if (!ariaLabelledby) {
                            console.log("❌ FAILED: aria-labelledby not found on input in DOM!");
                            finalStatus = "FAILED";
                            success = false;
                        } else {
                            const referencedEl = await page.$(`#${ariaLabelledby}`);
                            if (!referencedEl) {
                                console.log("❌ FAILED: Referenced ID not found in DOM!");
                                finalStatus = "FAILED";
                                success = false;
                            } else {
                                finalStatus = "MULTI_NODE_RELATIONAL_SUCCESS";
                            }
                        }
                    } else {
                        console.log("❌ AXE UNRESOLVED (label rule still exists)");
                        attemptLog.targetedResolved = false;
                    }
                } else {
                    console.log(`❌ PATCH FAILED: ${patchResult.reason}`);
                    attemptLog.patchSuccess = false;
                }
            }
        }
        
        logs.attempts.push(attemptLog);
        attempt++;
    }

    logs.finalStatus = finalStatus;
    
    await browser.close();

    fs.writeFileSync('task14_raw_logs.json', JSON.stringify(logs, null, 2));
    console.log("\nFinished Task 14. Results saved to task14_raw_logs.json");
    
    fs.writeFileSync(targetFile, originalContent);
}

run().catch(console.error);

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { HtmlValidate } from 'html-validate';
import { validateProposal, applyPatch } from './pipeline_v3.js';
import http from 'http';

const htmlvalidator = new HtmlValidate({
  rules: {
    'require-lang': 'off',
    'button-type': 'off'
  }
});

async function runOllama(prompt) {
    const payload = {
        model: "qwen2.5-coder:7b",
        prompt: prompt,
        stream: false,
        temperature: 0.1
    };
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 11434,
            path: '/api/generate',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data).response));
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
    });
}

function parseMarkdownJson(text) {
    try {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) return JSON.parse(match[1]);
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

async function runStaticValidation(fileContent, componentCode) {
    let htmlLike = componentCode
        .replace(/className=/g, 'class=')
        .replace(/onClick=\{[^}]+\}/g, 'onclick="void(0)"')
        .replace(/<([a-zA-Z]+)([^>]*)>/g, '<$1$2>')
        .replace(/<\/[a-zA-Z]+>/g, (m) => m);
    
    htmlLike = `<!DOCTYPE html><html><head><title>Test</title></head><body>${htmlLike}</body></html>`;
    const report = await htmlvalidator.validateString(htmlLike);
    
    if (!report.valid) {
        return { valid: false, errors: report.results[0].messages.map(m => m.message) };
    }
    return { valid: true };
}

async function run() {
    console.log("Starting Task 13 Broken IDREF Recovery Experiment...");
    
    const logs = {
        attempts: [],
        baselineAxe: null,
        postAxe: null,
        metrics: {}
    };

    const targetFile = 'src/components/StructuralCases.tsx';
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    // Make sure we start fresh
    fs.writeFileSync(targetFile, originalContent);
    
    console.log("\n==================================================");
    console.log("BASELINE AXE-CORE");
    console.log("==================================================");

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log("Navigating to local dev server...");
    try {
        await page.goto('http://localhost:5173');
        await page.waitForSelector('.search-input', { timeout: 5000 });
    } catch (e) {
        console.error("Vite server not ready or component not rendered.", e);
        await browser.close();
        process.exit(1);
    }

    console.log("Running REAL axe-core...");
    const axeResults = await new AxeBuilder({ page }).analyze();
    const baselineViolations = axeResults.violations;
    logs.baselineAxe = baselineViolations;
    
    const baselineTargetRuleExists = baselineViolations.some(v => v.id === "label");
    
    if (!baselineTargetRuleExists) {
        console.log("❌ EXPERIMENT_INVALID: Expected baseline rule 'label' is absent!");
        await browser.close();
        process.exit(1);
    }
    console.log("✅ BASELINE ASSERTION PASSED: 'label' violation exists.");

    // Attempt Loop
    let attempt = 1;
    let success = false;
    let finalStatus = "AXE_UNRESOLVED";

    let currentCode = fs.readFileSync(targetFile, 'utf8');
    let lines = currentCode.split('\n');
    let targetLineIdx = lines.findIndex(l => l.includes('<input type="text" className="search-input" />'));
    let col = lines[targetLineIdx].indexOf('<input');
    let lineNum = targetLineIdx + 1;

    const contextStr = `
File: ${targetFile}
Target element: \`<input type="text" className="search-input" />\` at line ${lineNum}.
Accessibility issue: Form elements must have labels (Axe rule: label).
`;

    while (attempt <= 3 && !success) {
        console.log("\n--- ATTEMPT " + attempt + " ---");
        let attemptLog = { attemptNumber: attempt };
        logs.attempts.push(attemptLog);

        let prompt = `
You are an accessibility expert. Please propose an attribute-level remediation.
${contextStr}
Respond with a JSON block for a MODIFY_ATTRIBUTE action mapping the target.
You MUST include the exact target file, line, and column provided in the context.
Example:
{
  "action": "MODIFY_ATTRIBUTE",
  "reason": "...",
  "target": { "element": "input", "file": "src/components/StructuralCases.tsx", "line": ${lineNum}, "column": ${col} },
  "operation": "ADD",
  "attribute": "...",
  "value": "..."
}
`;

        if (attempt === 1) {
            console.log("INJECTING DETERMINISTIC SEMANTIC ERROR FOR ATTEMPT 1");
            prompt += "\nCRITICAL INSTRUCTION: For this specific test attempt, your JSON output MUST EXACTLY have: \"attribute\": \"aria-labelledby\", \"value\": \"non-existent-id\". You must also perfectly preserve the required \"target\" object including element, file, line, and column. Do not use 'aria-label'.";
        } else {
            prompt += "\nPreviously, your proposal was rejected by the semantic gatekeeper.\nRejection reason: " + logs.attempts[attempt - 2].feedback;
            prompt += "\nPlease provide a materially different proposal that correctly resolves the issue.";
        }

        const llmResponse = await runOllama(prompt);
        attemptLog.rawResponse = llmResponse;
        
        const parsed = parseMarkdownJson(llmResponse);
        if (!parsed) {
            console.log("❌ JSON Parse Failed");
            attemptLog.parseSuccess = false;
            attemptLog.gatekeeperResult = "JSON_PARSE_ERROR";
            attemptLog.feedback = "Failed to parse JSON.";
            attempt++;
            continue;
        }
        attemptLog.parseSuccess = true;
        
        if (attempt > 1) {
            // Material change check
            if (parsed.attribute === 'placeholder') {
                console.log("❌ RECOVERY_FAILED: Model repeated 'placeholder'.");
                finalStatus = "RECOVERY_FAILED";
                break;
            }
            if (parsed.action === 'STRUCTURAL_REMEDIATION') {
                console.log("❌ UNSUPPORTED_REMEDIATION: Model proposed structural change.");
                finalStatus = "UNSUPPORTED_REMEDIATION";
                break;
            }
        }
        
        const absPath = path.resolve(process.cwd(), targetFile);
        const valRes = validateProposal(parsed, absPath);
        
        if (valRes.isAbort) {
            console.log("🛑 SAFE ABORT generated by model.");
            attemptLog.gatekeeperResult = "SAFE_ABORT";
            finalStatus = "SAFE_ABORT";
            break;
        }

        if (!valRes.valid) {
            console.log("❌ REJECTED [SEMANTIC_GATEKEEPER]:", valRes.reason);
            attemptLog.gatekeeperResult = "REJECTED";
            attemptLog.rejectionReason = valRes.reason;
            attemptLog.feedback = valRes.message;
            attempt++;
            continue;
        }

        console.log("✅ GATEKEEPER ACCEPTED");
        attemptLog.gatekeeperResult = "ACCEPTED";
        
        const patchRes = applyPatch(parsed, absPath, valRes);
        if (!patchRes.success) {
            console.log("❌ PATCH FAILED");
            attemptLog.patchSuccess = false;
            finalStatus = "PATCH_FAILED";
            attempt++;
            continue;
        }
        attemptLog.patchSuccess = true;
        console.log("✅ PATCH APPLIED");

        // Static HTML validation
        console.log("Running Static HTML Validation...");
        const newCode = fs.readFileSync(targetFile, 'utf8');
        const compMatch = newCode.match(/export function CaseCInputMissingLabel[\\s\\S]*?return \\(\\s*([\\s\\S]*?)\\s*\\);/);
        const staticValid = await runStaticValidation(newCode, compMatch ? compMatch[1] : newCode);
        
        if (!staticValid.valid) {
            console.log("❌ STATIC HTML VALIDATION FAILED:", staticValid.errors);
            attemptLog.staticHtmlPass = false;
            finalStatus = "STATIC_HTML_FAILED";
            fs.writeFileSync(targetFile, originalContent);
            attempt++;
            continue;
        }
        console.log("✅ STATIC HTML VALIDATION PASSED");
        attemptLog.staticHtmlPass = true;
        
        // Build
        console.log("Running Build (Syntax Check)...");
        try {
            execSync('npx tsc --noEmit', { stdio: 'ignore' });
            console.log("✅ BUILD SUCCESS");
            attemptLog.buildPass = true;
        } catch(e) {
            console.log("❌ BUILD FAILED");
            attemptLog.buildPass = false;
            finalStatus = "BUILD_FAILED";
            fs.writeFileSync(targetFile, originalContent);
            attempt++;
            continue;
        }

        // Playwright + Axe
        console.log("Running REAL Playwright + Axe check...");
        await page.reload();
        await page.waitForSelector('.search-input', { timeout: 5000 });
        
        const newAxe = await new AxeBuilder({ page }).analyze();
        const postViolations = newAxe.violations;
        logs.postAxe = postViolations;
        
        const postPatchTargetRuleExists = postViolations.some(v => v.id === "label");
        
        if (!postPatchTargetRuleExists) {
            console.log("✅ TARGETED VIOLATION RESOLVED!");
            attemptLog.targetedResolved = true;
            success = true;
            finalStatus = "BROKEN_IDREF_RECOVERY_SUCCESS";
        } else {
            console.log("❌ AXE UNRESOLVED (label rule still exists)");
            attemptLog.targetedResolved = false;
            finalStatus = "AXE_UNRESOLVED";
            fs.writeFileSync(targetFile, originalContent);
            attempt++;
        }
    }

    if (!success && finalStatus !== "SAFE_ABORT" && finalStatus !== "RECOVERY_FAILED" && finalStatus !== "UNSUPPORTED_REMEDIATION") {
        if (attempt > 3) finalStatus = "REJECTED_MAX_ATTEMPTS";
    }
    
    logs.finalStatus = finalStatus;

    await browser.close();

    fs.writeFileSync('task13_raw_logs.json', JSON.stringify(logs, null, 2));
    console.log("\nFinished Task 13. Results saved to task13_raw_logs.json");
    
    // Cleanup
    fs.writeFileSync(targetFile, originalContent);
}

run().catch(console.error);

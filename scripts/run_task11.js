import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    // A simple static validation by checking the specific component string.
    // In a real scenario we might render it with react-dom/server or extract the JSX.
    // Here we run html-validate on the raw JSX string roughly mapped to HTML.
    let htmlLike = componentCode
        .replace(/className=/g, 'class=')
        .replace(/onClick=\{[^}]+\}/g, 'onclick="void(0)"')
        .replace(/<([a-zA-Z]+)([^>]*)>/g, '<$1$2>')
        .replace(/<\/[a-zA-Z]+>/g, (m) => m);
    
    // Quick and dirty html wrapper
    htmlLike = `<!DOCTYPE html><html><head><title>Test</title></head><body>${htmlLike}</body></html>`;
    const report = await htmlvalidator.validateString(htmlLike);
    
    // We are looking for content model errors (e.g. nested interactive controls, invalid button children).
    if (!report.valid) {
        return { valid: false, errors: report.results[0].messages.map(m => m.message) };
    }
    return { valid: true };
}

async function run() {
    console.log("Starting Task 11 Final Experiment...");
    
    const logs = {
        test1_2: { attempts: [] },
        test3: {},
        metrics: {}
    };

    const targetFile = 'src/components/StructuralCases.tsx';
    const originalContent = fs.readFileSync(targetFile, 'utf8');

    // Make sure we start fresh
    fs.writeFileSync(targetFile, originalContent);
    
    console.log("\\n==================================================");
    console.log("TEST 1 & 2: BASELINE + REAL REMEDIATION + AGENTIC RECOVERY");
    console.log("==================================================");

    // Baseline Playwright + Axe
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log("Navigating to local dev server...");
    try {
        await page.goto('http://localhost:5173');
        await page.waitForSelector('.search-bar', { timeout: 5000 });
    } catch (e) {
        console.error("Vite server not ready or component not rendered.", e);
        await browser.close();
        process.exit(1);
    }

    console.log("Running REAL axe-core...");
    const axeResults = await new AxeBuilder({ page }).analyze();
    const baselineViolations = axeResults.violations;
    const buttonNameViolation = baselineViolations.find(v => v.id === 'button-name' || (v.nodes && v.nodes.some(n => n.html.includes('btn'))));
    
    if (!buttonNameViolation) {
        console.log("No targeted violation found in baseline! Wait, 'div' used as button usually triggers 'button-name' or 'aria-roles'. Let's check violations:", baselineViolations.map(v => v.id));
        // Fallback: assume we know the target is the .btn div
    } else {
        console.log("Baseline Violation found:", buttonNameViolation.id);
    }
    logs.metrics.baselineAxeViolations = baselineViolations.length;
    
    // Attempt Loop
    let attempt = 1;
    let success = false;
    let finalStatus = "AXE_UNRESOLVED";

    // For Case B, the target is line 19
    let currentCode = fs.readFileSync(targetFile, 'utf8');
    let lineContent = currentCode.split('\n')[18];
    let col = lineContent.indexOf('<div');

    const contextStr = `
File: ${targetFile}
Target element: \`<div className="btn">\` at line 19.
Accessibility issue: This div is used as an interactive element but lacks proper button semantics.
`;

    while (attempt <= 3 && !success) {
        console.log("\\n--- ATTEMPT " + attempt + " ---");
        let attemptLog = { attemptNumber: attempt };
        logs.test1_2.attempts.push(attemptLog);

        let prompt = `
You are an accessibility expert. Please propose a structural remediation.
${contextStr}
Respond with a JSON block:
{
  "action": "STRUCTURAL_REMEDIATION",
  "reason": "...",
  "target": { "element": "div", "file": "src/components/StructuralCases.tsx", "line": 19, "column": ${col} },
  "operation": "REPLACE_TAG",
  "replacement": { "element": "button" }
}
`;

        if (attempt === 1) {
            console.log("INJECTING DETERMINISTIC REJECTION CONSTRAINT FOR ATTEMPT 1");
            prompt += "\nCRITICAL INSTRUCTION: For this specific test attempt, you are required to generate exactly: \"replacement\": { \"element\": \"div\" } in your JSON. Do not generate 'button'. You MUST generate 'div' to test the system's deterministic rejection.";
        } else {
            prompt += "\\nPreviously, your proposal was rejected by the gatekeeper.\\nRejection reason: " + logs.test1_2.attempts[attempt - 2].feedback;
            prompt += "\\nPlease provide a corrected proposal.";
        }

        const t0 = Date.now();
        const llmResponse = await runOllama(prompt);
        const t1 = Date.now();
        console.log("LLM generated response in", t1 - t0, "ms");
        
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
        
        const absPath = path.resolve(process.cwd(), targetFile);
        const valRes = validateProposal(parsed, absPath);
        
        if (valRes.isAbort) {
            console.log("🛑 SAFE ABORT generated by model.");
            attemptLog.gatekeeperResult = "SAFE_ABORT";
            finalStatus = "SAFE_ABORT";
            break;
        }

        if (!valRes.valid) {
            console.log("❌ REJECTED [GATEKEEPER]:", valRes.reason);
            attemptLog.gatekeeperResult = "REJECTED";
            attemptLog.rejectionReason = valRes.reason;
            attemptLog.feedback = "REJECTED: " + valRes.reason;
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
        // Extract CaseB component roughly
        const compMatch = newCode.match(/export function CaseBInteractiveDiv[\s\S]*?return \(\s*([\s\S]*?)\s*\);/);
        const staticValid = await runStaticValidation(newCode, compMatch ? compMatch[1] : newCode);
        
        if (!staticValid.valid) {
            console.log("❌ STATIC HTML VALIDATION FAILED:", staticValid.errors);
            attemptLog.staticHtmlPass = false;
            finalStatus = "STATIC_HTML_FAILED";
            // Revert patch
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
        await page.waitForSelector('.search-bar', { timeout: 5000 });
        
        const newAxe = await new AxeBuilder({ page }).analyze();
        const postViolations = newAxe.violations;
        logs.metrics.postAxeViolations = postViolations.length;
        
        const targetViolationResolved = !postViolations.find(v => v.id === 'button-name' || (v.nodes && v.nodes.some(n => n.html.includes('btn'))));
        
        if (targetViolationResolved) {
            console.log("✅ TARGETED VIOLATION RESOLVED!");
            attemptLog.targetedResolved = true;
            success = true;
            finalStatus = "SUCCESS_REMEDIATED";
        } else {
            console.log("❌ AXE UNRESOLVED");
            attemptLog.targetedResolved = false;
            finalStatus = "AXE_UNRESOLVED";
            attempt++;
        }
    }

    if (!success && finalStatus !== "SAFE_ABORT") {
        if (attempt > 3) finalStatus = "REJECTED_MAX_ATTEMPTS";
    }
    
    logs.test1_2.finalStatus = finalStatus;

    console.log("\\n==================================================");
    console.log("TEST 3: INDEPENDENT SECURITY TEST");
    console.log("==================================================");

    // Reset source
    fs.writeFileSync(targetFile, originalContent);

    const maliciousProposal = {
        action: "STRUCTURAL_REMEDIATION",
        target: {
            element: "div",
            file: "src/components/StructuralCases.tsx",
            line: 19,
            column: col
        },
        operation: "REPLACE_TAG",
        replacement: {
            element: "script"
        }
    };

    const securityValRes = validateProposal(maliciousProposal, path.resolve(process.cwd(), targetFile));
    
    logs.test3.gatekeeperResult = securityValRes.valid ? "ACCEPTED" : "REJECTED";
    logs.test3.rejectionReason = securityValRes.reason;
    
    const sourceAfterSecurity = fs.readFileSync(targetFile, 'utf8');
    logs.test3.sourceUnchanged = sourceAfterSecurity === originalContent;
    logs.test3.finalStatus = (!securityValRes.valid && logs.test3.sourceUnchanged) ? "SECURITY_REJECTED" : "SECURITY_FAILED";

    if (logs.test3.finalStatus === "SECURITY_REJECTED") {
        console.log("✅ SECURITY REJECTED (as expected). Reason:", securityValRes.reason);
    } else {
        console.log("❌ SECURITY TEST FAILED");
    }

    await browser.close();

    fs.writeFileSync('task11_raw_logs.json', JSON.stringify(logs, null, 2));
    console.log("\\nFinished Task 11. Results saved to task11_raw_logs.json");
    
    // Cleanup
    fs.writeFileSync(targetFile, originalContent);
}

run().catch(console.error);

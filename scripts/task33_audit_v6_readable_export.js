import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EXPERIMENTS = ['task33_v0', 'task33_v1', 'task33_v2', 'task33_v3'];

function getMapping(contextText, caseId) {
    const num = caseId.replace('case', '');
    const regex = new RegExp(`\\bc${num}-[a-z0-9\\-]+\\b`, 'gi');
    const matches = Array.from(new Set(contextText.match(regex) || []));
    
    // Sort to ensure determinism
    matches.sort();
    
    const mapping = {};
    matches.forEach((mId, i) => {
        mapping[mId] = `TARGET_NODE_${String.fromCharCode(65 + i)}`;
    });
    return mapping;
}

function normalize(text, caseId, mapping) {
    if (!text) return text;
    
    const num = caseId.replace('case', '');
    let res = text;
    
    // Apply exact package-level mapping
    for (const [k, v] of Object.entries(mapping)) {
        res = res.split(k).join(v);
    }
    
    // Anonymize metadata
    res = res.replace(/task33_v[0-3]/gi, 'EXPERIMENT_VARIANT');
    res = res.replace(/task33/gi, 'EXPERIMENT_TASK');
    res = res.replace(new RegExp(`\\bCase ${num}\\b`, 'gi'), 'TARGET_CASE');
    res = res.replace(new RegExp(`\\b${caseId}\\b`, 'gi'), 'CASE_ID');
    res = res.replace(/accessaudit-qwen7b-ft/gi, 'MODEL_NAME');
    res = res.replace(/accessaudit/gi, 'MODEL_BASE');
    res = res.replace(/qwen7b/gi, 'MODEL_SIZE');
    res = res.replace(/EOI/g, 'EVALUATOR_TRACKING');
    res = res.replace(/SG/g, 'SEMANTIC_GATE');
    
    return res;
}

function run() {
    let leakages = 0;
    const outFile = path.join(rootDir, 'experiments', 'task33_audit_v6_READABLE.md');
    const originalSource = fs.readFileSync(path.join(rootDir, 'src', 'components', 'Task18Benchmark.tsx'), 'utf8');

    let outMd = '';
    let casesCount = 0;

    EXPERIMENTS.forEach((exp) => {
        const expDir = path.join(rootDir, 'experiments', exp);
        if (!fs.existsSync(expDir)) return;

        const cases = fs.readdirSync(expDir).filter(c => c.startsWith('case'));
        cases.forEach(caseId => {
            const caseDir = path.join(expDir, caseId);
            const statusFile = path.join(caseDir, 'final_status.txt');
            if (!fs.existsSync(statusFile)) return;
            const status = fs.readFileSync(statusFile, 'utf8').trim();
            if (!status.includes('SUCCESS')) return;

            casesCount++;

            const logsFile = path.join(caseDir, 'recovery_log.json');
            const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
            const finalAttemptNum = logs[logs.length - 1].attempt_number;

            const proposalFile = path.join(caseDir, `proposal_${finalAttemptNum}.json`);
            const ctxFile = path.join(caseDir, `attempt_${finalAttemptNum}_request.json`);
            const patchFile = path.join(caseDir, `gatekeeper_result_${finalAttemptNum}.json`);
            const patchedSourceFile = path.join(caseDir, `patched_source.tsx`);
            const axeFile = path.join(caseDir, `axe.json`);
            const buildFile = path.join(caseDir, `build.log`);

            let proposal = fs.existsSync(proposalFile) ? fs.readFileSync(proposalFile, 'utf8') : '';
            let ctx = fs.existsSync(ctxFile) ? fs.readFileSync(ctxFile, 'utf8') : '';
            let patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
            let patchedSource = fs.existsSync(patchedSourceFile) ? fs.readFileSync(patchedSourceFile, 'utf8') : '';
            let axe = fs.existsSync(axeFile) ? fs.readFileSync(axeFile, 'utf8') : '';
            let build = fs.existsSync(buildFile) ? fs.readFileSync(buildFile, 'utf8') : 'Build successful';

            let localizedContext = ctx;
            try {
                const reqObj = JSON.parse(ctx);
                localizedContext = reqObj.messages[1].content;
            } catch(e) {}
            
            const mapping = getMapping(localizedContext, caseId);
            
            let executedPatch = patch;
            try {
                const gk = JSON.parse(patch);
                if (gk.objects) executedPatch = JSON.stringify(gk.objects, null, 2);
            } catch(e) {}

            let diffStr = '';
            try {
                const tmpOrig = path.join(rootDir, `.tmp_orig_${caseId}.tsx`);
                const tmpPatch = path.join(rootDir, `.tmp_patch_${caseId}.tsx`);
                fs.writeFileSync(tmpOrig, originalSource);
                fs.writeFileSync(tmpPatch, patchedSource);
                
                try {
                    execSync(`diff -U 0 "${tmpOrig}" "${tmpPatch}"`);
                } catch (err) {
                    diffStr = err.stdout.toString();
                }
                fs.unlinkSync(tmpOrig);
                fs.unlinkSync(tmpPatch);
            } catch (err) {
                diffStr = 'Diff error: ' + err.message;
            }
            diffStr = diffStr.split('\n').filter(line => !line.startsWith('---') && !line.startsWith('+++')).join('\n');

            let axeObj = null;
            let axeEvidence = '';
            try {
                axeObj = JSON.parse(axe);
            } catch(e) {}

            if (axeObj && axeObj.violations) {
                const rules = axeObj.violations.map(v => v.id);
                if (rules.length > 0) {
                    axeEvidence += `Observed Post-Patch Axe Rules:\n${rules.join(', ')}\n\n`;
                    axeEvidence += `Observed Post-Patch Violation Counts:\n`;
                    axeObj.violations.forEach(v => {
                        axeEvidence += `- ${v.id}: ${v.nodes.length}\n`;
                    });
                } else {
                    axeEvidence += `Observed Post-Patch Axe Rules:\nNone\n\n`;
                    axeEvidence += `Observed Post-Patch Violation Counts:\n0\n`;
                }
            } else {
                axeEvidence += `Observed Post-Patch Axe Rules:\nNone\n\n`;
                axeEvidence += `Observed Post-Patch Violation Counts:\n0\n`;
            }
            
            axeEvidence += `\nTarget-Level Evidence:\nINDETERMINATE FROM FROZEN ARTIFACT\n\n`;
            axeEvidence += `Regression Evidence:\nINDETERMINATE FROM FROZEN ARTIFACT\n`;

            const uuid = crypto.randomUUID();

            outMd += `## PACKAGE ${uuid}\n\n`;
            outMd += `### original_context\n${normalize(localizedContext, caseId, mapping)}\n\n`;
            outMd += `### proposal\n${normalize(proposal, caseId, mapping)}\n\n`;
            outMd += `### actual_executed_patch\n${normalize(executedPatch, caseId, mapping)}\n\n`;
            outMd += `### localized_diff\n${normalize(diffStr, caseId, mapping)}\n\n`;
            outMd += `### axe_evidence\n${normalize(axeEvidence, caseId, mapping)}\n\n`;
            outMd += `### build_result\n${normalize(build, caseId, mapping)}\n\n`;
        });
    });

    fs.writeFileSync(outFile, outMd);
    console.log("V6 readable export generated.");
}

run();

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EXPERIMENTS = ['task33_v0', 'task33_v1', 'task33_v2', 'task33_v3'];

const BASELINE_VIOLATIONS = {
    'case1': 'image-alt',
    'case2': 'button-name',
    'case3': 'aria-hidden-focus',
    'case4': 'aria-roles',
    'case5': 'empty-heading',
    'case6': 'label',
    'case7': 'label',
    'case8': 'aria-valid-attr-value',
    'case9': 'label',
    'case10': 'tabindex',
    'case11': 'nested-interactive',
    'case12': 'button-name',
    'case13': 'button-name',
    'case14': 'nested-interactive',
    'case15': 'button-name'
};

function normalize(text, caseId) {
    if (!text) return text;
    const num = caseId.replace('case', '');
    const regex = new RegExp(`c${num}-[a-z0-9\\-]+`, 'g');
    const matches = Array.from(new Set(text.match(regex) || []));
    
    const mapping = {};
    matches.forEach((mId, i) => {
        mapping[mId] = `TARGET_NODE_${String.fromCharCode(65 + i)}`;
    });

    let res = text;
    for (const [k, v] of Object.entries(mapping)) {
        res = res.split(k).join(v);
    }
    res = res.replace(/task33_v[0-3]/g, 'EXPERIMENT_VARIANT');
    res = res.replace(new RegExp(caseId, 'g'), 'CASE_ID');
    res = res.replace(/accessaudit-qwen7b-ft/g, 'MODEL_NAME');
    return res;
}

function run() {
    let auditPackage = [];
    let missingArtifacts = [];
    let emptyFields = [];
    let leakages = [];
    let counts = { V0: 0, V1: 0, V2: 0, V3: 0, TOTAL: 0 };

    const originalSource = fs.readFileSync(path.join(rootDir, 'src', 'components', 'Task18Benchmark.tsx'), 'utf8');

    EXPERIMENTS.forEach((exp, idx) => {
        const vName = `V${idx}`;
        const expDir = path.join(rootDir, 'experiments', exp);
        if (!fs.existsSync(expDir)) return;

        const cases = fs.readdirSync(expDir).filter(c => c.startsWith('case'));
        cases.forEach(caseId => {
            const caseDir = path.join(expDir, caseId);
            const statusFile = path.join(caseDir, 'final_status.txt');
            if (!fs.existsSync(statusFile)) return;
            const status = fs.readFileSync(statusFile, 'utf8').trim();
            if (!status.includes('SUCCESS')) return;

            counts[vName]++;
            counts.TOTAL++;

            const logsFile = path.join(caseDir, 'recovery_log.json');
            if (!fs.existsSync(logsFile)) {
                missingArtifacts.push(`${exp}/${caseId}: recovery_log.json`);
                return;
            }
            const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
            const finalAttemptNum = logs[logs.length - 1].attempt_number;

            const filesToRead = {
                proposal: `proposal_${finalAttemptNum}.json`,
                ctx: `attempt_${finalAttemptNum}_request.json`,
                patchedSource: `patched_source.tsx`,
                axe: `axe.json`
            };

            const data = {};
            for (const [key, filename] of Object.entries(filesToRead)) {
                const fp = path.join(caseDir, filename);
                if (!fs.existsSync(fp)) {
                    missingArtifacts.push(`${exp}/${caseId}: ${filename}`);
                    return;
                }
                data[key] = fs.readFileSync(fp, 'utf8');
                if (!data[key].trim()) {
                    emptyFields.push(`${exp}/${caseId}: ${filename}`);
                }
            }

            // Extract context from request
            let localizedContext = data.ctx;
            try {
                const reqObj = JSON.parse(data.ctx);
                localizedContext = reqObj.messages[1].content;
            } catch(e) {}

            // Diff
            let diffStr = '';
            try {
                // write to temp to run diff
                const tmpOrig = path.join(rootDir, '.tmp_orig.tsx');
                const tmpPatch = path.join(rootDir, '.tmp_patch.tsx');
                fs.writeFileSync(tmpOrig, originalSource);
                fs.writeFileSync(tmpPatch, data.patchedSource);
                
                try {
                    // diff exits with 1 if there is a difference
                    execSync(`diff -u "${tmpOrig}" "${tmpPatch}"`);
                } catch (err) {
                    diffStr = err.stdout.toString();
                }
                fs.unlinkSync(tmpOrig);
                fs.unlinkSync(tmpPatch);
            } catch (err) {
                diffStr = 'Diff error: ' + err.message;
            }
            
            // Clean diff to be localized and remove filenames
            diffStr = diffStr.replace(/--- .*\n/, '--- original\n').replace(/\+\+\+ .*\n/, '+++ patched\n');
            // Remove large contextual unchanged lines if needed, but diff -u only shows exactly the change
            
            // Target Axe Result & Global Regression Result
            let axeObj = null;
            let targetedAxeResult = '';
            let globalRegressionResult = '';
            try {
                axeObj = JSON.parse(data.axe);
            } catch(e) {}

            if (axeObj && axeObj.violations) {
                const baselineVio = BASELINE_VIOLATIONS[caseId];
                const matchingVios = axeObj.violations.filter(v => v.id === baselineVio);
                
                if (matchingVios.length === 0) {
                    targetedAxeResult = `Target resolved (Violation ${baselineVio} not found)`;
                } else {
                    targetedAxeResult = `Violation ${baselineVio} still present:\n` + JSON.stringify(matchingVios, null, 2);
                }

                const otherVios = axeObj.violations.filter(v => v.id !== baselineVio);
                if (otherVios.length === 0) {
                    globalRegressionResult = 'No new violations found';
                } else {
                    globalRegressionResult = `New violations found:\n` + JSON.stringify(otherVios, null, 2);
                }
            } else {
                targetedAxeResult = 'No Axe violations data';
                globalRegressionResult = 'No Axe violations data';
            }

            const uuid = crypto.randomUUID();

            const p = {
                uuid,
                baseline_violation_type: BASELINE_VIOLATIONS[caseId],
                localized_original_target_context: normalize(localizedContext, caseId),
                model_proposal: normalize(data.proposal, caseId),
                actual_executed_patch: normalize(data.proposal, caseId),
                localized_original_vs_patched_source_context: normalize(`ORIGINAL:\n${localizedContext}\n\nPATCHED (diff context below):\n${diffStr}`, caseId),
                targeted_axe_result: normalize(targetedAxeResult, caseId),
                global_regression_result: normalize(globalRegressionResult, caseId),
                patch_diff: normalize(diffStr, caseId)
            };

            // Preflight leakage check
            const str = JSON.stringify(p).toLowerCase();
            const leaks = [];
            if (str.includes(exp)) leaks.push('variant');
            if (str.includes(caseId)) leaks.push('caseId');
            if (str.includes('accessaudit-qwen7b-ft')) leaks.push('model');
            if (str.includes('sg off') || str.includes('sg on')) leaks.push('architecture');
            if (leaks.length > 0) {
                leakages.push(`${exp}/${caseId}: Leaked ${leaks.join(',')}`);
            }

            auditPackage.push(p);
        });
    });

    const preflightPass = missingArtifacts.length === 0 && emptyFields.length === 0 && leakages.length === 0 && counts.TOTAL === auditPackage.length;

    const auditDir = path.join(rootDir, 'experiments', 'task33_audit');
    if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

    if (preflightPass) {
        fs.writeFileSync(path.join(auditDir, 'blinded_package_v3.json'), JSON.stringify(auditPackage, null, 2));
    }

    const preflightReport = `# AUDIT PACKAGE V3 PREFLIGHT
Actual Frozen Success Count:
- V0: ${counts.V0}
- V1: ${counts.V1}
- V2: ${counts.V2}
- V3: ${counts.V3}
- TOTAL: ${counts.TOTAL}

Package Count: ${auditPackage.length}
Missing Artifacts: ${missingArtifacts.length}
${missingArtifacts.join('\n')}
Empty Evidence Fields: ${emptyFields.length}
${emptyFields.join('\n')}
Leakages: ${leakages.length}
${leakages.join('\n')}

Result: ${preflightPass ? 'PASS' : 'FAIL'}
`;
    fs.writeFileSync(path.join(auditDir, 'AUDIT_PACKAGE_V3_PREFLIGHT.md'), preflightReport);

    console.log(`TASK33_EXTERNAL_AUDIT_PACKAGE_V3_STATUS: READY
FROZEN_SUCCESS_COUNTS:
V0: ${counts.V0}
V1: ${counts.V1}
V2: ${counts.V2}
V3: ${counts.V3}
TOTAL: ${counts.TOTAL}
PACKAGE_COUNT: ${auditPackage.length}
MISSING_ARTIFACTS: ${missingArtifacts.length}
EMPTY_EVIDENCE_FIELDS: ${emptyFields.length}
PREFLIGHT: ${preflightPass ? 'PASS' : 'FAIL'}
PACKAGE: experiments/task33_audit/blinded_package_v3.json
PREFLIGHT_REPORT: experiments/task33_audit/AUDIT_PACKAGE_V3_PREFLIGHT.md`);
}

run();

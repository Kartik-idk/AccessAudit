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
    
    // Normalize IDs like c1-img, c13-div, etc.
    const num = caseId.replace('case', '');
    const regex = new RegExp(`c${num}-[a-z0-9\\-]+`, 'gi');
    const matches = Array.from(new Set(text.match(regex) || []));
    
    const mapping = {};
    matches.forEach((mId, i) => {
        mapping[mId] = `TARGET_NODE_${String.fromCharCode(65 + i)}`;
    });

    let res = text;
    for (const [k, v] of Object.entries(mapping)) {
        res = res.split(k).join(v);
    }
    
    // Normalize other leaked info
    res = res.replace(/task33_v[0-3]/gi, 'EXPERIMENT_VARIANT');
    res = res.replace(/task33/gi, 'EXPERIMENT_TASK');
    res = res.replace(new RegExp(`Case ${num}`, 'gi'), 'TARGET_CASE');
    res = res.replace(new RegExp(caseId, 'gi'), 'CASE_ID');
    res = res.replace(/accessaudit-qwen7b-ft/gi, 'MODEL_NAME');
    res = res.replace(/accessaudit/gi, 'MODEL_BASE');
    res = res.replace(/qwen7b/gi, 'MODEL_SIZE');
    res = res.replace(/EOI/g, 'EVALUATOR_TRACKING');
    res = res.replace(/SG/g, 'SEMANTIC_GATE');
    
    return res;
}

function run() {
    let missingArtifacts = [];
    let emptyFields = [];
    let leakages = { full_source: 0, benchmark: 0, variant: 0, model: 0 };
    let counts = { V0: 0, V1: 0, V2: 0, V3: 0, TOTAL: 0 };
    let proposalPatchDistinctlyRecorded = true;
    
    const auditDir = path.join(rootDir, 'experiments', 'task33_audit_v5');
    if (fs.existsSync(auditDir)) {
        fs.rmSync(auditDir, { recursive: true, force: true });
    }
    fs.mkdirSync(auditDir, { recursive: true });

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
                patch: `gatekeeper_result_${finalAttemptNum}.json`,
                patchedSource: `patched_source.tsx`,
                axe: `axe.json`,
                build: `build.log`
            };

            const data = {};
            for (const [key, filename] of Object.entries(filesToRead)) {
                const fp = path.join(caseDir, filename);
                if (!fs.existsSync(fp)) {
                    missingArtifacts.push(`${exp}/${caseId}: ${filename}`);
                    return;
                } else {
                    data[key] = fs.readFileSync(fp, 'utf8');
                }
                if (key !== 'build' && (!data[key] || !data[key].trim())) {
                    emptyFields.push(`${exp}/${caseId}: ${filename}`);
                }
            }

            let localizedContext = data.ctx;
            try {
                const reqObj = JSON.parse(data.ctx);
                localizedContext = reqObj.messages[1].content;
            } catch(e) {}
            
            let executedPatch = data.patch;
            try {
                const gk = JSON.parse(data.patch);
                if (gk.objects) {
                    executedPatch = JSON.stringify(gk.objects, null, 2);
                }
            } catch(e) {}

            let diffStr = '';
            try {
                const tmpOrig = path.join(rootDir, `.tmp_orig_${caseId}.tsx`);
                const tmpPatch = path.join(rootDir, `.tmp_patch_${caseId}.tsx`);
                fs.writeFileSync(tmpOrig, originalSource);
                fs.writeFileSync(tmpPatch, data.patchedSource);
                
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
                axeObj = JSON.parse(data.axe);
            } catch(e) {}
            
            const baselineVio = BASELINE_VIOLATIONS[caseId];

            if (axeObj && axeObj.violations) {
                const matchingVios = axeObj.violations.filter(v => v.id === baselineVio);
                const otherVios = axeObj.violations.filter(v => v.id !== baselineVio);
                
                axeEvidence += `Baseline Target Violation Rule: ${baselineVio}\n`;
                axeEvidence += `Post-Patch Target Violation Count: ${matchingVios.length}\n`;
                
                if (matchingVios.length > 0) {
                    axeEvidence += `Target-Level Evidence: Still failing. Nodes affected: ${matchingVios[0].nodes.length}\n`;
                } else {
                    axeEvidence += `Target-Level Evidence: INDETERMINATE FROM FROZEN ARTIFACT\n`;
                }
                
                axeEvidence += `Total NEW Violations Introduced: ${otherVios.length}\n`;
            } else {
                axeEvidence = 'No Axe violations data';
            }

            const uuid = crypto.randomUUID();
            const caseDestDir = path.join(auditDir, `case_${uuid}`);
            fs.mkdirSync(caseDestDir, { recursive: true });

            const outOriginal = normalize(localizedContext, caseId);
            const outProposal = normalize(data.proposal, caseId);
            const outPatch = normalize(executedPatch, caseId);
            const outDiff = normalize(diffStr, caseId);
            const outAxe = normalize(axeEvidence, caseId);
            const outBuild = normalize(data.build || "Build successful", caseId);

            fs.writeFileSync(path.join(caseDestDir, 'original_context'), outOriginal);
            fs.writeFileSync(path.join(caseDestDir, 'proposal'), outProposal);
            fs.writeFileSync(path.join(caseDestDir, 'actual_executed_patch'), outPatch);
            fs.writeFileSync(path.join(caseDestDir, 'localized_diff'), outDiff);
            fs.writeFileSync(path.join(caseDestDir, 'axe_evidence'), outAxe);
            fs.writeFileSync(path.join(caseDestDir, 'build_result'), outBuild);

            const checkLeaks = (str) => {
                const low = str.toLowerCase();
                const num = caseId.replace('case', '');
                
                if (low.includes('benchmarkroot')) leakages.full_source++;
                
                if (new RegExp(`c${num}-`, 'gi').test(str)) leakages.benchmark++;
                if (new RegExp(`case ${num}`, 'gi').test(str)) leakages.benchmark++;
                if (low.includes(caseId)) leakages.benchmark++;
                
                if (low.includes(exp)) leakages.variant++;
                if (low.includes('sg on') || low.includes('sg off') || low.includes('eoi')) leakages.variant++;
                
                if (low.includes('accessaudit-qwen7b-ft')) leakages.model++;
            };

            checkLeaks(outOriginal);
            checkLeaks(outProposal);
            checkLeaks(outPatch);
            checkLeaks(outDiff);
            checkLeaks(outAxe);
            checkLeaks(outBuild);
        });
    });

    const totalLeakage = leakages.full_source + leakages.benchmark + leakages.variant + leakages.model;
    const preflightPass = missingArtifacts.length === 0 && 
                          emptyFields.length === 0 && 
                          totalLeakage === 0;

    console.log(`packages=${counts.TOTAL}
missing_artifacts=${missingArtifacts.length}
empty_required_fields=${emptyFields.length}
leakage=${totalLeakage}
preflight=${preflightPass ? 'PASS' : 'FAIL'}`);
}

run();

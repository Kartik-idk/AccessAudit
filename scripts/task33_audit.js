import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EXPERIMENTS = ['task33_v0', 'task33_v1', 'task33_v2', 'task33_v3'];

function scrubIdentifiers(text) {
    if (!text) return text;
    return text.replace(/c\d+-[a-z0-9\-]+/g, 'target-node');
}

function prepareAudit() {
    const auditDir = path.join(rootDir, 'experiments', 'task33_audit');
    if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

    let auditPackage = [];
    let auditKey = [];

    EXPERIMENTS.forEach(exp => {
        const expDir = path.join(rootDir, 'experiments', exp);
        if (!fs.existsSync(expDir)) return;

        const cases = fs.readdirSync(expDir);
        cases.forEach(caseId => {
            const caseDir = path.join(expDir, caseId);
            const statusFile = path.join(caseDir, 'final_status.txt');
            if (!fs.existsSync(statusFile)) return;
            const status = fs.readFileSync(statusFile, 'utf8').trim();
            if (!status.includes('SUCCESS')) return; // only audit successes

            const logsFile = path.join(caseDir, 'recovery_log.json');
            if (!fs.existsSync(logsFile)) return;
            const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
            const finalAttemptNum = logs[logs.length - 1].attempt_number;

            const proposalFile = path.join(caseDir, `attempt_${finalAttemptNum}_proposal.json`);
            let proposal = '';
            if (fs.existsSync(proposalFile)) {
                proposal = fs.readFileSync(proposalFile, 'utf8');
            }

            const ctxFile = path.join(caseDir, `attempt_${finalAttemptNum}_context.txt`);
            let ctx = '';
            if (fs.existsSync(ctxFile)) {
                ctx = fs.readFileSync(ctxFile, 'utf8');
            }

            const patchFile = path.join(caseDir, `attempt_${finalAttemptNum}_patch.json`);
            let patch = '';
            if (fs.existsSync(patchFile)) {
                patch = fs.readFileSync(patchFile, 'utf8');
            }
            
            const origSourceFile = path.join(caseDir, `attempt_${finalAttemptNum}_original_source.tsx`);
            const patchedSourceFile = path.join(caseDir, `attempt_${finalAttemptNum}_patched_source.tsx`);
            let diff = '';
            if (fs.existsSync(origSourceFile) && fs.existsSync(patchedSourceFile)) {
                // simple diff extraction
                diff = `Original and patched sources exist.`;
            }

            const uuid = crypto.randomUUID();

            auditPackage.push({
                uuid,
                originalContext: scrubIdentifiers(ctx),
                patchProposal: scrubIdentifiers(proposal),
                patchExecuted: scrubIdentifiers(patch)
            });

            auditKey.push({
                uuid,
                variant: exp,
                case: caseId,
                attempt: finalAttemptNum
            });
        });
    });

    fs.writeFileSync(path.join(auditDir, 'blinded_package.json'), JSON.stringify(auditPackage, null, 2));
    fs.writeFileSync(path.join(auditDir, 'audit_key.json'), JSON.stringify(auditKey, null, 2));

    console.log(`Audit package prepared at experiments/task33_audit/`);
}

const args = process.argv.slice(2);
if (args[0] === 'prepare') {
    prepareAudit();
} else {
    console.log('Usage: node scripts/task33_audit.js prepare');
}

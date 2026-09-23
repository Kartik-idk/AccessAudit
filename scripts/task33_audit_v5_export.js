import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const auditDir = path.join(rootDir, 'experiments', 'task33_audit_v5');

function run() {
    let leakages = 0;
    
    if (!fs.existsSync(auditDir)) {
        console.error("auditDir not found");
        process.exit(1);
    }
    
    const cases = fs.readdirSync(auditDir).filter(c => c.startsWith('case_'));
    let totalFiles = 0;
    
    cases.forEach(c => {
        const cPath = path.join(auditDir, c);
        const files = fs.readdirSync(cPath);
        totalFiles += files.length;
        
        files.forEach(f => {
            const content = fs.readFileSync(path.join(cPath, f), 'utf8');
            const low = content.toLowerCase();
            
            // Re-run V5 leakage check
            if (low.includes('benchmarkroot')) leakages++;
            
            // Check for benchmark IDs c1- to c15-
            for (let i = 1; i <= 15; i++) {
                if (new RegExp(`c${i}-`, 'gi').test(content)) leakages++;
                if (new RegExp(`case ${i}`, 'gi').test(content)) leakages++;
                if (low.includes(`case${i}`)) leakages++;
            }
            
            if (low.includes('task33_v0') || low.includes('task33_v1') || low.includes('task33_v2') || low.includes('task33_v3')) leakages++;
            if (low.includes('sg on') || low.includes('sg off') || low.includes('eoi')) leakages++;
            if (low.includes('accessaudit-qwen7b-ft')) leakages++;
        });
    });
    
    const preflight = (cases.length === 27 && leakages === 0) ? 'PASS' : 'FAIL';
    
    if (preflight === 'PASS') {
        execSync(`cd experiments && zip -r task33_audit_v5.zip task33_audit_v5/`);
    }
    
    console.log(`archive_path=experiments/task33_audit_v5.zip
packages=${cases.length}
files=${totalFiles}
leakage=${leakages}
preflight=${preflight}`);
}

run();

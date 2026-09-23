import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(process.cwd());
const readableFile = path.join(rootDir, 'experiments', 'task33_audit_v6_READABLE.md');
const content = fs.readFileSync(readableFile, 'utf8');

const packages = content.split('## PACKAGE ').slice(1);

let results = [];
let consistentCount = 0;
let inconsistentCount = 0;

let leakages = 0;
const low = content.toLowerCase();

if (low.includes('benchmarkroot')) leakages++;

for (let i = 1; i <= 15; i++) {
    if (new RegExp(`\\bc${i}-`, 'gi').test(content)) leakages++;
    if (new RegExp(`case ${i}\\b`, 'gi').test(content)) leakages++;
    if (new RegExp(`\\bcase${i}\\b`, 'gi').test(content)) leakages++;
}

if (low.includes('task33_v0') || low.includes('task33_v1') || low.includes('task33_v2') || low.includes('task33_v3')) leakages++;
if (low.includes('sg on') || low.includes('sg off') || low.includes('eoi')) leakages++;
if (low.includes('accessaudit-qwen7b-ft')) leakages++;


packages.forEach(pkgStr => {
    const lines = pkgStr.split('\n');
    const uuid = lines[0].trim();
    
    const getSection = (name) => {
        const header = `### ${name}`;
        const start = pkgStr.indexOf(header);
        if (start === -1) return '';
        const end = pkgStr.indexOf('### ', start + header.length);
        const section = pkgStr.substring(start + header.length, end === -1 ? pkgStr.length : end).trim();
        return section;
    };

    const propStr = getSection('proposal');
    const patchStr = getSection('actual_executed_patch');
    const diffStr = getSection('localized_diff');

    let isPropPatchConsistent = true;
    let isPatchDiffConsistent = true;
    let differingFields = [];
    
    let propObj = null, patchObj = null;
    try { propObj = JSON.parse(propStr); } catch(e) {}
    try { patchObj = JSON.parse(patchStr); } catch(e) {}

    const serializeOps = (obj) => {
        let ops = [];
        if (Array.isArray(obj)) ops = obj;
        else if (obj && obj.operations) ops = obj.operations;
        else if (obj && obj.action) ops = [obj];
        return ops.map(op => ({
            attribute: op.attribute || null,
            value: op.value || null,
            operation: op.operation || null
        }));
    };

    const propFlat = serializeOps(propObj);
    const patchFlat = serializeOps(patchObj);

    if (JSON.stringify(propFlat) !== JSON.stringify(patchFlat)) {
        isPropPatchConsistent = false;
        differingFields.push('proposal_operations_vs_patch_operations');
    }

    patchFlat.forEach(op => {
        if ((op.operation === 'ADD' || op.operation === 'UPDATE') && typeof op.value === 'string') {
            if (op.value.includes('TARGET_NODE_')) {
                const assignedVal = op.value;
                const attr = op.attribute;
                
                const addedLines = diffStr.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join(' ');
                
                const regex = new RegExp(`${attr}=["']?(TARGET_NODE_[A-Z])["']?`, 'i');
                const match = addedLines.match(regex);
                
                if (match) {
                    const diffVal = match[1];
                    if (diffVal !== assignedVal) {
                        isPatchDiffConsistent = false;
                        differingFields.push(`patch_assigned_${assignedVal}_but_diff_shows_${diffVal}`);
                    }
                } else if (!addedLines.includes(assignedVal)) {
                    isPatchDiffConsistent = false;
                    differingFields.push(`diff_missing_assigned_value_${assignedVal}`);
                }
            }
        }
    });

    const isConsistent = isPropPatchConsistent && isPatchDiffConsistent;
    if (isConsistent) consistentCount++;
    else inconsistentCount++;

    results.push({
        package_id: uuid,
        proposal_patch_consistent: isPropPatchConsistent,
        patch_diff_consistent: isPatchDiffConsistent,
        consistency_status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        exact_fields_that_differ: differingFields
    });
});

fs.writeFileSync(path.join(rootDir, 'experiments', 'task33_audit_v6_integrity.json'), JSON.stringify(results, null, 2));

const mdReport = `# V6 Integrity Report

Total Packages: ${packages.length}
Consistent Packages: ${consistentCount}
Inconsistent Packages: ${inconsistentCount}
Leakages Detected: ${leakages}

## Inconsistent Packages Details

${results.filter(r => r.consistency_status === 'INCONSISTENT').map(r => `### Package ${r.package_id}
- proposal_patch_consistent: ${r.proposal_patch_consistent}
- patch_diff_consistent: ${r.patch_diff_consistent}
- Differing fields: ${r.exact_fields_that_differ.join(', ')}
`).join('\n')}
`;

fs.writeFileSync(path.join(rootDir, 'experiments', 'task33_audit_v6_integrity.md'), mdReport);

if (inconsistentCount > 0 || leakages > 0 || packages.length !== 27) {
    console.log(`packages=${packages.length}
consistent=${consistentCount}
inconsistent=${inconsistentCount}
leakage=${leakages}
preflight=FAIL`);
} else {
    console.log(`packages=27
consistent=27
inconsistent=0
leakage=0
preflight=PASS`);
}

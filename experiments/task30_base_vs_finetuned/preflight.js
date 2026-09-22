import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const TARGET_SHA256 = '8eca855734a277b94c96cda7ba3bdeba12033f1df0dad870401959ca9b6dec3d';

function deepEqualUnorderedOps(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) return false;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        
        if (key === 'operations' && Array.isArray(obj1[key]) && Array.isArray(obj2[key])) {
            const arr1 = obj1[key];
            const arr2 = obj2[key];
            if (arr1.length !== arr2.length) return false;
            
            // Operations order does not matter as they target discrete elements
            const used = new Array(arr2.length).fill(false);
            let allMatched = true;
            for (const item1 of arr1) {
                let matched = false;
                for (let i = 0; i < arr2.length; i++) {
                    if (!used[i] && deepEqualUnorderedOps(item1, arr2[i])) {
                        used[i] = true;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    allMatched = false;
                    break;
                }
            }
            if (!allMatched) return false;
        } else if (key === 'rationale' || key === 'reason') {
             continue; // ignore exact string match for rationale/reason
        } else {
            if (!deepEqualUnorderedOps(obj1[key], obj2[key])) return false;
        }
    }
    return true;
}

async function checkModelResponds(modelName) {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: "Hello",
                stream: false,
                options: { temperature: 0 }
            })
        });
        const data = await response.json();
        return !data.error && typeof data.response === 'string';
    } catch(e) {
        return false;
    }
}

function getModelConfig(modelName) {
    const out = execSync(`ollama show ${modelName} --modelfile`, { encoding: 'utf-8' });
    const tempMatch = out.match(/TEMPLATE\s+"""([\s\S]*?)"""/);
    const stopMatches = [...out.matchAll(/PARAMETER\s+stop\s+"(.*?)"/g)].map(m => m[1]).sort();
    return {
        template: tempMatch ? tempMatch[1].trim() : null,
        stops: stopMatches
    };
}

async function runPreflight() {
    console.log("=== TASK30 PREFLIGHT ===");
    const errors = [];
    
    // 1. Dataset SHA256 & Count
    const dsPath = path.join(process.cwd(), 'datasets/test_internal.jsonl');
    const content = fs.readFileSync(dsPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    console.log("TEST_DATASET_PATH:", dsPath);
    console.log("TEST_DATASET_SHA256:", hash);
    if (hash !== TARGET_SHA256) errors.push("Dataset SHA256 mismatch");
    
    const lines = content.trim().split('\n');
    console.log("TEST_CASE_COUNT:", lines.length);
    if (lines.length !== 50) errors.push(`Expected 50 cases, got ${lines.length}`);
    
    // 2. Leakage check
    let leakDetected = false;
    for (let i = 0; i < lines.length; i++) {
        const parsed = JSON.parse(lines[i]);
        const userMsg = parsed.messages.find(m => m.role === 'user').content;
        const asstMsg = parsed.messages.find(m => m.role === 'assistant').content;
        const gt = JSON.parse(asstMsg);
        
        // Assert ground truth action/operation isn't literally in the prompt
        // Actually, we must make sure the exact output isn't leaked. It's impossible for
        // "MODIFY_ATTRIBUTE" to be literally leaked because we only prompt the violation info.
        // But we should verify.
        if (gt.action && userMsg.includes(`"action": "${gt.action}"`)) leakDetected = true;
        if (gt.operations && gt.operations.length > 0) {
            for (const op of gt.operations) {
                if (op.attribute && userMsg.includes(`"attribute": "${op.attribute}"`)) leakDetected = true;
            }
        }
    }
    if (leakDetected) errors.push("Ground-truth leakage detected in user prompt.");
    
    // 3. Dataset Identity Overlap
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'datasets/dataset_manifest.json'), 'utf8'));
    console.log("CATEGORY_DISTRIBUTION:", manifest.distribution);
    if (manifest.shared_fingerprints_across_splits !== 0) {
        errors.push("Train/Test fingerprint overlap detected in manifest");
    }
    
    // 4. Semantic Comparator Positive/Negative tests
    const p1 = { "action": "MODIFY", "operations": [ { "target": "A", "operation": "ADD", "attribute": "alt" }, { "target": "B", "operation": "REMOVE" } ] };
    const p2 = { "operations": [ { "operation": "REMOVE", "target": "B" }, { "attribute": "alt", "operation": "ADD", "target": "A" } ], "action": "MODIFY" };
    if (!deepEqualUnorderedOps(p1, p2)) errors.push("Comparator POSITIVE test failed");
    
    const n1 = { "action": "MODIFY", "operations": [ { "target": "A", "operation": "ADD", "attribute": "title" } ] };
    if (deepEqualUnorderedOps(p1, n1)) errors.push("Comparator NEGATIVE test failed");
    
    // 5. Model Responses
    const baseResponds = await checkModelResponds("qwen2.5-coder:7b");
    const ftResponds = await checkModelResponds("accessaudit-qwen7b-ft");
    if (!baseResponds) errors.push("Base model does not respond");
    if (!ftResponds) errors.push("Fine-tuned model does not respond");
    
    // 6. Template Parity
    const baseConfig = getModelConfig("qwen2.5-coder:7b");
    const ftConfig = getModelConfig("accessaudit-qwen7b-ft");
    
    if (baseConfig.template !== ftConfig.template) {
        errors.push("TEMPLATE parity mismatch");
    }
    if (JSON.stringify(baseConfig.stops) !== JSON.stringify(ftConfig.stops)) {
        errors.push("PARAMETER stop parity mismatch");
    }
    
    if (errors.length > 0) {
        console.log("\nTASK30 PREFLIGHT: BLOCKED");
        errors.forEach(e => console.log(`- ${e}`));
        process.exit(1);
    } else {
        console.log("\nTASK30 PREFLIGHT: PASS");
    }
}

runPreflight().catch(console.error);

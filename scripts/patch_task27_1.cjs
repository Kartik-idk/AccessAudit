const fs = require('fs');

let code = fs.readFileSync('run_task27_1_benchmark.js', 'utf8');

// 1. Fix parser to handle Markdown and greedy brackets
const oldParser = `function parseAndTranslatePayload(payloadStr, nodeMap, targetFile) {
    let parsed;
    try {
        parsed = JSON.parse(payloadStr);
    } catch (e) {
        return { valid: false, reason: "JSON_PARSE_FAILURE", message: e.message };
    }`;

const newParser = `function parseAndTranslatePayload(payloadStr, nodeMap, targetFile) {
    let cleanStr = payloadStr;
    const jsonMatch = payloadStr.match(/\`\`\`(?:json)?\\n?([\\s\\S]*?)\`\`\`/);
    if (jsonMatch) {
        cleanStr = jsonMatch[1];
    } else {
        const fallbackMatch = payloadStr.match(/\\{[\\s\\S]*\\}/);
        if (fallbackMatch) {
            cleanStr = fallbackMatch[0];
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(cleanStr.trim());
    } catch (e) {
        return { valid: false, reason: "JSON_PARSE_FAILURE", message: e.message };
    }`;

code = code.replace(oldParser, newParser);

// 2. Filter cases loop
// The loop is: for (const c of benchmarkCases) {
code = code.replace('for (const c of benchmarkCases) {',
`const targetCases = ["case1", "case6", "case7", "case8", "case10"];
    for (const c of benchmarkCases.filter(x => targetCases.includes(x.name))) {`);

// 3. Output results properly and log raw model output
// Replace response json stringifier block
code = code.replace(/responseText = json\.response;\n\s+console.log\(`  Attempt \$\{attempt\}: Requesting generation\.\.\.`\);\n/,
`responseText = json.response;
                console.log(\`  Attempt \${attempt}: Requesting generation...\`);
                console.log("=== RAW MODEL OUTPUT ===");
                console.log(responseText);
                console.log("========================");
`);

// 4. Fix those literal \${} in console logs caused by my bash mistake in Task 27
code = code.replace(/\\\$\{validationResult\.reason\}/g, '${validationResult.reason}');
code = code.replace(/\\\$\{parseRes\.reason\}/g, '${parseRes.reason}');
code = code.replace(/\\\$\{finalStatus\}/g, '${finalStatus}');
code = code.replace(/\\\$\{gt\.reason\}/g, '${gt.reason}');
code = code.replace(/\\\$\{gt\.msg\}/g, '${gt.msg}');
code = code.replace(/\\\$\{v\.id\}/g, '${v.id}');

// 5. Change output json filename
code = code.replace(/task27_results\.json/g, 'task27_1_results.json');

// 6. Fix initial log statement
code = code.replace(/Starting Task 27 Benchmark with open-weights model: qwen2\.5-coder:7b/g, 'Starting Task 27.1 Benchmark with open-weights model: qwen2.5-coder:14b');

fs.writeFileSync('run_task27_1_benchmark.js', code);

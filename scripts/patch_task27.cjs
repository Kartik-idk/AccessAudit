const fs = require('fs');

let code = fs.readFileSync('run_task27_benchmark.js', 'utf8');

// Replace PROMPT_TEMPLATE
const oldPromptStart = code.indexOf('const PROMPT_TEMPLATE');
const oldPromptEnd = code.indexOf('`;', oldPromptStart) + 2;

const newPrompt = `const PROMPT_TEMPLATE = \`You are an automated accessibility remediation agent.
You must remediate the accessibility violation identified by Axe-core.

You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.

Schema:
{
  "action": "MODIFY_ATTRIBUTE" | "STRUCTURAL_REMEDIATION" | "MULTI_NODE_REMEDIATION" | "ABORT",
  "reason": "explanation of remediation intent",
  "operations": [
    {
      "target": "NODE_A",
      "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
      "attribute": "attribute_name" (omit for structural),
      "value": "attribute_value" (omit for remove/structural),
      "replacement_tag": "button" (for structural only)
    }
  ]
}

If you cannot safely remediate the issue based on the provided context, output:
{ "action": "ABORT", "reason": "...", "operations": [] }

VIOLATION:
{{VIOLATION}}

CONTEXT NODES:
{{NODES}}
\`;`;

code = code.substring(0, oldPromptStart) + newPrompt + code.substring(oldPromptEnd);

// Add imports
code = code.replace("import { execSync } from 'child_process';", 
`import { execSync } from 'child_process';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;
import _generate from '@babel/generator';
const generate = _generate.default || _generate;
`);

// Add parseAndTranslatePayload and extractNodes
const newFuncs = `

function extractNodes(ast, targetSelector) {
    const targetId = targetSelector.replace('#', '');
    let componentNode = null;

    traverse(ast, {
        JSXElement(path) {
            const idAttr = path.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
            if (idAttr && idAttr.value && idAttr.value.value === targetId) {
                let curr = path;
                while(curr) {
                    if (curr.node.type === 'FunctionDeclaration') {
                        componentNode = curr.node;
                        break;
                    }
                    curr = curr.parentPath;
                }
            }
        }
    });

    let nodeCounter = 0;
    const nodeMap = {};
    let promptContext = "";

    traverse(ast, {
        FunctionDeclaration(path) {
            if (path.node === componentNode) {
                path.traverse({
                    JSXElement(innerPath) {
                        const letter = String.fromCharCode(65 + nodeCounter);
                        const nodeId = \`NODE_\${letter}\`;
                        nodeMap[nodeId] = {
                            line: innerPath.node.loc.start.line,
                            column: innerPath.node.loc.start.column,
                            target_element: innerPath.node.openingElement.name.name
                        };
                        const codeSnippet = generate(innerPath.node).code;
                        promptContext += \`\${nodeId}:\\n\${codeSnippet}\\n\\n\`;
                        nodeCounter++;
                    }
                });
            }
        }
    });

    return { nodeMap, promptContext };
}

function parseAndTranslatePayload(payloadStr, nodeMap, targetFile) {
    let parsed;
    try {
        parsed = JSON.parse(payloadStr);
    } catch (e) {
        return { valid: false, reason: "JSON_PARSE_FAILURE", message: e.message };
    }
    
    if (parsed.action === 'ABORT') {
        return { valid: true, objects: [{ action: 'ABORT' }] };
    }
    
    if (!parsed.operations || !Array.isArray(parsed.operations)) {
        return { valid: false, reason: "SCHEMA_ERROR", message: "Missing operations array" };
    }
    
    const objects = [];
    for (const op of parsed.operations) {
        const targetNode = nodeMap[op.target];
        if (!targetNode) {
            return { valid: false, reason: "TARGET_LOCALIZATION_FAILURE", message: \`Target \${op.target} not found in nodeMap\` };
        }
        objects.push({
            action: parsed.action,
            target_element: targetNode.target_element,
            line: targetNode.line,
            column: targetNode.column,
            operation: op.operation,
            attribute: op.attribute,
            value: op.value,
            replacement_tag: op.replacement_tag,
            file: targetFile,
            reason: parsed.reason || "translated"
        });
    }
    return { valid: true, objects };
}

`;
code = code.replace('async function run() {', newFuncs + 'async function run() {');

// Inside run loop, replace prompt generation
// old: let prompt = PROMPT_TEMPLATE.replace('{{VIOLATION}}', JSON.stringify(v, null, 2))...
// new: parse ast, extract nodes, format prompt
code = code.replace(
`        let prompt = PROMPT_TEMPLATE
            .replace('{{VIOLATION}}', JSON.stringify(v, null, 2))
            .replace('{{TARGET_HTML}}', v.nodes[0].html)
            .replace('{{TARGET_FILE}}', targetFile)
            .replace('{{TARGET_LINE}}', c.line)
            .replace('{{TARGET_COL}}', c.col)
            .replace('{{SOURCE_CONTEXT}}', sourceContext);`,
`        const ast = parser.parse(originalSource, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        const { nodeMap, promptContext } = extractNodes(ast, c.targetSelector);
        
        let prompt = PROMPT_TEMPLATE
            .replace('{{VIOLATION}}', JSON.stringify(v, null, 2))
            .replace('{{NODES}}', promptContext.trim());
`
);

// Replace parseMultiObjectResponse
code = code.replace(
    'const parseRes = parseMultiObjectResponse(responseText);',
    'const parseRes = parseAndTranslatePayload(responseText, nodeMap, targetFile);'
);

// Update model to 14b and output file
code = code.replace("model: 'qwen2.5-coder:7b'", "model: 'qwen2.5-coder:14b'");
code = code.replace("task24_results.json", "task27_results.json");
code = code.replace("Starting Task 24", "Starting Task 27");

fs.writeFileSync('run_task27_benchmark.js', code);

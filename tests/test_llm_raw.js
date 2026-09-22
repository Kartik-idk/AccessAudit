import { parseMultiObjectResponse } from '../scripts/pipeline_v6.js';
const PROMPT = `You are an automated accessibility remediation agent.
You must remediate the accessibility violation identified by Axe-core.

You MUST reply with ONLY flat JSON objects. Do NOT output any conversational text.
If the remediation requires multiple target elements, you MUST output multiple independent flat JSON objects, one after the other.
Do NOT use nested arrays or nested replacement objects.

Schema for each object:
{
  "action": "MODIFY_ATTRIBUTE" | "STRUCTURAL_REMEDIATION" | "MULTI_NODE_REMEDIATION" | "ABORT",
  "reason": "explanation of remediation intent",
  "target_element": "tag",
  "file": "path/to/file",
  "line": 0,
  "column": 0,
  "operation": "ADD" | "UPDATE" | "REMOVE" | "REPLACE_TAG",
  "attribute": "attr_name (if applicable)",
  "value": "attr_value (if applicable)",
  "replacement_tag": "button (only for REPLACE_TAG)"
}

Example single output:
{"action":"MODIFY_ATTRIBUTE","target_element":"span","file":"src/App.tsx","line":10,"column":5,"operation":"ADD","attribute":"id","value":"search-label","reason":"Fix missing id"}

Example multi-node output:
{"action":"MULTI_NODE_REMEDIATION","target_element":"span","file":"src/App.tsx","line":10,"column":5,"operation":"ADD","attribute":"id","value":"search-label","reason":"add id"}
{"action":"MULTI_NODE_REMEDIATION","target_element":"input","file":"src/App.tsx","line":11,"column":5,"operation":"ADD","attribute":"aria-labelledby","value":"search-label","reason":"link to span"}

You must provide exactly one generation per attempt.`;

const convo = `File: dom-source-test/src/components/Task18Benchmark.tsx
Target Line: 26
Violation: image-alt on element img
Source Snippet:
    <div>
      {/* Case 1: MODIFY_ATTRIBUTE (Missing alt text) */}
      <img id="c1-img" src="/logo.png" />
      
      {/* Case 2: MODIFY_ATTRIBUTE (Empty button) */}
`;

async function callLLM() {
    const data = {
        model: "qwen2.5-coder:7b",
        prompt: PROMPT + "\n\nContext:\n" + convo,
        stream: false,
        options: { temperature: 0.1 }
    };
    const response = await fetch("http://localhost:11434/api/generate", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const res = await response.json();
    console.log("Raw Response:\n" + res.response);
    const parsed = parseMultiObjectResponse(res.response);
    console.log("Parsed result:", parsed);
}
callLLM();

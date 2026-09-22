import fs from 'fs';
import path from 'path';
import { validateProposal, applyPatch } from '../scripts/pipeline_v3.js';

const schema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["ABORT", "MODIFY_ATTRIBUTE", "STRUCTURAL_REMEDIATION"] },
    reason: { type: "string" },
    target: {
      type: "object",
      properties: { element: { type: "string" }, file: { type: "string" }, line: { type: "integer" }, column: { type: "integer" } },
      required: ["element", "file", "line", "column"]
    },
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"] },
    attribute: { type: "string" },
    value: { type: "string" },
    replacement: {
      type: "object",
      properties: { element: { type: "string", enum: ["button"] } },
      required: ["element"]
    }
  },
  required: ["action", "reason"],
  allOf: [
    { if: { properties: { action: { const: "MODIFY_ATTRIBUTE" } } }, then: { required: ["target", "operation", "attribute"] } },
    { if: { properties: { action: { const: "STRUCTURAL_REMEDIATION" } } }, then: { required: ["target", "operation", "replacement"] } }
  ]
};

const cases = [
  {
    id: "case-A",
    desc: "Disconnected label",
    rule: "label",
    file: "src/components/StructuralCases.tsx",
    line: 7,
    element: "input",
    context: `
export function CaseADisconnectedLabel() {
  return (
    <div>
      <label htmlFor="email-field">Email</label>
      <input id="email-field" />
    </div>
  );
}`
  },
  {
    id: "case-B",
    desc: "Interactive div -> button",
    rule: "button-name",
    file: "src/components/StructuralCases.tsx",
    line: 16,
    element: "div",
    context: `
export function CaseBInteractiveDiv() {
  return (
    <div className="search-bar">
      <div onClick={() => console.log('searching')} className="btn">
        Search
      </div>
    </div>
  );
}`
  },
  {
    id: "case-C",
    desc: "Ambiguous structure",
    rule: "button-name",
    file: "src/components/StructuralCases.tsx",
    line: 25,
    element: "div",
    context: `
export function CaseCAmbiguousStructure() {
  return (
    <div className="card-click-area" onClick={() => window.location.href='/details'}>
      <h2>Article Title</h2>
      <p>Summary of the article goes here...</p>
      <span>Read more</span>
    </div>
  );
}`
  },
  {
    id: "case-D",
    desc: "Malicious tag",
    rule: "button-name",
    file: "src/components/StructuralCases.tsx",
    line: 36,
    element: "div",
    context: `
export function CaseDMaliciousTag() {
  return (
    <div onClick={() => {}}>
      Submit
    </div>
  );
}`
  },
  {
    id: "case-E",
    desc: "Invalid replacement",
    rule: "button-name",
    file: "src/components/StructuralCases.tsx",
    line: 45,
    element: "span",
    context: `
export function CaseEInvalidReplacement() {
  return (
    <span onClick={() => {}}>
      Action
    </span>
  );
}`
  },
  {
    id: "case-F",
    desc: "Nested Interactive",
    rule: "button-name",
    file: "src/components/StructuralCases.tsx",
    line: 54,
    element: "div",
    context: `
export function CaseFNestedInteractive() {
  return (
    <div onClick={() => {}}>
      Click me
      <a href="/somewhere">Or click here</a>
    </div>
  );
}`
  }
];

const PROMPT_TEMPLATE = `You are an accessibility remediation assistant.
Analyze the supplied accessibility violation and propose the smallest semantically correct source-level remediation.

You have exactly three available actions:
1. "ABORT": Use this if the context is insufficient, if the remediation is ambiguous, or if no safe attribute/structural operation can resolve it.
2. "MODIFY_ATTRIBUTE": Add, update, or remove an accessibility attribute.
3. "STRUCTURAL_REMEDIATION": Perform a REPLACE_TAG operation to change the target's tag name. Note that the ONLY supported replacement element is "button".

Do not optimize merely for making axe return zero violations.
Do not use accessibility shortcuts such as empty accessible names.

Target details:
Violation Rule: {RULE}
Target Element: {ELEMENT}
File: {FILE}
Line: {LINE}
Column: {COLUMN}

Context snippet:
{CONTEXT}
`;

async function runClosedLoop() {
  const resultsDir = path.join(process.cwd(), 'results_task7');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  const experimentLog = [];

  for (const c of cases) {
    console.log(`\n============================`);
    console.log(`Starting ${c.id}`);
    const caseDir = path.join(resultsDir, c.id);
    if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir);

    const fileContent = fs.readFileSync(c.file, 'utf8').split('\n');
    const lineContent = fileContent[c.line - 1];
    const column = lineContent.indexOf('<' + c.element);

    const initialPrompt = PROMPT_TEMPLATE
      .replace('{RULE}', c.rule)
      .replace('{ELEMENT}', c.element)
      .replace('{FILE}', c.file)
      .replace('{LINE}', c.line)
      .replace('{COLUMN}', column)
      .replace('{CONTEXT}', c.context);

    let messages = [
      { role: "user", content: initialPrompt }
    ];

    let attempts = 0;
    const MAX_ATTEMPTS = 3;
    let finalStatus = "MAX_ATTEMPTS_REACHED";

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(` Attempt ${attempts}...`);
      
      let responseText = "";
      try {
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5-coder:7b',
            messages: messages,
            format: schema,
            stream: false,
            options: { temperature: 0.1 }
          })
        });
        
        const data = await response.json();
        responseText = data.message.content;
      } catch (err) {
        console.error("  API Error:", err);
        break;
      }

      fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_raw.json`), responseText, 'utf8');
      
      let parsed = null;
      let valRes = null;
      try {
        parsed = JSON.parse(responseText);
        const absPath = path.resolve(process.cwd(), c.file);
        valRes = validateProposal(parsed, absPath);
      } catch (e) {
        valRes = { valid: false, stage: "JSON_PARSE", reason: "PARSE_ERROR", message: "Failed to parse JSON." };
      }

      if (valRes.isAbort) {
          console.log(`  🛑 LLM explicitly ABORTED: ${parsed.reason}`);
          finalStatus = "SAFE_ABORT";
          break;
      }

      if (valRes.valid) {
        console.log(`  ✅ GATEKEEPER ACCEPTED on attempt ${attempts}`);
        const patchRes = applyPatch(parsed, path.resolve(process.cwd(), c.file), valRes);
        if (patchRes.success) {
            console.log(`  ✅ PATCH APPLIED`);
            finalStatus = "SAFE_FIX";
        } else {
            console.log(`  ❌ PATCH FAILED: ${patchRes.reason}`);
            finalStatus = "PATCH_FAILED";
        }
        break;
      } else {
        console.log(`  ❌ REJECTED [${valRes.stage}] - ${valRes.reason}`);
        
        messages.push({ role: "assistant", content: responseText });
        const feedback = `Your proposal was rejected during ${valRes.stage} validation because: ${valRes.message}\nRevise your proposal safely or use the ABORT action if you cannot resolve this.`;
        messages.push({ role: "user", content: feedback });
      }
    }

    experimentLog.push({
      case: c.id,
      attempts,
      finalStatus
    });
  }

  fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(experimentLog, null, 2));
  console.log("\nDone!");
}

runClosedLoop();

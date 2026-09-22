import fs from 'fs';
import path from 'path';

// Flattened schema explicitly designed for 7B model comprehension
const flatSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["ABORT", "MODIFY_ATTRIBUTE", "STRUCTURAL_REMEDIATION"] },
    reason: { type: "string" },
    target: {
      type: "object",
      properties: { element: { type: "string" }, file: { type: "string" }, line: { type: "integer" }, column: { type: "integer" } }
    },
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"] },
    attribute: { type: "string" },
    value: { type: "string" },
    replacement: { type: "string", enum: ["button"] }
  },
  required: ["action", "reason"]
};

const cases = [
  { id: "case-A", rule: "label", file: "src/components/StructuralCases.tsx", line: 7, element: "input",
    context: `export function CaseADisconnectedLabel() {
  return (
    <div>
      <label htmlFor="email-field">Email</label>
      <input id="email-field" />
    </div>
  );
}`
  },
  { id: "case-B", rule: "button-name", file: "src/components/StructuralCases.tsx", line: 16, element: "div",
    context: `export function CaseBInteractiveDiv() {
  return (
    <div className="search-bar">
      <div onClick={() => console.log('searching')} className="btn">
        Search
      </div>
    </div>
  );
}`
  },
  { id: "case-C", rule: "button-name", file: "src/components/StructuralCases.tsx", line: 25, element: "div",
    context: `export function CaseCAmbiguousStructure() {
  return (
    <div className="card-click-area" onClick={() => window.location.href='/details'}>
      <h2>Article Title</h2>
      <p>Summary of the article goes here...</p>
      <span>Read more</span>
    </div>
  );
}`
  },
  { id: "case-D", rule: "button-name", file: "src/components/StructuralCases.tsx", line: 36, element: "div",
    context: `export function CaseDMaliciousTag() {
  return (
    <div onClick={() => {}}>
      Submit
    </div>
  );
}`
  },
  { id: "case-E", rule: "button-name", file: "src/components/StructuralCases.tsx", line: 45, element: "span",
    context: `export function CaseEInvalidReplacement() {
  return (
    <span onClick={() => {}}>
      Action
    </span>
  );
}`
  },
  { id: "case-F", rule: "button-name", file: "src/components/StructuralCases.tsx", line: 54, element: "div",
    context: `export function CaseFNestedInteractive() {
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
1. "ABORT": Use this if the context is insufficient, if the remediation is ambiguous, or if no safe attribute/structural operation can resolve it. (Requires only 'action' and 'reason')
2. "MODIFY_ATTRIBUTE": Add, update, or remove an accessibility attribute. (Requires target, operation, attribute, and value)
3. "STRUCTURAL_REMEDIATION": Perform a REPLACE_TAG operation to change the target's tag name. Note that the ONLY supported replacement element is "button". (Requires target, operation, and replacement)

Do not optimize merely for making axe return zero violations.
Do not use accessibility shortcuts such as empty accessible names.

Target details:
Violation Rule: {RULE}
Target Element: {ELEMENT}
File: {FILE}
Line: {LINE}

Context snippet:
{CONTEXT}
`;

function validateCompleteness(parsed) {
  if (parsed.action === "ABORT") {
    return { valid: true, isAbort: true, message: "Valid ABORT" };
  }
  
  if (!parsed.target || !parsed.target.element || !parsed.target.file || !parsed.target.line || !parsed.target.column) {
    return { valid: false, message: "Missing required 'target' properties for this action." };
  }

  if (parsed.action === "MODIFY_ATTRIBUTE") {
    if (!parsed.operation || !parsed.attribute) {
       return { valid: false, message: "Missing operation or attribute for MODIFY_ATTRIBUTE." };
    }
    return { valid: true, isAbort: false, message: "Valid MODIFY_ATTRIBUTE schema" };
  }
  
  if (parsed.action === "STRUCTURAL_REMEDIATION") {
    if (!parsed.operation || !parsed.replacement) {
       return { valid: false, message: "Missing operation or replacement for STRUCTURAL_REMEDIATION." };
    }
    return { valid: true, isAbort: false, message: "Valid STRUCTURAL_REMEDIATION schema" };
  }

  return { valid: false, message: "Unknown action" };
}

async function runPhase1() {
  const resultsDir = path.join(process.cwd(), 'results_task8_phase1');
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
      .replace('{CONTEXT}', c.context);

    let messages = [
      { role: "user", content: initialPrompt }
    ];

    let attempts = 0;
    const MAX_ATTEMPTS = 3;
    let finalStatus = "MAX_ATTEMPTS_REACHED";
    let firstPassValid = false;

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
            format: flatSchema,
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
      let parseSuccess = false;
      try {
        parsed = JSON.parse(responseText);
        parseSuccess = true;
      } catch (e) {
        console.log("  ❌ JSON Parse Error");
      }

      if (parseSuccess) {
          const valRes = validateCompleteness(parsed);
          
          if (attempts === 1 && valRes.valid) {
              firstPassValid = true;
          }

          if (valRes.isAbort) {
              console.log(`  🛑 ABORT detected.`);
              finalStatus = "SCHEMA_COMPLETE_ABORT";
              break; // Phase 1 success (schema is complete)
          }

          if (valRes.valid) {
              console.log(`  ✅ SCHEMA COMPLETE: ${valRes.message}`);
              finalStatus = "SCHEMA_COMPLETE_ACTION";
              break; // Phase 1 success
          } else {
              console.log(`  ❌ REJECTED [SCHEMA] - ${valRes.message}`);
              messages.push({ role: "assistant", content: responseText });
              const feedback = `Your proposal failed JavaScript validation because: ${valRes.message}\nPlease revise and provide all required fields, or use the ABORT action.`;
              messages.push({ role: "user", content: feedback });
          }
      }
    }

    experimentLog.push({
      case: c.id,
      attempts,
      firstPassValid,
      finalStatus
    });
  }

  fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(experimentLog, null, 2));
  console.log("\nDone!");
}

runPhase1();

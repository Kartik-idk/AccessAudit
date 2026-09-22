import fs from 'fs';
import path from 'path';

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

Produce your remediation proposal as plain text containing a single JSON object.

The desired proposal format should be structurally equivalent to:

For structural remediation:
{
  "action": "STRUCTURAL_REMEDIATION",
  "reason": "...",
  "target": {
    "element": "div",
    "file": "...",
    "line": 0,
    "column": 0
  },
  "operation": "REPLACE_TAG",
  "replacement": "button"
}

For MODIFY_ATTRIBUTE:
{
  "action": "MODIFY_ATTRIBUTE",
  "reason": "...",
  "target": {
    "element": "div",
    "file": "...",
    "line": 0,
    "column": 0
  },
  "operation": "ADD",
  "attribute": "role",
  "value": "button"
}

For ABORT:
{
  "action": "ABORT",
  "reason": "..."
}

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

Context snippet:
{CONTEXT}
`;

function extractJson(text) {
  // Conservative JSON extraction.
  let cleanText = text.trim();
  
  // Try to find a markdown block
  const markdownMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }
  
  // If no markdown block, try to find the first { and last }
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return cleanText.substring(firstBrace, lastBrace + 1);
  }
  return cleanText;
}

function validateCompleteness(parsed) {
  if (parsed.action === "ABORT") {
    return { valid: true, isAbort: true, message: "Valid ABORT" };
  }
  
  if (!parsed.target || !parsed.target.element || !parsed.target.file || !parsed.target.line || typeof parsed.target.column === 'undefined') {
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

async function runTest() {
  const resultsDir = path.join(process.cwd(), 'results_task9');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  const experimentLog = [];

  for (const c of cases) {
    console.log(`\n============================`);
    console.log(`Starting ${c.id}`);
    const caseDir = path.join(resultsDir, c.id);
    if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir);

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
            // REMOVED: format: flatSchema
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

      fs.writeFileSync(path.join(caseDir, `attempt_${attempts}_raw.txt`), responseText, 'utf8');
      
      let parsed = null;
      let parseSuccess = false;
      const extractedStr = extractJson(responseText);
      try {
        parsed = JSON.parse(extractedStr);
        parseSuccess = true;
      } catch (e) {
        console.log("  ❌ PARSE_FAILURE");
      }

      if (parseSuccess) {
          const valRes = validateCompleteness(parsed);
          
          if (valRes.isAbort) {
              console.log(`  🛑 ABORT detected.`);
              finalStatus = "SCHEMA_COMPLETE_ABORT";
              break; 
          }

          if (valRes.valid) {
              console.log(`  ✅ SCHEMA COMPLETE: ${valRes.message}`);
              finalStatus = "SCHEMA_COMPLETE_ACTION";
              break; 
          } else {
              console.log(`  ❌ REJECTED [SCHEMA] - ${valRes.message}`);
              messages.push({ role: "assistant", content: responseText });
              const feedback = `Your proposal failed validation because: ${valRes.message}\nPlease revise and provide all required JSON fields, or use the ABORT action. Output ONLY the JSON.`;
              messages.push({ role: "user", content: feedback });
          }
      } else {
          messages.push({ role: "assistant", content: responseText });
          const feedback = `Your output could not be parsed as JSON. Please revise and output ONLY a valid JSON object.`;
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

runTest();

import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const ajv = new Ajv();

const schema = {
  type: "object",
  properties: {
    action: { type: "string" },
    target: {
      type: "object",
      properties: {
        element: { type: "string" },
        file: { type: "string" },
        line: { type: "integer" },
        column: { type: "integer" }
      },
      required: ["element", "file", "line", "column"]
    },
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE"] },
    attribute: { type: "string" },
    value: { type: "string" },
    reason: { type: "string" }
  },
  required: ["action", "target", "operation", "attribute", "reason"]
};

const validateSchema = ajv.compile(schema);
const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'id', 'tabIndex', 'aria-hidden'];

function validateProposal(proposal, absPath) {
  // 1. Schema Validation
  if (!validateSchema(proposal)) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "SCHEMA_VALIDATION", message: "Schema validation failed: " + ajv.errorsText(validateSchema.errors) };
  }
  
  // 2. Attribute Validation (Syntactic Safety)
  if (proposal.operation === 'ADD' && !ALLOWED_ATTRIBUTES.includes(proposal.attribute)) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "UNSUPPORTED_ATTRIBUTE", message: `Dangerous or unsupported attribute '${proposal.attribute}'` };
  }
  
  if (!fs.existsSync(absPath)) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "FILE_NOT_FOUND", message: `File not found ${absPath}` };
  }
  
  let code = fs.readFileSync(absPath, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "PARSE_ERROR", message: "Could not parse source file" };
  }
  
  // 3. Target Validation
  let targetNode = null;
  traverse(ast, {
    JSXElement(path) {
      const loc = path.node.loc;
      if (loc && loc.start.line === proposal.target.line && loc.start.column === proposal.target.column) {
        targetNode = path.node;
        path.stop();
      }
    }
  });
  
  if (!targetNode) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "TARGET_NOT_FOUND", message: `Target AST node not found at line ${proposal.target.line}, col ${proposal.target.column}` };
  }
  
  const elementName = targetNode.openingElement.name.name;
  if (elementName !== proposal.target.element) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "TARGET_MISMATCH", message: `Target element mismatch. Expected '${proposal.target.element}', found '${elementName}'` };
  }

  const opening = targetNode.openingElement;
  const existingAttrIndex = opening.attributes.findIndex(attr => attr.name && attr.name.name === proposal.attribute);
  const hasAttr = existingAttrIndex !== -1;
  
  if (proposal.operation === 'ADD' && hasAttr) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "ATTRIBUTE_EXISTS", message: `Attribute '${proposal.attribute}' already exists for ADD operation.` };
  }
  
  if ((proposal.operation === 'UPDATE' || proposal.operation === 'REMOVE') && !hasAttr) {
    return { valid: false, reason: "SYNTACTIC_REJECT", rule: "ATTRIBUTE_MISSING", message: `Attribute '${proposal.attribute}' does not exist for ${proposal.operation} operation.` };
  }

  // --- SEMANTIC GATEKEEPER ---
  const val = proposal.value || "";
  
  // Rule A
  if (proposal.attribute === 'aria-hidden' && val === "true" && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
    const hasClickHandler = opening.attributes.some(a => a.name && (a.name.name === 'onClick' || a.name.name === 'onKeyDown' || a.name.name === 'onKeyUp'));
    if (interactiveTags.includes(elementName) || hasClickHandler) {
      return { valid: false, reason: "SEMANTIC_REJECT", rule: "INTERACTIVE_ARIA_HIDDEN", message: "Rule A prohibits aria-hidden=true on interactive elements. This would remove an interactive element from the accessibility tree." };
    }
  }

  // Rule B
  if (['alt', 'aria-label', 'title'].includes(proposal.attribute) && val.trim() === "" && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
    return { valid: false, reason: "SEMANTIC_REJECT", rule: "EMPTY_ACCESSIBLE_NAME", message: `Rule B prohibits empty ${proposal.attribute} values. An empty accessible name can leave the interactive control or informative image unnamed.` };
  }

  // Rule C
  if (proposal.attribute === 'tabIndex' && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
    const tabNum = parseInt(val, 10);
    if (tabNum > 0) {
      return { valid: false, reason: "SEMANTIC_REJECT", rule: "POSITIVE_TABINDEX", message: `Rule C prohibits positive tabIndex (${val}). It is dangerous and disrupts document flow.` };
    }
  }

  // Rule D
  if (proposal.operation === 'REMOVE' && ['onClick', 'onKeyDown', 'onKeyUp', 'onChange'].includes(proposal.attribute)) {
    return { valid: false, reason: "SEMANTIC_REJECT", rule: "EVENT_HANDLER_DESTRUCTION", message: `Rule D prohibits removing event handler '${proposal.attribute}' because it destroys component logic.` };
  }

  // Rule E
  if (proposal.attribute === 'role' && proposal.operation === 'ADD') {
     if (elementName === 'nav' && val === 'navigation') {
         return { valid: false, reason: "SEMANTIC_REJECT", rule: "REDUNDANT_ARIA", message: `Rule E prohibits adding role='navigation' to <nav> as it is redundant ARIA.` };
     }
  }
  
  return { valid: true, code, insertPos: 0, opening, existingAttrIndex, val };
}

function applyPatch(proposal, absPath, validationResult) {
  let code = validationResult.code;
  const opening = validationResult.opening;
  const val = validationResult.val;
  
  if (proposal.operation === 'ADD') {
    let insertPos = opening.name.end;
    if (opening.attributes.length > 0) {
      insertPos = opening.attributes[opening.attributes.length - 1].end;
    }
    const escapedValue = val.replace(/"/g, '&quot;');
    const injection = ` ${proposal.attribute}="${escapedValue}"`;
    code = code.slice(0, insertPos) + injection + code.slice(insertPos);
  } 
  else if (proposal.operation === 'REMOVE') {
    const attrNode = opening.attributes[validationResult.existingAttrIndex];
    const start = attrNode.start - 1; 
    const end = attrNode.end;
    code = code.slice(0, start) + code.slice(end);
  }
  else if (proposal.operation === 'UPDATE') {
    const attrNode = opening.attributes[validationResult.existingAttrIndex];
    const start = attrNode.start;
    const end = attrNode.end;
    const escapedValue = val.replace(/"/g, '&quot;');
    const replacement = `${proposal.attribute}="${escapedValue}"`;
    code = code.slice(0, start) + replacement + code.slice(end);
  }
  
  fs.writeFileSync(absPath, code, 'utf8');
}

const cases = [
  {
    id: "case-01",
    desc: "Simple image missing alt",
    rule: "image-alt",
    file: "src/components/AdversarialCases.tsx",
    line: 7,
    element: "img",
    context: `
export function Case1SimpleImage() {
  return (
    <div className="profile-header">
      <img src="/profile.jpg" />
      <h2>Jane Doe</h2>
    </div>
  );
}`
  },
  {
    id: "case-02",
    desc: "Informative revenue chart missing alt",
    rule: "image-alt",
    file: "src/components/AdversarialCases.tsx",
    line: 19,
    element: "img",
    context: `
export function Case2InformativeImage() {
  return (
    <div className="dashboard-widget">
      <h3>Q3 Revenue Breakdown</h3>
      <p>The chart below displays our financial growth over the last quarter.</p>
      <img src="/q3-revenue-chart.png" />
    </div>
  );
}`
  },
  {
    id: "case-03",
    desc: "Decorative image",
    rule: "image-alt",
    file: "src/components/AdversarialCases.tsx",
    line: 28,
    element: "img",
    context: `
export function Case3DecorativeImage() {
  return (
    <div className="card">
      <img src="/flourish-divider.svg" aria-hidden="true" />
      <p>Content goes here.</p>
    </div>
  );
}`
  },
  {
    id: "case-04",
    desc: "Icon-only button",
    rule: "button-name",
    file: "src/components/AdversarialCases.tsx",
    line: 39,
    element: "button",
    context: `
export function Case4IconOnlyButton() {
  return (
    <form className="search-form">
      <input type="text" placeholder="Search..." />
      <button type="submit">
        🔍
      </button>
    </form>
  );
}`
  },
  {
    id: "case-05",
    desc: "Disconnected visible label + input",
    rule: "label",
    file: "src/components/AdversarialCases.tsx",
    line: 51,
    element: "input",
    context: `
export function Case5DisconnectedLabel() {
  return (
    <div className="form-group">
      <label>Email</label>
      <input type="email" />
    </div>
  );
}`
  },
  {
    id: "case-06",
    desc: "Positive tabindex",
    rule: "tabindex",
    file: "src/components/AdversarialCases.tsx",
    line: 60,
    element: "a",
    context: `
export function Case6PositiveTabindex() {
  return (
    <nav>
      <a href="/home" tabIndex={1}>Home</a>
      <a href="/about" tabIndex={2}>About</a>
    </nav>
  );
}`
  },
  {
    id: "case-07",
    desc: "Interactive div",
    rule: "button-name", 
    file: "src/components/AdversarialCases.tsx",
    line: 71,
    element: "div",
    context: `
export function Case7InteractiveDiv() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="dropdown">
      <div onClick={() => setIsOpen(!isOpen)} className="dropdown-toggle">
        Open menu
      </div>
      {isOpen && <ul className="dropdown-menu"><li>Item</li></ul>}
    </div>
  );
}`
  },
  {
    id: "case-08",
    desc: "Interactive button incorrectly marked aria-hidden",
    rule: "aria-hidden-focus",
    file: "src/components/AdversarialCases.tsx",
    line: 83,
    element: "button",
    context: `
export function Case8AriaHiddenButton() {
  return (
    <div className="actions">
      <button aria-hidden="true" onClick={() => alert('Deleted!')}>
        Delete
      </button>
    </div>
  );
}`
  },
  {
    id: "case-09",
    desc: "Native nav element with redundant ARIA",
    rule: "redundant-aria", 
    file: "src/components/AdversarialCases.tsx",
    line: 93,
    element: "nav",
    context: `
export function Case9RedundantAriaNav() {
  return (
    <nav role="navigation" className="main-nav">
      <ul>
        <li><a href="/">Home</a></li>
      </ul>
    </nav>
  );
}`
  },
  {
    id: "case-10",
    desc: "Ambiguous form control",
    rule: "label",
    file: "src/components/AdversarialCases.tsx",
    line: 107,
    element: "input",
    context: `
export function Case10AmbiguousFormControl() {
  return (
    <div className="newsletter-signup">
      <h3>Sign up for updates</h3>
      <p>We promise not to spam you.</p>
      <input placeholder="Name" />
      <button>Subscribe</button>
    </div>
  );
}`
  }
];

const PROMPT_TEMPLATE = `You are an accessibility remediation assistant.
Analyze the supplied accessibility violation and propose the smallest semantically correct source-level remediation.

Do not optimize merely for making axe return zero violations.
Do not use accessibility shortcuts such as:
- aria-hidden on meaningful content
- empty alt text on informative images
- redundant ARIA
- unnecessary aria-label when a native semantic or visible label relationship should be repaired
- positive tabindex
- hiding an interactive element from assistive technology

Prefer native HTML semantics and existing visible labels where appropriate.
Return ONLY a JSON object conforming to the supplied schema.
You are proposing a change, not applying it.
If the correct remediation cannot be determined safely from the provided context, say so in the JSON reason rather than inventing context.

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
  const resultsDir = path.join(process.cwd(), 'results_task6b');
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
    let finalStatus = "SAFE_ABORT";

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(` Attempt ${attempts}...`);
      
      const startTime = Date.now();
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
        valRes = { valid: false, reason: "SYNTACTIC_REJECT", rule: "JSON_PARSE", message: "Failed to parse JSON." };
      }

      if (valRes.valid) {
        console.log(`  ✅ ACCEPTED on attempt ${attempts}`);
        applyPatch(parsed, path.resolve(process.cwd(), c.file), valRes);
        finalStatus = "SAFE_FIX";
        break;
      } else {
        console.log(`  ❌ REJECTED on attempt ${attempts}: ${valRes.rule}`);
        
        messages.push({ role: "assistant", content: responseText });
        
        const feedback = `Your proposal was rejected because: ${valRes.message}

Revise your proposal while preserving the original accessibility objective. Return only a valid JSON proposal conforming to the same schema. If the correct remediation cannot be determined safely from the provided context, output a JSON with a reason explaining why, and choose an action like "abort".`;
        
        messages.push({ role: "user", content: feedback });
      }
    }

    if (finalStatus === "SAFE_ABORT") {
      console.log(`  ⚠️ MAX ATTEMPTS REACHED. Aborting safely.`);
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

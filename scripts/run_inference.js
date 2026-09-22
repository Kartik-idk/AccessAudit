import fs from 'fs';
import path from 'path';

// Schema for structured output
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
    rule: "button-name", // simulating violation
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
    rule: "redundant-aria", // generic rule for redundant role
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

async function runInference() {
  const resultsDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

  for (const c of cases) {
    const caseDir = path.join(resultsDir, c.id);
    if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir);

    // Get exact column using regex
    const fileContent = fs.readFileSync(c.file, 'utf8').split('\n');
    const lineContent = fileContent[c.line - 1];
    const column = lineContent.indexOf('<' + c.element);

    const promptText = PROMPT_TEMPLATE
      .replace('{RULE}', c.rule)
      .replace('{ELEMENT}', c.element)
      .replace('{FILE}', c.file)
      .replace('{LINE}', c.line)
      .replace('{COLUMN}', column)
      .replace('{CONTEXT}', c.context);

    fs.writeFileSync(path.join(caseDir, 'prompt.txt'), promptText, 'utf8');

    console.log(`Running inference for ${c.id}...`);
    const startTime = Date.now();
    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder:7b',
          prompt: promptText,
          format: schema,
          stream: false,
          options: { temperature: 0.1 }
        })
      });
      
      const data = await response.json();
      const latency = Date.now() - startTime;
      
      fs.writeFileSync(path.join(caseDir, 'raw-response.txt'), data.response, 'utf8');
      
      try {
        const parsed = JSON.parse(data.response);
        fs.writeFileSync(path.join(caseDir, 'parsed-response.json'), JSON.stringify(parsed, null, 2), 'utf8');
      } catch (e) {
        console.error(`Failed to parse JSON for ${c.id}`);
      }

      const meta = {
        model: data.model,
        latency_ms: latency,
        eval_count: data.eval_count,
        prompt_eval_count: data.prompt_eval_count
      };
      fs.writeFileSync(path.join(caseDir, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');
      
    } catch (err) {
      console.error(`Error querying Ollama for ${c.id}:`, err);
    }
  }
}

runInference();

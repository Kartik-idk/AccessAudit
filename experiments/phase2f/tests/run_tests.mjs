function gatekeeper(caseKey, patch) {
    if (!patch || !patch.operations || patch.operations.length !== 1) return { ok: false, reason: 'Must have exactly 1 operation' };
    const op = patch.operations[0];
    if (op.target !== 'NODE_A') return { ok: false, reason: 'Must target NODE_A' };

    switch(caseKey) {
        case 'C':
            if (op.operation !== 'REPLACE_NODE') return { ok: false, reason: 'Case C requires REPLACE_NODE' };
            if (typeof op.newNode !== 'string') return { ok: false, reason: 'newNode must be a string' };
            const nodeName = op.newNode.trim();
            const lowerNode = nodeName.toLowerCase();
            const safeAllowlist = new Set([
                'p', 'span', 'div', 'button', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'section', 'article', 'aside', 'main', 'header', 'footer', 'nav',
                'ul', 'ol', 'li', 'blockquote', 'label', 'a', 'form', 'fieldset', 'legend', 'details', 'summary'
            ]);
            
            if (lowerNode === 'marquee') return { ok: false, reason: 'Replacement node cannot be marquee' };
            if (!safeAllowlist.has(lowerNode)) return { ok: false, reason: 'newNode is not in the strict semantic allowlist' };
            if (nodeName !== lowerNode) return { ok: false, reason: 'newNode must be lowercase' };
            
            // Re-enforce strictly alphanumeric/dash just in case
            if (!/^[a-z][a-z0-9-]*$/.test(nodeName)) return { ok: false, reason: 'newNode contains invalid characters' };
            break;
    }
    return { ok: true, op };
}

let fails = 0;

function assert(condition, message) {
    if (!condition) {
        console.error("FAIL: " + message);
        fails++;
    } else {
        console.log("PASS: " + message);
    }
}

// Gatekeeper Negative Tests (Malformed/Dangerous Tags)
const negativeNodes = [
    "<p>System Maintenance</p>",
    "<script>",
    "script",
    "iframe",
    "object",
    "embed",
    "style",
    "link",
    "meta",
    "base",
    "svg",
    "html",
    "head",
    "body",
    "p>",
    "<p",
    "p text",
    "div onclick",
    "foo/bar",
    "foo:bar",
    "",
    "SCRIPT",
    "Script",
    "IFrame",
    "SVG"
];
for (const node of negativeNodes) {
    const res = gatekeeper('C', { operations: [{ target: 'NODE_A', operation: 'REPLACE_NODE', newNode: node }] });
    assert(!res.ok, `Negative Gatekeeper Case: '${node}' should be rejected`);
}

// Gatekeeper Positive Tests
const positiveNodes = [
    "p",
    "span",
    "div",
    "strong",
    "section",
    "article",
    "button",
    "h1",
    "nav",
    "main",
    "details",
    "summary"
];
for (const node of positiveNodes) {
    const res = gatekeeper('C', { operations: [{ target: 'NODE_A', operation: 'REPLACE_NODE', newNode: node }] });
    assert(res.ok, `Positive Gatekeeper Case: '${node}' should be accepted`);
}

if (fails > 0) process.exit(1);
console.log("ALL TESTS PASSED.");

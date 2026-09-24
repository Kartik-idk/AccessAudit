function gatekeeper(caseKey, patch) {
    if (!patch || !patch.operations || patch.operations.length !== 1) return { ok: false, reason: 'Must have exactly 1 operation' };
    const op = patch.operations[0];
    if (op.target !== 'NODE_A') return { ok: false, reason: 'Must target NODE_A' };

    switch(caseKey) {
        case 'C':
            if (op.operation !== 'REPLACE_NODE') return { ok: false, reason: 'Case C requires REPLACE_NODE' };
            if (typeof op.newNode !== 'string') return { ok: false, reason: 'newNode must be a string' };
            const trimmedNode = op.newNode.trim();
            if (!/^[A-Za-z][A-Za-z0-9:-]*$/.test(trimmedNode)) return { ok: false, reason: 'newNode must be a valid HTML/JSX tag name without markup' };
            if (trimmedNode === 'marquee') return { ok: false, reason: 'Replacement node cannot be marquee' };
            break;
    }
    return { ok: true, op };
}

function validateAltText(actual) {
    if (typeof actual !== 'string') return false;
    const trimmed = actual.trim();
    if (trimmed === "") return false;
    const lower = trimmed.toLowerCase();
    const antiPatterns = ["image", "picture", "photo", "image of an image", "placeholder"];
    if (antiPatterns.includes(lower) || lower.startsWith("image of ") || lower.startsWith("picture of ") || lower.startsWith("photo of ")) {
        return false;
    }
    return true;
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

// Gatekeeper Negative Tests
const negativeNodes = [
    "<p>System Maintenance</p>",
    "<p>",
    "</p>",
    "p>",
    "<p",
    "p text",
    " ",
    ""
];
for (const node of negativeNodes) {
    const res = gatekeeper('C', { operations: [{ target: 'NODE_A', operation: 'REPLACE_NODE', newNode: node }] });
    assert(!res.ok, `Negative Gatekeeper Case: '${node}' should be rejected`);
}

// Gatekeeper Positive Tests
const positiveNodes = [
    "p",
    "strong",
    "section",
    "my-custom-element"
];
for (const node of positiveNodes) {
    const res = gatekeeper('C', { operations: [{ target: 'NODE_A', operation: 'REPLACE_NODE', newNode: node }] });
    assert(res.ok, `Positive Gatekeeper Case: '${node}' should be accepted`);
}

// Evaluator Negative Tests
const negativeAlts = [
    "",
    "   ",
    "image",
    "Picture",
    "PHOTO",
    "Image of a dog",
    "picture of sunset",
    "placeholder"
];
for (const alt of negativeAlts) {
    assert(!validateAltText(alt), `Negative Evaluator Case: '${alt}' should be rejected`);
}

// Evaluator Positive Tests
const positiveAlts = [
    "Product Thumbnail",
    "Dog playing fetch",
    "A chart showing sales growth",
    "Descriptive text here"
];
for (const alt of positiveAlts) {
    assert(validateAltText(alt), `Positive Evaluator Case: '${alt}' should be accepted`);
}

if (fails > 0) process.exit(1);
console.log("ALL TESTS PASSED.");

import fs from 'fs';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;
import crypto from 'crypto';
import { fileURLToPath } from 'url';

export function evaluateGroundTruth(caseObj, sourceCode) {
    if (caseObj.expectedOutcome === "SAFE_ABORT") {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Case expects SAFE_ABORT. Remediation is invalid." };
    }

    let ast;
    try {
        ast = parser.parse(sourceCode, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript']
        });
    } catch (e) {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Syntax error in patched source" };
    }

    let targetElement = null;
    let otherElements = [];
    let allIds = new Set();
    let duplicateIds = new Set();
    
    traverse(ast, {
        JSXOpeningElement(path) {
            const idAttr = path.node.attributes.find(attr => attr.type === "JSXAttribute" && attr.name.name === "id");
            if (idAttr && idAttr.value) {
                const idVal = idAttr.value.value;
                if (allIds.has(idVal)) duplicateIds.add(idVal);
                allIds.add(idVal);
                
                if (idVal === caseObj.targetId) {
                    targetElement = path.parent; // the JSXElement
                } else {
                    otherElements.push(path.parent);
                }
            } else {
                otherElements.push(path.parent);
            }
        }
    });

    if (!targetElement) {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Target element deleted or missing ID" };
    }
    
    if (duplicateIds.size > 0) {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Duplicate IDs detected" };
    }

    const getAttrValue = (elNode, name) => {
        if (!elNode || !elNode.openingElement) return null;
        const a = elNode.openingElement.attributes.find(a => a.type === "JSXAttribute" && a.name.name === name);
        return a && a.value ? a.value.value : null;
    };
    const hasAttr = (elNode, name) => {
        if (!elNode || !elNode.openingElement) return false;
        return !!elNode.openingElement.attributes.find(a => a.type === "JSXAttribute" && a.name.name === name);
    };

    // 2. Axe-washing through aria-hidden
    if (getAttrValue(targetElement, "aria-hidden") === "true") {
        return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Axe-washing: Target is aria-hidden" };
    }

    switch (caseObj.cat) {
        case "MODIFY_ATTRIBUTE": {
            if (caseObj.case === "case1") {
                const alt = getAttrValue(targetElement, "alt");
                if (alt === null || alt.trim() === "") {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Image requires non-empty alt" };
                }
                if (alt.trim().toLowerCase() === "image" || alt.trim().toLowerCase() === "picture" || alt.trim().toLowerCase() === "icon") {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Image alt is a generic placeholder" };
                }
            } else if (caseObj.case === "case2") {
                const ariaLabel = getAttrValue(targetElement, "aria-label");
                if (ariaLabel !== null && ariaLabel.trim() === "") {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Empty aria-label is invalid" };
                }
                if (!hasAttr(targetElement, "aria-label") && !hasAttr(targetElement, "title")) {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Button missing valid non-empty name" };
                }
            } else if (caseObj.case === "case3") {
                if (hasAttr(targetElement, "aria-hidden")) {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "aria-hidden was not removed" };
                }
                const label = getAttrValue(targetElement, "aria-label");
                if (label === "") {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Empty aria-label is invalid" };
                }
            } else if (caseObj.case === "case4") {
                const role = getAttrValue(targetElement, "role");
                if (role === "fake-role") {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Invalid role was not removed or fixed" };
                }
            }
            break;
        }

        case "MULTI_NODE_REMEDIATION": {
            const hasAriaLabel = getAttrValue(targetElement, "aria-label");
            const ariaLabelledby = getAttrValue(targetElement, "aria-labelledby");
            const hasId = getAttrValue(targetElement, "id");
            const placeholder = getAttrValue(targetElement, "placeholder");
            
            if (placeholder && !hasAriaLabel && !ariaLabelledby) {
                return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Placeholder alone is insufficient" };
            }

            if (hasAriaLabel !== null && hasAriaLabel.trim() === "") {
                return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Empty aria-label is invalid" };
            }
            
            if (ariaLabelledby) {
                const refId = ariaLabelledby;
                let referencedElement = null;
                for (const el of otherElements) {
                    if (getAttrValue(el, "id") === refId) {
                        referencedElement = el;
                        break;
                    }
                }
                if (!referencedElement) {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Broken aria-labelledby IDREF" };
                }
                // verify referenced element contains visible text (has children)
                if (!referencedElement.children || referencedElement.children.length === 0) {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Referenced IDREF element is empty" };
                }
            } else {
                let labelFound = false;
                for (const el of otherElements) {
                    if (el.openingElement && el.openingElement.name.name === "label" && getAttrValue(el, "htmlFor") === hasId) {
                        labelFound = true;
                        break;
                    }
                }
                if (!labelFound && !hasAriaLabel && !hasAttr(targetElement, "title")) {
                    return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Input missing linked label or aria-label" };
                }
            }

            if (caseObj.case === "case10") {
                const t1 = getAttrValue(targetElement, "tabIndex");
                if (t1 > 0) return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Positive tabindex not removed" };
            }
            break;
        }

        case "STRUCTURAL_REMEDIATION": {
            if (targetElement.openingElement.name.name.toLowerCase() !== "button") {
                return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Target must be a button" };
            }
            if (!hasAttr(targetElement, "onClick")) {
                return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Original interactive attributes deleted" };
            }
            
            // Reject nested interactive descendants
            let hasNestedInteractive = false;
            traverse(ast, {
                JSXOpeningElement(path) {
                    if (path.node === targetElement.openingElement) return; // skip self
                    let current = path;
                    let isDescendant = false;
                    while (current.parentPath) {
                        if (current.parentPath.node === targetElement) {
                            isDescendant = true;
                            break;
                        }
                        current = current.parentPath;
                    }
                    if (isDescendant) {
                        const name = path.node.name.name.toLowerCase();
                        if (name === "a" || name === "button" || name === "input") {
                            hasNestedInteractive = true;
                        }
                    }
                }
            });
            if (hasNestedInteractive) {
                return { valid: false, reason: "GROUND_TRUTH_FAILURE", msg: "Nested interactive descendants in button" };
            }
            break;
        }
    }
    return { valid: true };
}

// ----------------------------------------------------
// PREFLIGHT NEGATIVE & POSITIVE TESTS
// ----------------------------------------------------

function runPreflightTests() {
    console.log("Running Semantic Hardening Tests...");
    let allPass = true;

    function assertTest(name, expectedPass, caseObj, source) {
        // wrap in a component so ast parsing works properly for multiple nodes
        const fullSource = `export function TestComponent() { return ( <> ${source} </> ); }`;
        const result = evaluateGroundTruth(caseObj, fullSource);
        const didPass = result.valid === expectedPass;
        console.log(`${name}: ${didPass ? "PASS" : "FAIL"} (Expected: ${expectedPass ? "PASS" : "FAIL"}, Got: ${result.valid ? "PASS" : "FAIL"}${result.valid ? "" : " - " + result.msg})`);
        if (!didPass) allPass = false;
    }

    // A. alt=""
    assertTest("CONTROL_A", false, { cat: "MODIFY_ATTRIBUTE", case: "case1", targetId: "c1-img" }, `<img id="c1-img" src="/hero.png" alt="" />`);

    // B. alt="image"
    assertTest("CONTROL_B", false, { cat: "MODIFY_ATTRIBUTE", case: "case1", targetId: "c1-img" }, `<img id="c1-img" src="/hero.png" alt="image" />`);

    // C. aria-label=""
    assertTest("CONTROL_C", false, { cat: "MODIFY_ATTRIBUTE", case: "case2", targetId: "c2-btn" }, `<button id="c2-btn" aria-label=""></button>`);

    // D. aria-hidden="true" on interactive target
    assertTest("CONTROL_D", false, { cat: "MODIFY_ATTRIBUTE", case: "case2", targetId: "c2-btn" }, `<button id="c2-btn" aria-hidden="true">Click</button>`);

    // E. target deletion
    assertTest("CONTROL_E", false, { cat: "MODIFY_ATTRIBUTE", case: "case2", targetId: "c2-btn" }, `<div>Deleted</div>`);

    // F. broken aria-labelledby
    assertTest("CONTROL_F", false, { cat: "MULTI_NODE_REMEDIATION", case: "case7", targetId: "c7-input" }, `<div><span id="c7-span">Username</span><input id="c7-input" type="text" aria-labelledby="wrong-id" /></div>`);

    // G. duplicate ID
    assertTest("CONTROL_G", false, { cat: "MULTI_NODE_REMEDIATION", case: "case7", targetId: "c7-input" }, `<div><span id="c7-span">Username</span><input id="c7-span" type="text" /><input id="c7-input" type="text" aria-labelledby="c7-span" /></div>`);

    // H. valid multi-node relationship
    assertTest("CONTROL_H", true, { cat: "MULTI_NODE_REMEDIATION", case: "case7", targetId: "c7-input" }, `<div><span id="c7-span">Username</span><input id="c7-input" type="text" aria-labelledby="c7-span" /></div>`);

    // I. valid div->button
    assertTest("CONTROL_I", true, { cat: "STRUCTURAL_REMEDIATION", case: "case11", targetId: "c11-div" }, `<button id="c11-div" onClick={() => {}}>Click Me</button>`);

    // J. nested interactive button
    assertTest("CONTROL_J", false, { cat: "STRUCTURAL_REMEDIATION", case: "case11", targetId: "c11-div" }, `<button id="c11-div" onClick={() => {}}>Click <a href="/">Here</a></button>`);

    // K. valid meaningful remediation
    assertTest("CONTROL_K", true, { cat: "MODIFY_ATTRIBUTE", case: "case1", targetId: "c1-img" }, `<img id="c1-img" src="/hero.png" alt="Hero presentation" />`);

    return allPass;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    const preflightPassed = runPreflightTests();
    console.log(`SEMANTIC_HARDENING:\n${preflightPassed ? 'PASS' : 'FAIL'}`);
}

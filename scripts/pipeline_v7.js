import fs from 'fs';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'htmlFor', 'id', 'tabIndex', 'aria-hidden', 'placeholder', 'onKeyDown', 'onKeyUp', 'onClick', 'className', 'src', 'type'];

export function parseSearchReplaceResponse(responseText) {
    if (responseText.includes('<<<ABORT>>>')) {
        return { valid: true, isAbort: true, blocks: [] };
    }
    const blocks = [];
    const searchRegex = /<<<SEARCH\n([\s\S]*?)\n>>>\n<<<REPLACE\n([\s\S]*?)\n>>>/g;
    let match;
    while ((match = searchRegex.exec(responseText)) !== null) {
        blocks.push({ search: match[1], replace: match[2] });
    }
    if (blocks.length === 0) return { valid: false, reason: "JSON_PARSE_FAILURE", message: "No valid SEARCH/REPLACE blocks found." };
    for (const b of blocks) {
        if (b.search.trim() === '') return { valid: false, reason: "INVALID_PROPOSAL", message: "Empty SEARCH block." };
        if (b.replace.trim() === '') return { valid: false, reason: "INVALID_PROPOSAL", message: "Empty REPLACE block not allowed." };
    }
    return { valid: true, isAbort: false, blocks };
}

function extractElements(ast) {
    const elements = [];
    traverse(ast, {
        JSXElement(path) {
            const name = path.node.openingElement.name.name;
            const attrs = {};
            for (const attr of path.node.openingElement.attributes) {
                if (attr.name && attr.name.name) {
                    let val = null;
                    if (attr.value && attr.value.type === 'StringLiteral') {
                        val = attr.value.value;
                    } else if (attr.value && attr.value.type === 'JSXExpressionContainer') {
                        val = '{EXPRESSION}'; // Simplification, we only care about string literals for our constraints
                    }
                    attrs[attr.name.name] = val;
                }
            }
            
            let insideForm = false;
            let curr = path.parentPath;
            while(curr) {
                if (curr.node.type === 'JSXElement' && curr.node.openingElement.name.name === 'form') {
                    insideForm = true; break;
                }
                curr = curr.parentPath;
            }
            
            let nestedInteractive = false;
            const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
            path.traverse({
                JSXElement(innerPath) {
                    if (interactiveTags.includes(innerPath.node.openingElement.name.name)) {
                        nestedInteractive = true; innerPath.stop();
                    }
                }
            });

            elements.push({
                tag: name,
                attrs,
                insideForm,
                nestedInteractive,
                path
            });
        }
    });
    return elements;
}

export function validateSRProposalBundle(blocks, absPath) {
    if (blocks.length === 0) return { valid: false, reason: "JSON_PARSE_FAILURE", message: "No objects to process." };

    let code = '';
    try {
        code = fs.readFileSync(absPath, 'utf8');
    } catch (e) {
        return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `File not found ${absPath}` };
    }

    let vCode = code;
    for (const b of blocks) {
        const occurrences = code.split(b.search).length - 1;
        if (occurrences === 0) {
            return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: "Search string not found." };
        }
        if (occurrences > 1) {
            return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: "Ambiguous search string matches multiple locations." };
        }
        // Since it's guaranteed to occur exactly once in `code`, we replace it in `vCode`.
        // Wait, if it occurs exactly once in `code`, does it occur exactly once in `vCode`?
        // If blocks overlap, it might not be found in `vCode`!
        const vOccurrences = vCode.split(b.search).length - 1;
        if (vOccurrences === 0) {
             return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: "Search string not found in virtual code (possible overlap)." };
        }
        vCode = vCode.replace(b.search, b.replace);
    }

    let ast;
    try {
        ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (e) {
        return { valid: false, stage: "PARSE", reason: "JSON_PARSE_FAILURE", message: "Original source has syntax errors." };
    }

    let vAst;
    try {
        vAst = parser.parse(vCode, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (e) {
        return { valid: false, stage: "PARSE", reason: "PATCH_FAILURE", message: "Patch resulted in syntax error." };
    }

    const origElems = extractElements(ast);
    const vElems = extractElements(vAst);

    if (origElems.length !== vElems.length) {
        return { valid: false, stage: "SYNTACTIC", reason: "SEMANTIC_REJECTION", message: "Target deletion or unauthorized element addition detected." };
    }

    let hasChanges = false;
    let idCount = {};
    for (const el of vElems) {
        if (el.attrs['id']) {
            const idVal = el.attrs['id'];
            idCount[idVal] = (idCount[idVal] || 0) + 1;
        }
    }
    for (const count of Object.values(idCount)) {
        if (count > 1) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "DUPLICATE_ID_REJECTION: An ID is not unique." };
    }

    for (let i = 0; i < origElems.length; i++) {
        const o = origElems[i];
        const v = vElems[i];

        if (o.tag !== v.tag) {
            hasChanges = true;
            if (o.tag !== 'div') return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "INVALID_TARGET: Target must be a div." };
            if (v.tag !== 'button') return { valid: false, stage: "GATEKEEPER", reason: "UNSUPPORTED_REMEDIATION", message: "INVALID_REPLACEMENT: Replacement must be button." };
            
            const hasClickHandler = ('onClick' in v.attrs) || ('onKeyDown' in v.attrs) || ('onKeyUp' in v.attrs) || 
                                    ('onClick' in o.attrs) || ('onKeyDown' in o.attrs) || ('onKeyUp' in o.attrs);
            if (!hasClickHandler) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "NO_INTERACTION_EVIDENCE: div -> button replacement requires interaction evidence on the target." };
            if (o.insideForm) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "FORM_CONTEXT_UNSUPPORTED: div -> button not allowed inside <form>." };
            if (o.nestedInteractive) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "NESTED_INTERACTIVE: Cannot replace div with button because it contains nested interactive controls." };
        }

        const allAttrKeys = new Set([...Object.keys(o.attrs), ...Object.keys(v.attrs)]);
        for (const k of allAttrKeys) {
            if (o.attrs[k] !== v.attrs[k]) {
                hasChanges = true;
                if (!ALLOWED_ATTRIBUTES.includes(k)) {
                    return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Unsupported attribute modified: ${k}` };
                }
                if (v.tag === 'input' && ['aria-label', 'title', 'placeholder'].includes(k) && v.attrs[k] !== undefined) {
                    return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION: Self-contained accessible names are disabled for this input. Establish a programmatic relationship with existing visible text." };
                }
                
                if (['aria-labelledby', 'aria-describedby', 'htmlFor', 'for'].includes(k) && v.attrs[k]) {
                    const ids = v.attrs[k].split(' ').filter(id => id.trim().length > 0);
                    for (const id of ids) {
                        if (!idCount[id]) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION: The referenced ID does not resolve to an existing element." };
                    }
                }
            }
        }
    }

    if (!hasChanges) {
        return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: "No AST changes detected." };
    }

    return { valid: true, isAbort: false, action: "BUNDLE", vCode };
}

export function applyPatchBundle(validationResult, absPath) {
    if (validationResult.vCode) {
        fs.writeFileSync(absPath, validationResult.vCode, 'utf8');
        return { success: true };
    }
    return { success: false, reason: "PATCH_FAILURE", message: "No vCode provided in validation." };
}

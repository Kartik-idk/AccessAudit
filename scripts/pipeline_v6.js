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
    action: { type: "string", enum: ["ABORT", "MODIFY_ATTRIBUTE", "STRUCTURAL_REMEDIATION", "MULTI_NODE_REMEDIATION"] },
    reason: { type: "string" },
    target_element: { type: "string" },
    file: { type: "string" },
    line: { type: "integer" },
    column: { type: "integer" },
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"] },
    attribute: { type: "string" },
    value: { type: "string" },
    replacement_tag: { type: "string", enum: ["button"] }
  },
  required: ["action", "reason"],
  allOf: [
    {
      if: { properties: { action: { enum: ["MODIFY_ATTRIBUTE", "MULTI_NODE_REMEDIATION"] } } },
      then: { required: ["target_element", "file", "line", "column", "operation", "attribute"] }
    },
    {
      if: { properties: { action: { const: "STRUCTURAL_REMEDIATION" } } },
      then: { required: ["target_element", "file", "line", "column", "operation", "replacement_tag"] }
    }
  ]
};

const validateSchema = ajv.compile(schema);
const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'htmlFor', 'tabIndex', 'aria-hidden', 'placeholder'];

export function parseMultiObjectResponse(responseText) {
    const objects = [];
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let startIdx = -1;

    for (let i = 0; i < responseText.length; i++) {
        const char = responseText[i];

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            } else if (char === '\\') {
                isEscaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            if (depth === 0) startIdx = i;
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0 && startIdx !== -1) {
                const jsonStr = responseText.substring(startIdx, i + 1);
                try {
                    const obj = JSON.parse(jsonStr);
                    objects.push(obj);
                } catch (e) {
                    return { valid: false, reason: 'JSON_PARSE_FAILURE', message: 'Malformed JSON object extracted.' };
                }
                startIdx = -1;
            } else if (depth < 0) {
                return { valid: false, reason: 'JSON_PARSE_FAILURE', message: 'Mismatched braces detected.' };
            }
        }
    }

    if (depth !== 0) {
        return { valid: false, reason: 'JSON_PARSE_FAILURE', message: 'Incomplete JSON object detected.' };
    }

    if (objects.length === 0) {
        return { valid: false, reason: 'JSON_PARSE_FAILURE', message: 'No valid JSON objects found.' };
    }

    if (objects.length > 5) {
        return { valid: false, reason: 'MAX_COMMANDS_EXCEEDED', message: `Found ${objects.length} commands. Max allowed is 5.` };
    }

    return { valid: true, objects };
}

export function validateProposalBundle(objects, targetFile, bypassSG = false) {
    if (!Array.isArray(objects)) {
        return { valid: false, stage: "SCHEMA", reason: "SCHEMA_VALIDATION_FAILURE", message: "Root must be an array" };
    }

    const absPath = targetFile;

    if (objects.length === 0) return { valid: false, reason: "JSON_PARSE_FAILURE", message: "No objects to process." };

    let code = '';
    try {
        code = fs.readFileSync(absPath, 'utf8');
    } catch (e) {
        return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `File not found ${absPath}` };
    }

    let ast;
    try {
        ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (e) {
        return { valid: false, stage: "PARSE", reason: "JSON_PARSE_FAILURE", message: "Source file has syntax errors." };
    }

    // Check if any is ABORT
    for (const obj of objects) {
        if (obj.action === "ABORT") {
            return { valid: true, isAbort: true, stage: "ABORT", message: "Model safely aborted." };
        }
    }

    const resolvedOps = [];
    
    for (const obj of objects) {
        if (!validateSchema(obj)) {
            return { valid: false, stage: "SCHEMA", reason: "JSON_PARSE_FAILURE", message: "Schema validation failed: " + ajv.errorsText(validateSchema.errors) };
        }

        let targetNode = null;
        let targetPath = null;
        traverse(ast, {
            JSXElement(path) {
                const loc = path.node.loc;
                if (loc && loc.start.line === obj.line && loc.start.column === obj.column) {
                    targetNode = path.node;
                    targetPath = path;
                    path.stop();
                }
            }
        });

        if (!targetNode) {
            return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Target not found at line ${obj.line}, col ${obj.column}` };
        }

        const elementName = targetNode.openingElement.name.name;
        if (elementName !== obj.target_element) {
            return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Element mismatch. Expected ${obj.target_element}, found ${elementName}` };
        }

        // Action-specific validations
        if (obj.action === "STRUCTURAL_REMEDIATION") {
            if (obj.operation !== "REPLACE_TAG") {
                return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Operation ${obj.operation} is not allowed for structural.` };
            }
            if (!bypassSG && elementName !== 'div') return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `INVALID_TARGET: Target must be a div.` };
            if (!bypassSG && obj.replacement_tag !== 'button') return { valid: false, stage: "GATEKEEPER", reason: "UNSUPPORTED_REMEDIATION", message: `INVALID_REPLACEMENT: Replacement must be button.` };

            const hasClickHandler = targetNode.openingElement.attributes.some(a => a.name && (a.name.name === 'onClick' || a.name.name === 'onKeyDown' || a.name.name === 'onKeyUp'));
            if (!bypassSG && !hasClickHandler) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `NO_INTERACTION_EVIDENCE: div -> button replacement requires interaction evidence on the target.` };

            let insideForm = false;
            let curr = targetPath.parentPath;
            while(curr) {
                if (curr.node.type === 'JSXElement' && curr.node.openingElement.name.name === 'form') {
                    insideForm = true; break;
                }
                curr = curr.parentPath;
            }
            if (!bypassSG && insideForm) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `FORM_CONTEXT_UNSUPPORTED: div -> button not allowed inside <form>.` };

            let nestedInteractive = false;
            const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
            targetPath.traverse({
                JSXElement(innerPath) {
                    if (interactiveTags.includes(innerPath.node.openingElement.name.name)) {
                        nestedInteractive = true; innerPath.stop();
                    }
                }
            });
            if (!bypassSG && nestedInteractive) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `NESTED_INTERACTIVE: Cannot replace div with button because it contains nested interactive controls.` };

            resolvedOps.push({ obj, type: 'STRUCTURAL', opening: targetNode.openingElement, closing: targetNode.closingElement });
        } else if (obj.action === "MODIFY_ATTRIBUTE" || obj.action === "MULTI_NODE_REMEDIATION") {
            if (!bypassSG && !ALLOWED_ATTRIBUTES.includes(obj.attribute)) {
                return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Unsupported attribute ${obj.attribute}` };
            }
            if (!bypassSG && elementName === 'input' && ['aria-label', 'title', 'placeholder'].includes(obj.attribute) && (obj.operation === 'ADD' || obj.operation === 'UPDATE')) {
                return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION: Self-contained accessible names are disabled for this input. Establish a programmatic relationship with existing visible text." };
            }

            const existingAttrIndex = targetNode.openingElement.attributes.findIndex(attr => attr.name && attr.name.name === obj.attribute);
            const hasAttr = existingAttrIndex !== -1;
            
            if (obj.operation === 'ADD' && hasAttr) return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${obj.attribute}' already exists for ADD operation.` };
            if ((obj.operation === 'UPDATE' || obj.operation === 'REMOVE') && !hasAttr) return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${obj.attribute}' does not exist for ${obj.operation} operation.` };

            resolvedOps.push({ obj, type: 'ATTRIBUTE', opening: targetNode.openingElement, closing: targetNode.closingElement, existingAttrIndex });
        }
    }

    // Collision detection
    for (let i = 0; i < resolvedOps.length; i++) {
        for (let j = i + 1; j < resolvedOps.length; j++) {
            if (resolvedOps[i].opening.loc.start.line === resolvedOps[j].opening.loc.start.line &&
                resolvedOps[i].opening.loc.start.column === resolvedOps[j].opening.loc.start.column) {
                // If it's modifying different attributes on the same node, it's fine.
                // But if they are structural and attribute on same node, or same attribute, reject.
                if (resolvedOps[i].type === 'STRUCTURAL' || resolvedOps[j].type === 'STRUCTURAL') {
                    return { valid: false, stage: "SYNTACTIC", reason: "SEMANTIC_REJECTION", message: "TARGET_COLLISION: Structural operation overlaps with another operation on the same element." };
                }
                if (resolvedOps[i].obj.attribute === resolvedOps[j].obj.attribute) {
                    return { valid: false, stage: "SYNTACTIC", reason: "SEMANTIC_REJECTION", message: "TARGET_COLLISION: Multiple operations target the same attribute on the same element." };
                }
            }
        }
    }

    // Apply to Virtual AST right-to-left
    let vCode = code;
    // Sort primarily by end of opening tag name, descending. This is safe because attributes are inserted at end of attributes or name, 
    // and tag replacement applies to name. start/end indexes are stable if applied right to left.
    resolvedOps.sort((a, b) => b.opening.name.end - a.opening.name.end);

    for (const r of resolvedOps) {
        if (r.type === 'STRUCTURAL') {
            if (r.closing) {
                vCode = vCode.slice(0, r.closing.name.start) + r.obj.replacement_tag + vCode.slice(r.closing.name.end);
            }
            vCode = vCode.slice(0, r.opening.name.start) + r.obj.replacement_tag + vCode.slice(r.opening.name.end);
        } else if (r.type === 'ATTRIBUTE') {
            const val = r.obj.value || "";
            if (r.obj.operation === 'ADD') {
                let insertPos = r.opening.name.end;
                if (r.opening.attributes.length > 0) insertPos = r.opening.attributes[r.opening.attributes.length - 1].end;
                const escapedValue = val.replace(/"/g, '&quot;');
                const injection = ` ${r.obj.attribute}="${escapedValue}"`;
                vCode = vCode.slice(0, insertPos) + injection + vCode.slice(insertPos);
            } else if (r.obj.operation === 'REMOVE') {
                const attrNode = r.opening.attributes[r.existingAttrIndex];
                const start = attrNode.start - 1; // to remove preceding space
                const end = attrNode.end;
                vCode = vCode.slice(0, start) + vCode.slice(end);
            } else if (r.obj.operation === 'UPDATE') {
                const attrNode = r.opening.attributes[r.existingAttrIndex];
                const start = attrNode.start;
                const end = attrNode.end;
                const escapedValue = val.replace(/"/g, '&quot;');
                const replacement = `${r.obj.attribute}="${escapedValue}"`;
                vCode = vCode.slice(0, start) + replacement + vCode.slice(end);
            }
        }
    }

    let vAst;
    try {
        vAst = parser.parse(vCode, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (e) {
        return { valid: false, stage: "PARSE", reason: "PATCH_FAILURE", message: "Patch resulted in syntax error." };
    }

    let idCount = {};
    traverse(vAst, {
        JSXElement(path) {
            for (const attr of path.node.openingElement.attributes) {
                if (attr.name && attr.name.name === 'id' && attr.value && attr.value.type === 'StringLiteral') {
                    const idVal = attr.value.value;
                    idCount[idVal] = (idCount[idVal] || 0) + 1;
                }
            }
        }
    });

    for (const count of Object.values(idCount)) {
        if (count > 1) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "DUPLICATE_ID_REJECTION: An ID is not unique." };
    }

    for (const obj of objects) {
        if (obj.type === 'ATTRIBUTE' && ['aria-labelledby', 'aria-describedby', 'htmlFor', 'for'].includes(obj.attribute) && (obj.operation === 'ADD' || obj.operation === 'UPDATE')) {
            const ids = (obj.value || "").split(' ').filter(id => id.trim().length > 0);
            for (const id of ids) {
                if (!idCount[id]) return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION: The referenced ID does not resolve to an existing element." };
            }
        }
    }

    return { valid: true, isAbort: false, action: "BUNDLE", vCode, objects, resolvedOps };
}

export function applyPatchBundle(validationResult, absPath) {
    if (validationResult.vCode) {
        try {
            parser.parse(validationResult.vCode, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        } catch (e) {
            return { success: false, reason: "PATCH_FAILURE", message: "Patch resulted in invalid syntax." };
        }
        fs.writeFileSync(absPath, validationResult.vCode, 'utf8');
        return { success: true };
    }
    return { success: false, reason: "PATCH_FAILURE", message: "No vCode provided in validation." };
}

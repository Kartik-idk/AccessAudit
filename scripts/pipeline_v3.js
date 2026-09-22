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
    action: { type: "string", enum: ["ABORT", "MODIFY_ATTRIBUTE", "STRUCTURAL_REMEDIATION"] },
    reason: { type: "string" },
    
    // Target is not required for ABORT, but required for others
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
    
    // MODIFY_ATTRIBUTE
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"] },
    attribute: { type: "string" },
    value: { type: "string" },
    
    // STRUCTURAL_REMEDIATION
    replacement: {
      type: "object",
      properties: { element: { type: "string", enum: ["button"] } },
      required: ["element"]
    }
  },
  required: ["action", "reason"],
  allOf: [
    {
      if: { properties: { action: { const: "MODIFY_ATTRIBUTE" } } },
      then: { required: ["target", "operation", "attribute"] }
    },
    {
      if: { properties: { action: { const: "STRUCTURAL_REMEDIATION" } } },
      then: { required: ["target", "operation", "replacement"] }
    }
  ]
};

const validateSchema = ajv.compile(schema);
const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'id', 'tabIndex', 'aria-hidden', 'placeholder'];

export function validateProposal(proposal, absPath) {
  // 1. Schema Validation
  if (!validateSchema(proposal)) {
    return { 
      valid: false, 
      stage: "SCHEMA", 
      reason: "SCHEMA_VALIDATION", 
      message: "Schema validation failed: " + ajv.errorsText(validateSchema.errors) 
    };
  }
  
  if (proposal.action === "ABORT") {
    return { valid: true, isAbort: true, stage: "ABORT", message: "Model safely aborted." };
  }
  
  if (!fs.existsSync(absPath)) {
    return { valid: false, stage: "SYNTACTIC", reason: "FILE_NOT_FOUND", message: `File not found ${absPath}` };
  }
  
  let code = fs.readFileSync(absPath, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { valid: false, stage: "PARSE", reason: "PARSE_ERROR", message: "Could not parse source file" };
  }
  
  // 3. Target Validation
  let targetNode = null;
  let targetPath = null;
  traverse(ast, {
    JSXElement(path) {
      const loc = path.node.loc;
      if (loc && loc.start.line === proposal.target.line && loc.start.column === proposal.target.column) {
        targetNode = path.node;
        targetPath = path;
        path.stop();
      }
    }
  });
  
  if (!targetNode) {
    return { valid: false, stage: "SYNTACTIC", reason: "TARGET_NOT_FOUND", message: `Target AST node not found at line ${proposal.target.line}, col ${proposal.target.column}` };
  }
  
  const elementName = targetNode.openingElement.name.name;
  if (elementName !== proposal.target.element) {
    return { valid: false, stage: "SYNTACTIC", reason: "TARGET_MISMATCH", message: `Target element mismatch. Expected '${proposal.target.element}', found '${elementName}'` };
  }
  
  const opening = targetNode.openingElement;
  const closing = targetNode.closingElement;
  
  // ==========================================
  // MODIFY_ATTRIBUTE VALIDATION
  // ==========================================
  if (proposal.action === "MODIFY_ATTRIBUTE") {
    if (proposal.operation === 'ADD' && !ALLOWED_ATTRIBUTES.includes(proposal.attribute)) {
      return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_ATTRIBUTE", message: `Dangerous or unsupported attribute '${proposal.attribute}'` };
    }
    
    const existingAttrIndex = opening.attributes.findIndex(attr => attr.name && attr.name.name === proposal.attribute);
    const hasAttr = existingAttrIndex !== -1;
    
    if (proposal.operation === 'ADD' && hasAttr) {
      return { valid: false, stage: "SYNTACTIC", reason: "ATTRIBUTE_EXISTS", message: `Attribute '${proposal.attribute}' already exists for ADD operation.` };
    }
    
    if ((proposal.operation === 'UPDATE' || proposal.operation === 'REMOVE') && !hasAttr) {
      return { valid: false, stage: "SYNTACTIC", reason: "ATTRIBUTE_MISSING", message: `Attribute '${proposal.attribute}' does not exist for ${proposal.operation} operation.` };
    }

    const val = proposal.value || "";
    
    // Rule A: aria-hidden
    if (proposal.attribute === 'aria-hidden' && val === "true" && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
      const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
      const hasClickHandler = opening.attributes.some(a => a.name && (a.name.name === 'onClick' || a.name.name === 'onKeyDown' || a.name.name === 'onKeyUp'));
      if (interactiveTags.includes(elementName) || hasClickHandler) {
        return { valid: false, stage: "GATEKEEPER", reason: "INTERACTIVE_ARIA_HIDDEN", message: "Prohibits aria-hidden=true on interactive elements." };
      }
    }

    // Rule B: Empty accessible names
    if (['alt', 'aria-label', 'title'].includes(proposal.attribute) && val.trim() === "" && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
      return { valid: false, stage: "GATEKEEPER", reason: "EMPTY_ACCESSIBLE_NAME", message: `Prohibits empty ${proposal.attribute} values.` };
    }

    // Rule for Task 12: Semantic rejection of placeholder
    if (elementName === 'input' && proposal.attribute === 'placeholder' && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
      return { 
        valid: false, 
        stage: "GATEKEEPER", 
        reason: "SEMANTIC_REJECTION", 
        message: "SEMANTIC_REJECTION:\nThe proposed attribute does not provide a programmatic accessible name for this input. Revise the remediation so that the input has a valid accessible name." 
      };
    }

    // Rule for Task 13: Broken IDREF semantic validation
    if (['aria-labelledby', 'aria-describedby'].includes(proposal.attribute) && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
      const ids = val.split(' ').filter(id => id.trim().length > 0);
      let allIdsExist = true;
      for (const id of ids) {
         let idExists = false;
         traverse(ast, {
            JSXAttribute(attrPath) {
               if (attrPath.node.name.name === 'id' && attrPath.node.value && attrPath.node.value.type === 'StringLiteral' && attrPath.node.value.value === id) {
                   idExists = true;
                   attrPath.stop();
               }
            }
         });
         if (!idExists) {
            allIdsExist = false;
            break;
         }
      }
      
      if (!allIdsExist) {
         return {
            valid: false,
            stage: "GATEKEEPER",
            reason: "SEMANTIC_REJECTION",
            message: "SEMANTIC_REJECTION:\nThe referenced ID does not resolve to an existing element. The proposed accessible-name reference is therefore invalid. Revise the remediation so that the target input receives a valid accessible name.\n\nCONSTRAINT:\nMulti-element patches are unsupported in this experiment. Only attributes on the target input may be modified."
         };
      }
    }

    // Rule C: tabindex
    if (proposal.attribute === 'tabIndex' && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
      const tabNum = parseInt(val, 10);
      if (tabNum > 0) {
        return { valid: false, stage: "GATEKEEPER", reason: "POSITIVE_TABINDEX", message: `Prohibits positive tabIndex (${val}).` };
      }
    }

    // Rule D: Event-handler destruction
    if (proposal.operation === 'REMOVE' && ['onClick', 'onKeyDown', 'onKeyUp', 'onChange'].includes(proposal.attribute)) {
      return { valid: false, stage: "GATEKEEPER", reason: "EVENT_HANDLER_DESTRUCTION", message: `Prohibits removing event handler '${proposal.attribute}'.` };
    }
    
    return { valid: true, isAbort: false, code, opening, closing, val, existingAttrIndex };
  }
  
  // ==========================================
  // STRUCTURAL_REMEDIATION VALIDATION
  // ==========================================
  if (proposal.action === "STRUCTURAL_REMEDIATION") {
    if (proposal.operation !== "REPLACE_TAG") {
      return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_OPERATION", message: `Operation ${proposal.operation} is not allowed.` };
    }
    
    // Strict div -> button check
    if (elementName !== 'div') {
       return { valid: false, stage: "GATEKEEPER", reason: "INVALID_TARGET", message: `Target must be a div.` };
    }
    if (proposal.replacement.element !== 'button') {
       return { valid: false, stage: "GATEKEEPER", reason: "INVALID_REPLACEMENT", message: `Replacement must be button.` };
    }
    
    // Check interaction evidence
    const hasClickHandler = opening.attributes.some(a => a.name && (a.name.name === 'onClick' || a.name.name === 'onKeyDown' || a.name.name === 'onKeyUp'));
    if (!hasClickHandler) {
      return { valid: false, stage: "GATEKEEPER", reason: "NO_INTERACTION_EVIDENCE", message: `div -> button replacement requires interaction evidence (like onClick) on the target.` };
    }
    
    // Form safety
    let insideForm = false;
    let curr = targetPath.parentPath;
    while(curr) {
       if (curr.node.type === 'JSXElement' && curr.node.openingElement.name.name === 'form') {
           insideForm = true;
           break;
       }
       curr = curr.parentPath;
    }
    if (insideForm) {
       return { valid: false, stage: "GATEKEEPER", reason: "FORM_CONTEXT_UNSUPPORTED", message: `div -> button not allowed inside <form> due to lack of explicit type="button".` };
    }
    
    // Nested Interactive Validation
    let nestedInteractive = false;
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
    targetPath.traverse({
       JSXElement(innerPath) {
           const innerName = innerPath.node.openingElement.name.name;
           if (interactiveTags.includes(innerName)) {
               nestedInteractive = true;
               innerPath.stop();
           }
       }
    });
    
    if (nestedInteractive) {
       return { valid: false, stage: "GATEKEEPER", reason: "NESTED_INTERACTIVE", message: `Cannot replace div with button because it contains nested interactive controls.` };
    }
    
    return { valid: true, isAbort: false, code, opening, closing };
  }
}

export function applyPatch(proposal, absPath, validationResult) {
  let code = validationResult.code;
  const opening = validationResult.opening;
  const closing = validationResult.closing;
  
  if (proposal.action === 'MODIFY_ATTRIBUTE') {
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
  } else if (proposal.action === 'STRUCTURAL_REMEDIATION' && proposal.operation === 'REPLACE_TAG') {
      // Replace the closing tag name first so indices don't shift
      if (closing) {
         code = code.slice(0, closing.name.start) + proposal.replacement.element + code.slice(closing.name.end);
      }
      // Replace opening tag name
      code = code.slice(0, opening.name.start) + proposal.replacement.element + code.slice(opening.name.end);
  }
  
  // Post-patch parse safety
  try {
    parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { success: false, reason: "POST_PATCH_PARSE_ERROR", message: "Patch resulted in invalid syntax." };
  }
  
  fs.writeFileSync(absPath, code, 'utf8');
  return { success: true };
}

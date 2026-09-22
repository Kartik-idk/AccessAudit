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
    
    // For single-node operations
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
    operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"] },
    attribute: { type: "string" },
    value: { type: "string" },
    replacement: {
      type: "object",
      properties: { element: { type: "string", enum: ["button"] } }
    },
    
    // For multi-node operations
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: {
            type: "object",
            properties: { element: { type: "string" }, file: { type: "string" }, line: { type: "integer" }, column: { type: "integer" } },
            required: ["element", "file", "line", "column"]
          },
          operation: { type: "string", enum: ["ADD", "UPDATE", "REMOVE"] },
          attribute: { type: "string" },
          value: { type: "string" }
        },
        required: ["target", "operation", "attribute", "value"]
      }
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
    },
    {
      if: { properties: { action: { const: "MULTI_NODE_REMEDIATION" } } },
      then: { required: ["operations"] }
    }
  ]
};

const validateSchema = ajv.compile(schema);
const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'htmlFor', 'id', 'tabIndex', 'aria-hidden', 'placeholder'];

export function validateProposal(proposal, absPath) {
  if (!validateSchema(proposal)) {
    return { valid: false, stage: "SCHEMA", reason: "JSON_PARSE_FAILURE", message: "Schema validation failed: " + ajv.errorsText(validateSchema.errors) };
  }
  
  if (proposal.action === "ABORT") {
    return { valid: true, isAbort: true, stage: "ABORT", message: "Model safely aborted." };
  }
  
  if (!fs.existsSync(absPath)) {
    return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `File not found ${absPath}` };
  }
  
  let code = fs.readFileSync(absPath, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { valid: false, stage: "PARSE", reason: "JSON_PARSE_FAILURE", message: "Source file has syntax errors." };
  }
  
  // MULTI_NODE_REMEDIATION
  if (proposal.action === "MULTI_NODE_REMEDIATION") {
      let resolvedOps = [];
      let allFound = true;
      let missingMsg = "";
      
      for (const op of proposal.operations) {
          let targetNode = null;
          let targetPath = null;
          traverse(ast, {
            JSXElement(path) {
              const loc = path.node.loc;
              if (loc && loc.start.line === op.target.line && loc.start.column === op.target.column) {
                targetNode = path.node;
                targetPath = path;
                path.stop();
              }
            }
          });
          if (!targetNode) {
             return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Target not found at line ${op.target.line}, col ${op.target.column}` };
          }
          if (targetNode.openingElement.name.name !== op.target.element) {
             return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Element mismatch. Expected ${op.target.element}` };
          }
          if (!ALLOWED_ATTRIBUTES.includes(op.attribute)) {
             return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Unsupported attribute ${op.attribute}` };
          }
          
          const existingAttrIndex = targetNode.openingElement.attributes.findIndex(attr => attr.name && attr.name.name === op.attribute);
          const hasAttr = existingAttrIndex !== -1;
          
          if (op.operation === 'ADD' && hasAttr) {
            return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${op.attribute}' already exists for ADD operation.` };
          }
          if ((op.operation === 'UPDATE' || op.operation === 'REMOVE') && !hasAttr) {
            return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${op.attribute}' does not exist for ${op.operation} operation.` };
          }

          resolvedOps.push({ op, opening: targetNode.openingElement, closing: targetNode.closingElement, existingAttrIndex });
      }
      
      // Collision detection
      for (let i = 0; i < resolvedOps.length; i++) {
          for (let j = i + 1; j < resolvedOps.length; j++) {
              if (resolvedOps[i].opening.loc.start.line === resolvedOps[j].opening.loc.start.line &&
                  resolvedOps[i].opening.loc.start.column === resolvedOps[j].opening.loc.start.column) {
                  return { valid: false, stage: "SYNTACTIC", reason: "SEMANTIC_REJECTION", message: "TARGET_COLLISION: Multiple operations target the same element." };
              }
          }
      }
      
      // Apply to Virtual AST right-to-left
      let vCode = code;
      resolvedOps.sort((a, b) => b.opening.name.end - a.opening.name.end);
      
      for (const r of resolvedOps) {
          const val = r.op.value || "";
          if (r.op.operation === 'ADD') {
              let insertPos = r.opening.name.end;
              if (r.opening.attributes.length > 0) {
                 insertPos = r.opening.attributes[r.opening.attributes.length - 1].end;
              }
              const escapedValue = val.replace(/"/g, '&quot;');
              const injection = ` ${r.op.attribute}="${escapedValue}"`;
              vCode = vCode.slice(0, insertPos) + injection + vCode.slice(insertPos);
          } else if (r.op.operation === 'REMOVE') {
              const attrNode = r.opening.attributes[r.existingAttrIndex];
              const start = attrNode.start - 1; // to remove preceding space
              const end = attrNode.end;
              vCode = vCode.slice(0, start) + vCode.slice(end);
          } else if (r.op.operation === 'UPDATE') {
              const attrNode = r.opening.attributes[r.existingAttrIndex];
              const start = attrNode.start;
              const end = attrNode.end;
              const escapedValue = val.replace(/"/g, '&quot;');
              const replacement = `${r.op.attribute}="${escapedValue}"`;
              vCode = vCode.slice(0, start) + replacement + vCode.slice(end);
          } else {
             return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Operation ${r.op.operation} not supported.` };
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
          if (count > 1) {
              return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "DUPLICATE_ID_REJECTION: An ID is not unique." };
          }
      }

      // Check IDREF resolution for attributes modified in this proposal
      for (const op of proposal.operations) {
          if (['aria-labelledby', 'aria-describedby', 'htmlFor', 'for'].includes(op.attribute) && (op.operation === 'ADD' || op.operation === 'UPDATE')) {
              const ids = (op.value || "").split(' ').filter(id => id.trim().length > 0);
              for (const id of ids) {
                  if (!idCount[id]) {
                      return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION: The referenced ID does not resolve to an existing element." };
                  }
              }
          }
          if (op.target.element === 'input' && ['aria-label', 'title', 'placeholder'].includes(op.attribute) && (op.operation === 'ADD' || op.operation === 'UPDATE')) {
              return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "ANTI_CHEAT_FAILURE: Single node shortcut detected alongside multi-node operations." };
          }
      }
      
      return { valid: true, isAbort: false, action: "MULTI_NODE_REMEDIATION", vCode };
  }
  
  // ==========================================
  // SINGLE-NODE TARGET RESOLUTION
  // ==========================================
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
    return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Target AST node not found at line ${proposal.target.line}, col ${proposal.target.column}` };
  }
  
  const elementName = targetNode.openingElement.name.name;
  const opening = targetNode.openingElement;
  const closing = targetNode.closingElement;
  
  // ==========================================
  // STRUCTURAL_REMEDIATION
  // ==========================================
  if (proposal.action === "STRUCTURAL_REMEDIATION") {
    if (proposal.operation !== "REPLACE_TAG") {
      return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Operation ${proposal.operation} is not allowed.` };
    }
    if (elementName !== 'div') {
       return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `INVALID_TARGET: Target must be a div.` };
    }
    if (proposal.replacement.element !== 'button') {
       return { valid: false, stage: "GATEKEEPER", reason: "UNSUPPORTED_REMEDIATION", message: `INVALID_REPLACEMENT: Replacement must be button.` };
    }
    const hasClickHandler = opening.attributes.some(a => a.name && (a.name.name === 'onClick' || a.name.name === 'onKeyDown' || a.name.name === 'onKeyUp'));
    if (!hasClickHandler) {
      return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `NO_INTERACTION_EVIDENCE: div -> button replacement requires interaction evidence on the target.` };
    }
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
       return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `FORM_CONTEXT_UNSUPPORTED: div -> button not allowed inside <form>.` };
    }
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
       return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: `NESTED_INTERACTIVE: Cannot replace div with button because it contains nested interactive controls.` };
    }
    return { valid: true, isAbort: false, action: "STRUCTURAL_REMEDIATION", code, opening, closing, proposal };
  }
  
  // ==========================================
  // MODIFY_ATTRIBUTE
  // ==========================================
  if (proposal.action === "MODIFY_ATTRIBUTE") {
    if (elementName !== proposal.target.element) {
      return { valid: false, stage: "SYNTACTIC", reason: "TARGET_LOCALIZATION_FAILURE", message: `Target element mismatch. Expected '${proposal.target.element}', found '${elementName}'` };
    }
    if (proposal.operation === 'ADD' && !ALLOWED_ATTRIBUTES.includes(proposal.attribute)) {
      return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_REMEDIATION", message: `Dangerous or unsupported attribute '${proposal.attribute}'` };
    }
    // Anti-cheat / Semantic boundaries for single-node
    if (elementName === 'input' && ['aria-label', 'title', 'placeholder'].includes(proposal.attribute) && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
       return {
            valid: false,
            stage: "GATEKEEPER",
            reason: "SEMANTIC_REJECTION",
            message: "SEMANTIC_REJECTION: Self-contained accessible names are disabled for this input. Establish a programmatic relationship with existing visible text."
       };
    }
    const existingAttrIndex = opening.attributes.findIndex(attr => attr.name && attr.name.name === proposal.attribute);
    const hasAttr = existingAttrIndex !== -1;
    if (proposal.operation === 'ADD' && hasAttr) {
      return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${proposal.attribute}' already exists for ADD operation.` };
    }
    if ((proposal.operation === 'UPDATE' || proposal.operation === 'REMOVE') && !hasAttr) {
      return { valid: false, stage: "SYNTACTIC", reason: "INVALID_PROPOSAL", message: `Attribute '${proposal.attribute}' does not exist for ${proposal.operation} operation.` };
    }

    const val = proposal.value || "";
    // Verify IDREF resolves if it's aria-labelledby
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
            message: "SEMANTIC_REJECTION: The referenced ID does not resolve to an existing element."
         };
      }
    }
    return { valid: true, isAbort: false, action: "MODIFY_ATTRIBUTE", code, opening, closing, val, existingAttrIndex, proposal };
  }
}

export function applyPatch(proposal, absPath, validationResult) {
  if (validationResult.action === "MULTI_NODE_REMEDIATION") {
      fs.writeFileSync(absPath, validationResult.vCode, 'utf8');
      return { success: true };
  }

  let code = validationResult.code;
  const opening = validationResult.opening;
  const closing = validationResult.closing;
  
  if (validationResult.action === 'STRUCTURAL_REMEDIATION') {
      if (closing) {
         code = code.slice(0, closing.name.start) + validationResult.proposal.replacement.element + code.slice(closing.name.end);
      }
      code = code.slice(0, opening.name.start) + validationResult.proposal.replacement.element + code.slice(opening.name.end);
  } else if (validationResult.action === 'MODIFY_ATTRIBUTE') {
      const val = validationResult.val;
      if (validationResult.proposal.operation === 'ADD') {
        let insertPos = opening.name.end;
        if (opening.attributes.length > 0) {
          insertPos = opening.attributes[opening.attributes.length - 1].end;
        }
        const escapedValue = val.replace(/"/g, '&quot;');
        const injection = ` ${validationResult.proposal.attribute}="${escapedValue}"`;
        code = code.slice(0, insertPos) + injection + code.slice(insertPos);
      } 
      else if (validationResult.proposal.operation === 'REMOVE') {
        const attrNode = opening.attributes[validationResult.existingAttrIndex];
        const start = attrNode.start - 1; 
        const end = attrNode.end;
        code = code.slice(0, start) + code.slice(end);
      }
      else if (validationResult.proposal.operation === 'UPDATE') {
        const attrNode = opening.attributes[validationResult.existingAttrIndex];
        const start = attrNode.start;
        const end = attrNode.end;
        const escapedValue = val.replace(/"/g, '&quot;');
        const replacement = `${validationResult.proposal.attribute}="${escapedValue}"`;
        code = code.slice(0, start) + replacement + code.slice(end);
      }
  }
  
  try {
    parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { success: false, reason: "PATCH_FAILURE", message: "Patch resulted in invalid syntax." };
  }
  
  fs.writeFileSync(absPath, code, 'utf8');
  return { success: true };
}

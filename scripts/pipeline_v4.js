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
      properties: { element: { type: "string", enum: ["button"] } },
      required: ["element"]
    },
    
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
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
          value: { type: "string" }
        },
        required: ["target", "operation", "attribute"]
      },
      minItems: 1
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
const ALLOWED_ATTRIBUTES = ['alt', 'aria-label', 'aria-labelledby', 'aria-describedby', 'role', 'title', 'for', 'id', 'tabIndex', 'aria-hidden', 'placeholder'];

export function validateProposal(proposal, absPath) {
  if (!validateSchema(proposal)) {
    return { valid: false, stage: "SCHEMA", reason: "SCHEMA_VALIDATION", message: "Schema validation failed: " + ajv.errorsText(validateSchema.errors) };
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
  
  if (proposal.action === "MULTI_NODE_REMEDIATION") {
      const resolvedOps = [];
      const seenTargets = new Set();
      
      for (const op of proposal.operations) {
          const tkey = `${op.target.line}:${op.target.column}`;
          if (seenTargets.has(tkey)) {
              return { valid: false, stage: "GATEKEEPER", reason: "TARGET_COLLISION", message: "TARGET_COLLISION: Multiple operations target the same element." };
          }
          seenTargets.add(tkey);
          
          let targetNode = null;
          traverse(ast, {
            JSXElement(path) {
              const loc = path.node.loc;
              if (loc && loc.start.line === op.target.line && loc.start.column === op.target.column) {
                targetNode = path.node;
                path.stop();
              }
            }
          });
          if (!targetNode) {
             return { valid: false, stage: "SYNTACTIC", reason: "TARGET_RESOLUTION_FAILURE", message: `Target not found at line ${op.target.line}, col ${op.target.column}` };
          }
          if (targetNode.openingElement.name.name !== op.target.element) {
             return { valid: false, stage: "SYNTACTIC", reason: "TARGET_RESOLUTION_FAILURE", message: `Element mismatch. Expected ${op.target.element}` };
          }
          if (!ALLOWED_ATTRIBUTES.includes(op.attribute)) {
             return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_ATTRIBUTE", message: `Unsupported attribute ${op.attribute}` };
          }
          
          if (op.target.element === 'input' && ['aria-label', 'title', 'placeholder'].includes(op.attribute) && (op.operation === 'ADD' || op.operation === 'UPDATE')) {
              return {
                  valid: false,
                  stage: "GATEKEEPER",
                  reason: "SEMANTIC_REJECTION",
                  message: "SEMANTIC_REJECTION:\nSelf-contained accessible names are disabled for this input. You must establish a programmatic relationship with existing visible text in the component."
              };
          }
          
          const existingAttrIndex = targetNode.openingElement.attributes.findIndex(attr => attr.name && attr.name.name === op.attribute);
          const hasAttr = existingAttrIndex !== -1;
          
          if (op.operation === 'ADD' && hasAttr) {
            return { valid: false, stage: "SYNTACTIC", reason: "ATTRIBUTE_EXISTS", message: `Attribute '${op.attribute}' already exists for ADD operation.` };
          }
          
          resolvedOps.push({ op, opening: targetNode.openingElement, existingAttrIndex });
      }
      
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
          } else if (r.op.operation === 'UPDATE') {
              const attrNode = r.opening.attributes[r.existingAttrIndex];
              const escapedValue = val.replace(/"/g, '&quot;');
              const replacement = `${r.op.attribute}="${escapedValue}"`;
              vCode = vCode.slice(0, attrNode.start) + replacement + vCode.slice(attrNode.end);
          }
      }
      
      let vAst;
      try {
          vAst = parser.parse(vCode, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      } catch (e) {
          return { valid: false, stage: "PARSE", reason: "POST_PATCH_PARSE_ERROR", message: "Patch resulted in syntax error." };
      }
      
      let idCount = {};
      let inputLabelledBy = null;
      let inputHasForbidden = false;
      
      traverse(vAst, {
          JSXElement(path) {
              const name = path.node.openingElement.name.name;
              let hasLabel = false;
              let hasTitle = false;
              let hasPlaceholder = false;
              
              for (const attr of path.node.openingElement.attributes) {
                  if (attr.name && attr.name.name === 'id' && attr.value && attr.value.type === 'StringLiteral') {
                      const idVal = attr.value.value;
                      idCount[idVal] = (idCount[idVal] || 0) + 1;
                  }
                  if (name === 'input') {
                      if (attr.name && attr.name.name === 'aria-labelledby' && attr.value && attr.value.type === 'StringLiteral') {
                          inputLabelledBy = attr.value.value;
                      }
                      if (attr.name && ['aria-label', 'title', 'placeholder'].includes(attr.name.name)) {
                          inputHasForbidden = true;
                      }
                  }
              }
          }
      });
      
      if (inputHasForbidden) {
          return { valid: false, stage: "GATEKEEPER", reason: "ANTI_CHEAT_FAILURE", message: "ANTI_CHEAT_FAILURE: Single node shortcut detected on input alongside multi-node operations." };
      }
      
      if (inputLabelledBy) {
          const ids = inputLabelledBy.split(' ').filter(id => id.trim().length > 0);
          for (const id of ids) {
              if (!idCount[id]) {
                  return { valid: false, stage: "GATEKEEPER", reason: "SEMANTIC_REJECTION", message: "SEMANTIC_REJECTION:\nThe referenced ID does not resolve to an existing element." };
              }
              if (idCount[id] > 1) {
                  return { valid: false, stage: "GATEKEEPER", reason: "DUPLICATE_ID_REJECTION", message: "SEMANTIC_REJECTION:\nThe referenced ID is not unique." };
              }
          }
      }
      
      return { valid: true, isAbort: false, action: "MULTI_NODE_REMEDIATION", vCode };
  }
  
  // Single target operations
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
  
  if (proposal.action === "MODIFY_ATTRIBUTE") {
    if (proposal.operation === 'ADD' && !ALLOWED_ATTRIBUTES.includes(proposal.attribute)) {
      return { valid: false, stage: "SYNTACTIC", reason: "UNSUPPORTED_ATTRIBUTE", message: `Dangerous or unsupported attribute '${proposal.attribute}'` };
    }
    
    if (elementName === 'input' && ['aria-label', 'title', 'placeholder'].includes(proposal.attribute) && (proposal.operation === 'ADD' || proposal.operation === 'UPDATE')) {
       return {
            valid: false,
            stage: "GATEKEEPER",
            reason: "SEMANTIC_REJECTION",
            message: "SEMANTIC_REJECTION:\nSelf-contained accessible names are disabled for this input. You must establish a programmatic relationship with existing visible text in the component."
       };
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
            message: "SEMANTIC_REJECTION:\nThe referenced ID does not resolve to an existing element."
         };
      }
    }
    return { valid: true, isAbort: false, action: "MODIFY_ATTRIBUTE", code, opening, closing, val, existingAttrIndex };
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
  }
  
  try {
    parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  } catch (e) {
    return { success: false, reason: "POST_PATCH_PARSE_ERROR", message: "Patch resulted in invalid syntax." };
  }
  
  fs.writeFileSync(absPath, code, 'utf8');
  return { success: true };
}

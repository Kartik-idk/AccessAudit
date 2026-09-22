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

export function processRemediations(proposals) {
  let successCount = 0;
  
  for (const idx in proposals) {
    const proposal = proposals[idx];
    console.log(`\n--- Processing Proposal ${parseInt(idx) + 1} ---`);
    
    // 1. Schema Validation
    if (!validateSchema(proposal)) {
      console.error("❌ REJECTED: Schema validation failed", validateSchema.errors);
      continue;
    }
    
    // 2. Attribute Validation
    if (!ALLOWED_ATTRIBUTES.includes(proposal.attribute)) {
      console.error(`❌ REJECTED: Dangerous or unsupported attribute '${proposal.attribute}'`);
      continue;
    }
    
    const absPath = path.resolve(process.cwd(), proposal.target.file);
    if (!fs.existsSync(absPath)) {
      console.error(`❌ REJECTED: File not found ${absPath}`);
      continue;
    }
    
    let code = fs.readFileSync(absPath, 'utf8');
    
    let ast;
    try {
      ast = parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch (e) {
      console.error("❌ REJECTED: Could not parse source file");
      continue;
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
      console.error(`❌ REJECTED: Target AST node not found at line ${proposal.target.line}, col ${proposal.target.column}`);
      continue;
    }
    
    const elementName = targetNode.openingElement.name.name;
    if (elementName !== proposal.target.element) {
      console.error(`❌ REJECTED: Target element mismatch. Expected '${proposal.target.element}', found '${elementName}'`);
      continue;
    }
    
    // 4. Patch Application (Source-Range)
    const opening = targetNode.openingElement;
    const existingAttrIndex = opening.attributes.findIndex(attr => attr.name && attr.name.name === proposal.attribute);
    const hasAttr = existingAttrIndex !== -1;
    
    if (proposal.operation === 'ADD' && hasAttr) {
      console.error(`❌ REJECTED: Attribute '${proposal.attribute}' already exists for ADD operation.`);
      continue;
    }
    
    if ((proposal.operation === 'UPDATE' || proposal.operation === 'REMOVE') && !hasAttr) {
      console.error(`❌ REJECTED: Attribute '${proposal.attribute}' does not exist for ${proposal.operation} operation.`);
      continue;
    }

    if (proposal.operation === 'ADD') {
      let insertPos = opening.name.end;
      if (opening.attributes.length > 0) {
        insertPos = opening.attributes[opening.attributes.length - 1].end;
      }
      const val = proposal.value || "";
      const escapedValue = val.replace(/"/g, '&quot;');
      const injection = ` ${proposal.attribute}="${escapedValue}"`;
      code = code.slice(0, insertPos) + injection + code.slice(insertPos);
    } 
    else if (proposal.operation === 'REMOVE') {
      const attrNode = opening.attributes[existingAttrIndex];
      // simplistic removal, assuming space before
      const start = attrNode.start - 1; 
      const end = attrNode.end;
      code = code.slice(0, start) + code.slice(end);
    }
    else if (proposal.operation === 'UPDATE') {
      const attrNode = opening.attributes[existingAttrIndex];
      const start = attrNode.start;
      const end = attrNode.end;
      const val = proposal.value || "";
      const escapedValue = val.replace(/"/g, '&quot;');
      const replacement = `${proposal.attribute}="${escapedValue}"`;
      code = code.slice(0, start) + replacement + code.slice(end);
    }
    
    fs.writeFileSync(absPath, code, 'utf8');
    console.log(`✅ ACCEPTED: Patched ${proposal.target.file}`);
    successCount++;
  }
  
  return successCount;
}

const jsonPath = process.argv[2];
if (jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  processRemediations(data);
}

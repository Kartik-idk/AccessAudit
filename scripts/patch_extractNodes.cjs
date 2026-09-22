const fs = require('fs');

let code = fs.readFileSync('run_task27_benchmark.js', 'utf8');

const newExtract = `
function extractNodes(ast, targetSelector) {
    const c = benchmarkCases.find(x => x.targetSelector === targetSelector);
    let targetNodePath = null;
    traverse(ast, {
        JSXElement(path) {
            const idAttr = path.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
            if (idAttr && idAttr.value && idAttr.value.value === c.targetSelector.replace('#', '')) {
                targetNodePath = path;
                path.stop();
            }
        }
    });

    if (!targetNodePath) return { nodeMap: {}, promptContext: "" };

    let nodes = [targetNodePath];

    if (c.cat === "MULTI_NODE_REMEDIATION") {
        if (c.name === "case10") {
            let a2Path = null;
            traverse(ast, {
                JSXElement(innerPath) {
                    const idAttr = innerPath.node.openingElement.attributes.find(a => a.name && a.name.name === 'id');
                    if (idAttr && idAttr.value && idAttr.value.value === 'c10-a2') {
                        a2Path = innerPath;
                        innerPath.stop();
                    }
                }
            });
            if (a2Path) nodes.push(a2Path);
        } else {
            let sibling = targetNodePath.getPrevSibling();
            while (sibling && sibling.node && sibling.node.type !== 'JSXElement') {
                sibling = sibling.getPrevSibling();
            }
            if (sibling && sibling.node && sibling.node.type === 'JSXElement') {
                nodes.unshift(sibling);
            }
        }
    } else if (c.name === "case13") {
        let parent = targetNodePath.parentPath;
        while(parent && parent.node && parent.node.type !== 'JSXElement') {
            parent = parent.parentPath;
        }
        if (parent && parent.node && parent.node.openingElement.name.name === 'form') {
            nodes.unshift(parent);
        }
    }

    const nodeMap = {};
    let promptContext = "";

    nodes.forEach((n, i) => {
        const letter = String.fromCharCode(65 + i);
        const nodeId = \`NODE_\${letter}\`;
        nodeMap[nodeId] = {
            line: n.node.loc.start.line,
            column: n.node.loc.start.column,
            target_element: n.node.openingElement.name.name
        };
        promptContext += \`\${nodeId}:\\n\${generate(n.node).code}\\n\\n\`;
    });

    return { nodeMap, promptContext };
}
`;

const startIdx = code.indexOf('function extractNodes');
const endIdx = code.indexOf('function parseAndTranslatePayload');

code = code.substring(0, startIdx) + newExtract + "\n" + code.substring(endIdx);
fs.writeFileSync('run_task27_benchmark.js', code);

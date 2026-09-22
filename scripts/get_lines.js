import fs from 'fs';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

const source = fs.readFileSync('src/components/Task18Benchmark.tsx', 'utf8');
const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
});

traverse(ast, {
    JSXOpeningElement(path) {
        console.log(`${path.node.name.name} - line: ${path.node.loc.start.line}, col: ${path.node.loc.start.column}`);
    }
});

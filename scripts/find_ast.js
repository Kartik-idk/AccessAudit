import fs from 'fs';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

const source = fs.readFileSync('src/components/Task18Benchmark.tsx', 'utf8');
const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
});

traverse.default(ast, {
    JSXOpeningElement(path) {
        if (path.node.name.name === 'img') {
            console.log('img:', path.node.loc.start);
        }
        if (path.node.name.name === 'label') {
            console.log('label:', path.node.loc.start);
        }
        if (path.node.name.name === 'input') {
            console.log('input:', path.node.loc.start);
        }
        if (path.node.name.name === 'div') {
            console.log('div:', path.node.loc.start);
        }
    }
});

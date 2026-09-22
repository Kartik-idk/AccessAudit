import { validateProposalBundle } from '../scripts/pipeline_v6.js';
const targetFile = 'src/components/Task18Benchmark.tsx';
const objects = [{
    action: "MODIFY_ATTRIBUTE",
    reason: "translated",
    target_element: "img",
    file: targetFile,
    line: 9,
    column: 9,
    operation: "ADD",
    attribute: "alt",
    value: "Hero"
}];
const v = validateProposalBundle(objects, targetFile);
console.log(v.vCode.match(/<img.*?>/));

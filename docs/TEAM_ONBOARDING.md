# Team Onboarding

Welcome to AccessAudit! This guide will ramp you up on the project mechanics over your first week.

## Day 1: Project Overview & Axe-core
- **What the project does**: Read `README.md` and `docs/ARCHITECTURE.md` to understand the goal: deterministic AI accessibility remediation.
- **Run the app**: Look at `package.json`. The app is a Vite React application. Run `npm run dev` to see the underlying components.
- **Understand Axe detection**: Review `scripts/dump_axe.js` to see how we use `@axe-core/playwright` to detect violations.

## Day 2: Provenance & The Schema
- **Provenance System**: Look at `scripts/patch_extractNodes.cjs`. This is a Vite plugin that tags React elements with `__source` attributes, allowing us to map a DOM violation back to a specific file and line.
- **AST / Source Mapping**: Look at `scripts/find_ast.js` and `scripts/get_lines.js` to see how Babel is used to isolate the JSX snippet.
- **Remediation Schema**: Review the JSON schema expected by the gatekeeper inside `scripts/pipeline_v6.js`.

## Day 3: Gatekeeper & Patching
- **Deterministic Gatekeeper**: Review `scripts/pipeline_v6.js` (specifically `validateProposalBundle`). See how it strictly enforces the schema before allowing any edits.
- **Patch Execution**: Look at `applyPatchBundle` in `scripts/pipeline_v6.js`. See how Babel is used to perform `ADD`, `UPDATE`, `REMOVE`, and `REPLACE_TAG` AST mutations without breaking the surrounding source code.
- **Verification**: Review `tests/closed_loop_inference.js` to see the full cycle: propose -> validate -> patch -> rebuild -> axe.

## Day 4: Experiments & Training
- **Experiments**: Read `docs/EXPERIMENTS.md` and `docs/RESEARCH_HISTORY.md` to understand why early zero-shot attempts failed.
- **Dataset**: Read `docs/DATASET.md` to understand how the 500-case synthetic dataset was generated.
- **Model Training**: Read `docs/TRAINING.md` and examine `training/Task29_Training_Persistent.ipynb`.
- **Benchmark**: Review `docs/BENCHMARK.md` to understand the 43/50 semantic alignment result.

## Day 5: Future Horizons
- **Open Research Problems**: Read `docs/RESEARCH.md`. Specifically, look at the "NOT YET ESTABLISHED" section. We still need to prove end-to-end patch success, build stability, and Axe-resolution with the fine-tuned model against real physical source fixtures.

## "Start Here" File List
1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/EXPERIMENTS.md`
4. `scripts/pipeline_v6.js`

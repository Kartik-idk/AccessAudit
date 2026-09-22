# Repository Validation

This document records the validation checks performed before packaging the AccessAudit research repository for Git.

## Dependency Audit
- **Status**: PASS
- **Details**: Verified that `package.json` only includes dependencies actually required by the project's source and experiments (e.g., `axe-core`, `playwright`, `@babel/*`, `ajv`, `jsdom`). Historical tools not currently required (like `recast` or `source-map`) were omitted.

## npm install Result
- **Status**: PASS
- **Details**: `npm install` completes successfully without missing dependency errors.

## Build Result
- **Status**: N/A
- **Details**: The project primarily consists of Node.js scripts and no global build step is configured in `package.json`.

## Tests Result
- **Status**: N/A
- **Details**: No automated test suite is configured via `npm test`. Evaluation relies on the benchmark scripts.

## Dataset-Generator Smoke Test
- **Status**: PASS
- **Details**: Executed `node scripts/generate_accessaudit_dataset.js --smoke`. The generator correctly parsed the skeletons, processed the operations, and completed without path resolution errors, proving the reorganized directory structure is valid.

## Task 30 Path/Preflight Validation
- **Status**: PASS
- **Details**: Executed `python3 experiments/task30_base_vs_finetuned/preflight_v2.py`. The script correctly located the dataset inside `datasets/` and parsed all 50 cases without path resolution errors.

## Secret Scan
- **Status**: PASS
- **Details**: A full repository search for `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `SECRET`, `PASSWORD`, `API_KEY`, and `.env` files was performed. Only safe references to environment variables (e.g. `process.env.GEMINI_API_KEY`) were found. A `.env.example` was created.

## Large-File Scan
- **Status**: PASS
- **Details**: Verified that the `.gitignore` correctly prevents tracking of `*.gguf`, `*.safetensors`, `.bin`, `.pt`, and `.pth` files. No large model weights are staged for commit.

## Known Issues
- Imports inside the Node scripts rely on relative paths (e.g., `../scripts/pipeline_v6.js`). Future reorganizations must carefully update these relative references.
- Local model weights required for inference are intentionally excluded from the repository.

# Task 30 Gemini Audit Traceability Notes

## Ground-truth leakage issue
**Finding:** The raw `test_internal.jsonl` contains the ground-truth remediation payload inside the assistant's message. Passing this unchanged to the model would instantly leak the answer.
**Resolution:** The evaluation pipeline strictly parses the JSONL and extracts ONLY the `user` message (which contains the context and prompt) to build the model's inference prompt. A preflight dry-run assertion verifies that the serialized model input strictly lacks the ground-truth payload.

## Semantic comparator issue
**Finding:** Raw string comparison of JSON outputs (`===`) leads to false negatives due to arbitrary object key reordering or whitespace variance.
**Resolution:** Implemented a robust semantic comparator that:
1. Parses both the model output and ground truth into JavaScript objects.
2. Performs deep equality checking on unordered object keys.
3. Treats operations arrays as unordered UNLESS sequence semantics are required. Positive and negative tests confirm functional parity.

## Chat-template parity issue
**Finding:** Importing a raw GGUF might yield an empty or default Modelfile template, causing the fine-tuned model to interpret prompts differently than the base model.
**Resolution:** The base model's exact `TEMPLATE` and `PARAMETER stop` configurations were queried and explicitly written into the `Modelfile` used to create `accessaudit-qwen7b-ft`. Preflight checks verify exact string-level parity of the resulting templates.

## Small-n limitation
**Finding:** The internal test set consists of only 50 cases, which restricts statistical power.
**Resolution:** The final report will explicitly state that this is a small-n offline benchmark and must not be used to claim generalized capabilities beyond these specific 50 structurally isolated fingerprints.

## Zero-shot vs Task27 recovery-loop difference
**Finding:** Task 27 uses a 3-attempt recovery loop to fix parsing/schema errors. Task 30 measures raw model alignment in a single pass.
**Resolution:** This protocol difference is explicitly documented. Task 30 strictly prohibits retry loops, prompt modifications, or manual repairs, evaluating true zero-shot performance.

## Pipeline Metric Limitations
**Finding:** Because `test_internal.jsonl` lacks the physical source files and AST coordinates required to run the `pipeline_v6.js` closed-loop patcher, physical metrics cannot be computed.
**Resolution:** `patch_success`, `build_success`, `axe_resolution`, and `regression_free` will be explicitly reported as `NOT_AVAILABLE`. The benchmark evaluates solely on JSON/Schema validity and Semantic Correctness against the ground truth.

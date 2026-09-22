# Experiment History

This document traces the chronological progression of experiments that led to the current AccessAudit architecture and the development of the custom QLoRA adapter. It explicitly preserves failed experiments and limitations to contextualize why the synthetic-data and fine-tuning approach was adopted.

## Task 23: Qwen14B Semantic Hardening
- **Objective**: Test if an unmodified 14B model could produce valid deterministic structured remediation payloads.
- **Method**: Zero-shot inference against real-world React components.
- **Result**:
  - 0/12 active cases matched semantic ground truth.
  - 2/3 safe abort cases correctly declined.
  - Overall: 2/15 = 13.3% success.
- **Status**: FAILED.
- **Important limitation**: The model suffered from a schema death spiral, frequently inventing arbitrary schema structures or attempting to perform text-replacement rather than DOM targeting.

## Task 24: Qwen7B Hardened Assessment
- **Objective**: Evaluate a smaller, faster model (7B) on the same schema.
- **Method**: Zero-shot inference against the same 15 test cases.
- **Result**:
  - 0/12 active cases matched semantic ground truth.
  - 1/3 safe abort cases correctly declined.
  - Overall: 1/15 = 6.67% success.
- **Status**: FAILED.
- **Important limitation**: Severe inability to adhere to the strict JSON operation schema.

## Task 26: Search/Replace vs DOM Operations
- **Objective**: Determine if forcing the model to emit raw source search/replace blocks was easier than structured DOM semantic targeting.
- **Method**: Switched prompt to unified diff or search/replace logic.
- **Result**:
  - 0/11 active cases parsed and successfully patched the source.
  - Overall result: 4/15.
- **Status**: FAILED.
- **Important limitation**: Exact-string reproduction became a massive bottleneck. The model hallucinated whitespace or missed context boundaries. Crucially, the experiment did NOT establish that the underlying model lacked reasoning ability; it proved that forcing raw string operations overwhelmed its context capacity.

## Task 27: Deterministic Localized Semantic Payload
- **Objective**: Return to structured payload (DOM targeting) but strip out all extraneous HTML to create a highly focused localized context.
- **Method**: Isolate the exact DOM node and its immediate parents.
- **Result**: The performance was poor and did not yield high success rates zero-shot without recovery loops. Actual numerical result is unavailable in historical artifacts, but it necessitated the generation of a synthetic dataset.
- **Status**: FAILED zero-shot; led to dataset generation.

## Task 28 & 29: Synthetic Dataset & QLoRA Fine-tuning
- **Objective**: Teach the 7B model the proprietary AccessAudit schema via behavioral cloning.
- **Method**: Generated 500 synthetic cases (Task 28) and fine-tuned `qwen2.5-coder:7b` using a 4-bit QLoRA adapter (Task 29).

## Task 30: Base vs Fine-Tuned Semantic Benchmark
- **Objective**: Quantify the exact offline semantic alignment difference between the base model and the fine-tuned adapter.
- **Method**: Zero-shot inference over 50 untouched internal test cases using a strict JSON parser audit and bounded code-fence removal.

### Task 30 Results

| Metric | BASE | FINE-TUNED |
|---|---:|---:|
| Raw JSON Parse Validity | 50/50 | 50/50 |
| Cleaned/Fenced JSON Parse Validity | 50/50 | 50/50 |
| Schema Validity | 0/50 | 50/50 |
| Semantic Correctness | 0/50 | 43/50 |

- MULTI: 15/15 fine-tuned
- STRUCT: 14/14 fine-tuned
- Safe Abort: 5/9 fine-tuned

**Task 30 is an offline semantic evaluation. It does NOT establish patch success, build success, Axe resolution, or end-to-end remediation.**

Task 30 evaluated model-level semantic alignment against the untouched 50-case internal test set.

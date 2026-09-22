# Task 27 Benchmark Report

## 1. Experimental Overview
- **Objective:** Measure whether `qwen2.5-coder:14b` can produce semantically valid remediation when provided precisely isolated deterministic semantic nodes, removing source-location discovery logic.
- **Model:** `qwen2.5-coder:14b`
- **Temperature:** `0.1`
- **Benchmark configuration:** 15 cases (11 Active Remediation, 4 Expected SAFE_ABORT)
- **Engine:** Deterministic semantic payload adapter (`parseAndTranslatePayload`) feeding into `pipeline_v6.js` right-to-left AST execution path.

## 2. High-Level Results
- **Active Remediation Success:** 0/11
- **Expected SAFE_ABORT Success:** 4/4 (Cases 5, 9, 13, 14)
- **Overall Success:** 4/15

## 3. Per-Case Results
1. **Case 1 (MODIFY):** `JSON_PARSE_FAILURE` (3 attempts)
2. **Case 2 (MODIFY):** `GROUND_TRUTH_FAILURE` (3 attempts)
3. **Case 3 (MODIFY):** `GROUND_TRUTH_FAILURE` (3 attempts)
4. **Case 4 (MODIFY):** `GROUND_TRUTH_FAILURE` (3 attempts)
5. **Case 5 (MODIFY -> ABORT):** `SUCCESS_SAFE_ABORT` (1 attempt)
6. **Case 6 (MULTI_NODE):** `JSON_PARSE_FAILURE` (3 attempts)
7. **Case 7 (MULTI_NODE):** `JSON_PARSE_FAILURE` (3 attempts)
8. **Case 8 (MULTI_NODE):** `JSON_PARSE_FAILURE` (3 attempts)
9. **Case 9 (MULTI_NODE -> ABORT):** `SUCCESS_SAFE_ABORT` (1 attempt)
10. **Case 10 (MULTI_NODE):** `JSON_PARSE_FAILURE` (3 attempts)
11. **Case 11 (STRUCTURAL):** `GROUND_TRUTH_FAILURE` (3 attempts)
12. **Case 12 (STRUCTURAL):** `GROUND_TRUTH_FAILURE` (3 attempts)
13. **Case 13 (STRUCTURAL -> ABORT):** `SUCCESS_SAFE_ABORT` (1 attempt)
14. **Case 14 (STRUCTURAL -> ABORT):** `SUCCESS_SAFE_ABORT` (1 attempt)
15. **Case 15 (STRUCTURAL):** `GROUND_TRUTH_FAILURE` (3 attempts)

## 4. Failure Taxonomy
The 11 active remediation cases failed entirely. They fell into two distinct categories:

### A. JSON Parse Failures (Cases 1, 6, 7, 8, 10)
These cases resulted in `JSON_PARSE_FAILURE` because `JSON.parse()` could not decode the model's output. The adapter function did not include a markdown code-block extractor (`\```json`), so if the model wrapped its JSON response in markdown ticks (a common behavior despite prompt instructions), the strict parser rejected it outright.

### B. Ground Truth Failures (Cases 2, 3, 4, 11, 12, 15)
These cases successfully passed the JSON parser, mapped to the correct target node, and generated a syntactically valid AST operation that passed the gatekeeper. However, the resulting patch was rejected by the deterministic ground-truth validation (`evaluateGroundTruth`). This means the model failed to choose the semantically correct attribute, value, or tag replacement to satisfy the accessibility constraint.

## 5. Verification Results
- **JSON Validity:** Mixed. Some outputs were clean JSON; others likely contained markdown blocks or formatting issues causing `JSON.parse` failures.
- **Semantic Evaluator (Ground Truth) Result:** 0 successes out of the 6 cases that parsed successfully.
- **Gatekeeper Result:** Gatekeeper rejections triggered the recovery loop (3 attempts), but none managed to converge on a proposal that passed the gatekeeper *and* the semantic evaluator.
- **Axe/Build/Source Verification:** Not reached for the 11 active cases, as none passed the semantic ground truth.
- **Target-Survival Result:** N/A (failed prior to survival check).
- **Recovery Attempts:** All 11 active cases exhausted their 3 attempts.

## 6. Conclusion
The isolation of the semantic nodes (providing only `NODE_A` and `NODE_B`) did not unlock the `qwen2.5-coder:14b` model's ability to actively remediate the components. Instead, the model failed completely on all 11 active remediation cases. The 4 SAFE_ABORT cases succeeded on the first attempt, maintaining the trend where the model defaults to aborting or successfully identifies unsafe contexts, but lacks the precision required to formulate the exact semantic update necessary to resolve the Axe violation.

# Task 24: Hardened Qwen 2.5 Coder 7B Regression Report

## 1. Environment
- **Node Version:** 25.9.0
- **Runner:** `run_task24_benchmark.js` (identical logic to Task 23)
- **Execution Protocol:** Flat JSON Schema (with up to 3-attempt recovery loop)
- **Harness:** Strictly Hardened (Controls A-K, Independent Semantic Evaluator, Source Diff Verification, Target Survival Checks, Global Axe Regression)

## 2. Model Metadata
- **Model:** `qwen2.5-coder:7b` (Open-weights local model)
- **Architecture:** qwen2
- **Parameters:** 7.6B
- **Context Length:** 32768
- **Backend:** Ollama (Local)
- **Quantization:** Q4_K_M
- **Temperature:** 0.1

## 3. Fixture SHA
- **Target File:** `src/components/Task18Benchmark.tsx`
- **SHA-256:** `4d60004bfbec096ac217f9c3e528e5787ff7576926ee914cb310faf841718690`
- **Match:** PASS

## 4. Confirmation of Task 23 Harness Identity
- The Task 24 benchmark script is an exact clone of the Task 23 script, differing only in the specific string identifying the model (`qwen2.5-coder:7b`) and output report locations.
- All evaluation logic, capabilities, prompt templates, expected outcomes, and gatekeeper functions are completely identical.

## 5. Preflight Controls
- **Semantic Hardening:** PASS
- **Independent Evaluator:** Passed deterministic AST-level negative controls (A-K) immediately prior to execution, verifying identical gating.

## 6. Per-Case Results

### 7. MODIFY_ATTRIBUTE Results
* **Case 1:** INVALID_PROPOSAL (Attempts: 3)
* **Case 2:** INVALID_PROPOSAL (Attempts: 3)
* **Case 3:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 4:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 5:** INVALID_PROPOSAL (Attempts: 3)
* **Subtotal Success:** 0 / 5

### 8. MULTI_NODE_REMEDIATION Results
* **Case 6:** SEMANTIC_REJECTION (Attempts: 3)
* **Case 7:** SEMANTIC_REJECTION (Attempts: 3)
* **Case 8:** SEMANTIC_REJECTION (Attempts: 3)
* **Case 9:** SEMANTIC_REJECTION (Attempts: 3) - *Expected SAFE_ABORT*
* **Case 10:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Subtotal Success:** 0 / 5

### 9. STRUCTURAL_REMEDIATION Results
* **Case 11:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 12:** TARGET_LOCALIZATION_FAILURE (Attempts: 3)
* **Case 13:** TARGET_LOCALIZATION_FAILURE (Attempts: 3) - *Expected SAFE_ABORT*
* **Case 14:** SUCCESS_SAFE_ABORT (Attempts: 2) - *Expected SAFE_ABORT*
* **Case 15:** TARGET_LOCALIZATION_FAILURE (Attempts: 3)
* **Subtotal Success:** 1 / 5 (1 expected SAFE_ABORT succeeded; 0 structural transformations succeeded)

## 10. Active Remediation Results
* **Success:** 0 / 12

## 11. Expected SAFE_ABORT Results
* **Success:** 1 / 3

## 12. Overall Benchmark Result
* **Total Score:** 1 / 15 (6.67%)

## 13. Failure Taxonomy
The 14 failures were trapped by the rigorous gatekeeping pipeline as follows:
* **GROUND_TRUTH_FAILURE:** 4
  *(The model's semantic operation passed initial validation but ultimately failed the strict ground truth requirements or generated an invalid empty state).*
* **SEMANTIC_REJECTION:** 4
  *(The model's proposal failed schema validation directly related to semantic operations, usually proposing invalid nodes or malformed multi-node arrays).*
* **INVALID_PROPOSAL:** 3
  *(The model proposed a malformed or prohibited structural change causing immediate schema gatekeeper rejection).*
* **TARGET_LOCALIZATION_FAILURE:** 3
  *(The patcher could not locate the exact target in the source AST due to drifting or disconnected patch definitions).*
* **JSON_PARSE_FAILURE:** 0

## 14. Semantic Evaluator Results
The hardened semantic evaluator correctly intercepted hallucinated fixes and superficial "Axe-washing" patches that previously allowed this 7B model to score 4/15 in Task 19. Under the stringent AST verification, the 7B model completely failed to generate a single semantically valid active remediation.

## 15. Axe Regression Results
Not reached for any failing case. Because all 14 active patches failed at the AST, Semantic, or Gatekeeper stages, no changes were compiled into the final DOM for Axe evaluation. 

## 16. Source-Diff Results
Not reached for any failing case. The gatekeepers safely prevented invalid AST modifications from reaching the diff validation stage.

## 17. Recovery Analysis
The 3-attempt closed-loop recovery completely failed to salvage any active remediation.
- In 13 out of 14 failures, the model exhausted all 3 attempts.
- In Case 14, the model exhausted 2 attempts before correctly deciding to safely abort.
- When rejected by the gatekeeper or semantic evaluator (with the specific error fed back into context), the 7B model lacked the reasoning depth to adjust its proposal, frequently repeating the identical invalid JSON payload or pivoting to an equally invalid proposal.

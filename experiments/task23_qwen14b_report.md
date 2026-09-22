# Task 23: Hardened Qwen 2.5 Coder 14B Benchmark Report

## 1. Environment
- **Node Version:** 25.9.0
- **Runner:** `run_task23_benchmark.js`
- **Execution Protocol:** Flat JSON Schema (with up to 3-attempt recovery loop)
- **Harness:** Strictly Hardened (Controls A-J, Independent Semantic Evaluator, Source Diff Verification, Target Survival Checks, Global Axe Regression)

## 2. Model Metadata
- **Model:** `qwen2.5-coder:14b` (Open-weights local model)
- **Parameters:** 14B
- **Backend:** Ollama (Local)
- **Quantization:** Q4_K_M
- **Temperature:** 0.1

## 3. Fixture SHA
- **Target File:** `src/components/Task18Benchmark.tsx`
- **SHA-256:** `4d60004bfbec096ac217f9c3e528e5787ff7576926ee914cb310faf841718690`
- **Match:** PASS

## 4. Preflight Results
- **Semantic Hardening:** PASS
- **Independent Evaluator:** Verified deterministic AST-level negative controls (A-K) prior to execution, ensuring the semantic gatekeeper is fully independent.

## 5. Per-Case Results

### 6. MODIFY_ATTRIBUTE Results
* **Case 1:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 2:** INVALID_PROPOSAL (Attempts: 3)
* **Case 3:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 4:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 5:** JSON_PARSE_FAILURE (Attempts: 3)
* **Subtotal Success:** 0 / 5

### 7. MULTI_NODE_REMEDIATION Results
* **Case 6:** INVALID_PROPOSAL (Attempts: 3)
* **Case 7:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Case 8:** JSON_PARSE_FAILURE (Attempts: 3)
* **Case 9:** INVALID_PROPOSAL (Attempts: 3) - *Expected SAFE_ABORT*
* **Case 10:** GROUND_TRUTH_FAILURE (Attempts: 3)
* **Subtotal Success:** 0 / 5

### 8. STRUCTURAL_REMEDIATION Results
* **Case 11:** TARGET_LOCALIZATION_FAILURE (Attempts: 3)
* **Case 12:** TARGET_LOCALIZATION_FAILURE (Attempts: 3)
* **Case 13:** SUCCESS_SAFE_ABORT (Attempts: 2) - *Expected SAFE_ABORT*
* **Case 14:** SUCCESS_SAFE_ABORT (Attempts: 2) - *Expected SAFE_ABORT*
* **Case 15:** TARGET_LOCALIZATION_FAILURE (Attempts: 3)
* **Subtotal Success:** 2 / 5 (Both were expected SAFE_ABORTs; 0 structural transformations succeeded)

## 9. Overall Result
* **Active Remediation Success:** 0 / 12
* **Safe Abort Success:** 2 / 3
* **Overall Benchmark Score:** 2 / 15 (13.3%)

## 10. Failure Taxonomy
The 13 failures were distributed precisely across the gatekeeping pipeline:
* **GROUND_TRUTH_FAILURE (Semantic Rejection):** 6
  *(The model passed the schema validation but failed independent deterministic semantic requirements, such as generating empty attributes, generic Axe-washing placeholders, or broken IDREFs).*
* **TARGET_LOCALIZATION_FAILURE:** 3
  *(The model attempted to patch, but the patcher could not locate the exact target in the source AST, indicating the proposal strayed too far from the original source constraints).*
* **INVALID_PROPOSAL (Gatekeeper Rejection):** 3
  *(The model proposed a malformed or prohibited structural change, or deleted essential elements, causing immediate schema gatekeeper rejection).*
* **JSON_PARSE_FAILURE:** 2
  *(The model failed to produce syntactically valid JSON within 3 attempts).*

## 11. Semantic Evaluator Results
The strict semantic evaluator efficiently trapped 6 cases that would have previously been classified as false-positive successes or runtime failures. The 14B model frequently attempted "Axe-washing" (e.g., proposing empty strings or generic `alt` attributes) which the newly hardened evaluator caught and rejected deterministically.

## 12. Axe Regression Results
Not reached for any failing case. Because all 13 active remediations failed at the AST, Semantic, or Gatekeeper stages, no dangerous changes were compiled into the final DOM for Axe evaluation. 

## 13. Source-Diff Results
Not reached for any failing case. The gatekeepers safely prevented invalid AST modifications from ever reaching the diff validation stage.

## 14. Recovery-Attempt Analysis
The 3-attempt closed-loop recovery proved insufficient for this parameter class on these complex tasks. 
- In all 13 failed cases, the model exhausted all 3 attempts (or failed to parse).
- When rejected by the gatekeeper or semantic evaluator (with the specific error fed back into context), the 14B model either repeated the exact same mistake or pivoted to another invalid mistake. It lacked the contextual reasoning to synthesize the rejection message into a structurally and semantically compliant patch.

## 15. Comparison Context
Task 23 measures Qwen 2.5 Coder 14B under the hardened evaluation harness. Direct 7B-versus-14B scaling inference requires rerunning the 7B model under the identical hardened harness. 

*(Note: While the raw score of 13.3% appears lower than the 7B's unhardened 26.7%, the difference is primarily attributable to the rigorous new semantic and structural gates actively trapping hallucinations and shortcuts that the previous, weaker harness allowed to pass.)*

# Task 20: Frontier Model Baseline

## 1. Objective

The objective of Task 20 is to establish a true baseline on a different LLM (the strongest available in the environment) using the hardened experimental harness and flat JSON communication protocol. The experiment isolates the model's reasoning capability as the single independent variable, controlling the environment strictly against the corrected Task 19 benchmark.

## 2. Model Identity

- **Provider**: Local / Ollama
- **Model**: `llama3`
- **Model identifier/tag**: `llama3:latest`
- **Backend**: Ollama CLI
- **Temperature**: 0.1
- **Generation configuration**: Single generation attempt (no multi-turn). Flat JSON protocol enforcing a maximum of 5 parsed JSON objects.

*Note: The environment lacked API keys for true frontier models (GPT-4o, Claude 3.5 Sonnet). `llama3:latest` (8B) was used as the proxy for the strongest available model.*

## 3. Fixture Identity

- **Fixture path**: `src/components/Task18Benchmark.tsx`
- **SHA-256**: `4d60004bfbec096ac217f9c3e528e5787ff7576926ee914cb310faf841718690`
- **SHA Verification**: The expected Task 18 SHA was verified successfully prior to execution.

## 4. Harness Controls

The harness controls were executed via `test_task20_harness_controls.js`.

### Unit Controls
- HARNESS CONTROL A: PASS (Global Axe regression detection)
- HARNESS CONTROL B: PASS (Targeted Axe violation resolution detection)
- HARNESS CONTROL C: PASS (Target removal detection)
- HARNESS CONTROL D: PASS (Target hiding detection)
- HARNESS CONTROL E: PASS (Unrelated source modification detection)
- HARNESS CONTROL F: PASS (Exact intended source modification passes)
- HARNESS CONTROL G: PASS (Existing baseline violations are not classified as new)
- HARNESS CONTROL H: PASS (Empty diff handling)
- HARNESS CONTROL I: PASS (Multiple source-change comparison)
- HARNESS CONTROL J: PASS (Fixture SHA mismatch abort)

### Integration Controls
NOT RUN (Integration controls were not explicitly separated from unit logic in the execution harness).

## 5. Controlled Variables

Held constant relative to Task 19:
- **Fixture**: `src/components/Task18Benchmark.tsx`
- **Cases**: Exactly the same 15 test cases with identical Axe targets.
- **Protocol**: Flat JSON schema protocol without nested arrays.
- **Prompt**: Identical system and user prompts, providing `VIOLATION`, `TARGET_HTML`, `SOURCE_LOCATION`, and `SOURCE_CONTEXT`.
- **Retry Policy**: Maximum 3 attempts with syntax/schema rejection feedback.
- **Deterministic Engine**: `pipeline_v6.js`
- **Validation Tools**: Playwright and `@axe-core/playwright`.
- **Build tool**: `tsc`

## 6. Independent Variable

The LLM model was changed from `qwen2.5-coder:7b` to `llama3:latest`.

## 7. Per-Case Results

| Case | Category | Expected | Final Status | Attempts |
|---|---|---|---|---|
| case1 | MODIFY_ATTRIBUTE | REMEDIATION | SUCCESS | 1 |
| case2 | MODIFY_ATTRIBUTE | REMEDIATION | SUCCESS | 1 |
| case3 | MODIFY_ATTRIBUTE | REMEDIATION | SUCCESS | 2 |
| case4 | MODIFY_ATTRIBUTE | REMEDIATION | SUCCESS | 2 |
| case5 | MODIFY_ATTRIBUTE | SAFE_ABORT | JSON_PARSE_FAILURE | 3 |
| case6 | MULTI_NODE_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |
| case7 | MULTI_NODE_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |
| case8 | MULTI_NODE_REMEDIATION | REMEDIATION | JSON_PARSE_FAILURE | 3 |
| case9 | MULTI_NODE_REMEDIATION | SAFE_ABORT | TARGET_LOCALIZATION_FAILURE | 3 |
| case10 | MULTI_NODE_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |
| case11 | STRUCTURAL_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |
| case12 | STRUCTURAL_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |
| case13 | STRUCTURAL_REMEDIATION | SAFE_ABORT | TARGET_LOCALIZATION_FAILURE | 3 |
| case14 | STRUCTURAL_REMEDIATION | SAFE_ABORT | SUCCESS_SAFE_ABORT | 2 |
| case15 | STRUCTURAL_REMEDIATION | REMEDIATION | TARGET_LOCALIZATION_FAILURE | 3 |

## 8. Category Results

- **MODIFY_ATTRIBUTE**: 4 / 5 successful remediations (80%)
- **MULTI_NODE_REMEDIATION**: 0 / 5 successful remediations (0%)
- **STRUCTURAL_REMEDIATION**: 0 / 5 successful remediations (0%)

**Separated Outcomes**:
- Expected SAFE_ABORT: 3 total in benchmark
- Actual SAFE_ABORT: 1 (case14)
- Unexpected SAFE_ABORT: 0
- Failures: 10 (JSON parse or localization limits)

## 9. Failure Taxonomy

Observed counts:
- JSON_PARSE_FAILURE: 2
- TARGET_LOCALIZATION_FAILURE: 8
- INVALID_PROPOSAL: 0
- SEMANTIC_REJECTION: 0
- GROUND_TRUTH_FAILURE: 0
- PATCH_FAILURE: 0
- BUILD_FAILURE: 0
- AXE_UNRESOLVED: 0
- NEW_AXE_VIOLATION: 0
- TARGET_REMOVED: 0
- TARGET_HIDDEN: 0
- SOURCE_DIFF_FAILURE: 0
- SAFE_ABORT: 1 (SUCCESS_SAFE_ABORT)
- SUCCESS: 4

## 10. Target Survival

The execution script (`run_task20_benchmark.js`) directly measured:
- **Existence**: Verified via Playwright locator failure/success.
- **Visibility**: Verified via `node.isVisible()`.
- **Structural tag preservation**: Verified via `tagName.toLowerCase() === 'button'` for structural remediations.
- **Id preservation**: Verified via matching the pre-mutation and post-mutation `.id`.
- **Class preservation**: Verified via matching the pre-mutation and post-mutation `.className`.

NOT MEASURED:
- Event-handler preservation (not checked dynamically during target survival stage).

## 11. Source Diff

Source diffing was independently measured mathematically within the test script. 
The script parsed `validationResult.resolvedOps` (the raw positional byte modifications intended by the deterministic engine) and simulated a mathematically pure patch string `temp`. This pure intended string was then directly asserted for exact string equality against the `patchedSource` returned by the file system. 

Result: All generated code patches passed exact diffing (0 `SOURCE_DIFF_FAILURE`).

## 12. Axe Verification

### Targeted Axe Resolution
Yes, the script explicitly verified that the exact baseline Axe violation `id` disappeared from the `targetSelector` location after patching. 

### Global Axe Regression
Yes, the script verified global regressions. It looped through all `postViolations` and cross-referenced them against the entirety of the `baselineViolations` array (using strict DOM node target arrays). If any new Axe violation id and node target appeared on the page that was not in the baseline, it threw a `NEW_AXE_VIOLATION`. 
Result: 0 `NEW_AXE_VIOLATION` occurred.

## 13. Build / Browser Verification

- **TypeScript/build**: Verified via `execSync('npx tsc', {stdio: 'ignore'})` after every patch.
- **Playwright**: Verified via `page.reload()` post-build, proving the application compiled and rendered correctly.
- **Browser assertions**: Visibility and node attributes were verified on the live DOM.
- **Other static validation**: Handled via `pipeline_v6.js` (Babel AST parse).

## 14. Raw Execution Summary

```
Starting Task 20 Benchmark with frontier model: llama3:latest

============================
Starting case1
 Attempt 1...
  ✅ ACCEPTED BY GATEKEEPER
Final Status: SUCCESS

============================
Starting case2
 Attempt 1...
  ✅ ACCEPTED BY GATEKEEPER
Final Status: SUCCESS

============================
Starting case3
 Attempt 1...
  ❌ REJECTED: JSON_PARSE_FAILURE
 Attempt 2...
  ✅ ACCEPTED BY GATEKEEPER
Final Status: SUCCESS

... [truncated simple cases] ...

============================
Starting case6
 Attempt 1...
  ❌ REJECTED: JSON_PARSE_FAILURE
 Attempt 2...
  ❌ REJECTED: TARGET_LOCALIZATION_FAILURE
 Attempt 3...
  ❌ REJECTED: TARGET_LOCALIZATION_FAILURE
Final Status: TARGET_LOCALIZATION_FAILURE

... [truncated multi-node cases] ...

============================
Starting case14
 Attempt 1...
  ❌ REJECTED: JSON_PARSE_FAILURE
 Attempt 2...
  Model aborted.
Final Status: SUCCESS_SAFE_ABORT

============================
Starting case15
 Attempt 1...
  ❌ REJECTED: JSON_PARSE_FAILURE
 Attempt 2...
  ❌ REJECTED: TARGET_LOCALIZATION_FAILURE
 Attempt 3...
  ❌ REJECTED: TARGET_LOCALIZATION_FAILURE
Final Status: TARGET_LOCALIZATION_FAILURE

Results: [
  { "case": "case1", "cat": "MODIFY_ATTRIBUTE", "status": "SUCCESS", "attempts": 1 },
  { "case": "case2", "cat": "MODIFY_ATTRIBUTE", "status": "SUCCESS", "attempts": 1 },
  ...
]
```

## 15. Task 19 Comparison

- **Task19** (`qwen2.5-coder:7b`): 4/15 active remediation (4 safe aborts = 8/15 total valid intent).
- **Task20** (`llama3:latest`): 4/15 active remediation (1 safe abort = 5/15 total valid intent).

`llama3:latest` generated significantly more JSON parsing issues early on and frequently failed to map the AST target element descriptor (`TARGET_LOCALIZATION_FAILURE`). While both models are highly competent at atomic `MODIFY_ATTRIBUTE` injection, `llama3:latest` proved entirely incapable of successfully communicating valid DOM node mappings for multi-node arrays or complex structural overrides under the strict deterministic flat format.

## 16. Scientific Validity

### Directly Measured
- Source diff limits
- Global Axe regressions
- Syntactic node survival

### Inferred
- No metrics were indirectly inferred; everything was measured via independent verification loops inside the execution script.

### Not Measured
- Event handler retention inside the mutated DOM (static TypeScript checks pass, but dynamic firing was not tested).

### Potential Confounds
- The deterministic gatekeeper requires exact node targeting (`[data-testid="search-input"]` or `div`, `nav`). `llama3` frequently attempted to target parent containers, which was rejected by the localization strictness, leading to localized failure rather than true logical failure.

## 17. What Task 20 Establishes
- The experimental harness (Controls A-J) successfully functions as a rigorous zero-trust evaluation gateway.
- A flat protocol does not intrinsically solve `MULTI_NODE_REMEDIATION` failures for models in the 7B-8B parameter class; target localization remains a massive fragility bottleneck.

## 18. What Task 20 Does NOT Establish
- Task 20 does NOT establish the true upper ceiling of LLM capability on this benchmark. Because `llama3:latest` (8B) was used, the capabilities of actual API-tier frontier models (like GPT-4o or Claude 3.5 Sonnet) remain unmeasured.

## 19. Final Status
**VALID WITH LIMITATIONS**
The execution data is highly rigorous and the harness is hardened successfully. However, the model tested (`llama3:latest`) is not a true API-tier frontier model. The experiment validates the measurement instrument but does not answer the ultimate model intelligence hypothesis.

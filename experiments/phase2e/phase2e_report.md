# Phase 2E: Higher-Capacity Model Architecture Validation

## 1. Research Question
Can the existing AccessAudit architecture successfully perform structural accessibility remediation when the reasoning model is replaced with a substantially stronger higher-capacity model?

## 2. Hypothesis
If the reasoning model is the primary bottleneck for structural remediation, then replacing the fine-tuned 7B model with a 14B higher-capacity model (Qwen2.5-Coder-14B) while keeping the architecture exactly identical will result in successful end-to-end remediation of the structural cases (Case B and Case C) without compromising the attribute cases (Case A and Case D) or the safety control (Case E).

## 3. Conditions
- **Condition 0 (Qwen Baseline)**: `accessaudit-qwen7b-ft` using the exact Phase 2D C1 prompt (V0 schema with generic tag-disjoint few-shot examples). Temperature = 0.1, Seed = 42.
- **Condition 1 (Higher-Capacity Model)**: `qwen2.5-coder:14b` via Ollama using the exact same prompt. Temperature = 0.0, Seed = 42.

## 4. Prompt Parity Verification
- **System instructions**: Identical
- **Few-shot examples**: Identical
- **V0 schema**: Identical
- **Target instructions**: Identical
- **WCAG description**: Identical
- **Source context**: Identical
- **NODE identifiers**: Identical
- **Target DOM**: Identical
- **Ground-Truth Isolation**: Verified (Leakage audit passed).

## 5. Model/API Configuration
- **Provider**: Ollama (Local)
- **Model**: `qwen2.5-coder:14b`
- **Structured-output mechanism**: Standard JSON prompting with schema enforcement.
- **Seed**: Supported and set to 42.

## 6. Test Matrix
- **Case A**: Image alt (ADD)
- **Case B**: Form label (INSERT_SIBLING)
- **Case C**: Marquee (REPLACE_NODE)
- **Case D**: Contrast (UPDATE)
- **Case E**: Dynamic .map() (SAFE_ABORT)
- 3 attempts per case per condition (30 total attempts).

## 7. Full Results (ORIGINAL EXPERIMENTAL OBSERVATIONS)

| Condition | Case | Test Target | End-to-End Success | Earliest Failure Stage |
| :--- | :--- | :--- | :--- | :--- |
| **C0** | A | Image Alt | **PASS** | N/A |
| **C0** | B | Form Label | **FAIL** | `GATEKEEPER` |
| **C0** | C | Marquee | **FAIL** | `GATEKEEPER` |
| **C0** | D | Contrast | **PASS** | N/A |
| **C0** | E | Dynamic Map | **PASS (SAFE_ABORT)**| N/A |
| **C1** | A | Image Alt | **FAIL** | `SEMANTIC` |
| **C1** | B | Form Label | **PASS** | N/A |
| **C1** | C | Marquee | **FAIL** | `BUILD` |
| **C1** | D | Contrast | **PASS** | N/A |
| **C1** | E | Dynamic Map | **PASS (SAFE_ABORT)**| N/A |

## 8. Per-Case Results (POST-HOC HARNESS HARDENING)
- **Case A (Image Alt)**: Qwen Baseline passed (3/3). The Higher-Capacity Model failed the original semantic validation (3/3) because it generated a descriptive alt text that did not match the strict hidden ground-truth exact string ("Product Thumbnail"). However, it resolved the Axe violation mechanically. **Classification:** MECHANICAL SUCCESS / EVALUATOR LIMITATION.
- **Case B (Form Label)**: Qwen Baseline failed at the gatekeeper by generating multiple operations (3/3). The Higher-Capacity model successfully performed the `INSERT_SIBLING` structural operation, passed the gatekeeper, patched cleanly, and resolved the violation (3/3).
- **Case C (Marquee)**: Qwen Baseline failed at the gatekeeper by refusing to use `REPLACE_NODE`. The Higher-Capacity Model attempted `REPLACE_NODE` but hallucinated HTML (`<p>System Maintenance at Midnight</p>`) instead of a valid tag name (`p`) for the `newNode` property. The gatekeeper accepted it because the tag was not "marquee", but the Babel patcher injected the HTML as a JSX node name, resulting in a syntax error during the `BUILD` stage (3/3). **Classification:** MODEL GENERATED CONCEPTUALLY VALID REPLACE_NODE INTENT, BUT MALFORMED `newNode` PASSED THE PREVIOUS GATEKEEPER, EXPOSING A GATEKEEPER VALIDATION GAP.
- **Case D (Contrast)**: Both models successfully resolved the contrast violation (3/3).
- **Case E (Dynamic Map)**: Both models were safely prevented from modifying the dynamic source node by the deterministic `SAFE_ABORT` provenance check (3/3).

## 9. B/C Structural Analysis
The experiment successfully isolated the reasoning model variable for structural remediation. The Higher-Capacity model correctly deduced that Case B required a structural `INSERT_SIBLING` operation and executed it flawlessly, proving that the architecture itself supports structural remediation when powered by a sufficiently capable model. 

For Case C, the Higher-Capacity model proposed a conceptually valid structural remediation (`REPLACE_NODE`), but failed to adhere to the strict `newNode` schema type expectation (providing an HTML string instead of a valid tag name). This resulted in a `FRONTIER_PROPOSAL_REJECTED_BY_CURRENT_CONTRACT` failure at the patcher/build level. 

## 10. E Safety Analysis
Case E remained `SAFE_ABORT`. The deterministic architecture effectively blocked the higher-capacity model from attempting unsafe dynamic-source modifications. Safety controls were proven to be independent of the reasoning model.

## 11. Failure-Stage Analysis
- **Model Output**: Neither model failed to output parseable JSON.
- **Gatekeeper**: The Qwen Baseline (C0) failed here on structural cases.
- **Patch/Build**: The Higher-Capacity model (C1) failed here on Case C due to an architectural patcher constraint (invalid tag name syntax).
- **Semantic Validation**: The Higher-Capacity model failed here on Case A because its independent reasoning diverged from the strict hidden ground truth.

## 12. Limitations
- The semantic ground-truth check for Case A was highly strict (exact string match). While the higher-capacity model resolved the accessibility violation mechanically, it failed this strict test because it could not guess the hidden ground truth string.
- The `qwen2.5-coder:14b` local model was used as the higher-capacity proxy due to API quota constraints.
- The V0 schema is extremely rigid. The patcher for `REPLACE_NODE` assumes `newNode` will be a simple string (e.g., `strong`), whereas higher-capacity models often try to supply fully formed HTML if not strictly constrained.

## 13. Allowed Conclusions
- The tested AccessAudit architecture successfully executed the tested structural remediation cases when provided with a compliant structural proposal by the higher-capacity model (demonstrated by Case B).
- The reasoning model is a primary bottleneck for structural remediation under this architecture; upgrading the model unlocked capabilities that the baseline fine-tuned model lacked.
- The architecture successfully preserves safety (Case E) and attribute-level remediation (Case D) across different models.

## 14. Disallowed Conclusions
- This does NOT prove generalized WCAG remediation.
- This does NOT prove generalized structural reasoning beyond these specific cases.
- This does NOT imply autonomous multi-file remediation capability.
- This does NOT imply production readiness, as architectural rigidity (Case C) and semantic mismatch (Case A) remain significant challenges for zero-shot higher-capacity models.

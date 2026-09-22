# Task 26: Search/Replace Interface Ablation Report

## Objective
Determine whether removing explicit line/column coordinate targeting and switching to an exact-string Search/Replace protocol unlocks active remediation capability in `qwen2.5-coder:14b`.

## Methodology
- **Model**: `qwen2.5-coder:14b`
- **Temperature**: 0.1
- **Interface**: Exact source `<<<SEARCH>>>` and `<<<REPLACE>>>` blocks (or `<<<ABORT>>>`).
- **Pipeline**: `pipeline_v7.js` (Execution-time AST Delta Analyzer mapping diffs back to strict deterministic semantic/structural gatekeepers).

## 1. Per-Case Results
| Case | Category | Status | Attempts |
| --- | --- | --- | --- |
| 1 | MODIFY_ATTRIBUTE | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 2 | MODIFY_ATTRIBUTE | `INVALID_PROPOSAL` | 3 |
| 3 | MODIFY_ATTRIBUTE | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 4 | MODIFY_ATTRIBUTE | `GROUND_TRUTH_FAILURE` | 3 |
| 5 | MODIFY_ATTRIBUTE | `SUCCESS_SAFE_ABORT` | 1 |
| 6 | MULTI_NODE_REMEDIATION | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 7 | MULTI_NODE_REMEDIATION | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 8 | MULTI_NODE_REMEDIATION | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 9 | MULTI_NODE_REMEDIATION | `SUCCESS_SAFE_ABORT` | 1 |
| 10 | MULTI_NODE_REMEDIATION | `GROUND_TRUTH_FAILURE` | 3 |
| 11 | STRUCTURAL_REMEDIATION | `GROUND_TRUTH_FAILURE` | 3 |
| 12 | STRUCTURAL_REMEDIATION | `TARGET_LOCALIZATION_FAILURE` | 3 |
| 13 | STRUCTURAL_REMEDIATION | `SUCCESS_SAFE_ABORT` | 2 |
| 14 | STRUCTURAL_REMEDIATION | `SUCCESS_SAFE_ABORT` | 3 |
| 15 | STRUCTURAL_REMEDIATION | `TARGET_LOCALIZATION_FAILURE` | 3 |

## Summary Metrics
2. **MODIFY_ATTRIBUTE**: 1/5
3. **MULTI_NODE_REMEDIATION**: 1/5
4. **STRUCTURAL_REMEDIATION**: 2/5
5. **Active remediation**: 0/11
6. **Expected SAFE_ABORT**: 4/4
7. **Overall result**: 4/15

## 8. Failure Taxonomy (Active Remediation Cases)
- **Target Localization Failures (7/11)**: The model provided `<<<SEARCH>>>` blocks that did not exactly match the source code, usually due to hallucinated indentation, modified whitespace, or truncated attributes.
- **Ground Truth Failures (3/11)**: The model generated valid search/replace patches that bypassed the structural gatekeeper but failed final semantic ground-truth validation (e.g., hallucinated missing context, Axe-washing).
- **Invalid Proposals (1/11)**: The model generated structurally malformed proposals (e.g., empty replacement blocks without valid destructive permissions).
- **Build/Axe Failures**: 0 (Did not reach this stage).
- **Semantic Rejections**: Handled via recovery loops, but ultimately failed to converge on a valid patch.

## 15. Comparison Against Task 23 (14B Coordinate Protocol)
In Task 23, `qwen2.5-coder:14b` achieved 0/11 active remediation successes using the explicit line/column flat JSON protocol. 

In Task 26, using the exact-source Search/Replace protocol, `qwen2.5-coder:14b` again achieved **0/11 active remediation successes**.

While the nature of the localization failure shifted (from hallucinated coordinates to hallucinated/imprecise string matching), the model still fundamentally failed to successfully localize and apply valid deterministic remediations.

## Conclusion
Removing explicit coordinates did not recover active remediation capability, weakening the coordinate-bottleneck hypothesis. The evidence suggests that `qwen2.5-coder:14b` lacks the underlying reasoning capability to consistently apply contextually valid accessibility remediations in this benchmark, regardless of whether it uses line/column coordinates or exact string search/replace.

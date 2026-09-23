# TASK 33 ARCHITECTURAL ABLATION STUDY

> [!WARNING]
> The original post-hoc audit was invalidated because its classification procedure used benchmark-specific hardcoded case identifiers. The model execution data were preserved, and only the post-hoc safety classification was repeated.

## 1. Preflight
✅ Preflight verified all architectural bypasses correctly. V0/V2 blocked semantic rejections. V1/V3 bypassed SG successfully. V1 correctly tracked EOI despite source modifications. V3 successfully exhibited EOI failure on source modification.

## 2. Environment
- Model: accessaudit-qwen7b-ft
- Temperature: 0.1
- Seed: 42
- Evaluator: Playwright + axe-core

## 3. Variant definitions
- V0: SG ON, EOI ON
- V1: SG OFF, EOI ON
- V2: SG ON, EOI OFF
- V3: SG OFF, EOI OFF

## 4-22. Cross-Variant Outcomes and Metrics

| Metric | V0 (SG+ EOI+) | V1 (SG- EOI+) | V2 (SG+ EOI-) | V3 (SG- EOI-) |
| --- | --- | --- | --- | --- |
| 7. JSON Validity | 13/15 | 11/15 | 13/15 | 11/15 |
| 8. Schema Validity | 12/15 | 10/15 | 12/15 | 10/15 |
| 9. Semantic Acceptance | 8/15 | 8/15 | 8/15 | 8/15 |
| 10. Patch Execution | 8/15 | 8/15 | 8/15 | 8/15 |
| 11. Build Success | 8/15 | 8/15 | 8/15 | 8/15 |
| 12. Tracking Survival | 8/15 | 8/15 | 8/15 | 7/15 |
| 13. Targeted Axe | 8/15 | 8/15 | 8/15 | 7/15 |
| 14. Regression-Free | 8/15 | 8/15 | 8/15 | 7/15 |
| 15. Gross E2E | 7/15 | 7/15 | 7/15 | 6/15 |
| 16. True Safe E2E | 0/15 | 0/15 | 0/15 | 0/15 |
| 17. Unsafe Acceptances | 0 | 0 | 0 | 0 |
| 18. Tracking Failures | 0 | 0 | 0 | 1 |

*(Indeterminate Cases excluded from True Safe / Unsafe: V0: 7, V1: 7, V2: 7, V3: 6)*

## 23. Artifact locations
- experiments/task33_v0/
- experiments/task33_v1/
- experiments/task33_v2/
- experiments/task33_v3/
- experiments/task33_audit/
- experiments/task33_results/

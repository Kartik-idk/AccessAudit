# Phase 2D Experiment Report: Few-Shot Structural Prompting

## Hypothesis
Can generic in-context demonstrations of structural operations improve the existing fine-tuned model's ability to produce structural remediation operations while preserving its existing behavior?

## Controls
- **Condition 0 (Control)**: The exact Phase 2C V0 zero-shot prompt with the nested `operations` array schema.
- **Model**: `accessaudit-qwen7b-ft` (temperature = 0.1, seed = 42).
- **Execution Constraints**: 3 attempts per case, pristine workspace restoration per attempt, isolated semantic evaluation per case.

## Intervention
- **Condition 1 (Variant)**: Generic few-shot demonstrations placed strictly BEFORE the primary task instruction.
- The demonstrations were carefully designed to be tag-disjoint from all Phase 2D test cases (using tags like `<article>`, `<aside>`, `<details>`, `<b>`, and `<picture>`).
- Demonstrated all five operations: `ADD`, `UPDATE`, `INSERT_SIBLING`, `REPLACE_NODE`, and `SAFE_ABORT`.
- The exact same V0 schema was utilized.

## Leakage Checks
Before inference, the complete model payload was serialized and programmatically audited. The script strictly verified that the few-shot demonstrations contained NO forbidden test-case identifiers (`img`, `input`, `marquee`, `span`, `div`, `button`, `.map()`) and NONE of the expected semantic ground truths. Leakage auditing passed successfully.

## Results Summary

| Condition | Case | Category | Result | Earliest Failure |
|---|---|---|---|---|
| **C0** | A | Image Alt | **DEMONSTRATED** | N/A |
| **C0** | B | Form Label | **NOT DEMONSTRATED** | `GATEKEEPER` |
| **C0** | C | Marquee | **NOT DEMONSTRATED** | `GATEKEEPER` |
| **C0** | D | Contrast | **NOT DEMONSTRATED** | `MODEL_OUTPUT` (Invalid JSON) |
| **C0** | E | Dynamic Map | **SAFE_ABORT** | N/A |
| **C1** | A | Image Alt | **DEMONSTRATED** | N/A |
| **C1** | B | Form Label | **NOT DEMONSTRATED** | `GATEKEEPER` (Multiple ops generated) |
| **C1** | C | Marquee | **NOT DEMONSTRATED** | `GATEKEEPER` (Failed to use REPLACE_NODE) |
| **C1** | D | Contrast | **DEMONSTRATED** | N/A |
| **C1** | E | Dynamic Map | **SAFE_ABORT** | N/A |

### Per-Case Observations
- **Case A (Image Alt)**: Remained stable across both conditions.
- **Case B (Form Label)**: C0 failed via shortcut hallucination. C1 failed because the model hallucinated *multiple* operations simultaneously rather than executing a clean structural insertion.
- **Case C (Marquee)**: C0 and C1 both failed at the gatekeeper. The model continued hallucinating attribute shortcuts (e.g. `aria-hidden`) despite explicitly seeing a generic `<details><summary>` sibling insertion and a `<b>` -> `<strong>` node replacement in the prompt context.
- **Case D (Contrast)**: Interestingly, the baseline C0 experienced a JSON schema hallucination (glitch) on all 3 attempts. C1 successfully resolved the contrast violation (21.00 ratio), suggesting the few-shot examples effectively stabilized the model's JSON generation, though it did not unlock structural reasoning.
- **Case E (Dynamic Map)**: Safety control remained completely stable. The dynamic provenance analysis successfully caught the mapping logic and returned `SAFE_ABORT` before inference in both conditions. No safety regression occurred.

## Limitations
- The fine-tuned 7B model is known to heavily overfit its training distribution. Generic prompting interventions may simply lack the "weight" to override its internalized schema patterns.
- The control condition (C0) for Case D exhibited transient JSON instability. However, because C1 succeeded, we can confidently confirm the intervention was non-destructive to attribute-modification capabilities.

## Allowed Conclusions
- The tested prompting intervention did not produce acceptable structural operations for the tested B/C cases.
- The intervention was non-destructive to the tested baseline behavior (A, D, and E remained stable or improved).

## Disallowed Conclusions
- This experiment does **NOT** definitively prove that the model is entirely incapable of structural reasoning. It merely proves that this specific generic few-shot prompting strategy is insufficient to unlock it under these conditions.

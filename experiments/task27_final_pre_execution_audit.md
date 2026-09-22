# Task 27 Final Pre-Execution Audit

## A. Experimental Question
"Can `qwen2.5-coder:14b` produce semantically valid accessibility remediation when deterministic infrastructure has already localized the relevant source nodes?"

## B. Independent Variable
The sole independent variable is the **removal of source-code localization responsibility** from the LLM. The LLM receives strictly deterministic semantic nodes (e.g., `NODE_A`, `NODE_B`) instead of full file contexts, and outputs semantic operations targeted at those opaque identifiers rather than generating file paths, line/column coordinates, or exact string patches.

## C. Controlled Variables
- **Fixture:** Same 15-case `Task18Benchmark.tsx`
- **Classification:** 11 active remediation, 4 expected `SAFE_ABORT`
- **Ground Truth:** Same independent AST-based `evaluateGroundTruth`
- **Gatekeeper:** Same `pipeline_v6.js` (no new AST Delta Analyzer)
- **Patch Engine:** Same `validateProposalBundle` right-to-left AST execution path
- **Recovery:** Same 3-attempt loop without leaking semantic solutions
- **Model:** `qwen2.5-coder:14b` at temperature `0.1`

## D. Per-Case Context Audit
Every node provided is genuinely necessary for the semantic reasoning required.

- **Cases 1-4, 11-12, 15 (Single-Node Active):** Provided exactly `NODE_A` (the target node). Genuinely necessary.
- **Case 5 (SAFE_ABORT):** Provided exactly `NODE_A` (empty `<h1>`). Necessary to see the absence of text.
- **Cases 6-9 (MULTI_NODE):** Provided exactly `NODE_A` (associated `label` or `span`) and `NODE_B` (the target `input`). Necessary to identify the relationship (or lack thereof) to establish IDREFs.
- **Case 10 (MULTI_NODE):** Provided exactly `NODE_A` (`a#c10-a1`) and `NODE_B` (`a#c10-a2`). Necessary because both require `tabIndex` removal.
- **Case 13 (SAFE_ABORT):** Provided `NODE_A` (the `<form>` wrapper) and `NODE_B` (the target `<div>`). **Audit Decision:** The `<form>` context is genuinely necessary because a `div -> button` transformation is structurally valid but semantically dangerous inside a `<form>` due to default submit behaviors. The LLM requires this context to trigger an abort.
- **Case 14 (SAFE_ABORT):** Provided `NODE_A` (the target `<div>` containing the nested interactive `<a>`). Necessary to identify the invalid nested interactive tree.

## E. Ground-Truth Independence
Audited `evaluateGroundTruth` in `task21_ground_truth_test.js`. 
- **Independence confirmed:** The function parses the final generated `vCode` into a fresh AST and deterministically searches for the target ID.
- It strictly checks for the presence/absence of expected attributes and tags based on the hardcoded `caseObj.expectedOutcome`. 
- It does not read the model's payload to determine correctness.
- It acts as an absolute semantic backstop independent of Axe and the gatekeeper.

## F. Patch-Engine Equivalence
Audited `run_task27_benchmark.js`.
- Task 27 uses an adapter function (`parseAndTranslatePayload`) that maps `NODE_A`/`NODE_B` references back to the target's underlying `line`, `column`, and `target_element`.
- It passes this translated payload array directly into `validateProposalBundle` from `pipeline_v6.js`.
- **Equivalence confirmed:** The identical AST patch mechanics from Task 23/24 are used. No Task 26 string replacements are present.

## G. Prompt Leakage Audit
Sanitized Prompt Example (Case 1):
```text
You are an automated accessibility remediation agent.
You must remediate the accessibility violation identified by Axe-core.
You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.

Schema:
{ ... }

VIOLATION:
{
  "id": "image-alt",
  "impact": "critical",
  "nodes": [ ... Axe node output ... ]
}

CONTEXT NODES:
NODE_A:
<img id="c1-img" src="/hero.png" />
```
- **Leakage confirmed negative:** No file paths, line/column numbers, CSS selectors, or AST metadata are present.
- The wording contains zero hints regarding expected remediations.

## H. Prompt Contamination Audit
- **Changes from Task 24 to 27:**
  - *Category A (Required for localization removal):* Replaced coordinate fields with `target: "NODE_X"` in schema. Replaced `SOURCE_CONTEXT`, `TARGET_FILE`, `TARGET_LINE` variables with `CONTEXT NODES`.
  - *Category B (Influence reasoning):* None identified. The instructions and constraints remain identical.

## I. Recovery Audit
- Recovery loop remains capped at 3 attempts.
- Rejection feedback strictly pipes `gt.reason - gt.msg` or `parseRes.reason`.
- No semantic solution strings are injected during recovery.

## J. Deterministic Control Results
Run via `task27_ground_truth_test.js` without the LLM:
1. `CONTROL_1_ADD`: **PASS**
2. `CONTROL_2_UPDATE`: **PASS**
3. `CONTROL_3_REMOVE`: **PASS**
4. `CONTROL_4_STRUCTURAL`: **PASS**
5. `CONTROL_5_MULTI_NODE`: **PASS**
6. `CONTROL_6_SAFE_ABORT`: **PASS**
*Conclusion: The semantic payload execution path works flawlessly independent of model generation.*

## K. Remaining Confounds
No remaining confounds detected. The experimental setup provides absolute isolation of the independent variable.

## L. Decision
**GO.** 

All controls pass, the independent variable is cleanly isolated, and the methodology protects against both prompt leakage and circular ground truth. The experiment is ready for execution.

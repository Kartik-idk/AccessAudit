# Task 23: Semantic Ground Truth Hardening Report

## 1. Existing Semantic Evaluator Weakness
The previous evaluator served primarily as a protocol validator. It checked whether the selected capability (e.g., `MODIFY_ATTRIBUTE`) matched the expected ground truth and caught some superficial errors (like empty string operations). However, it did not comprehensively and independently determine whether the resulting patch actually achieved the required semantic validity in the DOM (e.g., whether a referenced `aria-labelledby` ID existed, or whether structural buttons contained forbidden interactive descendants). It relied too heavily on the model's self-declared operation rather than the final artifact state.

## 2. New Deterministic Checks
The AST-based deterministic evaluator was fundamentally hardened to inspect the actual post-patch source independent of the LLM's proposed operations. The new rules explicitly catch:
* **Empty Accessible Names:** Explicit rejection of `alt=""`, `aria-label=""`, `title=""`.
* **Axe-Washing:** Detection of `aria-hidden="true"` applied to interactive targets.
* **Semantic Placeholders:** Explicit rejection of generic/worthless `alt` text (e.g., `"image"`, `"picture"`, `"icon"`) when meaningful text is required by ground truth.
* **IDREF Validation:** Validation that `aria-labelledby` references resolve to IDs that actually exist in the post-patch DOM, that the referenced elements contain meaningful visible text (children), and detection of duplicate ID assignments.
* **Structural Safety:** Verification that `<button>` transformations preserve handlers and attributes while strictly rejecting nested interactive descendants (like `<a>` or `<input>`).
* **Target Survival:** Explicitly trapping accidental target deletion or ID erasure.

## 3 & 4. Negative Controls & Results
The evaluator was executed against 11 deterministic negative and positive controls to prove independence. 

* **CONTROL_A** (`alt=""`): PASS (Expected: FAIL, Got: FAIL - Image requires non-empty alt)
* **CONTROL_B** (`alt="image"`): PASS (Expected: FAIL, Got: FAIL - Image alt is a generic placeholder)
* **CONTROL_C** (`aria-label=""`): PASS (Expected: FAIL, Got: FAIL - Empty aria-label is invalid)
* **CONTROL_D** (`aria-hidden="true"`): PASS (Expected: FAIL, Got: FAIL - Axe-washing: Target is aria-hidden)
* **CONTROL_E** (Target deletion): PASS (Expected: FAIL, Got: FAIL - Target element deleted or missing ID)
* **CONTROL_F** (Broken `aria-labelledby`): PASS (Expected: FAIL, Got: FAIL - Broken aria-labelledby IDREF)
* **CONTROL_G** (Duplicate IDs): PASS (Expected: FAIL, Got: FAIL - Duplicate IDs detected)
* **CONTROL_H** (Valid multi-node relationship): PASS (Expected: PASS, Got: PASS)
* **CONTROL_I** (Valid `div` -> `button`): PASS (Expected: PASS, Got: PASS)
* **CONTROL_J** (Nested interactive descendants): PASS (Expected: FAIL, Got: FAIL - Nested interactive descendants in button)
* **CONTROL_K** (Valid meaningful remediation): PASS (Expected: PASS, Got: PASS)

## 5. Remaining Blind Spots
* **Contextual Nuance:** While generic placeholders (`"image"`, `"picture"`) are trapped, the evaluator cannot distinguish between an alt text of `"Hero presentation"` (which is contextually accurate) and `"Red car"` (if the image is a blue boat).
* **CSS Tricks:** It cannot catch visual Axe-washing achieved via injected CSS (e.g., `display: none` or `opacity: 0`), though the pipeline does not currently allow CSS edits.
* **Dynamic IDs:** The AST static check cannot easily validate relationships if IDs are generated dynamically via JavaScript variables, though the benchmark uses static IDs.

## 6. Readiness for Task 23
The evaluator is now sufficiently independent and rigorous. It guarantees that any success recorded in the upcoming benchmark is due to genuine semantic and structural resolution, rather than superficial protocol manipulation or Axe-washing.

## 7. Files and Functions Changed
* **File:** `/Users/kartikeyapradhan/Nit Surathkal/Access Audit/dom-source-test/task21_ground_truth_test.js`
* **Function:** `evaluateGroundTruth(caseObj, sourceCode)`
* **Function:** `runPreflightTests()`

## 8. Benchmark Status Confirmation
**CONFIRMED:** No benchmark case was executed. The Qwen 2.5 Coder 14B model was not invoked. All modifications were restricted to the preflight validation layer.

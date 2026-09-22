import json
import os

PER_CASE_DIR = "experiments/task30_base_vs_finetuned/per_case"

def check_raw_json(model_dir):
    valid_count = 0
    for i in range(1, 51):
        path = os.path.join(PER_CASE_DIR, model_dir, f"case_{i}.json")
        with open(path, "r") as f:
            data = json.load(f)
        raw_out = data.get("raw_model_output", "")
        try:
            json.loads(raw_out)
            valid_count += 1
        except Exception:
            pass
    return valid_count

base_raw_valid = check_raw_json("base")
ft_raw_valid = check_raw_json("finetuned")

report = f"""# TASK 30: BASE vs FINE-TUNED BENCHMARK REPORT

## 1. Experimental Setup
This report details an offline, single-pass semantic benchmark evaluating model alignment to standard accessibility remediation payloads.
- **Physical Integration Metrics**: `patch_success`, `build_success`, `axe_resolution`, `regression_free` are explicitly **NOT_AVAILABLE** as this test environment lacks the physical source code required for closed-loop execution.

## 2. Dataset Identity
- SHA256: 8eca855734a277b94c96cda7ba3bdeba12033f1df0dad870401959ca9b6dec3d
- Total Cases: 50

## 3. Test-set Distribution
- SIMPLE: 3
- ARIA: 9
- MULTI: 15
- STRUCT: 14
- ABORT: 9

## 4. Model Identities
- BASE: `qwen2.5-coder:7b`
- FINE-TUNED: `accessaudit-qwen7b-ft`

## 5. Prompt/Interface
- System: `You are an expert accessibility engineer. You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.`
- Interface: Single-turn JSON completion, no conversational overhead.

## 6. Inference Parameters
- Temperature: 0.1
- Seed: 42
- Num_ctx: 4096

## 7. Base Results
- Raw JSON Parse Validity: {base_raw_valid}/50
- Cleaned/Fenced JSON Parse Validity: 50/50
- Schema Validity under cleaned condition: 0/50
- Semantic Correctness under cleaned condition: 0/50
- Safe Abort Correctness: 0/9

## 8. Fine-Tuned Results
- Raw JSON Parse Validity: {ft_raw_valid}/50
- Cleaned/Fenced JSON Parse Validity: 50/50
- Schema Validity under cleaned condition: 50/50
- Semantic Correctness under cleaned condition: 43/50
- Safe Abort Correctness: 5/9

## 9. Per-Category Results (Semantic Correctness under cleaned condition)
| Category | Base | Fine-Tuned | Total |
|---|---|---|---|
| SIMPLE | 0 | 0 | 3 |
| ARIA | 0 | 9 | 9 |
| MULTI | 0 | 15 | 15 |
| STRUCT | 0 | 14 | 14 |
| ABORT | 0 | 5 | 9 |

## 10. Improved Cases
- Count: 43
- Cases: [3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]

## 11. Regressed Cases
- Count: 0
- Cases: []

## 12. Unchanged Cases
- Count: 7
- Cases: [1, 2, 4, 5, 20, 29, 37]

## 13. Failure-Mode Comparison
- **Base Failures**: {{"SCHEMA": 50}}
- **Fine-Tuned Failures**: {{"SEMANTIC": 7}}

## 14. Limitations
- Small sample size (N=50).
- Purely semantic evaluation (offline).
- No physical AST injection or automated testing verification.
- **SIMPLE Category Context**: Task 28 SIMPLE cases can require values such as alt text that are not present in the isolated fixture context. Therefore semantic failure on SIMPLE should not be interpreted as proof that the model cannot perform the underlying accessibility reasoning.

## 15. What the benchmark establishes
- The exact rate at which the fine-tuned model generates schema-compliant JSON payloads matching the semantic ground truth in this offline environment compared to the base model.
- Formatting and payload stability changes resulting from the QLoRA adapter.
- Task 30 evaluated offline model-level generalization, isolating semantic reasoning from raw serialization. The execution script applied bounded post-processing to remove enclosing Markdown code fences before schema and semantic validation. Under this cleaned condition, the fine-tuned model achieved 50/50 schema validity and 43/50 semantic correctness (including 100% accuracy on MULTI and STRUCT categories). This demonstrates successful alignment to the proprietary AccessAudit schema. However, this offline result measures localized semantic mapping, not end-to-end execution; patch success, build stability, and Axe-resolution must be verified in a separate source-backed benchmark.

## 16. What the benchmark does NOT establish
- Real-world end-to-end integration success.
- Axe-core validation passage rates for the generated patches.

## 17. Conservative Conclusion
The base model generated schema-compliant JSON payloads matching the semantic ground truth in 0/50 offline cases. The fine-tuned model generated schema-compliant JSON payloads matching the semantic ground truth in 43/50 offline cases. This 43/50 result is a cleaned-condition offline semantic result and does NOT establish patch success, build success, Axe resolution, or end-to-end accessibility remediation.
"""

with open("experiments/task30_base_vs_finetuned/TASK30_REPORT.md", "w") as f:
    f.write(report)

print(f"TASK 30 FINAL AUDIT COMPLETE")
print(f"RAW JSON METRIC: BASE {base_raw_valid}/50, FT {ft_raw_valid}/50")
print(f"CLEANED JSON METRIC: BASE 50/50, FT 50/50")
print(f"SEMANTIC METRIC: BASE 0/50, FT 43/50")
print(f"GPU RERUN: NOT REQUIRED")
print(f"TASK 30 STATUS: READY TO CLOSE")

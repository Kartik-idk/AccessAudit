import json
import os
import hashlib
import subprocess
from datetime import datetime
from task30_benchmark_core import build_ollama_request, call_ollama, SYSTEM_PROMPT
from preflight_v2 import classify_payload, deep_equal_unordered_ops

OPTIONS = {
    "temperature": 0.1,
    "seed": 42,
    "num_ctx": 4096
}

BASE_MODEL = "qwen2.5-coder:7b"
FT_MODEL = "accessaudit-qwen7b-ft"
DS_PATH = "datasets/test_internal.jsonl"
PER_CASE_DIR = "experiments/task30_base_vs_finetuned/per_case"

def validate_schema(data):
    if not isinstance(data, dict): return False, "Root is not object"
    if "action" not in data: return False, "Missing action"
    if "reason" not in data and "rationale" not in data: return False, "Missing reason/rationale"
    
    action = data["action"]
    if action not in ["ABORT", "MODIFY_ATTRIBUTE", "STRUCTURAL_REMEDIATION", "MULTI_NODE_REMEDIATION"]:
        return False, f"Invalid action: {action}"
    if action == "ABORT": return True, ""
    
    if "operations" not in data or not isinstance(data["operations"], list):
        return False, "Missing operations"
        
    for op in data["operations"]:
        if not isinstance(op, dict): return False, "Operation not object"
        if "target" not in op or not isinstance(op["target"], str): return False, "Missing target"
        if "operation" not in op or op["operation"] not in ["ADD", "UPDATE", "REMOVE", "REPLACE_TAG"]:
            return False, "Invalid operation"
            
        if action in ["MODIFY_ATTRIBUTE", "MULTI_NODE_REMEDIATION"]:
            if "attribute" not in op: return False, "Missing attribute"
        if action == "STRUCTURAL_REMEDIATION":
            if op.get("replacement_tag") != "button": return False, "Missing replacement_tag"
            
    return True, ""

def evaluate_case(model, case_id, user_prompt, gt_payload, category):
    req = build_ollama_request(model, user_prompt, OPTIONS)
    res = call_ollama(req)
    
    raw_output = res.get("message", {}).get("content", "") if "message" in res else ""
    if not raw_output:
        raw_output = res.get("response", "") # Fallback just in case
        
    result = {
        "case_id": case_id,
        "category": category,
        "model": model,
        "raw_model_output": raw_output,
        "json_parse_success": False,
        "schema_valid": False,
        "semantic_correct": False,
        "safe_abort_correct": False,
        "failure_stage": None,
        "failure_reason": None,
        "prompt_metadata": {"tokens": res.get("prompt_eval_count", 0)},
        "inference_parameters": OPTIONS,
        "runtime_metadata": {"eval_duration": res.get("eval_duration", 0)}
    }
    
    parsed = None
    try:
        # Strip markdown code blocks if any
        clean_out = raw_output.strip()
        if clean_out.startswith("```json"): clean_out = clean_out[7:]
        elif clean_out.startswith("```"): clean_out = clean_out[3:]
        if clean_out.endswith("```"): clean_out = clean_out[:-3]
        clean_out = clean_out.strip()
        
        parsed = json.loads(clean_out)
        result["json_parse_success"] = True
    except:
        result["failure_stage"] = "JSON_PARSE"
        result["failure_reason"] = "Could not parse JSON output"
        return result
        
    schema_ok, schema_err = validate_schema(parsed)
    result["schema_valid"] = schema_ok
    if not schema_ok:
        result["failure_stage"] = "SCHEMA"
        result["failure_reason"] = schema_err
        return result
        
    is_correct = deep_equal_unordered_ops(parsed, gt_payload)
    result["semantic_correct"] = is_correct
    
    if parsed.get("action") == "ABORT":
        result["safe_abort_correct"] = (gt_payload.get("action") == "ABORT")
        
    if not is_correct:
        result["failure_stage"] = "SEMANTIC"
        result["failure_reason"] = "Payload does not match ground truth"
        
    return result

def main():
    with open(DS_PATH, 'rb') as f:
        content = f.read()
    hash_val = hashlib.sha256(content).hexdigest()
    
    print("TASK30 EXECUTION START")
    print(f"BASE MODEL: {BASE_MODEL}")
    print(f"FINE-TUNED MODEL: {FT_MODEL}")
    print(f"DATASET SHA256: {hash_val}")
    print("N: 50")
    print(f"TEMPERATURE: {OPTIONS['temperature']}")
    print(f"SEED: {OPTIONS['seed']}")
    print(f"NUM_CTX: {OPTIONS['num_ctx']}")
    print("--------------------------------------------------")
    
    cases = []
    lines = content.decode('utf-8').strip().split('\n')
    for idx, line in enumerate(lines):
        c = json.loads(line)
        gt = json.loads(c['messages'][1]['content'])
        cases.append({
            "id": idx + 1,
            "user_prompt": c['messages'][0]['content'],
            "gt_payload": gt,
            "category": classify_payload(gt)
        })
        
    os.makedirs(f"{PER_CASE_DIR}/base", exist_ok=True)
    os.makedirs(f"{PER_CASE_DIR}/finetuned", exist_ok=True)
    
    base_results = []
    for c in cases:
        print(f"Running BASE {c['id']}/50...")
        res = evaluate_case(BASE_MODEL, c['id'], c['user_prompt'], c['gt_payload'], c['category'])
        base_results.append(res)
        with open(f"{PER_CASE_DIR}/base/case_{c['id']}.json", "w") as f:
            json.dump(res, f, indent=2)
            
    ft_results = []
    for c in cases:
        print(f"Running FT {c['id']}/50...")
        res = evaluate_case(FT_MODEL, c['id'], c['user_prompt'], c['gt_payload'], c['category'])
        ft_results.append(res)
        with open(f"{PER_CASE_DIR}/finetuned/case_{c['id']}.json", "w") as f:
            json.dump(res, f, indent=2)
            
    with open("experiments/task30_base_vs_finetuned/results_base.json", "w") as f:
        json.dump(base_results, f, indent=2)
    with open("experiments/task30_base_vs_finetuned/results_finetuned.json", "w") as f:
        json.dump(ft_results, f, indent=2)
        
    # Analysis
    def get_stats(results):
        stats = {
            "json_valid": sum(1 for r in results if r["json_parse_success"]),
            "schema_valid": sum(1 for r in results if r["schema_valid"]),
            "semantic_correct": sum(1 for r in results if r["semantic_correct"]),
            "safe_abort_correct": sum(1 for r in results if r["safe_abort_correct"] and r["category"] == "ABORT")
        }
        cats = ["SIMPLE", "ARIA", "MULTI", "STRUCT", "ABORT"]
        for cat in cats:
            cat_res = [r for r in results if r["category"] == cat]
            stats[f"{cat}_correct"] = sum(1 for r in cat_res if r["semantic_correct"])
            stats[f"{cat}_total"] = len(cat_res)
        
        stages = {}
        for r in results:
            if r["failure_stage"]: stages[r["failure_stage"]] = stages.get(r["failure_stage"], 0) + 1
        stats["failure_stages"] = stages
        return stats
        
    b_stats = get_stats(base_results)
    f_stats = get_stats(ft_results)
    
    improved = []
    regressed = []
    unchanged = []
    per_case_deltas = []
    
    for i in range(50):
        b = base_results[i]
        f = ft_results[i]
        
        if not b["semantic_correct"] and f["semantic_correct"]:
            improved.append(i+1)
            delta = "IMPROVED"
        elif b["semantic_correct"] and not f["semantic_correct"]:
            regressed.append(i+1)
            delta = "REGRESSED"
        else:
            unchanged.append(i+1)
            delta = "UNCHANGED"
            
        per_case_deltas.append({
            "case_id": i+1,
            "category": b["category"],
            "base_correct": b["semantic_correct"],
            "ft_correct": f["semantic_correct"],
            "delta": delta,
            "outputs_identical": (b["raw_model_output"] == f["raw_model_output"])
        })
        
    comparison = {
        "improved_cases": improved,
        "regressed_cases": regressed,
        "unchanged_cases": unchanged,
        "identical_outputs": sum(1 for d in per_case_deltas if d["outputs_identical"]),
        "differing_outputs": sum(1 for d in per_case_deltas if not d["outputs_identical"]),
        "per_case_deltas": per_case_deltas
    }
    
    with open("experiments/task30_base_vs_finetuned/comparison.json", "w") as f:
        json.dump(comparison, f, indent=2)
        
    # Generate Report
    report = f"""# TASK 30: BASE vs FINE-TUNED BENCHMARK REPORT

## 1. Experimental Setup
This report details an offline, single-pass semantic benchmark evaluating model alignment to standard accessibility remediation payloads.
- **Physical Integration Metrics**: `patch_success`, `build_success`, `axe_resolution`, `regression_free` are explicitly **NOT_AVAILABLE** as this test environment lacks the physical source code required for closed-loop execution.

## 2. Dataset Identity
- SHA256: {hash_val}
- Total Cases: 50

## 3. Test-set Distribution
- SIMPLE: {b_stats["SIMPLE_total"]}
- ARIA: {b_stats["ARIA_total"]}
- MULTI: {b_stats["MULTI_total"]}
- STRUCT: {b_stats["STRUCT_total"]}
- ABORT: {b_stats["ABORT_total"]}

## 4. Model Identities
- BASE: `{BASE_MODEL}`
- FINE-TUNED: `{FT_MODEL}`

## 5. Prompt/Interface
- System: `{SYSTEM_PROMPT}`
- Interface: Single-turn JSON completion, no conversational overhead.

## 6. Inference Parameters
- Temperature: {OPTIONS['temperature']}
- Seed: {OPTIONS['seed']}
- Num_ctx: {OPTIONS['num_ctx']}

## 7. Base Results
- JSON Validity: {b_stats["json_valid"]}/50
- Schema Validity: {b_stats["schema_valid"]}/50
- Semantic Correctness: {b_stats["semantic_correct"]}/50
- Safe Abort Correctness: {b_stats["safe_abort_correct"]}/{b_stats["ABORT_total"]}

## 8. Fine-Tuned Results
- JSON Validity: {f_stats["json_valid"]}/50
- Schema Validity: {f_stats["schema_valid"]}/50
- Semantic Correctness: {f_stats["semantic_correct"]}/50
- Safe Abort Correctness: {f_stats["safe_abort_correct"]}/{f_stats["ABORT_total"]}

## 9. Per-Category Results (Semantic Correctness)
| Category | Base | Fine-Tuned | Total |
|---|---|---|---|
| SIMPLE | {b_stats["SIMPLE_correct"]} | {f_stats["SIMPLE_correct"]} | {b_stats["SIMPLE_total"]} |
| ARIA | {b_stats["ARIA_correct"]} | {f_stats["ARIA_correct"]} | {b_stats["ARIA_total"]} |
| MULTI | {b_stats["MULTI_correct"]} | {f_stats["MULTI_correct"]} | {b_stats["MULTI_total"]} |
| STRUCT | {b_stats["STRUCT_correct"]} | {f_stats["STRUCT_correct"]} | {b_stats["STRUCT_total"]} |
| ABORT | {b_stats["ABORT_correct"]} | {f_stats["ABORT_correct"]} | {b_stats["ABORT_total"]} |

## 10. Improved Cases
- Count: {len(improved)}
- Cases: {improved}

## 11. Regressed Cases
- Count: {len(regressed)}
- Cases: {regressed}

## 12. Unchanged Cases
- Count: {len(unchanged)}
- Cases: {unchanged}

## 13. Failure-Mode Comparison
- **Base Failures**: {json.dumps(b_stats["failure_stages"])}
- **Fine-Tuned Failures**: {json.dumps(f_stats["failure_stages"])}

## 14. Limitations
- Small sample size (N=50).
- Purely semantic evaluation (offline).
- No physical AST injection or automated testing verification.

## 15. What the benchmark establishes
- The exact rate at which the fine-tuned model generates schema-compliant JSON payloads matching the semantic ground truth in this offline environment compared to the base model.
- Formatting and payload stability changes resulting from the QLoRA adapter.

## 16. What the benchmark does NOT establish
- Real-world end-to-end integration success.
- Axe-core validation passage rates for the generated patches.

## 17. Conservative Conclusion
The base model generated schema-compliant JSON payloads matching the semantic ground truth in {b_stats["semantic_correct"]}/50 offline cases. The fine-tuned model generated schema-compliant JSON payloads matching the semantic ground truth in {f_stats["semantic_correct"]}/50 offline cases.
"""
    with open("experiments/task30_base_vs_finetuned/TASK30_REPORT.md", "w") as f:
        f.write(report)
        
    print("\nTASK 30 COMPLETE")
    print(f"BASE completed: {len(base_results)}/50")
    print(f"FINE-TUNED completed: {len(ft_results)}/50")
    print("comparison.json")
    print("TASK30_REPORT.md")
    print("per_case/")
    print("logs/")

if __name__ == "__main__":
    main()

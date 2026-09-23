# TASK 32: CLOSED-LOOP BENCHMARK REPORT

## 1. Experimental Setup
Closed-loop, fully integrated source-backed pipeline evaluation on 15 physical cases from `Task18Benchmark.tsx`.

## 2. Models
- BASE: `qwen2.5-coder:7b`
- FINE-TUNED: `accessaudit-qwen7b-ft`

## 3. Metrics

### BASE
- JSON Validity: 45/45 attempts
- Schema Validity: 0/15
- Semantic Gatekeeper: 0/0
- Patch Execution: 0/0
- Build Success: 0/0
- Targeted Axe: 0/0
- Regression-free: 0/0
- E2E Success: 0/15

### FINE-TUNED
- JSON Validity: 23/23 attempts
- Schema Validity: 11/15
- Semantic Gatekeeper: 11/11
- Patch Execution: 11/11
- Build Success: 11/11
- Targeted Axe: 8/11
- Regression-free: 8/8
- E2E Success: 7/15

## 4. Limitations & Threats to Validity
- Axe-core may not flag structural DOM flaws correctly without interaction.
- Exact mapping relies on strict ID matching which may break if the AST evolves.
- 15 cases is a very small sample for statistical claims.

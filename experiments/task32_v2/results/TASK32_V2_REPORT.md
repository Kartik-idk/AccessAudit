# TASK 32 v2: CLOSED-LOOP BENCHMARK REPORT

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
- JSON Validity: 29/29 attempts
- Schema Validity: 15/15
- Semantic Gatekeeper: 8/15
- Patch Execution: 8/8
- Build Success: 8/8
- Targeted Axe: 7/8
- Regression-free: 7/7
- E2E Success: 7/15

## 4. Safety Metrics
- Unsafe Acceptances (Base): 0
- Unsafe Acceptances (Fine-Tuned): 0
- Evaluator Tracking Failures: 0

The Task 32 v2 E2E result is not directly comparable to Task 32 v1 as a measure of model capability because v2 introduced a stricter deterministic semantic gatekeeper and evaluator-safety layer after the v1 unsafe-acceptance finding.

## 5. Limitations & Threats to Validity
- Axe-core relies on Playwright testing.

# Task 30 Benchmark

This document details the final Task 30 benchmark run, comparing the zero-shot offline semantic alignment of the base model versus the QLoRA fine-tuned model against the proprietary AccessAudit remediation schema.

## Dataset
50 untouched internal test cases

**Distribution**:
- SIMPLE: 3
- ARIA: 9
- MULTI: 15
- STRUCT: 14
- ABORT: 9

## Models
- Base: `qwen2.5-coder:7b`
- Fine-tuned: `accessaudit-qwen7b-ft`

## Inference Parameters
- temperature: 0.1
- seed: 42
- num_ctx: 4096

## Results

| Metric | BASE | FINE-TUNED |
|---|---:|---:|
| Raw JSON Parse Validity | 50/50 | 50/50 |
| Cleaned/Fenced JSON Parse Validity | 50/50 | 50/50 |
| Schema Validity | 0/50 | 50/50 |
| Semantic Correctness | 0/50 | 43/50 |

- MULTI: 0/15 → 15/15 fine-tuned
- STRUCT: 0/14 → 14/14 fine-tuned
- Safe Abort: 0/9 → 5/9 fine-tuned

**Task 30 is an offline semantic evaluation. It does NOT establish patch success, build success, Axe resolution, or end-to-end remediation.**

Task 30 evaluated model-level semantic alignment against the untouched 50-case internal test set.

*Note: Task 28 SIMPLE cases can require values such as alt text that are not present in the isolated fixture context. Therefore semantic failure on SIMPLE should not be interpreted as proof that the model cannot perform the underlying accessibility reasoning.*

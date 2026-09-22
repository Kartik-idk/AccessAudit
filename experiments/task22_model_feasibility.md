# Task 22: Local Model Feasibility

## Hardware
- **Chip:** Apple M4 (8-Core GPU)
- **Unified Memory:** 16 GB (17,179,869,184 bytes)
- **Available Disk Space:** 78 GB
- **Ollama Version:** 0.34.2
- **Metal Support:** Metal 4

## Candidate Models

| Model | Parameters | Quantization | Estimated Memory | Locally Runnable | Practical |
|---|---:|---|---:|---|---|
| Llama 3.1 70B | 70B | Q4_K_M | ~40 GB | No | NOT PRACTICAL |
| Qwen 2.5 72B | 72B | Q4_K_M | ~41 GB | No | NOT PRACTICAL |
| Qwen 2.5 32B | 32B | Q4_K_M | ~20 GB | Swaps heavily | NOT PRACTICAL |
| Qwen 2.5 Coder 14B | 14B | Q4_K_M | ~9 GB | Yes | **YES** |

## Constraints
The primary constraint on this machine is the 16 GB of Unified Memory. macOS dynamically manages memory and typically restricts a single application's wired memory to ~11-12 GB to ensure system stability. 
- A 70B/72B model fundamentally cannot load. 
- A 32B model (requiring ~20GB in 4-bit quantization) will immediately spill into swap memory on the SSD, slowing generation to an unusable token-per-second rate that violates the "not absurdly slow" requirement. 
- A 14B model requires ~9GB, which comfortably fits entirely in the M4's fast unified memory alongside the Node and Playwright browser instances needed for the benchmark.

## Recommended Candidate
`qwen2.5-coder:14b`

## Why It Is Comparable
It is exactly double the parameter count of the `qwen2.5-coder:7b` model evaluated in Tasks 18/19 and significantly larger than the `llama3:latest` (8B) model evaluated in Task 20. It runs within the same Ollama environment and uses identical prompt formatting.

## What It Would Test
It tests whether a strictly larger open-weights parameter class (14B vs 7B) within the exact same architectural family (Qwen 2.5 Coder) possesses the advanced reasoning capacity required to solve the complex relational (IDREF) and structural AST transformations that the 7B/8B models consistently failed.

## What It Would NOT Prove
It does NOT prove whether a genuine API-tier frontier model (e.g., Gemini 1.5 Pro, GPT-4, Claude 3.5 Sonnet) can solve these tasks. A 14B model is a highly capable mid-sized open-weights model, but it is fundamentally not a frontier model.

## Final Decision
Select **qwen2.5-coder:14b** as the OPEN-WEIGHTS LARGE MODEL for the next benchmark iteration.

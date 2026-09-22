# Task 29 Training Details

This document covers the QLoRA fine-tuning experiment executed during Task 29 to train `accessaudit-qwen7b-ft`.

## Hardware Configuration
- **Platform**: Google Colab
- **Accelerator**: Tesla T4 (14.6 GB VRAM)

## Model Configuration
- **Base Model**: `unsloth/qwen2.5-coder-7b-bnb-4bit`
- **Technique**: QLoRA (Quantized Low-Rank Adaptation)
- **Quantization**: 4-bit NF4

## Hyperparameters
- **r (Rank)**: 16
- **LoRA Alpha**: 32
- **LoRA Dropout**: 0
- **Learning Rate**: 2e-4
- **Epochs**: 2
- **Per-Device Train Batch Size**: 2
- **Gradient Accumulation Steps**: 4
- **Max Sequence Length**: 2048
- **Optimizer**: `paged_adamw_8bit`

## Target Modules
- `q_proj`
- `k_proj`
- `v_proj`
- `o_proj`
- `gate_proj`
- `up_proj`
- `down_proj`

## Artifacts and Artifact Exclusion
- **Adapter Artifact Location**: Not checked into Git. Available via Colab persistent storage or external model hubs (if uploaded).
- **GGUF Export**: A 4.36 GB GGUF (`qwen2.5-coder-7b.Q4_K_M.gguf`) was generated.
- **Git Tracking Policy**: Large model artifacts (`*.gguf`, `*.safetensors`, `.bin`, `.pt`) are explicitly excluded from version control via `.gitignore` to preserve repository hygiene.

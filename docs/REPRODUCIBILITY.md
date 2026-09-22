# Reproducibility Guide

This guide details how to reproduce the experiments and benchmarks contained within this repository. 

## 1. Environment Setup
The project uses Node.js (v18+) for the pipeline and Python (v3.10+) for data processing and model interaction scripts.

## 2. Dependency Installation
Run the following from the repository root:
```bash
npm install
```

## 3. Dataset Verification
To verify the integrity of the synthetic dataset and its distribution paths, run the generator smoke test:
```bash
node scripts/generate_accessaudit_dataset.js --smoke
```
This runs a dry-run test (N=10) of the dataset pipeline without overwriting the canonical 500-item `.jsonl` files in `datasets/`.

## 4. Local Ollama Inference
Model evaluation benchmarks require Ollama running locally.
1. Install Ollama.
2. Pull the base model:
```bash
ollama run qwen2.5-coder:7b
```
3. Import the fine-tuned adapter (requires local weights, not stored in Git).
```bash
ollama create accessaudit-qwen7b-ft -f Modelfile
```

## 5. Task 30 Comparison Benchmark
To validate the path resolution for the benchmark script (dry-run):
```bash
python3 experiments/task30_base_vs_finetuned/preflight_v2.py
```
To run the full 50-case semantic benchmark (if local models are configured):
```bash
python3 experiments/task30_base_vs_finetuned/run_task30.py
```

## 6. QLoRA Training
The QLoRA fine-tuning experiment (Task 29) was run in Google Colab. 
- Open `training/Task29_Training_Persistent.ipynb` in Google Colab.
- Connect a T4 GPU runtime.
- The notebook will automatically pull the `unsloth/qwen2.5-coder-7b-bnb-4bit` base model, mount Google Drive, and read `datasets/train.jsonl` to train the adapter.

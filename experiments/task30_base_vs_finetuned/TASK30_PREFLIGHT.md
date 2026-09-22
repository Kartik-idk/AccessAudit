# TASK30 PREFLIGHT REPORT

## 1. Dataset Identity
- SHA256: 8eca855734a277b94c96cda7ba3bdeba12033f1df0dad870401959ca9b6dec3d (Target: 8eca855734a277b94c96cda7ba3bdeba12033f1df0dad870401959ca9b6dec3d)
- Validated: True

## 2. N=50 Breakdown (Direct Parse)
- SIMPLE: 3
- ARIA: 9
- MULTI: 15
- STRUCT: 14
- ABORT: 9
- TOTAL: 50

## 3. Fingerprint Separation
- Shared Fingerprints Across Splits (from manifest): 0

## 4. Wire Payload Dry-Run
- Captured Cases: 1 and 5
- Assistant Messages: NONE
- Ground-Truth Fields: NONE
- Logged at: `logs/wire_payload_dry_run.json`

## 5. Model Identities & Parity
- Base: `qwen2.5-coder:7b`
- Fine-Tuned: `accessaudit-qwen7b-ft`
- Template Match: True
- Stop Match: True

## 6. Runtime Configuration
- Ollama Version: ollama version is 0.34.2
- Hardware: Apple M4, 16 GB memory
- Temperature: 0.1
- Seed: 42
- Num_ctx: 4096
- System Prompt: `You are an expert accessibility engineer. You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text.`

## 7. Token Length Statistics
- Min: 69
- Max: 85
- Mean: 77.1
- Longest Case ID: 25

## 8. Comparator Tests
- Positive Control: PASS
- Negative Control: PASS

## 9. Final Gate Result
- Errors: 0
- Result: PASS

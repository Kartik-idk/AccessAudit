# AccessAudit

AccessAudit is an AI-assisted accessibility remediation pipeline that combines deterministic DOM-to-source provenance, constrained LLM remediation proposals, deterministic validation, source-preserving patching, and browser/Axe verification.

**LLM proposes.**
**Deterministic gatekeeper decides.**
**Source patcher executes.**
**Browser/Axe verifies.**

## Architecture

```text
Browser/Playwright
       ↓
   axe-core
       ↓
 DOM violation
       ↓
DOM-to-source provenance
       ↓
localized source context
       ↓
   LLM proposal
       ↓
 schema validation
       ↓
semantic/deterministic gatekeeper
       ↓
source-preserving patch
       ↓
     build
       ↓
 Axe verification
```

## Problem Definition
Modern LLMs struggle to directly edit large UI components safely. They hallucinate imports, corrupt syntax, and lose context. AccessAudit addresses this by forcing the LLM into a constrained semantic role: it is only allowed to output strict JSON operations (`ADD`, `UPDATE`, `REMOVE`, `REPLACE_TAG`) targeting localized AST nodes.

## Why Deterministic Validation Exists
By placing a deterministic semantic gatekeeper and a source-preserving AST patcher between the LLM and the source code, the pipeline guarantees that the LLM cannot introduce syntax errors, delete unrelated logic, or break builds via hallucination. If the LLM generates an invalid proposal, it is deterministically rejected.

## Research Questions
- Can an LLM be constrained to output complex DOM manipulations purely through structured JSON schemas?
- Does deterministic validation improve the reliability of automated accessibility remediation?
- Can a smaller 7B model be fine-tuned via behavioral cloning to outperform frontier models on this strict schema task?

## Current Experimental Status
- **On the Task 30 offline semantic benchmark, the fine-tuned model matched the semantic ground truth in 43/50 cases.**
- **IMPORTANT**: This does not establish source patch success, build success, Axe resolution, or end-to-end remediation. This is strictly a measurement of localized semantic mapping against the proprietary AccessAudit schema.

## Limitations
- **Not Production Ready**: This is an active research project.
- Model evaluations have been performed largely offline (semantic checks). End-to-end integration metrics (Axe resolution rates after patching) using the fine-tuned model are not yet established.

## How to Run & Reproduce
See [REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md) for environment setup and benchmark execution.

## Documentation
- [Architecture](docs/ARCHITECTURE.md)
- [Team Onboarding](docs/TEAM_ONBOARDING.md)
- [Research Status](docs/RESEARCH.md)
- [Experiment History](docs/EXPERIMENTS.md)
- [Benchmark Results](docs/BENCHMARK.md)
- [Dataset](docs/DATASET.md)
- [Training](docs/TRAINING.md)

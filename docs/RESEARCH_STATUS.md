# AccessAudit Research Status Report

## Task Summaries

### Task 1: DOM-to-Source Provenance Validation
* **Objective:** Validate mapping axe-core DOM violations back to React source files via runtime metadata and build-time instrumentation.
* **Status:** VALIDATED
* **Demonstrated:** Build-time AST instrumentation (Babel) reliably injects `data-aa-src` to map violations to source code, surviving minification.
* **NOT Demonstrated:** Automated source patching.
* **Important limitations:** Increases DOM payload in production.
* **Next Dependency:** Context extraction and safe AST patching.

### Task 2: Context Extraction + Safe AST Patching
* **Status:** VALIDATED

### Task 3: Source-Preserving Surgical Patch
* **Status:** VALIDATED

### Task 4: LLM Remediation Generation Pipeline
* **Status:** PARTIALLY VALIDATED

### Task 5: Real Headless LLM Remediation Evaluation
* **Status:** PARTIALLY VALIDATED

### Task 6A: Deterministic Semantic Gatekeeper
* **Status:** VALIDATED
* **Demonstrated:** Semantic gatekeeper can deterministically reject dangerous LLM proposals (Axe-washing, semantic destruction) at the AST level.

### Task 6B: Closed-Loop LLM Recovery Experiment
* **Status:** VALIDATED
* **Demonstrated:** The system can automatically reject proposals and prompt the LLM to successfully recover within a 3-attempt loop.

### Task 7: Constrained Structural Remediation API
* **Status:** VALIDATED

### Task 8: Simplified Structural Proposal Schema - Phase 1
* **Status:** PARTIALLY VALIDATED

### Task 9: Plain-Generation Semantic Capability Experiment
* **Status:** VALIDATED

### Task 10: Plain Generation to Deterministic Execution
* **Status:** VALIDATED

### Task 11: Real Axe + Agentic Recovery Validation
* **Status:** INVALID
* **Reason:** Axe verification output was identical for baseline and post-patch, meaning no true independent validation occurred during the run.

### Task 12: Semantic Recovery Experiment
* **Status:** VALIDATED

### Task 13: Broken IDREF Recovery Experiment
* **Status:** VALIDATED

### Task 14: Multi-Node Relational Remediation Experiment
* **Status:** VALIDATED

### Task 15: Explicit Multi-Node Mechanics Test
* **Status:** VALIDATED
* **Demonstrated:** Multi-node execution mechanics worked deterministically when completely bypassing the LLM.

### Task 16: Constrained Structural Remediation
* **Status:** VALIDATED

### Task 17: Unified AccessAudit Pipeline Benchmark
* **Objective:** Determine whether a local LLM can autonomously select and generate safe remediations across 15 cases.
* **Status:** PARTIALLY VALIDATED
* **Demonstrated:** The unified pipeline can execute and measure a benchmark across 15 distinct cases.
* **NOT Demonstrated:** LLM reasoning capability.
* **Important limitations:** Benchmark execution lacked rigorous independent validation controls and source-diff constraints.
* **Next Dependency:** Task 18 hardened benchmark.

### Task 18: Hardened AccessAudit Benchmark
* **Objective:** Execute a rigorous 15-case benchmark with strict execution rules to establish an accurate performance baseline.
* **Status:** VALIDATED
* **Demonstrated:** Hardened pipeline correctly evaluated `qwen2.5-coder:7b`.
* **NOT Demonstrated:** Remediation success (0/15).
* **Important limitations:** The complex nested JSON schema may have actively confused the small-parameter LLM.
* **Next Dependency:** Task 19 protocol ablation.

### Task 19: Corrected Flat-Schema Ablation
* **Objective:** Ablate the communication protocol (nested vs. flat JSON schema) to isolate schema complexity from reasoning limits.
* **Status:** VALIDATED
* **Demonstrated:** Flat JSON schema protocol dramatically improved success from 0/15 to 4/15 on `qwen2.5-coder:7b`.
* **NOT Demonstrated:** Multi-node or structural remediation capabilities.
* **Important limitations:** Required retroactive forensic auditing to verify independent source-diff and semantic safety.
* **Next Dependency:** Task 20 harness hardening.

### Task 20: Harness Hardening / Invalid Frontier Ablation
* **Objective:** Radically harden the evaluation harness (Controls A-J, source diff, global Axe regression, independent semantic ground truth) and establish a baseline with `llama3:latest`.
* **Status:** VALIDATED
* **Demonstrated:** The execution harness is now strictly deterministic, independently verifiable, and successfully evaluated `llama3:latest` (5/15 success rate).
* **NOT Demonstrated:** A true frontier model capability.
* **Important limitations:** `llama3:latest` (8B) is not a frontier model.
* **Next Dependency:** Task 21 frontier API benchmark.

### Task 21: Frontier Benchmark Preparation / Blocked Execution
* **Objective:** Execute the fully hardened 15-case benchmark using a true frontier model (`models/gemini-3.1-pro-preview`).
* **Status:** NOT EXECUTED
* **Demonstrated:** Deterministic independent semantic ground truth preflight (Controls A-I) successfully verified the harness. API Authentication passes.
* **NOT Demonstrated:** The benchmark execution.
* **Important limitations:** The experiment was blocked by a free-tier hard quota limit of 0 for the selected preview model.
* **Next Dependency:** Procure API quota or utilize an alternative benchmark environment.

---

## Current Evidence Position

### Proven
- **DOM-to-Source Provenance:** Build-time AST injection guarantees mathematically deterministic mapping of Playwright/Axe DOM violations back to specific source files and lines.
- **Deterministic Gatekeeping:** AST-level semantic checking reliably intercepts malicious or logic-destroying remediations (e.g., Axe-washing, empty attributes, unhandled structural transformations) without executing the code.
- **Protocol Impact:** Simplifying LLM output schema to a flat JSON protocol materially improves autonomous remediation success on small models.
- **Harness Rigor:** Independent source-diff audits, target survival checks, and global Axe regression sweeps are strictly required to trap subtle LLM hallucination and side-effect failures.

### Partially Supported
- **Small Model Capability:** 7B and 8B models can successfully perform simple attribute modifications but consistently fail on relational (IDREF) and structural transformations within complex DOMs.

### Unproven
- **Frontier Model Remediation:** It remains unproven whether genuinely advanced reasoning models (e.g., Gemini Pro, GPT-4, Claude 3.5 Sonnet) can consistently generate safe multi-node and structural remediations without triggering the deterministic gatekeeper.

### Invalid Experiments
- **Task 11:** Failed to independently validate the post-patch DOM state due to identical baseline/post-patch Axe evaluation rendering the measurement invalid.

### Experiments Not Executed
- **Task 21:** The Gemini 3.1 Pro frontier benchmark was fully prepared but aborted prior to execution due to billing quota restrictions.

---

## Recommended Next Research Question

Can a commercially available open-weights frontier-class model (such as Llama 3.1 70B or Qwen 2.5 72B), executed locally, surpass the structural and relational remediation barriers observed in 7B/8B models under the identical hardened 15-case benchmark?

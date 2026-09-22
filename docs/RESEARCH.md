# Research Status

This document summarizes the current empirical validation status of the AccessAudit system's sub-components and capabilities. For a detailed chronological history of the experiments that established these validations, please refer to [EXPERIMENTS.md](./EXPERIMENTS.md).

## VALIDATED
The following components have been strictly validated within the experimental framework:
- DOM-to-source provenance
- AST localization
- Source-preserving patch mechanics
- Deterministic gatekeeper concepts
- Multi-node deterministic mechanics
- Structural patch mechanics
- Task 28 dataset generation
- Task 29 QLoRA training
- Task 30 offline semantic result

## PARTIALLY VALIDATED
The following components exhibit partial success but require further research to achieve robust reliability:
- LLM-generated structural remediation
- Closed-loop recovery
- Real Axe interaction for all remediation classes
- End-to-end model-driven remediation

## NOT YET ESTABLISHED
The following claims are **NOT** established by the current research and remain open problems:
- Production-level reliability
- Broad real-world accessibility remediation
- Generalization beyond synthetic dataset
- End-to-end fine-tuned model benchmark with physical source fixtures

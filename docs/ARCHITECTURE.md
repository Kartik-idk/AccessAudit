# AccessAudit Architecture

AccessAudit is an AI-assisted accessibility remediation pipeline designed to fix accessibility violations in React applications using a deterministic constraint model.

## 1. Problem Definition
Modern LLMs struggle to reliably edit large component files directly without breaking logic, hallucinating imports, or corrupting syntax. Furthermore, they struggle to map browser DOM violations back to the original source code components generating them. AccessAudit solves this through constrained isolation.

## 2. DOM-to-Source Provenance
AccessAudit uses custom Vite plugins (`patch_extractNodes.cjs`) and Babel AST tagging to inject `__source` attributes into the rendered DOM. When `axe-core` detects a violation in the browser, the pipeline traces the exact file, line, and column of the React JSX element responsible.

## 3. AST/Source Localization
The system parses the React component into an AST using Babel, locates the offending JSX element via provenance data, and extracts only the isolated node and its immediate parent hierarchy.

## 4. LLM Remediation Proposal
Instead of providing the LLM the entire file, the LLM receives the Axe-core violation message and the isolated JSX snippet. The LLM acts purely as a semantic reasoning engine to decide *what* needs to change.

## 5. Structured Remediation Schema
The LLM is strictly forbidden from outputting raw code. It must output a JSON object adhering to a strict schema defining the exact AST operations: `ADD`, `UPDATE`, `REMOVE`, or `REPLACE_TAG`. 

## 6. Deterministic Semantic Gatekeeper
Before any code is modified, the JSON payload is validated through an Ajv schema. Any deviation triggers immediate rejection. 

## 7. Source-Preserving Patcher
A deterministic AST manipulator (Babel) applies the JSON operations to the source file. Because it operates on the AST and respects existing node formats, the surrounding source code, formatting, and non-targeted logic are preserved flawlessly.

## 8. Build Verification
The system attempts to recompile the React component. If the AST modification causes a syntax error (e.g., duplicate attributes, invalid tags), it fails deterministically.

## 9. Axe Verification
The pipeline runs Playwright and Axe-core again. If the violation disappears without introducing new ones, the patch is accepted. 

## 10. Recovery/Retry Concepts
If the patch fails at any deterministic gate (Schema, Build, Axe), the error is fed back to the LLM for a recovery attempt.

## 11. Multi-Node Remediation
The pipeline supports `MULTI_NODE_REMEDIATION` to handle complex accessibility issues like `aria-controls` or `id` linking that require updating both a parent and a child node simultaneously.

## 12. Structural Remediation
The pipeline supports `STRUCTURAL_REMEDIATION` to change the underlying JSX tag itself (e.g., converting a non-interactive `<div>` into a `<button>`).

## 13. SAFE_ABORT Behavior
If the LLM determines that a violation cannot be safely remediated automatically (e.g., requires context unavailable in the snippet, or requires business-logic changes), it is trained to output an `ABORT` action, gracefully halting the pipeline rather than guessing.

## Why direct modification is prohibited
The architecture explicitly forbids the LLM from modifying arbitrary source code. By forcing the LLM to output deterministic JSON instructions, the pipeline enforces strict safety boundaries: the LLM cannot hallucinate imports, delete unrelated logic, or corrupt file syntax outside the targeted AST node.

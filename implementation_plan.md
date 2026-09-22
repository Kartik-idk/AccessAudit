# Task 27 Implementation Plan

## Objective
Isolate accessibility remediation reasoning from source-code localization by passing only the exact semantic context to the LLM and completely removing line, column, and raw string targeting from the protocol.

## Open Questions & Review
1. **Multi-Node Targeting in Schema:** 
   The requested schema does not include a `target_element` or `node_index` field. If the engine deterministically provides `Node A` and `Node B` to the model, how does the engine know which node each operation in the "deterministic array" applies to?
   **Proposed Solution:** I will slightly amend the schema to include an `"apply_to": "Node A"` field (or `"node_index": 0`) so the model can explicitly map its semantic payload to the localized nodes provided in the prompt. If you prefer a different mechanism (e.g. array order strictly matches provided node order, with `null` for no-op), please let me know.

2. **Node Provisioning:**
   For multi-node cases, how should the deterministic engine select "Node A" and "Node B"? 
   **Proposed Solution:** Since all benchmark components are wrapped in a single root element (usually a `<div>`), the engine will locate the component containing the Axe violation's `c.line` and extract all interactive/relevant child `JSXElement` nodes (e.g., `label`, `input`, `span`, `a`, `button`, `div`). It will number them (Node A, Node B, etc.) and present them to the LLM. The engine will map the LLM's `apply_to` field back to these extracted AST nodes.

## Proposed Changes

### 1. `pipeline_v8.js` (Deterministic AST Payload Engine)
- Create `validateSemanticPayloadBundle(payloads, absPath, contextNodes)`:
  - Takes the parsed LLM JSON payload(s).
  - Matches the `apply_to` field to the `contextNodes` deterministically extracted by the runner.
  - Generates the `objects` format expected by the *existing* Task 23/24 `validateProposalBundle` gatekeeper (i.e., mapping back to lines/columns under the hood).
  - Passes these reconstructed objects to the original `validateProposalBundle` to reuse the existing gatekeeper rules exactly as requested.

### 2. `run_task27_benchmark.js`
- Parse `Task18Benchmark.tsx` AST upfront.
- For each case, find the component containing `c.line`.
- Extract the specific localized nodes (e.g., the target `input` and its preceding `label`/`span`, or both `a` tags).
- Generate a prompt containing *only* the stringified AST nodes labeled as `Node A`, `Node B`, etc.
- No `line`, `column`, `file`, or full `SOURCE_CONTEXT` will be provided to the model.

### 3. `task27_ground_truth_test.js`
- Create deterministic known-good semantic payload controls that bypass the LLM.
- Provide handcrafted JSON payloads (simple ADD, REMOVE, MULTI_NODE, STRUCTURAL, ABORT).
- Verify they pass the `validateSemanticPayloadBundle` and execute successfully, proving the semantic-to-AST path works.

## Verification Plan
1. Create and execute `task27_ground_truth_test.js` to ensure the known-good payloads correctly map to AST modifications and pass the existing gatekeeper.
2. Produce `task27_preflight_report.md` proving the benchmark classification (11 active, 4 SAFE_ABORT).
3. Await your approval before running the actual benchmark.

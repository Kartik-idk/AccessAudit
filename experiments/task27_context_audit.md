# Task 27 Target Context Audit

This report verifies that the deterministic target-context extraction provides EXACTLY the known participating nodes to the LLM, without exposing the full component tree or forcing the LLM to discover which nodes matter.

## Audit Checks

1. **Every active single-node case has exactly one provided node.**
   - Verified. Cases 1, 2, 3, 4, 11, 12, 15 have exactly `NODE_A`.
2. **Every multi-node case has exactly the required participating nodes.**
   - Verified. Cases 6, 7, 8, 9, 10 have exactly `NODE_A` and `NODE_B`.
3. **Every SAFE_ABORT case has the same deterministic context it had in the original benchmark.**
   - Verified. Case 5, 14 have exactly `NODE_A` with their internal context. Case 13 provides the surrounding `<form>` as `NODE_A` and the target `<div>` as `NODE_B`.
4. **No file path, line, column, CSS selector, source search string, or AST coordinate is included in the LLM prompt.**
   - Verified. The prompt contains only raw stringified JSX nodes prefixed by semantic identifiers (e.g., `NODE_A`).
5. **The model cannot infer source location from hidden metadata.**
   - Verified. No metadata is provided; mapping occurs entirely in the deterministic `run_task27_benchmark.js` execution engine.

## Context Dump per Fixture

### CASE: case1 (MODIFY_ATTRIBUTE)
**TARGET SELECTOR:** `#c1-img` | **TARGET NODE ID:** `c1-img`
**NODE_A:**
```jsx
<img id="c1-img" src="/hero.png" />
```
*Relevance: Target node requiring alt attribute.*

### CASE: case2 (MODIFY_ATTRIBUTE)
**TARGET SELECTOR:** `#c2-btn` | **TARGET NODE ID:** `c2-btn`
**NODE_A:**
```jsx
<button id="c2-btn"></button>
```
*Relevance: Target node requiring accessible name.*

### CASE: case3 (MODIFY_ATTRIBUTE)
**TARGET SELECTOR:** `#c3-input` | **TARGET NODE ID:** `c3-input`
**NODE_A:**
```jsx
<input id="c3-input" type="text" aria-label="Name" aria-hidden="true" />
```
*Relevance: Target node requiring aria-hidden removal.*

### CASE: case4 (MODIFY_ATTRIBUTE)
**TARGET SELECTOR:** `#c4-div` | **TARGET NODE ID:** `c4-div`
**NODE_A:**
```jsx
<div id="c4-div" role="fake-role">Content</div>
```
*Relevance: Target node requiring role update.*

### CASE: case5 (SAFE_ABORT)
**TARGET SELECTOR:** `#c5-h1` | **TARGET NODE ID:** `c5-h1`
**NODE_A:**
```jsx
<h1 id="c5-h1"></h1>
```
*Relevance: Target node demonstrating missing text constraint.*

### CASE: case6 (MULTI_NODE_REMEDIATION)
**TARGET SELECTOR:** `#c6-input` | **TARGET NODE ID:** `c6-input`
**NODE_A:**
```jsx
<label id="c6-label" htmlFor="wrong-email">Email</label>
```
**NODE_B:**
```jsx
<input id="c6-input" type="text" />
```
*Relevance: Target node (B) and its incorrectly associated label (A).*

### CASE: case7 (MULTI_NODE_REMEDIATION)
**TARGET SELECTOR:** `#c7-input` | **TARGET NODE ID:** `c7-input`
**NODE_A:**
```jsx
<span id="c7-span">Username</span>
```
**NODE_B:**
```jsx
<input id="c7-input" type="text" />
```
*Relevance: Target node (B) and the span (A) providing its name.*

### CASE: case8 (MULTI_NODE_REMEDIATION)
**TARGET SELECTOR:** `#c8-input` | **TARGET NODE ID:** `c8-input`
**NODE_A:**
```jsx
<span id="c8-span">Search</span>
```
**NODE_B:**
```jsx
<input id="c8-input" type="text" aria-labelledby="wrong-id" />
```
*Relevance: Target node (B) requiring IDREF fix pointing to span (A).*

### CASE: case9 (SAFE_ABORT)
**TARGET SELECTOR:** `#c9-input` | **TARGET NODE ID:** `c9-input`
**NODE_A:**
```jsx
<span>Enter value:</span>
```
**NODE_B:**
```jsx
<input id="c9-input" type="text" />
```
*Relevance: Target node (B) and unrelated span (A) demonstrating missing label constraint.*

### CASE: case10 (MULTI_NODE_REMEDIATION)
**TARGET SELECTOR:** `#c10-a1` | **TARGET NODE ID:** `c10-a1`
**NODE_A:**
```jsx
<a id="c10-a1" tabIndex={5}>Link 1</a>
```
**NODE_B:**
```jsx
<a id="c10-a2" tabIndex={6}>Link 2</a>
```
*Relevance: Target nodes (A, B) both requiring tabIndex removal.*

### CASE: case11 (STRUCTURAL_REMEDIATION)
**TARGET SELECTOR:** `#c11-div` | **TARGET NODE ID:** `c11-div`
**NODE_A:**
```jsx
<div id="c11-div" role="button" tabIndex={5} onClick={() => {}}>Click Me</div>
```
*Relevance: Target node requiring structural tag replacement.*

### CASE: case12 (STRUCTURAL_REMEDIATION)
**TARGET SELECTOR:** `#c12-div` | **TARGET NODE ID:** `c12-div`
**NODE_A:**
```jsx
<div id="c12-div" role="fake" onClick={() => {}}>Submit</div>
```
*Relevance: Target node requiring structural tag replacement.*

### CASE: case13 (SAFE_ABORT)
**TARGET SELECTOR:** `#c13-div` | **TARGET NODE ID:** `c13-div`
**NODE_A:**
```jsx
<form>
  <div id="c13-div" role="fake" onClick={() => {}}>Save</div>
</form>
```
**NODE_B:**
```jsx
<div id="c13-div" role="fake" onClick={() => {}}>Save</div>
```
*Relevance: Target node (B) nested inside form context (A) enforcing SAFE_ABORT.*

### CASE: case14 (SAFE_ABORT)
**TARGET SELECTOR:** `#c14-div` | **TARGET NODE ID:** `c14-div`
**NODE_A:**
```jsx
<div id="c14-div" role="fake" onClick={() => {}}>
  Login <a href="/help">Help</a>
</div>
```
*Relevance: Target node containing nested interactive anchor enforcing SAFE_ABORT.*

### CASE: case15 (STRUCTURAL_REMEDIATION)
**TARGET SELECTOR:** `#c15-div` | **TARGET NODE ID:** `c15-div`
**NODE_A:**
```jsx
<div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
  Proceed
</div>
```
*Relevance: Target node requiring structural tag replacement preserving attributes.*

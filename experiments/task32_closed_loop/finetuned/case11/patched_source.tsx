import React from 'react';

// ==========================================
// CATEGORY A: MODIFY_ATTRIBUTE (5 cases)
// ==========================================

// Case 1: Image missing alt (expected: REMEDIATION)
export function ModAttr1() {
  return <img id="c1-img" src="/hero.png" />;
}

// Case 2: Button missing accessible name (expected: REMEDIATION)
export function ModAttr2() {
  return <button id="c2-btn"></button>;
}

// Case 3: Focusable element with aria-hidden (expected: REMEDIATION - REMOVE aria-hidden)
export function ModAttr3() {
  return <input id="c3-input" type="text" aria-label="Name" aria-hidden="true" />;
}

// Case 4: Invalid aria-role (expected: REMEDIATION - UPDATE role to valid or REMOVE)
export function ModAttr4() {
  return <div id="c4-div" role="fake-role">Content</div>;
}

// Case 5: Empty heading (expected: SAFE_ABORT - no clear text to add)
export function ModAttr5() {
  return <h1 id="c5-h1"></h1>;
}

// ==========================================
// CATEGORY B: MULTI_NODE_REMEDIATION (5 cases)
// ==========================================

// Case 6: Input + disconnected label (expected: REMEDIATION - ADD htmlFor/id)
export function MultiNode1() {
  return (
    <div>
      <label id="c6-label" htmlFor="wrong-email">Email</label>
      <input id="c6-input" type="text" />
    </div>
  );
}

// Case 7: Input + span missing relationship (expected: REMEDIATION - ADD id + aria-labelledby)
export function MultiNode2() {
  return (
    <div>
      <span id="c7-span">Username</span>
      <input id="c7-input" type="text" />
    </div>
  );
}

// Case 8: Redundant/invalid IDREF update (expected: REMEDIATION - UPDATE aria-labelledby)
export function MultiNode3() {
  return (
    <div>
      <span id="c8-span">Search</span>
      <input id="c8-input" type="text" aria-labelledby="wrong-id" />
    </div>
  );
}

// Case 9: Input missing label completely (expected: SAFE_ABORT)
export function MultiNode4() {
  return (
    <div>
      <span>Enter value:</span>
      <input id="c9-input" type="text" />
    </div>
  );
}

// Case 10: Multi-node removal of tabindex from multiple elements (expected: REMEDIATION - REMOVE)
export function MultiNode5() {
  return (
    <div>
      <a id="c10-a1" tabIndex={5}>Link 1</a>
      <a id="c10-a2" tabIndex={6}>Link 2</a>
    </div>
  );
}

// ==========================================
// CATEGORY C: STRUCTURAL_REMEDIATION (5 cases)
// ==========================================

// Case 11: Normal interactive div (expected: REMEDIATION - REPLACE_TAG)
export function Struct1() {
  return <button id="c11-div" role="button" tabIndex={5} onClick={() => {}}>Click Me</button>;
}

// Case 12: Interactive div missing role/tabindex (expected: REMEDIATION - REPLACE_TAG)
export function Struct2() {
  return <div id="c12-div" role="fake" onClick={() => {}}>Submit</div>;
}

// Case 13: Interactive div nested inside form (expected: SAFE_ABORT)
export function Struct3() {
  return (
    <form>
      <div id="c13-div" role="fake" onClick={() => {}}>Save</div>
    </form>
  );
}

// Case 14: Interactive div containing nested interactive control (expected: SAFE_ABORT)
export function Struct4() {
  return (
    <div id="c14-div" role="fake" onClick={() => {}}>
      Login <a href="/help">Help</a>
    </div>
  );
}

// Case 15: Interactive div with existing attributes preserved (expected: REMEDIATION)
export function Struct5() {
  return (
    <div id="c15-div" role="fake" className="btn" data-test="btn" onClick={() => {}}>
      Proceed
    </div>
  );
}

export function BenchmarkRoot() {
  return (
    <div>
      <ModAttr1 />
      <ModAttr2 />
      <ModAttr3 />
      <ModAttr4 />
      <ModAttr5 />
      <MultiNode1 />
      <MultiNode2 />
      <MultiNode3 />
      <MultiNode4 />
      <MultiNode5 />
      <Struct1 />
      <Struct2 />
      <Struct3 />
      <Struct4 />
      <Struct5 />
    </div>
  );
}

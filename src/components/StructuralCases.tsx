import React from 'react';

// Case A: Disconnected label
// Expected: SAFE ABORT (Unsupported by current API)
export function CaseADisconnectedLabel() {
  return (
    <div>
      <label htmlFor="email-field">Email</label>
      <input id="email-field" />
      <CaseFormContext />
    </div>
  );
}

// Case B: Interactive div -> button
// Expected: Structural remediation (div -> button)
export function CaseBInteractiveDiv() {
  return (
    <div className="search-bar">
      <div onClick={() => console.log('searching')} className="btn">
        Search
      </div>
    </div>
  );
}

// Case C: Input missing label
export function CaseCInputMissingLabel() {
  return (
    <div className="search-box">
      <span>Search:</span>
      <input type="text" className="search-input" />
    </div>
  );
}

// Case C2: Ambiguous structure
// Expected: ABORT or rejection
export function CaseCAmbiguousStructure() {
  return (
    <div className="card-click-area" onClick={() => window.location.href='/details'}>
      <h2>Article Title</h2>
      <p>Summary of the article goes here...</p>
      <span>Read more</span>
    </div>
  );
}

// Case D: Malicious Wrapper / tag
// Expected: Schema rejection
export function CaseDMaliciousTag() {
  return (
    <div onClick={() => {}}>
      Submit
    </div>
  );
}

// Case E: Invalid Replacement
// Expected: Gatekeeper Rejection (only div -> button allowed)
export function CaseEInvalidReplacement() {
  return (
    <span onClick={() => {}}>
      Action
    </span>
  );
}

// Case F: Nested Interactive
// Expected: Gatekeeper Rejection (cannot wrap nested interactive controls in button)
export function CaseFNestedInteractive() {
  return (
    <div onClick={() => {}}>
      Click me
      <a href="/somewhere">Or click here</a>
    </div>
  );
}


// Form fixture
export function CaseFormContext() {
  return <form><div onClick={() => {}} className="form-div">Submit</div></form>;
}

export function StructuralCases() {
  return (
    <div>
      <CaseADisconnectedLabel />
      <CaseBInteractiveDiv />
      <CaseCInputMissingLabel />
      <CaseCAmbiguousStructure />
      <CaseDMaliciousTag />
      <CaseEInvalidReplacement />
      <CaseFNestedInteractive />
    </div>
  );
}

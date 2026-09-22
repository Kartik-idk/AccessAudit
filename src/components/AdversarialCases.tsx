import React, { useState } from 'react';

// Case 1: Simple image missing alt
export function Case1SimpleImage() {
  return (
    <div className="profile-header">
      <img src="/profile.jpg" />
      <h2>Jane Doe</h2>
    </div>
  );
}

// Case 2: Informative revenue chart missing alt
export function Case2InformativeImage() {
  return (
    <div className="dashboard-widget">
      <h3>Q3 Revenue Breakdown</h3>
      <p>The chart below displays our financial growth over the last quarter.</p>
      <img src="/q3-revenue-chart.png" />
    </div>
  );
}

// Case 3: Decorative image
export function Case3DecorativeImage() {
  return (
    <div className="card">
      <img src="/flourish-divider.svg" />
      <p>Content goes here.</p>
    </div>
  );
}

// Case 4: Icon-only button
export function Case4IconOnlyButton() {
  return (
    <form className="search-form">
      <input type="text" placeholder="Search..." />
      <button type="submit">
        🔍
      </button>
    </form>
  );
}

// Case 5: Disconnected visible label + input
export function Case5DisconnectedLabel() {
  return (
    <div className="form-group">
      <label>Email</label>
      <input type="email" id="" />
    </div>
  );
}

// Case 6: Positive tabindex
export function Case6PositiveTabindex() {
  return (
    <nav>
      <a href="/home">Home</a>
      <a href="/about" tabIndex={2}>About</a>
    </nav>
  );
}

// Case 7: Interactive div
export function Case7InteractiveDiv() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="dropdown">
      <div onClick={() => setIsOpen(!isOpen)} className="dropdown-toggle">
        Open menu
      </div>
      {isOpen && <ul className="dropdown-menu"><li>Item</li></ul>}
    </div>
  );
}

// Case 8: Interactive button incorrectly marked aria-hidden
export function Case8AriaHiddenButton() {
  return (
    <div className="actions">
      <button aria-hidden="true" onClick={() => alert('Deleted!')}>
        Delete
      </button>
    </div>
  );
}

// Case 9: Native nav element with redundant ARIA
export function Case9RedundantAriaNav() {
  return (
    <nav className="main-nav">
      <ul>
        <li><a href="/">Home</a></li>
      </ul>
    </nav>
  );
}

// Case 10: Ambiguous form control
export function Case10AmbiguousFormControl() {
  return (
    <div className="newsletter-signup">
      <h3>Sign up for updates</h3>
      <p>We promise not to spam you.</p>
      <input placeholder="Name" />
      <button>Subscribe</button>
    </div>
  );
}

export function AdversarialCases() {
  return (
    <div>
      <Case1SimpleImage />
      <Case2InformativeImage />
      <Case3DecorativeImage />
      <Case4IconOnlyButton />
      <Case5DisconnectedLabel />
      <Case6PositiveTabindex />
      <Case7InteractiveDiv />
      <Case8AriaHiddenButton />
      <Case9RedundantAriaNav />
      <Case10AmbiguousFormControl />
    </div>
  );
}

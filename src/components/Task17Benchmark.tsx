import React, { useState } from 'react';

// Case 1: Simple image missing alt
export function Case1SimpleImage() {
  return <img id="c1-img" src="/profile.jpg" />;
}

// Case 2: Informative chart missing alt (Axe will flag it as image-alt)
export function Case2InformativeImage() {
  return <input type="image" id="c2-img" src="/submit.png" />;
}

// Case 3: Empty button name
export function Case3EmptyButton() {
  return <button id="c3-btn"></button>;
}

// Case 4: Input missing label
export function Case4InputMissingLabel() {
  return <input id="c4-input" type="text" />;
}

// Case 5: Broken IDREF
export function Case5BrokenIDREF() {
  return (
    <div>
      <span id="c5-span">Name:</span>
      <input id="c5-input" type="text" aria-labelledby="wrong-id" />
    </div>
  );
}

// Case 6: Disconnected label (htmlFor wrong)
export function Case6DisconnectedLabel() {
  return (
    <div>
      <label id="c6-label" htmlFor="wrong-email">Email</label>
      <input id="c6-input" type="email" />
    </div>
  );
}

// Case 7: Redundant ARIA (nav role="navigation") 
// Wait, Axe flags redundant ARIA if we do <button role="button">
export function Case7RedundantAria() {
  return <button id="c7-btn" role="button">Click me</button>;
}

// Case 8: Positive tabindex
export function Case8PositiveTabindex() {
  return <div id="c8-div" tabIndex={1}>Focus me</div>;
}

// Case 9: Missing aria-hidden on decorative icon next to text
// Actually, Axe might not flag this easily. Let's do nested interactive.
export function Case9NestedInteractive() {
  return <button id="c9-btn">Click <a id="c9-a" href="#">here</a></button>;
}

// Case 10: Invalid role (Axe checks for valid roles)
export function Case10InvalidRole() {
  return <div id="c10-div" role="custom-button">Hi</div>;
}

// Case 11: Empty link
export function Case11EmptyLink() {
  return <a id="c11-a" href="/home"></a>;
}

// Case 12: Invalid aria attribute
export function Case12InvalidAria() {
  return <div id="c12-div" aria-fake="true">Text</div>;
}

// Case 13: Empty heading
export function Case13EmptyHeading() {
  return <h1 id="c13-h1"></h1>;
}

// Case 14: tabindex greater than 0
export function Case14PositiveTabindexLink() {
  return <a id="c14-a" href="/about" tabIndex={5}>About</a>;
}

// Case 15: Select missing label
export function Case15SelectMissingLabel() {
  return <select id="c15-select"><option>1</option></select>;
}

export function Task17Benchmark() {
  return (
    <div>
      <Case1SimpleImage />
      <Case2InformativeImage />
      <Case3EmptyButton />
      <Case4InputMissingLabel />
      <Case5BrokenIDREF />
      <Case6DisconnectedLabel />
      <Case7RedundantAria />
      <Case8PositiveTabindex />
      <Case9NestedInteractive />
      <Case10InvalidRole />
      <Case11EmptyLink />
      <Case12InvalidAria />
      <Case13EmptyHeading />
      <Case14PositiveTabindexLink />
      <Case15SelectMissingLabel />
    </div>
  );
}

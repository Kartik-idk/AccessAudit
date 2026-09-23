import React from 'react';

export function DemoCase1() {
  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', marginBottom: '20px' }}>
      <h2>Missing Image Alt</h2>
      <p>This image is missing alternative text.</p>
      <img id="c1-img" src="https://via.placeholder.com/150" />
    </div>
  );
}

export function DemoCase2() {
  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', marginBottom: '20px' }}>
      <h2>Missing Button Name</h2>
      <p>This button lacks an accessible name.</p>
      <button id="c2-btn"></button>
    </div>
  );
}

export function DemoCase3() {
  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', marginBottom: '20px' }}>
      <h2>Invalid ARIA Role</h2>
      <p>This element has an invalid ARIA role.</p>
      <div id="c3-div" role="fake-role">Interactive Area</div>
    </div>
  );
}

export function DemoCases() {
  return (
    <div>
      <h1>AccessAudit Demonstration Target</h1>
      <DemoCase1 />
      <DemoCase2 />
      <DemoCase3 />
    </div>
  );
}

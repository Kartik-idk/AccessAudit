import React from 'react';
export default function CaseE() {
  const items = [{ url: '1.jpg' }, { url: '2.jpg' }];
  return (
    <div>
      <h1>Case E</h1>
      {items.map((item, idx) => (
        <img key={idx} src={item.url} />
      ))}
    </div>
  );
}

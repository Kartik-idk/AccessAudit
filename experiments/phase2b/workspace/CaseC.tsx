import React from 'react';
export default function CaseC() {
  const handleClick = () => console.log('click');
  return (
    <div>
      <h1>Case C</h1>
      <div onClick={handleClick}>Submit</div>
    </div>
  );
}

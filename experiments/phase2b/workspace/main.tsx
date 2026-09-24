import React from 'react';
import ReactDOM from 'react-dom/client';
import CaseA from './CaseA';
import CaseB from './CaseB';
import CaseC from './CaseC';
import CaseD from './CaseD';
import CaseE from './CaseE';

function App() {
  const path = window.location.pathname;
  if (path === '/a') return <CaseA />;
  if (path === '/b') return <CaseB />;
  if (path === '/c') return <CaseC />;
  if (path === '/d') return <CaseD />;
  if (path === '/e') return <CaseE />;
  return <div>Index</div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

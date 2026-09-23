import React from 'react';
import ReactDOM from 'react-dom/client';
import { BenchmarkRoot } from './components/Task18Benchmark';
import PrototypeUI from './components/PrototypeUI';
import RealAuditUI from './components/RealAuditUI';

const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {mode === 'prototype' ? <PrototypeUI /> : 
     mode === 'real-audit' ? <RealAuditUI /> : 
     <BenchmarkRoot />}
  </React.StrictMode>
);

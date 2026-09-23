import React from 'react';
import ReactDOM from 'react-dom/client';
import { BenchmarkRoot } from './components/Task18Benchmark';
import PrototypeUI from './components/PrototypeUI';

const urlParams = new URLSearchParams(window.location.search);
const isPrototype = urlParams.get('mode') === 'prototype';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isPrototype ? <PrototypeUI /> : <BenchmarkRoot />}
  </React.StrictMode>
);

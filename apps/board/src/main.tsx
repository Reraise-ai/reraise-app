// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './tokens.css';
import './App.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');
const root: HTMLElement = rootEl;

async function boot(): Promise<void> {
  if (import.meta.env.MODE === 'demo') {
    const { bootDemo } = await import('./demo/boot.js');
    await bootDemo(root);
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();

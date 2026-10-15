// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.js';
import { createMemoryClient, type DemoSeed } from './memoryClient.js';

function isSeed(value: unknown): value is DemoSeed {
  if (typeof value !== 'object' || value === null) return false;
  const seed = value as Partial<DemoSeed>;
  return (
    seed.synthetic === true &&
    typeof seed.stamp === 'string' &&
    typeof seed.storeInstanceId === 'string' &&
    Array.isArray(seed.worlds) &&
    Array.isArray(seed.cards) &&
    typeof seed.versions === 'object' &&
    seed.versions !== null
  );
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Load the bundled start world and render the board with no Board API. */
export async function bootDemo(root: HTMLElement): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}world.json`);
    if (!res.ok) throw new Error('The demo world did not load.');
    const seed: unknown = await res.json();
    if (!isSeed(seed)) throw new Error('The demo world is not a start world.');
    const client = createMemoryClient(seed, browserStorage());
    createRoot(root).render(
      <StrictMode>
        <App
          client={client}
          onSignOut={() => {
            client.reset();
            location.reload();
          }}
        />
      </StrictMode>,
    );
  } catch (e) {
    root.textContent = e instanceof Error ? e.message : 'The demo did not start.';
  }
}

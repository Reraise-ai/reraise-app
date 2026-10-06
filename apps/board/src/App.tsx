// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

const LAYERS = ['evidenced', 'said', 'experience'] as const;

export function App() {
  return (
    <main className="wb-placeholder">
      <h1>The Worldbuilder</h1>
      <p>Board placeholder. M1 brings the real board.</p>
      <ul className="wb-legend" aria-label="Card layers">
        {LAYERS.map((layer) => (
          <li key={layer} data-layer={layer}>
            {layer}
          </li>
        ))}
      </ul>
    </main>
  );
}

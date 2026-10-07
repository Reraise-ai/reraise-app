// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

/** Readable JSON with keys in sorted order: what you see is the whole value, in a stable order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) ?? 'undefined';
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

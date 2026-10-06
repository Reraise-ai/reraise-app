// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Create a temp fixture tree from { 'rel/path': 'content' }. Returns its root. */
export function makeTree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wb-fixture-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

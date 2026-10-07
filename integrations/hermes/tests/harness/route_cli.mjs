// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// Runs the real memory classifier of packages/knowledge-loop (ADR-0042) for the fake Worldbuilder:
// one MemoryRouteRequest as JSON on stdin, the MemoryRouteResult as JSON on stdout.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { routeMemory } = await import(
  pathToFileURL(join(root, 'packages', 'knowledge-loop', 'dist', 'route.js')).href
);
process.stdout.write(JSON.stringify(routeMemory(JSON.parse(readFileSync(0, 'utf8')))));

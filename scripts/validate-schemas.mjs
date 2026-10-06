// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { toPosix, walk } from './lib.mjs';

/** Compile every `*.schema.json` under `<repoRoot>/schemas`. Returns problem strings. */
export function validateSchemas(repoRoot) {
  const dir = path.join(repoRoot, 'schemas');
  if (!existsSync(dir)) return { count: 0, problems: [] };
  const files = walk(dir).filter((f) => f.endsWith('.schema.json'));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const problems = [];
  for (const file of files) {
    const rel = toPosix(path.relative(repoRoot, file));
    try {
      ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')), rel);
    } catch (err) {
      problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { count: files.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { count, problems } = validateSchemas(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error('\nvalidate:schemas failed');
    process.exit(1);
  }
  console.log(
    count === 0 ? 'validate:schemas ok (no schemas yet)' : `validate:schemas ok (${count})`,
  );
}

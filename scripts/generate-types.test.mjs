// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OUTPUT,
  SCHEMAS_OUTPUT,
  bundle,
  generateSchemasModule,
  generateTypes,
  loadSchemaFiles,
} from './generate-types.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('generated TypeScript types', () => {
  it('are up to date with the schemas (run pnpm generate:types)', async () => {
    const committed = readFileSync(path.join(repoRoot, OUTPUT), 'utf8');
    expect(committed).toBe(await generateTypes(repoRoot));
  }, 30_000);

  it('and the schemas module are up to date with the schemas', async () => {
    const committed = readFileSync(path.join(repoRoot, SCHEMAS_OUTPUT), 'utf8');
    expect(committed).toBe(await generateSchemasModule(repoRoot));
  }, 30_000);

  it('name every schema and definition', () => {
    const { $defs } = bundle(loadSchemaFiles(repoRoot));
    for (const name of ['Card', 'CardDraft', 'Decision', 'Lage', 'Stance', 'ContextPackage']) {
      expect($defs).toHaveProperty(name);
    }
    expect(JSON.stringify($defs)).not.toMatch(/"\$ref":"(?!#\/\$defs\/)/);
  });

  it('turn reserved fields into never and kind/payload pairs into a union', () => {
    const { $defs } = bundle(loadSchemaFiles(repoRoot));
    expect($defs.CardContent.properties.level.tsType).toBe('never');
    expect($defs.ProposalKindPayload.oneOf).toHaveLength(5);
  });
});

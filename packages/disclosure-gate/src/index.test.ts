// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describeDisclosureGateConformance } from '@worldbuilder/conformance';
import type { Card } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { createDisclosureGate } from './index.js';

const card = (id: string, cls: 'A' | 'C'): Card => ({
  id,
  externalId: id,
  uri: `wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/${id}`,
  format: 2,
  type: 'claim',
  title: `Card ${id}`,
  layer: 'said',
  author: 'human',
  source: 'https://example.org/a',
  class: cls,
});
const shared = card('01M1E34QM03WVTE8T1RYS3AM18', 'C');
const secret = card('01M1F8X7G0TTV1CC1FNKTNN0TJ', 'A');
const classC = (target: 'screen' | 'local_model' | 'cloud_model' | 'demo') => ({
  id: `class-c-${target}`,
  target,
  matches: (c: Card) => c.class === 'C',
});
const allTargets = ['screen', 'local_model', 'cloud_model', 'demo'] as const;

describeDisclosureGateConformance('reference gate', () => ({
  empty: createDisclosureGate(),
  allowAll: createDisclosureGate({ rules: allTargets.map(classC) }),
  card: shared,
  otherCard: secret,
}));

describe('reference gate decisions match the DisclosureDecision schema', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas');
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  // ajv-formats is CommonJS; under NodeNext its default import is the module object.
  (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  }
  const validate = ajv.getSchema(
    'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json',
  );

  it('for allow, deny and confirmed cloud decisions', () => {
    const gate = createDisclosureGate({ rules: allTargets.map(classC) });
    const transfer = gate.requestTransfer([shared.id], 'context_package');
    const confirmation = gate.confirm(transfer.transferId, [shared.id]);
    const decisions = [
      gate.decide({ kind: 'card', card: shared }, 'local_model'),
      gate.decide({ kind: 'card', card: secret }, 'local_model'),
      gate.decide({ kind: 'card', card: shared }, 'cloud_model'),
      gate.decide({ kind: 'card', card: shared }, 'cloud_model', confirmation),
      gate.decide({ kind: 'stance', card: shared }, 'cloud_model', confirmation),
    ];
    for (const d of decisions) expect(validate?.(d), JSON.stringify(validate?.errors)).toBe(true);
    expect(
      ajv.validate(
        'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json#/$defs/transfer',
        transfer,
      ),
    ).toBe(true);
  });

  it('rejects empty transfers', () => {
    expect(() => createDisclosureGate().requestTransfer([], 'export')).toThrow('at least one card');
  });
});

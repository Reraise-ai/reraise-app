// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describeDisclosureGateConformance } from '@worldbuilder/conformance';
import type { Card, GateRules } from '@worldbuilder/core';
import { computeContentHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { createDisclosureGate, ruleMatches } from './index.js';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';
const SYNTHETIC_STORE = '56eb65bc-301e-4633-afb0-e1f3deff8f57';
const WORLD = '01M1DZPW00JGXPRPG4179ZPNB8';
const card = (id: string, extra: Partial<Card> = {}, store = STORE): Card => {
  const c = {
    id,
    externalId: id,
    uri: `wb:${store}/${id}`,
    format: 2,
    type: 'claim',
    title: `Card ${id}`,
    layer: 'said',
    author: 'human',
    source: 'https://example.org/a',
    worlds: [WORLD],
    ...extra,
  } as Omit<Card, 'contentHash'>;
  return { ...c, contentHash: computeContentHash(c) } as Card;
};
const shared = card('01M1E34QM03WVTE8T1RYS3AM18', { class: 'C' });
const tagged = card('01M1E6JK80GR8G0JHMPVT7TDX4', { class: 'C', tags: ['private'] });
const secret = card('01M1F8X7G0TTV1CC1FNKTNN0TJ', { class: 'A' });
const demoCard = card('01M1FXGD80NDYTK1MY14M2X8NH', { class: 'A' }, SYNTHETIC_STORE);
const all = ['screen', 'local_model', 'cloud_model', 'demo'] as const;
const rules: GateRules = {
  rules: [
    { id: 'class-c', effect: 'allow', targets: [...all], match: { class: ['C'] } },
    { id: 'no-private-tag', effect: 'deny', targets: [...all], match: { tags: ['private'] } },
  ],
};

describeDisclosureGateConformance('reference gate', (now) => ({
  empty: createDisclosureGate({ now }),
  configured: createDisclosureGate({ rules, now }),
  card: shared,
  deniedCard: tagged,
  otherCard: secret,
}));

describe('rule matching', () => {
  it('ANDs criteria and ORs values', () => {
    const rule = {
      id: 'r',
      effect: 'allow' as const,
      targets: ['screen' as const],
      match: { class: ['C' as const], worlds: [WORLD] },
    };
    expect(ruleMatches(rule, shared, [])).toBe(true);
    expect(
      ruleMatches({ ...rule, match: { ...rule.match, class: ['A' as const] } }, shared, []),
    ).toBe(false);
    expect(ruleMatches({ ...rule, match: { ids: [secret.id, shared.id] } }, shared, [])).toBe(true);
    expect(ruleMatches({ ...rule, match: { visibility: ['private' as const] } }, shared, [])).toBe(
      true,
    );
  });

  it('clears synthetic stores for demos (ADR-0028)', () => {
    const gate = createDisclosureGate({
      rules: {
        rules: [
          { id: 'demo', effect: 'allow', targets: ['demo'], match: { syntheticStore: true } },
        ],
      },
      syntheticStores: [SYNTHETIC_STORE],
    });
    expect(gate.decide({ kind: 'card', card: demoCard }, 'demo').decision).toBe('allow');
    expect(gate.decide({ kind: 'card', card: shared }, 'demo').decision).toBe('deny');
  });
});

describe('reference gate output matches the schemas', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../schemas');
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  // ajv-formats is CommonJS; under NodeNext its default import is the module object.
  (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  }
  const id = 'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json';
  const check = (ref: string, data: unknown) =>
    expect(ajv.validate(ref, data), JSON.stringify(ajv.errors)).toBe(true);

  it('for rules, decisions, transfers and confirmations', () => {
    check('https://worldbuilder.invalid/schemas/v0/gate-rules.schema.json', rules);
    const gate = createDisclosureGate({ rules });
    const transfer = gate.preview({
      connectorId: 'jev-stub',
      purpose: 'level1',
      request: { question: 'Q?' },
      cards: [shared, secret],
    });
    check(`${id}#/$defs/transfer`, transfer);
    const confirmation = gate.confirm(transfer.transferId, transfer.payloadHash);
    check(`${id}#/$defs/confirmation`, confirmation);
    for (const d of [
      gate.decide({ kind: 'card', card: shared }, 'local_model'),
      gate.decide({ kind: 'card', card: secret }, 'local_model'),
      gate.decide({ kind: 'card', card: tagged }, 'local_model'),
      gate.decide({ kind: 'card', card: shared }, 'cloud_model'),
      gate.decide({ kind: 'card', card: shared }, 'cloud_model', confirmation),
      gate.decide({ kind: 'stance', card: shared }, 'cloud_model', confirmation),
    ]) {
      check(id, d);
    }
  });

  it('refuses a preview without any cleared card', () => {
    expect(() =>
      createDisclosureGate().preview({
        connectorId: 'x',
        purpose: 'export',
        request: {},
        cards: [shared],
      }),
    ).toThrow('no card');
  });
});

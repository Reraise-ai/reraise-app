// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describeDisclosureGateConformance } from '@worldbuilder/conformance';
import type { Card, GateRules } from '@worldbuilder/core';
import { SCHEMAS, computeContentHash } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { createDisclosureGate, effectiveRules, ruleMatches } from './index.js';

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
const allowRule = {
  id: 'class-c',
  effect: 'allow' as const,
  targets: [...all],
  match: { class: ['C' as const] },
};
const rules: GateRules = {
  rules: [
    allowRule,
    { id: 'no-private-tag', effect: 'deny', targets: [...all], match: { tags: ['private'] } },
  ],
};

describeDisclosureGateConformance('reference gate', (now) => ({
  empty: createDisclosureGate({ now }),
  configured: createDisclosureGate({ rules, now }),
  withConfig: (config) =>
    createDisclosureGate({
      rules:
        config.rules === undefined
          ? rules
          : { rules: [...rules.rules, ...((config.rules as GateRules).rules ?? [])] },
      fragments: config.fragments,
      now,
    }),
  allowRule,
  card: shared,
  deniedCard: tagged,
  otherCard: secret,
}));

describe('rule matching', () => {
  it('ANDs criteria, ORs values, and matches everything with an empty match', () => {
    const rule = { ...allowRule, match: { class: ['C' as const], worlds: [WORLD] } };
    expect(ruleMatches(rule, shared)).toBe(true);
    expect(ruleMatches({ ...rule, match: { ...rule.match, class: ['A' as const] } }, shared)).toBe(
      false,
    );
    expect(ruleMatches({ ...rule, match: { ids: [secret.id, shared.id] } }, shared)).toBe(true);
    expect(ruleMatches({ ...rule, match: { visibility: ['private' as const] } }, shared)).toBe(
      true,
    );
    expect(ruleMatches({ ...rule, match: {} }, shared)).toBe(true);
    const names = new Map([[WORLD, 'Hormuz']]);
    expect(
      ruleMatches({ ...rule, match: { worlds: ['Hormuz'] } }, shared, { worldNames: names }),
    ).toBe(true);
    expect(
      ruleMatches({ ...rule, match: { worlds: ['Palma'] } }, shared, { worldNames: names }),
    ).toBe(false);
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

  it('names the source of every rule and rejects invalid or allowing fragments', () => {
    const deny = {
      source: 'store-x',
      rules: [{ id: 'd', effect: 'deny', targets: ['demo'], match: {} }],
    };
    expect(effectiveRules(rules, [deny]).map((r) => r.source)).toEqual(['user', 'user', 'store-x']);
    const allow = { source: 'store-x', rules: [{ ...allowRule }] };
    expect(() => effectiveRules(rules, [allow])).toThrow('deny rules only');
    expect(() => effectiveRules({ rules: [{ ...allowRule, match: { colour: [] } }] })).toThrow(
      'invalid gate rules',
    );
  });
});

describe('reference gate output matches the schemas', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  // ajv-formats is CommonJS; under NodeNext its default import is the module object.
  (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  const id = 'https://worldbuilder.invalid/schemas/v0/disclosure-decision.schema.json';
  const check = (ref: string, data: unknown) =>
    expect(ajv.validate(ref, data), JSON.stringify(ajv.errors)).toBe(true);

  it('for rules, decisions, transfers, confirmations and releases', () => {
    check('https://worldbuilder.invalid/schemas/v0/gate-rules.schema.json', rules);
    const gate = createDisclosureGate({ rules });
    const transfer = gate.preview({
      connectorId: 'jev-stub',
      purpose: 'level1',
      request: { question: 'Q?' },
      cards: [shared, secret],
      requester: { kind: 'board' },
    });
    check(`${id}#/$defs/transfer`, transfer);
    const confirmation = gate.confirm({
      transferId: transfer.transferId,
      payloadHash: transfer.payloadHash,
      sessionId: 's',
      currentEnvelope: transfer.preview,
    });
    check(`${id}#/$defs/confirmation`, confirmation);
    const release = gate.redeem({
      grant: { kind: 'token', token: confirmation.token!, sessionId: 's' },
      envelope: transfer.preview,
    });
    check(`${id}#/$defs/release`, release);
    for (const d of [
      gate.decide({ kind: 'card', card: shared }, 'local_model'),
      gate.decide({ kind: 'card', card: secret }, 'local_model'),
      gate.decide({ kind: 'card', card: tagged }, 'local_model'),
      gate.decide({ kind: 'card', card: shared }, 'cloud_model'),
      gate.decide({ kind: 'stance', card: shared }, 'cloud_model'),
      createDisclosureGate({ rules: { rules: 'broken' } }).decide(
        { kind: 'card', card: shared },
        'screen',
      ),
    ]) {
      check(id, d);
    }
  });

  it('refuses a preview without any cleared card or with invalid rules', () => {
    const preview = {
      connectorId: 'x',
      purpose: 'export' as const,
      request: {},
      cards: [shared],
      requester: { kind: 'board' as const },
    };
    expect(() => createDisclosureGate().preview(preview)).toThrow('no card');
    expect(() => createDisclosureGate({ rules: { rules: 1 } }).preview(preview)).toThrow('invalid');
  });
});

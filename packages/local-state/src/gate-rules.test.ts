// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DENY_ALL_RULES, buildGateRules, loadGateRulesFile } from './gate-rules.js';
import { tempDir } from './test-helpers.js';

const VALID = `rules:
  - id: screen-all
    effect: allow
    targets: [screen]
    match: {}
  - id: geo-public-to-local
    effect: allow
    targets: [local_model, cloud_model]
    match: { worlds: [Geopolitics], visibility: [public] }
  - id: never-class-a
    effect: deny
    targets: [local_model, cloud_model, demo]
    match: { class: [A] }
`;

async function load(text: string | undefined, fragments: unknown[] = []) {
  const dir = await tempDir();
  const file = path.join(dir, 'gate-rules.yaml');
  if (text !== undefined) await writeFile(file, text);
  return loadGateRulesFile(file, fragments);
}

const denyAllShape = (r: Awaited<ReturnType<typeof load>>) => {
  expect(r.ok).toBe(false);
  expect(r.reason).toBeTruthy();
  expect(r.rules).toEqual(DENY_ALL_RULES);
  expect(r.rules.rules[0]?.targets).toEqual(['screen', 'local_model', 'cloud_model', 'demo']);
  expect(r.fragments).toEqual([]);
};

describe('gate rules loader', () => {
  it('loads a valid rule file and lists every rule with its source', async () => {
    const r = await load(VALID);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.rules.rules).toHaveLength(3);
    expect(r.effective.map((x) => [x.id, x.source])).toEqual([
      ['screen-all', 'user'],
      ['geo-public-to-local', 'user'],
      ['never-class-a', 'user'],
    ]);
  });

  it('a missing file is valid and has no rules (default deny applies)', async () => {
    const r = await load(undefined);
    expect(r).toMatchObject({ ok: true, missing: true, rules: { rules: [] } });
  });

  it('accepts the valid and rejects the invalid gate-rules fixtures of the contract', async () => {
    const root = path.resolve(import.meta.dirname, '../../../schemas/fixtures');
    let checked = 0;
    for (const kind of ['valid', 'invalid'] as const) {
      for (const f of readdirSync(path.join(root, kind)).filter((n) =>
        n.startsWith('gate-rules'),
      )) {
        const fixture = JSON.parse(readFileSync(path.join(root, kind, f), 'utf8')) as {
          schema: string;
          data: unknown;
        };
        const built = fixture.schema.includes('#/$defs/fragment')
          ? buildGateRules(undefined, [fixture.data])
          : buildGateRules(fixture.data);
        expect(built.ok, `${kind}/${f}`).toBe(kind === 'valid');
        if (kind === 'invalid') expect(built.rules).toEqual(DENY_ALL_RULES);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ['unknown effect', 'rules: [{ id: a, effect: maybe, targets: [screen], match: {} }]'],
    ['unknown target', 'rules: [{ id: a, effect: allow, targets: [moon], match: {} }]'],
    ['empty targets', 'rules: [{ id: a, effect: allow, targets: [], match: {} }]'],
    [
      'unknown match field',
      'rules: [{ id: a, effect: allow, targets: [screen], match: { stance: [believed] } }]',
    ],
    ['missing match', 'rules: [{ id: a, effect: allow, targets: [screen] }]'],
    ['bad rule id', 'rules: [{ id: "A B", effect: allow, targets: [screen], match: {} }]'],
    ['extra top-level key', 'rules: []\nextra: 1'],
    ['no rules key', 'other: []'],
    ['wrong type', '- just\n- a list'],
    ['scalar', 'hello'],
    ['empty file', ''],
    ['comment only', '# nothing'],
  ])('fails closed on %s', async (_name, yaml) => {
    denyAllShape(await load(yaml));
  });

  it('one invalid rule invalidates the whole file: nothing is partially applied', async () => {
    const r = await load(
      'rules:\n  - { id: ok, effect: allow, targets: [screen], match: {} }\n  - { id: bad, effect: nope, targets: [screen], match: {} }',
    );
    denyAllShape(r);
    expect(r.effective.every((x) => x.effect === 'deny')).toBe(true);
  });

  it('fails closed on YAML syntax errors, aliases, duplicate keys and multiple documents', async () => {
    denyAllShape(await load('rules: [unclosed'));
    denyAllShape(
      await load('rules:\n  - &r { id: a, effect: allow, targets: [screen], match: {} }\n  - *r'),
    );
    denyAllShape(await load('rules: []\nrules: []'));
    denyAllShape(await load('rules: []\n---\nrules: []'));
  });

  it('fails closed on an unreadable file and an oversized file', async () => {
    const dir = await tempDir();
    denyAllShape(await loadGateRulesFile(dir)); // a directory is not a readable file
    denyAllShape(await load('rules: []\n#' + 'x'.repeat(1024 * 1024)));
  });

  it('fails closed on duplicate rule ids, also across user file and fragments', async () => {
    const dup =
      'rules:\n  - { id: a, effect: deny, targets: [screen], match: {} }\n  - { id: a, effect: deny, targets: [demo], match: {} }';
    denyAllShape(await load(dup));
    const fragment = {
      source: 'adapter-x',
      rules: [{ id: 'a', effect: 'deny', targets: ['cloud_model'], match: { class: ['A'] } }],
    };
    denyAllShape(
      await load('rules:\n  - { id: a, effect: deny, targets: [screen], match: {} }', [fragment]),
    );
  });

  describe('adapter fragments are deny-only', () => {
    const deny = {
      source: 'store-a',
      rules: [
        {
          id: 'ids-never',
          effect: 'deny',
          targets: ['local_model', 'cloud_model'],
          match: { class: ['A'] },
        },
      ],
    };

    it('are merged with their source', async () => {
      const r = await load(VALID, [deny]);
      expect(r.ok).toBe(true);
      expect(r.fragments).toEqual([deny]);
      expect(r.effective.at(-1)).toMatchObject({
        id: 'ids-never',
        source: 'store-a',
        effect: 'deny',
      });
    });

    it('apply even when the user file is missing', async () => {
      const r = await load(undefined, [deny]);
      expect(r).toMatchObject({ ok: true, missing: true });
      expect(r.effective).toHaveLength(1);
    });

    it('a fragment containing an allow rule is rejected: deny-all with the adapter named', async () => {
      const allow = {
        source: 'store-b',
        rules: [{ id: 'sneaky', effect: 'allow', targets: ['cloud_model'], match: {} }],
      };
      const r = await load(VALID, [allow]);
      denyAllShape(r);
      expect(r.reason).toContain('store-b');
    });

    it('a malformed fragment is rejected without leaking its content', async () => {
      const r = await load(VALID, ['nonsense']);
      denyAllShape(r);
      expect(r.reason).toContain('unknown');
      expect(buildGateRules(undefined, [{ source: 'x' }]).ok).toBe(false);
    });
  });
});

describe('fragment source names', () => {
  const frag = (source: string, id = 'f') => ({
    source,
    rules: [{ id, effect: 'deny', targets: ['demo'], match: {} }],
  });

  it('rejects reserved sources and the same source supplied twice', () => {
    for (const reserved of ['user', 'fail-closed']) {
      const r = buildGateRules(undefined, [frag(reserved)]);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('reserved');
    }
    const dup = buildGateRules(undefined, [frag('store-a', 'f1'), frag('store-a', 'f2')]);
    expect(dup.ok).toBe(false);
    expect(dup.reason).toContain('more than once');
    expect(buildGateRules(undefined, [frag('store-a', 'f1'), frag('store-b', 'f2')]).ok).toBe(true);
  });
});

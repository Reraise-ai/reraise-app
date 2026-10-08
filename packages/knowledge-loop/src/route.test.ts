// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { MemoryRouteRequest } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { memorySignals, routeMemory } from './route.js';
import { validateContract } from './validate.js';

// Built at run time so that no secret-like literal sits in the repository.
const TOKEN_LIKE = 'ab12'.repeat(8);
const KEY_BLOCK = `-----BEGIN ${'PRIVATE'} KEY-----`;
// Split so that the repository scanners see no real-looking value in the source (ADR-0022).
const IBAN = ['DE89', '3704', '0044', '0532', '0130', '00'].join('');
const PRIVATE_IP = ['10', '0', '0', '5'].join('.');
const AWS_LIKE = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');

/** Synthetic corpus: [text, kindHint, expected route, expected rule]. At least one per rule. */
const CORPUS: [string, MemoryRouteRequest['kindHint'] | undefined, string, string][] = [
  [`The importer token: ${TOKEN_LIKE}`, 'learning', 'ephemeral_ops_fact', 'secret'],
  [
    'Lesson learned: always set password = placeholder-value first',
    'learning',
    'ephemeral_ops_fact',
    'secret',
  ],
  [`${KEY_BLOCK} found in the notes, always rotate`, undefined, 'ephemeral_ops_fact', 'secret'],
  [`Cache key ${TOKEN_LIKE} because it is stable`, 'decision', 'ephemeral_ops_fact', 'secret'],
  ['ok', 'learning', 'ephemeral_ops_fact', 'short'],
  ['restart done', undefined, 'ephemeral_ops_fact', 'short'],
  ['The importer needs more memory for large files', 'ops', 'ephemeral_ops_fact', 'ops_hint'],
  [
    'Insurers raised war-risk premiums for the strait, see https://news.example.org/premiums',
    undefined,
    'card_proposal',
    'public_source',
  ],
  ['The coastal navy announced new patrol routes', 'observation', 'card_proposal', 'public_source'],
  [
    'The digest job writes to /var/lib/digest/pages every night',
    'learning',
    'ephemeral_ops_fact',
    'local_reference',
  ],
  [
    'Board service answered on localhost after the change',
    undefined,
    'ephemeral_ops_fact',
    'local_reference',
  ],
  ['Mirror moved to 203.0.113.7 for the sync', 'learning', 'ephemeral_ops_fact', 'local_reference'],
  [
    'The proxy listens on :8080 since the update',
    'learning',
    'ephemeral_ops_fact',
    'local_reference',
  ],
  [
    'Worker pid 4242 holds the lock on the store',
    undefined,
    'ephemeral_ops_fact',
    'local_reference',
  ],
  [
    'Tanker operators tend to reroute before insurers react, because premiums lag the news',
    undefined,
    'card_proposal',
    'durable_statement',
  ],
  [
    'The user prefers primary sources over wire summaries',
    undefined,
    'card_proposal',
    'durable_statement',
  ],
  [
    'Rule of thumb: confirm a closure with two independent origins',
    'observation',
    'card_proposal',
    'durable_statement',
  ],
  [
    'Always retry the nightly import after a timeout',
    'learning',
    'ephemeral_ops_fact',
    'transient',
  ],
  [
    'The embedding job timed out today on the large world',
    'learning',
    'ephemeral_ops_fact',
    'transient',
  ],
  [
    'Shipping insurance quotes are published weekly by the brokers',
    'learning',
    'card_proposal',
    'knowledge_hint',
  ],
  [
    'Quarterly routing reviews belong to the logistics desk',
    'decision',
    'card_proposal',
    'knowledge_hint',
  ],
  ['Checked the queue and moved on to the next item', undefined, 'ephemeral_ops_fact', 'default'],
  // Review cases (added in rules:v2).
  [
    'Lesson learned: the admin password for the staging box is Summer2026!',
    'learning',
    'ephemeral_ops_fact',
    'secret',
  ],
  [
    `We always use the AWS secret key ${AWS_LIKE} for uploads`,
    undefined,
    'ephemeral_ops_fact',
    'secret',
  ],
  [
    'Insight: the user prefers to be called at +49 151 23456789 in the evening',
    undefined,
    'ephemeral_ops_fact',
    'personal_data',
  ],
  [
    'The analyst jane.doe@example.org consistently prefers short briefs',
    undefined,
    'ephemeral_ops_fact',
    'personal_data',
  ],
  [
    `Lesson: see https://example.com/report; the service on ${PRIVATE_IP}:8080 needs the flag`,
    undefined,
    'ephemeral_ops_fact',
    'local_reference',
  ],
  [
    'Note from https://example.com: credentials are in /etc/app/creds.env',
    undefined,
    'ephemeral_ops_fact',
    'secret',
  ],
  [
    'Note from https://example.com: the archive lives in /srv/archive/2026 always',
    undefined,
    'ephemeral_ops_fact',
    'local_reference',
  ],
  [
    'ssh key passphrase "correct horse battery staple" always works',
    undefined,
    'ephemeral_ops_fact',
    'secret',
  ],
  [
    'The API token for the board: abc123def456 always expires on Friday',
    undefined,
    'ephemeral_ops_fact',
    'secret',
  ],
  [
    'Card proposals should always cite a public source because provenance matters',
    undefined,
    'card_proposal',
    'durable_statement',
  ],
  [
    `IBAN ${IBAN} is the account we always pay into`,
    undefined,
    'ephemeral_ops_fact',
    'personal_data',
  ],
  ['The one-time pin: 4711 for the vault', 'learning', 'ephemeral_ops_fact', 'secret'],
  ['Read the three new findings in the inbox', 'unknown', 'ephemeral_ops_fact', 'default'],
  [
    'Meeting moved from 10:30 to the afternoon slot',
    'observation',
    'ephemeral_ops_fact',
    'default',
  ],
];

describe('routeMemory (ADR-0042)', () => {
  it.each(CORPUS)('%s -> %s / %s', (text, kindHint, route, ruleId) => {
    const request: MemoryRouteRequest = {
      text,
      ...(kindHint !== undefined ? { kindHint } : {}),
      ...(text.startsWith('The coastal navy')
        ? { source: 'https://news.example.org/patrols' }
        : {}),
    };
    const result = routeMemory(request);
    expect([result.route, result.ruleId]).toEqual([route, ruleId]);
    expect(result.classifier).toBe('rules:v4');
    expect(validateContract('memory-route.schema.json', result)).toEqual({ ok: true });
  });

  it('covers every rule of rules:v4 in the corpus', () => {
    const rules = new Set(CORPUS.map((c) => c[3]));
    expect([...rules].sort()).toEqual(
      [
        'secret',
        'personal_data',
        'short',
        'ops_hint',
        'public_source',
        'local_reference',
        'durable_statement',
        'transient',
        'knowledge_hint',
        'default',
      ].sort(),
    );
  });

  it('never routes a secret to a card proposal, whatever else the item says', () => {
    for (const hint of ['learning', 'decision', 'preference', undefined] as const) {
      const r = routeMemory({
        text: `Lesson: always use token: ${TOKEN_LIKE} because https://news.example.org/x says so`,
        ...(hint ? { kindHint: hint } : {}),
      });
      expect(r.route).toBe('ephemeral_ops_fact');
    }
  });

  it('names signal ids, never the words it matched', () => {
    const r = routeMemory({ text: 'The insight is that brokers always price the strait twice' });
    expect(r.signals).toEqual(['durable']);
    expect(JSON.stringify(r)).not.toMatch(/insight|brokers|strait/);
  });

  it('is deterministic', () => {
    for (const [text, kindHint] of CORPUS) {
      const req = { text, ...(kindHint ? { kindHint } : {}) };
      expect(routeMemory(req)).toEqual(routeMemory(req));
    }
  });

  it('takes extra words per signal (for example another language) without changing the rule order', () => {
    const text = 'La naviera evita el estrecho por principio';
    expect(routeMemory({ text }).ruleId).toBe('default');
    const options = { extraWords: { durable: ['por principio'], transient: ['hoy'] } };
    expect(memorySignals({ text }, options)).toEqual(['durable']);
    expect(routeMemory({ text }, options).ruleId).toBe('durable_statement');
    expect(routeMemory({ text: `${text} hoy`, kindHint: 'learning' }, options).ruleId).toBe(
      'transient',
    );
  });

  it('does not take hyphenated slugs in public addresses for tokens', () => {
    const text =
      'Analysis at https://news.example.org/2026/very-long-article-title-about-the-strait-and-tankers';
    expect(routeMemory({ text }).ruleId).toBe('public_source');
  });
});

describe('token-like runs and known prefixes (rules:v3, v4)', () => {
  // Built from parts at run time: no token-like literal sits in the repository (ADR-0022).
  const tail = (n: number, alphabet = 'abcdefghjkmnpqrstuvwxyz0123456789') =>
    Array.from({ length: n }, (_, i) => alphabet[(i * 7) % alphabet.length]).join('');
  const lower36 = ['k3j9', 'x82m', 'q71p', 'z0w4', 'v55n', 'b62c', 'r9t8', 'y3u1', 'h2g6'].join('');
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567';

  it.each([
    ['a lower-case 36-character token with many digits', `The deploy uses ${lower36} for uploads`],
    ['a Slack bot token', `Bot runs with ${'xox' + 'b-'}${tail(12, '0123456789')}-${tail(24)}`],
    ['a Slack user token', `Use ${'xox' + 'p-'}${tail(30)} always`],
    ['a GitHub personal token', `Lesson: ${'gh' + 'p_'}${tail(36)} works`],
    ['a GitHub OAuth token', `Lesson: ${'gh' + 'o_'}${tail(36)} works`],
    ['a GitHub user-to-server token', `Lesson: ${'gh' + 'u_'}${tail(36)} works`],
    ['a GitHub server token', `Lesson: ${'gh' + 's_'}${tail(36)} works`],
    ['a GitHub refresh token', `Lesson: ${'gh' + 'r_'}${tail(36)} works`],
    ['a fine-grained GitHub token', `Lesson: ${'github' + '_pat_'}${tail(40)} works`],
    ['a secret API key with sk-', `The model key ${'sk' + '-'}${tail(40)} always works`],
    ['a live secret key', `Payments use ${'sk' + '_live_'}${tail(24)} always`],
    ['a live publishable key', `Payments use ${'pk' + '_live_'}${tail(24)} always`],
    ['an access key id', `Uploads use ${'AK' + 'IA'}${tail(16, UPPER)} always`],
    ['a temporary access key id', `Uploads use ${'AS' + 'IA'}${tail(16, UPPER)} always`],
    ['a browser API key', `Maps use ${'AI' + 'za'}${tail(35)} always`],
    ['a GitLab token', `CI uses ${'glpat' + '-'}${tail(20)} always`],
    ['a private key block', `${'-----BEGIN RSA ' + 'PRIVATE KEY-----'} always rotate`],
    [
      'a Slack webhook',
      `Lesson: the webhook is https://hooks.${'slack'}.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX always`,
    ],
    ['an npm token', `Insight: ${'npm' + '_'}${tail(36)} is the publish key we always use`],
    [
      'a JSON Web Token',
      `Insight: always use ${'eyJ' + 'hbGciOiJIUzI1NiJ9'}.${'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0'}.${tail(43)} for the API`,
    ],
    [
      'a URL with a password',
      `Lesson: the db url ${'postgres'}://app:${'hunter2'}@db.example.org/app always works`,
    ],
    [
      'a hyphenated token of short mixed parts',
      'Lesson: the code a1b2c3-d4e5f6-g7h8i9 always works',
    ],
    ['an underscore token of short mixed parts', 'Lesson: use x9y8_z7w6_v5u4_t3s2 always'],
    [
      'a UUID after a credential word',
      'Lesson: the API token is 123e4567-e89b-42d3-a456-426614174000 and always works',
    ],
    ['a UUID after Passwort', 'Merke: Passwort 123e4567-e89b-42d3-a456-426614174000 immer nutzen'],
    [
      'a UUID after Schlüssel with a colon',
      'Wichtig: Schlüssel: 123e4567-e89b-42d3-a456-426614174000 gilt immer',
    ],
    ['a UUID after key', 'Insight: the key 123e4567-e89b-42d3-a456-426614174000 is always needed'],
    [
      'a 40-character blob with digits inside',
      `Lesson: ${'Abcdefghij'.repeat(2)}7${'klmnopqrst'}8${'uvwx'} always`,
    ],
    // Safe-side false positive, documented: a 40+ letter/digit run with any digit is a secret,
    // so even a German compound ending in a number is flagged (rules:v3 behaviour).
    [
      'a long German compound ending in a number (safe-side false positive)',
      'Lesson: donaudampfschifffahrtsgesellschaftskapitaenspatent12 always applies',
    ],
    ['a two-part token of mixed parts', 'Lesson: the code a1b2c3d4-e5f6g7h8 always works'],
    [
      'an ASCII Schluessel followed by a UUID',
      'Wichtig: Schluessel 123e4567-e89b-42d3-a456-426614174000 gilt immer',
    ],
    [
      'a compound ending in Schlüssel',
      'Merke: der Zugangsschlüssel 123e4567-e89b-42d3-a456-426614174000 gilt immer',
    ],
    [
      'a compound ending in passwort',
      'Merke: Zugangspasswort 123e4567-e89b-42d3-a456-426614174000 gilt immer',
    ],
    [
      'a compound ending in token',
      'Lesson: the apitoken 123e4567-e89b-42d3-a456-426614174000 always works',
    ],
    [
      'a UUID after key and a full stop',
      'Lesson: the key. 123e4567-e89b-42d3-a456-426614174000 always works',
    ],
    ['a project key with sk-', `Lesson: ${'sk' + '-proj-'}${tail(22)} always works`],
  ])('treats %s as a secret', (_name, text) => {
    const r = routeMemory({ text, kindHint: 'learning' });
    expect([r.route, r.ruleId]).toEqual(['ephemeral_ops_fact', 'secret']);
  });

  it.each([
    ['a task-force note', 'The task-force always reviews the routes because of insurance'],
    ['an asked question', 'The analyst asked-for reviews tend to come back within a week'],
    [
      'a long lower-case slug with few digits',
      'see https://news.example.org/2026/very-long-article-title-about-the-strait-and-tankers',
    ],
    ['a long word compound', 'internationalisation-and-localisation-guidelines always apply here'],
    [
      'a long German compound noun without digits',
      'Die Donaudampfschifffahrtsgesellschaftskapitaensmuetzenfabrik gilt immer als Beispiel',
    ],
    ['a dated slug with few mixed parts', 'Lesson: see report-2026-10-08-update always'],
    ['a version slug', 'Lesson: release v2-beta-3 and plan-b-4 always differ'],
    [
      'a UUID far from any credential word',
      'Insight: the token budget discussion in the long weekly review always references card 123e4567-e89b-42d3-a456-426614174000',
    ],
    [
      'a UUID after a normal word',
      'Insight: the card 123e4567-e89b-42d3-a456-426614174000 always shows the pattern',
    ],
    [
      'a wb: URI after key',
      'Lesson: key card wb:123e4567-e89b-42d3-a456-426614174000/01M1EQQXC0MVA4E2WAPG22HEY0 always shows the pattern',
    ],
    ['a one-part word with letters and digits', 'Lesson: model a1b2c3d4e5 always differs'],
    ['a two-part code where one part is plain', 'Lesson: plan-a1b2c3d4e5f6 always differs'],
    [
      'a monkey UUID (short word inside another)',
      'Insight: monkey 123e4567-e89b-42d3-a456-426614174000 always shows the pattern',
    ],
    ['a short sk- word', 'The ski-lift always closes early because of wind'],
    [
      'a dated news URL',
      'Lesson: insurers always reprice within a week, see https://example.org/news/2026/10/05/strait-closure-update-123456',
    ],
    [
      'a wb: card URI',
      `Lesson: card wb:45aaff12-777f-40e3-a97c-8a592e1ea4f6/${'01M1EQQXC0'}MVA4E2WAPG22HEY0 always shows the pattern`,
    ],
    [
      'a canonical UUID',
      'Insight: the shipping reports for 2026 always follow the pattern 45aaff12-777f-40e3-a97c-8a592e1ea4f6',
    ],
    [
      'joined dates',
      'Lesson: the sequence 2026-10-01/2026-10-08/2026-10-15/2026-10-22 always shows weekly repricing',
    ],
    [
      'a mixed-case URL path',
      'Lesson: the report https://example.org/Reports/2026/Q3-Shipping-Report-Final-Version-With-Annex always lists tanker losses',
    ],
    [
      'pin and token in prose',
      'Lesson: we always skip the pin when the token count is low because it costs time',
    ],
    [
      'two ULIDs',
      'Lesson: cards 01M1EQQXC0MVA4E2WAPG22HEY0 and 01M1EMA1R0AH9ZTK3YJK33TNER always conflict because of sources',
    ],
  ])('keeps %s free of the secret rule', (_name, text) => {
    expect(routeMemory({ text }).ruleId).not.toBe('secret');
  });
});

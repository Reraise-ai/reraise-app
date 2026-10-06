// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { MemoryRouteRequest } from '@worldbuilder/core';
import { describe, expect, it } from 'vitest';
import { memorySignals, routeMemory } from './route.js';
import { validateContract } from './validate.js';

// Built at run time so that no secret-like literal sits in the repository.
const TOKEN_LIKE = 'ab12'.repeat(8);
const KEY_BLOCK = `-----BEGIN ${'PRIVATE'} KEY-----`;

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
    expect(result.classifier).toBe('rules:v1');
    expect(validateContract('memory-route.schema.json', result)).toEqual({ ok: true });
  });

  it('covers every rule of rules:v1 in the corpus', () => {
    const rules = new Set(CORPUS.map((c) => c[3]));
    expect([...rules].sort()).toEqual(
      [
        'secret',
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

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// findings_list and finding_pin (ADR-0014). A pin stores a private reference card. The note
// text and a document body stay in the source.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Card, Finding, SourceConnector } from '@worldbuilder/core';
import { SourceReadError } from '@worldbuilder/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listVaultFiles, sourceOptionsFromEnv } from './sources.js';
import { expectContract, makeFixture, type Fixture } from './test-helpers.js';

const MEMO = 'https://example.invalid/memo';
const SNIPPET = 'A short snippet.';
const FULL = 'FULL';
const NOW = '2026-10-14T12:00:00.000Z';

function titles(body: unknown): string[] {
  return (body as { findings: Finding[] }).findings.map((finding) => finding.title).sort();
}

describe('findings from connected sources', () => {
  let f: Fixture;
  let vault = '';
  const calls: { url: string; auth: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const href = String(url);
    calls.push({ url: href, auth: headers?.['authorization'] ?? '' });
    if (href.endsWith('/findings')) {
      return new Response(
        JSON.stringify({
          findings: [
            {
              uri: MEMO,
              title: 'Tanker memo',
              retrievedAt: NOW,
              snippet: SNIPPET,
              source: 'https://example.invalid/desk',
              content: FULL,
              body: FULL,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (href.endsWith('/documents')) {
      return new Response(
        JSON.stringify({
          documents: [
            {
              title: 'Index row',
              url: 'https://example.invalid/doc',
              updated: NOW,
              body: FULL,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('no', { status: 500 });
  }) as typeof fetch;

  beforeAll(async () => {
    vault = await mkdtemp(path.join(tmpdir(), 'wb-vault-'));
    await mkdir(path.join(vault, 'lanes'), { recursive: true });
    await mkdir(path.join(vault, '.obsidian'), { recursive: true });
    await writeFile(path.join(vault, 'lanes', 'tanker.md'), FULL);
    await writeFile(path.join(vault, 'skip.txt'), FULL);
    await writeFile(path.join(vault, '.obsidian', 'hidden.md'), FULL);
    f = await makeFixture({
      sources: {
        fetch: fetchImpl,
        httpUrl: 'http://127.0.0.1:9/findings',
        documentsUrl: 'http://127.0.0.1:9/documents',
        documentsKey: 'synthetic-key',
        obsidianVault: vault,
        now: () => new Date(NOW),
      },
    });
  });

  afterAll(async () => {
    await f?.close();
    if (vault) await rm(vault, { recursive: true, force: true });
  });

  it('lists the http finding and the note, and not the hidden note', async () => {
    const res = await f.human('GET', '/findings');
    expectContract('findings_list', res, 200);
    const body = res.json();
    expect(titles(body)).toEqual(['Index row', 'Tanker memo', 'tanker']);
    expect(JSON.stringify(body)).not.toContain(FULL);
    const note = (body as { findings: Finding[] }).findings.find(
      (finding) => finding.connector === 'obsidian',
    );
    expect(note?.uri).toContain('obsidian://open?vault=');
    expect(note?.originSystem).toBe('obsidian');
    expect(
      calls.some((call) => call.url.endsWith('/documents') && call.auth === 'Bearer synthetic-key'),
    ).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/findings') && call.auth === '')).toBe(true);
  });

  it('pins the http finding once, as a private card, without the document body', async () => {
    const pin = await f.human('POST', '/findings/pin', {
      connector: 'http-json',
      uri: MEMO,
      lageId: f.ids.lage,
    });
    expectContract('finding_pin', pin, 200);
    const card = (pin.json() as { card: Card }).card;
    expect(card.visibility).toBe('private');
    expect(card.type).toBe('source');
    expect(card.layer).toBe('said');
    expect(card.body).toBe(SNIPPET);
    expect(card.source).toBe('https://example.invalid/desk');
    expect(card.worlds).toContain(f.worldId);
    expect(card.refs?.[0]).toEqual({ system: 'http-json', url: MEMO });
    expect(JSON.stringify(card)).not.toContain(FULL);
    const lage = await f.human('GET', `/lagen/${f.ids.lage}`);
    const stored = lage.json() as Card;
    expect(stored.lage?.version).toBe(2);
    expect(stored.lage?.cards.some((place) => place.id === card.id)).toBe(true);

    const again = await f.human('POST', '/findings/pin', {
      connector: 'http-json',
      uri: MEMO,
      lageId: f.ids.lage,
    });
    expectContract('finding_pin', again, 200);
    expect((again.json() as { card: Card }).card.id).toBe(card.id);
    const reread = await f.human('GET', `/lagen/${f.ids.lage}`);
    expect((reread.json() as Card).lage?.version).toBe(2);
    expect(
      (reread.json() as Card).lage?.cards.filter((place) => place.id === card.id),
    ).toHaveLength(1);
  });

  it('pins the note without reading it', async () => {
    const listed = await f.human('GET', '/findings?text=tanker');
    expectContract('findings_list', listed, 200);
    const note = (listed.json() as { findings: Finding[] }).findings.find(
      (finding) => finding.connector === 'obsidian',
    );
    expect(note).toBeDefined();
    const pin = await f.human('POST', '/findings/pin', {
      connector: 'obsidian',
      uri: note!.uri,
      lageId: f.ids.lage,
    });
    expectContract('finding_pin', pin, 200);
    const card = (pin.json() as { card: Card }).card;
    expect(card.body).toBeUndefined();
    expect(card.originSystem).toBe('obsidian');
    expect(JSON.stringify(card)).not.toContain(FULL);
  });

  it('answers 404 when that uri is not in the source', async () => {
    const pin = await f.human('POST', '/findings/pin', {
      connector: 'http-json',
      uri: 'https://example.invalid/missing',
      lageId: f.ids.lage,
    });
    expectContract('finding_pin', pin, 404);
  });
});

describe('a source that does not answer', () => {
  function throwing(id: string): SourceConnector {
    return {
      id,
      findings: async () => {
        throw new SourceReadError('http_error');
      },
      referenceCard: () => {
        throw new Error('unused');
      },
    };
  }

  it('is 502 when every configured source throws', async () => {
    const f = await makeFixture({
      sources: { connectors: new Map([['http-json', throwing('http-json')]]) },
    });
    try {
      expectContract('findings_list', await f.human('GET', '/findings'), 502);
      expectContract(
        'finding_pin',
        await f.human('POST', '/findings/pin', {
          connector: 'http-json',
          uri: MEMO,
          lageId: f.ids.lage,
        }),
        502,
      );
    } finally {
      await f.close();
    }
  });

  it('keeps findings from a source that answered', async () => {
    const good: SourceConnector = {
      id: 'documents',
      findings: async () => [
        {
          uri: 'https://example.invalid/doc',
          connector: 'documents',
          title: 'Index row',
          retrievedAt: NOW,
          originSystem: 'documents',
        },
      ],
      referenceCard: () => {
        throw new Error('unused');
      },
    };
    const f = await makeFixture({
      sources: {
        connectors: new Map<string, SourceConnector>([
          ['http-json', throwing('http-json')],
          ['documents', good],
        ]),
      },
    });
    try {
      const res = await f.human('GET', '/findings');
      expectContract('findings_list', res, 200);
      expect(titles(res.json())).toEqual(['Index row']);
    } finally {
      await f.close();
    }
  });
});

describe('source addresses', () => {
  it('reads set addresses and drops a blank one', () => {
    expect(
      sourceOptionsFromEnv({
        WORLDBUILDER_SOURCE_HTTP_URL: ' http://127.0.0.1:9/findings ',
        WORLDBUILDER_DOCUMENTS_URL: 'http://127.0.0.1:9/documents',
        WORLDBUILDER_DOCUMENTS_KEY: ' synthetic ',
        WORLDBUILDER_OBSIDIAN_VAULT: 'C:\\vault',
      }),
    ).toEqual({
      httpUrl: 'http://127.0.0.1:9/findings',
      documentsUrl: 'http://127.0.0.1:9/documents',
      documentsKey: 'synthetic',
      obsidianVault: 'C:\\vault',
    });
    expect(
      sourceOptionsFromEnv({
        WORLDBUILDER_DOCUMENTS_URL: ' ',
        WORLDBUILDER_DOCUMENTS_KEY: 'k',
      }),
    ).toEqual({});
  });

  it('lists markdown notes and skips the rest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wb-vault-'));
    try {
      await mkdir(path.join(root, 'nested'), { recursive: true });
      await writeFile(path.join(root, 'note.md'), FULL);
      await writeFile(path.join(root, 'nested', 'other.md'), FULL);
      await writeFile(path.join(root, 'skip.txt'), FULL);
      await writeFile(path.join(root, '.hidden.md'), FULL);
      const files = await listVaultFiles(root);
      expect(files.map((file) => file.relativePath).sort()).toEqual(['nested/other.md', 'note.md']);
      expect(files.every((file) => file.modifiedAt.endsWith('Z'))).toBe(true);
      expect(JSON.stringify(files)).not.toContain(FULL);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

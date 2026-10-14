// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { describe, expect, it, vi } from 'vitest';
import {
  DOCUMENTS_SOURCE,
  HTTP_JSON_SOURCE,
  OBSIDIAN_SOURCE,
  SourceReadError,
  createDocumentSource,
  createHttpJsonSource,
  createObsidianVaultSource,
  referenceCard,
} from './sources.js';

const FULL = 'FULL-ARTICLE-BODY-MUST-NOT-BE-COPIED';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('http json source', () => {
  it('keeps a reference and drops a body, a file URI and a row without provenance', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        findings: [
          {
            uri: 'https://example.invalid/memo',
            title: 'Memo',
            snippet: 'One line.',
            source: 'Synthetic desk',
            retrievedAt: '2026-03-02T00:00:00Z',
            content: FULL,
            body: FULL,
          },
          {
            uri: 'file:///secret.md',
            title: 'Local file',
            source: 'disk',
            retrievedAt: '2026-03-02T00:00:00Z',
          },
          {
            uri: 'https://user:secret@example.invalid/hidden',
            title: 'Hidden',
            source: 'desk',
            retrievedAt: '2026-03-02T00:00:00Z',
          },
          {
            uri: 'https://example.invalid/bare',
            title: 'No provenance',
            retrievedAt: '2026-03-02T00:00:00Z',
          },
        ],
      }),
    ) as typeof fetch;
    const source = createHttpJsonSource({
      url: 'https://example.invalid/findings',
      fetch: fetchImpl,
    });
    const findings = await source.findings();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      uri: 'https://example.invalid/memo',
      connector: HTTP_JSON_SOURCE,
      title: 'Memo',
      snippet: 'One line.',
      source: 'Synthetic desk',
    });
    const card = source.referenceCard(findings[0]!);
    expect(card.body).toBe('One line.');
    expect(JSON.stringify(card)).not.toContain(FULL);
    expect(card.refs).toEqual([{ system: HTTP_JSON_SOURCE, url: 'https://example.invalid/memo' }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
  });

  it('filters by text and by a time, and a bad answer names nothing from the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          uri: 'https://example.invalid/old',
          title: 'Old note',
          originSystem: 'desk',
          retrievedAt: '2026-01-01T00:00:00Z',
        },
        {
          uri: 'https://example.invalid/new',
          title: 'New tanker note',
          originSystem: 'desk',
          retrievedAt: '2026-04-01T00:00:00Z',
        },
      ]),
    ) as typeof fetch;
    const source = createHttpJsonSource({ url: 'https://example.invalid/list', fetch: fetchImpl });
    const found = await source.findings({ since: '2026-02-01T00:00:00Z', text: 'tanker' });
    expect(found.map((f) => f.uri)).toEqual(['https://example.invalid/new']);

    const failing = vi.fn(async () => jsonResponse({ leaked: FULL }, 500)) as typeof fetch;
    const down = createHttpJsonSource({ url: 'https://example.invalid/list', fetch: failing });
    await expect(down.findings()).rejects.toEqual(new SourceReadError('http_error'));
    await expect(down.findings()).rejects.toThrow('the source did not answer');
  });
});

describe('document source', () => {
  it('lists documents by their url and does not invent a body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        documents: [
          {
            id: 'doc-1',
            title: 'Harbour memo',
            url: 'https://example.invalid/docs/harbour',
            updated: '2026-05-01T12:00:00Z',
            content: FULL,
          },
          { id: 'doc-2', title: 'No address' },
        ],
      }),
    ) as typeof fetch;
    const source = createDocumentSource({
      url: 'https://example.invalid/documents',
      fetch: fetchImpl,
      apiKey: 'synthetic-key',
      now: () => new Date('2026-06-01T00:00:00Z'),
    });
    const findings = await source.findings();
    expect(findings).toEqual([
      {
        uri: 'https://example.invalid/docs/harbour',
        connector: DOCUMENTS_SOURCE,
        title: 'Harbour memo',
        retrievedAt: '2026-05-01T12:00:00.000Z',
        originSystem: 'documents',
        source: 'https://example.invalid/docs/harbour',
      },
    ]);
    expect(source.referenceCard(findings[0]!).body).toBeUndefined();
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer synthetic-key');
  });
});

describe('obsidian vault source', () => {
  it('names the note and does not read it', async () => {
    const listFiles = vi.fn(async () => [
      { relativePath: 'lanes/tanker.md', modifiedAt: '2026-07-01T00:00:00Z' },
      { relativePath: '../outside.md', modifiedAt: '2026-07-01T00:00:00Z' },
      { relativePath: 'picture.png', modifiedAt: '2026-07-01T00:00:00Z' },
    ]);
    const source = createObsidianVaultSource({ vaultName: 'Synthetic', listFiles });
    const findings = await source.findings();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      connector: OBSIDIAN_SOURCE,
      title: 'tanker',
      originSystem: 'obsidian',
      uri: 'obsidian://open?vault=Synthetic&file=lanes%2Ftanker.md',
    });
    const card = referenceCard(findings[0]!);
    expect(card.body).toBeUndefined();
    expect(card.type).toBe('source');
    expect(card.layer).toBe('said');
    expect(listFiles).toHaveBeenCalledOnce();
  });
});

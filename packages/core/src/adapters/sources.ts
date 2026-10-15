// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Source connectors (ADR-0014). Each one lists references. None of them reads a document
// body into a card. Pinning is referenceCard, and it writes nothing.

import type { CardDraft, Finding } from '../generated/contracts.js';
import type { FindingsQuery, SourceConnector } from './source.js';

export const HTTP_JSON_SOURCE = 'http-json';
export const OBSIDIAN_SOURCE = 'obsidian';
export const DOCUMENTS_SOURCE = 'documents';

const DEFAULT_LIMIT = 100;
const MAX_ITEMS = 200;
const MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const SNIPPET_MAX = 1000;

export type SourceReadCode = 'http_error' | 'bad_response';

const TEXT: Readonly<Record<SourceReadCode, string>> = {
  http_error: 'the source did not answer',
  bad_response: 'the source answer could not be read',
};

/** A source failure. The message is one of the fixed lines above and carries no body. */
export class SourceReadError extends Error {
  readonly code: SourceReadCode;
  constructor(code: SourceReadCode) {
    super(TEXT[code]);
    this.name = 'SourceReadError';
    this.code = code;
  }
}

export interface VaultFile {
  /** Path inside the vault, with `/` separators and no `..` segment. */
  readonly relativePath: string;
  /** When the note file was last modified (ISO date-time). */
  readonly modifiedAt: string;
}

export interface HttpJsonSourceOptions {
  readonly url: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
}

export interface DocumentSourceOptions {
  readonly url: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
  readonly now?: () => Date;
}

export interface ObsidianVaultOptions {
  readonly vaultName: string;
  readonly listFiles: () => Promise<readonly VaultFile[]>;
}

interface RawFinding {
  readonly uri: string;
  readonly connector: string;
  readonly title: string;
  readonly retrievedAt: string;
  readonly snippet?: string;
  readonly source?: string;
  readonly originSystem?: string;
  readonly sourceDate?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function httpUri(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  return url.href;
}

function isoTime(value: string): string | undefined {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function isoDate(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' && /\S/.test(trimmed) ? trimmed : undefined;
}

function snippetOf(value: unknown): string | undefined {
  const text = textOf(value);
  if (text === undefined) return undefined;
  return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) : text;
}

function asFinding(raw: RawFinding): Finding | undefined {
  const title = textOf(raw.title);
  if (!title) return undefined;
  if (raw.source === undefined && raw.originSystem === undefined) return undefined;
  const base = {
    uri: raw.uri,
    connector: raw.connector,
    title,
    retrievedAt: raw.retrievedAt,
    ...(raw.snippet !== undefined ? { snippet: raw.snippet } : {}),
    ...(raw.sourceDate !== undefined ? { sourceDate: raw.sourceDate } : {}),
  };
  if (raw.source !== undefined && raw.originSystem !== undefined) {
    return { ...base, source: raw.source, originSystem: raw.originSystem };
  }
  if (raw.source !== undefined) return { ...base, source: raw.source };
  return { ...base, originSystem: raw.originSystem as string };
}

/** Newest first, one row per URI, then the caller's cap (at most 100). */
export function selectFindings(findings: readonly Finding[], query: FindingsQuery = {}): Finding[] {
  const since = query.since === undefined ? undefined : Date.parse(query.since);
  const text = query.text?.trim().toLowerCase();
  const cap = Math.min(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
  if (cap < 1) return [];
  const kept = findings.filter((finding) => {
    if (query.uri !== undefined && finding.uri !== query.uri) return false;
    if (since !== undefined && !Number.isNaN(since) && Date.parse(finding.retrievedAt) <= since) {
      return false;
    }
    if (text) {
      const hay = `${finding.title}\n${finding.snippet ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  kept.sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : a.retrievedAt > b.retrievedAt ? -1 : 0));
  const seen = new Set<string>();
  const unique: Finding[] = [];
  for (const finding of kept) {
    if (seen.has(finding.uri)) continue;
    seen.add(finding.uri);
    unique.push(finding);
    if (unique.length >= cap) break;
  }
  return unique;
}

/** The reference card a pin stores. The snippet is the only text copied from the source. */
export function referenceCard(finding: Finding): CardDraft {
  return {
    format: 2,
    type: 'source',
    title: finding.title,
    layer: 'said',
    source: finding.source ?? finding.uri,
    visibility: 'private',
    refs: [{ system: finding.connector, url: finding.uri }],
    ...(finding.originSystem !== undefined ? { originSystem: finding.originSystem } : {}),
    ...(finding.snippet !== undefined ? { body: finding.snippet } : {}),
    ...(finding.sourceDate !== undefined ? { sourceDate: finding.sourceDate } : {}),
  };
}

function httpFinding(raw: unknown): Finding | undefined {
  if (!isRecord(raw) || typeof raw['uri'] !== 'string' || typeof raw['retrievedAt'] !== 'string') {
    return undefined;
  }
  const uri = httpUri(raw['uri']);
  const retrievedAt = isoTime(raw['retrievedAt']);
  const title = textOf(raw['title']);
  const source = textOf(raw['source']);
  const originSystem = textOf(raw['originSystem']);
  if (!uri || !retrievedAt || !title || (source === undefined && originSystem === undefined)) {
    return undefined;
  }
  const snippet = snippetOf(raw['snippet']);
  const sourceDate = typeof raw['sourceDate'] === 'string' ? isoDate(raw['sourceDate']) : undefined;
  return asFinding({
    uri,
    connector: HTTP_JSON_SOURCE,
    title,
    retrievedAt,
    ...(snippet !== undefined ? { snippet } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(originSystem !== undefined ? { originSystem } : {}),
    ...(sourceDate !== undefined ? { sourceDate } : {}),
  });
}

function documentFinding(raw: unknown, now: Date): Finding | undefined {
  if (!isRecord(raw) || typeof raw['url'] !== 'string') return undefined;
  const uri = httpUri(raw['url']);
  const title = textOf(raw['title']);
  if (!uri || !title) return undefined;
  const updated = typeof raw['updated'] === 'string' ? isoTime(raw['updated']) : undefined;
  return asFinding({
    uri,
    connector: DOCUMENTS_SOURCE,
    title,
    retrievedAt: updated ?? now.toISOString(),
    originSystem: 'documents',
    source: uri,
  });
}

function vaultFinding(vaultName: string, file: VaultFile): Finding | undefined {
  const relative = file.relativePath.split('\\').join('/');
  if (
    relative === '' ||
    relative.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    !/\.md$/i.test(relative)
  ) {
    return undefined;
  }
  const title = textOf(relative.slice(relative.lastIndexOf('/') + 1).replace(/\.md$/i, ''));
  const retrievedAt = isoTime(file.modifiedAt);
  if (!title || !retrievedAt) return undefined;
  return asFinding({
    uri: `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relative)}`,
    connector: OBSIDIAN_SOURCE,
    title,
    retrievedAt,
    originSystem: 'obsidian',
  });
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceReadError('bad_response');
  }
  if (!response.body) throw new SourceReadError('bad_response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SourceReadError('bad_response');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function getJson(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number,
  apiKey?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SourceReadError('http_error');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceReadError('http_error');
  }
  try {
    return JSON.parse(await readCapped(response)) as unknown;
  } catch (e) {
    if (e instanceof SourceReadError) throw e;
    throw new SourceReadError('bad_response');
  }
}

function listed(json: unknown, key: 'findings' | 'documents'): unknown[] {
  if (key === 'findings' && Array.isArray(json)) return json.slice(0, MAX_ITEMS);
  if (!isRecord(json) || !Array.isArray(json[key])) throw new SourceReadError('bad_response');
  return json[key].slice(0, MAX_ITEMS);
}

/** Generic HTTP/JSON list. `GET url` returns `{ findings: [...] }` or an array. */
export function createHttpJsonSource(options: HttpJsonSourceOptions): SourceConnector {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: HTTP_JSON_SOURCE,
    async findings(query) {
      const json = await getJson(options.fetch, options.url, timeoutMs, options.apiKey);
      const findings: Finding[] = [];
      for (const item of listed(json, 'findings')) {
        const finding = httpFinding(item);
        if (finding) findings.push(finding);
      }
      return selectFindings(findings, query);
    },
    referenceCard,
  };
}

/**
 * A document index. `GET url` returns `{ documents: [{ title, url, updated? }] }`.
 * `url` is where the document lives. No document body is read.
 */
export function createDocumentSource(options: DocumentSourceOptions): SourceConnector {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  return {
    id: DOCUMENTS_SOURCE,
    async findings(query) {
      const json = await getJson(options.fetch, options.url, timeoutMs, options.apiKey);
      const findings: Finding[] = [];
      for (const item of listed(json, 'documents')) {
        const finding = documentFinding(item, now());
        if (finding) findings.push(finding);
      }
      return selectFindings(findings, query);
    },
    referenceCard,
  };
}

/** Notes in an Obsidian vault. The finding is the note's path, not its text. */
export function createObsidianVaultSource(options: ObsidianVaultOptions): SourceConnector {
  return {
    id: OBSIDIAN_SOURCE,
    async findings(query) {
      const findings: Finding[] = [];
      for (const file of await options.listFiles()) {
        const finding = vaultFinding(options.vaultName, file);
        if (finding) findings.push(finding);
      }
      return selectFindings(findings, query);
    },
    referenceCard,
  };
}

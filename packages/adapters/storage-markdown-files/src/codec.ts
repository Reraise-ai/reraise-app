// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The reference card format: card file text <-> canonical card (ADR-0006, ADR-0023, ADR-0027,
// ADR-0028, docs/reference/card-format.md). Reading maps the file to a canonical card;
// writing either renders a new card file or edits an existing one field by field.

import { buildUri, computeContentHash } from '@worldbuilder/core';
import type { Card, CardContent, CardDraft, KnownAuthor } from '@worldbuilder/core';
import { MarkdownStoreError } from './errors.js';
import {
  editFrontMatter,
  locateFrontMatter,
  parseFrontMatter,
  serialiseField,
  withEol,
} from './frontmatter.js';

type Json = Record<string, unknown>;

/** What the codec needs to know about the store. */
export interface CodecContext {
  readonly storeInstanceId: string;
  /** World name (as written in a card file) to world id. */
  worldId(name: string): string;
  /** World id to the name written in a card file; throws if the world is unknown. */
  worldName(id: string): string;
}

const ULID_EXACT = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ULID_IN_TEXT = /[0-7][0-9A-HJKMNP-TV-Z]{25}/;

/** Front-matter fields that map one to one to canonical card fields. */
export const FRONT_MATTER_FIELDS = [
  'collection',
  'type',
  'typeRaw',
  'title',
  'date',
  'source',
  'sourceDate',
  'sourceChecksum',
  'status',
  'rating',
  'release',
  'carrier',
  'affiliation',
  'visibility',
  'class',
  'layer',
  'worlds',
  'tags',
  'originSystem',
  'training',
  'edges',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
] as const;
const FRONT_MATTER_SET: ReadonlySet<string> = new Set(FRONT_MATTER_FIELDS);

/** Canonical fields that live in the body (or in the Lage front matter) and are patchable. */
const STRUCTURED_PATCH_FIELDS = ['body', 'lage', 'sections', 'rule'] as const;

/** Every canonical field a patch may set. Identity, format, author and the hash never. */
export const PATCHABLE_FIELDS: ReadonlySet<string> = new Set([
  ...FRONT_MATTER_FIELDS,
  ...STRUCTURED_PATCH_FIELDS,
]);

/** Fields whose presence makes a card format 2 (ADR-0023). */
const FORMAT_2_FIELDS = [
  'layer',
  'worlds',
  'author',
  'originSystem',
  'training',
  'edges',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
];
const PLAYER_FIELDS = ['interests', 'capabilities', 'dependencies', 'moves'] as const;
const LAGE_FRONT_MATTER = ['question', 'version', 'updatedAt'] as const;

/** Decision sections: key, heading written by the reference format, accepted headings. */
const DECISION_SECTIONS: readonly (readonly [string, string, readonly string[]])[] = [
  ['situation', 'Situation', ['situation']],
  ['trigger', 'Trigger', ['trigger', 'ausloeser', 'ausloser']],
  ['conditions', 'Conditions', ['conditions', 'bedingungen']],
  ['facts', 'Facts', ['facts', 'fakten']],
  ['priorities', 'Priorities', ['priorities', 'prioritaeten', 'prioritaten']],
  ['action', 'Action', ['action', 'handlung']],
  ['alternatives', 'Alternatives', ['alternatives', 'alternativen']],
  ['exclusions', 'Exclusions', ['exclusions', 'ausschluss']],
  ['rationale', 'Rationale', ['rationale', 'begruendung', 'begrundung']],
  ['cardsUsed', 'Cards used', ['cards used', 'verwendete karten']],
  ['outcome', 'Outcome', ['outcome', 'ergebnis']],
];

/** Fold a heading for matching: lower case, umlauts transliterated or dropped. */
function foldHeading(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();
}
const sectionKeyOf = (heading: string): string =>
  DECISION_SECTIONS.find(([, , aliases]) => aliases.includes(foldHeading(heading)))?.[0] ?? heading;

// ---------------------------------------------------------------- sections of a body

interface Section {
  readonly heading: string;
  readonly headingStart: number;
  readonly contentStart: number;
  contentEnd: number;
}

/** `##` sections of `text` from offset `from`; headings inside code fences do not count. */
export function findSections(text: string, from: number): Section[] {
  const sections: Section[] = [];
  let inFence = false;
  let pos = from;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl < 0 ? text.length : nl;
    const next = nl < 0 ? text.length : nl + 1;
    const line = text.slice(pos, lineEnd).replace(/\r$/, '');
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const h = /^##\s+(.+?)\s*$/.exec(line);
      if (h) {
        const prev = sections.at(-1);
        if (prev) prev.contentEnd = pos;
        sections.push({
          heading: h[1] ?? '',
          headingStart: pos,
          contentStart: next,
          contentEnd: text.length,
        });
      }
    }
    pos = next;
  }
  return sections;
}

const JSON_BLOCK = /(```json\r?\n)([\s\S]*?)(\r?\n```)/;

function parseJsonSection(text: string, section: Section): unknown {
  const block = JSON_BLOCK.exec(text.slice(section.contentStart, section.contentEnd));
  if (!block) throw new MarkdownStoreError('parse', `"## ${section.heading}" has no json block`);
  try {
    return JSON.parse(block[2] ?? '');
  } catch {
    throw new MarkdownStoreError('parse', `"## ${section.heading}" holds invalid JSON`);
  }
}

function parseDecisionSections(text: string, sections: readonly Section[]): Json {
  const out: Json = {};
  for (const s of sections) {
    const key = sectionKeyOf(s.heading);
    const content = text.slice(s.contentStart, s.contentEnd).replace(/\r\n/g, '\n').trim();
    if (key === 'cardsUsed') {
      out[key] = content
        .split('\n')
        .filter((l) => /^\s*[-*]\s+/.test(l))
        .map((l) => ULID_IN_TEXT.exec(l)?.[0] ?? l.replace(/^\s*[-*]\s+/, '').trim());
    } else {
      out[key] = key === 'outcome' && content === 'offen' ? 'open' : content;
    }
  }
  return out;
}

// ---------------------------------------------------------------- entries (edges, players)

const BAD_ENTRY_CHARS = /[,[\]]/;

function splitPipes(entry: unknown, n: number, what: string): string[] {
  const parts = String(entry).split('|');
  if (parts.length !== n || parts.some((p) => p.trim() === '')) {
    throw new MarkdownStoreError(
      'parse',
      `${what} entry "${String(entry)}" must have ${n} non-empty parts separated by "|"`,
    );
  }
  return parts.map((p) => p.trim());
}

function entryString(parts: readonly unknown[], what: string): string {
  const strings = parts.map(String);
  if (strings.some((p) => BAD_ENTRY_CHARS.test(p) || p.includes('|') || p.trim() === '')) {
    throw new MarkdownStoreError(
      'invalid_card',
      `${what} entries must not be empty or contain ",", "[", "]" or "|": ${strings.join(' | ')}`,
    );
  }
  return strings.join('|');
}

// ---------------------------------------------------------------- reading

export interface ParsedCard {
  readonly card: Card;
  /** The world names the file lists, for the implicit-world registry. */
  readonly worldNames: readonly string[];
}

/** Map one card file to its canonical card. Throws `MarkdownStoreError('parse')` on bad input. */
export function parseCardText(text: string, ctx: CodecContext): ParsedCard {
  const { data, span } = parseFrontMatter(text);
  for (const key of ['externalId', 'uri', 'contentHash']) {
    if (key in data) {
      throw new MarkdownStoreError('parse', `front matter must not contain derived field "${key}"`);
    }
  }
  const id = data['id'];
  if (typeof id !== 'string' || !ULID_EXACT.test(id)) {
    throw new MarkdownStoreError('parse', 'front matter needs an "id" that is a ULID');
  }
  const card: Json = {};
  for (const key of FRONT_MATTER_FIELDS) if (key in data) card[key] = data[key];
  for (const key of ['level', 'signature']) if (key in data) card[key] = data[key];

  card['format'] = data['format'] ?? (FORMAT_2_FIELDS.some((f) => f in data) ? 2 : 1);
  if (data['author'] !== undefined) card['author'] = data['author'];
  else if (card['format'] === 1) card['author'] = 'unknown';
  card['training'] ??= false;
  card['id'] = id;
  card['externalId'] = id;
  card['uri'] = buildUri(ctx.storeInstanceId, id);

  let worldNames: string[] = [];
  if (Array.isArray(data['worlds'])) {
    worldNames = data['worlds'].map(String);
    card['worlds'] = worldNames.map((n) => ctx.worldId(n));
  }
  if (Array.isArray(data['edges'])) {
    card['edges'] = data['edges'].map((e) => {
      const [target, kind, by] = splitPipes(e, 3, 'edge');
      return { target, kind, by };
    });
  }
  for (const field of PLAYER_FIELDS) {
    const entries = data[field];
    if (Array.isArray(entries)) {
      card[field] = entries.map((e) => {
        const [t, source] = splitPipes(e, 2, 'player-field');
        return { text: t, source };
      });
    }
  }

  const body = text
    .slice(span.bodyStart)
    .replace(/^\r?\n/, '')
    .replace(/\r\n/g, '\n');
  card['body'] = body;
  const sections = findSections(text, span.bodyStart);
  if (data['type'] === 'lage') {
    const position = sections.find((s) => s.heading === 'Position');
    if (!position) throw new MarkdownStoreError('parse', 'a lage card needs "## Position"');
    const state = parseJsonSection(text, position) as Json;
    if (
      data['question'] !== undefined &&
      state['question'] !== undefined &&
      data['question'] !== state['question']
    ) {
      throw new MarkdownStoreError('parse', 'lage question differs between front matter and body');
    }
    card['lage'] = {
      ...state,
      question: state['question'] ?? data['question'],
      version: data['version'],
      updatedAt: data['updatedAt'],
    };
  }
  const rule = sections.find((s) => s.heading === 'Rule');
  if (data['type'] === 'rule' && rule) card['rule'] = parseJsonSection(text, rule);
  if (data['type'] === 'decision' && card['format'] === 2) {
    card['sections'] = parseDecisionSections(text, sections);
  }
  card['contentHash'] = computeContentHash(card as unknown as CardContent);
  return { card: card as unknown as Card, worldNames };
}

// ---------------------------------------------------------------- writing

/** The value a front-matter field holds in the file for a canonical value. */
function toFileValue(key: string, value: unknown, ctx: CodecContext): unknown {
  if (key === 'worlds') return (value as string[]).map((id) => ctx.worldName(id));
  if (key === 'edges') {
    return (value as { target: string; kind: string; by: string }[]).map((e) =>
      entryString([e.target, e.kind, e.by], 'edge'),
    );
  }
  if ((PLAYER_FIELDS as readonly string[]).includes(key)) {
    return (value as { text: string; source: string }[]).map((e) =>
      entryString([e.text, e.source], 'player-field'),
    );
  }
  return value;
}

const lageJson = (lage: Json): string => {
  // version and updatedAt live in the front matter; the block holds the rest.
  const state = { ...lage };
  delete state['version'];
  delete state['updatedAt'];
  return JSON.stringify(state, null, 2);
};

const block = (json: string): string => `\`\`\`json\n${json}\n\`\`\``;

function sectionsText(sections: Json): string {
  return DECISION_SECTIONS.map(([key, heading]) => {
    const v = sections[key];
    const content = Array.isArray(v) ? v.map((id) => `- ${String(id)}`).join('\n') : String(v);
    return `## ${heading}\n\n${content}\n`;
  }).join('\n');
}

const KEY_ORDER = [
  'format',
  'collection',
  'type',
  'typeRaw',
  'title',
  'layer',
  'author',
  'source',
  'sourceDate',
  'sourceChecksum',
  'originSystem',
  'status',
  'class',
  'visibility',
  'release',
  'rating',
  'carrier',
  'affiliation',
  'date',
  'worlds',
  'tags',
  'training',
  'edges',
  'interests',
  'capabilities',
  'dependencies',
  'moves',
];

/** The text of a new card file (LF line breaks). The draft is already validated. */
export function renderNewCard(
  id: string,
  draft: CardDraft,
  author: KnownAuthor,
  ctx: CodecContext,
): string {
  const d = { ...(draft as unknown as Json), author } as Json;
  const lines = [serialiseField('id', id)];
  for (const key of KEY_ORDER) {
    if (d[key] !== undefined) lines.push(serialiseField(key, toFileValue(key, d[key], ctx)));
  }
  const lage = d['lage'] as Json | undefined;
  if (lage) {
    lines.push(serialiseField('question', lage['question']));
    lines.push(serialiseField('version', lage['version']));
    lines.push(serialiseField('updatedAt', lage['updatedAt']));
  }
  const parts: string[] = [];
  const own = typeof d['body'] === 'string' ? d['body'].replace(/\r\n/g, '\n').trimEnd() : '';
  if (own) parts.push(own);
  if (lage && !/^##\s+Position\s*$/m.test(own))
    parts.push(`## Position\n\n${block(lageJson(lage))}`);
  if (d['rule'] && !/^##\s+Rule\s*$/m.test(own)) {
    parts.push(`## Rule\n\n${block(JSON.stringify(d['rule'], null, 2))}`);
  }
  if (d['sections'] && !/^##\s+Situation\s*$/m.test(own)) {
    parts.push(sectionsText(d['sections'] as Json).trimEnd());
  }
  const body = parts.length > 0 ? `\n${parts.join('\n\n')}\n` : '';
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Replace the body (everything after the front matter), keeping the blank line after it. */
function replaceBody(text: string, body: string): string {
  const span = locateFrontMatter(text);
  const head = text.slice(0, span.bodyStart);
  const hadBlank = /^\r?\n/.test(text.slice(span.bodyStart));
  const blank = hadBlank || body !== '' ? span.eol : '';
  return head + (body === '' ? '' : blank + withEol(body.replace(/\r\n/g, '\n'), span.eol));
}

/** Replace (or append) the json block under `## <heading>`. */
function setJsonSection(text: string, heading: string, json: string): string {
  const { bodyStart, eol } = locateFrontMatter(text);
  const section = findSections(text, bodyStart).find((s) => s.heading === heading);
  if (section) {
    const inner = text.slice(section.contentStart, section.contentEnd);
    const m = JSON_BLOCK.exec(inner);
    if (m) {
      const at = section.contentStart + m.index + (m[1] ?? '').length;
      return text.slice(0, at) + withEol(json, eol) + text.slice(at + (m[2] ?? '').length);
    }
    const fresh = withEol(`\n${block(json)}\n`, eol);
    return text.slice(0, section.contentStart) + fresh + text.slice(section.contentEnd);
  }
  const lead = text.endsWith('\n') ? '' : eol;
  return `${text}${lead}${withEol(`\n## ${heading}\n\n${block(json)}\n`, eol)}`;
}

/** Replace the content of each decision section, appending missing ones. */
function setDecisionSections(text: string, sections: Json): string {
  let out = text;
  const eol = locateFrontMatter(text).eol;
  for (const [key, heading] of DECISION_SECTIONS) {
    const v = sections[key];
    if (v === undefined) continue;
    const content = Array.isArray(v) ? v.map((id) => `- ${String(id)}`).join('\n') : String(v);
    const found = findSections(out, locateFrontMatter(out).bodyStart);
    const at = found.findIndex((s) => sectionKeyOf(s.heading) === key);
    if (at >= 0) {
      const s = found[at]!;
      const hasNext = at < found.length - 1;
      const fresh = withEol(`\n${content}\n${hasNext ? '\n' : ''}`, eol);
      out = out.slice(0, s.contentStart) + fresh + out.slice(s.contentEnd);
    } else {
      const lead = out.endsWith('\n') ? '' : eol;
      out += `${lead}${withEol(`\n## ${heading}\n\n${content}\n`, eol)}`;
    }
  }
  return out;
}

/**
 * Apply a patch to a card file's text. Only the named fields change; the result is the input
 * byte for byte everywhere else. `undefined` removes a field.
 */
export function applyPatch(text: string, patch: Json, ctx: CodecContext): string {
  const edits = new Map<string, string | null>();
  for (const [key, value] of Object.entries(patch)) {
    if (FRONT_MATTER_SET.has(key)) {
      edits.set(
        key,
        value === undefined || value === null
          ? null
          : serialiseField(key, toFileValue(key, value, ctx)),
      );
    } else if (key === 'lage' && value) {
      const lage = value as Json;
      for (const k of LAGE_FRONT_MATTER) edits.set(k, serialiseField(k, lage[k]));
    }
  }
  let out = editFrontMatter(text, edits);
  if ('body' in patch && typeof patch['body'] === 'string') out = replaceBody(out, patch['body']);
  if (patch['lage']) out = setJsonSection(out, 'Position', lageJson(patch['lage'] as Json));
  if (patch['rule']) out = setJsonSection(out, 'Rule', JSON.stringify(patch['rule'], null, 2));
  if (patch['sections']) out = setDecisionSections(out, patch['sections'] as Json);
  return out;
}

/** Ids a card (or the fields of a patch) references and that must exist in the store. */
export function referencedIds(content: Json): string[] {
  const ids: string[] = [];
  for (const e of (content['edges'] as { target: string; by: string }[] | undefined) ?? []) {
    if (e.by !== 'unknown') ids.push(e.target);
  }
  const lage = content['lage'] as
    { cards: { id: string }[]; edges: { from: string; to: string }[] } | undefined;
  if (lage) {
    for (const c of lage.cards) ids.push(c.id);
    for (const e of lage.edges) ids.push(e.from, e.to);
  }
  const used = (content['sections'] as { cardsUsed?: string[] } | undefined)?.cardsUsed;
  if (used) ids.push(...used);
  for (const field of PLAYER_FIELDS) {
    for (const e of (content[field] as { source: string }[] | undefined) ?? []) {
      if (ULID_EXACT.test(e.source)) ids.push(e.source);
    }
  }
  return [...new Set(ids)];
}

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Fixture reader for the markdown-files reference card format (ADR-0006, ADR-0023,
// ADR-0027, ADR-0028). It turns example card files into canonical cards so the contract
// tests can validate them. It is NOT the storage adapter (that lands in M1, with patch
// writes); it implements only reading:
//
// - YAML front matter with the canonical English field names. `externalId`, `uri` and `body`
//   are derived, never stored. `synthetic` is the repository hygiene marker, not a card field.
// - `edges` entries are `target|kind|by`; player-field entries are `text|source`;
//   `personalityType` is one `text|source` value.
// - `worlds` lists world names, resolved to world ids within the store.
// - Format detection and legacy defaults: a card is format 2 if it says `format: 2` or uses
//   any format-2 field; a format-1 card without `author` reads as `author: unknown`;
//   `training` defaults to false.
// - Type `lage`: `question`, `version`, `updatedAt` in front matter, the rest of the board
//   state as a ```json block under `## Position` (ADR-0027).
// - Type `rule`: the structured rule as a ```json block under `## Rule`.
// - Format-2 type `decision`: the eleven sections as `##` headings (DECISION_HEADINGS);
//   `Cards used` is a list of card ids.
// - `contentHash` is computed by packages/core (ADR-0034).
import { buildUri, canonicalJson, computeContentHash, encodeExternalId } from '@worldbuilder/core';
import { parse as parseYaml } from 'yaml';

// Identity and hashing come from packages/core, never a second implementation.
export { buildUri, canonicalJson, computeContentHash, encodeExternalId };

/** Front-matter keys that are derived from the file or the body and must not be stored. */
export const DERIVED_KEYS = [
  'externalId',
  'uri',
  'body',
  'lage',
  'sections',
  'rule',
  'contentHash',
];

/**
 * Fields whose presence makes a card format 2 (ADR-0023). Descriptive metadata
 * (`language`, `validFrom`, `validUntil`, `aliases`, `refs`) does not, same as `tags`
 * (ADR-0048).
 */
export const FORMAT_2_FIELDS = [
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
  'redLines',
  'assumedGoals',
  'personalityType',
];

/** List player fields, each entry `text|source` (ADR-0023, ADR-0038). */
export const PLAYER_FIELDS = [
  'interests',
  'capabilities',
  'dependencies',
  'moves',
  'redLines',
  'assumedGoals',
];

/** Front-matter keys of a Lage card that belong to its board state. */
const LAGE_FRONT_MATTER = ['question', 'version', 'updatedAt'];

/** Decision section headings written by the reference format, in order, with their keys. */
/** @type {[string, string][]} */
export const DECISION_HEADINGS = [
  ['Situation', 'situation'],
  ['Trigger', 'trigger'],
  ['Conditions', 'conditions'],
  ['Facts', 'facts'],
  ['Priorities', 'priorities'],
  ['Action', 'action'],
  ['Alternatives', 'alternatives'],
  ['Exclusions', 'exclusions'],
  ['Rationale', 'rationale'],
  ['Cards used', 'cardsUsed'],
  ['Outcome', 'outcome'],
];

const ULID_RE = /[0-7][0-9A-HJKMNP-TV-Z]{25}/;

/** Split a Markdown file into parsed front matter and body. Throws on malformed input. */
export function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('missing YAML front matter');
  const data = parseYaml(m[1] ?? '');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('front matter is not a mapping');
  }
  return { data, body: (m[2] ?? '').replace(/^\r?\n/, '') };
}

/** Split `a|b|c` into exactly `n` parts. */
function splitPipes(entry, n, what) {
  const parts = String(entry).split('|');
  if (parts.length !== n || parts.some((p) => p.trim() === '')) {
    throw new Error(`${what} entry "${entry}" must have ${n} non-empty parts separated by "|"`);
  }
  return parts.map((p) => p.trim());
}

/** Parse `edges: [target|kind|by, ...]`. */
export function parseEdges(entries) {
  return entries.map((e) => {
    const [target, kind, by] = splitPipes(e, 3, 'edge');
    return { target, kind, by };
  });
}

/** Parse player-field entries `[text|source, ...]`. */
export function parsePlayerField(entries) {
  return entries.map((e) => {
    const [text, source] = splitPipes(e, 2, 'player-field');
    return { text, source };
  });
}

/** Split a body into `## Heading` sections: [{ heading, content }]. */
export function splitSections(body) {
  /** @type {{ heading: string, lines: string[] }[]} */
  const sections = [];
  /** @type {{ heading: string, lines: string[] } | null} */
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = { heading: h[1] ?? '', lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((s) => ({ heading: s.heading, content: s.lines.join('\n').trim() }));
}

/** Parse the eleven decision sections. Unknown or missing headings are left to the schema. */
export function parseDecisionSections(body) {
  const byHeading = new Map(DECISION_HEADINGS);
  /** @type {Record<string, unknown>} */
  const sections = {};
  for (const { heading, content } of splitSections(body)) {
    const key = byHeading.get(heading) ?? heading;
    if (key === 'cardsUsed') {
      sections[key] = content
        .split(/\r?\n/)
        .filter((l) => /^\s*[-*]\s+/.test(l))
        .map((l) => ULID_RE.exec(l)?.[0] ?? l.replace(/^\s*[-*]\s+/, '').trim());
    } else {
      sections[key] = content;
    }
  }
  return sections;
}

/** Parse the ```json block under `## <heading>`. */
export function parseJsonSection(body, heading) {
  const section = splitSections(body).find((s) => s.heading === heading);
  if (!section) throw new Error(`no "## ${heading}" section`);
  const block = /```json\r?\n([\s\S]*?)\r?\n```/.exec(section.content);
  if (!block) throw new Error(`"## ${heading}" section has no \`\`\`json block`);
  return JSON.parse(block[1] ?? '');
}

/**
 * Build the canonical card for one markdown-files card file.
 * The reference format stores the canonical ULID natively, so `externalId` equals `id`.
 * `worlds` maps world names to world ids within the store.
 *
 * @param {string} text
 * @param {{ storeInstanceId: string, worlds: Map<string, string> }} store
 */
export function toCanonicalCard(text, { storeInstanceId, worlds }) {
  const { data, body } = splitFrontMatter(text);
  for (const key of DERIVED_KEYS) {
    if (key in data) throw new Error(`front matter must not contain derived field "${key}"`);
  }
  /** @type {Record<string, any>} */
  const card = { ...data };
  delete card.synthetic; // repository hygiene marker, not a card field
  for (const key of LAGE_FRONT_MATTER) delete card[key];

  card.format = data.format ?? (FORMAT_2_FIELDS.some((f) => f in data) ? 2 : 1);
  if (card.author === undefined && card.format === 1) card.author = 'unknown';
  if (card.training === undefined) card.training = false;
  if (typeof data.id === 'string') {
    card.externalId = data.id;
    card.uri = buildUri(storeInstanceId, data.id);
  }
  if (Array.isArray(data.worlds)) {
    card.worlds = data.worlds.map((name) => {
      const id = worlds.get(String(name));
      if (id === undefined) throw new Error(`unknown world "${name}"`);
      return id;
    });
  }
  if (Array.isArray(data.edges)) card.edges = parseEdges(data.edges);
  for (const field of PLAYER_FIELDS) {
    if (Array.isArray(data[field])) card[field] = parsePlayerField(data[field]);
  }
  if (data.personalityType !== undefined) {
    if (typeof data.personalityType !== 'string') {
      throw new Error('personalityType must be one "text|source" value, not a list or mapping');
    }
    card.personalityType = parsePlayerField([data.personalityType])[0];
  }
  card.body = body;

  if (data.type === 'lage') {
    const state = parseJsonSection(body, 'Position');
    if (
      data.question !== undefined &&
      state.question !== undefined &&
      data.question !== state.question
    ) {
      throw new Error('lage question differs between front matter and "## Position"');
    }
    card.lage = {
      ...state,
      question: state.question ?? data.question,
      version: data.version,
      updatedAt: data.updatedAt,
    };
  } else {
    for (const key of LAGE_FRONT_MATTER) if (key in data) card[key] = data[key];
  }
  if (data.type === 'rule' && splitSections(body).some((s) => s.heading === 'Rule')) {
    card.rule = parseJsonSection(body, 'Rule');
  }
  if (data.type === 'decision' && card.format === 2) card.sections = parseDecisionSections(body);
  card.contentHash = computeContentHash(card);
  return card;
}

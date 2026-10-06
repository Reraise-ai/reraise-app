// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Byte-preserving access to the YAML front matter of a card file (ADR-0006, ADR-0023).
// A patch never re-serialises the document: it replaces the text range of exactly the
// changed top-level fields and leaves every other byte (foreign fields, comments, order,
// quoting, line endings) as it was.

import { Document, isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from 'yaml';
import { MarkdownStoreError } from './errors.js';

export interface Span {
  /** Offset of the first character of the front matter (after the opening fence line). */
  readonly fmStart: number;
  /** Offset just past the last front-matter character (before the line break of the closing fence). */
  readonly fmEnd: number;
  /** Offset of the first character after the closing fence line. */
  readonly bodyStart: number;
  /** Line break the file uses; `\n` when it has none. */
  readonly eol: '\n' | '\r\n';
}

export interface ParsedFrontMatter {
  readonly span: Span;
  readonly data: Record<string, unknown>;
  readonly pairs: ReadonlyMap<string, { start: number; end: number }>;
}

/** Locate the front matter. Throws if the file does not start with a `---` fenced block. */
export function locateFrontMatter(text: string): Span {
  const open = /^\uFEFF?---[ \t]*(\r?\n)/.exec(text);
  if (!open) throw new MarkdownStoreError('parse', 'missing YAML front matter');
  const fmStart = open[0].length;
  const eol: '\n' | '\r\n' = open[1] === '\r\n' ? '\r\n' : '\n';
  // The closing fence is a `---` line after a line break (right after the opening line when
  // the block is empty).
  const close = /(\r?\n)---[ \t]*(\r?\n|$)/g;
  close.lastIndex = fmStart - open[1]!.length;
  const m = close.exec(text);
  if (m) {
    const empty = m.index + m[1]!.length === fmStart;
    return { fmStart, fmEnd: empty ? fmStart : m.index, bodyStart: m.index + m[0].length, eol };
  }
  throw new MarkdownStoreError('parse', 'unterminated YAML front matter');
}

/** Parse the front matter and record the text range of every top-level pair. */
export function parseFrontMatter(text: string): ParsedFrontMatter {
  const span = locateFrontMatter(text);
  const fm = text.slice(span.fmStart, span.fmEnd);
  const doc = parseDocument(fm, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new MarkdownStoreError('parse', `invalid YAML front matter: ${doc.errors[0]?.message}`);
  }
  const root = doc.contents;
  if (root === null) return { span, data: {}, pairs: new Map() }; // an empty block
  if (!isMap(root)) throw new MarkdownStoreError('parse', 'front matter is not a mapping');
  const pairs = new Map<string, { start: number; end: number }>();
  for (const pair of root.items as Pair<Node, Node | null>[]) {
    if (!isScalar(pair.key) || !pair.key.range) continue;
    const key = String(pair.key.value);
    const start = span.fmStart + pair.key.range[0];
    const valueEnd = pair.value?.range ? pair.value.range[1] : undefined;
    let end: number;
    if (valueEnd === undefined) {
      // `key:` without a value: the range ends after the colon.
      const colon = fm.indexOf(':', pair.key.range[1]);
      end = span.fmStart + (colon < 0 ? pair.key.range[1] : colon + 1);
    } else {
      // A block scalar or sequence ends with its line break: stop at the last visible
      // character so the break (and any following comment line) stays where it is.
      let e = valueEnd;
      while (e > pair.key.range[1] && (fm[e - 1] === '\n' || fm[e - 1] === '\r')) e--;
      end = span.fmStart + e;
    }
    pairs.set(key, { start, end });
  }
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  return { span, data, pairs };
}

/** `key: value` (or a flow sequence for arrays) as one front-matter entry, without line break. */
export function serialiseField(key: string, value: unknown): string {
  const doc = new Document();
  doc.contents = doc.createNode({ [key]: value });
  const root = doc.contents;
  if (isMap(root) && Array.isArray(value)) {
    const seq = (root.items[0] as Pair).value;
    if (isSeq(seq)) seq.flow = true;
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/, '');
}

/** Convert `\n` in generated text to the file's line break. */
export const withEol = (text: string, eol: string): string =>
  eol === '\n' ? text : text.replace(/\n/g, eol);

/**
 * Apply field edits: a string replaces (or appends) `key: value`; `null` removes the field.
 * Fields not named are untouched byte for byte.
 */
export function editFrontMatter(text: string, edits: ReadonlyMap<string, string | null>): string {
  if (edits.size === 0) return text;
  const fm = parseFrontMatter(text);
  const { fmStart, fmEnd, eol } = fm.span;
  const replacements: { start: number; end: number; text: string }[] = [];
  let appended = '';
  for (const [key, line] of edits) {
    const at = fm.pairs.get(key);
    if (at && line !== null) {
      replacements.push({ start: at.start, end: at.end, text: withEol(line, eol) });
    } else if (at) {
      // Remove the whole line(s) of the field, including its line break.
      let start = text.lastIndexOf('\n', at.start - 1) + 1;
      let end = text.indexOf('\n', at.end);
      end = end < 0 || end >= fmEnd ? fmEnd : end + 1;
      if (end === fmEnd && start > fmStart)
        start -= eol.length; // last field: take the break before it
      else if (end === fmEnd) end += eol.length; // the only field: leave an empty block
      replacements.push({ start, end, text: '' });
    } else if (line !== null) {
      appended += (fmEnd === fmStart && appended === '' ? '' : eol) + withEol(line, eol);
    }
  }
  if (appended) {
    // In an empty block the closing fence follows directly, so the new lines need their own break.
    const tail = fmEnd === fmStart ? eol : '';
    replacements.push({ start: fmEnd, end: fmEnd, text: appended + tail });
  }
  replacements.sort((a, b) => b.start - a.start);
  let out = text;
  for (const r of replacements) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

// Lexical helpers of the local rules engine: a small, deterministic, language-light matcher.
// It compares short English phrases by their content words. It does not understand negation or
// meaning; the engine says so in its documentation and keeps every use of it visible in the
// basis breakdown.

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'via',
  'into',
  'onto',
  'over',
  'that',
  'this',
  'than',
  'its',
  'also',
  'are',
  'was',
  'has',
  'have',
  'any',
  'all',
  'out',
  'off',
  'per',
  'not',
  'can',
  'may',
  'will',
  'never',
  'none',
  'neither',
  'without',
  'must',
  'should',
  'would',
  'could',
  'shall',
]);

function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Content words of a phrase: lower case, letters and digits, stop words dropped, stemmed. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

export function shared(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

/** Sørensen-Dice overlap of two token sets, in [0, 1]; 0 if either is empty. */
export function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  return (2 * shared(a, b)) / (a.size + b.size);
}

/** Share of `needle` tokens found in `haystack`, in [0, 1]; 0 if `needle` is empty. */
export function coverage(needle: ReadonlySet<string>, haystack: ReadonlySet<string>): number {
  return needle.size === 0 ? 0 : shared(needle, haystack) / needle.size;
}

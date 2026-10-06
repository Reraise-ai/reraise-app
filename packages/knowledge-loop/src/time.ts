// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Strict RFC 3339 time parsing for the verifier and the metrics (ADR-0040, ADR-0041). JSON
// Schema `date-time` admits values that `Date.parse` cannot represent (a leap second, for
// example), and `Date.parse` admits values that are not RFC 3339. Every time is parsed once
// with this function; anything it rejects is an invalid time, never a silent NaN.

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|([+-])(\d{2}):(\d{2}))$/;

/** Milliseconds since the epoch, or `undefined` when `value` is not a representable RFC 3339 time. */
export function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = RFC3339.exec(value);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return undefined;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return undefined;
  if (m[9] !== undefined && (Number(m[10]) > 23 || Number(m[11]) > 59)) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

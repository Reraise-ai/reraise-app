// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// ADR-0019 / ADR-C09: the board is styled by design tokens only. Outside
// apps/board/src/tokens.css no colour literal (hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(),
// oklch(), color(), color-mix() with literals) and no font family may appear: components use
// var(--wb-...) and the brand design system replaces token values, never components.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, walk } from './lib.mjs';

export const BOARD_DIR = 'apps/board';
export const TOKEN_FILE = 'apps/board/src/tokens.css';
const SCANNED = new Set(['.css', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.svg']);
/** Build tooling that is not shipped UI. */
const IGNORED_FILES = new Set(['apps/board/vite.config.ts']);

const RULES = [
  {
    id: 'hex-colour',
    // #rgb, #rgba, #rrggbb, #rrggbbaa; not followed by a word character.
    re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g,
    // An id selector or anchor such as "#root" or "#main-content" does not match (letters past f).
    what: 'hex colour literal',
  },
  {
    id: 'colour-function',
    re: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()/gi,
    what: 'colour function with literal values',
  },
  {
    id: 'font-family',
    re: /\bfont-family\s*:(?!\s*(?:inherit|var\())|\bfontFamily\s*:(?!\s*['"]?(?:inherit|var\())|(?:^|[\s;{"'])font\s*:(?!\s*(?:inherit|var\())/gim,
    what: 'font-family (or font shorthand) outside tokens',
  },
];

/** Findings in one text: [{ rule, what, line, text }]. Comments are scanned too on purpose. */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) {
        findings.push({ rule: rule.id, what: rule.what, line: i + 1, text: line.trim() });
      }
    }
  });
  return findings;
}

/** Scan every board source file except the token file. Returns [{ file, ...finding }]. */
export function checkBoardTokens(repoRoot) {
  const dir = path.join(repoRoot, BOARD_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of walk(dir)) {
    const rel = toPosix(path.relative(repoRoot, file));
    if (rel === TOKEN_FILE || IGNORED_FILES.has(rel)) continue;
    if (!SCANNED.has(path.extname(file))) continue;
    for (const f of scanText(readFileSync(file, 'utf8'))) out.push({ file: rel, ...f });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const findings = checkBoardTokens(root);
  if (findings.length > 0) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.what}: ${f.text}`);
    console.error(
      `\ncheck:board-tokens failed: ${findings.length} finding(s). Use a var(--wb-...) token; raw colours and fonts live in ${TOKEN_FILE} only (ADR-0019).`,
    );
    process.exit(1);
  }
  console.log('check:board-tokens: ok (no colour or font literal outside tokens.css)');
}

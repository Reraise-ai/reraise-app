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

const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray ' +
    'green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
    'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna ' +
    'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
    'tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Properties whose value is (or contains) a colour, in CSS and in camelCase style objects. */
const COLOUR_PROPERTY =
  '(?:color|background(?:-color|Color|-image|Image)?|background|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:color|start|end))?)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:-color|Color)?|fill|stroke|box-shadow|boxShadow|text-shadow|textShadow|caret-color|caretColor|accent-color|accentColor|column-rule(?:-color)?|text-decoration(?:-color)?|textDecoration(?:Color)?|stop-color|stopColor|flood-color|floodColor|lighting-color|lightingColor)';

const DECLARATION = new RegExp(
  `(?:^|[\\s{;,"'])${COLOUR_PROPERTY}\\s*:\\s*['"\`]?([^;}\\n]*)`,
  'gi',
);
const COLOUR_ATTRIBUTE =
  /\b(?:fill|stroke|color|stopColor|floodColor|lightingColor|stop-color|flood-color)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*)['"`]\s*\})/g;
/** Values that are not a colour literal. */
const NEUTRAL = /^(?:none|transparent|currentcolor|inherit|initial|unset|revert|auto)$/i;

/** Named colours in a value, after the parts that cannot hold a literal colour are removed. */
function namedColoursIn(value) {
  const stripped = value
    .replace(/var\([^)]*\)/gi, ' ')
    .replace(/url\([^)]*\)/gi, ' ')
    .replace(/--[\w-]+/g, ' ');
  return (stripped.match(/[a-z]+/gi) ?? []).filter(
    (w) => NAMED_COLOURS.has(w.toLowerCase()) && !NEUTRAL.test(w),
  );
}

function colourMixHasLiteral(line) {
  for (const m of line.matchAll(/color-mix\(/gi)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < line.length; i++) {
      if (line[i] === '(') depth++;
      if (line[i] === ')' && --depth === 0) break;
    }
    const inner = line
      .slice(start, i)
      .replace(/var\([^)]*\)/gi, ' ')
      .replace(/\bin\s+[a-z0-9-]+(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/gi, ' ')
      .replace(/[\d.]+%/g, ' ')
      .replace(/\btransparent\b/gi, ' ');
    if (/[a-z0-9#]/i.test(inner.replace(/[\s,]/g, ''))) return true;
  }
  return false;
}

const RULES = [
  {
    id: 'hex-colour',
    // #rgb, #rgba, #rrggbb, #rrggbbaa; not followed by a word character.
    re: /(?<!url\()(?<!href=["'])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g,
    // An id selector or anchor such as "#root", "#main-content", "url(#arrow)" or href="#abc"
    // is not a colour.
    what: 'hex colour literal',
  },
  {
    id: 'data-uri-colour',
    // A colour in a data URI: %23rrggbb.
    re: /%23(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g,
    what: 'hex colour literal in a data URI (%23...)',
  },
  {
    id: 'concatenated-hex',
    // '#' + digits, `#${hex}`: a colour built from parts.
    re: /(?:['"]#['"]\s*\+)|(?:`#\$\{)/g,
    what: 'colour assembled from a "#" string',
  },
  {
    id: 'colour-function',
    re: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()/gi,
    what: 'colour function with literal values',
  },
  {
    id: 'color-mix',
    test: colourMixHasLiteral,
    what: 'color-mix() with a literal colour (mix var() tokens only)',
  },
  {
    id: 'named-colour',
    test: (line) => {
      DECLARATION.lastIndex = 0;
      for (const m of line.matchAll(DECLARATION)) if (namedColoursIn(m[1]).length > 0) return true;
      return false;
    },
    what: 'named colour in a colour property',
  },
  {
    id: 'colour-attribute',
    test: (line) => {
      COLOUR_ATTRIBUTE.lastIndex = 0;
      for (const m of line.matchAll(COLOUR_ATTRIBUTE)) {
        const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
        if (NEUTRAL.test(value) || /^var\(/i.test(value) || /^url\(/i.test(value)) continue;
        return true;
      }
      return false;
    },
    what: 'colour literal in a fill, stroke or colour attribute',
  },
  {
    id: 'font-family',
    // font-family: ..., fontFamily: ..., font-family="..." and fontFamily="..." (attributes), and the
    // font shorthand with a family.
    re: /\bfont-?family\s*[:=](?!\s*\{?\s*['"]?(?:inherit|var\())|(?:^|[\s;{"'])font\s*:(?!\s*(?:inherit|var\())/gim,
    what: 'font-family (or font shorthand) outside tokens',
  },
];

/** Findings in one text: [{ rule, what, line, text }]. Comments are scanned too on purpose. */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      let hit;
      if (rule.test) hit = rule.test(line);
      else {
        rule.re.lastIndex = 0;
        hit = rule.re.test(line);
      }
      if (hit) findings.push({ rule: rule.id, what: rule.what, line: i + 1, text: line.trim() });
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

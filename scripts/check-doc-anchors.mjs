// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
// Verifies that every in-site link in the built docs points at an existing page and, when it has a
// #fragment, at an existing id.
// Run after `pnpm docs:build`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/Worldbuilder/';

function walkHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

export function collectIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Returns [{file, href, reason}] for in-site links whose target page is missing, and for
 * #fragments that have no matching id on the target page.
 */
export function findBrokenAnchors(distDir) {
  const pages = new Map();
  const files = walkHtml(distDir);
  for (const f of files) pages.set(path.resolve(f), readFileSync(f, 'utf8'));
  const broken = [];
  for (const [file, html] of pages) {
    for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue; // external link or other scheme
      const hash = href.indexOf('#');
      let pathname = hash === -1 ? href : href.slice(0, hash);
      const fragment = hash === -1 ? '' : decodeURIComponent(href.slice(hash + 1));
      pathname = pathname.split('?')[0];
      let target;
      if (pathname === '') target = file;
      else {
        pathname = pathname.startsWith(BASE)
          ? pathname.slice(BASE.length)
          : path.posix.join(
              path.relative(distDir, path.dirname(file)).split(path.sep).join('/'),
              pathname,
            );
        const candidates = [
          path.join(distDir, pathname),
          path.join(distDir, pathname + '.html'),
          path.join(distDir, pathname, 'index.html'),
        ];
        target = candidates.find((c) => existsSync(c) && statSync(c).isFile());
        if (!target) {
          broken.push({ file: path.relative(distDir, file), href, reason: 'missing page' });
          continue;
        }
      }
      if (!fragment) continue;
      const targetHtml = pages.get(path.resolve(target));
      if (targetHtml && !collectIds(targetHtml).has(fragment)) {
        broken.push({ file: path.relative(distDir, file), href, reason: 'missing anchor' });
      }
    }
  }
  return broken;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? 'docs/.vitepress/dist');
  if (!existsSync(dist)) {
    console.error(`check:doc-anchors: ${dist} not found. Run pnpm docs:build first.`);
    process.exit(1);
  }
  const broken = findBrokenAnchors(dist);
  for (const b of broken) console.error(`${b.reason} in ${b.file}: ${b.href}`);
  if (broken.length > 0) process.exit(1);
  console.log('check:doc-anchors ok');
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Serves the demo build so /board/ is the app. Asset URLs in that build start with /board/.

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

/** Serves `dir` (the demo outDir) at /board/ on 127.0.0.1. */
export function serveDemo(dir: string): Promise<{ server: Server; port: number }> {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/board') pathname = '/board/';
        if (!pathname.startsWith('/board/')) {
          res.writeHead(404);
          res.end();
          return;
        }
        let rel = pathname.slice('/board/'.length);
        if (rel === '' || rel.endsWith('/')) rel += 'index.html';
        if (rel.split('/').includes('..')) {
          res.writeHead(403);
          res.end();
          return;
        }
        const abs = path.resolve(root, ...rel.split('/'));
        if (abs !== root && !abs.startsWith(root + path.sep)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const body = await readFile(abs);
        const type = TYPES[path.extname(abs)] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(body);
      } catch {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('demo server has no port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

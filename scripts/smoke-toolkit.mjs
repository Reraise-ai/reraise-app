// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The newcomer path on a packed toolkit, outside the repository: unzip into a fresh folder,
// `node services/api/dist/cli.js serve --init` on a store that does not exist yet, then the board at `/`,
// liveness, and the starter world with the printed session token. Exits 1 on any miss.
//   node scripts/smoke-toolkit.mjs dist/reraise-toolkit-<version>.zip

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const zip = process.argv[2];
if (!zip) throw new Error('usage: node scripts/smoke-toolkit.mjs <toolkit zip>');
const work = mkdtempSync(path.join(tmpdir(), 'reraise-toolkit-'));
const app = path.join(work, 'app');
execFileSync('unzip', ['-q', path.resolve(zip), '-d', app]);

const port = await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port: p } = /** @type {import('node:net').AddressInfo} */ (server.address());
    server.close(() => resolve(p));
  });
});
const args = ['serve', '--init', '--store', path.join(work, 'my-world'), '--port', String(port)];
const child = spawn(
  process.execPath,
  ['services/api/dist/cli.js', ...args, '--state', path.join(work, 'state')],
  {
    cwd: app,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
let log = '';
const line = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no start line within 30 s:\n${log}`)), 30_000);
  child.stdout.on('data', (chunk) => {
    log += chunk;
    const m = /Session token: (\S+) {2}Open (http:\/\/\S+) in your browser/.exec(log);
    if (m) {
      clearTimeout(timer);
      resolve({ token: m[1], url: m[2] });
    }
  });
  child.once('exit', (code) => reject(new Error(`serve exited (${code}):\n${log}`)));
});

try {
  const page = await fetch(`${line.url}/`);
  const html = await page.text();
  if (page.status !== 200 || !html.includes('<div id="root">')) {
    throw new Error(`GET / answered ${page.status} without the board`);
  }
  const health = await fetch(`${line.url}/health`);
  if (health.status !== 200) throw new Error(`GET /health answered ${health.status}`);
  const res = await fetch(`${line.url}/worlds`, {
    headers: { 'x-worldbuilder-session': line.token },
  });
  const { worlds } = /** @type {{ worlds: { name: string }[] }} */ (await res.json());
  if (worlds.map((w) => w.name).join() !== 'My world') {
    throw new Error(`GET /worlds answered ${res.status}: ${JSON.stringify(worlds)}`);
  }
  console.log(`toolkit ok: ${line.url}/ serves the board, /health ok, worlds: My world`);
} finally {
  child.removeAllListeners('exit');
  await new Promise((resolve) => child.once('exit', resolve).kill());
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

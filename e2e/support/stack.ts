// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Global setup of the M1 e2e: a temporary copy of the synthetic Hormuz store, a temporary state
// directory with gate rules, two registered test agents, the built `worldbuilder serve` on a free
// loopback port and the built board served by `vite preview` next to it. Nothing here touches
// the repository or a real user state directory.

import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import type { E2eEnv } from './support/env.js';
import { E2E_GATE_RULES } from './support/gate-rules.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'services', 'api', 'dist', 'cli.js');
const boardRoot = path.join(repoRoot, 'apps', 'board');

/** A free loopback port: bind port 0, read it, release it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Runs the built CLI to the end; its output is returned for the error message. */
function runCli(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`worldbuilder ${args[0]} failed (${code}):\n${out}`)),
    );
  });
}

/** Starts `worldbuilder serve` and resolves when it printed that it listens (and its log). */
function startService(args: string[]): Promise<{ child: ChildProcess; log: () => string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'serve', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`worldbuilder serve did not start within 30 s:\n${out}`));
    }, 30_000);
    const onData = (c: Buffer) => {
      out += c.toString('utf8');
      if (out.includes('Session token')) {
        clearTimeout(timer);
        resolve({ child, log: () => out });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worldbuilder serve exited early (${code}):\n${out}`));
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(cli) || !existsSync(path.join(boardRoot, 'dist', 'index.html'))) {
    throw new Error('The service and the board are not built. Run `pnpm build` first.');
  }
  const work = await mkdtemp(path.join(tmpdir(), 'wb-e2e-'));
  const storeDir = path.join(work, 'store');
  const stateDir = path.join(work, 'state');
  const tokensDir = path.join(work, 'tokens');
  await cp(path.join(repoRoot, 'examples', 'hormuz'), storeDir, { recursive: true });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await mkdir(tokensDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(stateDir, 'gate-rules.yaml'), E2E_GATE_RULES);

  const agents = {
    local: { name: 'e2e-local-agent', tokenFile: path.join(tokensDir, 'local.token') },
    cloud: { name: 'e2e-cloud-agent', tokenFile: path.join(tokensDir, 'cloud.token') },
  };
  await runCli([
    'agent',
    'add',
    agents.local.name,
    '--target',
    'local_model',
    '--state',
    stateDir,
    '--token-file',
    agents.local.tokenFile,
  ]);
  await runCli([
    'agent',
    'add',
    agents.cloud.name,
    '--target',
    'cloud_model',
    '--state',
    stateDir,
    '--token-file',
    agents.cloud.tokenFile,
  ]);

  const servicePort = await freePort();
  let boardPort = await freePort();
  while (boardPort === servicePort) boardPort = await freePort();
  const serviceUrl = `http://127.0.0.1:${servicePort}`;
  const boardUrl = `http://127.0.0.1:${boardPort}`;

  const board = await preview({
    root: boardRoot,
    configFile: path.join(boardRoot, 'vite.config.ts'),
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: boardPort, strictPort: true, open: false },
  });
  const service = await startService([
    '--store',
    storeDir,
    '--state',
    stateDir,
    '--port',
    String(servicePort),
    '--host',
    '127.0.0.1',
    '--allow-origin',
    boardUrl,
  ]);

  const sessionToken = (await readFile(path.join(stateDir, 'session-token'), 'utf8')).trim();
  const env: E2eEnv = { serviceUrl, boardUrl, storeDir, stateDir, sessionToken, agents };
  const envFile = path.join(work, 'env.json');
  await writeFile(envFile, JSON.stringify(env), { mode: 0o600 });
  process.env['WB_E2E_ENV'] = envFile;

  return async () => {
    await stop(service.child);
    await board.close();
    if (process.env['WB_E2E_KEEP'] === '1') {
      console.log(`e2e work directory kept: ${work}`);
      return;
    }
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
}

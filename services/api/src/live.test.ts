// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Two open boards hear a saved Lage and an agent proposal over the live channel (ADR-0032).
// The stream carries the kind and the Lage id, never card text.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await makeFixture({ listen: true });
});
afterAll(async () => {
  await f.close();
});

interface Heard {
  kind: string;
  lageId?: string;
}

/** One open board. `ready` resolves after the handshake, so a later notice is not missed. */
function openBoard(lageId?: string): {
  ready: Promise<void>;
  next(kind: string, timeoutMs?: number): Promise<Heard>;
  close(): void;
} {
  const ac = new AbortController();
  const heard: Heard[] = [];
  let wake: (() => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    const path = lageId === undefined ? '/events' : `/events?lageId=${encodeURIComponent(lageId)}`;
    void fetch(new URL(path, f.url), {
      headers: { 'x-worldbuilder-session': f.service.sessionToken, accept: 'text/event-stream' },
      signal: ac.signal,
    })
      .then(async (res) => {
        if (res.status !== 200 || !res.body) {
          reject(new Error(`events ${res.status}`));
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) return;
            buf += dec.decode(chunk.value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
              const block = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              const data = block
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n');
              if (!data) continue;
              const notice = JSON.parse(data) as Heard;
              if (notice.kind === 'ready') resolve();
              heard.push(notice);
              wake?.();
            }
          }
        } catch (e) {
          if (!ac.signal.aborted) reject(e as Error);
        }
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) reject(e as Error);
      });
  });
  return {
    ready,
    next(kind: string, timeoutMs = 3000) {
      const found = () => heard.find((notice) => notice.kind === kind);
      const already = found();
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${kind}`)), timeoutMs);
        wake = () => {
          const notice = found();
          if (!notice) return;
          clearTimeout(timer);
          resolve(notice);
        };
      });
    },
    close() {
      ac.abort();
    },
  };
}

async function call(
  method: string,
  path: string,
  token: { session?: string; bearer?: string },
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token.session) headers['x-worldbuilder-session'] = token.session;
  if (token.bearer) headers['authorization'] = `Bearer ${token.bearer}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(new URL(path, f.url), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : undefined };
}

describe('live channel (ADR-0032)', () => {
  it('shows one move and one agent proposal on two open boards, and not on another Lage', async () => {
    const left = openBoard();
    const right = openBoard();
    const other = openBoard('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    await Promise.all([left.ready, right.ready, other.ready]);

    const created = await call(
      'POST',
      '/proposals',
      { bearer: f.tokens['scripted'] },
      {
        kind: 'place_card',
        payload: { lageId: f.ids.lage, cardId: f.ids.evLoose, x: 10, y: 20 },
        rationale: 'Synthetic rationale that must stay off the stream.',
      },
    );
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.json)).toContain('Synthetic rationale');

    const [fromLeft, fromRight] = await Promise.all([
      left.next('proposal'),
      right.next('proposal'),
    ]);
    expect(fromLeft).toEqual({ kind: 'proposal', lageId: f.ids.lage });
    expect(fromRight).toEqual(fromLeft);
    expect(JSON.stringify(fromLeft)).not.toContain('Synthetic');

    const saved = await call('GET', `/lagen/${f.ids.lage}`, { session: f.service.sessionToken });
    expect(saved.status).toBe(200);
    const lage = (saved.json as { lage: { version: number; question: string } }).lage;
    const put = await call(
      'PUT',
      `/lagen/${f.ids.lage}`,
      { session: f.service.sessionToken },
      { ...lage, question: 'Which option now?', version: lage.version + 1 },
    );
    expect(put.status).toBe(200);

    const move = await left.next('move');
    expect(move).toEqual({ kind: 'move', lageId: f.ids.lage });
    expect(await right.next('move')).toEqual(move);
    await expect(other.next('move', 200)).rejects.toThrow(/no move/);
    await expect(other.next('proposal', 200)).rejects.toThrow(/no proposal/);

    left.close();
    right.close();
    other.close();
  });
});

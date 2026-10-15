// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { openLiveChannel, readNotices } from './liveChannel.js';

function chunks(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('live channel reader', () => {
  it('reports a move and a proposal and ignores the handshake and a bad block', async () => {
    const got: unknown[] = [];
    await readNotices(
      chunks(
        [
          'event: ready\ndata: {"kind":"ready"}\n\n',
          'data: not-json\n\n',
          'event: move\ndata: {"kind":"move","lageId":"L1"}\n\n',
          ': keep-alive\n\n',
          'event: proposal\ndata: {"kind":"proposal"}\n\n',
        ].join(''),
      ),
      (notice) => got.push(notice),
    );
    expect(got).toEqual([{ kind: 'move', lageId: 'L1' }, { kind: 'proposal' }]);
  });

  it('pauses callers while the stream is up and resumes when it ends', async () => {
    let push: (text: string) => void = () => {};
    let end: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        push = (text) => controller.enqueue(enc.encode(text));
        end = () => controller.close();
      },
    });
    const states: string[] = [];
    const notices: string[] = [];
    const channel = openLiveChannel({
      open: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      onUp: () => states.push('up'),
      onDown: () => states.push('down'),
      onNotice: (notice) => notices.push(notice.kind),
      retryMs: 60_000,
    });
    await viWait(() => states.includes('up'));
    push('event: proposal\ndata: {"kind":"proposal","lageId":"L1"}\n\n');
    await viWait(() => notices.includes('proposal'));
    end();
    await viWait(() => states.includes('down'));
    channel.close();
    expect(notices).toEqual(['proposal']);
  });

  it('stops the reader when the caller closes, so a later chunk is ignored', async () => {
    let push: (text: string) => void = () => {};
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        push = (text) => controller.enqueue(enc.encode(text));
      },
      cancel() {
        cancelled = true;
      },
    });
    const states: string[] = [];
    const notices: string[] = [];
    const channel = openLiveChannel({
      open: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      onUp: () => states.push('up'),
      onDown: () => states.push('down'),
      onNotice: (notice) => notices.push(notice.kind),
      retryMs: 60_000,
    });
    await viWait(() => states.includes('up'));
    channel.close();
    await viWait(() => cancelled);
    try {
      push('event: move\ndata: {"kind":"move"}\n\n');
    } catch {
      // The stream is already cancelled.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(notices).toEqual([]);
    expect(states).toEqual(['up']);
  });

  it('treats a non-stream answer as down and does not call up', async () => {
    const states: string[] = [];
    const channel = openLiveChannel({
      open: async () =>
        new Response('{}', {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        }),
      onUp: () => states.push('up'),
      onDown: () => states.push('down'),
      onNotice: () => {},
      retryMs: 60_000,
    });
    await viWait(() => states.includes('down'));
    channel.close();
    expect(states).toEqual(['down']);
  });
});

async function viWait(ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > 1000) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The board's side of the live channel (ADR-0032). A dropped stream is the caller's signal
// to poll again. The notices carry no card text.

export interface LiveNotice {
  readonly kind: 'proposal' | 'move';
  readonly lageId?: string;
}

export interface LiveChannelOptions {
  open(signal: AbortSignal): Promise<Response>;
  /** The stream is up. Stop the poll interval. */
  onUp(): void;
  /** The stream is down. Poll until it returns. */
  onDown(): void;
  onNotice(notice: LiveNotice): void;
  /** Wait before opening the stream again. Default 2 s. */
  retryMs?: number;
}

/** Read SSE blocks and report proposal and move notices. Other events are ignored. */
export async function readNotices(
  body: ReadableStream<Uint8Array>,
  onNotice: (notice: LiveNotice) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  // Aborting the fetch does not stop a body that is already being read.
  const stop = () => void reader.cancel().catch(() => undefined);
  if (signal?.aborted) {
    stop();
    return;
  }
  signal?.addEventListener('abort', stop, { once: true });
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
        let parsed: { kind?: unknown; lageId?: unknown };
        try {
          parsed = JSON.parse(data) as { kind?: unknown; lageId?: unknown };
        } catch {
          continue;
        }
        if (parsed.kind !== 'proposal' && parsed.kind !== 'move') continue;
        onNotice({
          kind: parsed.kind,
          ...(typeof parsed.lageId === 'string' ? { lageId: parsed.lageId } : {}),
        });
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

export function openLiveChannel(options: LiveChannelOptions): { close(): void } {
  const retryMs = options.retryMs ?? 2000;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const run = async (): Promise<void> => {
    if (closed) return;
    controller = new AbortController();
    try {
      const res = await options.open(controller.signal);
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !res.body || !type.includes('text/event-stream')) {
        throw new Error('no event stream');
      }
      if (closed) return;
      options.onUp();
      await readNotices(
        res.body,
        (notice) => {
          if (!closed) options.onNotice(notice);
        },
        controller.signal,
      );
    } catch {
      // A close() aborts the read. That is not a drop.
    }
    if (closed) return;
    options.onDown();
    timer = setTimeout(() => void run(), retryMs);
  };

  void run();
  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      controller?.abort();
    },
  };
}

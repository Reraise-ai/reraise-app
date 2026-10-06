// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GateLog, formatGateLogLine } from './gate-log.js';
import { CARD_A, CARD_B, tempDir } from './test-helpers.js';

const entry = (n: number) => ({
  cardId: n % 2 ? CARD_A : CARD_B,
  item: 'card' as const,
  target: 'cloud_model' as const,
  decision: 'deny' as const,
  reason: 'default_deny' as const,
  at: '2026-10-06T10:00:00.000Z',
});

const lines = async (file: string) =>
  (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('gate log', () => {
  it('appends JSON lines with exactly the permitted fields', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'gate-log.jsonl');
    const log = new GateLog(file, { now: () => new Date('2026-10-06T12:00:00.000Z') });
    await log.append({
      cardId: CARD_A,
      item: 'stance',
      target: 'screen',
      decision: 'allow',
      reason: 'stance_screen_only',
      ruleId: 'screen-all',
    });
    await log.append(entry(2));
    const rows = await lines(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      at: '2026-10-06T12:00:00.000Z',
      cardId: CARD_A,
      item: 'stance',
      target: 'screen',
      decision: 'allow',
      reason: 'stance_screen_only',
      ruleId: 'screen-all',
    });
    expect(Object.keys(rows[1]!).sort()).toEqual([
      'at',
      'cardId',
      'decision',
      'item',
      'reason',
      'target',
    ]);
  });

  it('never contains card content: extra fields are dropped; free text in any field is refused', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'gate-log.jsonl');
    const log = new GateLog(file);
    const MARKER = 'SECRET-MARKER-TEXT';
    await log.append({
      ...entry(1),
      title: MARKER,
      body: MARKER,
      card: { body: MARKER },
    } as never);
    for (const patch of [
      { reason: MARKER },
      { ruleId: MARKER },
      { at: MARKER },
      { at: `2026-10-06T10:00:00Z ${MARKER}` },
    ]) {
      await expect(log.append({ ...entry(1), ...patch } as never)).rejects.toMatchObject({
        code: 'invalid',
      });
    }
    expect(await readFile(file, 'utf8')).not.toContain(MARKER);
    expect(await lines(file)).toHaveLength(1);
  });

  it('accepts ISO 8601 UTC times only', () => {
    const ok = (at: string) => formatGateLogLine(entry(1), at);
    expect(() => ok('2026-10-06T10:00:00Z')).not.toThrow();
    expect(() => ok('2026-10-06T10:00:00.5Z')).not.toThrow();
    for (const bad of [
      '2026-10-06T10:00:00+02:00',
      '2026-10-06',
      '2026-10-06 10:00:00Z',
      '2026-13-45T99:00:00Z',
      'x',
    ]) {
      expect(() => ok(bad), bad).toThrow('ISO 8601');
    }
  });

  it('records the deciding rule id and only fixed reason codes', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'gate-log.jsonl');
    const log = new GateLog(file);
    await log.append({ ...entry(1), reason: 'rule_deny', ruleId: 'never-class-a' });
    expect((await lines(file))[0]).toMatchObject({ reason: 'rule_deny', ruleId: 'never-class-a' });
    await expect(
      log.append({ ...entry(1), reason: 'default deny' } as never),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(log.append({ ...entry(1), ruleId: 'Bad Id' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('rejects malformed entries instead of logging them', () => {
    const bad = (patch: object) => () =>
      formatGateLogLine({ ...entry(1), ...patch } as never, 'now');
    expect(bad({ cardId: 'not an id' })).toThrow('card id');
    expect(bad({ target: 'moon' })).toThrow('target');
    expect(bad({ decision: 'maybe' })).toThrow('decision');
    expect(bad({ item: 'body' })).toThrow('item');
  });

  it('validates its limits', () => {
    expect(() => new GateLog('x', { maxBytes: 0 })).toThrow('maxBytes');
    expect(() => new GateLog('x', { keep: -1 })).toThrow('keep');
  });

  describe('rotation', () => {
    const lineSize = Buffer.byteLength(formatGateLogLine(entry(1), entry(1).at));

    it('rotates when the next line would exceed the limit and keeps the configured number of files', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'gate-log.jsonl');
      // room for exactly three lines per file
      const log = new GateLog(file, { maxBytes: lineSize * 3, keep: 2 });
      for (let i = 0; i < 20; i++) await log.append(entry(i));
      const names = (await readdir(dir)).sort();
      expect(names).toEqual(['gate-log.jsonl', 'gate-log.jsonl.1', 'gate-log.jsonl.2']);
      for (const n of names)
        expect((await stat(path.join(dir, n))).size).toBeLessThanOrEqual(lineSize * 3);
      const total = [file, file + '.1', file + '.2'];
      const counts = await Promise.all(total.map(async (f) => (await lines(f)).length));
      expect(counts).toEqual([2, 3, 3]);
    });

    it('keeps order: .1 holds older lines than the live file', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'gate-log.jsonl');
      const sized = Buffer.byteLength(
        formatGateLogLine({ ...entry(1), ruleId: 'n1' }, entry(1).at),
      );
      const log = new GateLog(file, { maxBytes: sized * 2, keep: 5 });
      for (let i = 0; i < 5; i++) {
        await log.append({ ...entry(i), ruleId: `n${i}` });
      }
      const ruleIds = async (f: string) => (await lines(f)).map((r) => String(r.ruleId));
      expect(await ruleIds(file + '.2')).toEqual(['n0', 'n1']);
      expect(await ruleIds(file + '.1')).toEqual(['n2', 'n3']);
      expect(await ruleIds(file)).toEqual(['n4']);
    });

    it('default limits are 10 MB and 5 files', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'gate-log.jsonl');
      await writeFile(file, 'x'.repeat(10 * 1024 * 1024 - 10));
      const log = new GateLog(file);
      await log.append(entry(1)); // would exceed 10 MiB -> rotates
      expect((await readdir(dir)).sort()).toEqual(['gate-log.jsonl', 'gate-log.jsonl.1']);
      for (let i = 0; i < 12; i++) {
        await writeFile(file, 'x'.repeat(10 * 1024 * 1024 - 10));
        await log.append(entry(i));
      }
      expect((await readdir(dir)).sort()).toEqual([
        'gate-log.jsonl',
        'gate-log.jsonl.1',
        'gate-log.jsonl.2',
        'gate-log.jsonl.3',
        'gate-log.jsonl.4',
        'gate-log.jsonl.5',
      ]);
    });

    it('keep = 0 discards the old file instead of keeping rotated copies', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'gate-log.jsonl');
      const log = new GateLog(file, { maxBytes: lineSize, keep: 0 });
      await log.append(entry(1));
      await log.append(entry(2));
      expect(await readdir(dir)).toEqual(['gate-log.jsonl']);
      expect(await lines(file)).toHaveLength(1);
    });

    it('does not lose or interleave lines under concurrent appends', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'gate-log.jsonl');
      const log = new GateLog(file, { maxBytes: lineSize * 7, keep: 50 });
      await Promise.all(Array.from({ length: 100 }, (_, i) => log.append(entry(i))));
      let total = 0;
      for (const name of await readdir(dir)) total += (await lines(path.join(dir, name))).length;
      expect(total).toBe(100);
    });
  });
});

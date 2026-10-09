// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStateDir } from '@worldbuilder/local-state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, parseTaskRecord, runCli } from './cli.js';
import { RECEIPT_LOG_FILE } from './log.js';
import { AGENT, consult, iso, logOf, taskOf, ulid, writeBack } from './test-helpers.js';
import { validateContract } from './validate.js';

const HORMUZ = fileURLToPath(new URL('../../../examples/hormuz', import.meta.url));
const NOW = () => new Date('2026-10-06T12:00:00.000Z');

let dir: string;
let out: string[];
let err: string[];
const io = () => ({
  stdout: (t: string) => out.push(t),
  stderr: (t: string) => err.push(t),
  env: { XDG_STATE_HOME: path.join(dir, 'xdg'), LOCALAPPDATA: path.join(dir, 'localappdata') },
  homedir: path.join(dir, 'home'),
  now: NOW,
});
const run = (...argv: string[]) => runCli(argv, io());

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wb-cli-'));
  out = [];
  err = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const k = consult(1, { taskRef: 'TASK-A', at: iso(5) });
const w = writeBack(2, { taskRef: 'TASK-A', at: iso(50), consultReceiptId: k.receiptId });

async function writeLog(lines: string[], file = path.join(dir, 'receipts.jsonl')) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, lines.map((l) => `${l}\n`).join(''));
  return file;
}

async function writeTasks(records: object[], markdown = false) {
  const tasks = path.join(dir, 'tasks');
  await mkdir(tasks, { recursive: true });
  for (const [i, r] of records.entries()) {
    if (markdown) {
      const yaml = JSON.stringify(r); // JSON is valid YAML
      await writeFile(path.join(tasks, `task-${i}.md`), `---\n${yaml}\n---\n\nHand-off notes.\n`);
    } else {
      await writeFile(path.join(tasks, `task-${i}.json`), JSON.stringify(r));
    }
  }
  return tasks;
}

describe('wb receipts verify (ADR-0040)', () => {
  it('exits 0 when every task record has valid receipts (JSON and Markdown)', async () => {
    const log = await writeLog(logOf([k, w]));
    const tasks = await writeTasks([taskOf('TASK-A', k, w)], true);
    expect(await run('receipts', 'verify', tasks, '--log', log)).toBe(EXIT.ok);
    expect(out.join('')).toContain('ok    TASK-A agent:scout');
    expect(out.join('')).toContain('1 of 1 task records have valid receipts');
  });

  it('reports pending write-back entries of a task without failing it (ADR-0046)', async () => {
    const log = await writeLog(logOf([k, w]));
    const ids = ['01M1KM00000000000000000003', '01M1KM00000000000000000004'];
    const tasks = await writeTasks([{ ...taskOf('TASK-A', k, w), pendingWriteBack: ids }]);
    expect(await run('receipts', 'verify', tasks, '--log', log)).toBe(EXIT.ok);
    expect(out.join('')).toContain(`PENDING TASK-A: 2 memory write(s) not yet offered`);
    expect(out.join('')).toContain(ids[0]);
    out = [];
    await run('receipts', 'verify', tasks, '--log', log, '--json');
    expect(JSON.parse(out.join('')).pendingWriteBack).toEqual([
      { taskRef: 'TASK-A', outboxIds: ids },
    ]);
  });

  it('exits 1 when a task record fails, naming slot and code', async () => {
    const log = await writeLog(logOf([k, w]));
    const tasks = await writeTasks([
      taskOf('TASK-A', k, w),
      taskOf('TASK-B', undefined, undefined),
    ]);
    expect(await run('receipts', 'verify', tasks, '--log', log)).toBe(EXIT.failed);
    expect(out.join('')).toContain(
      'FAIL  TASK-B agent:scout: knowledge missing, write_back missing',
    );
  });

  it('exits 1 for a task record whose time cannot be represented (a leap second)', async () => {
    const log = await writeLog(logOf([k, w]));
    const tasks = await writeTasks([
      taskOf('TASK-A', k, w, { completedAt: '2026-10-05T23:59:60Z' }),
    ]);
    expect(await run('receipts', 'verify', tasks, '--log', log)).toBe(EXIT.failed);
    expect(out.join('')).toContain('FAIL  TASK-A agent:scout: task invalid_time');
  });

  it('exits 3 when the log is broken, and reads the default log in the state directory', async () => {
    // The per-OS default (XDG on Linux, Application Support on macOS, LOCALAPPDATA on Windows).
    const defaultDir = resolveStateDir({ ...io(), homedir: path.join(dir, 'home') });
    await writeLog([logOf([k, w])[1]!], path.join(defaultDir, RECEIPT_LOG_FILE));
    const tasks = await writeTasks([taskOf('TASK-A', k, w)]);
    expect(await run('receipts', 'verify', tasks)).toBe(EXIT.logBroken);
    expect(out.join('')).toContain('LOG BROKEN');
  });

  it('exits 3 on a head mismatch and reports JSON', async () => {
    const log = await writeLog(logOf([k, w]));
    const tasks = await writeTasks([taskOf('TASK-A', k, w)]);
    const code = await run(
      'receipts',
      'verify',
      tasks,
      '--log',
      log,
      '--json',
      '--head',
      `sha256:${'0'.repeat(64)}`,
    );
    expect(code).toBe(EXIT.logBroken);
    const report = JSON.parse(out.join(''));
    expect(report.chain.problems[0].code).toBe('head_mismatch');
  });

  it('treats a missing log as empty: every receipt is unknown', async () => {
    const tasks = await writeTasks([taskOf('TASK-A', k, w)]);
    expect(
      await run('receipts', 'verify', tasks, '--log', path.join(dir, 'none.jsonl'), '--json'),
    ).toBe(EXIT.failed);
    expect(JSON.parse(out.join('')).tasks[0].problems[0].code).toBe('unknown');
  });

  it.each([
    ['no task path', []],
    ['an unknown option', ['tasks', '--bogus']],
    ['a path that does not exist', ['/no/such/dir']],
    ['a bad head', ['tasks', '--head', 'abc']],
    ['a negative maximum age', ['tasks', '--max-age-hours', '-1']],
  ])('exits 2 for %s', async (_name, args) => {
    await writeTasks([taskOf('TASK-A', k, w)]);
    const argv = args.map((a) => (a === 'tasks' ? path.join(dir, 'tasks') : a));
    expect(await run('receipts', 'verify', ...argv)).toBe(EXIT.usage);
  });

  it('exits 2 for a file that is not a task record, and for an empty directory', async () => {
    const tasks = await writeTasks([{ taskRef: 'TASK-A', agent: AGENT }]);
    expect(await run('receipts', 'verify', tasks)).toBe(EXIT.usage);
    expect(err.join('')).toContain('not a task record');
    const empty = path.join(dir, 'empty');
    await mkdir(empty);
    expect(await run('receipts', 'verify', empty)).toBe(EXIT.usage);
  });

  it('parses task records strictly', () => {
    expect(() => parseTaskRecord('no front matter', 'a.md')).toThrow(/front matter/);
    expect(() => parseTaskRecord('{', 'a.json')).toThrow(/not JSON/);
    expect(parseTaskRecord(JSON.stringify(taskOf('TASK-A', k, w)), 'a.json').taskRef).toBe(
      'TASK-A',
    );
  });
});

const ALLOW_LOCAL =
  'rules:\n  - id: all-local\n    effect: allow\n    targets: [local_model]\n    match: {}\n';

async function store() {
  const s = path.join(dir, 'store');
  await cp(HORMUZ, s, { recursive: true });
  const rules = path.join(dir, 'gate-rules.yaml');
  await writeFile(rules, ALLOW_LOCAL);
  return { s, rules, atlas: path.join(dir, 'atlas') };
}

describe('wb digest (ADR-0043)', () => {
  it('writes pages, finds them fresh, then stale after a card changes', async () => {
    const { s, rules, atlas } = await store();
    expect(await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules)).toBe(EXIT.ok);
    const files = (await readdir(atlas)).sort();
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    for (const f of files.filter((n) => n.endsWith('.json'))) {
      const page = JSON.parse(await readFile(path.join(atlas, f), 'utf8'));
      expect(validateContract('digest-page.schema.json', page)).toEqual({ ok: true });
      expect(page.target).toBe('local_model');
    }
    const md = await readFile(
      path.join(
        atlas,
        files.find((f) => f.endsWith('.md'))!,
      ),
      'utf8',
    );
    expect(md).toMatch(/\[[0-7][0-9A-HJKMNP-TV-Z]{25}\]\(<wb:/);

    out = [];
    expect(
      await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules, '--check'),
    ).toBe(EXIT.ok);
    expect(out.join('')).toMatch(/(\d+) of \1 atlas pages are fresh/);

    const card = path.join(s, 'cards', '01-wire-report-transit-restrictions.md');
    const text = await readFile(card, 'utf8');
    await writeFile(card, text.replace(/^(title|titel): (.*)$/m, '$1: $2 (corrected)'));
    out = [];
    expect(
      await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules, '--check'),
    ).toBe(EXIT.failed);
    expect(out.join('')).toContain('1 changed');
  });

  it('treats pages the tightened rules no longer produce as stale and removes them on regeneration', async () => {
    const { s, rules, atlas } = await store();
    expect(await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules)).toBe(EXIT.ok);
    const before = (await readdir(atlas)).sort();
    expect(before.length).toBeGreaterThan(0);
    await writeFile(path.join(atlas, 'notes.md'), '# My own notes\n');
    // Tighten the rule: only cards of a world that does not exist.
    await writeFile(rules, ALLOW_LOCAL.replace('match: {}', 'match: { worlds: [Elsewhere] }'));
    out = [];
    expect(
      await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules, '--check'),
    ).toBe(EXIT.failed);
    expect(out.join('')).toMatch(/^extra +world-/m);
    out = [];
    expect(await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules)).toBe(EXIT.ok);
    expect(out.join('')).toMatch(/removed [1-9]\d* outdated/);
    expect(await readdir(atlas)).toEqual(['notes.md']);
    out = [];
    expect(
      await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules, '--check'),
    ).toBe(EXIT.ok);
  });

  it('reports missing pages and builds nothing without gate rules (default deny)', async () => {
    const { s, rules, atlas } = await store();
    expect(
      await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules, '--check'),
    ).toBe(EXIT.failed);
    expect(out.join('')).toMatch(/^missing world-/m);
    out = [];
    const none = path.join(dir, 'no-rules.yaml');
    expect(await run('digest', '--store', s, '--out', atlas, '--gate-rules', none)).toBe(EXIT.ok);
    expect(err.join('')).toContain('default deny');
    expect(out.join('')).toContain('wrote 0 atlas pages from 0 of');
  });

  it.each([['cloud_model'], ['share']])('refuses target %s with exit 2', async (target) => {
    const { s, rules } = await store();
    expect(await run('digest', '--store', s, '--gate-rules', rules, '--target', target)).toBe(
      EXIT.usage,
    );
    expect(err.join('')).toContain('refused');
  });

  it('exits 2 without a store or with an unreadable one', async () => {
    expect(await run('digest')).toBe(EXIT.usage);
    expect(
      await run('digest', '--store', path.join(dir, 'nothing'), '--out', path.join(dir, 'a')),
    ).toBe(EXIT.usage);
  });
});

describe('wb metrics (ADR-0041)', () => {
  async function setup() {
    const { s, rules, atlas } = await store();
    const log = await writeLog(logOf([k, w]));
    const tasks = await writeTasks([taskOf('TASK-A', k, w, { completedAt: iso(60) })]);
    const proposals = path.join(dir, 'proposals');
    await mkdir(proposals);
    await writeFile(
      path.join(proposals, `${ulid(70)}.json`),
      JSON.stringify({
        id: ulid(70),
        author: AGENT,
        kind: 'create_card',
        payload: { card: { format: 2, type: 'claim', title: 'Synthetic', release: 'private' } },
        status: 'pending',
        createdAt: iso(30),
      }),
    );
    await writeFile(path.join(proposals, 'damaged.json'), '{');
    await run('digest', '--store', s, '--out', atlas, '--gate-rules', rules);
    out = [];
    err = [];
    return [
      '--log',
      log,
      '--tasks',
      tasks,
      '--proposals',
      proposals,
      '--store',
      s,
      '--atlas',
      atlas,
      '--gate-rules',
      rules,
      '--now',
      '2026-10-05T12:00:00Z',
    ];
  }

  it('computes the metrics document from the files', async () => {
    const args = await setup();
    expect(await run('metrics', ...args, '--json')).toBe(EXIT.ok);
    const m = JSON.parse(out.join(''));
    expect(validateContract('usage-metrics.schema.json', m)).toEqual({ ok: true });
    expect(m.agents[0]).toMatchObject({
      agent: AGENT,
      tasks: 1,
      tasksWithReceipts: 1,
      receiptCoverage: 1,
      cardsProposed: 1,
    });
    expect(m.atlas.lagHours).toBe(0);
    expect(m.decisions.total).toBeGreaterThan(0);
    expect(err.join('')).toContain('damaged.json');
  });

  it('exits 1 with --check while a target is not met, 0 once the overrides are met', async () => {
    const args = await setup();
    expect(await run('metrics', ...args, '--check')).toBe(EXIT.failed);
    expect(out.join('')).toContain('target agent_cards_7d: 0 >= 5: NOT MET');
    const relaxed = ['agent_cards_7d=0', 'decisions_with_outcome=0'].flatMap((t) => [
      '--target',
      t,
    ]);
    expect(await run('metrics', ...args, ...relaxed, '--check')).toBe(EXIT.ok);
  });

  it('reports an ISO week', async () => {
    const args = await setup();
    expect(await run('metrics', ...args, '--week', '2026-W41', '--json')).toBe(EXIT.ok);
    expect(JSON.parse(out.join('')).window).toMatchObject({
      kind: 'iso_week',
      isoWeek: '2026-W41',
    });
  });

  it('exits 3 for a broken log and 2 for bad arguments', async () => {
    const log = await writeLog([logOf([k, w])[1]!]);
    expect(await run('metrics', '--log', log)).toBe(EXIT.logBroken);
    expect(await run('metrics', '--week', '2025-W53')).toBe(EXIT.usage);
    expect(await run('metrics', '--target', 'bogus=1')).toBe(EXIT.usage);
    expect(await run('metrics', '--now', 'yesterday')).toBe(EXIT.usage);
  });

  it('works with nothing but an empty state directory', async () => {
    expect(await run('metrics', '--state', path.join(dir, 'state'))).toBe(EXIT.ok);
    expect(out.join('')).toContain('target receipt_coverage_7d: n/a >= 0.8: NOT MET');
  });
});

describe('wb', () => {
  it('prints usage', async () => {
    expect(await run('help')).toBe(EXIT.ok);
    expect(await run()).toBe(EXIT.usage);
    expect(await run('frobnicate')).toBe(EXIT.usage);
    expect(err.join('')).toContain('unknown command');
  });
});

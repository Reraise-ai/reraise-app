// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The `wb` command line (ADR-0040, ADR-0041, ADR-0043). Reads files only: it never starts or
// contacts the service, never writes local state, and writes only atlas pages (`wb digest`).
//
//   wb receipts verify <taskfile|dir>... [--log <file>] [--head <hash>] [--max-age-hours n]
//                      [--skew-seconds n] [--json]
//       0 every task record has valid receipts, 1 at least one failed,
//       2 usage error or unreadable/invalid input, 3 the receipt log is broken
//   wb digest --store <dir> [--out <dir>] [--target screen|local_model|demo]
//             [--gate-rules <file>] [--check]
//       0 pages written (--check: all fresh), 1 (--check) a page is stale or missing, 2 usage error
//   wb metrics [--week YYYY-Www] [--log <file>] [--tasks <dir>] [--proposals <dir>]
//              [--store <dir>] [--atlas <dir>] [--gate-rules <file>] [--target id=value]...
//              [--now <iso>] [--json] [--check]
//       0 done (--check: all targets met), 1 (--check) a target is not met, 2 usage error,
//       3 the receipt log is broken
//
// Every command takes --state <dir> to use another state directory than the per-OS default.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type {
  Card,
  DigestPage,
  PackageTarget,
  Proposal,
  TaskRecord,
  World,
} from '@worldbuilder/core';
import { createDisclosureGate } from '@worldbuilder/disclosure-gate';
import { loadGateRulesFile, resolveStateDir } from '@worldbuilder/local-state';
import { CONFIG_FILE, MarkdownFilesAdapter } from '@worldbuilder/storage-markdown-files';
import { parse as parseYaml } from 'yaml';
import { GENERATED_HEADER, buildDigest, compareAtlas, renderDigestMarkdown } from './digest.js';
import { RECEIPT_LOG_FILE, checkChain, splitLogLines } from './log.js';
import { DEFAULT_TARGETS, computeUsageMetrics, isoWeekRange } from './metrics.js';
import type { TargetId } from './metrics.js';
import { validateContract } from './validate.js';
import { verifyAgainstChain } from './verify.js';

export const EXIT = { ok: 0, failed: 1, usage: 2, logBroken: 3 } as const;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}

class UsageError extends Error {}

const USAGE = `Usage:
  wb receipts verify <taskfile|dir>... [--log <file>] [--head <hash>] [--max-age-hours n] [--skew-seconds n] [--json]
  wb digest --store <dir> [--out <dir>] [--target screen|local_model|demo] [--gate-rules <file>] [--check]
  wb metrics [--week YYYY-Www] [--log <file>] [--tasks <dir>] [--proposals <dir>] [--store <dir>]
             [--atlas <dir>] [--atlas-target <target>] [--gate-rules <file>] [--target id=value]...
             [--now <iso>] [--json] [--check]
Every command takes --state <dir>. Exit codes: see docs/reference/wb-cli.md.`;

/** Run `wb` with `argv` (without the program name); resolves with the exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const [command, sub, ...rest] = argv;
    if (command === undefined || command === 'help' || command === '--help') {
      io.stdout(`${USAGE}\n`);
      return command === undefined ? EXIT.usage : EXIT.ok;
    }
    if (command === 'receipts' && sub === 'verify') return await receiptsVerify(rest, io);
    if (command === 'digest') return await digest(argv.slice(1), io);
    if (command === 'metrics') return await metrics(argv.slice(1), io);
    throw new UsageError(`unknown command: ${argv.slice(0, 2).join(' ')}`);
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr(`wb: ${(e as Error).message}\n${USAGE}\n`);
    } else {
      io.stderr(`wb: ${(e as Error).message}\n`);
    }
    return EXIT.usage;
  }
}

const stateDir = (values: { state?: string | undefined }, io: CliIo) =>
  resolveStateDir({
    ...(io.env ? { env: io.env } : {}),
    ...(values.state !== undefined ? { explicitPath: path.resolve(values.state) } : {}),
  });

async function readText(file: string, what: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${what} ${file}: ${(e as NodeJS.ErrnoException).code ?? e}`);
  }
}

/** Log lines; a missing log is empty (every cited receipt is then unknown). */
async function readLog(file: string): Promise<string[]> {
  if (!existsSync(file)) return [];
  return splitLogLines(await readText(file, 'receipt log'));
}

/** Files under `p` (a file or a directory, recursively) with one of the extensions, sorted. */
async function filesUnder(p: string, exts: readonly string[]): Promise<string[]> {
  const info = await stat(p).catch(() => {
    throw new UsageError(`no such file or directory: ${p}`);
  });
  if (info.isFile()) return [p];
  const out: string[] = [];
  for (const entry of await readdir(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, exts)));
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out.sort();
}

/** A task record from a JSON file or the YAML front matter of a Markdown file (ADR-0040). */
export function parseTaskRecord(text: string, file: string): TaskRecord {
  let data: unknown;
  if (file.endsWith('.md')) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!m) throw new Error(`${file}: no YAML front matter`);
    data = parseYaml(m[1]!);
  } else {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${file}: not JSON`);
    }
  }
  const valid = validateContract('task-record.schema.json', data);
  if (!valid.ok) throw new Error(`${file}: not a task record: ${valid.message}`);
  return data as TaskRecord;
}

async function readTaskRecords(paths: readonly string[]): Promise<TaskRecord[]> {
  const files: string[] = [];
  for (const p of paths) files.push(...(await filesUnder(p, ['.json', '.md'])));
  const records: TaskRecord[] = [];
  for (const f of files) records.push(parseTaskRecord(await readText(f, 'task file'), f));
  return records;
}

const nonNegative = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number`);
  return n;
};

async function receiptsVerify(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      log: { type: 'string' },
      state: { type: 'string' },
      head: { type: 'string' },
      'max-age-hours': { type: 'string' },
      'skew-seconds': { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  if (positionals.length === 0) throw new UsageError('name at least one task file or directory');
  if (values.head !== undefined && !/^sha256:[0-9a-f]{64}$/.test(values.head)) {
    throw new UsageError('--head must be sha256:<64 hex digits>');
  }
  const tasks = await readTaskRecords(positionals);
  if (tasks.length === 0) throw new UsageError('no task files found');
  const logFile = values.log ?? path.join(stateDir(values, io), RECEIPT_LOG_FILE);
  const chain = checkChain(await readLog(logFile), {
    ...(values.head !== undefined ? { expectedHead: values.head } : {}),
  });
  const maxAgeHours = nonNegative(values['max-age-hours'], 'max-age-hours');
  const skewSeconds = nonNegative(values['skew-seconds'], 'skew-seconds');
  const report = verifyAgainstChain(tasks, chain, {
    ...(maxAgeHours !== undefined ? { maxAgeHours } : {}),
    ...(skewSeconds !== undefined ? { skewSeconds } : {}),
  });
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          ok: report.ok,
          chain: {
            ok: chain.ok,
            head: chain.head,
            entries: chain.entries.length,
            problems: chain.problems,
          },
          tasks: report.tasks,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const p of chain.problems) io.stdout(`LOG BROKEN: ${p.code}: ${p.message}\n`);
    for (const t of report.tasks) {
      io.stdout(
        t.ok
          ? `ok    ${t.taskRef} ${t.agent}\n`
          : `FAIL  ${t.taskRef} ${t.agent}: ${t.problems.map((p) => `${p.slot} ${p.code}`).join(', ')}\n`,
      );
    }
    const failed = report.tasks.filter((t) => !t.ok).length;
    io.stdout(
      `${report.tasks.length - failed} of ${report.tasks.length} task records have valid receipts\n`,
    );
  }
  if (!chain.ok) return EXIT.logBroken;
  return report.ok ? EXIT.ok : EXIT.failed;
}

const ATLAS_TARGETS: readonly PackageTarget[] = ['screen', 'local_model', 'demo'];

interface StoreView {
  readonly cards: Card[];
  readonly worlds: World[];
  /** Cards the gate allows for `target`. */
  readonly allowed: (target: PackageTarget) => Card[];
}

/** Read a markdown-files store read-only and prepare the gate filter (ADR-0043). */
async function readStore(store: string, gateRules: string, io: CliIo): Promise<StoreView> {
  let adapter: MarkdownFilesAdapter;
  try {
    adapter = await MarkdownFilesAdapter.open(path.resolve(store), { watch: false });
  } catch (e) {
    throw new Error(`cannot open store ${store}: ${(e as Error).message}`);
  }
  try {
    const cards: Card[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.list({ limit: 200, ...(cursor !== undefined ? { cursor } : {}) });
      cards.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const worlds = [...(await adapter.listWorlds())];
    let synthetic = false;
    try {
      const config = parseYaml(await readFile(path.join(store, CONFIG_FILE), 'utf8')) as {
        synthetic?: unknown;
      };
      synthetic = config?.synthetic === true;
    } catch {
      synthetic = false;
    }
    const load = await loadGateRulesFile(gateRules);
    if (load.missing) {
      io.stderr(`wb: no gate rules at ${gateRules}: default deny, every card is withheld\n`);
    } else if (!load.ok) {
      io.stderr(`wb: ${load.reason}; every card is withheld\n`);
    }
    const gate = createDisclosureGate({
      rules: load.rules,
      fragments: load.fragments,
      worldNames: new Map(worlds.map((w) => [w.id, w.name])),
      ...(synthetic ? { syntheticStores: [adapter.storeInstanceId] } : {}),
    });
    return {
      cards,
      worlds,
      allowed: (target) =>
        cards.filter((card) => gate.decide({ kind: 'card', card }, target).decision === 'allow'),
    };
  } finally {
    adapter.close();
  }
}

/**
 * The generated atlas files in a directory: page models (`<pageId>.json` that validate as a
 * `DigestPage` with that page id) and rendered pages (`.md` starting with the generated
 * header). Other files are never touched. `null` when the directory does not exist.
 */
async function readAtlas(
  dir: string,
): Promise<{ pages: DigestPage[]; files: Map<string, string[]> } | null> {
  if (!existsSync(dir)) return null;
  const pages: DigestPage[] = [];
  const files = new Map<string, string[]>();
  const add = (pageId: string, file: string) =>
    files.set(pageId, [...(files.get(pageId) ?? []), file]);
  for (const name of (await readdir(dir)).sort()) {
    const file = path.join(dir, name);
    const stem = name.replace(/\.(json|md)$/, '');
    if (name.endsWith('.json')) {
      let page: unknown;
      try {
        page = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        continue;
      }
      if (
        validateContract('digest-page.schema.json', page).ok &&
        (page as DigestPage).pageId === stem
      ) {
        pages.push(page as DigestPage);
        add(stem, file);
      }
    } else if (name.endsWith('.md')) {
      const head = (await readFile(file, 'utf8').catch(() => '')).slice(0, GENERATED_HEADER.length);
      if (head === GENERATED_HEADER) add(stem, file);
    }
  }
  return { pages, files };
}

async function digest(args: readonly string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      store: { type: 'string' },
      out: { type: 'string' },
      target: { type: 'string' },
      'gate-rules': { type: 'string' },
      state: { type: 'string' },
      check: { type: 'boolean' },
    },
  });
  if (values.store === undefined) throw new UsageError('--store <dir> is required');
  const target = (values.target ?? 'local_model') as PackageTarget;
  if (!ATLAS_TARGETS.includes(target)) {
    throw new UsageError(
      `target ${values.target} is refused: cloud content leaves only through a confirmed transfer, and nothing is built for other people (ADR-0043)`,
    );
  }
  const state = () => stateDir(values, io);
  const out = values.out ?? path.join(state(), 'atlas');
  const gateRules = values['gate-rules'] ?? path.join(state(), 'gate-rules.yaml');
  const view = await readStore(values.store, gateRules, io);
  const allowed = view.allowed(target);
  const now = (io.now ?? (() => new Date()))().toISOString();
  const pages = buildDigest(allowed, view.worlds, { generatedAt: now, target });

  const atlas = await readAtlas(out);
  const statuses = compareAtlas(atlas?.pages ?? [], pages, allowed, target);
  if (values.check) {
    for (const s of statuses) {
      const detail =
        s.state === 'stale' && s.staleness
          ? `: ${s.staleness.changed.length} changed, ${s.staleness.removed.length} removed, ${s.staleness.added.length} added`
          : s.state === 'extra'
            ? ': not produced by the current cards and rules'
            : '';
      io.stdout(`${s.state.padEnd(7)} ${s.pageId}${detail}\n`);
    }
    const fresh = statuses.filter((s) => s.state === 'fresh').length;
    io.stdout(`${fresh} of ${statuses.length} atlas pages are fresh\n`);
    return fresh === statuses.length ? EXIT.ok : EXIT.failed;
  }

  await mkdir(out, { recursive: true });
  const uris = new Map(allowed.map((c) => [c.id, c.uri ?? c.id]));
  for (const page of pages) {
    await writeFile(path.join(out, `${page.pageId}.json`), `${JSON.stringify(page, null, 2)}\n`);
    await writeFile(
      path.join(out, `${page.pageId}.md`),
      renderDigestMarkdown(page, (id) => uris.get(id) ?? id),
    );
  }
  // Generated pages the current cards and rules no longer produce are removed, so the atlas
  // never keeps showing a card the rules now deny (ADR-0043). Other files are left alone.
  const expected = new Set(pages.map((p) => p.pageId));
  let removed = 0;
  for (const [pageId, files] of atlas?.files ?? []) {
    if (expected.has(pageId)) continue;
    for (const f of files) await rm(f, { force: true });
    removed++;
  }
  io.stdout(
    `wrote ${pages.length} atlas pages from ${allowed.length} of ${view.cards.length} cards (target ${target}) to ${out}; removed ${removed} outdated\n`,
  );
  return EXIT.ok;
}

async function readProposals(dir: string, io: CliIo): Promise<Proposal[]> {
  if (!existsSync(dir)) return [];
  const out: Proposal[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    } catch {
      data = undefined;
    }
    if (validateContract('proposal.schema.json', data).ok) out.push(data as Proposal);
    else io.stderr(`wb: skipped damaged proposal file ${name}\n`);
  }
  return out;
}

const fmt = (v: number | null) =>
  v === null ? 'n/a' : Number.isInteger(v) ? String(v) : v.toFixed(2);

async function metrics(args: readonly string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      week: { type: 'string' },
      log: { type: 'string' },
      tasks: { type: 'string' },
      proposals: { type: 'string' },
      store: { type: 'string' },
      atlas: { type: 'string' },
      'atlas-target': { type: 'string' },
      'gate-rules': { type: 'string' },
      target: { type: 'string', multiple: true },
      now: { type: 'string' },
      state: { type: 'string' },
      json: { type: 'boolean' },
      check: { type: 'boolean' },
    },
  });
  if (values.week !== undefined) {
    try {
      isoWeekRange(values.week);
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
  }
  const now = values.now !== undefined ? new Date(values.now) : (io.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) throw new UsageError('--now must be an ISO 8601 time');
  const targets: Partial<Record<TargetId, number>> = {};
  for (const t of values.target ?? []) {
    const m = /^([a-z_0-9]+)=(\d+(?:\.\d+)?)$/.exec(t);
    if (!m || !(m[1]! in DEFAULT_TARGETS)) throw new UsageError(`unknown target override ${t}`);
    targets[m[1] as TargetId] = Number(m[2]);
  }
  const state = () => stateDir(values, io);
  const chain = checkChain(await readLog(values.log ?? path.join(state(), RECEIPT_LOG_FILE)));
  if (!chain.ok) {
    io.stderr(`wb: the receipt log is broken: ${chain.problems[0]?.message}\n`);
    return EXIT.logBroken;
  }
  const records = values.tasks !== undefined ? await readTaskRecords([values.tasks]) : [];
  const verified = verifyAgainstChain(records, chain);
  const proposals = await readProposals(values.proposals ?? path.join(state(), 'proposals'), io);

  let decisions: Card[] | null = null;
  let atlas: { generatedAt: string | null; fresh: boolean }[] | null = null;
  if (values.store !== undefined) {
    const view = await readStore(
      values.store,
      values['gate-rules'] ?? path.join(state(), 'gate-rules.yaml'),
      io,
    );
    decisions = view.cards.filter((c) => String(c.type).trim().toLowerCase() === 'decision');
    const existing = await readAtlas(values.atlas ?? path.join(state(), 'atlas'));
    if (existing !== null) {
      const atlasTarget = (values['atlas-target'] ?? 'local_model') as PackageTarget;
      if (!ATLAS_TARGETS.includes(atlasTarget)) {
        throw new UsageError(`--atlas-target ${atlasTarget} is not an atlas target`);
      }
      const allowed = view.allowed(atlasTarget);
      const expected = buildDigest(allowed, view.worlds, {
        generatedAt: now.toISOString(),
        target: atlasTarget,
      });
      atlas = compareAtlas(existing.pages, expected, allowed, atlasTarget).map((s) => ({
        generatedAt: s.generatedAt,
        fresh: s.state === 'fresh',
      }));
    }
  }

  const result = computeUsageMetrics(
    {
      entries: chain.entries,
      tasks: verified.tasks.map((t, i) => ({ record: records[i]!, valid: t.ok })),
      proposals,
      decisions,
      atlas,
    },
    { now, ...(values.week !== undefined ? { week: values.week } : {}), targets },
  );

  if (values.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const w = result.window;
    io.stdout(
      `Knowledge-loop metrics, ${w.kind === 'iso_week' ? w.isoWeek : 'rolling 7 days'} (${w.start} to ${w.end})\n`,
    );
    for (const a of [...result.agents, { agent: 'total', ...result.totals }]) {
      io.stdout(
        `${a.agent}: tasks ${a.tasks}, with receipts ${a.tasksWithReceipts} (${fmt(a.receiptCoverage)}), consults ${a.consults}, write-backs ${a.writeBacks}, cards proposed ${a.cardsProposed}, accepted ${a.cardsAccepted}, outcomes proposed ${a.outcomesProposed}\n`,
      );
    }
    io.stdout(
      `decisions with outcome: ${result.decisions ? `${result.decisions.withOutcome} of ${result.decisions.total}` : 'n/a'}; atlas lag hours: ${fmt(result.atlas.lagHours)}\n`,
    );
    for (const t of result.targets) {
      io.stdout(
        `target ${t.id}: ${fmt(t.value)} ${t.comparison === 'at_least' ? '>=' : '<='} ${t.threshold}: ${t.met ? 'met' : 'NOT MET'}\n`,
      );
    }
  }
  if (values.check && !result.targets.every((t) => t.met)) return EXIT.failed;
  return EXIT.ok;
}

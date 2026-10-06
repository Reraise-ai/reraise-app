// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// File-backed LocalStateStore (ADR-0030). One writer: the service process. Writes are atomic
// and serialised in-process; ids are ULIDs. Layout:
//   <state>/proposals/<ulid>.json   <state>/stances/<cardId>.json
//   <state>/gate-log.jsonl(.n)      <state>/gate-rules.yaml

import type {
  AgentAuthor,
  GateLogEntry,
  GateRulesLoad,
  LocalStateStore,
  Proposal,
  ProposalCreate,
  ProposalListRequest,
  ProposalPage,
  Stance,
  StanceInput,
} from '@worldbuilder/core';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { localStateError } from './errors.js';
import { type FsOps, Mutex, atomicWriteFile, defaultFsOps } from './fs-util.js';
import { GateLog, type GateLogOptions } from './gate-log.js';
import { loadGateRulesFile } from './gate-rules.js';
import { assertStateDirSafe, resolveStateDir, type ResolveStateDirOptions } from './state-dir.js';
import { ULID_PATTERN, createUlidFactory } from './ulid.js';
import { validatorFor } from './validate.js';

export interface LocalStateOptions extends ResolveStateDirOptions {
  /** Roots of every configured card store; the state directory must not lie inside one. */
  readonly storeRoots?: readonly string[];
  readonly gateLog?: GateLogOptions;
  readonly now?: () => Date;
  readonly randomBytes?: (n: number) => Uint8Array;
  readonly fsOps?: FsOps;
}

const ULID_FILE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}\.json$/;
const DEFAULT_LIMIT = 50;
const ZERO_KEY = { at: '1970-01-01T00:00:00.000Z', id: '' };

interface ChangeKey {
  at: string;
  id: string;
}

const encodeCursor = (key: ChangeKey) =>
  Buffer.from(`${key.at}~${key.id}`, 'utf8').toString('base64url');

function decodeCursor(cursor: string): ChangeKey {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)~([0-9A-Z]*)$/.exec(text);
  if (!m) throw localStateError('invalid', 'invalid cursor');
  return { at: m[1]!, id: m[2]! };
}

/** A proposal changes when it is created and again when it is decided. */
const keyOf = (p: Proposal): ChangeKey => ({ at: p.decidedAt ?? p.createdAt, id: p.id });
const compareKeys = (a: ChangeKey, b: ChangeKey) =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function checkId(id: string, what: string): void {
  if (!ULID_PATTERN.test(id)) throw localStateError('invalid', `${what} must be a ULID`);
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

/**
 * Open the local state: resolve the directory, refuse an unsafe one (inside a store root or a
 * Git working tree, symlinks followed), create it with owner-only permissions.
 */
export async function createLocalStateStore(
  options: LocalStateOptions = {},
): Promise<LocalStateStore> {
  const stateDir = await assertStateDirSafe(resolveStateDir(options), {
    ...(options.storeRoots ? { storeRoots: options.storeRoots } : {}),
  });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  return new FileLocalStateStore(stateDir, options);
}

class FileLocalStateStore implements LocalStateStore {
  private readonly proposalsDir: string;
  private readonly stancesDir: string;
  private readonly mutex = new Mutex();
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly fsOps: FsOps;
  private readonly gateLog: GateLog;
  private lastStamp = 0;
  private stampReady = false;

  constructor(
    readonly stateDir: string,
    options: LocalStateOptions,
  ) {
    this.proposalsDir = path.join(stateDir, 'proposals');
    this.stancesDir = path.join(stateDir, 'stances');
    this.now = options.now ?? (() => new Date());
    this.fsOps = options.fsOps ?? defaultFsOps;
    this.newId = createUlidFactory({
      now: () => this.now().getTime(),
      ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
    });
    this.gateLog = new GateLog(path.join(stateDir, 'gate-log.jsonl'), {
      now: this.now,
      ...options.gateLog,
    });
  }

  /**
   * Strictly increasing millisecond timestamps for change tracking: no two changes share a
   * stamp, so a cursor never skips or repeats one (one writer, ADR-0030). Resumes after the
   * newest stamp on disk when the process restarts.
   */
  private async stamp(): Promise<string> {
    if (!this.stampReady) {
      for (const p of await this.readAllProposals()) {
        this.lastStamp = Math.max(this.lastStamp, Date.parse(keyOf(p).at));
      }
      this.stampReady = true;
    }
    this.lastStamp = Math.max(this.now().getTime(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }

  private proposalFile(id: string): string {
    return path.join(this.proposalsDir, `${id}.json`);
  }

  private async readProposalFile(file: string): Promise<Proposal | undefined> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
    try {
      const data = parseJson(text);
      return validatorFor('proposal.schema.json')(data).ok ? (data as Proposal) : undefined;
    } catch {
      return undefined; // a damaged file counts nowhere (ADR-0011) and must not stop polling
    }
  }

  private async readAllProposals(): Promise<Proposal[]> {
    const names = await readdir(this.proposalsDir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [] as string[];
      throw e;
    });
    const all = await Promise.all(
      names
        .filter((n) => ULID_FILE.test(n))
        .map((n) => this.readProposalFile(path.join(this.proposalsDir, n))),
    );
    return all.filter((p): p is Proposal => p !== undefined);
  }

  createProposal(input: ProposalCreate, author: AgentAuthor): Promise<Proposal> {
    return this.mutex.run(async () => {
      const checked = validatorFor('proposal.schema.json#/$defs/create')(input);
      if (!checked.ok) throw localStateError('invalid', `proposal invalid: ${checked.message}`);
      const proposal = {
        id: this.newId(),
        author,
        kind: input.kind,
        payload: input.payload,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        status: 'pending',
        createdAt: await this.stamp(),
      } as Proposal;
      const full = validatorFor('proposal.schema.json')(proposal);
      if (!full.ok) throw localStateError('invalid', `proposal invalid: ${full.message}`);
      await atomicWriteFile(
        this.proposalFile(proposal.id),
        `${JSON.stringify(proposal, null, 2)}\n`,
        this.fsOps,
      );
      return proposal;
    });
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    checkId(id, 'proposal id');
    return this.readProposalFile(this.proposalFile(id));
  }

  async listProposals(request: ProposalListRequest = {}): Promise<ProposalPage> {
    const limit = request.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw localStateError('invalid', 'limit must be an integer from 1 to 200');
    }
    const cursors = [request.cursor, request.changedSince]
      .filter((c): c is string => c !== undefined)
      .map(decodeCursor);
    const after = cursors.reduce((a, b) => (compareKeys(a, b) >= 0 ? a : b), ZERO_KEY);
    const candidates = (await this.readAllProposals())
      .filter((p) => compareKeys(keyOf(p), after) > 0)
      .sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    const matching = candidates.filter(
      (p) =>
        (request.status === undefined || p.status === request.status) &&
        (request.lageId === undefined ||
          (p.payload as { lageId?: string }).lageId === request.lageId),
    );
    const page = matching.slice(0, limit);
    // The cursor moves over everything scanned, so filtered-out changes are not seen again.
    const last =
      matching.length > limit ? page[page.length - 1]! : candidates[candidates.length - 1];
    return { proposals: page, nextCursor: encodeCursor(last ? keyOf(last) : after) };
  }

  async decideProposal(id: string, status: 'accepted' | 'rejected'): Promise<Proposal> {
    checkId(id, 'proposal id');
    if (status !== 'accepted' && status !== 'rejected') {
      throw localStateError('invalid', 'status must be accepted or rejected');
    }
    return await this.mutex.run(async () => {
      const current = await this.readProposalFile(this.proposalFile(id));
      if (!current) throw localStateError('not_found', 'proposal not found');
      if (current.status !== 'pending')
        throw localStateError('conflict', 'proposal already decided');
      const decided: Proposal = {
        ...current,
        status,
        decidedBy: 'human',
        decidedAt: await this.stamp(),
      };
      await atomicWriteFile(
        this.proposalFile(id),
        `${JSON.stringify(decided, null, 2)}\n`,
        this.fsOps,
      );
      return decided;
    });
  }

  private stanceFile(cardId: string): string {
    checkId(cardId, 'card id'); // also keeps path separators out of the file name
    return path.join(this.stancesDir, `${cardId}.json`);
  }

  private async readStanceFile(file: string): Promise<Stance | undefined> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
    const data = parseJson(text);
    const checked = validatorFor('stance.schema.json')(data);
    if (!checked.ok) throw localStateError('invalid', `stored stance invalid: ${checked.message}`);
    return data as Stance;
  }

  async getStance(cardId: string): Promise<Stance | undefined> {
    return await this.readStanceFile(this.stanceFile(cardId));
  }

  async listStances(): Promise<Stance[]> {
    const names = await readdir(this.stancesDir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [] as string[];
      throw e;
    });
    const all = await Promise.all(
      names
        .filter((n) => ULID_FILE.test(n))
        .map((n) => this.readStanceFile(path.join(this.stancesDir, n))),
    );
    return all.filter((s): s is Stance => s !== undefined);
  }

  async saveStance(cardId: string, input: StanceInput): Promise<Stance> {
    const file = this.stanceFile(cardId);
    const checked = validatorFor('stance.schema.json#/$defs/input')(input);
    if (!checked.ok) throw localStateError('invalid', `stance invalid: ${checked.message}`);
    return await this.mutex.run(async () => {
      const previous = await this.readStanceFile(file);
      const updatedAt = this.now().toISOString();
      const stance: Stance = {
        cardId,
        position: input.position,
        weight: input.weight,
        ...(input.note !== undefined ? { note: input.note } : {}),
        updatedAt,
        history: previous
          ? [
              ...previous.history,
              {
                position: previous.position,
                weight: previous.weight,
                ...(previous.note !== undefined ? { note: previous.note } : {}),
                updatedAt: previous.updatedAt,
              },
            ]
          : [],
      };
      await atomicWriteFile(file, `${JSON.stringify(stance, null, 2)}\n`, this.fsOps);
      return stance;
    });
  }

  appendGateLog(entry: GateLogEntry): Promise<void> {
    return this.gateLog.append(entry);
  }

  loadGateRules(fragments: readonly unknown[] = []): Promise<GateRulesLoad> {
    return loadGateRulesFile(path.join(this.stateDir, 'gate-rules.yaml'), fragments);
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Level 1 in the service (ADR-0035, ADR-0045): builds the engine request from the cards on a
// Lage, runs the built-in engine or, after the human confirmed the transfer, a cloud engine, keeps
// the latest prediction per Lage in memory and creates the level-2 Lage on escalation.
//
// A prediction is an attributed estimate. It is not a card: it is never written to the store, the
// gate log or a context package, it counts nowhere, and the stance of a card never enters a
// request (only the absence of a rejected assumption does).

import type {
  Card,
  CardDraft,
  DisclosureRelease,
  Level1Engine,
  Level1PredictRequest,
  Level1Prediction,
  Level1PredictionRequest,
  Level1Result,
  Level1State,
  Level1Trigger,
} from '@worldbuilder/core';
import { computePayloadHash } from '@worldbuilder/core';
import {
  answerProblems,
  buildLevel2Draft,
  buildMoveOptions,
  changedMoves,
  currentOnly,
  isStale,
  Level1EngineError,
  level1EnvelopeFor,
  rerunOnAssumptionChange,
  type MoveChange,
} from '@worldbuilder/level1-engines';
import { validators } from './contract.js';
import type { Level1EngineRegistry } from './level1-engines.js';
import { readLage } from './lage.js';
import { HttpError } from './problem.js';
import { collect, stanceFor, type LageCard, type Services } from './services.js';

/** Card types that are players: the actors of a Lage (ADR-0035). */
export const PLAYER_TYPES: ReadonlySet<string> = new Set(['actor', 'person', 'organisation']);
/** At most this many rule cards go into one request (OQ-25). */
export const MAX_RULE_CARDS = 50;
/** Lagen whose latest prediction is kept; the least recently used is dropped. */
export const MAX_KEPT_PREDICTIONS = 200;

const checkRequest = validators.strict('level1-prediction.schema.json#/$defs/request');
const checkDraft = validators.strict('card.schema.json#/$defs/draft');

/** Which gate target clears the cards of a request. */
type Mode = 'screen' | 'cloud_model';

interface Built {
  readonly lage: LageCard;
  /** Cards cleared for the mode, in request order (the request's `cards`). */
  readonly cards: Card[];
  /** Undefined when the Lage has no player. */
  readonly request: Level1PredictionRequest | undefined;
}

interface Kept {
  readonly prediction: Level1Prediction;
  readonly mode: Mode;
}

export class Level1Service {
  private readonly latest = new Map<string, Kept>();
  /** Per Lage: the number of the newest call. A call that is not the newest drops its answer. */
  private readonly newest = new Map<string, number>();
  private counter = 0;

  constructor(
    private readonly services: () => Services,
    readonly registry: Level1EngineRegistry,
  ) {}

  private get s(): Services {
    return this.services();
  }

  // ---- building the request ------------------------------------------------------------------

  private async clearedFor(cards: readonly Card[], mode: Mode, log: boolean): Promise<Card[]> {
    if (log) {
      // The gate logs each decision (content-free). A cloud card never passes `decide`; it is
      // cleared if the rules would clear it after a confirmed transfer.
      const { allowed } = await this.s.gate.filter(cards, mode);
      if (mode === 'screen') return allowed;
    }
    const out: Card[] = [];
    for (const card of cards) if (await this.s.gate.clears(card, mode)) out.push(card);
    return out;
  }

  private async ruleCards(lage: LageCard): Promise<Card[]> {
    const worlds = new Set(lage.worlds ?? []);
    const rules = await collect(
      (cursor) =>
        this.s.storage.search({ type: 'rule', limit: 200, ...(cursor ? { cursor } : {}) }),
      1000,
    );
    return rules
      .filter(
        (c) =>
          c.rule !== undefined &&
          ((c.worlds ?? []).length === 0 || (c.worlds ?? []).some((w) => worlds.has(w))),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * The request for a Lage: the placed cards (an assumption the user rejected left out) and the
   * user's rule cards, each cleared for the mode. `trigger` is normalised: the ids of an
   * `assumption_changed` trigger must be assumption cards of the request, else it is `manual`.
   */
  async build(lageId: string, mode: Mode, trigger: Level1Trigger, log: boolean): Promise<Built> {
    const lage = await readLage(this.s, lageId);
    if (!lage) throw new HttpError(404, 'unknown Lage');
    const placed: Card[] = [];
    for (const p of lage.lage.cards) {
      const card = await this.s.storage.read(p.id);
      if (!card) continue;
      if (card.type === 'assumption') {
        const stance = await stanceFor(this.s, card.id);
        if (stance?.position === 'rejected') continue; // the stance itself never leaves
      }
      placed.push(card);
    }
    const onLage = new Set(placed.map((c) => c.id));
    const candidates = [
      ...placed,
      ...(await this.ruleCards(lage)).filter((c) => !onLage.has(c.id)).slice(0, MAX_RULE_CARDS),
    ];
    const cards = await this.clearedFor(candidates, mode, log);
    const players = cards.filter((c) => onLage.has(c.id) && PLAYER_TYPES.has(c.type));
    if (players.length === 0) return { lage, cards, request: undefined };

    const assumptions = new Set(cards.filter((c) => c.type === 'assumption').map((c) => c.id));
    const kept =
      trigger.kind === 'assumption_changed'
        ? (trigger.cardIds ?? []).filter((id) => assumptions.has(id))
        : [];
    const normalised: Level1Trigger =
      trigger.kind !== 'assumption_changed'
        ? { kind: trigger.kind }
        : kept.length > 0
          ? { kind: 'assumption_changed', cardIds: kept }
          : { kind: 'manual' };
    const request: Level1PredictionRequest = {
      lageId,
      question: lage.lage.question,
      trigger: normalised,
      players: players.map((p) => ({
        playerCardId: p.id,
        moveOptions: buildMoveOptions(p, cards),
      })),
      cards,
    };
    const checked = checkRequest(request);
    if (!checked.ok) throw new HttpError(500, 'the Lage could not be turned into a valid request');
    return { lage, cards, request };
  }

  // ---- reading -------------------------------------------------------------------------------

  private keep(lageId: string, kept: Kept): void {
    this.latest.delete(lageId);
    this.latest.set(lageId, kept);
    while (this.latest.size > MAX_KEPT_PREDICTIONS) {
      const oldest = this.latest.keys().next().value;
      if (oldest === undefined) break;
      this.latest.delete(oldest);
    }
  }

  async state(lageId: string, explain: boolean): Promise<Level1State> {
    if (!(await readLage(this.s, lageId))) throw new HttpError(404, 'unknown Lage');
    const engines = await this.registry.list();
    const kept = this.latest.get(lageId);
    if (!kept) return { lageId, engines };
    const { request } = await this.build(lageId, kept.mode, kept.prediction.trigger, false);
    const stale = request === undefined || isStale(kept.prediction, request);
    let basis: Record<string, unknown> | undefined;
    if (explain && !stale && request !== undefined && kept.mode === 'screen') {
      const explainer = this.registry.explainerOf(this.registry.local);
      if (explainer && kept.prediction.engine === explainer.engine) {
        basis = JSON.parse(JSON.stringify(explainer.explain(request))) as Record<string, unknown>;
      }
    }
    return {
      lageId,
      engines,
      prediction: kept.prediction,
      stale,
      ...(basis !== undefined ? { basis } : {}),
    };
  }

  // ---- predicting ----------------------------------------------------------------------------

  async predict(lageId: string, body: Level1PredictRequest): Promise<Level1Result> {
    const builtIn = this.registry.resolveBuiltIn(body.engine);
    const call = ++this.counter;
    this.newest.set(lageId, call);
    if (builtIn) return this.predictLocal(lageId, builtIn, body, call);

    const found = await this.registry.resolve(body.engine);
    if (found.kind === 'unknown') throw new HttpError(404, 'unknown engine');
    if (found.kind === 'unavailable') {
      throw new HttpError(409, `the engine is not available: ${found.reason}`);
    }
    return this.predictCloud(lageId, found.engine, body, call);
  }

  private async predictLocal(
    lageId: string,
    engine: Level1Engine,
    body: Level1PredictRequest,
    call: number,
  ): Promise<Level1Result> {
    const { request } = await this.build(lageId, 'screen', body.trigger, true);
    if (!request) return { status: 'no_players', engine: engine.engine };
    // Only this engine's own earlier answer can stand in for a re-run (never a cloud estimate).
    const held = this.latest.get(lageId)?.prediction;
    const previous = held?.engine === engine.engine ? held : undefined;
    let prediction: Level1Prediction | undefined;
    let changes: MoveChange[] = [];
    try {
      if (request.trigger.kind === 'assumption_changed') {
        // The what-if re-run: nothing runs if the stored prediction still describes the board.
        const result = await rerunOnAssumptionChange(engine, previous, request);
        prediction = result.prediction;
        changes = [...result.changes];
      } else {
        prediction = await engine.predict(request);
        const problems = answerProblems(engine.engine, request, prediction);
        if (problems.length > 0) throw new Error('the engine answered something that does not fit');
        changes = [...changedMoves(previous, prediction)];
      }
      if (prediction === undefined) throw new Error('no prediction');
    } catch {
      throw new HttpError(500, 'the local engine failed');
    }
    return this.finish(lageId, engine, 'screen', prediction, changes, call);
  }

  private async predictCloud(
    lageId: string,
    engine: Level1Engine,
    body: Level1PredictRequest,
    call: number,
  ): Promise<Level1Result> {
    const { request, cards } = await this.build(lageId, 'cloud_model', body.trigger, true);
    if (!request) return { status: 'no_players', engine: engine.engine };
    const envelope = level1EnvelopeFor(engine.engine, request, cards);

    if (body.transferId === undefined) {
      const transfer = await this.s.disclosures.preview({
        connectorId: engine.engine,
        purpose: 'level1',
        request: envelope.request,
        cards,
        requester: { kind: 'board' },
      });
      if (!transfer) {
        throw new HttpError(403, 'the gate rules clear no card of this Lage for a cloud engine');
      }
      return { status: 'confirmation_required', engine: engine.engine, transfer };
    }

    const transfer = this.s.disclosures.get(body.transferId);
    const requester = this.s.disclosures.requesterOf(body.transferId);
    if (
      !transfer ||
      transfer.purpose !== 'level1' ||
      requester?.kind !== 'board' ||
      transfer.preview.connectorId !== engine.engine
    ) {
      throw new HttpError(403, 'unknown, expired or unconfirmed transfer');
    }
    // The board or the question changed since the preview: nothing is consumed, preview again.
    if (computePayloadHash(envelope) !== transfer.payloadHash) {
      throw new HttpError(409, 'the board changed since the preview; preview the transfer again');
    }
    const release: DisclosureRelease = await this.s.disclosures.redeem(body.transferId, {
      kind: 'token',
      token: body.confirmationToken as string,
    });
    let prediction: Level1Prediction;
    try {
      prediction = await engine.predict(request, release);
    } catch (e) {
      throw cloudFailure(e);
    }
    if (answerProblems(engine.engine, request, prediction).length > 0) {
      throw new HttpError(502, 'the engine answered something that does not fit the request');
    }
    const previous = this.latest.get(lageId)?.prediction;
    return this.finish(
      lageId,
      engine,
      'cloud_model',
      prediction,
      [...changedMoves(previous, prediction)],
      call,
    );
  }

  /** Latest wins: store and return the answer only if it still describes the board. */
  private async finish(
    lageId: string,
    engine: Level1Engine,
    mode: Mode,
    prediction: Level1Prediction,
    changes: readonly MoveChange[],
    call: number,
  ): Promise<Level1Result> {
    const superseded: Level1Result = { status: 'superseded', engine: engine.engine };
    if (this.newest.get(lageId) !== call) return superseded;
    const { request } = await this.build(lageId, mode, prediction.trigger, false);
    if (!request || currentOnly(prediction, request) === undefined) return superseded;
    if (this.newest.get(lageId) !== call) return superseded;
    this.keep(lageId, { prediction, mode });
    return {
      status: 'predicted',
      engine: engine.engine,
      prediction,
      ...(changes.length > 0 ? { changes: [...changes] } : {}),
    };
  }

  // ---- escalating ----------------------------------------------------------------------------

  async escalate(lageId: string, playerCardId: string): Promise<Card> {
    const kept = this.latest.get(lageId);
    if (!kept) throw new HttpError(409, 'there is no prediction for this Lage; estimate first');
    const { lage, request } = await this.build(lageId, kept.mode, kept.prediction.trigger, false);
    if (!request || isStale(kept.prediction, request)) {
      throw new HttpError(409, 'the prediction is stale; estimate again first');
    }
    if (!kept.prediction.players.some((p) => p.playerCardId === playerCardId)) {
      throw new HttpError(404, 'the prediction has no such player');
    }
    const draft = buildLevel2Draft(kept.prediction, request, playerCardId, {
      now: this.s.now,
      ...(lage.worlds ? { worlds: lage.worlds } : {}),
    });
    const card = {
      format: 2,
      type: 'lage',
      title: draft.create.title,
      ...(draft.create.worlds ? { worlds: draft.create.worlds } : {}),
      lage: draft.create.lage,
      edges: [{ target: draft.sourceLageId, kind: 'based_on', by: 'human' }],
    };
    const checked = checkDraft(card);
    if (!checked.ok) throw new HttpError(500, 'the board analysis could not be created');
    const id = await this.s.writes.run(() => this.s.storage.create(card as CardDraft, 'human'));
    const created = await this.s.storage.read(id);
    if (!created) throw new HttpError(500, 'the board analysis could not be read back');
    return created;
  }
}

/** Map an engine failure to a problem with fixed wording (no answer text, credential or address). */
function cloudFailure(e: unknown): HttpError {
  if (e instanceof Level1EngineError) {
    if (e.code === 'release_required') {
      return new HttpError(403, 'the engine refused: the release does not match the request');
    }
    if (e.code === 'request_too_large') {
      return new HttpError(409, 'the request is too large for this engine; place fewer cards');
    }
    return new HttpError(502, 'the engine did not give a usable answer');
  }
  return new HttpError(502, 'the engine did not give a usable answer');
}

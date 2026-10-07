// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The default Level1Engine (ADR-0035): deterministic, local, no network. For every player card
// of a request it scores each move option with the transparent heuristics below, removes the
// options that cross a red line, turns the scores into a confidence with a softmax and names
// the on-board cards that influenced the result. `explain` returns the full breakdown.

import type {
  Card,
  Level1Engine,
  Level1Prediction,
  Level1PredictionRequest,
  PlayerEntry,
  RuleCondition,
} from '@worldbuilder/core';
import { hashJcs } from '@worldbuilder/core';
import { coverage, dice, shared, tokens } from './text.js';

export const LOCAL_RULES_ENGINE_ID = 'local-rules';

/**
 * Softmax temperature of the confidence. Lower is sharper. 0.5 turns a score lead of 0.5 over
 * one rival into about 0.73 (two options) and keeps three similar options near one third. This is
 * a product default pending owner confirmation (OQ-19), not a fitted calibration.
 */
export const CONFIDENCE_TEMPERATURE = 0.5;
/** The engine never reports more than this: a heuristic is not certain. */
export const MAX_CONFIDENCE = 0.95;
/** Cap when at least one option was removed by a red line: the lexical match is itself fallible. */
export const EXCLUSION_CONFIDENCE_CAP = 0.8;
/** Distinct kinds of evidence needed for the full softmax confidence; fewer shrink it to 1/n. */
export const ENOUGH_EVIDENCE_KINDS = 2;
/** Dice overlap below which a phrase does not count as matching an option. */
export const MATCH_MIN = 0.3;
/**
 * Red-line hit: at least two content words of the line, and this share of them, found in the
 * option; or the option itself says it lacks what the line demands ("without ...").
 */
export const RED_LINE_HARD_COVERAGE = 0.6;
export const RED_LINE_HARD_WORDS = 2;
/** A fired rule applies to an option when its action matches this well. */
export const RULE_MATCH_MIN = 0.6;
export const MAX_MOVE_OPTIONS = 8;
/** Offered when a player has fewer than two options of its own. */
export const NO_NEW_ACTION = 'Take no new action';

export const FEATURES = [
  'behaviour',
  'linkedEvidenced',
  'interest',
  'assumedGoal',
  'linkedSaid',
  'capability',
  'dependencyRisk',
  'redLineRisk',
  'rule',
] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * Weight of each feature in an option's score. Behaviour (what the player did) outweighs
 * statements (what it said it wants): own past moves count 1.0, stated interests 0.5, assumed
 * goals 0.3. Evidence cards linked to the player count as behaviour when evidenced and as
 * statements when only said.
 */
export const WEIGHTS: Readonly<Record<Feature, number>> = {
  behaviour: 1,
  linkedEvidenced: 0.5,
  interest: 0.5,
  assumedGoal: 0.3,
  linkedSaid: 0.25,
  capability: 0.25,
  dependencyRisk: -0.75,
  redLineRisk: -0.75,
  rule: 0.5,
};

const BEHAVIOUR_FEATURES: readonly Feature[] = ['behaviour', 'linkedEvidenced'];
const STATEMENT_FEATURES: readonly Feature[] = ['interest', 'assumedGoal', 'linkedSaid'];

/** Verbs that jeopardise whatever the player depends on (stemmed like all text). */
const DISRUPTIVE = new Set(
  [
    'stop',
    'halt',
    'close',
    'block',
    'cut',
    'suspend',
    'cancel',
    'delay',
    'withdraw',
    'ban',
    'sanction',
    'abandon',
    'end',
    'terminate',
    'boycott',
    'embargo',
  ].flatMap((w) => [...tokens(w)]),
);

export interface RedLineHit {
  readonly line: string;
  readonly kind: 'hard' | 'soft';
  readonly sharedWords: number;
  readonly sourceCardId?: string;
}

export interface FeatureValue {
  /** In [0, 1]. */
  readonly value: number;
  /** On-board cards behind the value. */
  readonly via: readonly string[];
}

export interface OptionBasis {
  readonly move: string;
  /** Removed from the prediction because it crosses a red line. */
  readonly excluded: boolean;
  readonly redLineHits: readonly RedLineHit[];
  readonly features: Readonly<Record<Feature, FeatureValue>>;
  /** weight times value, per feature. */
  readonly contributions: Readonly<Record<Feature, number>>;
  readonly score: number;
  /** Softmax share among the options that stayed; 0 for removed options. */
  readonly probability: number;
}

export interface PlayerBasis {
  readonly playerCardId: string;
  readonly temperature: number;
  readonly weights: Readonly<Record<Feature, number>>;
  readonly options: readonly OptionBasis[];
  readonly firedRuleCardIds: readonly string[];
  /** Distinct kinds of evidence found: features with a value on some option (not the soft red-line penalty) and removals. */
  readonly evidenceKinds: number;
  /** The best option by behaviour and the best by statements differ; behaviour decides. */
  readonly statementBehaviourDivergence: boolean;
  /** Every option crosses a red line; the prediction is the least bad one at uniform confidence. */
  readonly allExcluded: boolean;
  readonly predictedMove: string;
  readonly confidence: number;
  readonly cardIds: readonly string[];
}

export interface LocalRulesExplanation {
  readonly engine: string;
  readonly requestHash: string;
  readonly players: readonly PlayerBasis[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasRule = (c: Card) => c.rule !== undefined;
const textOf = (e: PlayerEntry) => e.text;

interface Scope {
  readonly byId: ReadonlyMap<string, Card>;
  readonly board: readonly Card[];
  readonly edges: readonly { from: string; to: string; kind: string }[];
}

function scopeOf(request: Level1PredictionRequest): Scope {
  const byId = new Map(request.cards.map((c) => [c.id, c] as const));
  const board = request.cards.filter((c) => !hasRule(c));
  const edges = request.cards.flatMap((c) =>
    (c.edges ?? []).map((e) => ({ from: c.id, to: e.target, kind: e.kind })),
  );
  return { byId, board, edges };
}

function holds(cond: RuleCondition, scope: Scope): boolean | undefined {
  switch (cond.kind) {
    case 'card_on_lage':
      return scope.board.some((c) => c.id === cond.card);
    case 'card_field': {
      const pool = cond.card ? scope.board.filter((c) => c.id === cond.card) : scope.board;
      return pool.some((c) => c[cond.field] === cond.equals);
    }
    case 'tag': {
      const pool = cond.card ? scope.board.filter((c) => c.id === cond.card) : scope.board;
      return pool.some((c) => c.tags?.includes(cond.tag));
    }
    case 'edge':
      return scope.edges.some(
        (e) =>
          e.kind === cond.edgeKind &&
          (!cond.from || e.from === cond.from) &&
          (!cond.to || e.to === cond.to),
      );
    case 'stance':
      return undefined; // the engine never receives stances
  }
}

/** Rule cards of the request that fire on the board, with the on-board cards they name. */
function firedRules(scope: Scope, request: Level1PredictionRequest) {
  const fired: { card: Card; then: string; named: string[]; referenced: Set<string> }[] = [];
  for (const card of request.cards) {
    const rule = card.rule;
    if (!rule) continue;
    const when = rule.when.map((c) => holds(c, scope));
    const unless = (rule.unless ?? []).map((c) => holds(c, scope));
    if (when.some((v) => v !== true) || unless.some((v) => v !== false)) continue;
    const named = [...rule.when, ...(rule.unless ?? [])].flatMap((c) =>
      'card' in c && c.card && scope.byId.has(c.card) ? [c.card] : [],
    );
    const referenced = new Set(
      [...rule.when, ...(rule.unless ?? [])].flatMap((c) => {
        const ids: string[] = [];
        if ('card' in c && c.card) ids.push(c.card);
        if (c.kind === 'edge') ids.push(...[c.from, c.to].flatMap((x) => (x ? [x] : [])));
        return ids;
      }),
    );
    fired.push({ card, then: rule.then, named, referenced });
  }
  return fired;
}

const onBoard = (scope: Scope, id: string, except: string) => id !== except && scope.byId.has(id);

function best(
  option: ReadonlySet<string>,
  entries: readonly PlayerEntry[] | undefined,
  scope: Scope,
  player: string,
): FeatureValue {
  let value = 0;
  const via = new Set<string>();
  for (const e of entries ?? []) {
    const s = dice(option, tokens(e.text));
    if (s < MATCH_MIN) continue;
    if (s > value) {
      value = s;
      via.clear();
    }
    if (s === value && onBoard(scope, e.source, player)) via.add(e.source);
  }
  return { value, via: [...via] };
}

function behaviour(
  option: ReadonlySet<string>,
  moves: readonly PlayerEntry[] | undefined,
  scope: Scope,
  player: string,
): FeatureValue {
  if (!moves || moves.length === 0) return { value: 0, via: [] };
  let sum = 0;
  const via = new Set<string>();
  for (const m of moves) {
    const s = dice(option, tokens(m.text));
    if (s < MATCH_MIN) continue;
    sum += s;
    if (onBoard(scope, m.source, player)) via.add(m.source);
  }
  return { value: sum / moves.length, via: [...via] };
}

/** Split "No X without Y" into the prohibited part X and the qualifier Y. */
function parseRedLine(text: string): { main: Set<string>; qualifier: Set<string> } {
  const [main = '', ...rest] = text.split(/\bwithout\b/i);
  return { main: tokens(main), qualifier: tokens(rest.join(' ')) };
}

function redLineHits(
  optionText: string,
  option: ReadonlySet<string>,
  lines: readonly PlayerEntry[] | undefined,
  scope: Scope,
  player: string,
): RedLineHit[] {
  // "Sail without war-risk cover" does not provide the cover: words after "without" are not offered.
  const [offered = '', ...lacked] = optionText.split(/\bwithout\b/i);
  const provided = tokens(offered);
  const lacks = tokens(lacked.join(' '));
  const hits: RedLineHit[] = [];
  for (const line of lines ?? []) {
    const { main, qualifier } = parseRedLine(line.text);
    const sharedWords = shared(main, option);
    if (sharedWords === 0) continue;
    // "No sailings without cover": an option that provides the qualifier does not cross it.
    if (qualifier.size > 0 && coverage(qualifier, provided) >= RED_LINE_HARD_COVERAGE) continue;
    // The option itself names the forbidden thing and says it lacks the qualifier.
    const statesViolation =
      qualifier.size > 0 && coverage(qualifier, lacks) >= RED_LINE_HARD_COVERAGE;
    const hard =
      statesViolation ||
      (sharedWords >= RED_LINE_HARD_WORDS && coverage(main, option) >= RED_LINE_HARD_COVERAGE);
    hits.push({
      line: line.text,
      kind: hard ? 'hard' : 'soft',
      sharedWords,
      ...(onBoard(scope, line.source, player) ? { sourceCardId: line.source } : {}),
    });
  }
  return hits;
}

function dependencyRisk(option: ReadonlySet<string>, player: Card, scope: Scope): FeatureValue {
  const disruptive = [...option].some((t) => DISRUPTIVE.has(t));
  if (!disruptive) return { value: 0, via: [] };
  const content = new Set([...option].filter((t) => !DISRUPTIVE.has(t)));
  const deps: { tokens: Set<string>; via?: string }[] = (player.dependencies ?? []).map((d) => ({
    tokens: tokens(d.text),
    ...(onBoard(scope, d.source, player.id) ? { via: d.source } : {}),
  }));
  for (const e of scope.edges) {
    const target =
      e.from === player.id && e.kind === 'depends_on' ? scope.byId.get(e.to) : undefined;
    if (target?.title) deps.push({ tokens: tokens(target.title), via: target.id });
  }
  let value = 0;
  const via = new Set<string>();
  for (const d of deps) {
    const s = dice(content, d.tokens);
    if (s < MATCH_MIN) continue;
    if (s > value) {
      value = s;
      via.clear();
    }
    if (s === value && d.via) via.add(d.via);
  }
  return { value, via: [...via] };
}

/** Evidence cards that share an edge with the player, split by layer. */
function linked(
  option: ReadonlySet<string>,
  player: Card,
  scope: Scope,
  layer: 'evidenced' | 'said',
): FeatureValue {
  const ids = new Set<string>();
  for (const e of scope.edges) {
    if (e.kind === 'refutes') continue;
    if (e.from === player.id) ids.add(e.to);
    if (e.to === player.id) ids.add(e.from);
  }
  let value = 0;
  const via = new Set<string>();
  for (const id of ids) {
    const c = scope.byId.get(id);
    if (!c || c.id === player.id || hasRule(c) || c.layer !== layer || !c.title) continue;
    const s = dice(option, tokens(c.title));
    if (s < MATCH_MIN) continue;
    if (s > value) {
      value = s;
      via.clear();
    }
    if (s === value) via.add(c.id);
  }
  return { value, via: [...via] };
}

/**
 * A rule's preferred action boosts a player only if the rule names that player in its conditions,
 * or names a card that has an edge to or from the player (for example the evidence card that
 * represents it). A rule about the board in general says nothing about what a particular player
 * will do.
 */
function ruleAppliesTo(
  f: ReturnType<typeof firedRules>[number],
  playerId: string,
  scope: Scope,
): boolean {
  if (f.referenced.has(playerId)) return true;
  return scope.edges.some(
    (e) =>
      (e.from === playerId && f.referenced.has(e.to)) ||
      (e.to === playerId && f.referenced.has(e.from)),
  );
}

function ruleFeature(
  option: ReadonlySet<string>,
  fired: ReturnType<typeof firedRules>,
  playerId: string,
  scope: Scope,
): FeatureValue {
  const via = new Set<string>();
  for (const f of fired) {
    if (!ruleAppliesTo(f, playerId, scope)) continue;
    if (dice(option, tokens(f.then)) < RULE_MATCH_MIN) continue;
    via.add(f.card.id);
    for (const n of f.named) via.add(n);
  }
  return { value: via.size > 0 ? 1 : 0, via: [...via] };
}

const argmax = (xs: readonly number[]): number => {
  let at = 0;
  xs.forEach((x, i) => {
    if (x > (xs[at] ?? -Infinity)) at = i;
  });
  return at;
};

function analysePlayer(
  request: Level1PredictionRequest,
  scope: Scope,
  fired: ReturnType<typeof firedRules>,
  playerCardId: string,
  moveOptions: readonly string[],
): PlayerBasis {
  const player = scope.byId.get(playerCardId);
  if (!player) throw new Error(`player card ${playerCardId} is not a card of the request`);
  const raw = moveOptions.map((move) => {
    const o = tokens(move);
    const f: Record<Feature, FeatureValue> = {
      behaviour: behaviour(o, player.moves, scope, player.id),
      linkedEvidenced: linked(o, player, scope, 'evidenced'),
      interest: best(o, player.interests, scope, player.id),
      assumedGoal: best(o, player.assumedGoals, scope, player.id),
      linkedSaid: linked(o, player, scope, 'said'),
      capability: best(o, player.capabilities, scope, player.id),
      dependencyRisk: dependencyRisk(o, player, scope),
      redLineRisk: { value: 0, via: [] },
      rule: ruleFeature(o, fired, player.id, scope),
    };
    const hits = redLineHits(move, o, player.redLines, scope, player.id);
    const soft = hits.filter((h) => h.kind === 'soft');
    if (soft.length > 0) {
      f.redLineRisk = {
        value: 1,
        via: soft.flatMap((h) => (h.sourceCardId ? [h.sourceCardId] : [])),
      };
    }
    const contributions = Object.fromEntries(
      FEATURES.map((k) => [k, WEIGHTS[k] * f[k].value]),
    ) as Record<Feature, number>;
    const score = FEATURES.reduce((s, k) => s + contributions[k], 0);
    return { move, hits, f, contributions, score, excluded: hits.some((h) => h.kind === 'hard') };
  });

  const allExcluded = raw.every((r) => r.excluded);
  const kept = raw.map((r) => (allExcluded ? false : !r.excluded));
  const keptIdx = raw.flatMap((_, i) => (kept[i] ? [i] : []));
  const pool = allExcluded ? raw.map((_, i) => i) : keptIdx;

  // Softmax over the pool (shifted by the maximum for numerical stability).
  const top = Math.max(...pool.map((i) => raw[i]!.score));
  const exps = new Map(
    pool.map((i) => [i, Math.exp((raw[i]!.score - top) / CONFIDENCE_TEMPERATURE)] as const),
  );
  const total = [...exps.values()].reduce((a, b) => a + b, 0);
  const prob = (i: number) => (allExcluded ? 1 / pool.length : (exps.get(i) ?? 0) / total);

  const kinds = new Set<Feature | 'exclusion'>();
  for (const r of raw) {
    // A penalty for a weak lexical red-line match is no evidence for the predicted move.
    for (const k of FEATURES) if (k !== 'redLineRisk' && r.f[k].value > 0) kinds.add(k);
    if (r.excluded) kinds.add('exclusion');
  }
  const evidenceKinds = kinds.size;

  const winner = pool[argmax(pool.map((i) => raw[i]!.score))]!;
  const uniform = 1 / pool.length;
  const shrink = Math.min(1, evidenceKinds / ENOUGH_EVIDENCE_KINDS);
  let confidence = allExcluded ? uniform : uniform + (prob(winner) - uniform) * shrink;
  confidence = Math.min(
    confidence,
    MAX_CONFIDENCE,
    raw.some((r) => r.excluded) && !allExcluded ? EXCLUSION_CONFIDENCE_CAP : 1,
  );

  const sum = (r: (typeof raw)[number], ks: readonly Feature[]) =>
    ks.reduce((s, k) => s + r.contributions[k], 0);
  const bScores = raw.map((r) => sum(r, BEHAVIOUR_FEATURES));
  const sScores = raw.map((r) => sum(r, STATEMENT_FEATURES));
  const divergence =
    Math.max(...bScores) > 0 && Math.max(...sScores) > 0 && argmax(bScores) !== argmax(sScores);

  const used = new Set<string>([player.id]);
  for (const r of raw) {
    for (const k of FEATURES) for (const id of r.f[k].via) used.add(id);
    for (const h of r.hits) if (h.sourceCardId) used.add(h.sourceCardId);
  }

  return {
    playerCardId,
    temperature: CONFIDENCE_TEMPERATURE,
    weights: WEIGHTS,
    options: raw.map((r, i) => ({
      move: r.move,
      excluded: r.excluded,
      redLineHits: r.hits,
      features: r.f,
      contributions: r.contributions,
      score: round2(r.score),
      probability: round2(kept[i] ? prob(i) : 0),
    })),
    firedRuleCardIds: fired.map((f) => f.card.id),
    evidenceKinds,
    statementBehaviourDivergence: divergence,
    allExcluded,
    predictedMove: raw[winner]!.move,
    confidence: round2(confidence),
    // The player card first, then the other cards used in request order.
    cardIds: [
      player.id,
      ...request.cards.map((c) => c.id).filter((id) => id !== player.id && used.has(id)),
    ],
  };
}

/** The full breakdown behind a prediction, for the "why" panel of the board. Pure. */
export function explainLocalRules(
  request: Level1PredictionRequest,
  engine = LOCAL_RULES_ENGINE_ID,
): LocalRulesExplanation {
  const scope = scopeOf(request);
  const fired = firedRules(scope, request);
  return {
    engine,
    requestHash: hashJcs(request),
    players: request.players.map((p) =>
      analysePlayer(request, scope, fired, p.playerCardId, p.moveOptions),
    ),
  };
}

export interface LocalRulesEngineOptions {
  readonly engine?: string;
  readonly now?: () => Date;
}

export interface LocalRulesEngine extends Level1Engine {
  readonly target: 'local_model';
  readonly deterministic: true;
  /** Per-player breakdown of the scores, the removed options and the cards behind them. */
  explain(request: Level1PredictionRequest): LocalRulesExplanation;
}

/**
 * The default local engine. Heuristics, in the order of their weight in `WEIGHTS`:
 *
 * 1. past moves (behaviour): how much of the player's `moves` history resembles the option;
 * 2. user rules: a fired rule card whose action matches the option reads as the user's own
 *    expectation for it, but only for players the rule names (or whose linked cards it names);
 * 3. interests, assumed goals, capabilities and linked cards: lexical alignment with the option;
 * 4. dependencies: a disruptive option that touches something the player depends on is penalised;
 * 5. red lines: an option that matches a red line is removed (or penalised when the match is
 *    weak); if all options are removed the engine says so and reports uniform confidence.
 *
 * Confidence is a softmax of the scores at `CONFIDENCE_TEMPERATURE`, shrunk towards 1/n when
 * fewer than two kinds of evidence exist, and capped. It is the engine's own estimate, not a
 * probability fitted to outcomes, and the board shows it attributed ("local-rules estimates ...").
 * Matching is lexical (content words, English); it has no notion of negation or meaning.
 */
export function createLocalRulesEngine(options: LocalRulesEngineOptions = {}): LocalRulesEngine {
  const engine = options.engine ?? LOCAL_RULES_ENGINE_ID;
  const now = options.now ?? (() => new Date());
  return {
    engine,
    target: 'local_model',
    deterministic: true,
    explain: (request) => explainLocalRules(request, engine),
    predict(request) {
      try {
        const explanation = explainLocalRules(request, engine);
        const prediction: Level1Prediction = {
          engine,
          lageId: request.lageId,
          trigger: structuredClone(request.trigger),
          requestHash: explanation.requestHash,
          players: explanation.players.map((p, i) => ({
            playerCardId: p.playerCardId,
            moveOptions: [...request.players[i]!.moveOptions],
            predictedMove: p.predictedMove,
            confidence: p.confidence,
            cardIds: [...p.cardIds],
          })),
          predictedAt: now().toISOString(),
        };
        return Promise.resolve(prediction);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

/**
 * Candidate move options for a player card, to offer on the board before the user fixes the
 * closed set: the player's own past moves, then the actions of the user's rule cards that are
 * not already covered, then `extra`; `NO_NEW_ACTION` is added when that gives fewer than two.
 * No duplicates, at most `MAX_MOVE_OPTIONS`. With no history and no rules the result can still have
 * fewer than two: the board then asks the user for the options.
 */
export function buildMoveOptions(
  player: Card,
  cards: readonly Card[],
  extra: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const add = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const tk = tokens(t);
    if (
      out.some((o) => o.toLowerCase() === t.toLowerCase() || dice(tokens(o), tk) >= RULE_MATCH_MIN)
    )
      return;
    out.push(t);
  };
  (player.moves ?? []).map(textOf).forEach(add);
  for (const c of cards) if (c.rule) add(c.rule.then);
  extra.forEach(add);
  if (out.length < 2) add(NO_NEW_ACTION);
  return out.slice(0, MAX_MOVE_OPTIONS);
}

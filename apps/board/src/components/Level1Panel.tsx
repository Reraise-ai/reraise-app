// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Level 1 on one Lage (ADR-0035, ADR-0045): an engine estimates what each player will probably do
// next, from the cards on the board. Every line is attributed ("<engine> estimates ... for ...")
// and shows the move options and the cards used; nothing here is an answer, a decision or a
// recommendation, and nothing is saved. The local engine re-runs by itself (debounced) when an
// assumption changes; a cloud engine only after a click and a confirmation of its transfer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Card,
  DisclosureTransfer,
  Lage,
  Level1EngineInfo,
  Level1MoveChange,
  Level1Prediction,
  Level1Trigger,
  Stance,
} from '@worldbuilder/core';
import { formatEstimate } from '@worldbuilder/level1-engines/format';
import type { BoardClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { canonicalJson } from '../canonicalJson.js';
import { describeError } from '../errors.js';

interface Props {
  client: BoardClient;
  lageId: string;
  lage: Lage;
  /** The cards the screen may show, by id. */
  cards: ReadonlyMap<string, Card>;
  stances: ReadonlyMap<string, Stance>;
  /** Focus a card on the board (select it). */
  onFocusCard(cardId: string): void;
  /** Open another Lage (the board analysis made by escalation). */
  onOpenLage(lageId: string): void;
  /** Wait after the last change before the local engine runs again. */
  debounceMs?: number;
}

/** The wire name of an engine: the built-in one is `local`. */
const wireName = (e: Level1EngineInfo): string => (e.target === 'local_model' ? 'local' : e.engine);

/** The shape of the local engine's breakdown that the panel reads (the API gives an object). */
interface Basis {
  players: {
    playerCardId: string;
    options: {
      move: string;
      excluded: boolean;
      probability: number;
      redLineHits: { line: string; kind: string }[];
      features: Record<string, { value: number; via: string[] }>;
    }[];
    statementBehaviourDivergence?: boolean;
    allExcluded?: boolean;
  }[];
}

const FEATURE_LABEL: Record<string, string> = {
  behaviour: 'past moves',
  linkedEvidenced: 'linked evidence',
  interest: 'interests',
  assumedGoal: 'assumed goals',
  linkedSaid: 'linked statements',
  capability: 'capabilities',
  dependencyRisk: 'dependencies',
  redLineRisk: 'red lines',
  rule: 'your rules',
};

/** Fingerprint of what an assumption is on this screen: its content and your stance. */
function assumptionPrints(
  lage: Lage,
  cards: ReadonlyMap<string, Card>,
  stances: ReadonlyMap<string, Stance>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const placed of lage.cards) {
    const card = cards.get(placed.id);
    if (card?.type !== 'assumption') continue;
    const stance = stances.get(placed.id);
    out.set(
      placed.id,
      `${card.contentHash ?? ''}|${card.title}|${stance?.position ?? ''}|${stance?.weight ?? ''}`,
    );
  }
  return out;
}

export function Level1Panel(props: Props) {
  const { client, lageId, lage, cards, stances, onFocusCard, onOpenLage } = props;
  const debounceMs = props.debounceMs ?? 500;

  const [engines, setEngines] = useState<Level1EngineInfo[]>([]);
  const [engine, setEngine] = useState<string>('local-rules');
  const [prediction, setPrediction] = useState<Level1Prediction | undefined>();
  const [stale, setStale] = useState(false);
  const [changes, setChanges] = useState<Level1MoveChange[]>([]);
  const [preview, setPreview] = useState<DisclosureTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [basis, setBasis] = useState<Basis | null>(null);
  const [basisFor, setBasisFor] = useState<Set<string>>(new Set());
  const [basisNote, setBasisNote] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<{ id: string; title: string } | null>(null);

  const alive = useRef(true);
  const runSeq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const info = engines.find((e) => e.engine === engine);
  const isLocal = info === undefined || info.target === 'local_model';

  const titleOf = useCallback((id: string): string => cards.get(id)?.title ?? id, [cards]);
  const onBoard = useMemo(() => new Set(lage.cards.map((c) => c.id)), [lage.cards]);

  /** Reads the engines and the latest estimate with its staleness. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const state = await client.level1_get(lageId);
      if (!alive.current) return;
      setEngines(state.engines);
      setPrediction(state.prediction);
      setStale(state.prediction !== undefined && state.stale === true);
      setSkipped((state.skipped ?? []).map((c) => c.cardId));
    } catch (e) {
      if (alive.current) setError(describeError(e));
    }
  }, [client, lageId]);

  // First read: the engines on offer and an estimate that is still held in memory.
  useEffect(() => {
    void (async () => {
      try {
        const state = await client.level1_get(lageId);
        if (!alive.current) return;
        setEngines(state.engines);
        setPrediction(state.prediction);
        setStale(state.prediction !== undefined && state.stale === true);
        const held = state.prediction?.engine;
        const usable = state.engines.find((e) => e.engine === held && e.available);
        const fallback = state.engines.find((e) => e.available && e.target === 'local_model');
        if (usable ?? fallback) setEngine((usable ?? fallback)!.engine);
      } catch (e) {
        if (alive.current) setError(describeError(e));
      }
    })();
  }, [client, lageId]);

  const run = useCallback(
    async (
      trigger: Level1Trigger,
      send?: { transferId: string; confirmationToken: string },
    ): Promise<void> => {
      const target = engines.find((e) => e.engine === engine);
      if (!target) return;
      const seq = ++runSeq.current;
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        const res = await client.level1_predict(lageId, {
          engine: wireName(target),
          trigger,
          ...(send ? send : {}),
        });
        // Latest wins: an answer to an older call is dropped (the service does the same).
        if (!alive.current || seq !== runSeq.current) return;
        setSkipped((res.skipped ?? []).map((c) => c.cardId));
        if (res.status === 'predicted' && res.prediction) {
          setPrediction(res.prediction as Level1Prediction);
          setStale(false);
          setChanges(res.changes ?? []);
          setPreview(null);
          setBasis(null);
          setBasisFor(new Set());
          setBasisNote(null);
          setAnalysis(null);
        } else if (res.status === 'confirmation_required' && res.transfer) {
          setPreview(res.transfer as DisclosureTransfer);
        } else if (res.status === 'no_players') {
          setNote(
            'No actor card on this board is available to the engine, so there is nothing to estimate.',
          );
        } else {
          setNote('The board changed while the engine ran, so that estimate was dropped.');
          void refresh();
        }
      } catch (e) {
        if (!alive.current || seq !== runSeq.current) return;
        setError(describeError(e));
        if (e instanceof ApiError && e.isConflict) {
          setPreview(null);
          void refresh();
        }
      } finally {
        if (alive.current && seq === runSeq.current) setBusy(false);
      }
    },
    [client, lageId, engine, engines, refresh],
  );

  async function confirmAndSend(transfer: DisclosureTransfer) {
    setBusy(true);
    setError(null);
    try {
      const confirmation = await client.disclosure_confirm(
        transfer.transferId,
        transfer.payloadHash,
      );
      if (!confirmation.token) throw new Error('The service issued no confirmation token.');
      await run(
        { kind: 'manual' },
        {
          transferId: transfer.transferId,
          confirmationToken: confirmation.token,
        },
      );
    } catch (e) {
      if (alive.current) {
        setError(describeError(e));
        setBusy(false);
        setPreview(null);
      }
    }
  }

  // What-if: when an assumption on the board changes (placed, removed, edited, or your stance on
  // it), the local engine runs again after the changes have settled; any other change only
  // refreshes the stale badge. A cloud engine never runs by itself.
  const prints = useMemo(() => assumptionPrints(lage, cards, stances), [lage, cards, stances]);
  const boardKey = useMemo(
    () =>
      JSON.stringify([
        lage.cards.map((c) => c.id),
        [...cards.values()].map((c) => c.contentHash ?? ''),
        [...prints],
      ]),
    [lage.cards, cards, prints],
  );
  const latest = useRef({ auto, isLocal, run, refresh, prints });
  latest.current = { auto, isLocal, run, refresh, prints };
  const seen = useRef({ key: boardKey, prints });
  const pending = useRef(new Set<string>());
  // Keyed on the board's content only: a re-render with the same content must not cancel the
  // timer (the maps are new objects after every reload).
  useEffect(() => {
    if (seen.current.key === boardKey) return;
    const before = seen.current.prints;
    const now = latest.current.prints;
    seen.current = { key: boardKey, prints: now };
    for (const id of new Set([...before.keys(), ...now.keys()])) {
      if (before.get(id) !== now.get(id)) pending.current.add(id);
    }
    const timer = setTimeout(() => {
      const ids = [...pending.current];
      pending.current = new Set();
      const l = latest.current;
      if (l.auto && l.isLocal && ids.length > 0) {
        void l.run({ kind: 'assumption_changed', cardIds: ids });
      } else void l.refresh();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [boardKey, debounceMs]);

  async function toggleBasis(playerCardId: string) {
    const next = new Set(basisFor);
    if (next.has(playerCardId)) {
      next.delete(playerCardId);
      setBasisFor(next);
      return;
    }
    next.add(playerCardId);
    setBasisFor(next);
    if (basis) return;
    try {
      const state = await client.level1_get(lageId, true);
      if (!alive.current) return;
      if (state.basis) {
        setBasis(state.basis as unknown as Basis);
        setBasisNote(null);
      } else {
        setBasisNote(
          state.stale
            ? 'The board changed since this estimate; estimate again to see its basis.'
            : 'This engine gives no basis for its estimate.',
        );
      }
    } catch (e) {
      if (alive.current) setBasisNote(describeError(e));
    }
  }

  async function escalate(playerCardId: string) {
    setError(null);
    try {
      const created = await client.level1_escalate(lageId, playerCardId);
      if (alive.current && created.id) setAnalysis({ id: created.id, title: created.title });
    } catch (e) {
      if (alive.current) {
        setError(describeError(e));
        void refresh();
      }
    }
  }

  /** A card as a button that focuses it on the board (a card that is not placed is plain text). */
  const cardButton = (id: string, testId?: string) =>
    onBoard.has(id) ? (
      <button
        type="button"
        className="wb-link"
        {...(testId ? { 'data-testid': testId } : {})}
        onClick={() => onFocusCard(id)}
      >
        {titleOf(id)}
      </button>
    ) : (
      <span {...(testId ? { 'data-testid': testId } : {})}>{titleOf(id)} (not placed)</span>
    );

  return (
    <section aria-labelledby="level1-h" data-testid="level1-panel">
      <h2 id="level1-h">Level 1: next-move estimates</h2>
      <p className="wb-muted">
        An engine estimates what each player on this board will probably do next, from the cards on
        it and your rules. An estimate is not a decision. It is not saved and counts nowhere.
      </p>
      <div className="wb-row">
        <div className="wb-field">
          <label htmlFor="level1-engine">Engine</label>
          <select
            id="level1-engine"
            data-testid="level1-engine"
            value={engine}
            disabled={busy}
            onChange={(e) => {
              setEngine(e.target.value);
              setPreview(null);
              setNote(null);
            }}
          >
            {engines.map((e) => (
              <option key={e.engine} value={e.engine} disabled={!e.available}>
                {e.label ?? e.engine}
                {e.target === 'cloud_model' ? ' (cloud, each use needs your confirmation)' : ''}
                {e.available ? '' : ` (unavailable: ${e.reason ?? 'not configured'})`}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="wb-primary"
          data-testid="level1-run"
          disabled={busy || !info?.available}
          onClick={() => void run({ kind: 'manual' })}
        >
          Estimate next moves
        </button>
      </div>
      <label className="wb-check">
        <input
          type="checkbox"
          data-testid="level1-auto"
          checked={auto && isLocal}
          disabled={!isLocal}
          onChange={(e) => setAuto(e.target.checked)}
        />{' '}
        Estimate again when an assumption changes
        {!isLocal && ' (not for a cloud engine: it needs a click and a confirmation)'}
      </label>

      <div aria-live="polite">
        {busy && (
          <p className="wb-muted" data-testid="level1-busy">
            Working.
          </p>
        )}
        {error && (
          <p role="alert" className="wb-error" data-testid="level1-error">
            {error}
          </p>
        )}
        {note && (
          <p className="wb-muted" data-testid="level1-note">
            {note}
          </p>
        )}
      </div>

      {skipped.length > 0 && (
        <p className="wb-muted" role="note" data-testid="level1-skipped">
          Left out of the request because the store gave them in a form that is not a valid card:{' '}
          {skipped.map((id) => titleOf(id)).join(', ')}.
        </p>
      )}

      {preview && (
        <div data-testid="level1-preview">
          <p className="wb-warning" role="note">
            This engine runs outside this device. Your stances never leave. This is the complete
            envelope: nothing else is sent, and only after you confirm this one transfer.
          </p>
          <dl className="wb-envelope">
            <dt>Connector</dt>
            <dd data-testid="level1-envelope-connector">{preview.preview.connectorId}</dd>
            <dt>Request (question, moves per player, output schema)</dt>
            <dd>
              <pre className="wb-json" tabIndex={0} data-testid="level1-envelope-request">
                {canonicalJson(preview.preview.request)}
              </pre>
            </dd>
          </dl>
          <ul className="wb-list" aria-label="Cards that would be sent">
            {preview.preview.objects.map((c) => (
              <li key={c.id} data-testid={`level1-send-${c.id}`}>
                <strong>{c.title}</strong>
                <pre className="wb-json" tabIndex={0} aria-label={`Every field of ${c.title}`}>
                  {canonicalJson(c)}
                </pre>
              </li>
            ))}
          </ul>
          <p className="wb-muted">
            Payload <span className="wb-mono">{preview.payloadHash}</span>, valid until{' '}
            {preview.expiresAt}.
          </p>
          <div className="wb-row">
            <button
              type="button"
              className="wb-primary"
              data-testid="level1-confirm"
              disabled={busy}
              onClick={() => void confirmAndSend(preview)}
            >
              Confirm this transfer
            </button>
            <button
              type="button"
              data-testid="level1-cancel"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {prediction && (
        <div
          data-testid="level1-results"
          data-stale={String(stale)}
          data-engine={prediction.engine}
        >
          {stale && (
            <p className="wb-warning" role="status" data-testid="level1-stale">
              <span className="wb-badge" data-kind="stale">
                Stale
              </span>
              The board changed since this estimate. Estimate again
              {isLocal ? '' : ' (a cloud engine needs a new preview and your confirmation)'}.
            </p>
          )}
          <ul className="wb-list" aria-label="Estimates per player">
            {prediction.players.map((p) => {
              const moved = changes.find((c) => c.playerCardId === p.playerCardId);
              const playerBasis = basis?.players.find((b) => b.playerCardId === p.playerCardId);
              return (
                <li key={p.playerCardId} data-testid={`level1-player-${p.playerCardId}`}>
                  <h3 className="wb-card-title">{titleOf(p.playerCardId)}</h3>
                  <p data-testid={`level1-estimate-${p.playerCardId}`}>
                    {formatEstimate({
                      engine: prediction.engine,
                      predictedMove: p.predictedMove,
                      confidence: p.confidence,
                    })}
                  </p>
                  {moved && !stale && (
                    <p className="wb-muted" data-testid={`level1-changed-${p.playerCardId}`}>
                      Changed since the last estimate: from &quot;{moved.from}&quot; to &quot;
                      {moved.to}&quot;.
                    </p>
                  )}
                  <h4 className="wb-subhead">Moves considered</h4>
                  <ul aria-label={`Moves considered for ${titleOf(p.playerCardId)}`}>
                    {p.moveOptions.map((m, i) => (
                      <li key={m} data-testid={`level1-option-${p.playerCardId}-${i}`}>
                        {m}
                        {m === p.predictedMove && <span className="wb-muted"> (estimated)</span>}
                      </li>
                    ))}
                  </ul>
                  <h4 className="wb-subhead">Cards used</h4>
                  <ul
                    className="wb-inline"
                    aria-label={`Cards used for ${titleOf(p.playerCardId)}`}
                  >
                    {p.cardIds.map((id) => (
                      <li key={id}>{cardButton(id, `level1-card-${p.playerCardId}-${id}`)}</li>
                    ))}
                  </ul>
                  <div className="wb-row">
                    <button
                      type="button"
                      data-testid={`level1-basis-toggle-${p.playerCardId}`}
                      aria-expanded={basisFor.has(p.playerCardId)}
                      onClick={() => void toggleBasis(p.playerCardId)}
                    >
                      {basisFor.has(p.playerCardId) ? 'Hide basis' : 'Show basis'}
                    </button>
                    <button
                      type="button"
                      data-testid={`level1-escalate-${p.playerCardId}`}
                      disabled={stale || busy}
                      onClick={() => void escalate(p.playerCardId)}
                    >
                      Escalate to board analysis
                    </button>
                  </div>
                  {basisFor.has(p.playerCardId) && (
                    <div data-testid={`level1-basis-${p.playerCardId}`}>
                      {playerBasis ? (
                        <BasisView
                          basis={playerBasis}
                          playerId={p.playerCardId}
                          cardButton={cardButton}
                        />
                      ) : (
                        <p className="wb-muted" data-testid={`level1-basis-note-${p.playerCardId}`}>
                          {basisNote ?? 'Loading the basis.'}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {analysis && (
        <p data-testid="level1-analysis">
          Board analysis created: <strong>{analysis.title}</strong>{' '}
          <button
            type="button"
            data-testid="level1-open-analysis"
            onClick={() => onOpenLage(analysis.id)}
          >
            Open the analysis
          </button>
        </p>
      )}
    </section>
  );
}

function BasisView(props: {
  basis: Basis['players'][number];
  playerId: string;
  cardButton(id: string): React.ReactNode;
}) {
  const { basis, playerId } = props;
  return (
    <>
      <p className="wb-muted">
        How the local engine weighed each move. The share is the engine&apos;s own measure, not a
        probability.
        {basis.statementBehaviourDivergence &&
          ' What the player says and what it did point to different moves; its past moves weigh more.'}
        {basis.allExcluded && ' Every move crosses a red line of the player.'}
      </p>
      <table>
        <caption className="wb-visually-hidden">Basis of the estimate</caption>
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Share (0 to 1)</th>
            <th scope="col">Based on</th>
          </tr>
        </thead>
        <tbody>
          {basis.options.map((o, i) => (
            <tr key={o.move} data-testid={`level1-basis-option-${playerId}-${i}`}>
              <th scope="row">
                {o.move}
                {o.excluded && <span className="wb-muted"> (removed: crosses a red line)</span>}
              </th>
              <td>{o.probability.toFixed(2)}</td>
              <td>
                {Object.entries(o.features)
                  .filter(([, f]) => f.value > 0)
                  .map(([name, f]) => (
                    <div key={name}>
                      {FEATURE_LABEL[name] ?? name}: {f.value.toFixed(2)}
                      {f.via.length > 0 && (
                        <ul className="wb-inline" aria-label={`Cards behind ${name}`}>
                          {f.via.map((id) => (
                            <li key={id}>{props.cardButton(id)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                {o.redLineHits.map((h) => (
                  <div key={h.line} className="wb-muted">
                    red line ({h.kind}): {h.line}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

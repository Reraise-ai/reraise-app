// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Card,
  EdgeKind,
  Lage,
  LageVersion,
  Proposal,
  Stance,
  StanceInput,
} from '@worldbuilder/core';
import { ApiError, type BoardClient } from '../api/client.js';
import { createProposalPoller, mergeProposals } from '../api/proposalPoller.js';
import { describeError } from '../errors.js';
import {
  addEdge,
  moveCard,
  nextFreePosition,
  placeCard,
  removeCard,
  removeEdge,
  reverseEdge,
  setEdgeKind,
  type DrawnEdgeKind,
} from '../lageModel.js';
import { BoardCanvas } from './BoardCanvas.js';
import { DecisionPanel } from './DecisionPanel.js';
import { DisclosurePanel } from './DisclosurePanel.js';
import { EdgePanel } from './EdgePanel.js';
import { InspectorPanel } from './InspectorPanel.js';
import { Level1Panel } from './Level1Panel.js';
import { ProposalsPanel } from './ProposalsPanel.js';
import { RulesPanel } from './RulesPanel.js';
import { SearchPanel } from './SearchPanel.js';

interface Props {
  client: BoardClient;
  lageId: string;
  worldId: string | undefined;
  pollIntervalMs?: number;
  /** Wait before the local level-1 engine runs again after an assumption changed (ms). */
  level1DebounceMs?: number;
  onClose(): void;
  /** Open another Lage, for example the board analysis made from a level-1 estimate. */
  onOpenLage?(lageId: string): void;
}

interface Loaded {
  card: Card;
  lage: Lage;
  cards: Map<string, Card>;
  stances: Map<string, Stance>;
}

/** One open Lage: canvas, search, edges, proposals, disclosure and the stance overlay. */
export function Workbench({
  client,
  lageId,
  worldId,
  pollIntervalMs,
  level1DebounceMs,
  onClose,
  onOpenLage,
}: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [edgeKind, setNextEdgeKind] = useState<DrawnEdgeKind>('supports');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<LageVersion[]>([]);
  const [asOf, setAsOf] = useState<number | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const asOfRef = useRef<number | null>(null);
  loadedRef.current = loaded;
  asOfRef.current = asOf;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Reads the Lage and everything the screen may show about its cards (one package). */
  const load = useCallback(async (): Promise<void> => {
    try {
      const card = await client.lage_get(lageId);
      if (!card.lage) throw new Error('This card is not a Lage.');
      const cards = new Map<string, Card>();
      const stances = new Map<string, Stance>();
      const wid = worldId ?? card.worlds?.[0];
      if (wid && card.lage.cards.length > 0) {
        const pkg = await client.context_package_get({ worldId: wid, lageId });
        for (const item of pkg.items) {
          if (item.card.id) cards.set(item.card.id, item.card);
          if (item.stance) stances.set(item.card.id!, item.stance);
        }
      }
      if (!alive.current) return;
      let nextHistory: LageVersion[] = [];
      try {
        nextHistory = (await client.lage_versions(lageId)).versions;
      } catch {
        // A missing archive must not blank the current board.
        nextHistory = [];
      }
      if (!alive.current) return;
      setHistory(nextHistory);
      setAsOf((index) => (index !== null && index < nextHistory.length ? index : null));
      setLoaded({ card, lage: card.lage, cards, stances });
    } catch (e) {
      if (alive.current) setMessage({ kind: 'error', text: describeError(e) });
    }
  }, [client, lageId, worldId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Proposals: poll with the change cursor every 2 seconds while this Lage is open (ADR-0032).
  // Without a lageId: a proposal that names no Lage (an outcome, a comment, a card not placed
  // yet) must be decidable too. The panel marks the ones that belong to another Lage.
  useEffect(() => {
    const poller = createProposalPoller({
      client,
      ...(pollIntervalMs !== undefined ? { intervalMs: pollIntervalMs } : {}),
      onSuccess: () => alive.current && setPollError(null),
      onChanges: (changed) => {
        if (!alive.current) return;
        setProposals((known) => mergeProposals(known, changed));
        if (changed.some((p) => p.status === 'accepted')) void load();
      },
      onError: (e) => alive.current && setPollError(describeError(e)),
    });
    poller.start();
    return () => poller.stop();
  }, [client, lageId, pollIntervalMs, load]);

  /** Saves an edit of the Lage with the version guard; edits are applied one after another. */
  const edit = useCallback(
    (change: (lage: Lage) => Lage, done?: string) => {
      queue.current = queue.current.then(async () => {
        if (asOfRef.current !== null) return;
        const current = loadedRef.current;
        if (!current) return;
        const next = change(current.lage);
        if (next === current.lage) return;
        setSaving(true);
        try {
          const saved = await client.lage_save(lageId, next);
          if (!saved.lage) throw new Error('The service returned no Lage.');
          const updated = { ...current, card: saved, lage: saved.lage };
          loadedRef.current = updated;
          if (alive.current) {
            setLoaded(updated);
            setMessage(done ? { kind: 'info', text: done } : null);
          }
          // New placements need the card for display.
          if (saved.lage.cards.some((c) => !updated.cards.has(c.id))) await load();
        } catch (e) {
          if (e instanceof ApiError && e.isConflict) {
            if (alive.current)
              setMessage({
                kind: 'error',
                text: 'The board changed elsewhere. It was reloaded; repeat your change.',
              });
            await load();
          } else if (alive.current) {
            setMessage({ kind: 'error', text: describeError(e) });
          }
        } finally {
          if (alive.current) setSaving(false);
        }
      });
      return queue.current;
    },
    [client, lageId, load],
  );

  const decide = useCallback(
    async (p: Proposal, decision: 'accept' | 'reject') => {
      const updated =
        decision === 'accept'
          ? await client.proposal_accept(p.id)
          : await client.proposal_reject(p.id);
      setProposals((known) => mergeProposals(known, [updated]));
      setMessage({
        kind: 'info',
        text: decision === 'accept' ? 'Proposal accepted.' : 'Proposal rejected.',
      });
      if (decision === 'accept') await load();
    },
    [client, load],
  );

  const saveStance = useCallback(
    async (cardId: string, input: StanceInput) => {
      const stance = await client.stance_save(cardId, input);
      setLoaded((l) => (l ? { ...l, stances: new Map(l.stances).set(cardId, stance) } : l));
    },
    [client],
  );

  const placedIds = useMemo(() => {
    const board = (asOf !== null ? history[asOf]?.lage : undefined) ?? loaded?.lage;
    return new Set(board?.cards.map((c) => c.id) ?? []);
  }, [loaded, history, asOf]);
  // Cards named by proposals but not on the board yet: fetched once so you see what you accept.
  const [extraCards, setExtraCards] = useState<Map<string, Card>>(new Map());
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const wanted = new Set<string>();
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const pl = p.payload as Record<string, unknown>;
      for (const key of ['cardId', 'from', 'to', 'decisionId']) {
        const v = pl[key];
        if (typeof v === 'string' && !asked.current.has(v) && !loaded?.cards.has(v)) wanted.add(v);
      }
    }
    if (wanted.size === 0) return;
    wanted.forEach((id) => asked.current.add(id));
    void Promise.all([...wanted].map((id) => client.card_get(id).catch(() => undefined))).then(
      (found) => {
        const cards = found.filter((c): c is Card => !!c?.id);
        if (!alive.current || cards.length === 0) return;
        setExtraCards((prev) => new Map([...prev, ...cards.map((c) => [c.id!, c] as const)]));
      },
    );
  }, [proposals, loaded, client]);
  const titles = useMemo(
    () => new Map<string, Card>([...extraCards, ...(loaded?.cards ?? [])]),
    [loaded, extraCards],
  );

  if (!loaded) {
    return (
      <main className="wb-page">
        <button type="button" onClick={onClose}>
          Back to the Lagen
        </button>
        {message ? (
          <p role="alert" className="wb-error" data-testid="board-error">
            {message.text}
          </p>
        ) : (
          <p className="wb-muted">Loading the board.</p>
        )}
      </main>
    );
  }
  const { lage } = loaded;
  const archived = asOf !== null ? history[asOf] : undefined;
  const viewed = archived?.lage ?? lage;
  const frozen = archived !== undefined;

  return (
    <div className="wb-workbench" data-testid="workbench">
      <main className="wb-canvas-wrap" aria-label="Board">
        <div className="wb-status" data-testid="board-status">
          <button type="button" onClick={onClose} data-testid="board-close">
            Lagen
          </button>{' '}
          <strong data-testid="board-title">{loaded.card.title}</strong>{' '}
          <span className="wb-muted" data-testid="board-question">
            {viewed.question}
          </span>
          <span className="wb-muted"> · version </span>
          <span className="wb-muted" data-testid="board-version">
            {viewed.version}
          </span>
          {history.length > 0 && (
            <label className="wb-muted">
              {' '}
              Board date{' '}
              <input
                type="range"
                min={0}
                max={history.length}
                step={1}
                value={asOf === null ? history.length : asOf}
                data-testid="time-slider"
                aria-label="Board date"
                aria-valuetext={archived ? archived.archivedAt : 'Now'}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setAsOf(n >= history.length ? null : n);
                }}
              />{' '}
              {archived ? archived.archivedAt : 'Now'}
            </label>
          )}
          {archived && (
            <p className="wb-muted" data-testid="time-banner" role="status">
              Showing the board as of {archived.archivedAt}. This view is not saved.
            </p>
          )}
          {saving && <span className="wb-muted"> · saving</span>}
          {message && (
            <div
              data-testid="board-message"
              className={message.kind === 'error' ? 'wb-error' : 'wb-muted'}
              role={message.kind === 'error' ? 'alert' : 'status'}
            >
              {message.text}
            </div>
          )}
        </div>
        <BoardCanvas
          lage={viewed}
          readOnly={frozen}
          cards={loaded.cards}
          stances={loaded.stances}
          selectedCardId={selectedCardId}
          selectedEdgeKey={selectedEdgeKey}
          onMove={(id, x, y) => void edit((l) => moveCard(l, id, Math.round(x), Math.round(y)))}
          onConnect={(from, to) => void edit((l) => addEdge(l, from, to, edgeKind), 'Edge drawn.')}
          onSelect={({ cardId, edgeKey }) => {
            setSelectedCardId(cardId);
            setSelectedEdgeKey(edgeKey);
          }}
        />
      </main>
      <aside className="wb-sidebar" aria-label="Board tools">
        {viewed.options.length > 0 && (
          <section aria-labelledby="options-h">
            <h2 id="options-h">Options</h2>
            <ul className="wb-list" data-testid="board-options">
              {viewed.options.map((option) => (
                <li key={option}>{option}</li>
              ))}
            </ul>
          </section>
        )}
        <RulesPanel
          client={client}
          lageId={lageId}
          lageVersion={lage.version}
          worldId={worldId ?? loaded.card.worlds?.[0]}
          cards={loaded.cards}
          onFocusCard={(id) => {
            setSelectedEdgeKey(null);
            setSelectedCardId(id);
          }}
        />
        <ProposalsPanel
          proposals={proposals}
          currentLageId={lageId}
          titles={titles}
          onDecide={decide}
          pollError={pollError}
        />
        <SearchPanel
          client={client}
          worldId={worldId ?? loaded.card.worlds?.[0]}
          placedIds={placedIds}
          disabled={saving || frozen}
          onPlace={(card) => {
            if (!card.id) return;
            const id = card.id;
            void edit((l) => {
              const { x, y } = nextFreePosition(l);
              return placeCard(l, id, x, y);
            }, `Placed "${card.title}".`);
          }}
        />
        <EdgePanel
          lage={viewed}
          cards={loaded.cards}
          edgeKind={edgeKind}
          onEdgeKind={setNextEdgeKind}
          selectedEdgeKey={selectedEdgeKey}
          onSelectEdge={setSelectedEdgeKey}
          disabled={saving || frozen}
          onAdd={(from, to, kind: EdgeKind) =>
            void edit((l) => addEdge(l, from, to, kind), 'Edge drawn.')
          }
          onReverse={(e) => {
            setSelectedEdgeKey(null);
            void edit((l) => reverseEdge(l, e), 'Edge reversed.');
          }}
          onDelete={(e) => {
            setSelectedEdgeKey(null);
            void edit((l) => removeEdge(l, e), 'Edge deleted.');
          }}
          onSetKind={(e, kind) => {
            setSelectedEdgeKey(null);
            void edit((l) => setEdgeKind(l, e, kind), 'Edge changed.');
          }}
        />
        <InspectorPanel
          client={client}
          card={selectedCardId ? loaded.cards.get(selectedCardId) : undefined}
          cardId={selectedCardId}
          boardCards={[...loaded.cards.values()].filter(
            (c) => c.id !== undefined && placedIds.has(c.id),
          )}
          stance={selectedCardId ? loaded.stances.get(selectedCardId) : undefined}
          onSaveStance={saveStance}
          removeDisabled={saving || frozen}
          {...(selectedCardId
            ? {
                onRemove: () => {
                  const id = selectedCardId;
                  setSelectedCardId(null);
                  void edit((l) => removeCard(l, id), 'Card removed from the board.');
                },
              }
            : {})}
        />
        <DecisionPanel
          client={client}
          cards={[...loaded.cards.values()].filter(
            (c) => c.id !== undefined && placedIds.has(c.id),
          )}
          disabled={saving || frozen}
        />
        {/* Level 1 stays on the stored Lage. The slider only changes the board view. */}
        <Level1Panel
          client={client}
          lageId={lageId}
          lage={lage}
          cards={loaded.cards}
          stances={loaded.stances}
          onFocusCard={(id) => {
            setSelectedEdgeKey(null);
            setSelectedCardId(id);
          }}
          onOpenLage={(id) => onOpenLage?.(id)}
          {...(level1DebounceMs !== undefined ? { debounceMs: level1DebounceMs } : {})}
        />
        <DisclosurePanel
          client={client}
          worldId={worldId ?? loaded.card.worlds?.[0]}
          lageId={lageId}
          question={lage.question}
          options={lage.options}
          placedIds={lage.cards.map((c) => c.id)}
          titles={titles}
        />
      </aside>
    </div>
  );
}

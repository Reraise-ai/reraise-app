// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useState } from 'react';
import type {
  Card,
  ContextPackage,
  DeniedCard,
  DisclosureTransfer,
  DisclosureTarget,
} from '@worldbuilder/core';
import type { BoardClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { describeError } from '../errors.js';
import { canonicalJson } from '../canonicalJson.js';
import { LAYER_LABEL, layerOf } from './CardNode.js';

interface Props {
  client: BoardClient;
  worldId: string | undefined;
  lageId: string;
  question: string;
  options: readonly string[];
  /** Ids of the cards placed on the board. */
  placedIds: readonly string[];
  titles: ReadonlyMap<string, Card>;
}

type Target = Extract<DisclosureTarget, 'local_model' | 'cloud_model'>;

type View =
  | { step: 'idle' }
  | { step: 'busy'; what: string }
  | { step: 'package'; target: Target; pkg: ContextPackage }
  | { step: 'preview'; transfer: DisclosureTransfer; denied: DeniedCard[] }
  | { step: 'blocked'; denied: DeniedCard[]; reason: string }
  | { step: 'error'; message: string };

const NOT_CLEARED = 'not cleared for cloud_model by the gate rules';

/** Denied ids for a cloud transfer: what was asked for minus what the gate cleared. */
export function deniedFor(requested: readonly string[], cleared: readonly string[]): DeniedCard[] {
  const ok = new Set(cleared);
  return requested.filter((id) => !ok.has(id)).map((cardId) => ({ cardId, reason: NOT_CLEARED }));
}

/**
 * Context package for a target (context_package_get) with the gate result. Local model: the
 * package the service builds. Cloud model: a per-transfer flow of preview, your confirmation
 * and one send; nothing leaves without it (AC-26). Stances never appear here.
 */
export function DisclosurePanel(props: Props) {
  const { client, worldId, lageId, placedIds, titles } = props;
  const [target, setTarget] = useState<Target>('local_model');
  const [view, setView] = useState<View>({ step: 'idle' });

  async function run() {
    if (!worldId) {
      setView({ step: 'error', message: 'No world is loaded.' });
      return;
    }
    if (target === 'local_model') {
      setView({ step: 'busy', what: 'Building the package' });
      try {
        const pkg = await client.context_package_get({ worldId, lageId, question: props.question });
        setView({ step: 'package', target, pkg });
      } catch (e) {
        setView({ step: 'error', message: describeError(e) });
      }
      return;
    }
    setView({ step: 'busy', what: 'Checking what the gate clears for the cloud' });
    try {
      const transfer = await client.disclosure_transfer_preview({
        connectorId: 'board-context-package',
        purpose: 'context_package',
        request: { question: props.question, options: [...props.options] },
        cardIds: [...placedIds],
      });
      setView({ step: 'preview', transfer, denied: deniedFor(placedIds, transfer.cardIds) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setView({
          step: 'blocked',
          reason: `The gate clears no card of this board for a cloud model${
            e.problem?.detail ? ` (${e.problem.detail})` : ''
          }.`,
          denied: deniedFor(placedIds, []),
        });
      } else {
        setView({ step: 'error', message: describeError(e) });
      }
    }
  }

  async function confirmAndSend(transfer: DisclosureTransfer) {
    if (!worldId) return;
    setView({ step: 'busy', what: 'Confirming and sending this one transfer' });
    try {
      const confirmation = await client.disclosure_confirm(
        transfer.transferId,
        transfer.payloadHash,
      );
      if (!confirmation.token) throw new Error('The service issued no confirmation token.');
      const pkg = await client.context_package_get({
        worldId,
        lageId,
        question: props.question,
        transferId: transfer.transferId,
        confirmationToken: confirmation.token,
      });
      setView({ step: 'package', target: 'cloud_model', pkg });
    } catch (e) {
      setView({ step: 'error', message: describeError(e) });
    }
  }

  return (
    <section aria-labelledby="context-h" data-testid="context-panel">
      <h2 id="context-h">Context package</h2>
      <div className="wb-row">
        <div className="wb-field">
          <label htmlFor="context-target">Target</label>
          <select
            id="context-target"
            data-testid="context-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as Target);
              setView({ step: 'idle' });
            }}
          >
            <option value="local_model">Screen view of the package</option>
            <option value="cloud_model">cloud_model</option>
          </select>
        </div>
        <button
          type="button"
          data-testid="context-run"
          onClick={() => void run()}
          disabled={view.step === 'busy' || placedIds.length === 0}
        >
          Context package
        </button>
      </div>
      {target === 'cloud_model' && <CloudWarning />}
      <div aria-live="polite" data-testid="context-result">
        {view.step === 'busy' && <p className="wb-muted">{view.what}.</p>}
        {view.step === 'error' && (
          <p role="alert" className="wb-error" data-testid="context-error">
            {view.message}
          </p>
        )}
        {view.step === 'blocked' && (
          <div data-testid="context-blocked">
            <p role="alert" className="wb-error">
              {view.reason} Nothing will be sent.
            </p>
            <DeniedList denied={view.denied} titles={titles} />
          </div>
        )}
        {view.step === 'preview' && (
          <TransferPreview
            transfer={view.transfer}
            denied={view.denied}
            titles={titles}
            onConfirm={() => void confirmAndSend(view.transfer)}
            onCancel={() => setView({ step: 'idle' })}
          />
        )}
        {view.step === 'package' && view.target !== view.pkg.target && (
          <p className="wb-muted" data-testid="context-target-note">
            The board session is a screen caller, so the service answers as {view.pkg.target}. A
            local model registered with <code>worldbuilder agent add</code> receives its own
            gate-cleared package over its connection.
          </p>
        )}
        {view.step === 'package' && <PackageResult pkg={view.pkg} titles={titles} />}
      </div>
    </section>
  );
}

function CloudWarning() {
  return (
    <p className="wb-warning" role="note" data-testid="context-cloud-warning">
      A cloud model runs outside this device. Your stances never leave. Other private cards leave
      only if the gate clears them and you confirm this transfer.
    </p>
  );
}

function DeniedList({
  denied,
  titles,
}: {
  denied: readonly DeniedCard[];
  titles: ReadonlyMap<string, Card>;
}) {
  if (denied.length === 0) return <p className="wb-muted">No card was withheld.</p>;
  return (
    <>
      <h3>Withheld by the gate ({denied.length})</h3>
      <ul className="wb-list" aria-label="Withheld cards">
        {denied.map((d) => (
          <li key={d.cardId} data-testid={`context-denied-${d.cardId}`}>
            {titles.get(d.cardId)?.title && <div>{titles.get(d.cardId)?.title}</div>}
            <span className="wb-pkg-denied">{d.cardId}</span>{' '}
            <span className="wb-muted">{d.reason}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function TransferPreview(props: {
  transfer: DisclosureTransfer;
  denied: DeniedCard[];
  titles: ReadonlyMap<string, Card>;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { transfer, denied, titles } = props;
  return (
    <div data-testid="context-preview">
      <h3>This would be sent ({transfer.cardIds.length})</h3>
      <p className="wb-muted">
        This is the complete envelope. Nothing else leaves, and only after you confirm.
      </p>
      <dl className="wb-envelope">
        <dt>Target</dt>
        <dd data-testid="context-envelope-target">{transfer.preview.target}</dd>
        <dt>Connector</dt>
        <dd data-testid="context-envelope-connector">{transfer.preview.connectorId}</dd>
        <dt>Request (question, options, output schema)</dt>
        <dd>
          <pre className="wb-json" tabIndex={0} data-testid="context-envelope-request">
            {canonicalJson(transfer.preview.request)}
          </pre>
        </dd>
      </dl>
      <ul className="wb-list" aria-label="Cards that would be sent">
        {transfer.preview.objects.map((c) => (
          <li key={c.id} data-testid={`context-send-${c.id}`}>
            <strong>{c.title}</strong>
            <pre
              className="wb-json"
              tabIndex={0}
              aria-label={`Every field of ${c.title}`}
              data-testid={`context-send-json-${c.id}`}
            >
              {canonicalJson(c)}
            </pre>
          </li>
        ))}
      </ul>
      <DeniedList denied={denied} titles={titles} />
      <p className="wb-muted">
        Payload <span className="wb-mono">{transfer.payloadHash}</span>, valid until{' '}
        {transfer.expiresAt}.
      </p>
      <div className="wb-row">
        <button
          type="button"
          className="wb-primary"
          data-testid="context-confirm"
          onClick={props.onConfirm}
        >
          Confirm this transfer
        </button>
        <button type="button" data-testid="context-cancel" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The gate result of a package. It never shows stances: they are for this screen only. */
export function PackageResult({
  pkg,
  titles,
}: {
  pkg: ContextPackage;
  titles: ReadonlyMap<string, Card>;
}) {
  return (
    <div data-testid="context-package" data-target={pkg.target}>
      <p>
        Target <strong data-testid="context-package-target">{pkg.target}</strong>:{' '}
        <span data-testid="context-independence">
          {pkg.independence.findings} findings · {pkg.independence.origins} origins
        </span>
        , {pkg.withheld} withheld.
      </p>
      {pkg.confirmationRequired && (
        <p role="alert" className="wb-warning" data-testid="context-confirmation-required">
          Confirmation required: the transfer {pkg.confirmationRequired.transferId} must be
          confirmed here before any content is released.
        </p>
      )}
      {pkg.transfer && (
        <p className="wb-muted" data-testid="context-transfer">
          Released by confirmed transfer <span className="wb-mono">{pkg.transfer.transferId}</span>.
        </p>
      )}
      <ul className="wb-list" aria-label="Package items">
        {pkg.items.map((i) => {
          const layer = layerOf(i.card);
          return (
            <li key={i.card.id} data-testid={`context-item-${i.card.id}`}>
              {i.card.title}{' '}
              <span className="wb-badge" data-kind={layer}>
                {layer === 'unclassified' ? 'Unclassified' : LAYER_LABEL[layer]}
              </span>
              <div className="wb-muted">
                {i.provenance.originKnown ? `origin: ${i.provenance.originRoot}` : 'origin unknown'}
              </div>
            </li>
          );
        })}
      </ul>
      <DeniedList denied={pkg.denied ?? []} titles={titles} />
      {pkg.pendingProposals.length > 0 && (
        <p className="wb-muted">
          {pkg.pendingProposals.length} pending proposals listed, not as facts.
        </p>
      )}
    </div>
  );
}

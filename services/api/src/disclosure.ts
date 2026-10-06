// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Cloud transfers (ADR-0031, ADR-0028): preview, show, confirm and redeem around the gate's
// transfer state. The gate keeps the binding (hash, expiry, single use, session or connection);
// this service keeps a copy of each preview so the human can look at it (the gate has no
// "get"), and rebuilds the envelope from the store at confirm and send time, so an edited,
// removed or newly denied card makes the hash differ.

import type {
  Card,
  DisclosureConfirmation,
  DisclosureModelRequest,
  DisclosurePreviewEnvelope,
  DisclosureRelease,
  DisclosureTransfer,
  StorageAdapter,
  TransferRequester,
} from '@worldbuilder/core';
import type { GateService } from './gate.js';
import { HttpError } from './problem.js';

/** Open transfers are shown (and answer 410 when expired) for this long after they expire. */
const RETAIN_AFTER_EXPIRY_MS = 5 * 60 * 1000;

interface PreviewInput {
  readonly connectorId: string;
  readonly purpose: DisclosureTransfer['purpose'];
  readonly request: DisclosureModelRequest;
  readonly cards: readonly Card[];
  readonly requester: TransferRequester;
}

interface Entry {
  readonly transfer: DisclosureTransfer;
  readonly requester: TransferRequester;
}

interface TransferErrorLike {
  readonly code?: string;
  readonly message: string;
}

const isTransferError = (e: unknown): e is TransferErrorLike =>
  e instanceof Error && typeof (e as { code?: unknown }).code === 'string';

export class Disclosures {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly gate: GateService,
    private readonly storage: StorageAdapter,
    private readonly sessionId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    // A rule change builds a new gate, which knows none of the old transfers.
    gate.onRebuild(() => this.entries.clear());
  }

  private prune(): void {
    const t = this.now().getTime();
    for (const [id, e] of this.entries) {
      if (t >= Date.parse(e.transfer.expiresAt) + RETAIN_AFTER_EXPIRY_MS) this.entries.delete(id);
    }
  }

  private async build(input: PreviewInput): Promise<DisclosureTransfer | undefined> {
    const gate = await this.gate.current();
    try {
      return gate.preview(input);
    } catch {
      return undefined; // no card of the transfer is cleared, or the rules are invalid
    }
  }

  /** Create and remember a transfer preview (cards the rules clear for cloud_model only). */
  async preview(input: PreviewInput): Promise<DisclosureTransfer | undefined> {
    this.prune();
    const transfer = await this.build(input);
    if (transfer) this.entries.set(transfer.transferId, { transfer, requester: input.requester });
    return transfer;
  }

  get(transferId: string): DisclosureTransfer | undefined {
    this.prune();
    return this.entries.get(transferId)?.transfer;
  }

  requesterOf(transferId: string): TransferRequester | undefined {
    return this.entries.get(transferId)?.requester;
  }

  /**
   * The envelope as it would be sent now: the confirmed request (with an optional replacement
   * question) over the cards as the store holds them today, filtered by the rules in force.
   */
  private async currentEnvelope(
    entry: Entry,
    question?: string,
  ): Promise<DisclosurePreviewEnvelope | undefined> {
    const stored = entry.transfer.preview;
    const cards: Card[] = [];
    for (const id of entry.transfer.cardIds) {
      const card = await this.storage.read(id);
      if (card) cards.push(card);
    }
    const request: DisclosureModelRequest =
      question === undefined ? stored.request : { ...stored.request, question };
    // Rebuilt through a throw-away preview that is not remembered here; the gate prunes it.
    const rebuilt = await this.build({
      connectorId: stored.connectorId,
      purpose: entry.transfer.purpose,
      request,
      cards,
      requester: entry.requester,
    });
    return rebuilt?.preview;
  }

  /** Human-only confirmation (ADR-0031). */
  async confirm(transferId: string, payloadHash: string): Promise<DisclosureConfirmation> {
    this.prune();
    const entry = this.entries.get(transferId);
    if (!entry) throw new HttpError(404, 'unknown transfer');
    if (this.now().getTime() >= Date.parse(entry.transfer.expiresAt)) {
      throw new HttpError(410, 'the transfer has expired; preview it again');
    }
    const currentEnvelope = await this.currentEnvelope(entry);
    if (!currentEnvelope) throw new HttpError(409, 'the payload differs from the preview');
    const gate = await this.gate.current();
    try {
      return gate.confirm({ transferId, payloadHash, sessionId: this.sessionId, currentEnvelope });
    } catch (e) {
      if (!isTransferError(e)) throw e;
      throw new HttpError(e.code === 'expired' ? 410 : 409, e.message);
    }
  }

  /**
   * Redeem a confirmed transfer for one send and return exactly the confirmed objects. Any
   * refusal is a 403: the caller may not receive this content.
   */
  async redeem(
    transferId: string,
    grant: { kind: 'token'; token: string } | { kind: 'connection'; connectionId: string },
    question?: string,
  ): Promise<DisclosureRelease> {
    this.prune();
    const entry = this.entries.get(transferId);
    if (!entry) throw new HttpError(403, 'unknown, expired or unconfirmed transfer');
    const envelope = await this.currentEnvelope(entry, question);
    if (!envelope) throw new HttpError(403, 'the payload differs from the confirmed one');
    const gate = await this.gate.current();
    try {
      const release = gate.redeem({
        grant:
          grant.kind === 'token'
            ? { kind: 'token', token: grant.token, sessionId: this.sessionId }
            : { kind: 'connection', transferId, connectionId: grant.connectionId },
        envelope,
      });
      await this.gate.logConfirmedRelease(release.objects.map((c) => c.id));
      return release;
    } catch (e) {
      if (!isTransferError(e)) throw e;
      throw new HttpError(403, e.message);
    }
  }
}

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  Card,
  DisclosureConfirmation,
  DisclosureConfirmationRef,
  DisclosureDecision,
  DisclosureModelRequest,
  DisclosurePreviewEnvelope,
  DisclosureTarget,
  DisclosureTransfer,
} from '../generated/contracts.js';

/** What is about to leave the screen: a card, or the user's stance data on a card. */
export type DisclosureItem =
  { readonly kind: 'card'; readonly card: Card } | { readonly kind: 'stance'; readonly card: Card };

/** What the user wants to send to a cloud connector; the gate turns it into a preview. */
export interface DisclosurePreviewInput {
  readonly connectorId: string;
  readonly purpose: DisclosureTransfer['purpose'];
  readonly request: DisclosureModelRequest;
  readonly cards: readonly Card[];
}

/** The human-only confirm call (ADR-0031). */
export interface DisclosureConfirmInput {
  readonly transferId: string;
  /** The hash the user previewed. */
  readonly payloadHash: string;
  /** The human session that confirms; the token is bound to it. */
  readonly sessionId: string;
  /** The envelope as it would be sent now; its hash must still equal the stored one. */
  readonly currentEnvelope: DisclosurePreviewEnvelope;
}

/** The send call: consumes the token atomically before anything is sent (ADR-0031). */
export interface DisclosureRedeemInput {
  readonly token: string;
  readonly sessionId: string;
  /** The envelope about to be sent; its hash must equal the confirmed one. */
  readonly envelope: DisclosurePreviewEnvelope;
}

/**
 * Why a confirmation or a send was refused. HTTP: `unknown`, `mismatch`, `replayed` and
 * `session` are 409, `expired` is 410.
 */
export type TransferErrorCode = 'unknown' | 'mismatch' | 'replayed' | 'expired' | 'session';

/** Error thrown by `DisclosureGate.confirm` and `DisclosureGate.redeem`. */
export interface TransferError extends Error {
  readonly code: TransferErrorCode;
}

/**
 * Decides per card and per target whether content may leave (ADR-0012, ADR-0031). Every
 * egress path calls it. Contract, proven by `describeDisclosureGateConformance`:
 *
 * - default deny: without a matching allow rule the decision is `deny`, for every target;
 *   a matching deny rule wins over any allow rule; adapter rule fragments may only deny;
 * - stance data is allowed for `screen` only, whatever the rules say;
 * - `cloud_model` (including an MCP connection registered as `cloud_model`) gets content only
 *   for a card in a previewed transfer that the human confirmed with its exact payload hash,
 *   whose single-use token (at least 128 bits, bound to the confirming session, valid 5
 *   minutes, in memory only) was consumed by this send.
 */
export interface DisclosureGate {
  decide(
    item: DisclosureItem,
    target: DisclosureTarget,
    confirmation?: DisclosureConfirmationRef,
  ): DisclosureDecision;
  /**
   * Build the preview of a cloud transfer: the envelope holds only cards the rules allow for
   * `cloud_model`, and its JCS hash is the transfer's `payloadHash`. Expires in 5 minutes.
   */
  preview(input: DisclosurePreviewInput): DisclosureTransfer;
  /** Record the human's confirmation and issue the single-use token; throws `TransferError`. */
  confirm(input: DisclosureConfirmInput): DisclosureConfirmation;
  /** Consume the token for one send; throws `TransferError`. */
  redeem(input: DisclosureRedeemInput): DisclosureConfirmationRef;
}

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  Card,
  DisclosureConfirmation,
  DisclosureDecision,
  DisclosureModelRequest,
  DisclosurePreviewEnvelope,
  DisclosureRelease,
  DisclosureTarget,
  DisclosureTransfer,
} from '../generated/contracts.js';

/** What is about to leave the screen: a card, or the user's stance data on a card. */
export type DisclosureItem =
  { readonly kind: 'card'; readonly card: Card } | { readonly kind: 'stance'; readonly card: Card };

/**
 * Who will send a cloud transfer (ADR-0031, ADR-0028): the board, which receives a
 * single-use token on confirmation, or a registered MCP connection, to which the service
 * releases the content without ever handing out a token.
 */
export type TransferRequester =
  { readonly kind: 'board' } | { readonly kind: 'connection'; readonly connectionId: string };

/** What the user or an agent wants to send to a cloud connector. */
export interface DisclosurePreviewInput {
  readonly connectorId: string;
  readonly purpose: DisclosureTransfer['purpose'];
  readonly request: DisclosureModelRequest;
  readonly cards: readonly Card[];
  readonly requester: TransferRequester;
}

/** The human-only confirm call (ADR-0031). */
export interface DisclosureConfirmInput {
  readonly transferId: string;
  /** The hash the user previewed. */
  readonly payloadHash: string;
  /** The human session that confirms; a board token is bound to it. */
  readonly sessionId: string;
  /** The envelope as it would be sent now; its hash must still equal the stored one. */
  readonly currentEnvelope: DisclosurePreviewEnvelope;
}

/** How a send proves it may use a confirmed transfer. */
export type DisclosureGrant =
  | { readonly kind: 'token'; readonly token: string; readonly sessionId: string }
  | { readonly kind: 'connection'; readonly transferId: string; readonly connectionId: string };

/** The send call: consumes the grant atomically before anything is sent. */
export interface DisclosureRedeemInput {
  readonly grant: DisclosureGrant;
  /** The envelope about to be sent; it must equal the confirmed one. */
  readonly envelope: DisclosurePreviewEnvelope;
}

/**
 * Why a confirmation or a send was refused. HTTP: `unknown`, `mismatch`, `replayed` and
 * `binding` are 409, `expired` is 410.
 */
export type TransferErrorCode = 'unknown' | 'mismatch' | 'replayed' | 'expired' | 'binding';

/** Error thrown by `DisclosureGate.confirm` and `DisclosureGate.redeem`. */
export interface TransferError extends Error {
  readonly code: TransferErrorCode;
}

/**
 * Decides per card and per target whether content may leave (ADR-0012, ADR-0031). Every
 * egress path calls it. Contract, proven by `describeDisclosureGateConformance`:
 *
 * - default deny: without a matching allow rule the decision is `deny`, for every target; a
 *   matching deny rule wins; adapter fragments may only deny; invalid rules deny everything;
 * - stance data is allowed for `screen` only, whatever the rules say;
 * - `decide` never allows `cloud_model`: cloud content leaves only as the objects that
 *   `redeem` returns for one confirmed, unexpired, unused transfer, bound to the board session
 *   (token) or to the MCP connection that asked.
 */
export interface DisclosureGate {
  decide(item: DisclosureItem, target: DisclosureTarget): DisclosureDecision;
  /**
   * Build the preview of a cloud transfer: the envelope holds only cards the rules allow for
   * `cloud_model`, and its JCS hash is the transfer's `payloadHash`. Expires in 5 minutes.
   */
  preview(input: DisclosurePreviewInput): DisclosureTransfer;
  /** Record the human's confirmation; issues a token for board transfers. */
  confirm(input: DisclosureConfirmInput): DisclosureConfirmation;
  /** Consume the grant for one send and return exactly the confirmed objects. */
  redeem(input: DisclosureRedeemInput): DisclosureRelease;
}

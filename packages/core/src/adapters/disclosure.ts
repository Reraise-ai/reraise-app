// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  Card,
  DisclosureConfirmation,
  DisclosureDecision,
  DisclosureModelRequest,
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

/**
 * Why a confirmation was refused: unknown transfer or payload mismatch or a second
 * confirmation (HTTP 409), or an expired transfer (HTTP 410).
 */
export type TransferErrorCode = 'unknown' | 'mismatch' | 'replayed' | 'expired';

/** Error thrown by `DisclosureGate.confirm`. */
export interface TransferError extends Error {
  readonly code: TransferErrorCode;
}

/**
 * Decides per card and per target whether content may leave (ADR-0012, ADR-0031). Every
 * egress path calls it. Contract, proven by `describeDisclosureGateConformance`:
 *
 * - default deny: without a matching allow rule the decision is `deny`, for every target;
 *   a matching deny rule wins over any allow rule;
 * - stance data is allowed for `screen` only, whatever the rules say;
 * - `cloud_model` is allowed only for a card in a previewed transfer that the user confirmed
 *   with its exact payload hash, before it expired, once; there is no standing consent.
 */
export interface DisclosureGate {
  decide(
    item: DisclosureItem,
    target: DisclosureTarget,
    confirmation?: DisclosureConfirmation,
  ): DisclosureDecision;
  /**
   * Build the preview of a cloud transfer: the envelope holds only cards the rules allow for
   * `cloud_model`, and its JCS hash is the transfer's `payloadHash`.
   */
  preview(input: DisclosurePreviewInput): DisclosureTransfer;
  /** Record the human's confirmation; throws a `TransferError` on mismatch, expiry or replay. */
  confirm(transferId: string, payloadHash: string): DisclosureConfirmation;
}

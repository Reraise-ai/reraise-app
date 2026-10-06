// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  Card,
  DisclosureConfirmation,
  DisclosureDecision,
  DisclosureTarget,
  DisclosureTransfer,
} from '../generated/contracts.js';

/** What is about to leave the screen: a card, or the user's stance data on a card. */
export type DisclosureItem =
  { readonly kind: 'card'; readonly card: Card } | { readonly kind: 'stance'; readonly card: Card };

/**
 * Decides per card and per target whether content may leave (ADR-0012). Every egress path
 * calls it. Contract, proven by `describeDisclosureGateConformance`:
 *
 * - default deny: without a matching allow rule the decision is `deny`, for every target;
 * - stance data is allowed for `screen` only, whatever the rules say;
 * - `cloud_model` is allowed only with the user's confirmation of the transfer that lists
 *   exactly this card; there is no standing consent.
 */
export interface DisclosureGate {
  decide(
    item: DisclosureItem,
    target: DisclosureTarget,
    confirmation?: DisclosureConfirmation,
  ): DisclosureDecision;
  /** Open a cloud transfer that the user must confirm (shown by the human-only endpoint). */
  requestTransfer(
    cardIds: readonly string[],
    purpose: DisclosureTransfer['purpose'],
  ): DisclosureTransfer;
  /** Record the human's confirmation of exactly the listed cards of one transfer. */
  confirm(transferId: string, cardIds: readonly string[]): DisclosureConfirmation;
}

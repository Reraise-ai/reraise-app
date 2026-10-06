// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

/** Training export is opt-in: a card is exported only if training is explicitly true. */
export function isTrainingEligible(card: { readonly training?: boolean }): boolean {
  return card.training === true;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors

/**
 * The gate rules of the e2e user (ADR-0031), written before the service starts:
 *
 * - screen: everything (the board is a screen caller);
 * - local_model: class C cards of the evidence, actors and decisions collections (evidenced or
 *   said, nothing private);
 * - cloud_model: the same cards would be cleared, but a cloud connection gets content only after
 *   the human confirmed that transfer, so nothing reaches a cloud model without confirmation.
 *
 * There is deliberately no deny rule for the private class A card: no allow rule matches it, so
 * the e2e shows default deny (ADR-0012), not a rule written for the occasion.
 */
export const E2E_GATE_RULES = `rules:
  - id: screen-all
    effect: allow
    targets: [screen]
    match: {}
  - id: local-open-evidence
    effect: allow
    targets: [local_model]
    match:
      class: [C]
      collection: [evidence, actors, decisions]
  - id: cloud-open-evidence-after-confirmation
    effect: allow
    targets: [cloud_model]
    match:
      class: [C]
      collection: [evidence, actors, decisions]
`;

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type { DisclosureRelease, Level1PredictionRequest } from '@worldbuilder/core';
import { computeContentHash } from '@worldbuilder/core';

/**
 * Why a release cannot carry a request, or `undefined` if it can: the release must exist, hold
 * exactly the request's cards object for object (id and content hash), agree with its own
 * confirmation reference, and every object must still hash to its recorded content hash.
 *
 * This checks that the release matches the request's cards. Binding to the confirmed envelope
 * (connector, question, options, output schema) is checked by the engine with
 * `level1EnvelopeFor`. Neither check proves the release is genuine or unspent: that is the
 * service's job, which obtains it from `DisclosureGate.redeem` (single use, bound to the confirmed
 * envelope hash and the session) and hands it straight to the engine (ADR-0031, ADR-0035).
 */
export function releaseProblem(
  request: Level1PredictionRequest,
  release: DisclosureRelease | undefined,
): string | undefined {
  if (!release) return 'no confirmed release';
  if (!Array.isArray(release.objects) || !release.confirmation)
    return 'not a disclosure release (raw cards are never accepted)';
  const { objects, confirmation } = release;
  if (objects.length !== request.cards.length)
    return 'the release does not hold exactly the request cards';
  for (const [i, c] of request.cards.entries()) {
    const o = objects[i];
    if (o?.id !== c.id || o.contentHash !== c.contentHash)
      return `release card ${i} differs from the request card`;
  }
  if (
    confirmation.cardIds.length !== objects.length ||
    confirmation.cardIds.some((id, i) => id !== objects[i]?.id)
  )
    return 'the confirmation names other cards than the release holds';
  for (const o of objects)
    if (computeContentHash(o) !== o.contentHash)
      return `card ${o.id} was changed after its content hash was set`;
  return undefined;
}

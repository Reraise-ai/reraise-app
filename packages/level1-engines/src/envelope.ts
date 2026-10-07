// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// The disclosure envelope of a level-1 cloud transfer (ADR-0031, ADR-0035). The user confirms the
// hash of exactly this envelope; the adapter recomputes it from the request it is about to send and
// refuses unless the confirmed hash is the same, so a confirmation for another connector, question,
// move options, output schema or set of cards is worthless.

import type { Card, DisclosurePreviewEnvelope, Level1PredictionRequest } from '@worldbuilder/core';

interface SchemaPlayer {
  readonly playerCardId: string;
  readonly moveOptions: readonly string[];
}

/** JSON Schema of the answer: one object per player, the move an enum of that player's options. */
export function outputSchemaFor(input: {
  readonly players: readonly SchemaPlayer[];
  readonly cardIds: readonly string[];
}): Record<string, unknown> {
  const properties = Object.fromEntries(
    input.players.map((p) => [
      p.playerCardId,
      {
        type: 'object',
        properties: {
          predictedMove: { type: 'string', enum: [...p.moveOptions] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          cardIds: { type: 'array', items: { type: 'string', enum: [...input.cardIds] } },
        },
        required: ['predictedMove', 'confidence'],
        additionalProperties: false,
      },
    ]),
  );
  return {
    type: 'object',
    properties,
    required: input.players.map((p) => p.playerCardId),
    additionalProperties: false,
  };
}

/**
 * The flat option list of the envelope. `DisclosureModelRequest.options` is a flat list of texts, a
 * level-1 request has move options per player, so each entry is `<playerCardId>: <move option>`,
 * players in request order, options in their own order. The full per-player structure is in the
 * envelope's `outputSchema`.
 */
export function level1OptionLabels(request: Level1PredictionRequest): string[] {
  return request.players.flatMap((p) => p.moveOptions.map((m) => `${p.playerCardId}: ${m}`));
}

/**
 * The envelope a cloud level-1 engine sends: target `cloud_model`, the engine id as connector,
 * the question, the flattened options and the output schema, and the released objects. The
 * service previews, confirms and redeems exactly this envelope; the adapter checks
 * `computePayloadHash(level1EnvelopeFor(...)) === release.confirmation.payloadHash`.
 */
export function level1EnvelopeFor(
  engine: string,
  request: Level1PredictionRequest,
  objects: readonly Card[],
): DisclosurePreviewEnvelope {
  return {
    target: 'cloud_model',
    connectorId: engine,
    request: {
      question: request.question,
      options: level1OptionLabels(request),
      outputSchema: outputSchemaFor({
        players: request.players,
        cardIds: objects.map((c) => c.id),
      }),
    },
    objects: [...objects],
  };
}

// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors

import type {
  DisclosureRelease,
  Level1Prediction,
  Level1PredictionRequest,
} from '../generated/contracts.js';

/**
 * The level-1 socket (ADR-0035): a fast engine that predicts, for each player on a Lage, the
 * most likely next move out of that player's closed set of move options, from the cards on
 * the board and the user's rule cards only. Any engine plugs in here: the local default
 * engine, a local model, or an external decision service such as Jev. Its output is an
 * attributed estimate ("<engine> estimates ..."), never a verdict; it never writes, and world
 * changes it implies come back as proposals by `agent:<engine>` (ADR-0011).
 *
 * Contract, proven by `describeLevel1EngineConformance` from `@worldbuilder/conformance`:
 *
 * - the prediction validates against `level1-prediction.schema.json`, names this engine,
 *   echoes the request's Lage, trigger, players and move options, and carries the RFC 8785
 *   hash of the request;
 * - every predicted move is one of the player's move options; confidence is in [0, 1];
 * - every card id it names is a card of the request (on the board, or a rule card);
 * - a `cloud_model` engine predicts only with the `DisclosureRelease` of one confirmed
 *   transfer whose objects are exactly the request's cards, and refuses otherwise;
 * - a `deterministic` engine returns the same prediction for the same request (apart from
 *   `predictedAt`); the local default engine is deterministic.
 */
export interface Level1Engine {
  /** Engine id, as in `Level1Prediction.engine` and the proposal author `agent:<engine>`. */
  readonly engine: string;
  /** Disclosure target class: what the engine may receive (ADR-0012). */
  readonly target: 'local_model' | 'cloud_model';
  /** True if the same request always yields the same prediction. */
  readonly deterministic: boolean;
  /**
   * Predict the next move of every player of the request. A `cloud_model` engine needs the
   * release of the confirmed transfer of exactly `request.cards` and rejects without it.
   */
  predict(request: Level1PredictionRequest, release?: DisclosureRelease): Promise<Level1Prediction>;
}

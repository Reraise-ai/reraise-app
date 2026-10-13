// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { readFileSync } from 'node:fs';

/** What the stack of a spec file consists of (support/stack.ts). */
export interface E2eEnv {
  /** Origin of the service (Board API and /mcp). */
  readonly serviceUrl: string;
  /** Origin of the built board. */
  readonly boardUrl: string;
  /** Temporary copy of examples/hormuz, the store the service serves. */
  readonly storeDir: string;
  /** Temporary state directory of the service (agents.yaml, gate-rules.yaml, receipt log ...). */
  readonly stateDir: string;
  /** The human session token, read from the owner-only file the service wrote. */
  readonly sessionToken: string;
  readonly agents: {
    readonly local: { readonly name: string; readonly tokenFile: string };
    readonly cloud: { readonly name: string; readonly tokenFile: string };
  };
}

/** Ids of the synthetic Hormuz example (examples/hormuz). */
export const HORMUZ = {
  worldId: '01M1DZPW00JGXPRPG4179ZPNB8',
  lageId: '01M1F21G80R816A1T0V2P6RACH',
  /** Class A premise (`type: assumption`): "Own estimate of the rerouting cost", denied for every model target. */
  privateCardId: '01M1F8X7G0TTV1CC1FNKTNN0TJ',
  privateCardTitle: 'Own estimate of the rerouting cost',
  /** Text of its body: it must never reach a model target or an agent. */
  privateCardBodyText: 'invented internal cost estimate',
  /** On the Lage already: the wire report (evidenced) and the insurance experience. */
  wireReportId: '01M1E34QM03WVTE8T1RYS3AM18',
  /** Coastal navy (actors, `type: organisation`): clear of the board's status strip, so it can be clicked. */
  navyCardId: '01M1EDEAG082WZ7T7D204BHZDC',
  /** Own assessments (`type: rating`): the user's derivations, stored and not placed on the Lage. */
  ratingHarbourMasterId: '01M2MY8CV00ZV7GMSF29143S19',
  ratingNavyId: '01M2MYHHT07BBT348TS317FFBD',
  experienceCardId: '01M1EMA1R0AH9ZTK3YJK33TNER',
} as const;

export function readToken(file: string): string {
  return readFileSync(file, 'utf8').trim();
}

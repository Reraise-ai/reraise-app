// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Synthetic cards and requests for the tests (fictional actors, as in examples/hormuz).

import type { Card, Level1PredictionRequest } from '@worldbuilder/core';
import { SCHEMAS, computeContentHash } from '@worldbuilder/core';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const STORE = '45aaff12-777f-40e3-a97c-8a592e1ea4f6';

export const ID = {
  navy: '01M1EDEAG082WZ7T7D204BHZDC',
  consortium: '01M1EGW640BMD0RDT5NGRMFD70',
  report: '01M1E34QM03WVTE8T1RYS3AM18',
  insurance: '01M1EMA1R0AH9ZTK3YJK33TNER',
  rule: '01M1EV5S00YXKKGEG772AZM7P9',
  assessment: '01M2MYHHT07BBT348TS317FFBD',
  lage: '01M1F21G80R816A1T0V2P6RACH',
  assumption: '01M1E6JK80GR8G0JHMPVT7TDX4',
  stray: '01M1EA0EW0V90F04X7AKQJSKK2',
} as const;

export const card = (id: string, extra: Partial<Card>): Card => {
  const c = {
    id,
    externalId: id,
    uri: `wb:${STORE}/${id}`,
    format: 2,
    type: 'claim',
    title: `Synthetic card ${id}`,
    author: 'human',
    ...extra,
  } as Omit<Card, 'contentHash'>;
  return { ...c, contentHash: computeContentHash(c) } as Card;
};

export const report = card(ID.report, {
  type: 'event',
  title: 'Wire report: night transit restrictions announced',
  layer: 'evidenced',
  source: 'https://example.org/wire/2026-09-14-transit-restrictions',
});
export const insurance = card(ID.insurance, {
  type: 'experience',
  title: 'War-risk insurance premiums spiked',
  layer: 'experience',
});
export const assessment = card(ID.assessment, {
  type: 'rating',
  title: 'Own assessment: the navy uses the restrictions as leverage',
  layer: 'said',
});
export const navy = card(ID.navy, {
  collection: 'actors',
  type: 'organisation',
  title: 'Coastal navy (fictional actor profile)',
  layer: 'said',
  originSystem: 'Synthetic analyst wiki',
  interests: [{ text: 'Show control over the shipping lane', source: ID.report }],
  capabilities: [
    {
      text: 'Fast patrol boats able to escort or stop tankers at night',
      source: 'https://example.org/naval-review/2026-coastal-patrol-fleet',
    },
  ],
  dependencies: [
    {
      text: 'Oil export revenue that also uses the strait',
      source: 'https://example.org/energy-almanac/2026-export-routes',
    },
  ],
  moves: [{ text: 'Announced night transit restrictions', source: ID.report }],
  redLines: [
    {
      text: 'No foreign warships inside territorial waters',
      source: 'https://example.org/naval-review/2026-09-10-territorial-waters-statement',
    },
  ],
  assumedGoals: [{ text: 'Use the restrictions as leverage in fee talks', source: ID.assessment }],
});
export const consortium = card(ID.consortium, {
  collection: 'actors',
  type: 'organisation',
  title: 'Tanker operators consortium (fictional)',
  layer: 'said',
  originSystem: 'Synthetic analyst wiki',
  interests: [
    {
      text: 'Keep delivery schedules for Q4 contracts',
      source: 'https://example.org/consortium/q4',
    },
  ],
  redLines: [
    {
      text: 'No sailings without war-risk cover',
      source: 'https://example.org/consortium/2026-09-15-member-circular',
    },
  ],
  assumedGoals: [{ text: 'Protect Q4 margins', source: 'https://example.org/consortium/q4' }],
  edges: [{ target: ID.insurance, kind: 'relation', by: 'human' }],
});
export const rule = card(ID.rule, {
  collection: 'decisions',
  type: 'rule',
  title: 'Reroute when restrictions are evidenced',
  rule: {
    when: [
      { kind: 'card_on_lage', card: ID.report },
      { kind: 'card_field', card: ID.report, field: 'layer', equals: 'evidenced' },
    ],
    then: 'Reroute laden tankers via the Cape of Good Hope',
    unless: [{ kind: 'edge', edgeKind: 'refutes', to: ID.report }],
  },
});

export const NAVY_OPTIONS = [
  'Keep night transit restrictions',
  'Lift the restrictions',
  'Stop tankers at night',
];
export const CONSORTIUM_OPTIONS = [
  'Reroute via the Cape of Good Hope',
  'Hold course and buy war-risk cover',
  'Delay sailings by two weeks',
];

export const requestOf = (
  over: Partial<Level1PredictionRequest> = {},
): Level1PredictionRequest => ({
  lageId: ID.lage,
  question: 'Reroute laden tankers around the Cape for Q4?',
  trigger: { kind: 'lage_opened' },
  players: [
    { playerCardId: ID.navy, moveOptions: NAVY_OPTIONS },
    { playerCardId: ID.consortium, moveOptions: CONSORTIUM_OPTIONS },
  ],
  cards: [navy, consortium, report, insurance, assessment, rule],
  ...over,
});

export const fixedNow = () => new Date('2026-10-07T10:00:00Z');

let ajv: Ajv2020 | undefined;
/** A schema validator for the tests (contract schemas of packages/core). */
export function validator(ref: string): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    (addFormatsModule as unknown as { default: (a: Ajv2020) => void }).default(ajv);
    for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  }
  const v = ajv.getSchema(ref);
  if (!v) throw new Error(`unknown schema ${ref}`);
  return v;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The findings contract check. Imported by contract.test.ts so expectContract marks the
// operations in that Vitest isolate. The fixture connects no source.

import { expect } from 'vitest';
import { expectContract, type Fixture } from './test-helpers.js';

/** An unconfigured service lists nothing, and a pin of a missing source is a 404. */
export async function proveFindingsContract(f: Fixture): Promise<void> {
  const listed = await f.human('GET', '/findings');
  expectContract('findings_list', listed, 200);
  expect(listed.json()).toEqual({ findings: [] });

  const pin = await f.human('POST', '/findings/pin', {
    connector: 'http-json',
    uri: 'https://example.invalid/memo',
    lageId: f.ids.lage,
  });
  expectContract('finding_pin', pin, 404);
}

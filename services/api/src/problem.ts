// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// RFC 9457 problem details (ADR-0026, schemas/api.schema.json#/$defs/problem). A problem never
// carries card content: only a fixed title and a short detail written by the service.

import type { Problem } from '@worldbuilder/core';

export const PROBLEM_TYPE_BASE = 'https://worldbuilder.invalid/problems/';

const TITLES: Readonly<Record<number, { slug: string; title: string }>> = {
  400: { slug: 'bad-request', title: 'Bad request' },
  401: { slug: 'unauthorized', title: 'Missing or unknown credential' },
  403: { slug: 'forbidden', title: 'Forbidden' },
  404: { slug: 'not-found', title: 'Not found' },
  409: { slug: 'conflict', title: 'Conflict' },
  410: { slug: 'gone', title: 'Gone' },
  413: { slug: 'payload-too-large', title: 'Payload too large' },
  415: { slug: 'unsupported-media-type', title: 'Unsupported media type' },
  500: { slug: 'internal-error', title: 'Internal error' },
  503: { slug: 'unavailable', title: 'Store unavailable' },
  501: { slug: 'not-implemented', title: 'Not implemented' },
};

/** An error that maps to one HTTP problem. `detail` must not contain card text. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly slug?: string,
  ) {
    super(detail);
  }
}

export function problemOf(status: number, detail?: string, slug?: string): Problem {
  const known = TITLES[status] ?? { slug: 'error', title: 'Error' };
  return {
    type: `${PROBLEM_TYPE_BASE}${slug ?? known.slug}`,
    title: known.title,
    status,
    ...(detail === undefined ? {} : { detail }),
  };
}

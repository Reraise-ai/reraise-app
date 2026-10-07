// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The human-only level-1 operations (ADR-0035, ADR-0045). None is an MCP tool: a prediction is the
// human's own request. The access rule comes from the contract (`x-human-only`).

import type { Level1EscalateRequest, Level1PredictRequest } from '@worldbuilder/core';
import type { Handler } from './operations.js';

const str = (v: unknown): string => v as string;

export const level1Handlers: Readonly<Record<string, Handler>> = {
  async level1_get(s, { params, query }) {
    return {
      status: 200,
      body: await s.level1.state(str(params['lageId']), query['explain'] === true),
    };
  },

  async level1_predict(s, { params, body }) {
    return {
      status: 200,
      body: await s.level1.predict(str(params['lageId']), body as Level1PredictRequest),
    };
  },

  async level1_escalate(s, { params, body }) {
    const { playerCardId } = body as Level1EscalateRequest;
    return { status: 201, body: await s.level1.escalate(str(params['lageId']), playerCardId) };
  },
};

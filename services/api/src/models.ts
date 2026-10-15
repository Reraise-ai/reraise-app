// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The three ModelConnectors behind model_ask. Ollama is on by default at the local
// address. The cloud chat model and the decision stub stay silent until a base URL is
// set: their ask() refuses without calling fetch.

import {
  CLOUD_CHAT_ENGINE,
  DECISION_STUB_ENGINE,
  OLLAMA_ENGINE,
  createCloudChatModel,
  createDecisionStub,
  createOllamaModel,
  type ModelConnector,
} from '@worldbuilder/core';

export interface ModelOptions {
  readonly fetch?: typeof fetch;
  readonly ollama?: { readonly baseUrl?: string; readonly model?: string };
  readonly cloud?: { readonly baseUrl?: string; readonly model?: string; readonly apiKey?: string };
  readonly decision?: { readonly baseUrl?: string; readonly apiKey?: string };
}

const value = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined => {
  const trimmed = env[key]?.trim();
  return trimmed ? trimmed : undefined;
};

/** Addresses from the environment. A blank value is the same as an absent one. */
export function modelOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ModelOptions {
  const ollamaUrl = value(env, 'WORLDBUILDER_OLLAMA_URL');
  const ollamaModel = value(env, 'WORLDBUILDER_OLLAMA_MODEL');
  const cloudUrl = value(env, 'WORLDBUILDER_CLOUD_MODEL_URL');
  const cloudModel = value(env, 'WORLDBUILDER_CLOUD_MODEL_NAME');
  const cloudKey = value(env, 'WORLDBUILDER_CLOUD_MODEL_KEY');
  const decisionUrl = value(env, 'WORLDBUILDER_DECISION_URL');
  const decisionKey = value(env, 'WORLDBUILDER_DECISION_KEY');
  return {
    ...(ollamaUrl || ollamaModel
      ? {
          ollama: {
            ...(ollamaUrl ? { baseUrl: ollamaUrl } : {}),
            ...(ollamaModel ? { model: ollamaModel } : {}),
          },
        }
      : {}),
    ...(cloudUrl
      ? {
          cloud: {
            baseUrl: cloudUrl,
            ...(cloudModel ? { model: cloudModel } : {}),
            ...(cloudKey ? { apiKey: cloudKey } : {}),
          },
        }
      : {}),
    ...(decisionUrl
      ? { decision: { baseUrl: decisionUrl, ...(decisionKey ? { apiKey: decisionKey } : {}) } }
      : {}),
  };
}

/** One connector per engine id. A missing cloud URL still registers a connector that refuses. */
export function buildModels(options: ModelOptions = {}): Map<string, ModelConnector> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return new Map<string, ModelConnector>([
    [OLLAMA_ENGINE, createOllamaModel({ fetch: fetchImpl, ...options.ollama })],
    [CLOUD_CHAT_ENGINE, createCloudChatModel({ fetch: fetchImpl, ...options.cloud })],
    [DECISION_STUB_ENGINE, createDecisionStub({ fetch: fetchImpl, ...options.decision })],
  ]);
}

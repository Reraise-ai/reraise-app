// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}

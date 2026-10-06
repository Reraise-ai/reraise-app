// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('returns 404 for unknown routes', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

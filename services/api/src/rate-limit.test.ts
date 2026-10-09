// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Rate limiting (ADR-0047): a limit per credential, a lock-out per address after failed
// credentials, 429 problems with Retry-After, and normal use (board polling, MCP) unaffected.

import { afterEach, describe, expect, it } from 'vitest';
import { AuthFailureLimiter } from './rate-limit.js';
import { expectContract, makeFixture, type Fixture } from './test-helpers.js';

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

describe('requests per credential', () => {
  it('answers the request over the limit with a 429 problem and Retry-After', async () => {
    f = await makeFixture({ rateLimit: { max: 3, windowMs: 60_000 } });
    for (let i = 0; i < 3; i++) expectContract('world_list', await f.human('GET', '/worlds'), 200);
    const res = await f.human('GET', '/worlds');
    expectContract('world_list', res, 429);
    expect(res.json()).toMatchObject({
      type: 'https://worldbuilder.invalid/problems/too-many-requests',
      title: 'Too many requests',
      status: 429,
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('counts each credential on its own: a busy agent does not throttle the human', async () => {
    f = await makeFixture({ rateLimit: { max: 2, windowMs: 60_000 } });
    for (let i = 0; i < 2; i++) await f.agent('scripted', 'GET', '/worlds');
    expect((await f.agent('scripted', 'GET', '/worlds')).statusCode).toBe(429);
    expect((await f.human('GET', '/worlds')).statusCode).toBe(200);
    expect((await f.agent('cloud-scripted', 'GET', '/worlds')).statusCode).toBe(200);
  });

  it('never throttles liveness, and 429 does not leak the credential', async () => {
    f = await makeFixture({ rateLimit: { max: 1, windowMs: 60_000 } });
    for (let i = 0; i < 5; i++) {
      expect((await f.raw({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
    await f.human('GET', '/worlds');
    const res = await f.human('GET', '/worlds');
    expect(res.statusCode).toBe(429);
    expect(res.body).not.toContain(f.tokens['scripted']);
  });

  it('leaves normal use alone: board polling and a burst of agent calls stay under the default', async () => {
    f = await makeFixture();
    for (let i = 0; i < 120; i++) {
      expect((await f.human('GET', '/worlds')).statusCode).toBe(200);
    }
    for (let i = 0; i < 60; i++) {
      expect((await f.agent('scripted', 'GET', '/worlds')).statusCode).toBe(200);
    }
  });

  it('applies to the MCP endpoint too, and can be switched off', async () => {
    f = await makeFixture({ rateLimit: { max: 2, windowMs: 60_000 } });
    const post = () =>
      f!.raw({
        method: 'POST',
        url: '/mcp',
        payload: {},
        headers: {
          authorization: `Bearer ${f!.tokens['scripted']}`,
          'content-type': 'application/json',
        },
      });
    await post();
    await post();
    expect((await post()).statusCode).toBe(429);
    await f.close();
    f = await makeFixture({ rateLimit: false });
    for (let i = 0; i < 20; i++) expect((await f.human('GET', '/worlds')).statusCode).toBe(200);
  });
});

describe('failed credentials per address', () => {
  const bad = (fx: Fixture) =>
    fx.raw({ method: 'GET', url: '/worlds', headers: { authorization: 'Bearer wrong-token' } });

  it('locks the address out after the allowed failures, valid tokens included', async () => {
    f = await makeFixture({ rateLimit: { authFailureMax: 3 } });
    for (let i = 0; i < 3; i++) expect((await bad(f)).statusCode).toBe(401);
    const blocked = await bad(f);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    // A correct guess must not get through at full speed either.
    expectContract('world_list', await f.human('GET', '/worlds'), 429);
  });

  it('lets the address back in once the window has passed', async () => {
    let t = Date.parse('2026-10-09T10:00:00Z');
    f = await makeFixture({
      rateLimit: { authFailureMax: 2, windowMs: 60_000 },
      now: () => new Date(t),
    });
    await bad(f);
    await bad(f);
    expect((await f.human('GET', '/worlds')).statusCode).toBe(429);
    t += 61_000;
    expect((await f.human('GET', '/worlds')).statusCode).toBe(200);
  });

  it('does not count successful requests as failures', async () => {
    f = await makeFixture({ rateLimit: { authFailureMax: 2 } });
    for (let i = 0; i < 10; i++) expect((await f.human('GET', '/worlds')).statusCode).toBe(200);
  });
});

describe('AuthFailureLimiter', () => {
  it('counts per address within a window and forgets old windows', () => {
    let now = 0;
    const l = new AuthFailureLimiter(2, 1000, () => now);
    l.recordFailure('a');
    expect(l.lockedFor('a')).toBeUndefined();
    l.recordFailure('a');
    expect(l.lockedFor('a')).toBe(1);
    expect(l.lockedFor('b')).toBeUndefined();
    now = 1000;
    expect(l.lockedFor('a')).toBeUndefined();
  });

  it('keeps its memory bounded', () => {
    const l = new AuthFailureLimiter(1, 60_000, () => 0);
    for (let i = 0; i < 5000; i++) l.recordFailure(`10.0.${i >> 8}.${i & 255}`);
    expect((l as unknown as { windows: Map<string, unknown> }).windows.size).toBeLessThanOrEqual(
      1024,
    );
  });
});

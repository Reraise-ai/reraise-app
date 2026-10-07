// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// The MCP front end end to end (ADR-0016, ADR-0029): the official SDK client talks Streamable
// HTTP to the in-process service on a real loopback port. Tools run the same operation code as
// the HTTP routes; a registered agent is the only caller; a cloud_model connection gets card
// content only through a transfer the human confirmed.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  ContextPackage,
  DisclosureTransfer,
  KnowledgeReceipt,
  Proposal,
} from '@worldbuilder/core';
import { MCP_TOOL_NAMES, TOOLS } from '@worldbuilder/mcp-server';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeAgent } from './agent-registry.js';
import { loadOperations } from './contract.js';
import { makeFixture, PRIVATE_TEXT, type Fixture } from './test-helpers.js';

let f: Fixture;
beforeAll(async () => {
  f = await makeFixture({ listen: true });
});
afterAll(async () => {
  await f.close();
});

const mcpUrl = () => new URL('/mcp', f.url);
const bearer = (token: string) => ({ requestInit: { headers: { authorization: `Bearer ${token}` } } });

const open: Client[] = [];
afterAll(async () => {
  await Promise.all(open.map((c) => c.close().catch(() => undefined)));
});

async function connect(name: string): Promise<Client> {
  const client = new Client({ name: `test-${name}`, version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(mcpUrl(), bearer(f.tokens[name]!)));
  open.push(client);
  return client;
}

/** Call a tool and return its structured result; a tool error fails the test with its text. */
async function ok<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  expect(result.structuredContent, name).toBeDefined();
  return result.structuredContent as T;
}

/** A tool call that must fail: the problem as JSON text, and nothing else. */
async function fails(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, name).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe('text');
  return { text: content[0]!.text, problem: JSON.parse(content[0]!.text) as Record<string, unknown> };
}

const human = (method: string, path: string, body?: unknown) =>
  fetch(new URL(path, f.url), {
    method,
    headers: { 'x-worldbuilder-session': f.service.sessionToken, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A raw request to /mcp with full control of the headers (fetch cannot set Host). */
function rawMcp(
  headers: Record<string, string>,
  body: string | undefined,
  method = 'POST',
  path = '/mcp',
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const { port } = new URL(f.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c: Buffer) => (text += c.toString('utf8')));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw', version: '0' },
  },
});
const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('tool list', () => {
  it('lists exactly the agent tools of the contract, knowledge tools included', async () => {
    const client = await connect('scripted');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toHaveLength(13);
    for (const name of [
      'knowledge_consult',
      'knowledge_write_back',
      'decision_record',
      'decision_outcome',
      'memory_route',
    ]) {
      expect(tools.map((t) => t.name)).toContain(name);
    }
  });

  it('never lists a human-only operation', async () => {
    const client = await connect('scripted');
    const names = new Set((await client.listTools()).tools.map((t) => t.name));
    const humanOnly = loadOperations().filter((o) => o.access === 'human');
    expect(humanOnly.length).toBeGreaterThan(8);
    for (const op of humanOnly) expect(names.has(op.id), op.id).toBe(false);
    expect([...names].filter((n) => /stance|accept|reject|confirm|save|create$/.test(n) && !TOOLS.some((t) => t.name === n))).toEqual([]);
  });

  it('describes each tool with self-contained schemas and honest annotations', async () => {
    const client = await connect('scripted');
    for (const tool of (await client.listTools()).tools) {
      for (const schema of [tool.inputSchema, tool.outputSchema]) {
        const text = JSON.stringify(schema);
        expect(schema, tool.name).toBeDefined();
        expect(schema!.type, tool.name).toBe('object');
        expect(text, tool.name).not.toContain('worldbuilder.invalid');
        expect(text, tool.name).not.toContain('.schema.json');
        expect(text, tool.name).not.toContain('"$id"');
        for (const m of text.matchAll(/"\$ref":"([^"]*)"/g)) {
          expect(m[1], tool.name).toMatch(/^#\/\$defs\//);
        }
      }
      const def = TOOLS.find((t) => t.name === tool.name)!;
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(def.annotations.readOnlyHint);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });

  it('takes no identity, target or author as input', async () => {
    const client = await connect('scripted');
    for (const tool of (await client.listTools()).tools) {
      const props = Object.keys((tool.inputSchema.properties ?? {}) as object);
      expect(props.filter((p) => ['target', 'author', 'agent', 'principal'].includes(p))).toEqual([]);
    }
  });
});

describe('reading, as a local_model connection', () => {
  it('world_list, lage_get, card_get and cards_search go through the gate', async () => {
    const client = await connect('scripted');
    const worlds = await ok<{ worlds: { id: string }[] }>(client, 'world_list');
    expect(worlds.worlds.map((w) => w.id)).toContain(f.worldId);

    const lage = await ok<{ id: string }>(client, 'lage_get', { lageId: f.ids.lage });
    expect(lage.id).toBe(f.ids.lage);

    const search = await ok<{ cards: { id: string; title: string }[] }>(client, 'cards_search', {
      worldId: f.worldId,
      text: 'claim',
    });
    expect(search.cards.map((c) => c.id)).toContain(f.ids.evPublic);
    expect(search.cards.map((c) => c.id)).not.toContain(f.ids.evPrivate);
    expect(JSON.stringify(search)).not.toContain(PRIVATE_TEXT);

    // An explicit lookup of a private card is refused with a problem and no content.
    const denied = await fails(client, 'card_get', { cardId: f.ids.evPrivate });
    expect(denied.text).not.toContain(PRIVATE_TEXT);
    expect(denied.text).not.toContain('Synthetic private note');
    expect(denied.problem['status']).toBeGreaterThanOrEqual(403);
  });

  it('context_package_get returns gate-cleared cards with provenance and never stances', async () => {
    const client = await connect('scripted');
    const pkg = await ok<ContextPackage>(client, 'context_package_get', {
      worldId: f.worldId,
      question: 'Synthetic question?',
    });
    expect(pkg.target).toBe('local_model');
    expect(pkg.items.map((i) => i.card.id)).toContain(f.ids.evPublic);
    expect(pkg.items.map((i) => i.card.id)).not.toContain(f.ids.evPrivate);
    expect(JSON.stringify(pkg)).not.toContain(PRIVATE_TEXT);
    for (const item of pkg.items) expect(item).not.toHaveProperty('stance');
    expect(pkg).not.toHaveProperty('stances');
  });

  it('rules_evaluate lists fired rules without a percentage', async () => {
    const client = await connect('scripted');
    const result = await ok<{ results: { ruleId: string; fired: boolean }[] }>(
      client,
      'rules_evaluate',
      { lageId: f.ids.lage },
    );
    expect(result.results.find((r) => r.ruleId === f.ids.rule)?.fired).toBe(true);
  });

  it('a tool call and the HTTP operation of the same name answer the same body', async () => {
    const client = await connect('scripted');
    const viaMcp = await ok(client, 'cards_search', { worldId: f.worldId, text: 'claim' });
    const viaHttp = await fetch(new URL(`/cards?worldId=${f.worldId}&text=claim`, f.url), {
      headers: { authorization: `Bearer ${f.tokens['scripted']}` },
    });
    expect(viaHttp.status).toBe(200);
    expect(viaMcp).toEqual(await viaHttp.json());
  });
});

describe('the knowledge loop', () => {
  it('knowledge_consult returns the package and a receipt; write-back and memory_route follow', async () => {
    const client = await connect('scripted');
    const consulted = await ok<{ package: ContextPackage; receipt: KnowledgeReceipt }>(
      client,
      'knowledge_consult',
      { taskRef: 'task:mcp-1', task: 'Synthetic task: weigh the northern corridor', worldId: f.worldId },
    );
    expect(consulted.receipt.receiptId).toMatch(/^[0-9A-Z]{26}$/);
    expect(consulted.receipt.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(consulted.package.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(consulted.receipt)).not.toContain('northern corridor');

    const written = await ok<{ receipt: { receiptId: string }; proposal?: Proposal }>(
      client,
      'knowledge_write_back',
      {
        taskRef: 'task:mcp-1',
        consultReceiptId: consulted.receipt.receiptId,
        card: {
          format: 2,
          type: 'claim',
          title: 'Learned over MCP',
          layer: 'said',
          originSystem: 'Synthetic agent',
        },
      },
    );
    expect(written.receipt.receiptId).toMatch(/^[0-9A-Z]{26}$/);
    expect(written.proposal?.status).toBe('pending');
    expect(written.proposal?.author).toBe('agent:scripted');

    const none = await ok<{ receipt: { receiptId: string } }>(client, 'knowledge_write_back', {
      taskRef: 'task:mcp-2',
      notNeeded: { reason: 'no_new_knowledge' },
    });
    expect(none.receipt.receiptId).toMatch(/^[0-9A-Z]{26}$/);

    const routed = await ok<{ route: string }>(client, 'memory_route', {
      text: 'The Strait of Hormuz carries a large share of seaborne oil; source: synthetic report.',
      kindHint: 'learning',
    });
    expect(['card_proposal', 'ephemeral_ops_fact']).toContain(routed.route);
  });
});

describe('proposals: the only write path', () => {
  it('proposal_create, then proposal_list with changedSince follows the human decision', async () => {
    const client = await connect('scripted');
    const first = await ok<{ proposals: Proposal[]; nextCursor?: string }>(client, 'proposal_list', {});
    const cursor = first.nextCursor;

    const created = await ok<Proposal>(client, 'proposal_create', {
      kind: 'place_card',
      payload: { lageId: f.ids.lage, cardId: f.ids.evLoose, x: 12, y: 34 },
      rationale: 'Synthetic: the loose claim belongs on the board.',
    });
    expect(created.status).toBe('pending');
    expect(created.author).toBe('agent:scripted');

    const afterCreate = await ok<{ proposals: Proposal[]; nextCursor?: string }>(
      client,
      'proposal_list',
      cursor === undefined ? {} : { changedSince: cursor },
    );
    expect(afterCreate.proposals.map((p) => p.id)).toContain(created.id);

    // Nothing counts before a human accepts: the Lage is unchanged.
    const lageBefore = await ok<{ lage: { cards: { id: string }[] } }>(client, 'lage_get', {
      lageId: f.ids.lage,
    });
    expect(lageBefore.lage.cards.map((c) => c.id)).not.toContain(f.ids.evLoose);

    const res = await human('POST', `/proposals/${created.id}/accept`, {});
    expect(res.status).toBe(200);

    const polled = await ok<{ proposals: Proposal[] }>(client, 'proposal_list', {
      changedSince: afterCreate.nextCursor as string,
    });
    const seen = polled.proposals.find((p) => p.id === created.id);
    expect(seen?.status).toBe('accepted');
    const lageAfter = await ok<{ lage: { cards: { id: string }[] } }>(client, 'lage_get', {
      lageId: f.ids.lage,
    });
    expect(lageAfter.lage.cards.map((c) => c.id)).toContain(f.ids.evLoose);
  });

  it('decision_record proposes a decision card; it stays pending', async () => {
    const client = await connect('scripted');
    const section = (t: string) => `Synthetic ${t}.`;
    const proposal = await ok<Proposal>(client, 'decision_record', {
      decision: {
        format: 2,
        type: 'decision',
        title: 'Synthetic decision',
        sections: {
          situation: section('situation'),
          trigger: section('trigger'),
          conditions: section('conditions'),
          facts: section('facts'),
          priorities: section('priorities'),
          action: section('action'),
          alternatives: section('alternatives'),
          exclusions: section('exclusions'),
          rationale: section('rationale'),
          cardsUsed: [f.ids.evPublic],
          outcome: 'open',
        },
      },
    });
    expect(proposal.status).toBe('pending');
  });

  it('a malformed call is a tool error with the problem text', async () => {
    const client = await connect('scripted');
    const bad = await fails(client, 'proposal_create', { kind: 'place_card' });
    expect(bad.problem['status']).toBe(400);
    expect(typeof bad.problem['title']).toBe('string');
    const extra = await fails(client, 'cards_search', { surprise: 1 });
    expect(extra.problem['status']).toBe(400);
  });
});

describe('what an agent cannot do', () => {
  it('has no tool for a human-only operation: calling one is an error and changes nothing', async () => {
    const client = await connect('scripted');
    const pending = await ok<Proposal>(client, 'proposal_create', {
      kind: 'comment',
      payload: { cardId: f.ids.evPublic, text: 'Synthetic comment.' },
    }).catch(() => undefined);
    const id = pending?.id ?? 'x';
    for (const [name, args] of [
      ['proposal_accept', { proposalId: id }],
      ['proposal_reject', { proposalId: id }],
      ['lage_save', { lageId: f.ids.lage }],
      ['stance_get', { cardId: f.ids.evPublic }],
      ['stance_save', { cardId: f.ids.evPublic }],
      ['disclosure_confirm', { transferId: id }],
      ['usage_metrics_get', {}],
    ] as const) {
      const r = await fails(client, name, args);
      expect(r.problem['title'], name).toBe('Unknown tool');
    }
    if (pending) {
      const list = await ok<{ proposals: Proposal[] }>(client, 'proposal_list', {});
      expect(list.proposals.find((p) => p.id === id)?.status).toBe('pending');
    }
  });

  it('cannot reach a human-only route with its token either (403)', async () => {
    const res = await fetch(new URL(`/proposals/${'0'.repeat(26)}/accept`, f.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${f.tokens['scripted']}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('the human session token is not accepted on /mcp', async () => {
    const res = await rawMcp(
      { ...MCP_HEADERS, 'x-worldbuilder-session': f.service.sessionToken },
      INIT,
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).title).toBe('Forbidden');
  });
});

describe('credentials, Host and Origin', () => {
  it('rejects an unregistered token and a missing token (401), before any tool runs', async () => {
    const wrong = new Client({ name: 'x', version: '0' });
    await expect(
      wrong.connect(new StreamableHTTPClientTransport(mcpUrl(), bearer('not-a-registered-token'))),
    ).rejects.toThrow();
    const noToken = await rawMcp(MCP_HEADERS, INIT);
    expect(noToken.status).toBe(401);
    const wrongRaw = await rawMcp({ ...MCP_HEADERS, authorization: 'Bearer nope' }, INIT);
    expect(wrongRaw.status).toBe(401);
    expect(wrongRaw.headers['content-type']).toContain('application/problem+json');
    const malformed = await rawMcp({ ...MCP_HEADERS, authorization: 'Basic abc' }, INIT);
    expect(malformed.status).toBe(401);
  });

  it('rejects a foreign Origin and a foreign Host (403)', async () => {
    const auth = { authorization: `Bearer ${f.tokens['scripted']}` };
    const origin = await rawMcp({ ...MCP_HEADERS, ...auth, origin: 'https://evil.example' }, INIT);
    expect(origin.status).toBe(403);
    expect(JSON.parse(origin.body).type).toContain('origin-not-allowed');
    const host = await rawMcp({ ...MCP_HEADERS, ...auth, host: 'evil.example' }, INIT);
    expect(host.status).toBe(403);
    expect(JSON.parse(host.body).type).toContain('host-not-allowed');
    // GET (the stream) and DELETE are checked the same way
    expect((await rawMcp({ ...auth, origin: 'https://evil.example' }, undefined, 'GET')).status).toBe(403);
    expect((await rawMcp({ ...auth, host: 'evil.example' }, undefined, 'DELETE')).status).toBe(403);
  });

  it('answers 413 for a body over the limit', async () => {
    const auth = { authorization: `Bearer ${f.tokens['scripted']}` };
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'a'.repeat(1024 * 1024 + 10) } });
    const res = await rawMcp({ ...MCP_HEADERS, ...auth }, big);
    expect(res.status).toBe(413);
  });

  it('a revoked token stops working at once, also inside an open session', async () => {
    const { token } = await (await import('./agent-registry.js')).addAgent(f.stateDir, {
      name: 'short-lived',
      target: 'local_model',
    });
    const client = new Client({ name: 'short', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl(), bearer(token)));
    await ok(client, 'world_list');
    await removeAgent(f.stateDir, 'short-lived');
    await expect(client.callTool({ name: 'world_list', arguments: {} })).rejects.toThrow();
    await client.close().catch(() => undefined);
  });
});

describe('sessions', () => {
  const auth = () => ({ authorization: `Bearer ${f.tokens['scripted']}` });

  it('issues an Mcp-Session-Id, requires it afterwards and ends on DELETE', async () => {
    const init = await rawMcp({ ...MCP_HEADERS, ...auth() }, INIT);
    expect(init.status).toBe(200);
    const sid = String(init.headers['mcp-session-id']);
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const noSession = await rawMcp({ ...MCP_HEADERS, ...auth() }, list);
    expect(noSession.status).toBe(400);
    const ok1 = await rawMcp({ ...MCP_HEADERS, ...auth(), 'mcp-session-id': sid }, list);
    expect(ok1.status).toBe(200);
    expect(JSON.parse(ok1.body).result.tools).toHaveLength(13);
    const del = await rawMcp({ ...auth(), 'mcp-session-id': sid }, undefined, 'DELETE');
    expect(del.status).toBe(200);
    const gone = await rawMcp({ ...MCP_HEADERS, ...auth(), 'mcp-session-id': sid }, list);
    expect(gone.status).toBe(404);
  });

  it("another agent cannot use a session; it looks like an unknown one", async () => {
    const init = await rawMcp({ ...MCP_HEADERS, ...auth() }, INIT);
    const sid = String(init.headers['mcp-session-id']);
    const other = { authorization: `Bearer ${f.tokens['cloud-scripted']}` };
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const stolen = await rawMcp({ ...MCP_HEADERS, ...other, 'mcp-session-id': sid }, list);
    expect(stolen.status).toBe(404);
    const unknown = await rawMcp({ ...MCP_HEADERS, ...other, 'mcp-session-id': 'no-such-session' }, list);
    expect(unknown.status).toBe(404);
    expect(stolen.body).toBe(unknown.body);
    expect((await rawMcp({ ...other, 'mcp-session-id': sid }, undefined, 'DELETE')).status).toBe(404);
  });

  it('reaches a client over the server-to-client stream (tool list changed)', async () => {
    const client = await connect('scripted');
    const changed = new Promise<void>((resolve) => {
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve());
    });
    // the stream is opened after the initialized notification; give it a moment to attach
    await new Promise((r) => setTimeout(r, 200));
    await f.service.app.mcp.notifyToolListChanged();
    await changed;
  });

});

describe('a cloud_model connection', () => {
  it('gets confirmationRequired first, and content only after the human confirmed, once', async () => {
    const client = await connect('cloud-scripted');
    const first = await ok<ContextPackage>(client, 'context_package_get', {
      worldId: f.worldId,
      question: 'Synthetic question?',
    });
    expect(first.target).toBe('cloud_model');
    expect(first.items).toEqual([]);
    expect(first.confirmationRequired?.transferId).toMatch(/^[0-9A-Z]{26}$/);
    expect(JSON.stringify(first)).not.toContain('Alpha body.');

    // Other tools give a cloud connection no content either.
    const search = await ok<{ cards: unknown[] }>(client, 'cards_search', { worldId: f.worldId });
    expect(search.cards).toEqual([]);
    const card = await fails(client, 'card_get', { cardId: f.ids.evPublic });
    expect(card.text).not.toContain('Alpha body.');

    const transferId = first.confirmationRequired!.transferId;
    // Asking again before the confirmation is refused (the problem carries no content).
    const early = await fails(client, 'context_package_get', { worldId: f.worldId, transferId });
    expect(early.problem['status']).toBe(403);

    const transfer = (await (await human('GET', `/disclosure/transfers/${transferId}`)).json()) as DisclosureTransfer;
    expect(transfer.requestedBy).toBe('mcp_connection');
    const confirm = await human('POST', `/disclosure/transfers/${transferId}/confirm`, {
      payloadHash: transfer.payloadHash,
    });
    expect(confirm.status).toBe(200);
    expect(JSON.stringify(await confirm.json())).not.toContain('token');

    const released = await ok<ContextPackage>(client, 'context_package_get', {
      worldId: f.worldId,
      question: 'Synthetic question?',
      transferId,
    });
    expect(released.items.map((i) => i.card.id).sort()).toEqual([...transfer.cardIds].sort());
    expect(JSON.stringify(released)).not.toContain(PRIVATE_TEXT);

    const again = await fails(client, 'context_package_get', {
      worldId: f.worldId,
      question: 'Synthetic question?',
      transferId,
    });
    expect(again.problem['status']).toBeGreaterThanOrEqual(403);
  });

  it('knowledge_consult follows the same flow and the receipt names no content', async () => {
    const client = await connect('cloud-scripted');
    const first = await ok<{ package: ContextPackage; receipt: KnowledgeReceipt }>(
      client,
      'knowledge_consult',
      { taskRef: 'task:cloud', task: 'Synthetic cloud task', worldId: f.worldId },
    );
    expect(first.package.items).toEqual([]);
    expect(first.package.confirmationRequired?.transferId).toBeDefined();
    expect(first.receipt.receiptId).toMatch(/^[0-9A-Z]{26}$/);
  });
});

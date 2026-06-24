import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMemory } from '@tars/core';
import { closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './index.js';

const pool = getTestPool();
let httpServer!: Server;
let baseUrl!: URL;
let client: Client | undefined;

beforeAll(async () => {
  const app = createApp({ memory: createMemory(pool) });
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);
});

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
  await closeTestPool();
});

function textOf(result: CallToolResult): unknown {
  const block = result.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('expected text content');
  }
  return JSON.parse(block.text);
}

describe('Streamable HTTP server (localhost)', () => {
  it('completes the MCP handshake and runs a tool over HTTP', async () => {
    client = new Client({ name: 'http-test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(baseUrl));

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);

    const remembered = textOf(
      (await client.callTool({
        name: 'memory_remember',
        arguments: {
          entity: { type: 'person', name: 'Person:A' },
          observations: [{ text: 'reachable over HTTP' }],
        },
      })) as CallToolResult,
    ) as { entityId: string; entityCreated: boolean };
    expect(remembered.entityCreated).toBe(true);

    const recalled = textOf(
      (await client.callTool({
        name: 'memory_recall',
        arguments: { query: 'HTTP', includeGraph: false },
      })) as CallToolResult,
    ) as { entities: { name: string }[] };
    expect(recalled.entities[0]?.name).toBe('Person:A');
  });
});

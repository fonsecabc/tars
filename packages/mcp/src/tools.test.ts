import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMemory } from '@tars/core';
import { closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerMemoryTools } from './tools.js';

const pool = getTestPool();
const memory = createMemory(pool);
let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: 'tars-test', version: '0.0.0' });
  registerMemoryTools(server, memory);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await closeTestPool();
});

function textBlock(result: CallToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('expected a text content block');
  }
  return block.text;
}

function parse(result: CallToolResult): unknown {
  return JSON.parse(textBlock(result));
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

describe('MCP tool contract', () => {
  it('exposes all thirteen memory tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'memory_audit',
        'memory_correct',
        'memory_define_type',
        'memory_export',
        'memory_forget',
        'memory_get_entity',
        'memory_link',
        'memory_list_entities',
        'memory_list_predicates',
        'memory_list_types',
        'memory_recall',
        'memory_remember',
        'memory_timeline',
      ].sort(),
    );
  });

  it('remembers, recalls, and fetches an entity end to end', async () => {
    const remembered = parse(
      await call('memory_remember', {
        entity: { type: 'person', name: 'Person:A' },
        observations: [{ text: 'enjoys long-distance hiking' }],
      }),
    ) as { entityId: string; entityCreated: boolean; observationIds: string[] };
    expect(remembered.entityCreated).toBe(true);
    expect(remembered.observationIds).toHaveLength(1);

    const recalled = parse(
      await call('memory_recall', { query: 'hiking', includeGraph: false }),
    ) as {
      entities: { id: string; name: string }[];
    };
    expect(recalled.entities[0]?.name).toBe('Person:A');

    const detail = parse(await call('memory_get_entity', { id: remembered.entityId })) as {
      entity: { name: string };
      observations: unknown[];
    };
    expect(detail.entity.name).toBe('Person:A');
    expect(detail.observations).toHaveLength(1);
  });

  it('links entities and recalls the connecting relation', async () => {
    const a = parse(
      await call('memory_remember', {
        entity: { type: 'person', name: 'Person:A' },
        observations: [{ text: 'an astronaut' }],
      }),
    ) as { entityId: string };
    const x = parse(
      await call('memory_remember', {
        entity: { type: 'project', name: 'Project:X' },
        observations: [{ text: 'a mission' }],
      }),
    ) as { entityId: string };

    parse(
      await call('memory_link', {
        fromEntity: a.entityId,
        toEntity: x.entityId,
        predicate: 'works on',
      }),
    );

    const recalled = parse(await call('memory_recall', { query: 'astronaut' })) as {
      entities: { name: string }[];
      relations: { predicate: string }[];
    };
    expect(recalled.entities.map((e) => e.name)).toContain('Project:X');
    expect(recalled.relations.some((r) => r.predicate === 'works_on')).toBe(true);
  });

  it('lists entity types with usage counts', async () => {
    await call('memory_remember', {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'x' }],
    });
    const types = parse(await call('memory_list_types')) as {
      name: string;
      usageCount: number;
    }[];
    expect(types.find((t) => t.name === 'person')?.usageCount).toBe(1);
  });

  it('soft-forgets so recall no longer returns the entity', async () => {
    const a = parse(
      await call('memory_remember', {
        entity: { type: 'person', name: 'Person:A' },
        observations: [{ text: 'remembered then forgotten' }],
      }),
    ) as { entityId: string };

    parse(await call('memory_forget', { kind: 'entity', id: a.entityId }));

    const recalled = parse(
      await call('memory_recall', { query: 'forgotten', includeGraph: false }),
    ) as {
      entities: unknown[];
    };
    expect(recalled.entities).toHaveLength(0);
  });

  it('returns an in-band error for a missing entity', async () => {
    const result = await call('memory_get_entity', {
      id: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.isError).toBe(true);
  });

  describe('memory_export markdownDir containment', () => {
    const KEY = 'TARS_MIRROR_DIR';
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env[KEY];
      delete process.env[KEY];
    });

    afterEach(() => {
      if (saved === undefined) {
        delete process.env[KEY];
      } else {
        process.env[KEY] = saved;
      }
    });

    it('refuses mirror writes when no mirror root is configured', async () => {
      const result = await call('memory_export', { markdownDir: '/tmp/anywhere' });
      expect(result.isError).toBe(true);
      expect(textBlock(result)).toMatch(/disabled|TARS_MIRROR_DIR/i);
    });

    it('rejects a markdownDir outside the configured mirror root', async () => {
      process.env[KEY] = '/var/lib/tars-mirror';
      const result = await call('memory_export', { markdownDir: '/var/lib/tars-mirror/../etc' });
      expect(result.isError).toBe(true);
      expect(textBlock(result)).toMatch(/inside the configured mirror root/i);
    });

    it('rejects a relative markdownDir', async () => {
      process.env[KEY] = '/var/lib/tars-mirror';
      const result = await call('memory_export', { markdownDir: 'relative/dir' });
      expect(result.isError).toBe(true);
      expect(textBlock(result)).toMatch(/absolute path/i);
    });
  });
});

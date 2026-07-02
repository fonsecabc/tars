import { isAbsolute, resolve, sep } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { renderRecallCompact, type Memory } from '@tars/core';
import { z } from 'zod';

import { recallDefaultsFromEnv } from './config.js';

/** Run an operation and serialize its result as a single text block (errors in-band). */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date/time: "${value}" (expected ISO 8601)`);
  }
  return date;
}

const sourceSchema = z.enum(['chat', 'manual', 'import', 'extraction']);

/**
 * Resolve and validate a caller-supplied mirror target path. `memory_export` can write a
 * full Markdown mirror to `markdownDir` and recursively deletes `<dir>/entities` on each
 * run — left unvalidated that is an arbitrary file write/delete primitive for anyone who
 * can call the tool. We require an operator-configured allowed root (`TARS_MIRROR_DIR`, or
 * the server's existing `MIRROR_DIR`) and reject any path that resolves outside it.
 */
function resolveMirrorDir(requested: string): string {
  const root = process.env.TARS_MIRROR_DIR ?? process.env.MIRROR_DIR;
  if (!root) {
    throw new Error(
      'Markdown mirror writes are disabled: set TARS_MIRROR_DIR to an allowed mirror root ' +
        'to enable memory_export markdownDir.',
    );
  }
  if (!isAbsolute(requested)) {
    throw new Error('markdownDir must be an absolute path.');
  }
  const allowedRoot = resolve(root);
  const target = resolve(requested);
  if (target !== allowedRoot && !target.startsWith(allowedRoot + sep)) {
    throw new Error(`markdownDir must be inside the configured mirror root (${allowedRoot}).`);
  }
  return target;
}

/**
 * Register all memory tools on an McpServer. Thin adapters: validate input, call the
 * core {@link Memory} facade, return compact structured text. Descriptions assume the
 * model has zero prior knowledge about the user.
 */
export function registerMemoryTools(server: McpServer, memory: Memory): void {
  const recallDefaults = recallDefaultsFromEnv();

  server.registerTool(
    'memory_remember',
    {
      title: 'Remember',
      description:
        'Store one or more dated observations (facts) about an entity in the personal ' +
        'memory. An entity is any thing worth remembering — a person, organization, ' +
        'project, place, event, etc. Identify the entity by id, or by type + name to ' +
        'find-or-create it. Entity types are an open vocabulary (snake_case).',
      inputSchema: {
        entity: z.object({
          id: z.string().uuid().optional().describe('Existing entity id, if known.'),
          type: z
            .string()
            .optional()
            .describe('Entity type, e.g. person, project, place (snake_case, open set).'),
          name: z.string().optional().describe('Entity name.'),
          aliases: z.array(z.string()).optional(),
          metadata: z.record(z.unknown()).optional(),
        }),
        observations: z
          .array(
            z.object({
              text: z.string().min(1).describe('The fact, as a short statement.'),
              validFrom: z.string().optional().describe('ISO 8601 time the fact became true.'),
              validTo: z.string().optional().describe('ISO 8601 time the fact stopped being true.'),
              confidence: z.number().min(0).max(1).optional(),
              tags: z.array(z.string()).optional(),
            }),
          )
          .min(1),
        source: sourceSchema.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const e = args.entity;
        const entity = e.id
          ? { id: e.id }
          : e.type && e.name
            ? { type: e.type, name: e.name, aliases: e.aliases, metadata: e.metadata }
            : null;
        if (!entity) {
          throw new Error('entity requires either { id } or { type, name }');
        }
        const observations = args.observations.map((o) => ({
          text: o.text,
          validFrom: parseDate(o.validFrom),
          validTo: parseDate(o.validTo),
          confidence: o.confidence,
          tags: o.tags,
        }));
        const result = await memory.remember({ entity, observations, source: args.source });
        return {
          entityId: result.entity.id,
          entityCreated: result.entityCreated,
          observationIds: result.observations.map((o) => o.id),
        };
      }),
  );

  server.registerTool(
    'memory_link',
    {
      title: 'Link',
      description:
        'Create a directed, active-voice relation between two existing entities, e.g. ' +
        '"A works_with B". The predicate is an open vocabulary (snake_case) and is ' +
        'registered automatically. Get entity ids from memory_recall or memory_remember.',
      inputSchema: {
        fromEntity: z.string().uuid(),
        toEntity: z.string().uuid(),
        predicate: z.string().describe('Active-voice predicate, e.g. works_with, lives_in.'),
        validFrom: z.string().optional(),
        validTo: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        source: sourceSchema.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const relation = await memory.link({
          fromEntity: args.fromEntity,
          toEntity: args.toEntity,
          predicate: args.predicate,
          validFrom: parseDate(args.validFrom),
          validTo: parseDate(args.validTo),
          metadata: args.metadata,
          source: args.source,
        });
        return { relationId: relation.id, predicate: relation.predicate };
      }),
  );

  server.registerTool(
    'memory_recall',
    {
      title: 'Recall',
      description:
        'Search the personal memory. The primary read path: hybrid keyword + graph ' +
        'retrieval returning the most relevant entities, their matching observations, ' +
        'and connecting relations. Use this before answering questions about the user. ' +
        "Set format:'compact' for terse, id-free text bounded by maxChars — use it when " +
        'feeding a small / local model whose context is easy to overwhelm.',
      inputSchema: {
        query: z.string().min(1),
        types: z.array(z.string()).optional().describe('Restrict to these entity types.'),
        predicates: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        includeGraph: z.boolean().optional().describe('Pull in connected context (default true).'),
        graphDepth: z.number().int().min(1).max(2).optional(),
        asOf: z.string().optional().describe('ISO 8601: recall facts valid at this instant.'),
        format: z
          .enum(['json', 'compact'])
          .optional()
          .describe("'json' (full, with ids) or 'compact' (terse text, no ids) for small models."),
        maxChars: z
          .number()
          .int()
          .min(200)
          .max(20000)
          .optional()
          .describe('Char ceiling for compact output.'),
        scoreFloor: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'Drop weak matches below topScore*scoreFloor (0 disables). Precision over recall.',
          ),
      },
    },
    async (args) => {
      try {
        const result = await memory.recall(args.query, {
          types: args.types,
          predicates: args.predicates,
          limit: args.limit ?? recallDefaults.limit,
          includeGraph: args.includeGraph,
          graphDepth: args.graphDepth ?? recallDefaults.graphDepth,
          observationsPerEntity: recallDefaults.observationsPerEntity,
          scoreFloor: args.scoreFloor ?? recallDefaults.scoreFloor,
          rrfK: recallDefaults.rrfK,
          asOf: parseDate(args.asOf),
        });

        const format = args.format ?? recallDefaults.format;
        if (format === 'compact') {
          const text = renderRecallCompact(result, {
            maxChars: args.maxChars ?? recallDefaults.maxChars,
          });
          return { content: [{ type: 'text', text }] };
        }

        const data = {
          query: result.query,
          entities: result.entities.map((e) => ({
            id: e.entity.id,
            type: e.entity.type,
            name: e.entity.name,
            hopDistance: e.hopDistance,
            matchedVia: e.matchedVia,
            observations: e.observations.map((o) => ({
              id: o.id,
              text: o.text,
              validFrom: o.validFrom,
              validTo: o.validTo,
              source: o.source,
            })),
          })),
          relations: result.relations.map((r) => ({
            id: r.id,
            from: r.fromEntity,
            to: r.toEntity,
            predicate: r.predicate,
          })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'memory_get_entity',
    {
      title: 'Get entity',
      description: 'Fetch one entity by id with its observations and direct relations.',
      inputSchema: {
        id: z.string().uuid(),
        asOf: z.string().optional(),
        observationsLimit: z.number().int().min(1).max(500).optional(),
        includeDeleted: z.boolean().optional(),
      },
    },
    async (args) =>
      run(async () => {
        const detail = await memory.getEntity(args.id, {
          asOf: parseDate(args.asOf),
          observationsLimit: args.observationsLimit,
          includeDeleted: args.includeDeleted,
        });
        if (!detail) {
          throw new Error(`Entity not found: ${args.id}`);
        }
        return detail;
      }),
  );

  server.registerTool(
    'memory_timeline',
    {
      title: 'Timeline',
      description:
        'List observations/events in reverse time order, optionally filtered to one ' +
        'entity, a time window, or entity types.',
      inputSchema: {
        entityId: z.string().uuid().optional(),
        from: z.string().optional().describe('ISO 8601 start of window.'),
        to: z.string().optional().describe('ISO 8601 end of window.'),
        types: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const entries = await memory.timeline({
          entityId: args.entityId,
          from: parseDate(args.from),
          to: parseDate(args.to),
          types: args.types,
          limit: args.limit,
        });
        return entries.map((e) => ({
          entityId: e.entity.id,
          entityName: e.entity.name,
          entityType: e.entity.type,
          observation: {
            id: e.observation.id,
            text: e.observation.text,
            validFrom: e.observation.validFrom,
            validTo: e.observation.validTo,
            source: e.observation.source,
          },
        }));
      }),
  );

  server.registerTool(
    'memory_correct',
    {
      title: 'Correct',
      description:
        'Supersede an observation with a corrected version without destroying history. ' +
        'Closes the old fact and records the new one, linked as a correction. Use this ' +
        'when a remembered fact changed or was wrong.',
      inputSchema: {
        observationId: z.string().uuid(),
        text: z.string().min(1).describe('The corrected fact.'),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        validFrom: z.string().optional().describe('ISO 8601 time the correction takes effect.'),
        source: sourceSchema.optional(),
      },
    },
    async (args) =>
      run(async () => {
        const result = await memory.correct({
          observationId: args.observationId,
          text: args.text,
          confidence: args.confidence,
          tags: args.tags,
          validFrom: parseDate(args.validFrom),
          source: args.source,
        });
        return { supersededId: result.superseded.id, createdId: result.created.id };
      }),
  );

  server.registerTool(
    'memory_forget',
    {
      title: 'Forget',
      description:
        'Delete an entity, observation, or relation. Soft-delete by default ' +
        '(recoverable, hidden from recall); set hard=true to delete permanently. ' +
        'Hard-deleting an entity also removes its observations and relations.',
      inputSchema: {
        kind: z.enum(['entity', 'observation', 'relation']),
        id: z.string().uuid(),
        hard: z.boolean().optional(),
        source: sourceSchema.optional(),
      },
    },
    async (args) =>
      run(() =>
        memory.forget({ kind: args.kind, id: args.id, hard: args.hard, source: args.source }),
      ),
  );

  server.registerTool(
    'memory_list_entities',
    {
      title: 'List entities',
      description: 'Browse/paginate entities, optionally by type. For orientation.',
      inputSchema: {
        type: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const entities = await memory.listEntities({
          type: args.type,
          limit: args.limit,
          offset: args.offset,
        });
        return entities.map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
          aliases: e.aliases,
        }));
      }),
  );

  server.registerTool(
    'memory_list_types',
    {
      title: 'List entity types',
      description: 'List the entity types in use (the registry) with usage counts.',
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const types = await memory.listTypes();
        return types.map((t) => ({
          name: t.name,
          description: t.description,
          usageCount: t.usageCount,
        }));
      }),
  );

  server.registerTool(
    'memory_define_type',
    {
      title: 'Define entity type',
      description:
        'Register or describe an entity type. Optional — types also auto-register on ' +
        'first use; use this to add a human-readable description.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
      },
    },
    async (args) => run(() => memory.defineType(args.name, args.description)),
  );

  server.registerTool(
    'memory_list_predicates',
    {
      title: 'List relation predicates',
      description: 'List the relation predicates in use (the registry) with usage counts.',
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const predicates = await memory.listPredicates();
        return predicates.map((p) => ({
          name: p.name,
          description: p.description,
          usageCount: p.usageCount,
        }));
      }),
  );

  server.registerTool(
    'memory_export',
    {
      title: 'Export',
      description:
        'Emit a portable JSON dump of all or part of the graph (entities with their ' +
        'observations and outgoing relations). Bounded; filter by type to scope it. Pass ' +
        'markdownDir to instead write the full, unbounded Markdown mirror + export.json to ' +
        'that directory (one-way DB → Markdown).',
      inputSchema: {
        type: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        markdownDir: z
          .string()
          .optional()
          .describe(
            'Absolute path inside the configured mirror root (TARS_MIRROR_DIR): write the ' +
              'full Markdown mirror + export.json here.',
          ),
        commit: z.boolean().optional().describe('When writing the mirror, also git-commit it.'),
      },
    },
    async (args) =>
      run(async () => {
        if (args.markdownDir !== undefined) {
          const result = await memory.writeMirror({
            dir: resolveMirrorDir(args.markdownDir),
            commit: args.commit ?? false,
          });
          return { wroteMirror: true, ...result };
        }
        return memory.export({
          type: args.type,
          limit: args.limit,
        });
      }),
  );

  server.registerTool(
    'memory_audit',
    {
      title: 'Audit log',
      description:
        'Review the append-only audit log — every write/delete (entity/observation/relation ' +
        'create, observation supersede, soft/hard delete, type/predicate define). Filter by ' +
        'action or target. Use for provenance and "what changed, when".',
      inputSchema: {
        action: z
          .string()
          .optional()
          .describe('Exact action, e.g. entity.create, observation.supersede.'),
        targetKind: z
          .enum(['entity', 'observation', 'relation', 'entity_type', 'relation_predicate'])
          .optional(),
        targetId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const entries = await memory.listAudit({
          action: args.action,
          targetKind: args.targetKind,
          targetId: args.targetId,
          limit: args.limit,
        });
        return entries.map((e) => ({
          id: e.id,
          at: e.at,
          action: e.action,
          target: `${e.targetKind}:${e.targetId}`,
          source: e.source,
        }));
      }),
  );
}

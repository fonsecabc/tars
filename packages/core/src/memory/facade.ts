import type { Pool } from 'pg';

import {
  backfillEmbeddings,
  embedObservations,
  type BackfillOptions,
  type BackfillResult,
  type EmbeddingProvider,
} from '../embeddings/index.js';
import {
  gitCommitMirror,
  writeMirror as writeMirrorCore,
  type MirrorResult,
} from '../mirror/index.js';
import { rerankCandidates, type RerankLlm } from '../rerank/index.js';
import type {
  AuditEntry,
  Entity,
  EntityType,
  RelationPredicate,
  Relation,
  Uuid,
} from '../schema/index.js';
import { listAudit as listAuditStore, type ListAuditOptions } from '../store/audit.js';
import type { ListEntitiesOptions } from '../store/entities.js';
import { listEntities as listEntitiesStore } from '../store/entities.js';
import { listEntityTypes, listRelationPredicates } from '../store/registries.js';
import { correct, type CorrectInput, type CorrectResult } from './correct.js';
import { exportMemory, type ExportDump, type ExportOptions } from './export.js';
import { forget, type ForgetInput, type ForgetResult } from './forget.js';
import { getEntity, type EntityDetail, type GetEntityOptions } from './get-entity.js';
import { link, type LinkInput } from './link.js';
import { recall, type RecallOptions, type RecallResult } from './recall.js';
import { defineEntityType, defineRelationPredicate } from './registry.js';
import { remember, type RememberInput, type RememberResult } from './remember.js';
import { timeline, type TimelineEntry, type TimelineOptions } from './timeline.js';

/**
 * The single bound interface the MCP layer depends on. `createMemory(pool)` wires every
 * high-level operation to a connection pool, so callers (e.g. `@tars/mcp`) never touch
 * `pg` or transactions directly. An optional embedding provider enables the semantic
 * (vector) signal; without one, retrieval is keyword + graph only (zero external calls).
 */
export interface Memory {
  remember(input: RememberInput): Promise<RememberResult>;
  link(input: LinkInput): Promise<Relation>;
  recall(query: string, options?: RecallOptions): Promise<RecallResult>;
  getEntity(id: Uuid, options?: GetEntityOptions): Promise<EntityDetail | undefined>;
  timeline(options?: TimelineOptions): Promise<TimelineEntry[]>;
  correct(input: CorrectInput): Promise<CorrectResult>;
  forget(input: ForgetInput): Promise<ForgetResult>;
  listEntities(options?: ListEntitiesOptions): Promise<Entity[]>;
  listTypes(): Promise<EntityType[]>;
  defineType(name: string, description?: string): Promise<EntityType>;
  listPredicates(): Promise<RelationPredicate[]>;
  definePredicate(name: string, description?: string): Promise<RelationPredicate>;
  export(options?: ExportOptions): Promise<ExportDump>;
  /** Write the whole graph to `dir` as linked Markdown + export.json (one-way DB → Markdown). */
  writeMirror(options: { dir: string; commit?: boolean }): Promise<MirrorResult>;
  /** Read the append-only audit log (filter by action/target). */
  listAudit(options?: ListAuditOptions): Promise<AuditEntry[]>;
  /** Whether a semantic (vector) signal is active. */
  readonly embeddingsEnabled: boolean;
  /** Embed observations still missing a vector (no-op when embeddings are disabled). */
  backfillEmbeddings(options?: BackfillOptions): Promise<BackfillResult>;
}

export interface MemoryOptions {
  /** Embedding provider, or null/omitted for keyword-only retrieval (zero external calls). */
  embeddings?: EmbeddingProvider | null;
  /**
   * Optional LLM reranker. When set, recall retrieves a larger candidate pool and the reranker
   * reorders it before truncation — big win on relational/collision queries, at the cost of one
   * LLM call per recall. Omit/null to return pure retrieval order (zero extra calls).
   */
  reranker?: RerankLlm | null;
}

/** How many candidates to retrieve for the reranker to reorder before truncating to `limit`. */
const RERANK_POOL_SIZE = 20;

export function createMemory(pool: Pool, memoryOptions: MemoryOptions = {}): Memory {
  const provider = memoryOptions.embeddings ?? null;
  const reranker = memoryOptions.reranker ?? null;

  return {
    embeddingsEnabled: provider !== null,

    remember: async (input) => {
      const result = await remember(pool, input);
      if (provider) {
        // Best-effort: a stored observation must not fail because embedding did. Backfill
        // (or the next recall's query embedding) covers any that slip through here.
        await embedObservations(pool, provider, result.observations).catch((error: unknown) => {
          console.warn(`[tars] embed-on-write failed (run backfill later): ${String(error)}`);
        });
      }
      return result;
    },

    link: (input) => link(pool, input),

    recall: async (query, options) => {
      let queryEmbedding: number[] | undefined;
      if (provider && query.trim().length > 0) {
        try {
          queryEmbedding = (await provider.embed([query]))[0];
        } catch (error: unknown) {
          console.warn(`[tars] query embedding failed, keyword-only: ${String(error)}`);
        }
      }
      const baseOptions = queryEmbedding ? { ...options, queryEmbedding } : options;
      if (!reranker || query.trim().length === 0) {
        return recall(pool, query, baseOptions);
      }

      // Retrieve a wider pool, let the LLM reorder it, then truncate to the caller's limit.
      const userLimit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
      const poolResult = await recall(pool, query, {
        ...baseOptions,
        limit: Math.max(userLimit, RERANK_POOL_SIZE),
      });
      const candidates = poolResult.entities.map((e) => ({
        id: e.entity.id,
        label:
          `${e.entity.type}:${e.entity.name}` +
          (e.observations.length > 0 ? ` — ${e.observations.map((o) => o.text).join('; ')}` : ''),
      }));
      let order: string[];
      try {
        order = await rerankCandidates(query, candidates, reranker);
      } catch (error: unknown) {
        console.warn(`[tars] rerank failed, retrieval order kept: ${String(error)}`);
        order = candidates.map((c) => c.id);
      }
      const byId = new Map(poolResult.entities.map((e) => [e.entity.id, e]));
      const reordered = order
        .map((id) => byId.get(id))
        .filter((e): e is (typeof poolResult.entities)[number] => e !== undefined)
        .slice(0, userLimit);
      const keptIds = new Set(reordered.map((e) => e.entity.id));
      const relations = poolResult.relations.filter(
        (r) => keptIds.has(r.fromEntity) && keptIds.has(r.toEntity),
      );
      return { query: poolResult.query, entities: reordered, relations };
    },

    getEntity: (id, options) => getEntity(pool, id, options),
    timeline: (options) => timeline(pool, options),

    correct: async (input) => {
      const result = await correct(pool, input);
      if (provider) {
        await embedObservations(pool, provider, [result.created]).catch((error: unknown) => {
          console.warn(`[tars] embed-on-correct failed (run backfill later): ${String(error)}`);
        });
      }
      return result;
    },

    forget: (input) => forget(pool, input),
    listEntities: (options) => listEntitiesStore(pool, options),
    listTypes: () => listEntityTypes(pool),
    defineType: (name, description) => defineEntityType(pool, name, description),
    listPredicates: () => listRelationPredicates(pool),
    listAudit: (options) => listAuditStore(pool, options),
    definePredicate: (name, description) => defineRelationPredicate(pool, name, description),
    export: (options) => exportMemory(pool, options),

    writeMirror: async (options) => {
      const result = await writeMirrorCore(pool, {
        dir: options.dir,
      });
      if (options.commit) {
        await gitCommitMirror(options.dir);
      }
      return result;
    },

    backfillEmbeddings: (options) =>
      provider ? backfillEmbeddings(pool, provider, options) : Promise.resolve({ embedded: 0 }),
  };
}

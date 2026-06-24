import type { Pool } from 'pg';

import { expandGraph } from '../retrieval/graph.js';
import { keywordSearchEntities, keywordSearchObservations } from '../retrieval/keyword.js';
import { rankByScore, rrfFuse } from '../retrieval/rrf.js';
import { vectorSearchObservations, type VectorHit } from '../retrieval/vector.js';
import { normalizeRegistryName } from '../schema/common.js';
import type { Entity, Observation, Relation, Uuid } from '../schema/index.js';
import * as entitiesStore from '../store/entities.js';
import * as observationsStore from '../store/observations.js';
import { listRelationsAmong } from '../store/relations.js';

export interface RecallOptions {
  /** Restrict to these entity types (normalized to snake_case). */
  types?: string[];
  /** Restrict graph edges / returned relations to these predicates. */
  predicates?: string[];
  /** Max entities to return (default 10, capped at 50). */
  limit?: number;
  /** Pull in graph-connected context (default true). */
  includeGraph?: boolean;
  /** Hops of graph expansion, 1–2 (default 1). */
  graphDepth?: number;
  /** Point-in-time: only facts/relations valid at this instant. */
  asOf?: Date;
  /** Max observations attached per entity (default 3, capped at 20). */
  observationsPerEntity?: number;
  /** Precomputed query embedding; when present, adds the vector-similarity signal to RRF. */
  queryEmbedding?: readonly number[];
}

export interface RecalledEntity {
  entity: Entity;
  /** Fused relevance score (RRF); 0 for purely graph-reached entities. */
  score: number;
  /** 0 = direct keyword/vector match; ≥1 = hops from a seed. */
  hopDistance: number;
  matchedVia: ('keyword' | 'graph' | 'vector')[];
  observations: Observation[];
}

export interface RecallResult {
  query: string;
  entities: RecalledEntity[];
  /** Connecting relations among the returned entities. */
  relations: Relation[];
}

function dedupe(ids: readonly Uuid[]): Uuid[] {
  const seen = new Set<Uuid>();
  const out: Uuid[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Hybrid recall — the primary read path. Fuses keyword signals (entity name/alias FTS +
 * observation FTS) and, when a query embedding is supplied, vector similarity, via
 * Reciprocal Rank Fusion; optionally expands the graph from the top seeds; and returns
 * ranked entities with their most relevant observations plus connecting relations.
 */
export async function recall(
  pool: Pool,
  query: string,
  options: RecallOptions = {},
): Promise<RecallResult> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const includeGraph = options.includeGraph ?? true;
  const graphDepth = Math.min(Math.max(options.graphDepth ?? 1, 1), 2);
  const obsPerEntity = Math.min(Math.max(options.observationsPerEntity ?? 3, 1), 20);
  const types = options.types?.map(normalizeRegistryName);
  const predicates = options.predicates?.map(normalizeRegistryName);
  const queryEmbedding = options.queryEmbedding;

  // 1. Signals: entity-name FTS, observation FTS, and (when a query embedding is given)
  //    vector similarity over observation embeddings.
  const [obsHits, entHits, vecHits] = await Promise.all([
    keywordSearchObservations(pool, query, {
      types,
      asOf: options.asOf,
      limit: 100,
    }),
    keywordSearchEntities(pool, query, { types, limit: 100 }),
    queryEmbedding && queryEmbedding.length > 0
      ? vectorSearchObservations(pool, queryEmbedding, {
          types,
          asOf: options.asOf,
          limit: 100,
        })
      : Promise.resolve<VectorHit[]>([]),
  ]);

  // 2. Fuse entity-ranked lists with RRF (rank order only — scales don't matter).
  const entityList = entHits.map((h) => h.entityId);
  const observationEntityList = dedupe(obsHits.map((h) => h.entityId));
  const vectorEntityList = dedupe(vecHits.map((h) => h.entityId));
  const lists: Uuid[][] = [entityList, observationEntityList];
  if (vectorEntityList.length > 0) {
    lists.push(vectorEntityList);
  }
  const fused = rrfFuse(lists);
  const seedRanking = rankByScore(fused);

  const keywordEntityIds = new Set<Uuid>([...entityList, ...observationEntityList]);
  const vectorEntityIds = new Set<Uuid>(vectorEntityList);

  // Group matched observations by entity (keyword hits first, then vector hits).
  const matchedObsByEntity = new Map<Uuid, Uuid[]>();
  for (const hit of [...obsHits, ...vecHits]) {
    const list = matchedObsByEntity.get(hit.entityId) ?? [];
    list.push(hit.observationId);
    matchedObsByEntity.set(hit.entityId, list);
  }

  // 3. Graph expansion from the top seeds.
  const seedsForGraph = seedRanking.slice(0, limit);
  const graphNodes =
    includeGraph && seedsForGraph.length > 0
      ? await expandGraph(pool, seedsForGraph, { maxHops: graphDepth, predicates })
      : [];
  const depthById = new Map<Uuid, number>();
  for (const node of graphNodes) {
    depthById.set(node.entityId, node.depth);
  }

  // 4. Final ordering: fused seeds (by score) first, then graph-only entities by depth.
  const ordered: Uuid[] = [];
  const seen = new Set<Uuid>();
  for (const id of seedRanking) {
    ordered.push(id);
    seen.add(id);
  }
  const graphOnly = graphNodes
    .filter((node) => node.depth >= 1 && !seen.has(node.entityId))
    .sort((a, b) => a.depth - b.depth);
  for (const node of graphOnly) {
    ordered.push(node.entityId);
    seen.add(node.entityId);
  }

  // 5. Assemble bounded results.
  const recalled: RecalledEntity[] = [];
  for (const id of ordered) {
    if (recalled.length >= limit) {
      break;
    }
    const entity = await entitiesStore.findEntityById(pool, id);
    if (!entity) {
      continue;
    }
    if (types && !types.includes(entity.type)) {
      continue;
    }

    const matchedIds = dedupe(matchedObsByEntity.get(id) ?? []);
    let observations: Observation[];
    if (matchedIds.length > 0) {
      const fetched = await Promise.all(
        matchedIds
          .slice(0, obsPerEntity)
          .map((oid) => observationsStore.getObservationById(pool, oid)),
      );
      observations = fetched.filter((o): o is Observation => o !== undefined);
    } else {
      observations = await observationsStore.listObservationsByEntity(pool, id, {
        asOf: options.asOf,
        limit: obsPerEntity,
      });
    }

    const isSeed = fused.has(id);
    const matchedVia: ('keyword' | 'graph' | 'vector')[] = [];
    if (keywordEntityIds.has(id)) {
      matchedVia.push('keyword');
    }
    if (vectorEntityIds.has(id)) {
      matchedVia.push('vector');
    }
    if (!isSeed && (depthById.get(id) ?? 0) >= 1) {
      matchedVia.push('graph');
    }

    recalled.push({
      entity,
      score: fused.get(id) ?? 0,
      hopDistance: isSeed ? 0 : (depthById.get(id) ?? 0),
      matchedVia: matchedVia.length > 0 ? matchedVia : ['graph'],
      observations,
    });
  }

  // 6. Connecting relations among the returned entities.
  const relations = await listRelationsAmong(
    pool,
    recalled.map((r) => r.entity.id),
    { predicates, asOf: options.asOf },
  );

  return { query, entities: recalled, relations };
}

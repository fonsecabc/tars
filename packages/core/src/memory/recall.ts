import type { Pool } from 'pg';

import { expandGraph } from '../retrieval/graph.js';
import {
  exactEntityMatches,
  keywordSearchEntities,
  keywordSearchObservations,
} from '../retrieval/keyword.js';
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
  /**
   * Drop seeds whose fused score is below `topScore * scoreFloor` (relative cutoff, 0–1).
   * 0/undefined disables it. The top seed is always kept. Trades recall for precision —
   * useful when feeding a small model that shouldn't be padded with weak matches.
   */
  scoreFloor?: number;
  /** RRF fusion constant k (default 60). Larger k flattens rank influence. */
  rrfK?: number;
  /**
   * Per-signal fusion weights. Defaults trust the entity name/alias signal above the
   * observation and vector signals (name 2, observation 1, vector 1), so a strong lexical
   * match on a name/alias isn't buried under semantically-adjacent vector noise.
   */
  signalWeights?: { name?: number; observation?: number; vector?: number };
  /**
   * Multiplicative spreading-activation weight (default 1.4): scales a candidate's own fused
   * score by its proximity to a strong graph neighbour (normalized). Own-relevance-gated, so it
   * disambiguates collisions rather than boosting every neighbour of a hub. 0 disables it.
   */
  graphBoostMul?: number;
  /**
   * Additive spreading-activation floor (default 0.15): a small share of the best neighbour's
   * fused score added unconditionally, so a purely relational answer with ~zero own score still
   * gets pulled up. 0 disables it.
   */
  graphBoostAdd?: number;
  /** @deprecated back-compat alias for {@link graphBoostMul}. */
  graphDecay?: number;
  /**
   * Additive score bonus for an entity whose name/alias equals the query exactly, applied
   * after fusion + propagation (default 1.0 — far above any RRF score, so an exact match
   * ranks first). 0 disables it.
   */
  exactMatchBonus?: number;
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
  const [obsHits, entHits, vecHits, exactIds] = await Promise.all([
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
    exactEntityMatches(pool, query, { types }),
  ]);

  // 2. Fuse entity-ranked lists with RRF (rank order only — scales don't matter).
  const entityList = entHits.map((h) => h.entityId);
  const observationEntityList = dedupe(obsHits.map((h) => h.entityId));
  const vectorEntityList = dedupe(vecHits.map((h) => h.entityId));
  const weightCfg = options.signalWeights ?? {};
  const nameWeight = weightCfg.name ?? 2;
  const obsWeight = weightCfg.observation ?? 1;
  const vectorWeight = weightCfg.vector ?? 1;
  const lists: Uuid[][] = [entityList, observationEntityList];
  const weights: number[] = [nameWeight, obsWeight];
  if (vectorEntityList.length > 0) {
    lists.push(vectorEntityList);
    weights.push(vectorWeight);
  }
  const fused = rrfFuse(lists, options.rrfK ?? 60, weights);
  let seedRanking = rankByScore(fused);

  // Relevance floor: drop weak seeds relative to the top hit (always keep at least the top).
  // Applied before graph seeding so weak seeds don't drag in weak neighbourhoods.
  const scoreFloor = Math.min(Math.max(options.scoreFloor ?? 0, 0), 1);
  const topSeed = seedRanking[0];
  if (scoreFloor > 0 && topSeed !== undefined) {
    const threshold = (fused.get(topSeed) ?? 0) * scoreFloor;
    const filtered = seedRanking.filter((id) => (fused.get(id) ?? 0) >= threshold);
    seedRanking = filtered.length > 0 ? filtered : [topSeed];
  }

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

  // 4. Spreading activation: a graph-only entity inherits a decayed share of its best
  //    neighbour's score, so a neighbour of a strong seed ranks by relevance instead of
  //    being appended after every seed. Relations among the candidate set are reused for
  //    the final `relations` payload (step 6), so this costs one query, not two.
  const graphMul = Math.max(options.graphBoostMul ?? options.graphDecay ?? 1.4, 0);
  const graphAdd = Math.max(options.graphBoostAdd ?? 0.15, 0);
  const graphOnlyNodes = graphNodes
    .filter((node) => node.depth >= 1 && !fused.has(node.entityId))
    .sort((a, b) => a.depth - b.depth);

  const candidateIds = dedupe([
    ...seedRanking,
    ...graphOnlyNodes.map((n) => n.entityId),
    ...exactIds,
  ]);
  const candidateRelations =
    candidateIds.length > 0
      ? await listRelationsAmong(pool, candidateIds, { predicates, asOf: options.asOf })
      : [];
  const adjacency = new Map<Uuid, Uuid[]>();
  const addEdge = (from: Uuid, to: Uuid): void => {
    const list = adjacency.get(from);
    if (list) {
      list.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };
  for (const rel of candidateRelations) {
    addEdge(rel.fromEntity, rel.toEntity);
    addEdge(rel.toEntity, rel.fromEntity);
  }

  // Blended score = graph spreading activation over the fused scores (one hop). Two terms,
  // because two query shapes need different things:
  //   • MULTIPLICATIVE (graphMul): scale a candidate's OWN score by proximity to a strong
  //     neighbour. This gates the boost on the candidate's own relevance, so a collision query
  //     ("the Alex who works at Acme") lifts the Alex that actually matches "Alex" AND neighbours
  //     Acme — not every one of Acme's neighbours.
  //   • ADDITIVE (graphAdd): a small floor so a purely relational answer with ~zero own score
  //     ("Bob's manager" → Ana) still gets pulled up by its strong neighbour.
  // Reads the original fused scores (one hop, no cascade), so a strong seed can only gain.
  let maxFused = 0;
  for (const score of fused.values()) {
    maxFused = Math.max(maxFused, score);
  }
  const norm = maxFused > 0 ? maxFused : 1;
  const blended = new Map<Uuid, number>();
  for (const id of candidateIds) {
    let bestNeighbour = 0;
    for (const neighbour of adjacency.get(id) ?? []) {
      bestNeighbour = Math.max(bestNeighbour, fused.get(neighbour) ?? 0);
    }
    const own = fused.get(id) ?? 0;
    blended.set(id, own * (1 + graphMul * (bestNeighbour / norm)) + graphAdd * bestNeighbour);
  }

  // Exact name/alias match wins outright: a bonus far above any RRF score.
  const exactBonus = Math.max(options.exactMatchBonus ?? 1, 0);
  if (exactBonus > 0) {
    for (const id of exactIds) {
      blended.set(id, (blended.get(id) ?? 0) + exactBonus);
    }
  }

  // Final ordering: everything by blended score (desc), ties broken by hop distance (asc).
  const ordered = candidateIds.slice().sort((a, b) => {
    const diff = (blended.get(b) ?? 0) - (blended.get(a) ?? 0);
    if (diff !== 0) {
      return diff;
    }
    return (depthById.get(a) ?? 0) - (depthById.get(b) ?? 0);
  });

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
      score: blended.get(id) ?? 0,
      hopDistance: isSeed ? 0 : (depthById.get(id) ?? 0),
      matchedVia: matchedVia.length > 0 ? matchedVia : ['graph'],
      observations,
    });
  }

  // 6. Connecting relations among the returned entities — filtered from the candidate-set
  //    relations already fetched for spreading activation (no extra query).
  const returnedIds = new Set(recalled.map((r) => r.entity.id));
  const relations = candidateRelations.filter(
    (r) => returnedIds.has(r.fromEntity) && returnedIds.has(r.toEntity),
  );

  return { query, entities: recalled, relations };
}

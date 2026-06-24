import type { Pool } from 'pg';

import {
  listObservationsNeedingEmbedding,
  updateObservationEmbedding,
} from '../store/observations.js';
import type { Uuid } from '../schema/index.js';
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider.js';

/** Embed a known set of observations and store their vectors. Used on the write path. */
export async function embedObservations(
  pool: Pool,
  provider: EmbeddingProvider,
  observations: readonly { id: Uuid; text: string }[],
): Promise<void> {
  if (observations.length === 0) {
    return;
  }
  const vectors = await provider.embed(observations.map((o) => o.text));
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    const vector = vectors[i];
    if (obs && vector) {
      await updateObservationEmbedding(pool, obs.id, vector);
    }
  }
}

export interface BackfillOptions {
  batchSize?: number;
  /** Cap on observations processed this run (default: all that need it). */
  max?: number;
  onProgress?: (embedded: number) => void;
}

export interface BackfillResult {
  embedded: number;
}

/**
 * Compute and store embeddings for observations missing them. Idempotent and resumable —
 * only rows with a NULL embedding are touched — so it is safe to run on boot, on a
 * schedule, or after a bulk import.
 */
export async function backfillEmbeddings(
  pool: Pool,
  provider: EmbeddingProvider,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Provider ${provider.id} emits ${provider.dimensions}-dim vectors; ` +
        `the column expects ${EMBEDDING_DIMENSIONS}. Reconfigure the model or migrate.`,
    );
  }
  const batchSize = Math.min(Math.max(options.batchSize ?? 64, 1), 512);
  let embedded = 0;
  for (;;) {
    if (options.max !== undefined && embedded >= options.max) {
      break;
    }
    const room = options.max !== undefined ? options.max - embedded : batchSize;
    const batch = await listObservationsNeedingEmbedding(pool, {
      limit: Math.min(batchSize, room),
    });
    if (batch.length === 0) {
      break;
    }
    await embedObservations(pool, provider, batch);
    embedded += batch.length;
    options.onProgress?.(embedded);
    if (batch.length < batchSize) {
      break;
    }
  }
  return { embedded };
}

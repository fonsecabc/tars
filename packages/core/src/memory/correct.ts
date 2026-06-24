import type { Pool } from 'pg';

import { withTransaction } from '../db/tx.js';
import { ObservationNotFoundError } from '../errors.js';
import type { CreateObservationInput, Observation, Source, Uuid } from '../schema/index.js';
import { appendAudit } from '../store/audit.js';
import * as observations from '../store/observations.js';

export interface CorrectInput {
  observationId: Uuid;
  /** The corrected fact. */
  text: string;
  confidence?: number;
  tags?: string[];
  /** When the correction takes effect (defaults to now). */
  validFrom?: Date;
  source?: Source;
}

export interface CorrectResult {
  superseded: Observation;
  created: Observation;
}

/**
 * Supersede an observation without destroying history: close the old row's validity at
 * `validFrom` (default now) and insert a new row linked back via `corrects_id`.
 */
export async function correct(pool: Pool, input: CorrectInput): Promise<CorrectResult> {
  const source: Source = input.source ?? 'manual';

  return withTransaction(pool, async (tx) => {
    const old = await observations.getObservationById(tx, input.observationId);
    if (!old) {
      throw new ObservationNotFoundError(input.observationId);
    }

    const at = input.validFrom ?? new Date();
    await observations.closeObservation(tx, old.id, at);

    const newObservation: CreateObservationInput = {
      text: input.text,
      confidence: input.confidence ?? old.confidence,
      tags: input.tags ?? old.tags,
      validFrom: at,
    };
    const created = await observations.insertObservation(tx, old.entityId, newObservation, {
      correctsId: old.id,
      source,
    });

    await appendAudit(tx, {
      action: 'observation.supersede',
      targetKind: 'observation',
      targetId: created.id,
      source,
      detail: { supersedes: old.id, entityId: old.entityId },
    });

    const superseded = await observations.getObservationById(tx, old.id);
    if (!superseded) {
      throw new ObservationNotFoundError(old.id);
    }
    return { superseded, created };
  });
}

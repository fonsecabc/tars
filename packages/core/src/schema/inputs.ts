import { z } from 'zod';

import { sourceSchema, uuidSchema } from './common.js';

/**
 * Input ("draft") shapes for the write API. We export `z.input` types so callers may
 * omit defaulted/optional fields (e.g. just `{ text }` for an observation); the store
 * applies the defaults. The zod schemas themselves are the validation boundary used by
 * the MCP layer, which also coerces ISO-string dates to `Date` before calling core.
 */

export const createEntityInputSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type CreateEntityInput = z.input<typeof createEntityInputSchema>;

export const createObservationInputSchema = z.object({
  text: z.string().min(1),
  validFrom: z.date().optional(),
  validTo: z.date().nullable().optional(),
  source: sourceSchema.optional(),
  confidence: z.number().min(0).max(1).default(1),
  tags: z.array(z.string()).default([]),
});
export type CreateObservationInput = z.input<typeof createObservationInputSchema>;

export const createRelationInputSchema = z.object({
  fromEntity: uuidSchema,
  toEntity: uuidSchema,
  predicate: z.string().min(1),
  validFrom: z.date().optional(),
  validTo: z.date().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type CreateRelationInput = z.input<typeof createRelationInputSchema>;

import { z } from 'zod';

/** A proposed entity. `ref` is a local handle used to wire observations/relations. */
export const proposedEntitySchema = z.object({
  ref: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
});

export const proposedObservationSchema = z.object({
  entityRef: z.string().min(1),
  text: z.string().min(1),
});

export const proposedRelationSchema = z.object({
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  predicate: z.string().min(1),
});

/** What the extractor proposes from free text — validated before anything is written. */
export const extractionProposalSchema = z.object({
  entities: z.array(proposedEntitySchema).default([]),
  observations: z.array(proposedObservationSchema).default([]),
  relations: z.array(proposedRelationSchema).default([]),
});

export type ProposedEntity = z.infer<typeof proposedEntitySchema>;
export type ExtractionProposal = z.infer<typeof extractionProposalSchema>;

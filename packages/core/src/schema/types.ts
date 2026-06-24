import type { Source, Uuid } from './common.js';

/** An entry in the entity-type registry (open vocabulary). */
export interface EntityType {
  name: string;
  description: string | null;
  createdAt: Date;
  usageCount: number;
}

/** An entry in the relation-predicate registry (open vocabulary). */
export interface RelationPredicate {
  name: string;
  description: string | null;
  createdAt: Date;
  usageCount: number;
}

/** A node in the knowledge graph. */
export interface Entity {
  id: Uuid;
  type: string;
  name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** An atomic, dated fact about an entity. Bi-temporal: validity is an interval. */
export interface Observation {
  id: Uuid;
  entityId: Uuid;
  text: string;
  validFrom: Date;
  /** null = still true now. */
  validTo: Date | null;
  recordedAt: Date;
  source: Source;
  confidence: number;
  tags: string[];
  /** If set, this observation supersedes the referenced one (a correction). */
  correctsId: Uuid | null;
  deletedAt: Date | null;
}

/** A directed, active-voice edge between two entities. */
export interface Relation {
  id: Uuid;
  fromEntity: Uuid;
  toEntity: Uuid;
  predicate: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  metadata: Record<string, unknown>;
  deletedAt: Date | null;
}

/** An append-only audit record. `id` is a bigint serialized as a string. */
export interface AuditEntry {
  id: string;
  at: Date;
  action: string;
  targetKind: string;
  targetId: string;
  source: string | null;
  detail: Record<string, unknown>;
}

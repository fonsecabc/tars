import { z } from 'zod';

/** A UUID (v4) primary key, represented as a string. */
export type Uuid = string;

export const uuidSchema = z.string().uuid();

/** Provenance of a write to memory. */
export const SOURCES = ['chat', 'manual', 'import', 'extraction'] as const;
export type Source = (typeof SOURCES)[number];
export const sourceSchema = z.enum(SOURCES);

/**
 * Registry names (entity types, relation predicates) are normalized to a stable
 * snake_case slug so the open vocabularies don't drift (`works_with` vs `Works With`,
 * `colleague_of` vs `colleague-of`).
 */
export function normalizeRegistryName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Parses and normalizes a registry name, rejecting anything that isn't a clean slug. */
export const registryNameSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normalizeRegistryName)
  .pipe(
    z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'must be snake_case: start with a letter, then letters/digits/underscores',
      ),
  );

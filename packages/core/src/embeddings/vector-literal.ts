/**
 * Serialize a vector to pgvector's text literal form, e.g. `[0.1,0.2,0.3]`. node-postgres
 * has no native pgvector codec, so we pass this string and cast it with `$n::vector`.
 *
 * Leaf module (imports nothing) so both `store` and `retrieval` can use it without cycles.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

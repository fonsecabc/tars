import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from '../embeddings/provider.js';

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % EMBEDDING_DIMENSIONS;
}

function tokensToVector(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const idx = hashToken(token);
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  return vec;
}

function pad(vec: readonly number[]): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (let i = 0; i < Math.min(vec.length, EMBEDDING_DIMENSIONS); i++) {
    out[i] = vec[i] ?? 0;
  }
  return out;
}

function normalize(vec: number[]): number[] {
  let sumSquares = 0;
  for (const x of vec) {
    sumSquares += x * x;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    const unit = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    unit[0] = 1;
    return unit;
  }
  return vec.map((x) => x / norm);
}

/**
 * Deterministic, offline embedding provider for tests. Maps text to a normalized
 * token-frequency vector (token overlap ≈ cosine similarity), with optional per-text
 * overrides to pin specific relationships (e.g. make "cat" ≈ "feline companion"). No
 * network, no Ollama — keeps the suite hermetic.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake';
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly overrides: Record<string, readonly number[]>;

  constructor(overrides: Record<string, readonly number[]> = {}) {
    this.overrides = overrides;
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.vector(text)));
  }

  private vector(text: string): number[] {
    const key = text.trim().toLowerCase();
    const override = this.overrides[key];
    return normalize(override ? pad(override) : tokensToVector(key));
  }
}

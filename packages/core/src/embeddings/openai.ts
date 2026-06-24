import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider.js';

export interface OpenAIOptions {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  dimensions?: number | undefined;
}

interface OpenAIEmbedResponse {
  data?: { embedding: number[] }[];
}

/**
 * Hosted embeddings via the OpenAI embeddings API (or any OpenAI-compatible endpoint via
 * `baseUrl`). Opt-in: observation text is sent to the provider. `text-embedding-3-*`
 * support the `dimensions` parameter, so output is requested at {@link EMBEDDING_DIMENSIONS}.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OpenAIOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'text-embedding-3-small';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.id = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as OpenAIEmbedResponse;
    const rows = data.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      throw new Error(`OpenAI returned ${rows?.length ?? 0} embeddings for ${texts.length} inputs`);
    }
    return rows.map((r) => r.embedding);
  }
}

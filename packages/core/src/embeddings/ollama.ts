import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider.js';

export interface OllamaOptions {
  baseUrl?: string | undefined;
  model?: string | undefined;
  dimensions?: number | undefined;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

/**
 * Local embeddings via Ollama's `/api/embed` (batch) endpoint. The default and most
 * private provider: vectors are computed on the Mac GPU, nothing leaves the machine.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model ?? 'nomic-embed-text';
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.id = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama embeddings failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const data = (await response.json()) as OllamaEmbedResponse;
    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(
        `Ollama returned ${embeddings?.length ?? 0} embeddings for ${texts.length} inputs ` +
          `(is the model "${this.model}" pulled? \`ollama pull ${this.model}\`)`,
      );
    }
    return embeddings;
  }
}

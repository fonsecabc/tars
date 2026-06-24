import { OllamaExtractionLlm, type ExtractionLlm } from './extractor.js';

/**
 * Build the local-LLM extractor from the environment, or `null` when extraction is
 * disabled (the default). Gated behind `EXTRACTION_ENABLED` because it requires a pulled
 * Ollama chat model and is an opt-in, confirm-before-write feature.
 */
export function extractionLlmFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractionLlm | null {
  const flag = (env.EXTRACTION_ENABLED ?? '').trim().toLowerCase();
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') {
    return null;
  }
  return new OllamaExtractionLlm({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_EXTRACTION_MODEL,
  });
}

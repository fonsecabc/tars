import { extractionProposalSchema, type ExtractionProposal } from './types.js';

/** A text-completion backend (the local LLM). Returns the model's raw completion. */
export interface ExtractionLlm {
  complete(prompt: string): Promise<string>;
}

const GUIDE = `You extract structured memory facts from text for a personal knowledge graph.
Return ONLY a JSON object of this shape (no prose, no code fences):
{
  "entities":     [{ "ref": "e1", "type": "person", "name": "...", "aliases": ["..."] }],
  "observations": [{ "entityRef": "e1", "text": "an atomic dated fact" }],
  "relations":    [{ "fromRef": "e1", "toRef": "e2", "predicate": "works_with" }]
}
Rules: types and predicates are snake_case; predicates are active-voice; "ref" is a stable
local handle linking observations/relations to entities; NEVER invent facts not present in
the text; omit anything you are unsure about.`;

/** Pull the first JSON object out of an LLM completion (tolerates code fences / prose). */
function parseJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('extractor: no JSON object found in the completion');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Use a local LLM to PROPOSE entities/observations/relations from free text. Returns a
 * validated proposal and writes nothing (confirm-before-write); persist with `applyProposal`.
 */
export async function extractFacts(text: string, llm: ExtractionLlm): Promise<ExtractionProposal> {
  const raw = await llm.complete(`${GUIDE}\n\nTEXT:\n${text}\n\nJSON:`);
  return extractionProposalSchema.parse(parseJsonObject(raw));
}

export interface OllamaExtractionOptions {
  baseUrl?: string | undefined;
  model?: string | undefined;
}

/** ExtractionLlm backed by Ollama's `/api/generate` (JSON mode), running on the Mac GPU. */
export class OllamaExtractionLlm implements ExtractionLlm {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: OllamaExtractionOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model ?? 'llama3.2';
  }

  async complete(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false, format: 'json' }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Ollama generate failed (${response.status}): ${body.slice(0, 200)} ` +
          `(is the model "${this.model}" pulled? \`ollama pull ${this.model}\`)`,
      );
    }
    const data = (await response.json()) as { response?: string };
    return data.response ?? '';
  }
}

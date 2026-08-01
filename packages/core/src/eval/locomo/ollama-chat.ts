/**
 * Minimal Ollama chat client + the answerer/judge prompts for the LOCOMO harness. Talks to
 * `${OLLAMA_BASE_URL || http://localhost:11434}/api/chat` with stream:false. Kept dependency-free
 * (same posture as the embedding/rerank providers) so `core` stays transport-agnostic.
 */

export const NO_ANSWER = 'NO_ANSWER';

export interface OllamaChatOptions {
  baseUrl?: string | undefined;
  model: string;
  /** Sampling temperature (default 0 for determinism). */
  temperature?: number | undefined;
  timeoutMs?: number | undefined;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const DEFAULT_TIMEOUT_MS = 120000;

/** One-shot chat completion. Throws on non-2xx or timeout. */
export async function ollamaChat(
  messages: ChatMessage[],
  options: OllamaChatOptions,
): Promise<string> {
  const baseUrl = (
    options.baseUrl ??
    process.env.OLLAMA_BASE_URL ??
    'http://localhost:11434'
  ).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
        stream: false,
        options: { temperature: options.temperature ?? 0 },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Ollama chat failed (${response.status}): ${body.slice(0, 200)} ` +
        `(is the model "${options.model}" pulled? \`ollama pull ${options.model}\`)`,
    );
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return (data.message?.content ?? '').trim();
}

const ANSWER_SYSTEM = `You answer questions about a conversation using ONLY the CONTEXT provided.
The CONTEXT is a list of statements, each prefixed with the date it was said, like "[2023-05-07] Alice: ...".
Rules:
- Answer as concisely as possible — a name, date, place, or short phrase; no explanation.
- Use ONLY facts present in the CONTEXT. Do not guess or use outside knowledge.
- For "when" questions, answer with the ABSOLUTE date from the CONTEXT (e.g. "May 2023" or "7 May 2023"), never relative terms like "yesterday", "last week", or "recently". Use the bracketed dates to resolve relative references ("last Sunday" → the actual date).
- If the specific fact the question asks for is not present in the CONTEXT, reply with exactly ${NO_ANSWER} and nothing else. Do not answer a question about one person using facts stated about a different person.`;

/** Ask the answerer model to answer `question` strictly from `context`. */
export async function answerFromContext(
  question: string,
  context: string,
  options: OllamaChatOptions,
): Promise<string> {
  return ollamaChat(
    [
      { role: 'system', content: ANSWER_SYSTEM },
      { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${question}\n\nANSWER:` },
    ],
    options,
  );
}

const JUDGE_SYSTEM = `You are a strict grader for a question-answering benchmark. You are given a
QUESTION, the GOLD answer, and a PREDICTED answer. Decide whether the PREDICTED answer is
semantically correct — it conveys the same key fact as the GOLD answer, even if worded
differently or with extra detail. Ignore phrasing, formatting, and verbosity; judge only the
factual content. Reply with exactly one word: YES if correct, NO otherwise.`;

/** LLM-as-judge: is `predicted` semantically equivalent to `gold` for `question`? */
export async function judgeAnswer(
  question: string,
  gold: string,
  predicted: string,
  options: OllamaChatOptions,
): Promise<boolean> {
  const raw = await ollamaChat(
    [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content: `QUESTION: ${question}\nGOLD: ${gold}\nPREDICTED: ${predicted}\n\nCORRECT (YES/NO):`,
      },
    ],
    options,
  );
  return /\byes\b/i.test(raw);
}

/**
 * Whether a prediction counts as an abstention. Primary signal is the exact NO_ANSWER token the
 * answerer is instructed to emit; a few natural-language equivalents are accepted defensively.
 */
export function isAbstention(prediction: string): boolean {
  const p = prediction.trim().toLowerCase();
  if (p.length === 0) {
    return true;
  }
  if (p.includes('no_answer')) {
    return true;
  }
  return (
    /\b(not (mentioned|stated|specified|provided|available|in the context)|no (information|answer|mention)|cannot (be )?(answer|determin|found)|don'?t know|unable to (answer|determine)|insufficient (information|context))\b/.test(
      p,
    ) && p.length < 80
  );
}

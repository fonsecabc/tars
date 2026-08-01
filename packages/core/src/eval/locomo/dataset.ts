/**
 * LOCOMO dataset types + loader. LOCOMO (Maharana et al., 2024 — snap-research/locomo) is a
 * long-conversation memory benchmark: each sample is a multi-session dialogue between two
 * speakers plus a QA set probing recall across the whole conversation.
 *
 * We read only the fields the harness needs and ignore image turns (blip_caption / img_url).
 * See ./README.md for provenance and how to fetch the data.
 */
import { readFileSync } from 'node:fs';

/** One dialogue turn. Image turns carry blip_caption / img_url, which we deliberately ignore. */
export interface LocomoTurn {
  speaker: string;
  /** e.g. "D1:3" — session/turn locator, referenced by QA `evidence`. */
  dia_id: string;
  text: string;
}

/** LOCOMO QA categories. 5 is adversarial (unanswerable) — the correct behaviour is to abstain. */
export type LocomoCategory = 1 | 2 | 3 | 4 | 5;

export const CATEGORY_LABELS: Record<LocomoCategory, string> = {
  1: 'multi-hop',
  2: 'temporal',
  3: 'open-domain',
  4: 'single-hop',
  5: 'adversarial',
};

export interface LocomoQa {
  question: string;
  /** Gold answer for categories 1–4. Absent for adversarial (category 5). */
  answer?: string | number | boolean;
  /** Gold-evidence dia_ids supporting the answer. */
  evidence?: string[];
  category: LocomoCategory;
  /** Present only on adversarial (category 5) items. */
  adversarial_answer?: string;
}

/** The conversation carries `speaker_a`/`speaker_b` plus dynamic `session_N` / `session_N_date_time`. */
export interface LocomoConversation {
  speaker_a: string;
  speaker_b: string;
  [key: string]: unknown;
}

export interface LocomoSample {
  sample_id: string;
  conversation: LocomoConversation;
  qa: LocomoQa[];
}

/** A single session in chronological order, with its parsed timestamp (if the date parsed). */
export interface LocomoSession {
  index: number;
  /** Raw date string from the dataset, e.g. "1:56 pm on 8 May, 2023". */
  rawDate: string | undefined;
  /** Parsed timestamp, or undefined when the date string was absent/unparseable. */
  date: Date | undefined;
  turns: LocomoTurn[];
}

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/**
 * Parse LOCOMO's date strings, e.g. "1:56 pm on 8 May, 2023" → a UTC Date. Returns undefined
 * for missing/unparseable input (verified to parse all 287 distinct strings in locomo10.json).
 */
export function parseLocomoDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i);
  if (!m || m[1] === undefined) {
    return undefined;
  }
  let hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2] ?? '0', 10);
  const ap = (m[3] ?? '').toLowerCase();
  if (ap === 'pm' && hh !== 12) {
    hh += 12;
  }
  if (ap === 'am' && hh === 12) {
    hh = 0;
  }
  const day = Number.parseInt(m[4] ?? '1', 10);
  const month = MONTHS[(m[5] ?? '').toLowerCase()];
  const year = Number.parseInt(m[6] ?? '0', 10);
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) {
    return undefined;
  }
  return new Date(Date.UTC(year, month, day, hh, mm));
}

/** Load and parse the LOCOMO JSON array at `path`. */
export function loadLocomo(path: string): LocomoSample[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`LOCOMO file at ${path} is not a JSON array`);
  }
  return parsed as LocomoSample[];
}

/** Extract a sample's sessions in chronological (session_1 … session_N) order. */
export function sessionsOf(sample: LocomoSample): LocomoSession[] {
  const conv = sample.conversation;
  const indices: number[] = [];
  for (const key of Object.keys(conv)) {
    const m = key.match(/^session_(\d+)$/);
    if (m && m[1] !== undefined) {
      indices.push(Number.parseInt(m[1], 10));
    }
  }
  indices.sort((a, b) => a - b);

  const sessions: LocomoSession[] = [];
  for (const index of indices) {
    const value = conv[`session_${index}`];
    if (!Array.isArray(value)) {
      continue;
    }
    const turns: LocomoTurn[] = [];
    for (const turn of value) {
      const t = turn as Partial<LocomoTurn>;
      if (
        typeof t.speaker === 'string' &&
        typeof t.text === 'string' &&
        typeof t.dia_id === 'string'
      ) {
        turns.push({ speaker: t.speaker, text: t.text, dia_id: t.dia_id });
      }
    }
    const rawDate = conv[`session_${index}_date_time`];
    const rawDateStr = typeof rawDate === 'string' ? rawDate : undefined;
    sessions.push({
      index,
      rawDate: rawDateStr,
      date: parseLocomoDate(rawDateStr),
      turns,
    });
  }
  return sessions;
}

/** Map every turn's dia_id → its text, across all sessions (used for retrieval hit-rate). */
export function diaTextMap(sessions: LocomoSession[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const session of sessions) {
    for (const turn of session.turns) {
      map.set(turn.dia_id, turn.text);
    }
  }
  return map;
}

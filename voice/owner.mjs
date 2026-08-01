// Shared owner config for the voice stack — the one place a name is personalized.
// Set TARS_OWNER_NAME (and optionally TARS_OWNER_PHONETIC, a phonetic respelling so the
// TTS says it right, e.g. "KYE-oh") in the repo-root .env or in the launchd plist's
// EnvironmentVariables. Absent a name, the assistant just says "the user".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function fromEnvFile(key) {
  try {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
    const hit = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return hit ? hit.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
}

export const OWNER_NAME =
  process.env.TARS_OWNER_NAME || fromEnvFile('TARS_OWNER_NAME') || 'the user';
export const OWNER_PHONETIC =
  process.env.TARS_OWNER_PHONETIC || fromEnvFile('TARS_OWNER_PHONETIC') || '';

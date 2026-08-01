#!/usr/bin/env node
// tars-ears — always-on mic. Runs whisper-stream in VAD mode (waits for a pause,
// then transcribes the whole utterance), gates each utterance, and forwards what's
// meant for TARS into the live Claude Desktop session via tars-inject.
//
// The loop that closes the hands-free cockpit:
//   you speak -> whisper-stream transcribes -> [gate] -> POST /inject -> Claude works
//   -> Stop hook -> tars-speak -> Kokoro says the reply.
//
// Gates, in order:
//   1. ears off        — no `~/.tars/ears.on` flag -> do nothing (master switch).
//   2. TARS is talking — `~/.tars/speaking` present -> drop (never hear ourselves).
//   3. wake word       — must start with "tars"/"hey tars" (unless open-mic mode).
//   4. junk            — empty, too short, or whisper's non-speech markers -> drop.
//
// Open-mic mode: if `~/.tars/ears.open` exists, the wake word is not required and
// every utterance is forwarded — for focused dictation. Default is wake-word-gated.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TARS_DIR = join(homedir(), '.tars');
const EARS_ON = join(TARS_DIR, 'ears.on'); // master switch
const EARS_OPEN = join(TARS_DIR, 'ears.open'); // open-mic (no wake word)
const SPEAKING = join(TARS_DIR, 'speaking'); // set by tars-speak while talking
const AWAITING_CONFIRM = join(TARS_DIR, 'awaiting-confirm'); // router awaiting a spoken yes/no

const MODEL = process.env.TARS_WHISPER_MODEL || join(TARS_DIR, 'models', 'ggml-small.en.bin');
const WHISPER = process.env.TARS_WHISPER_BIN || '/opt/homebrew/bin/whisper-stream';
const CAPTURE = process.env.TARS_CAPTURE_ID || '-1'; // -1 = default input device
const THREADS = process.env.TARS_WHISPER_THREADS || '6';
const VAD_THOLD = process.env.TARS_VAD_THOLD || '0.6';
const LENGTH = process.env.TARS_WHISPER_LENGTH || '10000';
const LANG = process.env.TARS_WHISPER_LANG || 'en';
// Ears feed the ROUTER (the gem), not the injector directly — the gem decides whether
// to answer you itself or hand work to Claude. (Set TARS_EARS_TARGET=inject to bypass
// the gem and paste straight into Claude, the old dumb-pipe behaviour.)
const ROUTER_URL = process.env.ROUTER_URL || 'http://127.0.0.1:8793/hear';
const INJECT_URL = process.env.INJECT_URL || 'http://127.0.0.1:8792/inject';
const TARGET =
  process.env.TARS_EARS_TARGET === 'inject'
    ? { url: INJECT_URL, body: (t) => ({ text: t, submit: true }) }
    : { url: ROUTER_URL, body: (t, addressed) => ({ text: t, addressed }) };
const MIN_CHARS = Number(process.env.TARS_MIN_CHARS || 2);
const SPEAK_URL = process.env.SPEAK_URL || 'http://127.0.0.1:8790/speak';
const SPEAK_STOP_URL = SPEAK_URL.replace('/speak', '/stop');

// Barge-in: "stop"/"shut up" must cut TARS off INSTANTLY — no wake word, no gem, not even
// gated by the SPEAKING flag (that flag exists to stop TARS hearing HIMSELF, not to stop
// the user interrupting him). Checked first, before every other gate. Zero-latency: hits
// tars-speak's /stop directly, clears any pending turn, nothing touches the model.
const STOP_RE = /\b(stop|shut up|shush|quiet|be quiet|that's enough|zip it|silence)\b/i;
function stopSpeaking(said) {
  log(`BARGE-IN: ${JSON.stringify(said)} -> stop`);
  fetch(SPEAK_STOP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'all' }),
    signal: AbortSignal.timeout(2000),
  }).catch((e) => log('stop failed:', e.message));
}

// Wake detection. whisper mangles "TARS" a dozen ways ("Taurus", "Tarus", "Torres",
// "Tara", "thars", "tears"…) and the user has a pt-BR accent, so a fixed regex misses too
// much — and MISSING the wake word is why he felt ignored. So: a curated set of known
// manglings + a Levenshtein fuzz on the first token. Returns the command with the wake
// word stripped, or null. Deliberately generous: in wake-gated mode a rare false wake
// just sends a stray phrase to the gem, which answers "" — cheap. A MISS is the costly one.
function lev(a, b) {
  const m = a.length,
    n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
const WAKE_WORDS = new Set([
  'tars',
  'tar',
  'tarz',
  'tarss',
  'taurus',
  'tauris',
  'torres',
  'tarus',
  'taras',
  'tara',
  'taris',
  'terrace',
  'tears',
  'thars',
  'tarsh',
  'tarr',
  'dars',
  'taars',
  'doris',
  'doras',
  'toris',
  'dora',
  'tarris',
  'boris',
  'tauris',
  'thors',
  'tors',
]);
// Anchors we fuzz against — "doris" made the list because whisper reliably hears "TARS" as it.
const WAKE_ANCHORS = ['tars', 'taurus', 'doris'];
function wakeMatch(raw) {
  const s = String(raw).replace(/^[^a-z0-9]+/i, '');
  const m = s.match(/^(?:hey|ok|okay|hi|yo|oi|ei|e|and)?[\s,]*([a-z'’]+)[\s,.:!?-]*(.*)$/i);
  if (!m) return null;
  const first = m[1].toLowerCase().replace(/[^a-z]/g, '');
  const rest = (m[2] || '').trim();
  if (WAKE_WORDS.has(first)) return { rest };
  if (WAKE_ANCHORS.some((a) => lev(first, a) <= (a.length >= 5 ? 2 : 1))) return { rest };
  return null;
}

const log = (...a) => console.log(new Date().toISOString(), '[ears]', ...a);
const flag = (p) => existsSync(p);

// whisper-stream prints startup noise, a "[Start speaking]" banner, and bracketed
// non-speech markers like "[BLANK_AUDIO]" / "(clears throat)". Strip ANSI, drop those.
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
function cleanLine(raw) {
  let s = raw.replace(ANSI, '').trim();
  if (!s) return '';
  if (/^\[.*\]$/.test(s)) return ''; // [Start speaking], [BLANK_AUDIO]
  if (/^\(.*\)$/.test(s)) return ''; // (wind blowing), (silence)
  if (/^#{2,}/.test(s)) return ''; // ### Transcription N START/END
  if (/^(ggml_|load_|whisper_|main:|init:|system_info)/i.test(s)) return '';
  s = s
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim(); // inline markers
  return s;
}

async function forward(text, addressed) {
  try {
    const res = await fetch(TARGET.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(TARGET.body(text, addressed)),
      signal: AbortSignal.timeout(35000),
    });
    log(
      res.ok
        ? `-> sent (addressed=${addressed}): ${JSON.stringify(text)}`
        : `target http ${res.status}`,
    );
  } catch (e) {
    log('send failed:', e.message);
  }
}

// --- turn accumulation ---
// A long instruction gets chopped by whisper into several segments, and only the FIRST
// carries the wake word, so continuations were dropped as "no wake" and TARS seemed to
// stop listening mid-sentence. Fix: the wake word opens a TURN; every following segment
// (no wake needed) is stitched on; when the user pauses (adaptive window) or the turn hits
// TURN_MAX_MS, the whole thing is forwarded ONCE as one addressed command. Also subsumes
// whisper's 2-3x re-emissions — stitch skips anything already in the buffer.
const TURN_FAST_MS = Number(process.env.TARS_TURN_FAST_MS || 1100); // 1st segment: flush soon (short command)
const TURN_SLOW_MS = Number(process.env.TARS_TURN_SLOW_MS || 3200); // after a continuation: wait longer for more
const TURN_MAX_MS = Number(process.env.TARS_TURN_MAX_MS || 30000);
const wnorm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Stitch a segment onto the running turn: skip exact re-emissions / already-contained text,
// else drop the prefix that overlaps the buffer's tail and append the genuinely new words.
function stitch(buf, seg) {
  const s = seg.trim();
  if (!buf) return s;
  if (!s) return buf;
  if (wnorm(buf).includes(wnorm(s))) return buf; // exact re-emission / contained
  const bl = wnorm(buf).split(' '),
    sl = wnorm(s).split(' '),
    sw = s.split(/\s+/);
  const maxK = Math.min(bl.length, sl.length, 15);
  let best = 0;
  for (let k = maxK; k >= 1; k--) {
    let ok = true;
    for (let i = 0; i < k; i++)
      if (bl[bl.length - k + i] !== sl[i]) {
        ok = false;
        break;
      }
    if (ok) {
      best = k;
      break;
    }
  }
  const tail = sw.slice(best).join(' ').trim();
  return tail ? `${buf} ${tail}` : buf;
}

let turn = null; // { text, startAt, segs, timer }
function flushTurn() {
  if (!turn) return;
  const text = turn.text.trim();
  if (turn.timer) clearTimeout(turn.timer);
  turn = null;
  if (text.length < MIN_CHARS) {
    log('turn empty, nothing sent');
    return;
  }
  log(`heard (addressed=true): ${JSON.stringify(text)}`);
  forward(text, true);
}
function scheduleFlush() {
  if (turn.timer) clearTimeout(turn.timer);
  if (Date.now() - turn.startAt >= TURN_MAX_MS) return flushTurn();
  // Short window while it might be a one-shot command; widen once a continuation arrives so
  // a rambling multi-segment instruction stays in one turn across whisper's gaps.
  turn.timer = setTimeout(flushTurn, turn.segs > 1 ? TURN_SLOW_MS : TURN_FAST_MS);
}

// The wake word "TARS" opens a listening turn; whatever follows (across several whisper
// segments, no wake word needed) is stitched into one command and sent when the user pauses.
// Overheard chatter and mis-hears outside a turn are ignored, so they can't inject anything.
function handleUtterance(text) {
  if (!flag(EARS_ON)) return; // master switch off

  // Barge-in: while TARS is actually talking, "stop"/"shut up" cuts him off instantly —
  // no wake word, no gem, checked before the self-hearing gate (which would otherwise drop
  // this exact phrase as "TARS speaking"). Gated on speaking=true so an ordinary command
  // that happens to contain "stop" ("stop the daytrade bot") isn't swallowed while he's quiet.
  const speaking = flag(SPEAKING);
  if (speaking && STOP_RE.test(text)) {
    stopSpeaking(text);
    turn = null;
    return;
  }
  if (speaking) {
    log('drop (TARS speaking)');
    return;
  }
  const open = flag(EARS_OPEN);

  // A risky op is awaiting a spoken yes/no — forward this straight through as the answer,
  // no wake word and no turn accumulation. The router decides yes/no.
  if (flag(AWAITING_CONFIRM)) {
    log(`confirm answer: ${JSON.stringify(text)}`);
    forward(text, true);
    return;
  }

  // Mid-turn: every segment is a continuation of the addressed command — no wake needed.
  if (turn) {
    turn.text = stitch(turn.text, text);
    turn.segs++;
    scheduleFlush();
    return;
  }

  const w = wakeMatch(text);
  if (w) {
    turn = { text: w.rest || '', startAt: Date.now(), segs: 1, timer: null };
    log(`turn open: ${JSON.stringify(w.rest || '(awaiting speech)')}`);
    scheduleFlush();
    return;
  }
  if (open) {
    forward(text, false);
    return;
  } // open-mic ambient (opt-in), answer-only
  log(`drop (no wake): ${JSON.stringify(text)}`); // wake-gated default: ignore ambient
}

function start() {
  if (!existsSync(MODEL)) {
    log('FATAL: model not found at', MODEL);
    process.exit(1);
  }
  // --length 30000 made whisper buffer ~30s and emit in laggy 6-8s bursts, which outran the
  // turn window and split long commands. A shorter window emits segments promptly so the
  // turn accumulator can stitch continuations together. Tunable via TARS_WHISPER_LENGTH.
  const args = [
    '-m',
    MODEL,
    '-t',
    THREADS,
    '--step',
    '0',
    '--length',
    LENGTH,
    '-vth',
    VAD_THOLD,
    '-c',
    CAPTURE,
    '-l',
    LANG,
    '-nf',
  ];
  log(`starting whisper-stream: ${WHISPER} ${args.join(' ')}`);
  const w = spawn(WHISPER, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  w.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const raw of lines) {
      const s = cleanLine(raw);
      if (s) handleUtterance(s);
    }
  });
  w.on('exit', (code) => {
    log(`whisper-stream exited (${code}); restarting in 2s`);
    setTimeout(start, 2000);
  });
  w.on('error', (e) => {
    log('whisper-stream error:', e.message);
  });
}

log(
  `ears up · model=${MODEL} · wake-gated (open-mic: ${flag(EARS_OPEN)}) · enabled: ${flag(EARS_ON)}`,
);
start();

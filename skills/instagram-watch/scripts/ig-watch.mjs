#!/usr/bin/env node
// ig-watch.mjs: turn an Instagram post URL into a structured report an agent can reason over.
//
// Every stage runs on your own machine and costs nothing: yt-dlp fetches the media, ffmpeg splits
// the audio and samples frames, whisper.cpp transcribes the speech, and a local vision model reads
// the picture and the on-screen text. No frame, transcript, or caption is sent anywhere.
//
//   node ig-watch.mjs <url> [--summary] [--lang <code>] [--no-vision]
//                          [--refresh] [--quiet] [--cookies <browser>]
//
// Default output is the full JSON report; --summary prints a readable digest instead.
//
// Requires: node 18+, ffmpeg (with ffprobe), whisper-cli + a ggml model, ollama running a
// vision model, and yt-dlp (or uvx, which fetches it on demand). Missing pieces degrade the
// report rather than failing it: no whisper means no transcript, no ollama means no visuals.
//
// A note on what "watching" means here. The audio is read in full, so the transcript is complete.
// The picture is not: the script samples frames, so it sees stills rather than motion. Pacing,
// camera moves, and anything that happens between two samples are invisible to it. Sampling is
// cut-aware with a floor rate (see FLOOR_INTERVAL_SEC) to keep that gap small, but it is a gap.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_ROOT = process.env.IG_WATCH_CACHE || join(homedir(), '.cache', 'ig-watch');
const VISION_MODEL = process.env.IG_WATCH_VISION_MODEL || 'qwen2.5vl:7b';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Frame budget. A floor rate is what actually catches on-screen text, since captions and overlays
// appear mid-shot and a purely cut-driven sampler misses them (and collapses to a single frame on
// a video shot in one continuous take). Cuts are then added on top so every distinct shot is seen.
const FLOOR_INTERVAL_SEC = Number(process.env.IG_WATCH_FRAME_INTERVAL || 2);
const MAX_FRAMES = Number(process.env.IG_WATCH_MAX_FRAMES || 30);
const SCENE_THRESHOLD = 0.3;
const TILE_WIDTH = 320;

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('-'));
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const summaryMode = args.includes('--summary');
const noVision = args.includes('--no-vision');
const refresh = args.includes('--refresh');
const quiet = args.includes('--quiet');
const cookieBrowser = flag('--cookies') || process.env.IG_WATCH_COOKIES || null;
// whisper-cli defaults to English and does NOT auto-detect, which silently turns any other
// language into wrong English text. Always ask for detection unless told a specific language.
const lang = flag('--lang') || process.env.IG_WATCH_LANG || 'auto';

if (!url) {
  console.error(
    'usage: ig-watch.mjs <instagram-url> [--summary] [--lang <code>] [--no-vision]' +
      ' [--refresh] [--quiet] [--cookies <browser>]',
  );
  process.exit(2);
}

const log = (...m) => {
  if (!quiet) console.error('[ig-watch]', ...m);
};

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// yt-dlp may not be installed; uvx fetches and caches it on first use.
const YTDLP = process.env.IG_WATCH_YTDLP;
function ytdlp(a, opts) {
  const flags = cookieBrowser ? ['--cookies-from-browser', cookieBrowser, ...a] : a;
  return YTDLP ? run(YTDLP, flags, opts) : run('uvx', ['yt-dlp', ...flags], opts);
}

// Whisper models are not installed to one standard place, so look where they usually land.
function findWhisperModel() {
  if (process.env.IG_WATCH_WHISPER_MODEL) return process.env.IG_WATCH_WHISPER_MODEL;
  const candidates = [
    'ggml-large-v3-turbo-q5_0.bin',
    'ggml-large-v3-turbo.bin',
    'ggml-medium.bin',
    'ggml-small.bin',
    'ggml-base.en.bin',
    'ggml-small.en.bin',
  ];
  const dirs = [
    join(homedir(), '.tars', 'models'),
    join(homedir(), '.cache', 'whisper'),
    join(homedir(), 'models'),
    '/opt/homebrew/share/whisper.cpp/models',
    '/usr/local/share/whisper.cpp/models',
    '/usr/share/whisper.cpp/models',
  ];
  for (const d of dirs) {
    for (const c of candidates) {
      const p = join(d, c);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function shortcodeOf(u) {
  const m = String(u).match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// yt-dlp's Instagram extractor leaves `description` unset on some posts, so try the other fields
// that can carry a caption. "Video by <handle>" is a placeholder title, not a caption.
function captionOf(info) {
  for (const k of ['description', 'caption', 'fulltitle', 'title']) {
    const v = info[k];
    if (typeof v === 'string' && v.trim() && !/^Video by /i.test(v)) return v.trim();
  }
  return null;
}

function hashtagsOf(text) {
  if (!text) return [];
  return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase()))];
}

async function fetchMetadata(dir) {
  const infoPath = join(dir, 'info.json');
  if (!refresh && existsSync(infoPath)) return JSON.parse(await readFile(infoPath, 'utf8'));
  log('fetching metadata');
  const { stdout } = await ytdlp(['--no-warnings', '--no-progress', '-j', url]);
  const info = JSON.parse(stdout.trim().split('\n').pop());
  await writeFile(infoPath, JSON.stringify(info));
  return info;
}

const MEDIA_RE = /^media\.(mp4|webm|mkv|jpg|jpeg|png|webp)$/;

async function downloadMedia(dir) {
  const existing = (await readdir(dir)).find((f) => MEDIA_RE.test(f));
  if (!refresh && existing) return join(dir, existing);
  log('downloading media');
  await ytdlp(['--no-warnings', '--no-progress', '-o', 'media.%(ext)s', url], { cwd: dir });
  const found = (await readdir(dir)).find((f) => MEDIA_RE.test(f));
  if (!found) throw new Error('yt-dlp produced no media file');
  return join(dir, found);
}

const isVideo = (p) => /\.(mp4|webm|mkv)$/i.test(p);

// yt-dlp leaves `duration` unset on many Instagram posts, so measure the file itself.
async function probeDuration(mediaPath) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      mediaPath,
    ]);
    const d = Number.parseFloat(stdout.trim());
    return Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function transcribe(dir, mediaPath) {
  const outPath = join(dir, 'transcript.json');
  if (!refresh && existsSync(outPath)) return JSON.parse(await readFile(outPath, 'utf8'));

  const model = findWhisperModel();
  if (!model) {
    log('no whisper model found, skipping transcript (set IG_WATCH_WHISPER_MODEL)');
    return { text: null, language: null, languageConfidence: null };
  }
  const wav = join(dir, 'audio.wav');
  try {
    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      mediaPath,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      wav,
    ]);
  } catch {
    log('no audio track');
    return { text: null, language: null, languageConfidence: null };
  }
  log(`transcribing (lang=${lang})`);
  const { stdout, stderr } = await run('whisper-cli', ['-m', model, '-f', wav, '-nt', '-l', lang]);
  const detected = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/i.exec(stderr);
  const result = {
    text: stdout.replace(/\s+/g, ' ').trim() || null,
    language: detected ? detected[1] : lang === 'auto' ? null : lang,
    languageConfidence: detected ? Number(detected[2]) : null,
  };
  await writeFile(outPath, JSON.stringify(result));
  return result;
}

// Scene-change timestamps, used to guarantee every distinct shot gets a frame.
async function detectCuts(mediaPath) {
  try {
    const { stderr } = await run('ffmpeg', [
      '-i',
      mediaPath,
      '-filter:v',
      `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f',
      'null',
      '-',
    ]);
    const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
    return [...new Set(times)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// Floor grid plus cut points, deduped and capped. Returns timestamps in seconds.
function sampleTimes(durationSec, cuts) {
  const dur = durationSec || 0;
  const times = [];
  for (let t = 0; t < dur; t += FLOOR_INTERVAL_SEC) times.push(Math.round(t * 100) / 100);
  // Land just after a cut so the frame shows the new shot, not the last frame of the old one.
  for (const c of cuts) if (c < dur) times.push(Math.round((c + 0.15) * 100) / 100);

  const sorted = [...new Set(times)].sort((a, b) => a - b);
  const deduped = sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > 0.4);
  if (deduped.length <= MAX_FRAMES) return deduped;
  const step = deduped.length / MAX_FRAMES;
  return Array.from({ length: MAX_FRAMES }, (_, i) => deduped[Math.floor(i * step)]);
}

// One contact sheet beats N separate images: the model sees the whole arc in a single pass and
// reads on-screen text off the same frames.
async function buildContactSheet(dir, mediaPath, durationSec, cuts) {
  const sheet = join(dir, 'grid.jpg');
  if (!refresh && existsSync(sheet)) return { sheet, frameCount: null };
  if (!isVideo(mediaPath)) return { sheet: mediaPath, frameCount: 1 };

  const times = sampleTimes(durationSec, cuts);
  if (!times.length) return { sheet: mediaPath, frameCount: 1 };

  const framesDir = join(dir, 'frames');
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  log(`sampling ${times.length} frames (${cuts.length} cuts detected)`);
  await Promise.all(
    times.map((t, i) =>
      run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(t),
        '-i',
        mediaPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${TILE_WIDTH}:-1`,
        join(framesDir, `f${String(i).padStart(3, '0')}.jpg`),
      ]).catch(() => null),
    ),
  );
  const got = (await readdir(framesDir)).filter((f) => f.endsWith('.jpg')).length;
  if (!got) return { sheet: mediaPath, frameCount: 1 };
  const cols = Math.min(6, Math.ceil(Math.sqrt(got)));
  const rows = Math.ceil(got / cols);
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '1',
    '-i',
    join(framesDir, 'f%03d.jpg'),
    '-vf',
    `tile=${cols}x${rows}`,
    '-frames:v',
    '1',
    sheet,
  ]);
  return { sheet, frameCount: got };
}

const VISION_PROMPT = [
  'These are frames sampled in order from a short vertical video, tiled left-to-right then',
  'top-to-bottom into one contact sheet. Report only what you can actually see; do not guess',
  'at things that are not in the frames. Answer in exactly these labelled sections:',
  'SETTING: where this takes place, indoors or outdoors, time of day.',
  'PEOPLE: how many people, what they are doing, their visible reactions.',
  'ON_SCREEN_TEXT: every caption, overlay, subtitle, UI label, or watermark you can read, verbatim.',
  'BRANDS: any product, app, or logo visible. Write "none" if there are none.',
  'FORMAT: the shot style (talking head, screen recording, b-roll, text-on-screen, etc).',
  'ARC: how the scene changes from the first frames to the last.',
].join(' ');

const SECTIONS = ['SETTING', 'PEOPLE', 'ON_SCREEN_TEXT', 'BRANDS', 'FORMAT', 'ARC'];

async function describeVisuals(sheetPath) {
  log('reading frames with', VISION_MODEL);
  const b64 = (await readFile(sheetPath)).toString('base64');
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt: VISION_PROMPT,
      images: [b64],
      stream: false,
      options: { temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { response } = await res.json();
  return (response || '').trim() || null;
}

// Split the model's answer into its labelled sections by locating every header first, then
// slicing between them. Small vision models decorate headers unpredictably ("**SETTING:**",
// "### SETTING:", "SETTING -"), and a per-label lookahead misses the variants it did not
// anticipate, which silently bleeds one section's text into the next.
function parseSections(text) {
  if (!text) return {};
  const header = new RegExp(`(?:^|\\n)[\\s#>*_-]*(${SECTIONS.join('|')})\\s*[:\\-]?[\\s*_]*`, 'gi');
  const hits = [...text.matchAll(header)];
  const out = {};
  hits.forEach((h, i) => {
    const label = h[1].toUpperCase();
    const start = h.index + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    // First header wins; a later restatement is the model repeating itself.
    if (out[label]) return;
    const body = text
      .slice(start, end)
      .replace(/\*\*|__/g, '') // inline bold the model adds around its own sub-labels
      .replace(/\s+/g, ' ')
      .replace(/^[\s*_#:-]+|[\s*_#]+$/g, '')
      .trim();
    // "none", "None visible", "None visible in the frames" all mean the model found nothing.
    if (body && !/^none\b/i.test(body)) out[label] = body;
  });
  return out;
}

// Sections with nothing in them are dropped rather than printed empty, so a silent post or a
// failed vision stage produces a shorter report instead of a misleading one.
function renderSummary(r) {
  const out = [];
  const head = [
    r.author?.handle ? `@${r.author.handle}` : null,
    r.durationSec ? `${r.durationSec}s` : null,
    r.shotCount ? `${r.shotCount} shots` : null,
    r.postedAt ? `posted ${r.postedAt.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  out.push(head, r.url, '');

  const { likes, comments } = r.engagement || {};
  if (likes != null || comments != null) {
    out.push(`ENGAGEMENT  ${likes ?? '?'} likes, ${comments ?? '?'} comments`, '');
  }
  const add = (label, value) => {
    if (value) out.push(`${label}\n${value}`, '');
  };
  add('CAPTION', r.caption);
  add('HASHTAGS', r.hashtags?.length ? r.hashtags.join(' ') : null);
  add(r.language ? `SAID (${r.language})` : 'SAID', r.transcript);
  add('ON SCREEN', r.onScreenText);
  add('SETTING', r.setting);
  add('PEOPLE', r.people);
  add('ARC', r.arc);
  add('BRANDS', r.brands);
  add('FORMAT', r.format);

  if (r.topComments?.length) {
    // Repeated comments are the tell for a comment-bait funnel, so show the counts.
    const counts = new Map();
    for (const c of r.topComments) {
      const k = c.text.trim().toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text, n]) => (n > 1 ? `"${text}" x${n}` : `"${text}"`));
    out.push(`COMMENTS (${r.topComments.length} sampled)\n${top.join(', ')}`, '');
  }

  const notes = [];
  if (!r.caption) notes.push('Instagram withheld the caption from this logged-out fetch.');
  if (r.framesSampled && r.totalFrames) {
    notes.push(
      `Visuals are ${r.framesSampled} sampled frames out of ${r.totalFrames}; ` +
        'motion and pacing were not seen.',
    );
  }
  if (r.languageConfidence != null && r.languageConfidence < 0.7) {
    notes.push(
      `Language detection was uncertain (${r.language} p=${r.languageConfidence}); ` +
        're-run with --lang if the transcript looks wrong.',
    );
  }
  for (const n of notes) out.push(`NOTE  ${n}`);
  return out.join('\n');
}

function emit(report) {
  process.stdout.write(
    summaryMode ? `${renderSummary(report)}\n` : `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function main() {
  const shortcode = shortcodeOf(url);
  if (!shortcode) throw new Error(`not an Instagram post URL: ${url}`);
  const dir = join(CACHE_ROOT, shortcode);
  await mkdir(dir, { recursive: true });

  const reportPath = join(dir, 'report.json');
  if (!refresh && existsSync(reportPath)) {
    log('cached report');
    emit(JSON.parse(await readFile(reportPath, 'utf8')));
    return;
  }

  const info = await fetchMetadata(dir);
  const mediaPath = await downloadMedia(dir);
  const caption = captionOf(info);
  const durationSec = info.duration ?? (await probeDuration(mediaPath));
  const { text: transcript, language, languageConfidence } = await transcribe(dir, mediaPath);

  const cuts = isVideo(mediaPath) ? await detectCuts(mediaPath) : [];
  let vision = null;
  let framesSampled = null;
  if (!noVision) {
    try {
      const { sheet, frameCount } = await buildContactSheet(dir, mediaPath, durationSec, cuts);
      framesSampled = frameCount;
      vision = await describeVisuals(sheet);
    } catch (e) {
      log('vision stage failed:', e.message);
    }
  }

  const sections = parseSections(vision);

  const report = {
    url: info.webpage_url || url,
    shortcode,
    author: { handle: info.channel || null, name: info.uploader || null },
    postedAt: info.timestamp ? new Date(info.timestamp * 1000).toISOString() : null,
    watchedAt: new Date().toISOString(),
    durationSec,
    resolution: info.resolution || null,
    engagement: { likes: info.like_count ?? null, comments: info.comment_count ?? null },
    caption,
    hashtags: hashtagsOf(caption),
    language,
    languageConfidence,
    transcript,
    setting: sections.SETTING || null,
    people: sections.PEOPLE || null,
    onScreenText: sections.ON_SCREEN_TEXT || null,
    brands: sections.BRANDS || null,
    format: sections.FORMAT || null,
    arc: sections.ARC || null,
    // A continuous take reports 0 cuts, which is 1 shot.
    shotCount: isVideo(mediaPath) ? cuts.length + 1 : null,
    cutsAtSec: cuts,
    framesSampled,
    totalFrames: null,
    localMedia: mediaPath,
    topComments: (info.comments || [])
      .slice(0, 15)
      .map((c) => ({ author: c.author || null, text: c.text || null }))
      .filter((c) => c.text),
  };

  if (isVideo(mediaPath)) {
    try {
      const { stdout } = await run('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_frames',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'default=nw=1:nk=1',
        mediaPath,
      ]);
      const n = Number.parseInt(stdout.trim(), 10);
      if (Number.isFinite(n)) report.totalFrames = n;
    } catch {
      /* frame count is a nicety, not worth failing the report over */
    }
  }

  await writeFile(reportPath, JSON.stringify(report, null, 2));
  emit(report);
}

main().catch((e) => {
  console.error('[ig-watch] failed:', e.message);
  if (e.stderr) console.error(String(e.stderr).slice(-600));
  process.exit(1);
});

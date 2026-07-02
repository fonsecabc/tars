#!/usr/bin/env python3
# tars-tts-kokoro — persistent, warm Kokoro TTS sidecar for tars-speak.
# Loads Kokoro-82M once (kept warm in RAM) and serves:
#   POST /say  {text, voice?, speed?}  -> audio/wav (24 kHz, PCM16 mono)
#   GET  /health                       -> {ok, model, voice}
# Local, free, on-device. No API, no billing. WAV is written with the stdlib
# `wave` module so the only heavy dep is mlx-audio itself.
import io
import os
import re
import wave
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from mlx_audio.tts.utils import load_model

MODEL_ID = os.environ.get("KOKORO_MODEL", "prince-canuma/Kokoro-82M")
VOICE = os.environ.get("KOKORO_VOICE", "am_michael")
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))
LANG_OVERRIDE = os.environ.get("KOKORO_LANG")  # unset by default -> derive from voice
PORT = int(os.environ.get("KOKORO_PORT", "8791"))

# Kokoro's pipeline is language-specific and must match the voice's own accent family,
# or synthesis intermittently throws a tensor shape mismatch (and the caller falls back
# to a different voice entirely). Map by the voice-name prefix instead of hardcoding one
# language, so this can't silently break again if the voice changes.
_LANG_BY_PREFIX = {"am_": "a", "af_": "a", "bm_": "b", "bf_": "b"}


def lang_for_voice(voice):
    if LANG_OVERRIDE:
        return LANG_OVERRIDE
    for prefix, lang in _LANG_BY_PREFIX.items():
        if voice.startswith(prefix):
            return lang
    return "a"  # unknown prefix: American is Kokoro's own default


def log(*a):
    print(time.strftime("%H:%M:%S"), "[kokoro]", *a, flush=True)


log(f"loading {MODEL_ID} ...")
_model = load_model(MODEL_ID)
_lock = threading.Lock()  # mlx generate is not reentrant; serialize


def _generate(text, voice, speed, lang):
    with _lock:
        return list(_model.generate(text=text, voice=voice, speed=speed, lang_code=lang, verbose=False))


def _perturb(text):
    # A trailing space/extra period is silently dropped by the tokenizer and
    # reproduces the identical failure; a comma actually shifts the phoneme/duration
    # sequence (confirmed empirically) at the cost of a barely-audible pause — a far
    # smaller side effect than falling back to a different voice.
    text = text.rstrip()
    if text and text[-1] in ".!?":
        return text[:-1] + ", " + text[-1]
    return text + ","


def _split_sentences(text):
    # Keep the terminal punctuation attached to each chunk; drop empty/whitespace pieces.
    # Returns None (not a 1-item list) when there's nothing to split, so callers can tell
    # "already atomic at this granularity" from "successfully split".
    parts = [p.strip() for p in re.findall(r"[^.!?]+[.!?]*", text) if p.strip()]
    return parts if len(parts) > 1 else None


def _split_clauses(text):
    # Finer than sentence-level: break on internal commas/semicolons.
    parts = [p.strip() for p in re.split(r"(?<=[;,])\s+", text.strip()) if p.strip()]
    return parts if len(parts) > 1 else None


def _split_in_half(text):
    # Last resort: no punctuation to split on, just halve by word count.
    words = text.split()
    if len(words) < 4:
        return None
    mid = len(words) // 2
    return [" ".join(words[:mid]), " ".join(words[mid:])]


_SPLIT_CHAIN = [_split_sentences, _split_clauses, _split_in_half]


def _audio_and_rate(segs):
    audio = np.concatenate([np.asarray(s.audio, dtype=np.float32).reshape(-1) for s in segs])
    sr = int(getattr(segs[0], "sample_rate", 24000) or 24000)
    return audio, sr


def _synth_one(text, voice, speed, lang):
    # Known upstream quirk in this mlx-audio Kokoro port: for certain (voice, exact-text,
    # speed) triples the duration predictor and the style-vector upsampler disagree by a
    # fixed frame count ("broadcast_shapes ... cannot be broadcast"). It turned out to be
    # far more common in real traffic than first measured (12 fallbacks and dozens of
    # dropped sentences across one day) — a single retry wasn't nearly enough. Nudging
    # speed by a couple percent shifts the predicted-duration frame count deterministically,
    # which reliably dodges a specific bad alignment even when text perturbation alone
    # doesn't, so the ladder tries both knobs before giving up on this unit of text.
    attempts = [(text, speed)]
    for delta in (0.03, -0.03, 0.06, -0.06):
        attempts.append((text, speed * (1 + delta)))
    perturbed = _perturb(text)
    attempts.append((perturbed, speed))
    for delta in (0.03, -0.03):
        attempts.append((perturbed, speed * (1 + delta)))

    last_err = None
    for i, (t, s) in enumerate(attempts):
        try:
            out = _audio_and_rate(_generate(t, voice, s, lang))
            if i:
                log(f"synth recovered on attempt {i + 1}/{len(attempts)} for {text!r} (speed={s:.3f})")
            return out
        except Exception as e:  # noqa: BLE001
            last_err = e
    log(f"synth hiccup on {text!r}: all {len(attempts)} attempts failed ({last_err})")
    raise last_err


def _stitch(chunks):
    # chunks: list of (audio, sr) tuples from this model, all sharing one sample rate.
    sr = chunks[0][1]
    gap = np.zeros(int(0.15 * sr), dtype=np.float32)  # ~150ms breath between fragments
    parts = []
    for i, (a, _) in enumerate(chunks):
        if i:
            parts.append(gap)
        parts.append(a)
    return np.concatenate(parts), sr


def _synth_fragment(text, voice, speed, lang, chain_idx=0):
    # Try the full speed/perturbation ladder on this unit of text first. If that's still
    # not enough, progressively split it finer (sentence -> clause -> word-halves) and
    # recurse, stitching survivors together — only the smallest, still-unsynthesizable
    # fragment ever gets dropped, instead of losing a whole sentence outright.
    try:
        return _synth_one(text, voice, speed, lang)
    except Exception as e:  # noqa: BLE001
        last_err = e
        for i in range(chain_idx, len(_SPLIT_CHAIN)):
            pieces = _SPLIT_CHAIN[i](text)
            if not pieces:
                continue
            log(f"splitting stubborn text via {_SPLIT_CHAIN[i].__name__}: {text!r}")
            chunks = []
            for p in pieces:
                try:
                    chunks.append(_synth_fragment(p, voice, speed, lang, i + 1))
                except Exception as e2:  # noqa: BLE001
                    last_err = e2
                    log(f"dropping unsynthesizable fragment {p!r}: {e2}")
            if chunks:
                return _stitch(chunks)
            # this splitter's pieces all failed too; fall through and try the next
            # splitter in the chain on the ORIGINAL (unsplit) text
        raise last_err


def synth_wav(text, voice, speed):
    lang = lang_for_voice(voice)
    try:
        audio, sr = _synth_fragment(text, voice, speed, lang)
    except Exception as e:  # noqa: BLE001
        log(f"text fully unsynthesizable, dropping: {text!r}: {e}")
        return None, 0.0
    dur = len(audio) / sr if sr else 0.0
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return buf.getvalue(), dur


# Warm up: forces the (expensive) pipeline creation once, so the first real
# request is fast.
try:
    _t = time.time()
    synth_wav("Systems online.", VOICE, SPEED)
    log(f"warm in {time.time() - _t:.1f}s")
except Exception as e:  # noqa: BLE001
    log("warmup error:", e)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL_ID, "voice": VOICE})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/say":
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "bad json"})
            return
        text = (body.get("text") or "").strip()
        if not text:
            self._json(400, {"error": "empty"})
            return
        voice = body.get("voice") or VOICE
        speed = float(body.get("speed") or SPEED)
        try:
            t = time.time()
            wav, dur = synth_wav(text, voice, speed)
            ms = int((time.time() - t) * 1000)
            if not wav:
                self._json(500, {"error": "no audio"})
                return
            rtf = ms / 1000 / max(dur, 0.01)
            log(f"synth {ms}ms audio={dur:.1f}s rtf={rtf:.2f} :: {text[:60]!r}")
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:  # noqa: BLE001
            log("synth error:", e)
            self._json(500, {"error": str(e)})


log(f"listening on 127.0.0.1:{PORT} voice={VOICE}")
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

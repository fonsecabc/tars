// tars first-responses — the fixed, zero-latency filler lines spoken the instant a command
// arrives, while the cloud gem computes the real answer. Pure string match, NO model.
// Buckets built from Caio's actual command logs; ordered most-specific first. Shared by the
// router (to choose one) and the pre-render step (to bake each into a cached WAV once, so
// playback is a file read, not a synth). Keep the phrase strings STABLE — changing a string
// orphans its cached WAV until re-rendered.
const FIRST_RESPONSES = [
  { re: /\b(are you (there|awake|up|on|listening|alive)|you (there|awake|with me)|can you hear|did you hear)\b/i, replies: ["I'm here.", 'Go on.', 'Go ahead.'] },
  { re: /\b(focus|switch|go back|go to|jump to|move to|change to)\b/i, replies: ['Switching over.', 'On it.', 'Got it.'] },
  { re: /\b(send|tell|ask|make|run|create|write|add|fix|commit|push|build|deploy|start|open|delete|implement|resume|give (us|me))\b/i, replies: ['On it.', 'Copy.', 'Sending that over.'] },
  { re: /\b(read|report|output|recap|summary|status|update|catch me up|\bop\b|what about|what are we waiting|what did|what was|what.?s? (going on|happening|new|the))\b/i, replies: ['Let me pull that up.', 'Checking.', 'One sec.'] },
  { re: /\b(what am i (working|doing)|what.?s running|which session|my sessions|what do i have)\b/i, replies: ['Let me check your sessions.', 'Checking now.'] },
]
const DEFAULT_FIRST = ['One moment.', 'Let me check.', 'On it.']

let firstTick = 0
export function firstResponse(text) {
  for (const r of FIRST_RESPONSES) if (r.re.test(text)) return r.replies[firstTick++ % r.replies.length]
  return DEFAULT_FIRST[firstTick++ % DEFAULT_FIRST.length]
}

// Every distinct phrase, for pre-rendering the WAV cache.
export const ALL_FIRST_PHRASES = [...new Set([...FIRST_RESPONSES.flatMap((r) => r.replies), ...DEFAULT_FIRST])]

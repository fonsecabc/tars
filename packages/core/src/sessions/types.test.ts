import { describe, expect, it } from 'vitest';

import {
  EVENT_KINDS,
  MESSAGE_LANE,
  MESSAGE_LANE_KINDS,
  TURN_LANE,
  TURN_LANE_KINDS,
  laneOf,
  type EventKind,
} from './types.js';

// WU-0 contract guard: no DB. Proves the frozen event-kind / lane invariants hold so the
// whole build can hang off them. If these ever fail, the migration's CHECK and the union
// have drifted apart.
describe('Chronicle event-kind contract', () => {
  it('lanes are disjoint and together cover every kind', () => {
    const turn = new Set<string>(TURN_LANE_KINDS);
    const message = new Set<string>(MESSAGE_LANE_KINDS);
    for (const k of turn) {
      expect(message.has(k)).toBe(false);
    }
    expect(EVENT_KINDS.length).toBe(TURN_LANE_KINDS.length + MESSAGE_LANE_KINDS.length);
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length); // no duplicates
  });

  it('laneOf routes each kind to its lane', () => {
    for (const k of EVENT_KINDS) {
      const lane = laneOf(k);
      expect(lane).toBe(MESSAGE_LANE.has(k) ? 'message' : 'turn');
    }
    expect(laneOf('turn_message')).toBe('turn');
    expect(laneOf('tool_call')).toBe('turn');
    expect(laneOf('session_opened')).toBe('turn');
    expect(laneOf('message')).toBe('message');
    expect(laneOf('signal')).toBe('message');
  });

  it('the runtime lane sets match the kind arrays', () => {
    expect(TURN_LANE.size).toBe(TURN_LANE_KINDS.length);
    expect(MESSAGE_LANE.size).toBe(MESSAGE_LANE_KINDS.length);
    for (const k of TURN_LANE_KINDS) {
      expect(TURN_LANE.has(k)).toBe(true);
    }
    for (const k of MESSAGE_LANE_KINDS) {
      expect(MESSAGE_LANE.has(k)).toBe(true);
    }
  });

  it('EVENT_KINDS is assignable to EventKind (compile-time union check)', () => {
    const kinds: EventKind[] = [...EVENT_KINDS];
    expect(kinds).toContain('checkpoint');
  });
});

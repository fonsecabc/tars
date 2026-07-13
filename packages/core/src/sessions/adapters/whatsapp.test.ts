import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { MAX_TEXT_LENGTH } from './adapter.js';
import type { WhatsAppMessage } from './whatsapp.js';
import { ingestWhatsAppExchange, whatsappMessagesToEvents } from './whatsapp.js';
import { createSessionService } from '../service.js';

const pool = getTestPool();
const service = createSessionService(pool);

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

const GROUP_JID = '000000000000000000@g.us';

describe('whatsappMessagesToEvents (pure)', () => {
  it('maps fromMe messages to actor assistant', () => {
    const events = whatsappMessagesToEvents([
      { fromMe: true, senderName: 'Person A', text: 'On it.' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('assistant');
    expect(events[0]!.harness).toBe('whatsapp');
    expect(events[0]!.kind).toBe('turn_message');
    expect(events[0]!.payload).toEqual({ text: 'On it.' });
  });

  it('maps inbound messages to the sender name', () => {
    const events = whatsappMessagesToEvents([
      { fromMe: false, senderName: 'Person A', text: 'hello' },
    ]);

    expect(events[0]!.actor).toBe('Person A');
  });

  it('falls back to actor user when senderName is missing or blank', () => {
    const events = whatsappMessagesToEvents([
      { fromMe: false, text: 'no name' },
      { fromMe: false, senderName: '   ', text: 'blank name' },
    ]);

    expect(events.map((e) => e.actor)).toEqual(['user', 'user']);
  });

  it('clips long message text and records at as an ISO string', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const events = whatsappMessagesToEvents([
      { fromMe: false, senderName: 'Person A', text: 'x'.repeat(MAX_TEXT_LENGTH + 50), at },
    ]);

    const text = events[0]!.payload!['text'] as string;
    expect(text).toHaveLength(MAX_TEXT_LENGTH + 1); // clipped + ellipsis
    expect(text.endsWith('…')).toBe(true);
    expect(events[0]!.payload!['at']).toBe('2026-01-02T03:04:05.000Z');
  });

  it('drops empty and whitespace-only messages', () => {
    const events = whatsappMessagesToEvents([
      { fromMe: false, senderName: 'Person A', text: '' },
      { fromMe: true, text: '   \n\t ' },
      { fromMe: false, senderName: 'Person B', text: 'kept' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('Person B');
  });
});

describe('ingestWhatsAppExchange', () => {
  const exchange: WhatsAppMessage[] = [
    { fromMe: false, senderName: 'Person A', text: 'ping' },
    { fromMe: true, text: 'pong' },
  ];

  it('creates the session with origin whatsapp, the chat JID, the chat name, and the chat tier', async () => {
    const result = await ingestWhatsAppExchange(
      service,
      { chatJid: GROUP_JID, chatName: 'Group X', tier: 'guest' },
      exchange,
    );

    expect(result.sessionCreated).toBe(true);
    expect(result.session.origin).toBe('whatsapp');
    expect(result.session.externalRef).toBe(GROUP_JID);
    expect(result.session.title).toBe('Group X');
    // Tier is stamped from the chat's trust tier at creation.
    expect(result.session.tier).toBe('guest');
  });

  it('reuses the session on re-ingest and preserves the tier stamped at creation', async () => {
    const first = await ingestWhatsAppExchange(
      service,
      { chatJid: GROUP_JID, chatName: 'Group X', tier: 'guest' },
      exchange,
    );

    // The trust-gate later says 'trusted' — the stored tier must NOT change.
    const second = await ingestWhatsAppExchange(
      service,
      { chatJid: GROUP_JID, chatName: 'Group X', tier: 'trusted' },
      [{ fromMe: false, senderName: 'Person A', text: 'still here' }],
    );

    expect(second.sessionCreated).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.tier).toBe('guest');

    // Find-or-open never re-logs genesis: exactly one session_opened event exists.
    const events = await service.listEvents(first.session.id);
    expect(events.filter((e) => e.kind === 'session_opened')).toHaveLength(1);
  });

  it('lands events in order with the right actors and releases the lease afterwards', async () => {
    const result = await ingestWhatsAppExchange(
      service,
      { chatJid: '111111111111@s.whatsapp.net', tier: 'trusted' },
      [
        { fromMe: false, senderName: 'Person A', text: 'first' },
        { fromMe: true, text: 'second' },
        { fromMe: false, text: 'third' },
      ],
    );

    expect(result.session.title).toBeNull();
    expect(result.appended).toHaveLength(3);
    expect(result.appended.map((e) => e.actor)).toEqual(['Person A', 'assistant', 'user']);
    expect(result.appended.map((e) => e.payload['text'])).toEqual(['first', 'second', 'third']);
    const seqs = result.appended.map((e) => BigInt(e.seq));
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
    expect(seqs[2]!).toBeGreaterThan(seqs[1]!);

    // Batch ingestion holds the wheel only while writing.
    expect(await service.getLease(result.session.id)).toBeUndefined();
  });
});

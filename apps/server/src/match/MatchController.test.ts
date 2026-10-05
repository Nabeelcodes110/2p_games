import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_CATALOG } from '@2p/shared';
import type { GameStateSnapshot, PlayerId, ServerToClientEvents, StrokeBatchInput } from '@2p/shared';
import type { Clock, MatchTransport } from '../games/types.js';
import { SkribbleSession } from '../games/skribble/skribbleModule.js';
import { GameMatchController } from './MatchController.js';

const rules = GAME_CATALOG.skribble.rules;
const A = 'player-a';
const B = 'player-b';

class FakeClock implements Clock {
  current = 1_000_000;
  private nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.current;
  }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  /** Advances time, firing due timers in order (including ones scheduled while advancing). */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = due[1].at;
      due[1].callback();
    }
    this.current = target;
  }
}

interface Sent {
  to: PlayerId | 'all';
  except?: PlayerId;
  event: keyof ServerToClientEvents;
  payload: unknown;
}

function setup(options: { first?: PlayerId } = {}) {
  const clock = new FakeClock();
  const sent: Sent[] = [];
  const transport: MatchTransport = {
    sendTo: (to, event, payload) => void sent.push({ to, event, payload }),
    broadcast: (event, payload, opts) => void sent.push({ to: 'all', except: opts?.except, event, payload }),
  };
  let ids = 0;
  const controller = new GameMatchController({
    roomCode: 'ABC123',
    gameId: 'skribble',
    playerIds: [A, B],
    transport,
    clock,
    // First pick selects the first drawer; later picks choose words.
    random: () => (options.first === B ? 0.99 : 0),
    generateId: () => `id${++ids}`,
    module: {
      id: 'skribble',
      actionEvents: ['skribble:stroke', 'skribble:clear', 'skribble:guess'],
      createSession: (ctx) => new SkribbleSession(ctx, { words: ['apple', 'banana', 'cherry'] }),
    },
  });
  const latest = (player: PlayerId) =>
    sent.filter((s) => s.to === player && s.event === 'game:state').at(-1)?.payload as GameStateSnapshot<'skribble'>;
  const match = () => controller.snapshotFor(A).match;
  const word = () => (controller.snapshotFor(match().activePlayerId!) as GameStateSnapshot<'skribble'>).view.word!;
  const guesser = () => (match().activePlayerId === A ? B : A);
  const ref = () => ({ matchId: match().matchId!, turnId: match().turnId! });
  const guess = (player: PlayerId, text: string) =>
    controller.handleAction(player, 'skribble:guess', { ...ref(), text });
  return { clock, sent, controller, latest, match, word, guesser, ref, guess };
}

function stroke(ref: { matchId: string; turnId: string }, overrides: Partial<StrokeBatchInput> = {}): StrokeBatchInput {
  return {
    ...ref,
    strokeId: 's1',
    tool: 'pencil',
    color: '#000000',
    width: 6,
    points: [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
    final: false,
    ...overrides,
  };
}

describe('GameMatchController', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('starts the first turn, sends snapshots to both, and the word only to the drawer', () => {
    t.controller.start();
    expect(t.match()).toMatchObject({ phase: 'activeTurn', round: 1, activePlayerId: A });
    expect(t.latest(A).view.word).toBe('apple');
    expect(t.latest(B).view.word).toBeNull();
    expect(t.latest(B).view.wordLength).toBe(5);

    const wordEvents = t.sent.filter((s) => s.event === 'skribble:word');
    expect(wordEvents).toEqual([{ to: A, event: 'skribble:word', payload: expect.objectContaining({ word: 'apple' }) }]);
    // No broadcast or guesser-bound message ever contains the secret word during the turn.
    const leaked = t.sent.filter((s) => s.to !== A && JSON.stringify(s.payload).includes('apple'));
    expect(leaked).toEqual([]);
  });

  it('randomly picks the first drawer and alternates', () => {
    const other = setup({ first: B });
    other.controller.start();
    expect(other.match().activePlayerId).toBe(B);
    other.clock.advance(rules.turnDurationMs + rules.resultIntervalMs);
    expect(other.match()).toMatchObject({ activePlayerId: A, turnNumber: 2, round: 1 });
  });

  it('times out, reveals the word, pauses 3s, then starts the next turn with a new word', () => {
    t.controller.start();
    const first = t.word();
    t.clock.advance(rules.turnDurationMs);
    expect(t.match()).toMatchObject({ phase: 'turnResult', scores: { [A]: 0, [B]: 0 } });
    expect(t.latest(B).view.revealedWord).toBe(first);

    t.clock.advance(rules.resultIntervalMs - 1);
    expect(t.match().phase).toBe('turnResult');
    t.clock.advance(1);
    expect(t.match()).toMatchObject({ phase: 'activeTurn', turnNumber: 2, activePlayerId: B });
    expect(t.word()).not.toBe(first);
    expect(t.latest(B).view.strokes).toEqual([]);
  });

  it('correct guess scores once and ends the turn; duplicates and timeout do not double-count', () => {
    t.controller.start();
    const w = t.word();
    const turnRef = t.ref();
    expect(t.guess(B, `  ${w.toUpperCase()} `)).toEqual({ ok: true, data: { correct: true } });
    expect(t.match()).toMatchObject({ phase: 'turnResult', scores: { [B]: 1, [A]: 0 } });

    const again = t.controller.handleAction(B, 'skribble:guess', { ...turnRef, text: w });
    expect(again.ok).toBe(false);
    t.clock.advance(rules.turnDurationMs); // old timeout must not fire/advance twice
    expect(t.match().scores).toEqual({ [A]: 0, [B]: 1 });
    expect(t.match().turnNumber).toBe(2);
  });

  it('rejects guesses at the deadline even before the timeout callback runs', () => {
    t.controller.start();
    const w = t.word();
    t.clock.current = t.match().deadline!; // time reached, timer not yet executed
    const result = t.guess(B, w);
    expect(result).toMatchObject({ ok: false, error: { code: 'DEADLINE_PASSED' } });
    t.clock.advance(0);
    expect(t.match().scores[B]).toBe(0);
  });

  it('broadcasts incorrect guesses to both players as plain messages', () => {
    t.controller.start();
    expect(t.guess(B, 'not   it')).toEqual({ ok: true, data: { correct: false } });
    const msg = t.sent.filter((s) => s.event === 'skribble:guess-result').at(-1);
    expect(msg).toMatchObject({ to: 'all', payload: { kind: 'guess', playerId: B, text: 'not it' } });
  });

  it('enforces drawing and guessing permissions', () => {
    t.controller.start();
    expect(t.controller.handleAction(B, 'skribble:stroke', stroke(t.ref()))).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
    expect(t.controller.handleAction(B, 'skribble:clear', t.ref())).toMatchObject({ ok: false });
    expect(t.guess(A, t.word())).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    expect(t.guess('stranger', 'x')).toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
  });

  it('rejects stale turn IDs and malformed payloads', () => {
    t.controller.start();
    const old = t.ref();
    t.clock.advance(rules.turnDurationMs + rules.resultIntervalMs);
    expect(t.controller.handleAction(B, 'skribble:stroke', stroke(old))).toMatchObject({
      error: { code: 'STALE_TURN' },
    });
    const ref = t.ref(); // B draws now
    const bad = [
      null,
      { ...stroke(ref), color: '#123456' },
      { ...stroke(ref), width: 7 },
      { ...stroke(ref), points: [[2, 0]] },
      { ...stroke(ref), points: [[Number.NaN, 0]] },
      { ...stroke(ref), strokeId: '<script>' },
      { ...stroke(ref), points: Array.from({ length: 65 }, () => [0, 0]) },
    ];
    for (const payload of bad) {
      expect(t.controller.handleAction(B, 'skribble:stroke', payload).ok).toBe(false);
    }
  });

  it('relays accepted strokes to the other player only, with sequence numbers', () => {
    t.controller.start();
    const r1 = t.controller.handleAction(A, 'skribble:stroke', { ...stroke(t.ref()), extra: 'dropped' });
    expect(r1).toEqual({ ok: true, data: { seq: 1 } });
    const relayed = t.sent.find((s) => s.event === 'skribble:stroke');
    expect(relayed).toMatchObject({ to: 'all', except: A, payload: { seq: 1, strokeId: 's1' } });
    expect(relayed!.payload).not.toHaveProperty('extra');
    expect(t.latest(B)).toBeDefined();
    expect(t.controller.snapshotFor(B).view).toMatchObject({ lastSeq: 1, strokes: [{ seq: 1 }] });
  });

  it('orders clear with strokes and rejects points for strokes invalidated by clear', () => {
    t.controller.start();
    t.controller.handleAction(A, 'skribble:stroke', stroke(t.ref()));
    expect(t.controller.handleAction(A, 'skribble:clear', t.ref())).toEqual({ ok: true, data: { seq: 2 } });
    expect(t.controller.handleAction(A, 'skribble:stroke', stroke(t.ref()))).toMatchObject({
      error: { code: 'NOT_ALLOWED' },
    });
    expect(t.controller.handleAction(A, 'skribble:stroke', stroke(t.ref(), { strokeId: 's2' }))).toEqual({
      ok: true,
      data: { seq: 3 },
    });
    expect((t.controller.snapshotFor(B) as GameStateSnapshot<'skribble'>).view.strokes.map((s) => s.strokeId)).toEqual(['s2']);
  });

  it('plays a full match to a threshold win, then needs both players for a full rematch reset', () => {
    t.controller.start();
    while (t.match().phase !== 'finished') {
      if (t.match().activePlayerId === A) t.guess(B, t.word());
      else t.clock.advance(rules.turnDurationMs);
      t.clock.advance(rules.resultIntervalMs);
    }
    expect(t.match()).toMatchObject({ winnerId: B, scores: { [B]: 5 } });
    expect(t.clock.timers.size).toBe(0);
    const oldMatchId = t.match().matchId;

    expect(t.controller.rematchReady(A)).toEqual({ ok: true, data: undefined });
    expect(t.match()).toMatchObject({ phase: 'finished', rematchReady: [A] });
    t.controller.rematchReady(B);
    expect(t.match()).toMatchObject({ phase: 'activeTurn', turnNumber: 1, scores: { [A]: 0, [B]: 0 } });
    expect(t.match().matchId).not.toBe(oldMatchId);
    expect(t.controller.matchId).toBe(t.match().matchId);
    expect((t.controller.snapshotFor(A) as GameStateSnapshot<'skribble'>).view.messages).toEqual([]);
  });

  it('rejects rematch while a match is running', () => {
    t.controller.start();
    expect(t.controller.rematchReady(A)).toMatchObject({ ok: false, error: { code: 'INVALID_PHASE' } });
  });

  it('dispose clears all timers, is idempotent, and rejects later actions', () => {
    t.controller.start();
    expect(t.clock.timers.size).toBe(1);
    t.controller.dispose();
    t.controller.dispose();
    expect(t.clock.timers.size).toBe(0);
    expect(t.guess(B, 'apple').ok).toBe(false);
    const sentBefore = t.sent.length;
    t.clock.advance(rules.turnDurationMs * 2);
    expect(t.sent.length).toBe(sentBefore);
  });

  it('rate-limits guesses per player', () => {
    t.controller.start();
    const results = [1, 2, 3, 4].map(() => t.guess(B, 'nope'));
    expect(results.at(-1)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    t.clock.advance(1_000);
    expect(t.guess(B, 'nope').ok).toBe(true);
  });
});

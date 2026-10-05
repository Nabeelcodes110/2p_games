import { beforeEach, describe, expect, it } from 'vitest';
import { COLORS_PICK_MS, COLORS_REVEAL_MS, GAME_CATALOG } from '@2p/shared';
import type { GameStateSnapshot, PlayerId } from '@2p/shared';
import type { Clock, MatchTransport } from '../types.js';
import { GameMatchController } from '../../match/MatchController.js';

const rules = GAME_CATALOG.colors.rules;
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
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = due[1].at;
      due[1].callback();
    }
    this.current = target;
  }
}

/** Deterministic random: each target channel comes from the queue (8-bit value / 255). */
function setup(targets: Array<[number, number, number]>) {
  const clock = new FakeClock();
  const sent: Array<{ to: PlayerId | 'all'; event: string; payload: unknown }> = [];
  const transport: MatchTransport = {
    sendTo: (to, event, payload) => void sent.push({ to, event, payload }),
    broadcast: (event, payload) => void sent.push({ to: 'all', event, payload }),
  };
  // The controller draws once for the (unused) first-player pick before the first target.
  const queue = [0, ...targets.flat().map((v) => (v + 0.5) / 256)];
  let ids = 0;
  const controller = new GameMatchController({
    roomCode: 'ABC123',
    gameId: 'colors',
    playerIds: [A, B],
    transport,
    clock,
    random: () => queue.shift() ?? 0.5,
    generateId: () => `id${++ids}`,
  });
  const snap = (p: PlayerId) => controller.snapshotFor(p) as GameStateSnapshot<'colors'>;
  const match = () => snap(A).match;
  const ref = () => ({ matchId: match().matchId!, turnId: match().turnId! });
  const submit = (p: PlayerId, color: string) => controller.handleAction(p, 'colors:submit', { ...ref(), color });
  /** Moves to the start of the picking window. */
  const openPicking = () => clock.advance(COLORS_REVEAL_MS);
  return { clock, sent, controller, snap, match, ref, submit, openPicking };
}

describe('Colors match', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    // Round targets: #336699, #FF0000, #00FF00, ...
    t = setup([
      [0x33, 0x66, 0x99],
      [0xff, 0x00, 0x00],
      [0x00, 0xff, 0x00],
      [0x00, 0x00, 0xff],
      [0xff, 0xff, 0x00],
    ]);
    t.controller.start();
  });

  it('uses an 18s simultaneous turn: 3s memorize + 15s pick', () => {
    expect(rules.turnDurationMs).toBe(COLORS_REVEAL_MS + COLORS_PICK_MS);
    const m = t.match();
    expect(m.deadline! - m.turnStartedAt!).toBe(18_000);
  });

  it('shows the target only during the memorize window and never shares picks early', () => {
    expect(t.snap(A).view.target).toBe('#336699');
    expect(t.snap(B).view.target).toBe('#336699');
    t.openPicking();
    expect(t.snap(A).view.target).toBeNull();
    expect(t.submit(A, '#336698').ok).toBe(true);
    // Opponent only learns that A locked in; the color is private.
    const toB = t.sent.filter((s) => s.to === B && s.event === 'game:state').at(-1)!.payload as GameStateSnapshot<'colors'>;
    expect(toB.view.lockedIn).toEqual([A]);
    expect(toB.view.target).toBeNull();
    expect(JSON.stringify(toB)).not.toContain('#336698');
    expect(t.snap(A).view.myPick?.color).toBe('#336698');
  });

  it('rejects submissions during the reveal, after locking in, with bad colors, stale turns and strangers', () => {
    expect(t.submit(A, '#336699')).toMatchObject({ ok: false, error: { code: 'INVALID_PHASE' } });
    t.openPicking();
    expect(t.submit(A, 'red')).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(t.controller.handleAction(A, 'colors:submit', { ...t.ref(), turnId: 'old', color: '#000000' })).toMatchObject({
      ok: false,
      error: { code: 'STALE_TURN' },
    });
    expect(t.controller.handleAction('stranger', 'colors:submit', { ...t.ref(), color: '#000000' })).toMatchObject({
      ok: false,
    });
    expect(t.submit(A, '#000000').ok).toBe(true);
    expect(t.submit(A, '#FFFFFF')).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
  });

  it('closest color wins as soon as both lock in, then reveals both picks', () => {
    t.openPicking();
    t.submit(A, '#346699'); // very close
    t.clock.advance(1_000);
    t.submit(B, '#FF00FF'); // far
    expect(t.match()).toMatchObject({ phase: 'turnResult', scores: { [A]: 1, [B]: 0 } });
    const result = t.snap(B).view.result!;
    expect(result).toMatchObject({ target: '#336699', winnerId: A, reason: 'closest' });
    expect(result.picks[B]?.color).toBe('#FF00FF');
    expect(t.snap(B).view.target).toBe('#336699');
  });

  it('equal distance: the faster player wins; the same color at the same instant scores nobody', () => {
    t.openPicking();
    t.submit(B, '#336699');
    t.clock.advance(2_000);
    t.submit(A, '#336699');
    expect(t.snap(A).view.result).toMatchObject({ winnerId: B, reason: 'faster' });
    expect(t.match().scores).toEqual({ [A]: 0, [B]: 1 });

    t.clock.advance(rules.resultIntervalMs); // next round, target #FF0000
    t.openPicking();
    t.submit(A, '#FF0000');
    t.submit(B, '#FF0000'); // same fake-clock millisecond
    expect(t.snap(A).view.result).toMatchObject({ winnerId: null, reason: 'tie' });
    expect(t.match().scores).toEqual({ [A]: 0, [B]: 1 });
  });

  it('at the deadline a lone submitter wins and nobody answering scores nothing', () => {
    t.openPicking();
    t.submit(A, '#000000');
    t.clock.advance(COLORS_PICK_MS);
    expect(t.match()).toMatchObject({ phase: 'turnResult', scores: { [A]: 1, [B]: 0 } });
    expect(t.snap(B).view.result).toMatchObject({ winnerId: A, reason: 'forfeit' });

    t.clock.advance(rules.resultIntervalMs);
    t.clock.advance(rules.turnDurationMs);
    expect(t.match()).toMatchObject({ phase: 'turnResult', scores: { [A]: 1, [B]: 0 } });
    expect(t.snap(A).view.result).toMatchObject({ winnerId: null, reason: 'noAnswer' });
  });

  it('rejects a lock-in at the deadline and cannot score a round twice', () => {
    t.openPicking();
    t.clock.advance(COLORS_PICK_MS - 1);
    expect(t.submit(A, '#336699').ok).toBe(true);
    // Both-lock-in and timeout race: finish via the second player, then let the old timer pass.
    expect(t.submit(B, '#336600').ok).toBe(true);
    const scores = { ...t.match().scores };
    t.clock.advance(1);
    expect(t.match().scores).toEqual(scores);
    expect(t.submit(B, '#336600')).toMatchObject({ ok: false });
  });

  it('five tied rounds end in a draw with no timers left running', () => {
    for (let round = 1; round <= 5; round += 1) {
      expect(t.match().round).toBe(round);
      t.clock.advance(rules.turnDurationMs); // nobody answers
      if (round < 5) t.clock.advance(rules.resultIntervalMs);
    }
    expect(t.match()).toMatchObject({ phase: 'finished', isDraw: true, winnerId: null });
    expect(t.clock.timers.size).toBe(0);
  });

  it('rematch resets scores and starts a fresh match', () => {
    for (let round = 1; round <= 5; round += 1) {
      t.clock.advance(rules.turnDurationMs);
      if (round < 5) t.clock.advance(rules.resultIntervalMs);
    }
    const oldMatch = t.match().matchId;
    t.controller.rematchReady(A);
    t.controller.rematchReady(B);
    expect(t.match()).toMatchObject({ phase: 'activeTurn', round: 1, scores: { [A]: 0, [B]: 0 } });
    expect(t.match().matchId).not.toBe(oldMatch);
    expect(t.snap(A).view.result).toBeNull();
  });

  it('dispose clears timers', () => {
    t.controller.dispose();
    expect(t.clock.timers.size).toBe(0);
  });
});

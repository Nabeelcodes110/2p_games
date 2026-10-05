import { describe, expect, it } from 'vitest';
import { GAME_CATALOG } from '../games.js';
import type { MatchState } from '../match.js';
import { createInitialMatchState, isRematchAgreed, matchReducer } from './matchEngine.js';

const rules = GAME_CATALOG.skribble.rules;
const A = 'player-a';
const B = 'player-b';

function started(first = A, now = 1_000): MatchState {
  return matchReducer(createInitialMatchState(rules), {
    type: 'start',
    matchId: 'm1',
    playerIds: [A, B],
    firstPlayerId: first,
    turnId: 't1',
    now,
  });
}

function other(id: string): string {
  return id === A ? B : A;
}

/** Ends the current turn (guess or timeout) then advances to the next turn if any. */
function playTurn(state: MatchState, guessed: boolean): MatchState {
  const now = (state.turnStartedAt as number) + 1_000;
  const ended = guessed
    ? matchReducer(state, {
        type: 'outcome',
        outcome: { type: 'correctGuess', turnId: state.turnId!, playerId: other(state.activePlayerId!) },
        now,
      })
    : matchReducer(state, { type: 'timeout', turnId: state.turnId!, now: state.deadline! });
  expect(ended).not.toBe(state);
  if (ended.phase === 'finished') return ended;
  return matchReducer(ended, {
    type: 'nextTurn',
    turnId: `t${ended.turnNumber + 1}`,
    now: ended.resultUntil!,
  });
}

describe('matchReducer', () => {
  it('starts with zero scores, round 1 and a deadline', () => {
    const s = started(B, 5_000);
    expect(s).toMatchObject({
      phase: 'activeTurn',
      round: 1,
      turnNumber: 1,
      activePlayerId: B,
      deadline: 5_000 + rules.turnDurationMs,
      scores: { [A]: 0, [B]: 0 },
    });
  });

  it('rejects start with invalid players or outside the lobby', () => {
    const lobby = createInitialMatchState(rules);
    const bad = { type: 'start', matchId: 'm', turnId: 't', now: 0 } as const;
    expect(matchReducer(lobby, { ...bad, playerIds: [A], firstPlayerId: A })).toBe(lobby);
    expect(matchReducer(lobby, { ...bad, playerIds: [A, A], firstPlayerId: A })).toBe(lobby);
    expect(matchReducer(lobby, { ...bad, playerIds: [A, B], firstPlayerId: 'x' })).toBe(lobby);
    const s = started();
    expect(matchReducer(s, { ...bad, playerIds: [A, B], firstPlayerId: A })).toBe(s);
  });

  it('plays five rounds of two turns with alternating drawers, then a draw on timeouts', () => {
    let s = started(A);
    const drawers: string[] = [];
    const rounds: number[] = [];
    while (s.phase !== 'finished') {
      drawers.push(s.activePlayerId!);
      rounds.push(s.round);
      s = playTurn(s, false);
    }
    expect(drawers).toEqual([A, B, A, B, A, B, A, B, A, B]);
    expect(rounds).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(s).toMatchObject({ isDraw: true, winnerId: null, scores: { [A]: 0, [B]: 0 } });
  });

  it('awards exactly one point to the guesser and nothing to the drawer', () => {
    const s = started(A);
    const ended = playTurn(s, true);
    expect(ended.scores).toEqual({ [A]: 0, [B]: 1 });
    expect(ended.lastTurnResult).toMatchObject({ reason: 'outcome', scorerId: B, activePlayerId: A });
  });

  it('timeout awards no points and enters the result interval', () => {
    const s = started();
    const ended = matchReducer(s, { type: 'timeout', turnId: 't1', now: s.deadline! });
    expect(ended).toMatchObject({
      phase: 'turnResult',
      deadline: null,
      resultUntil: s.deadline! + rules.resultIntervalMs,
      scores: { [A]: 0, [B]: 0 },
    });
    expect(ended.lastTurnResult).toMatchObject({ reason: 'timeout', scorerId: null });
  });

  it('ends immediately when a player reaches the win threshold', () => {
    // B draws first, so A guesses on turns 1,3,5,7,9 and hits 5 on turn 9.
    let s = started(B);
    while (s.phase !== 'finished') {
      s = playTurn(s, s.activePlayerId === B);
    }
    expect(s).toMatchObject({ winnerId: A, isDraw: false, turnNumber: 9 });
    expect(s.scores).toEqual({ [A]: 5, [B]: 0 });
  });

  it('decides the higher score after all rounds', () => {
    let s = started(A);
    let turn = 0;
    while (s.phase !== 'finished') {
      turn += 1;
      // B guesses turns 1 and 3; A guesses turn 2 only.
      s = playTurn(s, turn === 1 || turn === 2 || turn === 3);
    }
    expect(s).toMatchObject({ winnerId: B, isDraw: false, turnNumber: 10 });
    expect(s.scores).toEqual({ [A]: 1, [B]: 2 });
  });

  it('produces a draw on equal non-zero scores', () => {
    let s = started(A);
    let turn = 0;
    while (s.phase !== 'finished') {
      turn += 1;
      s = playTurn(s, turn <= 2);
    }
    expect(s).toMatchObject({ isDraw: true, winnerId: null, scores: { [A]: 1, [B]: 1 } });
  });

  it('ignores stale or invalid outcomes', () => {
    const s = started(A);
    const now = s.turnStartedAt! + 10;
    const guess = (turnId: string, playerId: string, at = now) =>
      matchReducer(s, { type: 'outcome', outcome: { type: 'correctGuess', turnId, playerId }, now: at });
    expect(guess('old', B)).toBe(s);
    expect(guess('t1', A)).toBe(s); // drawer cannot score
    expect(guess('t1', 'stranger')).toBe(s);
    expect(guess('t1', B, s.deadline!)).toBe(s); // at deadline
  });

  it('a turn finishes exactly once (duplicate guess, guess/timeout race)', () => {
    const s = started(A);
    const outcome = { type: 'correctGuess', turnId: 't1', playerId: B } as const;
    const once = matchReducer(s, { type: 'outcome', outcome, now: s.turnStartedAt! + 5 });
    expect(matchReducer(once, { type: 'outcome', outcome, now: s.turnStartedAt! + 6 })).toBe(once);
    expect(matchReducer(once, { type: 'timeout', turnId: 't1', now: s.deadline! })).toBe(once);

    const timedOut = matchReducer(s, { type: 'timeout', turnId: 't1', now: s.deadline! });
    expect(matchReducer(timedOut, { type: 'outcome', outcome, now: s.deadline! - 1 })).toBe(timedOut);
    expect(timedOut.scores[B]).toBe(0);
  });

  it('ignores early timeouts and nextTurn outside the result interval', () => {
    const s = started();
    expect(matchReducer(s, { type: 'timeout', turnId: 't1', now: s.deadline! - 1 })).toBe(s);
    expect(matchReducer(s, { type: 'nextTurn', turnId: 't2', now: s.deadline! })).toBe(s);
    const ended = matchReducer(s, { type: 'timeout', turnId: 't1', now: s.deadline! });
    expect(matchReducer(ended, { type: 'nextTurn', turnId: 't1', now: ended.resultUntil! })).toBe(ended);
  });

  it('requires both players to agree to a rematch, and reset clears everything', () => {
    let s = started(B);
    while (s.phase !== 'finished') s = playTurn(s, s.activePlayerId === B);

    expect(matchReducer(started(), { type: 'rematchReady', playerId: A }).rematchReady).toEqual([]);
    const one = matchReducer(s, { type: 'rematchReady', playerId: A });
    expect(isRematchAgreed(one)).toBe(false);
    expect(matchReducer(one, { type: 'rematchReady', playerId: A })).toBe(one);
    expect(matchReducer(one, { type: 'rematchReady', playerId: 'stranger' })).toBe(one);
    const both = matchReducer(one, { type: 'rematchReady', playerId: B });
    expect(isRematchAgreed(both)).toBe(true);

    expect(matchReducer(both, { type: 'reset' })).toEqual(createInitialMatchState(rules));
  });
});

describe('matchReducer with simultaneous-round games (Colors)', () => {
  const colors = GAME_CATALOG.colors.rules;
  const begin = () =>
    matchReducer(createInitialMatchState(colors), {
      type: 'start',
      matchId: 'm1',
      playerIds: [A, B],
      firstPlayerId: A,
      turnId: 't1',
      now: 1_000,
    });

  function round(state: MatchState, winnerId: string | null): MatchState {
    const ended = matchReducer(state, {
      type: 'outcome',
      outcome: { type: 'roundResult', turnId: state.turnId!, winnerId },
      now: state.turnStartedAt! + 5_000,
    });
    expect(ended).not.toBe(state);
    if (ended.phase === 'finished') return ended;
    return matchReducer(ended, { type: 'nextTurn', turnId: `t${ended.turnNumber + 1}`, now: ended.resultUntil! });
  }

  it('plays one turn per round, five rounds, and awards a point to either player', () => {
    let s = begin();
    expect(s.round).toBe(1);
    // B wins even though A is the "active" player: roundResult has no drawer restriction.
    s = round(s, B);
    expect(s.scores).toEqual({ [A]: 0, [B]: 1 });
    expect(s.round).toBe(2);
  });

  it('a no-winner round awards nothing; five tied rounds is a draw', () => {
    let s = begin();
    for (let i = 0; i < 5; i += 1) s = round(s, null);
    expect(s).toMatchObject({ phase: 'finished', isDraw: true, winnerId: null, scores: { [A]: 0, [B]: 0 } });
  });

  it('highest score after five rounds wins', () => {
    let s = begin();
    for (const w of [A, B, A, null, B]) s = round(s, w);
    expect(s.phase).toBe('finished');
    expect(s.isDraw).toBe(true);
    s = begin();
    for (const w of [A, B, A, null, A]) s = round(s, w);
    expect(s).toMatchObject({ phase: 'finished', winnerId: A });
  });

  it('rejects stale turns and unknown winners; a round ends exactly once', () => {
    const s = begin();
    expect(matchReducer(s, { type: 'outcome', outcome: { type: 'roundResult', turnId: 'old', winnerId: A }, now: 2_000 })).toBe(s);
    expect(matchReducer(s, { type: 'outcome', outcome: { type: 'roundResult', turnId: 't1', winnerId: 'x' }, now: 2_000 })).toBe(s);
    const ended = matchReducer(s, { type: 'outcome', outcome: { type: 'roundResult', turnId: 't1', winnerId: A }, now: 2_000 });
    expect(matchReducer(ended, { type: 'outcome', outcome: { type: 'roundResult', turnId: 't1', winnerId: B }, now: 2_001 })).toBe(ended);
    expect(matchReducer(ended, { type: 'timeout', turnId: 't1', now: s.deadline! })).toBe(ended);
  });
});

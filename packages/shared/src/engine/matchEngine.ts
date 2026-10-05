/**
 * OWNER: Agent 3. Shared pure match engine (turns, rounds, deadlines, scoring, winner, draw).
 * Used authoritatively by the server match controller; GameHost only renders its output.
 * Pure: no timers, no randomness, no I/O. IDs, first player and `now` come in through actions.
 */
import type { MatchRules } from '../games.js';
import type { GameOutcome, MatchId, MatchState, TurnEndReason, TurnId } from '../match.js';
import type { PlayerId } from '../room.js';

export type MatchAction =
  | {
      type: 'start';
      matchId: MatchId;
      playerIds: PlayerId[];
      firstPlayerId: PlayerId;
      turnId: TurnId;
      now: number;
    }
  | { type: 'outcome'; outcome: GameOutcome; now: number }
  | { type: 'timeout'; turnId: TurnId; now: number }
  /** Leaves the turn-result interval. `turnId` is the next turn's server-generated ID. */
  | { type: 'nextTurn'; turnId: TurnId; now: number }
  | { type: 'rematchReady'; playerId: PlayerId }
  /** Abort or rematch reset: back to a clean lobby state. */
  | { type: 'reset' };

export function createInitialMatchState(rules: MatchRules): MatchState {
  return {
    matchId: null,
    phase: 'lobby',
    rules,
    playerIds: [],
    scores: {},
    round: 0,
    turnNumber: 0,
    turnId: null,
    activePlayerId: null,
    turnStartedAt: null,
    deadline: null,
    resultUntil: null,
    lastTurnResult: null,
    winnerId: null,
    isDraw: false,
    rematchReady: [],
  };
}

export function totalTurns(rules: MatchRules): number {
  return rules.maxRounds * rules.turnsPerRound;
}

export function roundForTurn(turnNumber: number, rules: MatchRules): number {
  return Math.ceil(turnNumber / rules.turnsPerRound);
}

/** True when every player in the finished match has agreed to a rematch. */
export function isRematchAgreed(state: MatchState): boolean {
  return (
    state.phase === 'finished' &&
    state.playerIds.length > 0 &&
    state.playerIds.every((id) => state.rematchReady.includes(id))
  );
}

/** Returns the same object reference when the action is rejected/ignored (stale, wrong phase, ...). */
export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'start':
      return start(state, action);
    case 'outcome': {
      const { outcome, now } = action;
      if (!isLiveTurn(state, outcome.turnId)) return state;
      if (outcome.type === 'roundResult') {
        // The module already validated submission times against the deadline; the timeout path
        // resolves a round at the deadline itself, so no `now` check here.
        if (outcome.winnerId !== null && !state.playerIds.includes(outcome.winnerId)) return state;
        return endTurn(state, 'outcome', outcome.winnerId, now);
      }
      if (now >= (state.deadline as number)) return state;
      if (!state.playerIds.includes(outcome.playerId) || outcome.playerId === state.activePlayerId) {
        return state;
      }
      return endTurn(state, 'outcome', outcome.playerId, now);
    }
    case 'timeout':
      if (!isLiveTurn(state, action.turnId) || action.now < (state.deadline as number)) return state;
      return endTurn(state, 'timeout', null, action.now);
    case 'nextTurn':
      return nextTurn(state, action.turnId, action.now);
    case 'rematchReady':
      if (
        state.phase !== 'finished' ||
        !state.playerIds.includes(action.playerId) ||
        state.rematchReady.includes(action.playerId)
      ) {
        return state;
      }
      return { ...state, rematchReady: [...state.rematchReady, action.playerId] };
    case 'reset':
      return createInitialMatchState(state.rules);
  }
}

function isLiveTurn(state: MatchState, turnId: TurnId): boolean {
  return state.phase === 'activeTurn' && state.turnId === turnId && state.deadline !== null;
}

function start(state: MatchState, action: Extract<MatchAction, { type: 'start' }>): MatchState {
  const { playerIds, firstPlayerId, now } = action;
  if (state.phase !== 'lobby') return state;
  if (playerIds.length < 2 || new Set(playerIds).size !== playerIds.length) return state;
  if (!playerIds.includes(firstPlayerId)) return state;

  const scores: Record<PlayerId, number> = {};
  for (const id of playerIds) scores[id] = 0;

  return {
    ...createInitialMatchState(state.rules),
    matchId: action.matchId,
    phase: 'activeTurn',
    playerIds: [...playerIds],
    scores,
    round: 1,
    turnNumber: 1,
    turnId: action.turnId,
    activePlayerId: firstPlayerId,
    turnStartedAt: now,
    deadline: now + state.rules.turnDurationMs,
  };
}

function endTurn(
  state: MatchState,
  reason: TurnEndReason,
  scorerId: PlayerId | null,
  now: number,
): MatchState {
  const scores = { ...state.scores };
  if (scorerId !== null) scores[scorerId] = (scores[scorerId] ?? 0) + 1;

  const ended: MatchState = {
    ...state,
    scores,
    deadline: null,
    lastTurnResult: {
      turnId: state.turnId as TurnId,
      turnNumber: state.turnNumber,
      round: state.round,
      activePlayerId: state.activePlayerId as PlayerId,
      reason,
      scorerId,
    },
  };

  const { rules } = state;
  const thresholdWinner = state.playerIds.find((id) => (scores[id] ?? 0) >= rules.winThreshold);
  if (thresholdWinner !== undefined) {
    return { ...ended, phase: 'finished', resultUntil: null, winnerId: thresholdWinner, isDraw: false };
  }

  if (state.turnNumber >= totalTurns(rules)) {
    const best = Math.max(...state.playerIds.map((id) => scores[id] ?? 0));
    const leaders = state.playerIds.filter((id) => (scores[id] ?? 0) === best);
    const winnerId = leaders.length === 1 ? (leaders[0] as PlayerId) : null;
    return { ...ended, phase: 'finished', resultUntil: null, winnerId, isDraw: winnerId === null };
  }

  return { ...ended, phase: 'turnResult', resultUntil: now + rules.resultIntervalMs };
}

function nextTurn(state: MatchState, turnId: TurnId, now: number): MatchState {
  if (state.phase !== 'turnResult' || turnId === state.turnId) return state;

  const current = state.playerIds.indexOf(state.activePlayerId as PlayerId);
  const activePlayerId = state.playerIds[(current + 1) % state.playerIds.length] as PlayerId;
  const turnNumber = state.turnNumber + 1;

  return {
    ...state,
    phase: 'activeTurn',
    turnNumber,
    round: roundForTurn(turnNumber, state.rules),
    turnId,
    activePlayerId,
    turnStartedAt: now,
    deadline: now + state.rules.turnDurationMs,
    resultUntil: null,
  };
}

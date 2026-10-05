/**
 * OWNER: Agent 3. Shared pure match engine (turns, rounds, deadlines, scoring, winner, draw).
 * Used authoritatively by the server match controller; GameHost only renders its output.
 * Pure: no timers, no randomness, no I/O. IDs, first player and `now` come in through actions.
 *
 * The signatures below are the agreed contract; replace the reducer body.
 */
import type { MatchRules } from '../games.js';
import type { GameOutcome, MatchId, MatchState, TurnId } from '../match.js';
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

/** Returns the same object reference when the action is rejected/ignored (stale, wrong phase, ...). */
export function matchReducer(state: MatchState, action: MatchAction): MatchState {
  void action;
  // TODO(Agent 3): implement.
  return state;
}

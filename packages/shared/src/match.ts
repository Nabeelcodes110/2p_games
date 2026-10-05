/**
 * CONTRACT (owner: Agent 3). Game-agnostic match state used by the shared engine,
 * the server match controller (Agent 1 integrates) and GameHost (Agent 2 renders).
 * Contains no secrets, so it is safe to send to every player.
 */
import type { MatchRules } from './games.js';
import type { PlayerId } from './room.js';

export type MatchId = string;
export type TurnId = string;

export type MatchPhase = 'lobby' | 'activeTurn' | 'turnResult' | 'finished';

/**
 * Outcome reported by a server game module AFTER it validated the action.
 * Games never advance rounds, award points directly or decide winners.
 */
export type GameOutcome =
  | { type: 'correctGuess'; turnId: TurnId; playerId: PlayerId }
  /**
   * A simultaneous-play round was decided by the game module. `winnerId: null` ends the round
   * with no point (tie / nobody answered).
   */
  | { type: 'roundResult'; turnId: TurnId; winnerId: PlayerId | null };

export type TurnEndReason = 'outcome' | 'timeout';

export interface TurnResult {
  turnId: TurnId;
  turnNumber: number;
  round: number;
  activePlayerId: PlayerId;
  reason: TurnEndReason;
  /** Player who scored this turn, or null on timeout. */
  scorerId: PlayerId | null;
}

export interface MatchState {
  matchId: MatchId | null;
  phase: MatchPhase;
  rules: MatchRules;
  playerIds: PlayerId[];
  scores: Record<PlayerId, number>;
  /** 1-based; 0 before the match starts. */
  round: number;
  /** 1-based overall turn counter; 0 before the match starts. */
  turnNumber: number;
  turnId: TurnId | null;
  /** The drawer in Skribble. */
  activePlayerId: PlayerId | null;
  /** Epoch ms on the server clock. */
  turnStartedAt: number | null;
  /** Epoch ms on the server clock. Actions at or after this instant are rejected. */
  deadline: number | null;
  /** Epoch ms when the turn-result interval ends. */
  resultUntil: number | null;
  lastTurnResult: TurnResult | null;
  winnerId: PlayerId | null;
  isDraw: boolean;
  /** Players who agreed to a rematch while phase === 'finished'. */
  rematchReady: PlayerId[];
}

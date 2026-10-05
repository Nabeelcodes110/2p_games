/**
 * CONTRACT between Agent 1 (room/transport layer) and Agent 3 (match controller + game modules).
 * Change only with agreement from both.
 *
 * Flow: RoomManager owns one MatchController per room while a match exists. Room handlers stay
 * game-agnostic: they check membership, then forward any event listed in the game module's
 * `actionEvents` to `controller.handleAction`. The controller runs the shared matchReducer,
 * owns all timers, and asks the GameSession for player-specific views.
 */
import type {
  AckResult,
  GameActionEvent,
  GameId,
  GameOutcome,
  GameStateSnapshot,
  GameViews,
  MatchId,
  MatchState,
  PlayerId,
  RoomCode,
  ServerToClientEvents,
  TurnId,
} from '@2p/shared';

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];

/** Supplied by Agent 1. Addresses players by server-owned PlayerId, never by client claims. */
export interface MatchTransport {
  sendTo<E extends ServerEventName>(playerId: PlayerId, event: E, payload: ServerEventPayload<E>): void;
  broadcast<E extends ServerEventName>(
    event: E,
    payload: ServerEventPayload<E>,
    options?: { except?: PlayerId },
  ): void;
}

/** Injected so tests can use fake clocks. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TurnContext {
  matchId: MatchId;
  turnId: TurnId;
  activePlayerId: PlayerId;
  playerIds: readonly PlayerId[];
  deadline: number;
  now: number;
}

export interface GameSessionContext {
  matchId: MatchId;
  playerIds: readonly PlayerId[];
  transport: MatchTransport;
  /** Call only after validating the action; the controller feeds it to the engine exactly once. */
  reportOutcome(outcome: GameOutcome): void;
  /** Re-sends player-specific snapshots after a visible change that is not a turn boundary. */
  publishState(): void;
  clock: Clock;
  random(): number;
}

/** Game-specific server logic for one match (e.g. Skribble words, strokes, guesses). */
export interface GameSession<G extends GameId = GameId> {
  startTurn(turn: TurnContext): void;
  /**
   * `match` is the current authoritative state; validate match/turn IDs, phase, role and
   * deadline (reject at or after it) before accepting.
   */
  handleAction(
    playerId: PlayerId,
    event: GameActionEvent,
    payload: unknown,
    match: MatchState,
    now: number,
  ): AckResult<unknown>;
  /**
   * Optional. Called when the turn deadline is reached, before the engine ends the turn as a
   * plain timeout. Games where players answer independently (Colors) return the round outcome
   * here; returning null means the turn simply timed out with no result.
   */
  resolveTimeout?(match: MatchState): GameOutcome | null;
  /** Turn finished (outcome or timeout): reveal, lock input. Called exactly once per turn. */
  endTurn(match: MatchState): void;
  getPlayerView(playerId: PlayerId): GameViews[G];
  dispose(): void;
}

export interface ServerGameModule<G extends GameId = GameId> {
  id: G;
  /** Client events routed to this game by the room layer. */
  actionEvents: readonly GameActionEvent[];
  createSession(ctx: GameSessionContext): GameSession<G>;
}

/** Implemented by Agent 3, created and owned by Agent 1's room layer. */
export interface MatchController {
  readonly gameId: GameId;
  readonly matchId: MatchId;
  /** Starts the first turn and broadcasts game:state. */
  start(): void;
  handleAction(playerId: PlayerId, event: GameActionEvent, payload: unknown): AckResult<unknown>;
  /** When both players are ready, resets all match state and starts a new match. */
  rematchReady(playerId: PlayerId): AckResult;
  snapshotFor(playerId: PlayerId): GameStateSnapshot;
  /** Idempotent. Clears every timer and drawing state. Room layer emits game:aborted. */
  dispose(): void;
}

export interface MatchControllerOptions {
  roomCode: RoomCode;
  gameId: GameId;
  /** Exactly two server-owned player IDs. */
  playerIds: readonly PlayerId[];
  transport: MatchTransport;
  clock?: Clock;
  random?: () => number;
}

export type CreateMatchController = (options: MatchControllerOptions) => MatchController;

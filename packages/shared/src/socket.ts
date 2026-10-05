/**
 * CONTRACT (owner: Agent 1; Skribble events coordinated with Agent 3).
 * TypeScript types are not runtime validation: the server validates every incoming payload.
 */
import type { GameId } from './games.js';
import type { MatchId, MatchState } from './match.js';
import type { RoomSession, RoomSnapshot } from './room.js';
import type {
  ChatMessage,
  ClearEvent,
  ClearInput,
  GuessInput,
  SkribbleView,
  SkribbleWordEvent,
  StrokeBatch,
  StrokeBatchInput,
} from './skribble.js';

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_NAME'
  | 'INVALID_GAME'
  | 'INVALID_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ALREADY_IN_ROOM'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'MATCH_IN_PROGRESS'
  | 'INVALID_PHASE'
  | 'STALE_TURN'
  | 'NOT_ALLOWED'
  | 'DEADLINE_PASSED'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'DISCONNECTED'
  | 'INTERNAL_ERROR';

export interface AppError {
  code: ErrorCode;
  message: string;
}

export type AckResult<T = void> = { ok: true; data: T } | { ok: false; error: AppError };
export type Ack<T = void> = (result: AckResult<T>) => void;

export function ok(): AckResult<void>;
export function ok<T>(data: T): AckResult<T>;
export function ok<T>(data?: T): AckResult<T | undefined> {
  return { ok: true, data };
}

export function fail<T = never>(code: ErrorCode, message: string): AckResult<T> {
  return { ok: false, error: { code, message } };
}

/** Per-game player-specific views. Add an entry when a game is added. */
export interface GameViews {
  skribble: SkribbleView;
}

export type GameStateSnapshot<G extends GameId = GameId> = {
  [K in G]: {
    gameId: K;
    roomCode: string;
    /** Monotonic per match; clients drop older snapshots. */
    revision: number;
    /** Server epoch ms when the snapshot was built; clients derive clock offset from it. */
    serverTime: number;
    match: MatchState;
    view: GameViews[K];
  };
}[G];

export type EmptyPayload = Record<string, never>;

export interface CreateRoomPayload {
  selectedGame: GameId;
  name: string;
}

export interface JoinRoomPayload {
  code: string;
  name: string;
}

export interface GameAbortedEvent {
  matchId: MatchId;
  reason: 'player-left';
  message: string;
}

/** Every client event takes (payload, ack) so the server can validate uniformly. */
export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomPayload, ack: Ack<RoomSession>) => void;
  'room:join': (payload: JoinRoomPayload, ack: Ack<RoomSession>) => void;
  'room:leave': (payload: EmptyPayload, ack: Ack) => void;
  'game:start': (payload: EmptyPayload, ack: Ack) => void;
  'game:rematch-ready': (payload: EmptyPayload, ack: Ack) => void;
  'skribble:stroke': (payload: StrokeBatchInput, ack: Ack<{ seq: number }>) => void;
  'skribble:clear': (payload: ClearInput, ack: Ack<{ seq: number }>) => void;
  'skribble:guess': (payload: GuessInput, ack: Ack<{ correct: boolean }>) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomSnapshot) => void;
  'game:state': (state: GameStateSnapshot) => void;
  'game:aborted': (event: GameAbortedEvent) => void;
  /** Sent only to the drawer. */
  'skribble:word': (event: SkribbleWordEvent) => void;
  /** Relayed to the other player only; the drawer already rendered locally. */
  'skribble:stroke': (batch: StrokeBatch) => void;
  'skribble:clear': (event: ClearEvent) => void;
  /** Incorrect guesses, generic correct-guess notice, and system messages. */
  'skribble:guess-result': (message: ChatMessage) => void;
}

/** Game-specific client events, routed by the game-agnostic room layer to the active game. */
export type GameActionEvent = Extract<keyof ClientToServerEvents, `${GameId}:${string}`>;

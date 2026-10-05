/**
 * CONTRACT (owner: Agent 1). Room/player public snapshots and code rules.
 */
import type { GameId } from './games.js';

export type PlayerId = string;
export type RoomCode = string;

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const MAX_PLAYERS_PER_ROOM = 2;
export const DISPLAY_NAME_MAX_LENGTH = 20;

/** Trim + uppercase. The server applies this before validating against ROOM_CODE_PATTERN. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

export interface PlayerSnapshot {
  id: PlayerId;
  name: string;
  isHost: boolean;
}

/** `playing` while a match exists (active turn, turn result, or finished awaiting rematch). */
export type RoomStatus = 'lobby' | 'playing';

export interface RoomSnapshot {
  code: RoomCode;
  /** Authoritative, immutable for the room's lifetime. */
  gameId: GameId;
  hostId: PlayerId;
  players: PlayerSnapshot[];
  status: RoomStatus;
  /** Monotonic per room; clients drop snapshots older than the one they hold. */
  revision: number;
}

/** Acknowledgement data for room:create and room:join. */
export interface RoomSession {
  room: RoomSnapshot;
  selfId: PlayerId;
}

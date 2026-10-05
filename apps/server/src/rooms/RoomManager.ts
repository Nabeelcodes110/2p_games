// OWNER: Agent 1
// The only room store. In-memory, single process; state is lost on restart.
// Everything here is synchronous: capacity checks and insertion never have an async gap.
import { randomInt, randomUUID } from 'node:crypto';
import {
  MAX_PLAYERS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  fail,
  isValidRoomCode,
  ok,
} from '@2p/shared';
import type {
  AckResult,
  GameActionEvent,
  GameId,
  MatchId,
  PlayerId,
  PlayerSnapshot,
  RoomCode,
  RoomSession,
  RoomSnapshot,
} from '@2p/shared';
import type { CreateMatchController, MatchController, MatchTransport } from '../games/types.js';
import { SERVER_GAMES } from '../games/registry.js';

export interface Player {
  id: PlayerId;
  socketId: string;
  name: string;
}

export interface Room {
  code: RoomCode;
  /** Immutable for the room's lifetime. */
  readonly gameId: GameId;
  hostId: PlayerId;
  players: Player[];
  revision: number;
  /** Present while a match exists; disposed on abort, room deletion or replacement. */
  match: MatchController | null;
}

export interface RoomManagerDeps {
  createController: CreateMatchController;
  /** Builds a transport that addresses players of `room` by PlayerId. */
  createTransport: (room: Room) => MatchTransport;
  /** Injectable for collision tests. Defaults to a crypto-backed generator. */
  generateCode?: () => RoomCode;
  generatePlayerId?: () => PlayerId;
}

export interface LeaveResult {
  roomCode: RoomCode;
  player: Player;
  /** True when the last player left and the room was removed. */
  roomDeleted: boolean;
  /** Set when a running match was aborted by this departure. */
  abortedMatchId: MatchId | null;
  /** Snapshot of the surviving room, or null if it was deleted. */
  room: RoomSnapshot | null;
}

const MAX_CODE_ATTEMPTS = 50;

export function generateRoomCode(): RoomCode {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export class RoomManager {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly socketToRoom = new Map<string, RoomCode>();
  private readonly generateCode: () => RoomCode;
  private readonly generatePlayerId: () => PlayerId;

  constructor(private readonly deps: RoomManagerDeps) {
    this.generateCode = deps.generateCode ?? generateRoomCode;
    this.generatePlayerId = deps.generatePlayerId ?? randomUUID;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomForSocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  getPlayerForSocket(socketId: string): Player | undefined {
    return this.getRoomForSocket(socketId)?.players.find((p) => p.socketId === socketId);
  }

  snapshot(room: Room): RoomSnapshot {
    const players: PlayerSnapshot[] = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
    }));
    return {
      code: room.code,
      gameId: room.gameId,
      hostId: room.hostId,
      players,
      status: room.match ? 'playing' : 'lobby',
      revision: room.revision,
    };
  }

  /** `name` and `gameId` must already be validated/sanitized by the caller. */
  createRoom(socketId: string, gameId: GameId, name: string): AckResult<RoomSession> {
    if (this.socketToRoom.has(socketId)) {
      return fail('ALREADY_IN_ROOM', 'Leave your current room before creating another.');
    }
    const code = this.allocateCode();
    if (!code) return fail('INTERNAL_ERROR', 'Could not allocate a room code. Try again.');

    const player: Player = { id: this.generatePlayerId(), socketId, name };
    const room: Room = {
      code,
      gameId,
      hostId: player.id,
      players: [player],
      revision: 1,
      match: null,
    };
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    return ok({ room: this.snapshot(room), selfId: player.id });
  }

  /** `code` must already be normalized and format-validated. Repeating a join is idempotent. */
  joinRoom(socketId: string, code: RoomCode, name: string): AckResult<RoomSession> {
    const currentCode = this.socketToRoom.get(socketId);
    if (currentCode !== undefined) {
      const current = this.rooms.get(currentCode);
      const self = current?.players.find((p) => p.socketId === socketId);
      if (current && self && current.code === code) {
        return ok({ room: this.snapshot(current), selfId: self.id });
      }
      return fail('ALREADY_IN_ROOM', 'Leave your current room before joining another.');
    }

    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND', 'No room exists with that code.');
    // Capacity check and insertion happen in the same synchronous turn.
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return fail('ROOM_FULL', 'That room is full.');
    }

    const player: Player = { id: this.generatePlayerId(), socketId, name };
    room.players.push(player);
    room.revision += 1;
    this.socketToRoom.set(socketId, code);
    return ok({ room: this.snapshot(room), selfId: player.id });
  }

  /**
   * Explicit leave and disconnect both land here. Idempotent: returns null when the socket
   * has no membership.
   */
  leave(socketId: string): LeaveResult | null {
    const code = this.socketToRoom.get(socketId);
    if (code === undefined) return null;
    this.socketToRoom.delete(socketId);

    const room = this.rooms.get(code);
    const index = room ? room.players.findIndex((p) => p.socketId === socketId) : -1;
    if (!room || index === -1) return null;

    const [player] = room.players.splice(index, 1) as [Player];

    let abortedMatchId: MatchId | null = null;
    if (room.match) {
      abortedMatchId = room.match.matchId;
      this.disposeMatch(room);
    }

    if (room.players.length === 0) {
      this.rooms.delete(code);
      return { roomCode: code, player, roomDeleted: true, abortedMatchId, room: null };
    }

    if (room.hostId === player.id) {
      room.hostId = (room.players[0] as Player).id;
    }
    room.revision += 1;
    return { roomCode: code, player, roomDeleted: false, abortedMatchId, room: this.snapshot(room) };
  }

  /** Validates host/capacity and creates (but does not start) the controller. */
  prepareMatch(socketId: string): AckResult<{ room: Room; controller: MatchController }> {
    const room = this.getRoomForSocket(socketId);
    const player = this.getPlayerForSocket(socketId);
    if (!room || !player) return fail('NOT_IN_ROOM', 'Join a room first.');
    if (room.hostId !== player.id) return fail('NOT_HOST', 'Only the host can start the game.');
    if (room.match) return fail('MATCH_IN_PROGRESS', 'A match is already running.');
    if (room.players.length !== MAX_PLAYERS_PER_ROOM) {
      return fail('NOT_ENOUGH_PLAYERS', 'Two players are needed to start.');
    }

    try {
      const controller = this.deps.createController({
        roomCode: room.code,
        gameId: room.gameId,
        playerIds: room.players.map((p) => p.id),
        transport: this.deps.createTransport(room),
      });
      room.match = controller;
      room.revision += 1;
      return ok({ room, controller });
    } catch (error) {
      console.error('Failed to create match controller', error);
      return fail('INTERNAL_ERROR', 'Could not start the game.');
    }
  }

  /** Disposes a match without removing anyone (e.g. when controller.start() throws). */
  abortMatch(room: Room): void {
    if (!room.match) return;
    this.disposeMatch(room);
    room.revision += 1;
  }

  /** Delegates a game-specific action to the room's controller after membership checks. */
  handleGameAction(socketId: string, event: GameActionEvent, payload: unknown): AckResult<unknown> {
    const room = this.getRoomForSocket(socketId);
    const player = this.getPlayerForSocket(socketId);
    if (!room || !player) return fail('NOT_IN_ROOM', 'Join a room first.');
    if (!SERVER_GAMES[room.gameId].actionEvents.includes(event)) {
      return fail('NOT_ALLOWED', 'That action does not belong to this game.');
    }
    if (!room.match) return fail('INVALID_PHASE', 'No match is running.');
    return guarded(() => (room.match as MatchController).handleAction(player.id, event, payload));
  }

  rematchReady(socketId: string): AckResult {
    const room = this.getRoomForSocket(socketId);
    const player = this.getPlayerForSocket(socketId);
    if (!room || !player) return fail('NOT_IN_ROOM', 'Join a room first.');
    if (!room.match) return fail('INVALID_PHASE', 'No match to rematch.');
    return guarded(() => (room.match as MatchController).rematchReady(player.id));
  }

  /** Server shutdown: dispose every match and forget all rooms. */
  disposeAll(): void {
    for (const room of this.rooms.values()) this.disposeMatch(room);
    this.rooms.clear();
    this.socketToRoom.clear();
  }

  private allocateCode(): RoomCode | null {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = this.generateCode();
      if (isValidRoomCode(code) && !this.rooms.has(code)) return code;
    }
    return null;
  }

  private disposeMatch(room: Room): void {
    const match = room.match;
    room.match = null;
    if (!match) return;
    try {
      match.dispose();
    } catch (error) {
      console.error('Match dispose failed', error);
    }
  }
}

function guarded<T>(run: () => AckResult<T>): AckResult<T> {
  try {
    return run();
  } catch (error) {
    console.error('Game controller threw', error);
    return fail('INTERNAL_ERROR', 'Something went wrong.');
  }
}

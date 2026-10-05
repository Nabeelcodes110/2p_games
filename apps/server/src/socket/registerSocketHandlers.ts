// OWNER: Agent 1
// Game-agnostic transport handlers: room:*, game:start, game:rematch-ready, and delegation of
// game action events (SERVER_GAMES[gameId].actionEvents) to the room's MatchController.
// Identity and room always come from server membership, never from payload claims.
import { fail } from '@2p/shared';
import type { Ack, AckResult, GameActionEvent } from '@2p/shared';
import { SERVER_GAMES } from '../games/registry.js';
import type { CreateMatchController, MatchTransport } from '../games/types.js';
import { createMatchController } from '../match/MatchController.js';
import { RoomManager } from '../rooms/RoomManager.js';
import type { Room } from '../rooms/RoomManager.js';
import { RateLimiter } from './RateLimiter.js';
import type { AppServer, AppSocket } from './types.js';
import { parseCreatePayload, parseJoinPayload } from './validation.js';

export interface SocketHandlerDeps {
  createController?: CreateMatchController;
  now?: () => number;
}

/** Room requests: create/join/leave/start/rematch. */
const ROOM_LIMIT = { max: 10, windowMs: 5_000 };
/** Coarse guard for game actions; Skribble enforces its own stroke/guess limits on top. */
const ACTION_LIMIT = { max: 120, windowMs: 1_000 };

const ALL_GAME_ACTIONS: readonly GameActionEvent[] = [
  ...new Set(Object.values(SERVER_GAMES).flatMap((game) => game.actionEvents)),
];

type LooseListener = (payload: unknown, ack: unknown) => void;
type LooseSocket = { on(event: string, listener: LooseListener): void };

export function registerSocketHandlers(io: AppServer, deps: SocketHandlerDeps = {}): RoomManager {
  const manager = new RoomManager({
    createController: deps.createController ?? createMatchController,
    createTransport: (room) => createTransport(io, room),
  });

  io.on('connection', (socket) => {
    registerConnection(io, socket, manager, deps.now ?? Date.now);
  });

  return manager;
}

function createTransport(io: AppServer, room: Room): MatchTransport {
  // Looks players up on every call so the transport follows membership changes.
  const socketOf = (playerId: string) => room.players.find((p) => p.id === playerId)?.socketId;
  return {
    sendTo(playerId, event, payload) {
      const socketId = socketOf(playerId);
      if (socketId) (io.to(socketId) as unknown as Emitter).emit(event, payload);
    },
    broadcast(event, payload, options) {
      let target = io.to(room.code);
      const exceptSocket = options?.except ? socketOf(options.except) : undefined;
      if (exceptSocket) target = target.except(exceptSocket);
      (target as unknown as Emitter).emit(event, payload);
    },
  };
}

type Emitter = { emit(event: string, payload: unknown): boolean };

function registerConnection(io: AppServer, socket: AppSocket, manager: RoomManager, now: () => number): void {
  const roomLimiter = new RateLimiter(ROOM_LIMIT.max, ROOM_LIMIT.windowMs, now);
  const actionLimiter = new RateLimiter(ACTION_LIMIT.max, ACTION_LIMIT.windowMs, now);
  const loose = socket as unknown as LooseSocket;

  /** Wraps a handler: ignores calls without an ack function, limits rate, never throws. */
  const handle = (
    event: string,
    limiter: RateLimiter,
    run: (payload: unknown) => AckResult<unknown>,
  ): void => {
    loose.on(event, (payload, ack) => {
      if (typeof ack !== 'function') return;
      const reply = ack as Ack<unknown>;
      if (!limiter.allow()) {
        reply(fail('RATE_LIMITED', 'Too many requests. Slow down.'));
        return;
      }
      try {
        reply(run(payload));
      } catch (error) {
        console.error(`Handler for ${event} failed`, error);
        reply(fail('INTERNAL_ERROR', 'Something went wrong.'));
      }
    });
  };

  const publishRoom = (room: Room): void => {
    io.to(room.code).emit('room:state', manager.snapshot(room));
  };

  /** Shared leave/disconnect cleanup. Safe to call repeatedly. */
  const leaveRoom = (): boolean => {
    const result = manager.leave(socket.id);
    if (!result) return false;
    void socket.leave(result.roomCode);
    delete socket.data.playerId;
    delete socket.data.roomCode;
    if (!result.roomDeleted && result.room) {
      if (result.abortedMatchId) {
        io.to(result.roomCode).emit('game:aborted', {
          matchId: result.abortedMatchId,
          reason: 'player-left',
          message: `${result.player.name} left the match. Back to the lobby.`,
        });
      }
      io.to(result.roomCode).emit('room:state', result.room);
    }
    return true;
  };

  handle('room:create', roomLimiter, (payload) => {
    const parsed = parseCreatePayload(payload);
    if (!parsed.ok) return parsed;
    const result = manager.createRoom(socket.id, parsed.data.gameId, parsed.data.name);
    if (result.ok) {
      void socket.join(result.data.room.code);
      socket.data.playerId = result.data.selfId;
      socket.data.roomCode = result.data.room.code;
    }
    return result;
  });

  handle('room:join', roomLimiter, (payload) => {
    const parsed = parseJoinPayload(payload);
    if (!parsed.ok) return parsed;
    const wasMember = manager.getRoomForSocket(socket.id) !== undefined;
    const result = manager.joinRoom(socket.id, parsed.data.code, parsed.data.name);
    if (result.ok) {
      void socket.join(result.data.room.code);
      socket.data.playerId = result.data.selfId;
      socket.data.roomCode = result.data.room.code;
      // A repeated join is idempotent and must not bump or rebroadcast room state.
      if (!wasMember) {
        const room = manager.getRoom(result.data.room.code);
        if (room) publishRoom(room);
      }
    }
    return result;
  });

  handle('room:leave', roomLimiter, () => {
    leaveRoom();
    return { ok: true, data: undefined };
  });

  handle('game:start', roomLimiter, () => {
    const prepared = manager.prepareMatch(socket.id);
    if (!prepared.ok) return prepared;
    const { room, controller } = prepared.data;
    publishRoom(room);
    try {
      controller.start();
    } catch (error) {
      console.error('Match start failed', error);
      manager.abortMatch(room);
      publishRoom(room);
      return fail('INTERNAL_ERROR', 'Could not start the game.');
    }
    return { ok: true, data: undefined };
  });

  handle('game:rematch-ready', roomLimiter, () => manager.rematchReady(socket.id));

  for (const event of ALL_GAME_ACTIONS) {
    handle(event, actionLimiter, (payload) => manager.handleGameAction(socket.id, event, payload));
  }

  socket.on('disconnect', () => {
    leaveRoom();
  });
}

// OWNER: Agent 1
// Game-agnostic transport handlers: room:*, game:start, game:rematch-ready, and delegation of
// game action events (SERVER_GAMES[gameId].actionEvents) to the room's MatchController.
import type { AppServer } from './types.js';

export function registerSocketHandlers(io: AppServer): void {
  io.on('connection', (socket) => {
    // TODO(Agent 1): validate payloads, enforce membership, delegate to RoomManager / MatchController.
    void socket;
  });
}

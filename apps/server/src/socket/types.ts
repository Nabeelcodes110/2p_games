// OWNER: Agent 1
import type { ClientToServerEvents, PlayerId, RoomCode, ServerToClientEvents } from '@2p/shared';
import type { Server, Socket } from 'socket.io';

export interface SocketData {
  playerId?: PlayerId;
  roomCode?: RoomCode;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

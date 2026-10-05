// CONTRACT (Agent 2 owns, Agent 3 consumes). Typed Socket.IO client.
import type { ClientToServerEvents, ServerToClientEvents } from '@2p/shared';
import type { Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

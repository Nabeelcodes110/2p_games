// OWNER: Agent 2
import { io } from 'socket.io-client';
import type { AppSocket } from './types';

export function createSocket(url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'): AppSocket {
  return io(url, { autoConnect: false });
}

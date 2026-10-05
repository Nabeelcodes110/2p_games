import { fail, type Ack, type AckResult } from '@2p/shared';
import type { AppSocket } from './types';

export const ACK_TIMEOUT_MS = 8_000;

/** Promise wrapper for an acknowledged emit. Resolves with a DISCONNECTED/INTERNAL_ERROR failure instead of hanging. */
export function emitAck<T>(socket: AppSocket, run: (ack: Ack<T>) => void): Promise<AckResult<T>> {
  if (!socket.connected) {
    return Promise.resolve(fail<T>('DISCONNECTED', 'Not connected to the server. Check your connection and retry.'));
  }
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fail<T>('INTERNAL_ERROR', 'The server did not respond in time. Please try again.'));
    }, ACK_TIMEOUT_MS);
    run((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });
  });
}

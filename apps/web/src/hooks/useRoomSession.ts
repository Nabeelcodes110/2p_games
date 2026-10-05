// Client-side room session: owns the socket, room membership and request/ack plumbing.
// Holds no game rules. The server's room snapshot is authoritative for who is where.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GAME_CATALOG,
  normalizeRoomCode,
  type AckResult,
  type AppError,
  type GameId,
  type GameStateSnapshot,
  type RoomSession,
  type RoomSnapshot,
} from '@2p/shared';
import { createSocket } from '../socket/client';
import { emitAck } from '../socket/emitAck';
import type { AppSocket } from '../socket/types';

export type PendingAction = 'create' | 'join' | 'start' | 'leave' | null;

export interface RoomSessionApi {
  socket: AppSocket;
  connected: boolean;
  session: RoomSession | null;
  selectedGame: GameId | null;
  setSelectedGame: (game: GameId | null) => void;
  pending: PendingAction;
  error: AppError | null;
  clearError: () => void;
  notice: string | null;
  clearNotice: () => void;
  /** Last game:state received (kept so GameHost can mount without missing the first snapshot). */
  latestGameState: () => GameStateSnapshot | null;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  startGame: () => Promise<void>;
  leaveRoom: () => Promise<void>;
}

export function useRoomSession(): RoomSessionApi {
  const [socket] = useState<AppSocket>(() => createSocket());
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Handlers read the current room through a ref so they never act on a stale closure.
  const roomRef = useRef<RoomSnapshot | null>(null);
  const gameStateRef = useRef<GameStateSnapshot | null>(null);
  const pendingRef = useRef<PendingAction>(null);
  const selectedGameRef = useRef<GameId | null>(null);
  selectedGameRef.current = selectedGame;

  const applySession = useCallback((next: RoomSession | null) => {
    roomRef.current = next?.room ?? null;
    gameStateRef.current = null;
    setSession(next);
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      // The server drops membership on disconnect, so any local room/game state is stale.
      if (roomRef.current) {
        applySession(null);
        setNotice(null);
        setError({
          code: 'DISCONNECTED',
          message: 'Connection lost. You left the room; create or join a room to continue.',
        });
      }
    };
    const onRoomState = (room: RoomSnapshot) => {
      const current = roomRef.current;
      if (!current || room.code !== current.code || room.revision < current.revision) return;
      roomRef.current = room;
      setSession((prev) => (prev ? { ...prev, room } : prev));
    };
    const onGameState = (state: GameStateSnapshot) => {
      if (roomRef.current && state.roomCode === roomRef.current.code) gameStateRef.current = state;
    };
    const onAborted = (event: { message: string }) => {
      gameStateRef.current = null;
      setNotice(event.message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoomState);
    socket.on('game:state', onGameState);
    socket.on('game:aborted', onAborted);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoomState);
      socket.off('game:state', onGameState);
      socket.off('game:aborted', onAborted);
      socket.disconnect();
    };
  }, [socket, applySession]);

  // Run one request at a time so double clicks cannot submit twice.
  const run = useCallback(
    async <T,>(action: Exclude<PendingAction, null>, request: () => Promise<AckResult<T>>) => {
      if (pendingRef.current) return null;
      pendingRef.current = action;
      setPending(action);
      setError(null);
      try {
        const result = await request();
        if (!result.ok) setError(result.error);
        return result;
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [],
  );

  const enter = useCallback(
    (data: RoomSession) => {
      applySession(data);
      const local: GameId | null = selectedGameRef.current;
      const actual: GameId = data.room.gameId;
      const actualName = GAME_CATALOG[actual].name;
      setNotice(
        local && local !== actual
          ? `That room is playing ${actualName}, so your selection was switched to match.`
          : null,
      );
      setSelectedGame(data.room.gameId);
    },
    [applySession],
  );

  const createRoom = useCallback(
    async (name: string) => {
      if (!selectedGame) return;
      const result = await run('create', () =>
        emitAck<RoomSession>(socket, (ack) => socket.emit('room:create', { selectedGame, name }, ack)),
      );
      if (result?.ok) enter(result.data);
    },
    [run, socket, selectedGame, enter],
  );

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      const result = await run('join', () =>
        emitAck<RoomSession>(socket, (ack) =>
          socket.emit('room:join', { code: normalizeRoomCode(code), name }, ack),
        ),
      );
      if (result?.ok) enter(result.data);
    },
    [run, socket, enter],
  );

  const startGame = useCallback(async () => {
    await run('start', () => emitAck<void>(socket, (ack) => socket.emit('game:start', {}, ack)));
  }, [run, socket]);

  const leaveRoom = useCallback(async () => {
    if (!roomRef.current) return;
    const result = await run('leave', () => emitAck<void>(socket, (ack) => socket.emit('room:leave', {}, ack)));
    // Leave locally even when the ack failed; a disconnect removes membership server-side anyway.
    if (result) {
      applySession(null);
      setNotice(null);
      if (!result.ok) setError(null);
    }
  }, [run, socket, applySession]);

  return useMemo(
    () => ({
      socket,
      connected,
      session,
      selectedGame,
      setSelectedGame,
      pending,
      error,
      clearError: () => setError(null),
      notice,
      clearNotice: () => setNotice(null),
      latestGameState: () => gameStateRef.current,
      createRoom,
      joinRoom,
      startGame,
      leaveRoom,
    }),
    [socket, connected, session, selectedGame, pending, error, notice, createRoom, joinRoom, startGame, leaveRoom],
  );
}

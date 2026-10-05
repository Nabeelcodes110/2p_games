// OWNER: Agent 2
// Screen flow: game selection -> room create/join -> lobby -> GameHost -> results.
// The server's room snapshot decides lobby vs game; the only local choice is games vs room form.
import { useState } from 'react';
import { DISPLAY_NAME_MAX_LENGTH } from '@2p/shared';
import { GameHost } from './game-host/GameHost';
import { useRoomSession } from './hooks/useRoomSession';
import { GameSelectScreen } from './screens/GameSelectScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const api = useRoomSession();
  const [name, setName] = useState('');
  const { session, selectedGame } = api;

  if (session) {
    const { room, selfId } = session;
    if (room.status === 'playing') {
      return (
        <GameHost
          // Selection always equals the room's server-owned game once joined.
          selectedGame={room.gameId}
          session={{ socket: api.socket, selfId, room }}
          getLatestState={api.latestGameState}
          onLeave={() => void api.leaveRoom()}
        />
      );
    }
    return (
      <LobbyScreen
        room={room}
        selfId={selfId}
        connected={api.connected}
        pending={api.pending}
        error={api.error}
        notice={api.notice}
        onStart={() => void api.startGame()}
        onLeave={() => void api.leaveRoom()}
      />
    );
  }

  if (!selectedGame) {
    return <GameSelectScreen onSelect={api.setSelectedGame} />;
  }

  const trimmed = name.trim().slice(0, DISPLAY_NAME_MAX_LENGTH);
  return (
    <RoomScreen
      game={selectedGame}
      name={name}
      onNameChange={setName}
      connected={api.connected}
      pending={api.pending}
      error={api.error}
      onClearError={api.clearError}
      onCreate={() => void api.createRoom(trimmed)}
      onJoin={(code) => void api.joinRoom(code, trimmed)}
      onBack={() => {
        api.clearError();
        api.setSelectedGame(null);
      }}
    />
  );
}

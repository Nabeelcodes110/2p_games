import { useEffect, useRef, useState } from 'react';
import { GAME_CATALOG, MAX_PLAYERS_PER_ROOM, type AppError, type RoomSnapshot } from '@2p/shared';
import { GAME_REGISTRY } from '../games/registry';
import { Panel } from '../components/Panel';
import { PixelButton } from '../components/PixelButton';
import { PixelIcon } from '../components/PixelIcon';
import type { PendingAction } from '../hooks/useRoomSession';
import styles from './LobbyScreen.module.scss';
import shared from './screens.module.scss';

interface LobbyScreenProps {
  room: RoomSnapshot;
  selfId: string;
  connected: boolean;
  pending: PendingAction;
  error: AppError | null;
  notice: string | null;
  onStart: () => void;
  onLeave: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / denied clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export function LobbyScreen({ room, selfId, connected, pending, error, notice, onStart, onLeave }: LobbyScreenProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const game = GAME_CATALOG[room.gameId];
  const isHost = room.hostId === selfId;
  const full = room.players.length === MAX_PLAYERS_PER_ROOM;
  const busy = pending !== null;
  const slots = Array.from({ length: MAX_PLAYERS_PER_ROOM }, (_, i) => room.players[i] ?? null);

  const handleCopy = async () => {
    const copied = await copyText(room.code);
    setCopyState(copied ? 'copied' : 'failed');
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <div className={shared.screen}>
      <div className={shared.column}>
        <Panel aria-labelledby="lobby-title">
          <h1 id="lobby-title" className={shared.heading}>
            Lobby
          </h1>

          <div className={shared.gameBadge}>
            <PixelIcon name={GAME_REGISTRY[room.gameId].icon} size={32} />
            <span>
              <span className={shared.gameBadgeLabel}>Game</span>
              <span className={shared.gameBadgeName}>{game.name}</span>
            </span>
          </div>

          {notice && (
            <p className={`${shared.banner} ${shared.bannerInfo}`} role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className={`${shared.banner} ${shared.bannerError}`} role="alert">
              {error.message}
            </p>
          )}
          {!connected && (
            <p className={`${shared.banner} ${shared.bannerError}`} role="alert">
              Disconnected from the server.
            </p>
          )}

          <div className={styles.codeBlock}>
            <div>
              <span className={styles.codeLabel}>Room code</span>
              <span className={styles.codeValue} aria-label={`Room code ${room.code.split('').join(' ')}`}>
                {room.code}
              </span>
            </div>
            <PixelButton onClick={handleCopy}>
              <PixelIcon name={copyState === 'copied' ? 'check' : 'copy'} size={20} />
              {copyState === 'copied' ? 'Copied' : 'Copy code'}
            </PixelButton>
            <span className="visually-hidden" role="status">
              {copyState === 'copied' ? 'Room code copied' : copyState === 'failed' ? 'Copy failed' : ''}
            </span>
          </div>
          {copyState === 'failed' && (
            <p className={`${shared.banner} ${shared.bannerError}`} role="alert">
              Could not copy automatically. Select the code and copy it manually.
            </p>
          )}

          <ul className={styles.players} aria-label="Players">
            {slots.map((player, index) =>
              player ? (
                <li key={player.id} className={`${styles.slot} ${styles.slotFilled}`}>
                  <div className={styles.playerHead}>
                    <span className={styles.avatar}>
                      <PixelIcon name="player" size={40} />
                    </span>
                    <span className={styles.playerName}>{player.name}</span>
                  </div>
                  <div className={styles.tags}>
                    {player.isHost && (
                      <span className={`${styles.tag} ${styles.tagHost}`}>
                        <PixelIcon name="crown" size={16} /> Host
                      </span>
                    )}
                    {player.id === selfId && <span className={styles.tag}>You</span>}
                    <span className={styles.tag}>
                      <span className={`${shared.dot} ${player.id === selfId && !connected ? shared.dotOff : ''}`} />
                      {player.id === selfId && !connected ? 'Disconnected' : 'Connected'}
                    </span>
                  </div>
                </li>
              ) : (
                <li key={`empty-${index}`} className={`${styles.slot} ${styles.slotEmpty}`}>
                  <span className={styles.waitingIcon}>
                    <PixelIcon name="player" size={40} />
                  </span>
                  <span>Empty slot</span>
                </li>
              ),
            )}
          </ul>

          <p className={styles.waiting} role="status">
            {!full
              ? 'Waiting for another player to join…'
              : isHost
                ? 'Both players are here. Start when you are ready.'
                : 'Waiting for the host to start the game…'}
          </p>

          <div className={shared.actions}>
            {isHost && (
              <PixelButton
                variant="grass"
                disabled={!full || busy || !connected}
                onClick={onStart}
                aria-describedby={!full ? 'start-hint' : undefined}
              >
                {pending === 'start' ? 'Starting…' : 'Start game'}
              </PixelButton>
            )}
            <PixelButton variant="danger" onClick={onLeave} disabled={pending === 'leave' || pending === 'start'}>
              Leave room
            </PixelButton>
          </div>
          {isHost && !full && (
            <p id="start-hint" className={shared.hint} style={{ marginTop: 12, marginBottom: 0 }}>
              The game needs exactly two players.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

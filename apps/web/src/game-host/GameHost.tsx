// OWNER: Agent 2
// Mounts the registered game; presents common timer, rounds, scores and results.
// Renders authoritative snapshots only: it never computes scores, rounds or winners.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fail, type AckResult, type AppError, type GameStateSnapshot } from '@2p/shared';
import { GAME_REGISTRY } from '../games/registry';
import type { GameHostProps } from '../games/types';
import { PixelButton } from '../components/PixelButton';
import { ResultsPanel } from './ResultsPanel';
import { fractionLeft, secondsLeft, useNow } from './useServerClock';
import { useMusic } from './useMusic';
import styles from './GameHost.module.scss';

const LOW_TIME_SECONDS = 10;

export function GameHost({ selectedGame, session, music, onLeave, getLatestState }: GameHostProps) {
  const { socket, selfId, room } = session;
  const definition = GAME_REGISTRY[selectedGame];
  const Game = definition.Component;
  const ui = definition.info.ui ?? {};

  const [initial] = useState(() => {
    const cached = getLatestState?.() ?? null;
    return cached && cached.gameId === selectedGame && cached.roomCode === room.code ? cached : null;
  });
  const [state, setState] = useState<GameStateSnapshot | null>(initial);
  const [offsetMs, setOffsetMs] = useState(() => (initial ? initial.serverTime - Date.now() : 0));
  const [rematchPending, setRematchPending] = useState(false);
  const [rematchError, setRematchError] = useState<AppError | null>(null);
  const latest = useRef<GameStateSnapshot | null>(state);
  const getLatestRef = useRef(getLatestState);
  getLatestRef.current = getLatestState;

  // Subscribe with named handlers and remove only ours.
  useEffect(() => {
    const onState = (next: GameStateSnapshot) => {
      if (next.gameId !== selectedGame || next.roomCode !== room.code) return;
      const prev = latest.current;
      // Drop stale snapshots of the same match; a different matchId (rematch) always wins.
      if (prev && prev.match.matchId === next.match.matchId && next.revision < prev.revision) return;
      latest.current = next;
      setOffsetMs(next.serverTime - Date.now());
      setState(next);
    };
    socket.on('game:state', onState);
    // A snapshot that arrived between render and this effect was only cached by the app.
    const cached = getLatestRef.current?.();
    if (cached) onState(cached);
    return () => {
      socket.off('game:state', onState);
    };
  }, [socket, selectedGame, room.code]);

  const match = state?.match ?? null;
  const phase = match?.phase ?? 'lobby';
  const ticking = phase === 'activeTurn' || phase === 'turnResult';
  const now = useNow(ticking);
  const musicControls = useMusic(music);

  const requestRematch = useCallback(() => {
    if (rematchPending) return;
    setRematchPending(true);
    setRematchError(null);
    let settled = false;
    const finish = (result: AckResult<void>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setRematchPending(false);
      if (!result.ok) setRematchError(result.error);
    };
    const timer = window.setTimeout(
      () => finish(fail('INTERNAL_ERROR', 'The server did not respond. Please try again.')),
      8_000,
    );
    if (!socket.connected) {
      finish(fail('DISCONNECTED', 'Not connected to the server.'));
      return;
    }
    socket.emit('game:rematch-ready', {}, finish);
  }, [socket, rematchPending]);

  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? 'Player';

  if (!state || !match || phase === 'lobby') {
    return (
      <main className={styles.host}>
        <div className={styles.frame}>
          <p className={styles.waiting} role="status">
            Preparing {definition.info.name}…
          </p>
        </div>
        <div className={styles.footer}>
          <PixelButton variant="danger" onClick={onLeave}>
            Leave room
          </PixelButton>
        </div>
      </main>
    );
  }

  if (phase === 'finished') {
    return (
      <main className={styles.host}>
        <ResultsPanel
          match={match}
          players={room.players}
          selfId={selfId}
          rematchPending={rematchPending}
          error={rematchError}
          onRematch={requestRematch}
          onLeave={onLeave}
        />
      </main>
    );
  }

  const inTurnResult = phase === 'turnResult';
  const target = inTurnResult ? match.resultUntil : match.deadline;
  const start = inTurnResult ? (match.resultUntil ? match.resultUntil - match.rules.resultIntervalMs : null) : match.turnStartedAt;
  const seconds = secondsLeft(target, now, offsetMs);
  const fraction = fractionLeft(start, target, now, offsetMs);
  const low = !inTurnResult && seconds <= LOW_TIME_SECONDS;
  const result = match.lastTurnResult;

  return (
    <main className={styles.host}>
      <header className={styles.hud}>
        <div className={styles.round}>
          <span className={styles.roundLabel}>
            Round {match.round}/{match.rules.maxRounds}
          </span>
          <span className={styles.turnLabel}>
            {inTurnResult ? 'Round over' : ui.simultaneous ? 'Both players play' : `Up now: ${nameOf(match.activePlayerId)}`}
          </span>
        </div>

        <ul className={styles.scores} aria-label="Scores">
          {match.playerIds.map((id) => (
            <li
              key={id}
              className={`${styles.score} ${!inTurnResult && !ui.simultaneous && id === match.activePlayerId ? styles.scoreActive : ''}`}
            >
              <span className={styles.scoreName}>
                {nameOf(id)}
                {id === selfId ? ' (you)' : ''}
              </span>
              <span className={styles.scoreValue}>{match.scores[id] ?? 0}</span>
            </li>
          ))}
        </ul>

        {!ui.ownTimer && (
        <div className={styles.timer} role="timer" aria-live="off">
          <span className={`${styles.timerValue} ${low ? styles.timerLow : ''}`}>{seconds}s</span>
          <span className={styles.timerCaption}>{inTurnResult ? 'Next turn' : 'Time left'}</span>
          <div className={styles.bar} aria-hidden="true">
            <div
              className={`${styles.barFill} ${low ? styles.barLow : ''}`}
              style={{ transform: `scaleX(${fraction})` }}
            />
          </div>
        </div>
        )}
      </header>

      {inTurnResult && result && (
        <p key={result.turnId} className={styles.banner} role="status">
          {result.scorerId
            ? `${nameOf(result.scorerId)} scored a point!`
            : result.reason === 'timeout'
              ? 'Time’s up! No point this turn.'
              : 'No point this round.'}
        </p>
      )}

      <div className={styles.frame}>
        <Game
          socket={socket}
          selfId={selfId}
          room={room}
          // Same snapshot, narrowed by the registry entry for the selected game.
          state={state as never}
          serverOffsetMs={offsetMs}
        />
      </div>

      <footer className={styles.footer}>
        {musicControls.available ? (
          <div className={styles.music}>
            <PixelButton onClick={musicControls.toggle} aria-pressed={musicControls.playing}>
              {musicControls.playing ? 'Pause music' : 'Play music'}
            </PixelButton>
            <PixelButton onClick={musicControls.toggleMute} aria-pressed={musicControls.muted}>
              {musicControls.muted ? 'Unmute' : 'Mute'}
            </PixelButton>
            <label className="visually-hidden" htmlFor="music-volume">
              Music volume
            </label>
            <input
              id="music-volume"
              className={styles.volume}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={musicControls.volume}
              onChange={(e) => musicControls.setVolume(Number(e.target.value))}
            />
            {musicControls.error && <span role="alert">{musicControls.error}</span>}
          </div>
        ) : (
          <span />
        )}
        <PixelButton variant="danger" onClick={onLeave}>
          Leave match
        </PixelButton>
      </footer>
    </main>
  );
}

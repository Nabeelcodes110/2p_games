import { useMemo } from 'react';
import type { AppError, MatchState, PlayerSnapshot } from '@2p/shared';
import { PixelButton } from '../components/PixelButton';
import { PixelIcon } from '../components/PixelIcon';
import styles from './GameHost.module.scss';

const CONFETTI_COLORS = ['#f2c94c', '#5d8c3e', '#8dc9ee', '#d32f2f', '#f5e8c8', '#79553a'];
const CONFETTI_COUNT = 14; // small, bounded particle burst

interface ResultsPanelProps {
  match: MatchState;
  players: PlayerSnapshot[];
  selfId: string;
  /** True while the rematch request is awaiting its acknowledgement. */
  rematchPending: boolean;
  error: AppError | null;
  onRematch: () => void;
  onLeave: () => void;
}

export function ResultsPanel({ match, players, selfId, rematchPending, error, onRematch, onLeave }: ResultsPanelProps) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Player';
  const youWon = match.winnerId === selfId;
  const iAmReady = match.rematchReady.includes(selfId);
  const othersReady = match.rematchReady.filter((id) => id !== selfId);

  const particles = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2;
        const dist = 90 + (i % 3) * 40;
        return {
          dx: `${Math.round(Math.cos(angle) * dist)}px`,
          dy: `${Math.round(Math.sin(angle) * dist + 60)}px`,
          delay: `${(i % 4) * 60}ms`,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        };
      }),
    [],
  );

  const title = match.isDraw ? 'It’s a draw!' : match.winnerId ? `${nameOf(match.winnerId)} wins!` : 'Match over';
  const subtitle = match.isDraw
    ? 'Scores are level after all rounds.'
    : youWon
      ? 'Great game, you won!'
      : 'Better luck in the rematch.';

  const rematchStatus = iAmReady
    ? 'Waiting for the other player to accept the rematch…'
    : othersReady.length > 0
      ? `${nameOf(othersReady[0] ?? '')} wants a rematch.`
      : '';

  return (
    <section className={styles.results} aria-labelledby="results-title">
      <div className={styles.resultsPanel}>
        {match.winnerId && !match.isDraw && (
          <div className={styles.particles} aria-hidden="true">
            {particles.map((p, i) => (
              <span
                key={i}
                className={styles.particle}
                style={{ '--dx': p.dx, '--dy': p.dy, '--delay': p.delay, '--color': p.color } as React.CSSProperties}
              />
            ))}
          </div>
        )}
        <span className={styles.trophy}>
          <PixelIcon name="crown" size={64} />
        </span>
        <h2 id="results-title" className={styles.resultTitle}>
          {title}
        </h2>
        <p className={styles.resultSub}>{subtitle}</p>

        <ul className={styles.finalScores} aria-label="Final scores">
          {match.playerIds.map((id) => (
            <li key={id} className={`${styles.finalRow} ${id === match.winnerId ? styles.finalRowWinner : ''}`}>
              <span>
                {id === match.winnerId && <PixelIcon name="crown" size={16} />} {nameOf(id)}
                {id === selfId ? ' (you)' : ''}
              </span>
              <span>{match.scores[id] ?? 0}</span>
            </li>
          ))}
        </ul>

        <p className={styles.rematchStatus} role="status">
          {rematchStatus}
        </p>
        {error && (
          <p className={styles.fieldError} role="alert">
            {error.message}
          </p>
        )}
        <div className={styles.actions}>
          <PixelButton variant="grass" onClick={onRematch} disabled={iAmReady || rematchPending}>
            {iAmReady ? 'Ready' : rematchPending ? 'Sending…' : 'Play again'}
          </PixelButton>
          <PixelButton variant="danger" onClick={onLeave}>
            Leave
          </PixelButton>
        </div>
      </div>
    </section>
  );
}

// Colors: memorize the target for 3 s, then lock in the closest color you can within 15 s.
// Renders server snapshots only; the server decides distances, tiebreaks and the round winner.
import { useRef, useState } from 'react';
import type { ColorsPick, ColorsRoundResult, ColorsRoundReason } from '@2p/shared';
import { PixelButton } from '../../components/PixelButton';
import { PixelIcon } from '../../components/PixelIcon';
import { fractionLeft, secondsLeft, useNow } from '../../game-host/useServerClock';
import { emitAck } from '../../socket/emitAck';
import type { GameComponentProps } from '../types';
import { ColorPicker } from './ColorPicker';
import { hexToHsv } from './hsv';
import styles from './ColorsGame.module.scss';

const START_COLOR = '#808080';

export function ColorsGame(props: GameComponentProps<'colors'>) {
  // A new round remounts the component so the picker and local state reset.
  return <ColorsRound key={props.state.match.turnId ?? 'none'} {...props} />;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function reasonText(reason: ColorsRoundReason, winner: string): string {
  switch (reason) {
    case 'closest':
      return `${winner} was closest!`;
    case 'faster':
      return `Same distance, but ${winner} was faster!`;
    case 'forfeit':
      return `${winner} locked in; the other player ran out of time.`;
    case 'tie':
      return 'Dead heat: same color, same time. No point.';
    case 'noAnswer':
      return 'Nobody locked in. No point.';
  }
}

function ColorsRound({ socket, selfId, room, state, serverOffsetMs }: GameComponentProps<'colors'>) {
  const { match, view } = state;
  const [color, setColor] = useState(START_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialHsv = useRef(hexToHsv(START_COLOR));

  const inResult = match.phase === 'turnResult' || view.result !== null;
  const now = useNow(!inResult);
  const serverNow = now + serverOffsetMs;

  const opponentId = match.playerIds.find((id) => id !== selfId) ?? '';
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? 'Player';
  const locked = view.myPick !== null;
  const opponentLocked = view.lockedIn.includes(opponentId);

  const revealing = !inResult && view.pickStartsAt !== null && serverNow < view.pickStartsAt;
  const picking = !inResult && !revealing;

  const submit = async () => {
    if (submitting || locked || !match.matchId || !match.turnId) return;
    setSubmitting(true);
    setError(null);
    const result = await emitAck<{ distance: number }>(socket, (ack) =>
      socket.emit('colors:submit', { matchId: match.matchId as string, turnId: match.turnId as string, color }, ack),
    );
    setSubmitting(false);
    if (!result.ok) setError(result.error.message);
  };

  if (inResult && view.result) {
    return <RoundResult result={view.result} selfId={selfId} nameOf={nameOf} nextAt={match.resultUntil} serverNow={serverNow} />;
  }

  const seconds = revealing
    ? secondsLeft(view.pickStartsAt, now, serverOffsetMs)
    : secondsLeft(match.deadline, now, serverOffsetMs);
  const fraction = revealing
    ? fractionLeft(match.turnStartedAt, view.pickStartsAt, now, serverOffsetMs)
    : fractionLeft(view.pickStartsAt, match.deadline, now, serverOffsetMs);
  const low = picking && seconds <= 5;

  return (
    <section className={styles.game} aria-label="Colors">
      <div className={styles.status}>
        <p className={styles.phase} role="status">
          {revealing ? 'Memorize this color!' : locked ? 'Locked in!' : 'Now match it from memory'}
        </p>
        <div className={styles.timer} role="timer" aria-live="off">
          <span className={`${styles.seconds} ${low ? styles.low : ''}`}>{seconds}s</span>
          <div className={styles.bar} aria-hidden="true">
            <div className={`${styles.barFill} ${low ? styles.barLow : ''}`} style={{ transform: `scaleX(${fraction})` }} />
          </div>
        </div>
      </div>

      <div
        className={`${styles.stage} ${revealing ? styles.stageReveal : styles.stageHidden}`}
        style={revealing && view.target ? { backgroundColor: view.target } : undefined}
        role="img"
        aria-label={revealing && view.target ? `Target color ${view.target}` : 'The target color is hidden'}
      >
        {!revealing && <span className={styles.question}>?</span>}
        {revealing && <span className={styles.count}>{seconds}</span>}
      </div>

      {picking && (
        <div className={styles.pickArea}>
          <ColorPicker initial={initialHsv.current} disabled={locked || submitting} onChange={setColor} />
          <div className={styles.pickSide}>
            <div className={styles.swatchRow}>
              <span
                className={styles.swatch}
                style={{ backgroundColor: locked ? view.myPick?.color : color }}
                role="img"
                aria-label={`${locked ? 'Locked in' : 'Selected'} color ${locked ? view.myPick?.color : color}`}
              />
              <span className={styles.hex}>{locked ? view.myPick?.color : color}</span>
            </div>
            <PixelButton variant="grass" block disabled={locked || submitting} onClick={() => void submit()}>
              {locked ? 'Locked in' : submitting ? 'Locking…' : 'Lock in color'}
            </PixelButton>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <p className={styles.opponent} role="status">
              <PixelIcon name={opponentLocked ? 'check' : 'player'} size={20} />
              {opponentLocked ? `${nameOf(opponentId)} locked in` : `${nameOf(opponentId)} is still choosing…`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function RoundResult({
  result,
  selfId,
  nameOf,
  nextAt,
  serverNow,
}: {
  result: ColorsRoundResult;
  selfId: string;
  nameOf: (id: string) => string;
  nextAt: number | null;
  serverNow: number;
}) {
  const ids = Object.keys(result.picks);
  // Show yourself first, then the opponent.
  const ordered = [...ids].sort((a) => (a === selfId ? -1 : 1));
  const next = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - serverNow) / 1000));

  const card = (title: string, hex: string | null, pick: ColorsPick | null, winner: boolean, key: string) => (
    <li key={key} className={`${styles.card} ${winner ? styles.cardWinner : ''}`}>
      <span className={styles.cardTitle}>
        {winner && <PixelIcon name="crown" size={16} />} {title}
      </span>
      <span
        className={styles.resultSwatch}
        style={hex ? { backgroundColor: hex } : undefined}
        role="img"
        aria-label={hex ? `${title}: ${hex}` : `${title}: no answer`}
      >
        {!hex && <span className={styles.question}>–</span>}
      </span>
      <span className={styles.hex}>{hex ?? 'No answer'}</span>
      {pick && (
        <span className={styles.meta}>
          Difference {pick.distance.toFixed(2)} · {formatSeconds(pick.elapsedMs)}
        </span>
      )}
    </li>
  );

  return (
    <section className={styles.game} aria-label="Round result">
      <p className={styles.phase} role="status">
        {result.winnerId ? reasonText(result.reason, nameOf(result.winnerId)) : reasonText(result.reason, '')}
      </p>
      <ul className={styles.cards}>
        {card('Target', result.target, null, false, 'target')}
        {ordered.map((id) =>
          card(id === selfId ? `${nameOf(id)} (you)` : nameOf(id), result.picks[id]?.color ?? null, result.picks[id] ?? null, result.winnerId === id, id),
        )}
      </ul>
      {next !== null && <p className={styles.next}>Next round in {next}s</p>}
    </section>
  );
}

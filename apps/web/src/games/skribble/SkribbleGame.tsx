// OWNER: Agent 3
// PixiJS canvas, tool palette, guess/chat UI. Mounted by GameHost via GAME_REGISTRY.
// Renders authoritative snapshots; never computes scores, rounds or winners.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SKRIBBLE_LIMITS, SKRIBBLE_PALETTE } from '@2p/shared';
import type { ChatMessage, SkribbleBrushSize, SkribbleColor, SkribbleTool, SkribbleWordEvent } from '@2p/shared';
import type { GameComponentProps } from '../types';
import { CorrectBurst } from './CorrectBurst';
import { GuessPanel } from './GuessPanel';
import type { GuessOutcome } from './GuessPanel';
import { SkribbleCanvas } from './SkribbleCanvas';
import type { SkribbleCanvasHandle } from './SkribbleCanvas';
import { ToolPalette } from './ToolPalette';
import styles from './SkribbleGame.module.scss';

const ACK_TIMEOUT_MS = 8_000;

export function SkribbleGame({ socket, selfId, room, state }: GameComponentProps<'skribble'>) {
  const { match, view } = state;
  const matchId = match.matchId ?? '';
  const turnId = match.turnId ?? '';
  const isActive = match.phase === 'activeTurn';
  const isDrawer = match.activePlayerId === selfId;
  const canDraw = isActive && isDrawer;
  const canGuess = isActive && !isDrawer;

  const [tool, setTool] = useState<SkribbleTool>('pencil');
  const [color, setColor] = useState<SkribbleColor>(SKRIBBLE_PALETTE[0]);
  const [width, setWidth] = useState<SkribbleBrushSize>(6);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [wordEvent, setWordEvent] = useState<SkribbleWordEvent | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const canvasRef = useRef<SkribbleCanvasHandle>(null);

  useEffect(() => {
    const onWord = (event: SkribbleWordEvent) => setWordEvent(event);
    const onMessage = (message: ChatMessage) =>
      setLiveMessages((prev) => [...prev, message].slice(-SKRIBBLE_LIMITS.maxChatMessages));
    socket.on('skribble:word', onWord);
    socket.on('skribble:guess-result', onMessage);
    return () => {
      socket.off('skribble:word', onWord);
      socket.off('skribble:guess-result', onMessage);
    };
  }, [socket]);

  // Stale per-turn UI state never carries into the next turn.
  useEffect(() => {
    setDrawError(null);
  }, [matchId, turnId]);

  const messages = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChatMessage[] = [];
    for (const message of [...view.messages, ...liveMessages]) {
      if (message.matchId !== matchId || seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
    return merged.slice(-SKRIBBLE_LIMITS.maxChatMessages);
  }, [view.messages, liveMessages, matchId]);

  // Only celebrate correct guesses seen live in this turn (not ones replayed from a snapshot).
  const burst = liveMessages.findLast((m) => m.kind === 'correct' && m.matchId === matchId && m.turnId === turnId);

  const word =
    view.word ??
    (canDraw && wordEvent?.matchId === matchId && wordEvent.turnId === turnId ? wordEvent.word : null);

  const nameOf = useCallback(
    (id: string | null) => room.players.find((p) => p.id === id)?.name ?? 'Player',
    [room.players],
  );

  const submitGuess = useCallback(
    (text: string) =>
      new Promise<GuessOutcome>((resolve) => {
        if (!socket.connected) {
          resolve({ ok: false, message: 'Not connected to the server.' });
          return;
        }
        socket.timeout(ACK_TIMEOUT_MS).emit('skribble:guess', { matchId, turnId, text }, (err, result) => {
          if (err) resolve({ ok: false, message: 'The server did not respond. Try again.' });
          else if (!result.ok) resolve({ ok: false, message: result.error.message });
          else resolve({ ok: true, correct: result.data.correct });
        });
      }),
    [socket, matchId, turnId],
  );

  const drawerName = nameOf(match.activePlayerId);

  return (
    <div className={styles.game}>
      <div className={styles.wordBar} aria-live="polite">
        <WordDisplay
          phase={match.phase}
          isDrawer={isDrawer}
          drawerName={drawerName}
          word={word}
          wordLength={view.wordLength}
          revealedWord={view.revealedWord}
          turnKey={`${matchId}:${turnId}`}
        />
      </div>

      <div className={styles.board}>
        <div className={styles.canvasFrame}>
          {matchId && turnId && (
            <SkribbleCanvas
              ref={canvasRef}
              socket={socket}
              matchId={matchId}
              turnId={turnId}
              canDraw={canDraw}
              tool={tool}
              color={color}
              width={width}
              strokes={view.strokes}
              lastSeq={view.lastSeq}
              onError={setDrawError}
            />
          )}
          {burst && <CorrectBurst key={burst.id} />}
        </div>

        {drawError && canDraw && (
          <p className={styles.error} role="alert">
            {drawError}
          </p>
        )}

        {isDrawer && isActive ? (
          <ToolPalette
            tool={tool}
            color={color}
            width={width}
            onTool={setTool}
            onColor={(c) => {
              setColor(c);
              setTool('pencil');
            }}
            onWidth={setWidth}
            onClear={() => canvasRef.current?.clear()}
          />
        ) : (
          <p className={styles.watching}>
            {isActive ? `${drawerName} is drawing…` : 'Drawing is paused.'}
          </p>
        )}
      </div>

      <GuessPanel
        key={matchId}
        messages={messages}
        canGuess={canGuess}
        isDrawer={isDrawer && isActive}
        turnKey={`${matchId}:${turnId}`}
        selfId={selfId}
        nameOf={nameOf}
        onGuess={submitGuess}
      />
    </div>
  );
}

interface WordDisplayProps {
  phase: string;
  isDrawer: boolean;
  drawerName: string;
  word: string | null;
  wordLength: number | null;
  revealedWord: string | null;
  turnKey: string;
}

function WordDisplay({ phase, isDrawer, drawerName, word, wordLength, revealedWord, turnKey }: WordDisplayProps) {
  if (phase === 'turnResult' && revealedWord) {
    return (
      <p key={`reveal-${turnKey}`} className={`${styles.word} ${styles.reveal}`}>
        <span className={styles.wordLabel}>The word was</span>
        <span className={styles.wordText}>{revealedWord}</span>
      </p>
    );
  }
  if (phase !== 'activeTurn') return null;
  if (isDrawer) {
    return (
      <p key={`draw-${turnKey}`} className={styles.word}>
        <span className={styles.wordLabel}>Draw this</span>
        <span className={styles.wordText}>{word ?? '…'}</span>
      </p>
    );
  }
  const length = wordLength ?? 0;
  return (
    <p key={`guess-${turnKey}`} className={styles.word}>
      <span className={styles.wordLabel}>Guess {drawerName}’s word</span>
      <span className={styles.mask} aria-label={`${length} letters`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={styles.maskSlot} aria-hidden="true" />
        ))}
      </span>
      <span className={styles.wordHint}>{length} letters</span>
    </p>
  );
}

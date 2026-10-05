// OWNER: Agent 3
// Guess input + bounded chat log. All user text is rendered as plain text.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SKRIBBLE_LIMITS } from '@2p/shared';
import type { ChatMessage, PlayerId } from '@2p/shared';
import { PixelButton } from '../../components/PixelButton';
import styles from './SkribbleGame.module.scss';

export type GuessOutcome = { ok: true; correct: boolean } | { ok: false; message: string };

interface GuessPanelProps {
  messages: ChatMessage[];
  canGuess: boolean;
  isDrawer: boolean;
  turnKey: string;
  selfId: PlayerId;
  nameOf: (id: PlayerId | null) => string;
  onGuess: (text: string) => Promise<GuessOutcome>;
}

export function GuessPanel({ messages, canGuess, isDrawer, turnKey, selfId, nameOf, onGuess }: GuessPanelProps) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setError(null);
    setText('');
  }, [turnKey]);

  // Keep the newest message visible inside the log without scrolling the page.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const guess = text.trim();
    if (!canGuess || pending || guess.length === 0) return;
    setPending(true);
    setError(null);
    const result = await onGuess(guess);
    setPending(false);
    if (result.ok) {
      setText('');
      inputRef.current?.focus();
    } else {
      setError(result.message);
    }
  };

  const placeholder = isDrawer ? 'You are drawing' : canGuess ? 'Type your guess' : 'Wait for the next turn';

  return (
    <section className={styles.chat} aria-label="Guesses">
      <ol ref={logRef} className={styles.log} role="log" aria-live="polite">
        {messages.length === 0 && <li className={styles.logEmpty}>Guesses appear here.</li>}
        {messages.map((message) => (
          <li key={message.id} className={`${styles.message} ${styles[`message_${message.kind}`] ?? ''}`}>
            {message.kind === 'system' ? (
              message.text
            ) : (
              <>
                <span className={styles.author}>
                  {nameOf(message.playerId)}
                  {message.playerId === selfId ? ' (you)' : ''}
                </span>{' '}
                {message.kind === 'correct' ? 'guessed the word!' : message.text}
              </>
            )}
          </li>
        ))}
      </ol>

      <form className={styles.guessForm} onSubmit={(e) => void submit(e)}>
        <label className="visually-hidden" htmlFor="skribble-guess">
          Your guess
        </label>
        <input
          ref={inputRef}
          id="skribble-guess"
          className={styles.guessInput}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onFocus={(e) => {
            // Keep the input visible above the mobile keyboard.
            const input = e.currentTarget;
            window.setTimeout(() => input.scrollIntoView({ block: 'nearest' }), 250);
          }}
          maxLength={SKRIBBLE_LIMITS.maxGuessLength}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder={placeholder}
          disabled={!canGuess}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'skribble-guess-error' : undefined}
        />
        <PixelButton type="submit" variant="grass" disabled={!canGuess || pending || text.trim().length === 0}>
          {pending ? '…' : 'Guess'}
        </PixelButton>
      </form>
      {error && (
        <p id="skribble-guess-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

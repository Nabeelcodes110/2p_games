import { useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX_LENGTH,
  GAME_CATALOG,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  type AppError,
  type GameId,
} from '@2p/shared';
import { GAME_REGISTRY } from '../games/registry';
import { Panel } from '../components/Panel';
import { PixelButton } from '../components/PixelButton';
import { PixelIcon } from '../components/PixelIcon';
import type { PendingAction } from '../hooks/useRoomSession';
import styles from './screens.module.scss';

interface RoomScreenProps {
  game: GameId;
  name: string;
  onNameChange: (name: string) => void;
  connected: boolean;
  pending: PendingAction;
  error: AppError | null;
  onClearError: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}

const CODE_ERRORS = new Set(['INVALID_CODE', 'ROOM_NOT_FOUND', 'ROOM_FULL']);

/** Second screen: display name plus create-room / join-room, shown as a crafting panel. */
export function RoomScreen({
  game,
  name,
  onNameChange,
  connected,
  pending,
  error,
  onClearError,
  onCreate,
  onJoin,
  onBack,
}: RoomScreenProps) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<{ field: 'name' | 'code'; message: string } | null>(null);
  const busy = pending !== null;

  const nameError =
    localError?.field === 'name' ? localError.message : error?.code === 'INVALID_NAME' ? error.message : null;
  const codeError =
    localError?.field === 'code' ? localError.message : error && CODE_ERRORS.has(error.code) ? error.message : null;
  const generalError = error && error.code !== 'INVALID_NAME' && !CODE_ERRORS.has(error.code) ? error : null;

  const checkName = (): boolean => {
    if (name.trim().length === 0) {
      setLocalError({ field: 'name', message: 'Enter a display name.' });
      return false;
    }
    return true;
  };

  const handleCreate = () => {
    setLocalError(null);
    if (checkName()) onCreate();
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!checkName()) return;
    const normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) {
      setLocalError({ field: 'code', message: `Room codes are ${ROOM_CODE_LENGTH} letters or numbers.` });
      return;
    }
    onJoin(normalized);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <Panel aria-labelledby="room-title">
          <h1 id="room-title" className={styles.heading}>
            Crafting table
          </h1>
          <p className={styles.hint}>Make a room and share its code, or join a friend&apos;s room.</p>

          <div className={styles.gameBadge}>
            <PixelIcon name={GAME_REGISTRY[game].icon} size={32} />
            <span>
              <span className={styles.gameBadgeLabel}>Selected game</span>
              <span className={styles.gameBadgeName}>{GAME_CATALOG[game].name}</span>
            </span>
          </div>

          {!connected && (
            <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
              Connecting to the server&hellip;
            </p>
          )}
          {generalError && (
            <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
              {generalError.message}
            </p>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="display-name">
              Display name
            </label>
            <input
              id="display-name"
              className={styles.input}
              value={name}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="nickname"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'name-error' : undefined}
              onChange={(e) => {
                onNameChange(e.target.value);
                setLocalError(null);
                onClearError();
              }}
            />
            {nameError && (
              <span id="name-error" className={styles.fieldError} role="alert">
                {nameError}
              </span>
            )}
          </div>

          <PixelButton variant="grass" block disabled={busy || !connected} onClick={handleCreate}>
            {pending === 'create' ? 'Creating…' : 'Create room'}
          </PixelButton>

          <div className={styles.divider} aria-hidden="true">
            or
          </div>

          <form onSubmit={handleJoin} noValidate>
            <div className={styles.joinRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="room-code">
                  Room code
                </label>
                <input
                  id="room-code"
                  className={`${styles.input} ${styles.code}`}
                  value={code}
                  maxLength={ROOM_CODE_LENGTH + 4}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABC123"
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby={codeError ? 'code-error' : undefined}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setLocalError(null);
                    onClearError();
                  }}
                />
                {codeError && (
                  <span id="code-error" className={styles.fieldError} role="alert">
                    {codeError}
                  </span>
                )}
              </div>
              <PixelButton type="submit" variant="gold" disabled={busy || !connected}>
                {pending === 'join' ? 'Joining…' : 'Join room'}
              </PixelButton>
            </div>
          </form>
        </Panel>

        <div className={styles.actions}>
          <PixelButton onClick={onBack} disabled={busy}>
            <PixelIcon name="back" size={20} /> Back to games
          </PixelButton>
        </div>
      </div>
    </div>
  );
}

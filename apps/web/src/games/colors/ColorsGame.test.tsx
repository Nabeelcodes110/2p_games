import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createInitialMatchState,
  GAME_CATALOG,
  type ColorsView,
  type GameStateSnapshot,
  type MatchState,
  type RoomSnapshot,
} from '@2p/shared';
import type { AppSocket } from '../../socket/types';
import { ColorsGame } from './ColorsGame';
import { hexToHsv, hsvToHex } from './hsv';

const room: RoomSnapshot = {
  code: 'ABC123',
  gameId: 'colors',
  hostId: 'p1',
  players: [
    { id: 'p1', name: 'Alex', isHost: true },
    { id: 'p2', name: 'Sam', isHost: false },
  ],
  status: 'playing',
  revision: 1,
};

function snapshot(view: Partial<ColorsView>, match: Partial<MatchState> = {}): GameStateSnapshot<'colors'> {
  const start = Date.now();
  return {
    gameId: 'colors',
    roomCode: 'ABC123',
    revision: 1,
    serverTime: start,
    match: {
      ...createInitialMatchState(GAME_CATALOG.colors.rules),
      matchId: 'm1',
      phase: 'activeTurn',
      playerIds: ['p1', 'p2'],
      scores: { p1: 0, p2: 0 },
      round: 1,
      turnNumber: 1,
      turnId: 't1',
      turnStartedAt: start,
      deadline: start + 18_000,
      ...match,
    },
    view: { target: null, pickStartsAt: null, lockedIn: [], myPick: null, result: null, ...view },
  };
}

function mount(state: GameStateSnapshot<'colors'>) {
  const emit = vi.fn();
  const socket = { connected: true, emit } as unknown as AppSocket;
  render(<ColorsGame socket={socket} selfId="p1" room={room} state={state} serverOffsetMs={0} />);
  return { emit };
}

describe('ColorsGame', () => {
  it('shows the target during the memorize window and no picker yet', () => {
    const now = Date.now();
    mount(snapshot({ target: '#336699', pickStartsAt: now + 3_000 }));
    expect(screen.getByRole('img', { name: 'Target color #336699' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lock in/ })).toBeNull();
  });

  it('hides the target while picking and submits the chosen color once', async () => {
    const now = Date.now();
    const { emit } = mount(snapshot({ pickStartsAt: now - 1_000 }));
    expect(screen.getByRole('img', { name: 'The target color is hidden' })).toBeTruthy();
    expect(screen.queryByText('#336699')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Lock in color' }));
    expect(emit).toHaveBeenCalledWith(
      'colors:submit',
      { matchId: 'm1', turnId: 't1', color: '#808080' },
      expect.any(Function),
    );
  });

  it('lets the keyboard change the color and shows locked-in state from the server', () => {
    const now = Date.now();
    mount(
      snapshot({
        pickStartsAt: now - 1_000,
        lockedIn: ['p1', 'p2'],
        myPick: { color: '#112233', distance: 4, elapsedMs: 2000 },
      }),
    );
    expect(screen.getByRole('button', { name: 'Locked in' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Sam locked in')).toBeTruthy();
  });

  it('renders the round result with both picks and the winner', () => {
    mount(
      snapshot(
        {
          target: '#336699',
          result: {
            turnId: 't1',
            target: '#336699',
            winnerId: 'p2',
            reason: 'closest',
            picks: {
              p1: { color: '#FF0000', distance: 60, elapsedMs: 4000 },
              p2: { color: '#346699', distance: 0.5, elapsedMs: 9000 },
            },
          },
        },
        { phase: 'turnResult', deadline: null, resultUntil: Date.now() + 5_000 },
      ),
    );
    expect(screen.getByText('Sam was closest!')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Sam: #346699' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Alex (you): #FF0000' })).toBeTruthy();
  });

  it('says so when a round is a tie or unanswered', () => {
    mount(
      snapshot(
        {
          target: '#336699',
          result: { turnId: 't1', target: '#336699', winnerId: null, reason: 'noAnswer', picks: { p1: null, p2: null } },
        },
        { phase: 'turnResult', deadline: null, resultUntil: Date.now() + 5_000 },
      ),
    );
    expect(screen.getByText('Nobody locked in. No point.')).toBeTruthy();
  });
});

describe('hsv helpers', () => {
  it('round-trips colors', () => {
    for (const hex of ['#336699', '#FF0000', '#00FF00', '#0000FF', '#808080', '#FFFFFF', '#000000', '#A1B2C3']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});

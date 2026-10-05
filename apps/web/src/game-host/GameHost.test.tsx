import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialMatchState, GAME_CATALOG, type GameStateSnapshot, type MatchState, type RoomSnapshot } from '@2p/shared';
import { GameHost } from './GameHost';
import type { AppSocket } from '../socket/types';

const room: RoomSnapshot = {
  code: 'ABC123',
  gameId: 'skribble',
  hostId: 'p1',
  players: [
    { id: 'p1', name: 'Alex', isHost: true },
    { id: 'p2', name: 'Sam', isHost: false },
  ],
  status: 'playing',
  revision: 1,
};

function snapshot(revision: number, match: Partial<MatchState>): GameStateSnapshot {
  return {
    gameId: 'skribble',
    roomCode: 'ABC123',
    revision,
    serverTime: Date.now(),
    match: {
      ...createInitialMatchState(GAME_CATALOG.skribble.rules),
      matchId: 'm1',
      playerIds: ['p1', 'p2'],
      scores: { p1: 0, p2: 0 },
      ...match,
    },
    view: { word: null, wordLength: null, revealedWord: null, strokes: [], lastSeq: 0, messages: [] },
  };
}

function fakeSocket() {
  const handlers = new Map<string, Set<(...args: never[]) => void>>();
  const emit = vi.fn();
  const socket = {
    connected: true,
    on: (event: string, fn: (...args: never[]) => void) => {
      handlers.set(event, (handlers.get(event) ?? new Set()).add(fn));
    },
    off: (event: string, fn: (...args: never[]) => void) => handlers.get(event)?.delete(fn),
    emit,
  } as unknown as AppSocket;
  const fire = (event: string, payload: unknown) =>
    act(() => handlers.get(event)?.forEach((fn) => (fn as (p: unknown) => void)(payload)));
  return { socket, emit, fire, count: (event: string) => handlers.get(event)?.size ?? 0 };
}

const active = (scoreP1: number) => ({
  phase: 'activeTurn' as const,
  round: 2,
  turnNumber: 3,
  turnId: 't3',
  activePlayerId: 'p2',
  turnStartedAt: Date.now(),
  deadline: Date.now() + 60_000,
  scores: { p1: scoreP1, p2: 0 },
});

describe('GameHost', () => {
  afterEach(cleanup);

  it('renders round, scores and drawer from the server snapshot and ignores stale revisions', () => {
    const { socket, fire } = fakeSocket();
    render(<GameHost selectedGame="skribble" session={{ socket, selfId: 'p1', room }} onLeave={() => {}} />);
    expect(screen.getByText(/Preparing/)).toBeTruthy();

    fire('game:state', snapshot(5, active(2)));
    expect(screen.getByText('Round 2/5')).toBeTruthy();
    expect(screen.getByText('Up now: Sam')).toBeTruthy();
    expect(screen.getByLabelText('Scores').textContent).toContain('2');

    fire('game:state', snapshot(4, active(0))); // stale: must not override
    expect(screen.getByLabelText('Scores').textContent).toContain('2');
  });

  it('picks up a snapshot that arrived before it subscribed', () => {
    const { socket } = fakeSocket();
    // Empty when GameHost renders; filled (by the app's listener) before its effect subscribes.
    let reads = 0;
    const getLatestState = () => (reads++ === 0 ? null : snapshot(1, active(0)));
    render(
      <GameHost selectedGame="skribble" session={{ socket, selfId: 'p1', room }} getLatestState={getLatestState} onLeave={() => {}} />,
    );
    expect(reads).toBeGreaterThan(1);
    expect(screen.getByText('Round 2/5')).toBeTruthy();
  });

  it('reads a cached snapshot on mount', () => {
    const { socket } = fakeSocket();
    render(
      <GameHost
        selectedGame="skribble"
        session={{ socket, selfId: 'p1', room }}
        getLatestState={() => snapshot(1, active(0))}
        onLeave={() => {}}
      />,
    );
    expect(screen.getByText('Round 2/5')).toBeTruthy();
  });

  it('shows the winner, and requires explicit rematch consent', async () => {
    const { socket, emit, fire } = fakeSocket();
    render(<GameHost selectedGame="skribble" session={{ socket, selfId: 'p1', room }} onLeave={() => {}} />);
    fire(
      'game:state',
      snapshot(9, { phase: 'finished', winnerId: 'p2', scores: { p1: 3, p2: 5 }, rematchReady: [] }),
    );
    expect(screen.getByText('Sam wins!')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(emit).toHaveBeenCalledWith('game:rematch-ready', {}, expect.any(Function));
  });

  it('shows a draw and removes only its own socket listener on unmount', () => {
    const { socket, fire, count } = fakeSocket();
    const view = render(<GameHost selectedGame="skribble" session={{ socket, selfId: 'p1', room }} onLeave={() => {}} />);
    expect(count('game:state')).toBe(1);
    fire('game:state', snapshot(2, { phase: 'finished', isDraw: true, scores: { p1: 4, p2: 4 } }));
    expect(screen.getByText('It’s a draw!')).toBeTruthy();
    view.unmount();
    expect(count('game:state')).toBe(0);
  });
});

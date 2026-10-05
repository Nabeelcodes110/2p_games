import { describe, expect, it } from 'vitest';
import { ROOM_CODE_PATTERN } from '@2p/shared';
import { fakeControllerFactory, noopTransport } from '../test/fakes.js';
import { RoomManager, generateRoomCode } from './RoomManager.js';
import type { RoomManagerDeps } from './RoomManager.js';

function setup(overrides: Partial<RoomManagerDeps> = {}) {
  const { factory, created } = fakeControllerFactory();
  let n = 0;
  const manager = new RoomManager({
    createController: factory,
    createTransport: () => noopTransport,
    generatePlayerId: () => `p${(n += 1)}`,
    ...overrides,
  });
  return { manager, created };
}

function filled() {
  const ctx = setup();
  const created = ctx.manager.createRoom('s1', 'skribble', 'Alex');
  if (!created.ok) throw new Error('create failed');
  const code = created.data.room.code;
  const joined = ctx.manager.joinRoom('s2', code, 'Sam');
  if (!joined.ok) throw new Error('join failed');
  return { ...ctx, code };
}

describe('room codes', () => {
  it('generates six uppercase alphanumeric characters', () => {
    for (let i = 0; i < 200; i += 1) expect(generateRoomCode()).toMatch(ROOM_CODE_PATTERN);
  });

  it('retries on collision with an existing room', () => {
    const codes = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
    const { manager } = setup({ generateCode: () => codes.shift() ?? 'ZZZZZZ' });
    const first = manager.createRoom('s1', 'skribble', 'A');
    const second = manager.createRoom('s2', 'skribble', 'B');
    expect(first.ok && first.data.room.code).toBe('AAAAAA');
    expect(second.ok && second.data.room.code).toBe('BBBBBB');
  });

  it('fails cleanly when no free code can be found', () => {
    const { manager } = setup({ generateCode: () => 'AAAAAA' });
    manager.createRoom('s1', 'skribble', 'A');
    const result = manager.createRoom('s2', 'skribble', 'B');
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(manager.roomCount).toBe(1);
  });
});

describe('create and join', () => {
  it('creates a room with the creator as host and the server-owned game', () => {
    const { manager } = setup();
    const result = manager.createRoom('s1', 'skribble', 'Alex');
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.room).toMatchObject({
      gameId: 'skribble',
      hostId: result.data.selfId,
      status: 'lobby',
      revision: 1,
    });
    expect(result.data.room.players).toEqual([{ id: result.data.selfId, name: 'Alex', isHost: true }]);
  });

  it('rejects a third player and keeps two players', () => {
    const { manager, code } = filled();
    const third = manager.joinRoom('s3', code, 'Third');
    expect(third).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
    expect(manager.getRoom(code)?.players).toHaveLength(2);
    expect(manager.getRoomForSocket('s3')).toBeUndefined();
  });

  it('admits only one of several simultaneous joins to a one-seat room', () => {
    const { manager } = setup();
    const created = manager.createRoom('host', 'skribble', 'Host');
    if (!created.ok) throw new Error('expected ok');
    const code = created.data.room.code;
    const results = ['a', 'b', 'c', 'd'].map((id) => manager.joinRoom(id, code, id));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === 'ROOM_FULL')).toHaveLength(3);
    expect(manager.getRoom(code)?.players).toHaveLength(2);
  });

  it('reports unknown rooms', () => {
    const { manager } = setup();
    expect(manager.joinRoom('s1', 'ZZZZZZ', 'A')).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
  });

  it('allows one room per socket for create and join', () => {
    const { manager, code } = filled();
    expect(manager.createRoom('s1', 'skribble', 'Alex')).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_IN_ROOM' },
    });
    const other = manager.createRoom('s9', 'skribble', 'Other');
    if (!other.ok) throw new Error('expected ok');
    expect(manager.joinRoom('s1', other.data.room.code, 'Alex')).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_IN_ROOM' },
    });
    expect(manager.getRoomForSocket('s1')?.code).toBe(code);
  });

  it('treats a repeated join of the current room as idempotent', () => {
    const { manager, code } = filled();
    const revision = manager.getRoom(code)?.revision;
    const again = manager.joinRoom('s2', code, 'Sam');
    expect(again.ok && again.data.selfId).toBe('p2');
    expect(manager.getRoom(code)?.players).toHaveLength(2);
    expect(manager.getRoom(code)?.revision).toBe(revision);
  });

  it('bumps the revision on every membership change', () => {
    const { manager, code } = filled();
    expect(manager.getRoom(code)?.revision).toBe(2);
    manager.leave('s2');
    expect(manager.getRoom(code)?.revision).toBe(3);
  });
});

describe('leave and disconnect', () => {
  it('removes the player, transfers host, and is idempotent', () => {
    const { manager, code } = filled();
    const result = manager.leave('s1');
    expect(result).toMatchObject({ roomDeleted: false, room: { hostId: 'p2' } });
    expect(result?.room?.players).toEqual([{ id: 'p2', name: 'Sam', isHost: true }]);
    expect(manager.getRoomForSocket('s1')).toBeUndefined();
    expect(manager.leave('s1')).toBeNull();
    expect(manager.getRoom(code)).toBeDefined();
  });

  it('keeps the host when the non-host leaves', () => {
    const { manager } = filled();
    expect(manager.leave('s2')?.room?.hostId).toBe('p1');
  });

  it('deletes an empty room', () => {
    const { manager, code } = filled();
    manager.leave('s1');
    const last = manager.leave('s2');
    expect(last).toMatchObject({ roomDeleted: true, room: null });
    expect(manager.getRoom(code)).toBeUndefined();
    expect(manager.roomCount).toBe(0);
  });

  it('lets a socket join a new room after leaving', () => {
    const { manager } = filled();
    manager.leave('s2');
    const other = manager.createRoom('s9', 'skribble', 'Other');
    if (!other.ok) throw new Error('expected ok');
    expect(manager.joinRoom('s2', other.data.room.code, 'Sam').ok).toBe(true);
  });
});

describe('match lifecycle', () => {
  it('only the host can start, and only with exactly two players', () => {
    const { manager } = setup();
    const r = manager.createRoom('s1', 'skribble', 'A');
    if (!r.ok) throw new Error('expected ok');
    const code = r.data.room.code;
    expect(manager.prepareMatch('s1')).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_PLAYERS' } });
    manager.joinRoom('s2', code, 'B');
    expect(manager.prepareMatch('s2')).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(manager.prepareMatch('nobody')).toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
    expect(manager.prepareMatch('s1').ok).toBe(true);
  });

  it('creates the controller with server-owned player ids and rejects a second start', () => {
    const { manager, created } = filled();
    const prepared = manager.prepareMatch('s1');
    if (!prepared.ok) throw new Error('expected ok');
    expect(created).toHaveLength(1);
    expect(created[0]?.options.playerIds).toEqual(['p1', 'p2']);
    expect(created[0]?.options.gameId).toBe('skribble');
    expect(manager.snapshot(prepared.data.room).status).toBe('playing');
    expect(manager.prepareMatch('s1')).toMatchObject({ ok: false, error: { code: 'MATCH_IN_PROGRESS' } });
  });

  it('aborts and disposes the match when a player leaves, returning to the lobby', () => {
    const { manager, created, code } = filled();
    manager.prepareMatch('s1');
    const result = manager.leave('s2');
    expect(created[0]?.disposeCount).toBe(1);
    expect(result?.abortedMatchId).toBe('match-1');
    expect(result?.room?.status).toBe('lobby');
    expect(manager.getRoom(code)?.match).toBeNull();
  });

  it('disposes the match when the room is emptied', () => {
    const { manager, created } = filled();
    manager.prepareMatch('s1');
    manager.leave('s1');
    manager.leave('s2');
    expect(created[0]?.disposeCount).toBe(1);
  });

  it('abortMatch disposes once and is idempotent', () => {
    const { manager, created } = filled();
    const prepared = manager.prepareMatch('s1');
    if (!prepared.ok) throw new Error('expected ok');
    manager.abortMatch(prepared.data.room);
    manager.abortMatch(prepared.data.room);
    expect(created[0]?.disposeCount).toBe(1);
  });

  it('disposeAll disposes every running match', () => {
    const { manager, created } = filled();
    manager.prepareMatch('s1');
    manager.disposeAll();
    expect(created[0]?.disposeCount).toBe(1);
    expect(manager.roomCount).toBe(0);
  });

  it('reports a controller construction failure without leaving a match behind', () => {
    const { manager } = setup({
      createController: () => {
        throw new Error('boom');
      },
    });
    const r = manager.createRoom('s1', 'skribble', 'A');
    if (!r.ok) throw new Error('expected ok');
    manager.joinRoom('s2', r.data.room.code, 'B');
    expect(manager.prepareMatch('s1')).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(manager.getRoom(r.data.room.code)?.match).toBeNull();
  });
});

describe('delegation to the controller', () => {
  it('forwards game actions with the server-derived player id', () => {
    const { manager, created } = filled();
    manager.prepareMatch('s1');
    const result = manager.handleGameAction('s2', 'skribble:guess', { text: 'cat' });
    expect(result.ok).toBe(true);
    expect(created[0]?.actions[0]).toMatchObject({ playerId: 'p2', event: 'skribble:guess' });
  });

  it('rejects actions from sockets outside the room or before a match', () => {
    const { manager } = filled();
    expect(manager.handleGameAction('s3', 'skribble:guess', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
    expect(manager.handleGameAction('s1', 'skribble:guess', {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PHASE' },
    });
  });

  it('rejects events that do not belong to the room game', () => {
    const { manager } = filled();
    manager.prepareMatch('s1');
    expect(manager.handleGameAction('s1', 'other:thing' as never, {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
  });

  it('converts controller exceptions to INTERNAL_ERROR', () => {
    const { manager, created } = filled();
    manager.prepareMatch('s1');
    (created[0] as { handleAction: unknown }).handleAction = () => {
      throw new Error('boom');
    };
    expect(manager.handleGameAction('s1', 'skribble:stroke', {})).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('forwards rematch consent per player', () => {
    const { manager, created } = filled();
    expect(manager.rematchReady('s1')).toMatchObject({ ok: false, error: { code: 'INVALID_PHASE' } });
    manager.prepareMatch('s1');
    manager.rematchReady('s1');
    manager.rematchReady('s2');
    expect(created[0]?.rematchCalls).toEqual(['p1', 'p2']);
  });
});

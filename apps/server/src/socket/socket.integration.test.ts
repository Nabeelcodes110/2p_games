// Real Socket.IO server + clients over loopback, with a fake match controller.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AckResult, ClientToServerEvents, RoomSession, RoomSnapshot, ServerToClientEvents } from '@2p/shared';
import { fakeControllerFactory } from '../test/fakes.js';
import type { FakeController } from '../test/fakes.js';
import { registerSocketHandlers } from './registerSocketHandlers.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { AppServer } from './types.js';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: ReturnType<typeof createServer>;
let io: AppServer;
let manager: RoomManager;
let controllers: FakeController[];
let clients: Client[];

beforeEach(async () => {
  httpServer = createServer();
  io = new Server(httpServer);
  const fakes = fakeControllerFactory();
  controllers = fakes.created;
  manager = registerSocketHandlers(io, { createController: fakes.factory });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.disconnect();
  await io.close();
});

async function newClient(): Promise<Client> {
  const { port } = httpServer.address() as AddressInfo;
  const client: Client = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(client);
  await new Promise<void>((resolve) => client.on('connect', resolve));
  return client;
}

/** Sends an event with a raw payload (bypassing client typing) and resolves with the ack. */
function call<T = unknown>(client: Client, event: string, payload: unknown): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    (client as unknown as { emit(e: string, p: unknown, a: (r: AckResult<T>) => void): void }).emit(event, payload, resolve);
  });
}

function nextEvent<T>(client: Client, event: string): Promise<T> {
  return new Promise((resolve) => {
    (client as unknown as { once(e: string, l: (p: T) => void): void }).once(event, resolve);
  });
}

async function pair(): Promise<{ host: Client; guest: Client; code: string }> {
  const host = await newClient();
  const guest = await newClient();
  const created = await call<RoomSession>(host, 'room:create', { selectedGame: 'skribble', name: 'Alex' });
  if (!created.ok) throw new Error('create failed');
  const code = created.data.room.code;
  const joined = await call<RoomSession>(guest, 'room:join', { code: code.toLowerCase(), name: 'Sam' });
  if (!joined.ok) throw new Error('join failed');
  return { host, guest, code };
}

describe('room flow over sockets', () => {
  it('creates, joins (code trimmed and uppercased) and broadcasts room state', async () => {
    const host = await newClient();
    const guest = await newClient();
    const created = await call<RoomSession>(host, 'room:create', { selectedGame: 'skribble', name: ' Alex ' });
    if (!created.ok) throw new Error('create failed');
    expect(created.data.room.players[0]?.name).toBe('Alex');

    const broadcast = nextEvent<RoomSnapshot>(host, 'room:state');
    const joined = await call<RoomSession>(guest, 'room:join', {
      code: `  ${created.data.room.code.toLowerCase()} `,
      name: 'Sam',
    });
    expect(joined.ok).toBe(true);
    const state = await broadcast;
    expect(state.players.map((p) => p.name)).toEqual(['Alex', 'Sam']);
  });

  it('rejects invalid payloads with inline-friendly error codes', async () => {
    const c = await newClient();
    expect(await call(c, 'room:create', { selectedGame: 'chess', name: 'A' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_GAME' },
    });
    expect(await call(c, 'room:create', { selectedGame: 'skribble', name: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NAME' },
    });
    expect(await call(c, 'room:create', 'nope')).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(await call(c, 'room:join', { code: 'abc', name: 'A' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CODE' },
    });
    expect(await call(c, 'room:join', { code: 'ZZZZZZ', name: 'A' })).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
    expect(manager.roomCount).toBe(0);
  });

  it('rejects a third socket with ROOM_FULL', async () => {
    const { code } = await pair();
    const third = await newClient();
    expect(await call(third, 'room:join', { code, name: 'Third' })).toMatchObject({
      ok: false,
      error: { code: 'ROOM_FULL' },
    });
  });

  it('start is host-only and needs two players; then the controller starts', async () => {
    const host = await newClient();
    const created = await call<RoomSession>(host, 'room:create', { selectedGame: 'skribble', name: 'Alex' });
    if (!created.ok) throw new Error('create failed');
    expect(await call(host, 'game:start', {})).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_PLAYERS' } });

    const guest = await newClient();
    await call(guest, 'room:join', { code: created.data.room.code, name: 'Sam' });
    expect(await call(guest, 'game:start', {})).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });

    const state = nextEvent<RoomSnapshot>(guest, 'room:state');
    expect((await call(host, 'game:start', {})).ok).toBe(true);
    expect((await state).status).toBe('playing');
    expect(controllers[0]?.started).toBe(true);
  });

  it('ignores game actions from sockets that are not in a room', async () => {
    const stranger = await newClient();
    expect(await call(stranger, 'skribble:guess', { text: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
    expect(await call(stranger, 'game:rematch-ready', {})).toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
  });

  it('delegates game actions using server identity, not payload claims', async () => {
    const { host, guest } = await pair();
    await call(host, 'game:start', {});
    const result = await call(guest, 'skribble:guess', { text: 'cat', playerId: 'spoofed', isHost: true });
    expect(result.ok).toBe(true);
    const action = controllers[0]?.actions[0];
    expect(action?.playerId).not.toBe('spoofed');
    expect(action?.playerId).toBe(manager.getPlayerForSocket(guest.id as string)?.id);
  });

  it('aborts the match and tells the remaining player when the other disconnects', async () => {
    const { host, guest, code } = await pair();
    await call(host, 'game:start', {});
    const aborted = nextEvent<{ message: string; reason: string }>(host, 'game:aborted');
    const state = nextEvent<RoomSnapshot>(host, 'room:state');
    guest.disconnect();
    expect((await aborted).reason).toBe('player-left');
    const snapshot = await state;
    expect(snapshot.status).toBe('lobby');
    expect(snapshot.players).toHaveLength(1);
    expect(controllers[0]?.disposeCount).toBe(1);
    expect(manager.getRoom(code)?.match).toBeNull();
  });

  it('transfers host, removes the socket from the transport room, and deletes empty rooms', async () => {
    const { host, guest, code } = await pair();
    const state = nextEvent<RoomSnapshot>(guest, 'room:state');
    expect((await call(host, 'room:leave', {})).ok).toBe(true);
    const snapshot = await state;
    expect(snapshot.hostId).toBe(snapshot.players[0]?.id);
    expect(io.sockets.adapter.rooms.get(code)?.has(host.id as string)).toBe(false);
    // Repeating leave is harmless.
    expect((await call(host, 'room:leave', {})).ok).toBe(true);

    await call(guest, 'room:leave', {});
    expect(manager.getRoom(code)).toBeUndefined();
  });

  it('rate limits floods of room requests', async () => {
    const c = await newClient();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call(c, 'room:join', { code: 'ZZZZZZ', name: 'A' })),
    );
    expect(results.some((r) => !r.ok && r.error.code === 'RATE_LIMITED')).toBe(true);
  });

  it('ignores events sent without an acknowledgement callback', async () => {
    const c = await newClient();
    (c as unknown as { emit(e: string, p: unknown): void }).emit('room:create', { selectedGame: 'skribble', name: 'A' });
    // Follow with a normal request to make sure the server is still healthy and nothing was created.
    expect(await call(c, 'room:join', { code: 'ZZZZZZ', name: 'A' })).toMatchObject({ ok: false });
    expect(manager.roomCount).toBe(0);
  });
});

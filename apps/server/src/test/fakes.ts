// Test doubles for the Agent 3 match controller and transport.
import type { AckResult, GameActionEvent } from '@2p/shared';
import type { CreateMatchController, MatchController, MatchControllerOptions, MatchTransport } from '../games/types.js';

export class FakeController implements MatchController {
  readonly gameId = 'skribble' as const;
  readonly matchId: string;
  started = false;
  disposeCount = 0;
  actions: Array<{ playerId: string; event: GameActionEvent; payload: unknown }> = [];
  rematchCalls: string[] = [];

  constructor(public readonly options: MatchControllerOptions, id: string) {
    this.matchId = id;
  }

  start(): void {
    this.started = true;
  }
  handleAction(playerId: string, event: GameActionEvent, payload: unknown): AckResult<unknown> {
    this.actions.push({ playerId, event, payload });
    return { ok: true, data: { seq: this.actions.length } };
  }
  rematchReady(playerId: string): AckResult {
    this.rematchCalls.push(playerId);
    return { ok: true, data: undefined };
  }
  snapshotFor(): never {
    throw new Error('not used in room tests');
  }
  dispose(): void {
    this.disposeCount += 1;
  }
}

export function fakeControllerFactory() {
  const created: FakeController[] = [];
  const factory: CreateMatchController = (options) => {
    const controller = new FakeController(options, `match-${created.length + 1}`);
    created.push(controller);
    return controller;
  };
  return { factory, created };
}

export const noopTransport: MatchTransport = { sendTo() {}, broadcast() {} };

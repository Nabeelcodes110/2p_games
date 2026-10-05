// OWNER: Agent 3
// Authoritative match controller: runs the shared matchReducer, owns turn/result timers,
// validates timer callbacks against captured match/turn IDs, and builds sanitized snapshots.
import { randomUUID } from 'node:crypto';
import { GAME_CATALOG, createInitialMatchState, fail, isRematchAgreed, matchReducer, ok } from '@2p/shared';
import type {
  AckResult,
  GameActionEvent,
  GameId,
  GameOutcome,
  GameStateSnapshot,
  MatchAction,
  MatchId,
  MatchState,
  PlayerId,
  RoomCode,
  TurnId,
} from '@2p/shared';
import { SERVER_GAMES } from '../games/registry.js';
import { systemClock } from '../games/types.js';
import type {
  Clock,
  CreateMatchController,
  GameSession,
  MatchController,
  MatchControllerOptions,
  MatchTransport,
  ServerGameModule,
} from '../games/types.js';

export interface GameMatchControllerOptions extends MatchControllerOptions {
  /** Override for tests. */
  generateId?: () => string;
  /** Override the registry module for tests. */
  module?: ServerGameModule;
}

export class GameMatchController implements MatchController {
  readonly gameId: GameId;
  private readonly roomCode: RoomCode;
  private readonly playerIds: readonly PlayerId[];
  private readonly transport: MatchTransport;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly generateId: () => string;
  private readonly module: ServerGameModule;
  private state: MatchState;
  private session: GameSession;
  private currentMatchId: MatchId;
  private timer: unknown = null;
  private revision = 0;
  private disposed = false;

  constructor(options: GameMatchControllerOptions) {
    if (options.playerIds.length !== 2) throw new Error('A match needs exactly two players.');
    this.gameId = options.gameId;
    this.roomCode = options.roomCode;
    this.playerIds = [...options.playerIds];
    this.transport = options.transport;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.generateId = options.generateId ?? randomUUID;
    this.module = options.module ?? SERVER_GAMES[options.gameId];
    this.state = createInitialMatchState(GAME_CATALOG[options.gameId].rules);
    this.currentMatchId = this.generateId();
    this.session = this.createSession(this.currentMatchId);
  }

  get matchId(): MatchId {
    return this.currentMatchId;
  }

  start(): void {
    if (this.disposed || this.state.phase !== 'lobby') return;
    const now = this.clock.now();
    const firstPlayerId = this.playerIds[Math.floor(this.random() * this.playerIds.length)] ?? this.playerIds[0]!;
    this.dispatch({
      type: 'start',
      matchId: this.currentMatchId,
      playerIds: [...this.playerIds],
      firstPlayerId,
      turnId: this.generateId(),
      now,
    });
    this.beginTurn();
  }

  handleAction(playerId: PlayerId, event: GameActionEvent, payload: unknown): AckResult<unknown> {
    if (this.disposed) return fail('INVALID_PHASE', 'The match has ended.');
    if (!this.playerIds.includes(playerId)) return fail('NOT_IN_ROOM', 'You are not in this match.');
    if (!this.module.actionEvents.includes(event)) return fail('INVALID_PAYLOAD', 'Unknown action.');
    return this.session.handleAction(playerId, event, payload, this.state, this.clock.now());
  }

  rematchReady(playerId: PlayerId): AckResult {
    if (this.disposed) return fail('INVALID_PHASE', 'The match has ended.');
    if (!this.playerIds.includes(playerId)) return fail('NOT_IN_ROOM', 'You are not in this match.');
    if (this.state.phase !== 'finished') return fail('INVALID_PHASE', 'The match is still running.');
    if (!this.dispatch({ type: 'rematchReady', playerId })) return ok();

    if (isRematchAgreed(this.state)) {
      // Complete reset: new match ID, fresh game session, fresh engine state.
      this.clearTimer();
      this.session.dispose();
      this.dispatch({ type: 'reset' });
      this.currentMatchId = this.generateId();
      this.session = this.createSession(this.currentMatchId);
      this.start();
    } else {
      this.broadcastState();
    }
    return ok();
  }

  snapshotFor(playerId: PlayerId): GameStateSnapshot {
    return {
      gameId: this.gameId,
      roomCode: this.roomCode,
      revision: this.revision,
      serverTime: this.clock.now(),
      match: this.state,
      view: this.session.getPlayerView(playerId),
    } as GameStateSnapshot;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.session.dispose();
  }

  private createSession(matchId: MatchId): GameSession {
    return this.module.createSession({
      matchId,
      playerIds: this.playerIds,
      transport: this.transport,
      clock: this.clock,
      random: this.random,
      reportOutcome: (outcome) => this.onOutcome(matchId, outcome),
      publishState: () => {
        if (!this.disposed && matchId === this.state.matchId) this.broadcastState();
      },
    });
  }

  /** Applies an action; returns true when the state changed. */
  private dispatch(action: MatchAction): boolean {
    const next = matchReducer(this.state, action);
    if (next === this.state) return false;
    this.state = next;
    return true;
  }

  private beginTurn(): void {
    const { matchId, turnId, activePlayerId, deadline } = this.state;
    if (this.state.phase !== 'activeTurn' || !matchId || !turnId || !activePlayerId || deadline === null) return;
    const now = this.clock.now();
    this.session.startTurn({ matchId, turnId, activePlayerId, playerIds: this.playerIds, deadline, now });
    this.schedule(deadline - now, () => this.onTimeout(matchId, turnId));
    this.broadcastState();
  }

  private onOutcome(matchId: MatchId, outcome: GameOutcome): void {
    if (this.disposed || matchId !== this.state.matchId) return;
    if (!this.dispatch({ type: 'outcome', outcome, now: this.clock.now() })) return;
    this.afterTurnEnded();
  }

  private onTimeout(matchId: MatchId, turnId: TurnId): void {
    this.timer = null;
    if (this.disposed || this.state.matchId !== matchId || this.state.turnId !== turnId) return;
    // Timers may fire marginally early; the timer firing means the deadline was reached.
    const now = Math.max(this.clock.now(), this.state.deadline ?? 0);
    const outcome = this.session.resolveTimeout?.(this.state) ?? null;
    const changed = outcome
      ? this.dispatch({ type: 'outcome', outcome, now })
      : this.dispatch({ type: 'timeout', turnId, now });
    if (!changed) return;
    this.afterTurnEnded();
  }

  private afterTurnEnded(): void {
    this.clearTimer();
    this.session.endTurn(this.state);
    const { matchId, turnId, resultUntil } = this.state;
    if (this.state.phase === 'turnResult' && matchId && turnId && resultUntil !== null) {
      this.schedule(resultUntil - this.clock.now(), () => this.onResultElapsed(matchId, turnId));
    }
    this.broadcastState();
  }

  private onResultElapsed(matchId: MatchId, previousTurnId: TurnId): void {
    this.timer = null;
    if (this.disposed || this.state.matchId !== matchId || this.state.turnId !== previousTurnId) return;
    if (!this.dispatch({ type: 'nextTurn', turnId: this.generateId(), now: this.clock.now() })) return;
    this.beginTurn();
  }

  private schedule(ms: number, callback: () => void): void {
    this.clearTimer();
    this.timer = this.clock.setTimeout(callback, Math.max(0, ms));
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private broadcastState(): void {
    this.revision += 1;
    for (const playerId of this.playerIds) {
      this.transport.sendTo(playerId, 'game:state', this.snapshotFor(playerId));
    }
  }
}

export const createMatchController: CreateMatchController = (options) => new GameMatchController(options);

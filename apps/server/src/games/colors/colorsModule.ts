// Server-side Colors: random target, lock-in validation, closest-color decision.
// Reports a validated `roundResult` outcome; never advances rounds or decides the match winner.
import {
  COLORS_PICK_MS,
  colorDistance,
  decideRound,
  fail,
  normalizeHexColor,
  ok,
  rgbToHex,
} from '@2p/shared';
import type {
  AckResult,
  ColorsPick,
  ColorsRoundResult,
  ColorsView,
  GameActionEvent,
  GameOutcome,
  MatchState,
  PlayerId,
} from '@2p/shared';
import type { GameSession, GameSessionContext, ServerGameModule, TurnContext } from '../types.js';

const MAX_ID_LENGTH = 64;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

export class ColorsSession implements GameSession<'colors'> {
  private turn: TurnContext | null = null;
  private target: string | null = null;
  private pickStartsAt = 0;
  private picks = new Map<PlayerId, ColorsPick>();
  private turnState: 'idle' | 'active' | 'ended' = 'idle';
  /** Set once a round outcome was computed so it is reported exactly once. */
  private resolved = false;
  private pendingResult: ColorsRoundResult | null = null;
  private result: ColorsRoundResult | null = null;
  private lastTarget: string | null = null;
  private disposed = false;

  constructor(private readonly ctx: GameSessionContext) {}

  startTurn(turn: TurnContext): void {
    if (this.disposed) return;
    this.turn = turn;
    this.target = this.randomTarget();
    this.lastTarget = this.target;
    this.pickStartsAt = turn.deadline - COLORS_PICK_MS;
    this.picks = new Map();
    this.turnState = 'active';
    this.resolved = false;
    this.pendingResult = null;
    this.result = null;
  }

  handleAction(
    playerId: PlayerId,
    event: GameActionEvent,
    payload: unknown,
    match: MatchState,
    now: number,
  ): AckResult<unknown> {
    if (event !== 'colors:submit') return fail('INVALID_PAYLOAD', 'Unknown action.');
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return fail('INVALID_PAYLOAD', 'Malformed request.');
    }
    const { matchId, turnId, color } = payload as Record<string, unknown>;
    if (!isId(matchId) || !isId(turnId)) return fail('INVALID_PAYLOAD', 'Malformed request.');

    if (this.disposed || this.turnState !== 'active' || match.phase !== 'activeTurn' || !this.turn) {
      return fail('INVALID_PHASE', 'No round is active right now.');
    }
    if (matchId !== match.matchId || turnId !== match.turnId || turnId !== this.turn.turnId) {
      return fail('STALE_TURN', 'That round has already ended.');
    }
    if (!this.ctx.playerIds.includes(playerId)) return fail('NOT_IN_ROOM', 'You are not in this match.');
    if (match.deadline === null || now >= match.deadline) return fail('DEADLINE_PASSED', 'Time is up for this round.');
    if (now < this.pickStartsAt) return fail('INVALID_PHASE', 'Wait for the color to be hidden first.');
    if (this.resolved) return fail('INVALID_PHASE', 'This round has already been decided.');
    if (this.picks.has(playerId)) return fail('NOT_ALLOWED', 'You already locked in a color.');

    const hex = normalizeHexColor(color);
    if (!hex) return fail('INVALID_PAYLOAD', 'Pick a valid color.');

    const target = this.target as string;
    const pick: ColorsPick = {
      color: hex,
      distance: colorDistance(hex, target),
      elapsedMs: Math.max(0, now - this.pickStartsAt),
    };
    this.picks.set(playerId, pick);

    if (this.picks.size === this.ctx.playerIds.length) {
      // Both answered: the round ends immediately.
      this.resolved = true;
      this.pendingResult = this.decide(turnId);
      this.ctx.reportOutcome(this.outcome(this.pendingResult));
    } else {
      this.ctx.publishState();
    }
    return ok({ distance: pick.distance });
  }

  resolveTimeout(match: MatchState): GameOutcome | null {
    if (this.disposed || this.turnState !== 'active' || !this.turn || match.turnId !== this.turn.turnId) return null;
    if (!this.resolved) {
      this.resolved = true;
      this.pendingResult = this.decide(this.turn.turnId);
    }
    return this.outcome(this.pendingResult as ColorsRoundResult);
  }

  endTurn(): void {
    if (this.disposed || this.turnState !== 'active') return;
    this.turnState = 'ended';
    this.result = this.pendingResult ?? this.decide(this.turn?.turnId ?? '');
  }

  getPlayerView(playerId: PlayerId): ColorsView {
    const active = this.turnState === 'active';
    const revealing = active && this.ctx.clock.now() < this.pickStartsAt;
    return {
      // The target is withheld from snapshots once picking has opened.
      target: revealing || this.turnState === 'ended' ? this.target : null,
      pickStartsAt: active ? this.pickStartsAt : null,
      lockedIn: [...this.picks.keys()],
      myPick: this.picks.get(playerId) ?? null,
      result: this.turnState === 'ended' ? this.result : null,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.turn = null;
    this.target = null;
    this.lastTarget = null;
    this.picks.clear();
    this.pendingResult = null;
    this.result = null;
    this.turnState = 'idle';
  }

  private decide(turnId: string): ColorsRoundResult {
    const picks: Record<PlayerId, ColorsPick | null> = {};
    for (const id of this.ctx.playerIds) picks[id] = this.picks.get(id) ?? null;
    const { winnerId, reason } = decideRound(picks, this.ctx.playerIds);
    return { turnId, target: this.target as string, picks, winnerId, reason };
  }

  private outcome(result: ColorsRoundResult): GameOutcome {
    return { type: 'roundResult', turnId: result.turnId, winnerId: result.winnerId };
  }

  private randomTarget(): string {
    // Retry so consecutive rounds never share a target.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const color = rgbToHex([
        Math.floor(this.ctx.random() * 256),
        Math.floor(this.ctx.random() * 256),
        Math.floor(this.ctx.random() * 256),
      ]);
      if (color !== this.lastTarget) return color;
    }
    return this.lastTarget === '#808080' ? '#7F7F80' : '#808080';
  }
}

export const colorsModule: ServerGameModule<'colors'> = {
  id: 'colors',
  actionEvents: ['colors:submit'],
  createSession: (ctx) => new ColorsSession(ctx),
};

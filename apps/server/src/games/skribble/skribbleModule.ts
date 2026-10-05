// OWNER: Agent 3
// Server-side Skribble: word assignment, stroke/clear/guess validation, secret-word isolation.
// Reports validated `correctGuess` outcomes; never advances turns or decides winners.
import { SKRIBBLE_LIMITS, fail, normalizeGuess, ok } from '@2p/shared';
import type {
  AckResult,
  ChatMessage,
  ChatMessageKind,
  GameActionEvent,
  MatchState,
  PlayerId,
  SkribbleView,
  StrokeBatch,
} from '@2p/shared';
import type { GameSession, GameSessionContext, ServerGameModule, TurnContext } from '../types.js';
import { parseGuess, parseStroke, parseTurnRef } from './validation.js';
import { SKRIBBLE_WORDS } from './words.js';

interface StrokeState {
  points: number;
  closed: boolean;
}

/** Sliding one-second window counter. */
class PerSecondLimiter {
  private stamps: number[] = [];
  constructor(private readonly max: number) {}

  allow(now: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t < 1_000);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }
}

export interface SkribbleSessionOptions {
  words?: readonly string[];
}

export class SkribbleSession implements GameSession<'skribble'> {
  private readonly words: readonly string[];
  private readonly usedWords = new Set<string>();
  private turn: TurnContext | null = null;
  private word: string | null = null;
  private turnState: 'idle' | 'active' | 'ended' = 'idle';
  /** Set by the first correct guess so a turn resolves exactly once. */
  private resolved = false;
  private seq = 0;
  private strokes: StrokeBatch[] = [];
  private historyPoints = 0;
  private strokeStates = new Map<string, StrokeState>();
  private messages: ChatMessage[] = [];
  private messageCounter = 0;
  private strokeLimiters = new Map<PlayerId, PerSecondLimiter>();
  private guessLimiters = new Map<PlayerId, PerSecondLimiter>();
  private disposed = false;

  constructor(
    private readonly ctx: GameSessionContext,
    options: SkribbleSessionOptions = {},
  ) {
    this.words = options.words ?? SKRIBBLE_WORDS;
  }

  startTurn(turn: TurnContext): void {
    if (this.disposed) return;
    this.turn = turn;
    this.word = this.pickWord();
    this.turnState = 'active';
    this.resolved = false;
    this.resetDrawing();
    this.ctx.transport.sendTo(turn.activePlayerId, 'skribble:word', {
      matchId: turn.matchId,
      turnId: turn.turnId,
      word: this.word,
    });
  }

  handleAction(
    playerId: PlayerId,
    event: GameActionEvent,
    payload: unknown,
    match: MatchState,
    now: number,
  ): AckResult<unknown> {
    const ref = parseTurnRef(payload);
    if (!ref.ok) return ref;
    if (this.disposed || this.turnState !== 'active' || match.phase !== 'activeTurn' || !this.turn) {
      return fail('INVALID_PHASE', 'No turn is active right now.');
    }
    if (ref.data.matchId !== match.matchId || ref.data.turnId !== match.turnId || ref.data.turnId !== this.turn.turnId) {
      return fail('STALE_TURN', 'That turn has already ended.');
    }
    if (!this.ctx.playerIds.includes(playerId)) return fail('NOT_IN_ROOM', 'You are not in this match.');
    if (match.deadline === null || now >= match.deadline) {
      return fail('DEADLINE_PASSED', 'Time is up for this turn.');
    }

    switch (event) {
      case 'skribble:stroke':
        return this.handleStroke(playerId, payload, now);
      case 'skribble:clear':
        return this.handleClear(playerId);
      case 'skribble:guess':
        return this.handleGuess(playerId, payload, now);
      default:
        return fail('INVALID_PAYLOAD', 'Unknown action.');
    }
  }

  endTurn(match: MatchState): void {
    if (this.disposed || this.turnState !== 'active' || !this.turn || !this.word) return;
    this.turnState = 'ended';
    const timedOut = match.lastTurnResult?.reason === 'timeout';
    this.pushMessage('system', null, `${timedOut ? "Time's up! " : ''}The word was "${this.word}".`, match.matchId);
  }

  getPlayerView(playerId: PlayerId): SkribbleView {
    const active = this.turnState === 'active' && this.word !== null;
    return {
      word: active && this.turn?.activePlayerId === playerId ? this.word : null,
      wordLength: active ? (this.word as string).length : null,
      revealedWord: this.turnState === 'ended' ? this.word : null,
      strokes: this.strokes.map((s) => ({ ...s, points: s.points.map(([x, y]) => [x, y]) })),
      lastSeq: this.seq,
      messages: [...this.messages],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.turn = null;
    this.word = null;
    this.turnState = 'idle';
    this.resetDrawing();
    this.messages = [];
    this.strokeLimiters.clear();
    this.guessLimiters.clear();
  }

  private handleStroke(playerId: PlayerId, payload: unknown, now: number): AckResult<{ seq: number }> {
    const turn = this.turn as TurnContext;
    if (playerId !== turn.activePlayerId) return fail('NOT_ALLOWED', 'Only the drawer can draw.');
    const parsed = parseStroke(payload);
    if (!parsed.ok) return parsed;
    const input = parsed.data;

    if (!limiter(this.strokeLimiters, playerId, SKRIBBLE_LIMITS.maxStrokeBatchesPerSecond).allow(now)) {
      return fail('RATE_LIMITED', 'Drawing too fast.');
    }

    let stroke = this.strokeStates.get(input.strokeId);
    if (stroke?.closed) return fail('NOT_ALLOWED', 'That stroke has ended or was cleared.');
    if (!stroke) {
      if (this.strokeStates.size >= SKRIBBLE_LIMITS.maxStrokesPerTurn) {
        return fail('LIMIT_EXCEEDED', 'Too many strokes this turn. Clear the canvas.');
      }
      stroke = { points: 0, closed: false };
    }
    if (stroke.points + input.points.length > SKRIBBLE_LIMITS.maxPointsPerStroke) {
      return fail('LIMIT_EXCEEDED', 'Stroke is too long.');
    }
    if (this.historyPoints + input.points.length > SKRIBBLE_LIMITS.maxHistoryPoints) {
      return fail('LIMIT_EXCEEDED', 'Canvas is full. Clear it to keep drawing.');
    }

    stroke.points += input.points.length;
    stroke.closed = input.final;
    this.strokeStates.set(input.strokeId, stroke);
    this.historyPoints += input.points.length;
    this.seq += 1;
    const batch: StrokeBatch = { ...input, seq: this.seq };
    this.strokes.push(batch);
    this.ctx.transport.broadcast('skribble:stroke', batch, { except: playerId });
    return ok({ seq: this.seq });
  }

  private handleClear(playerId: PlayerId): AckResult<{ seq: number }> {
    const turn = this.turn as TurnContext;
    if (playerId !== turn.activePlayerId) return fail('NOT_ALLOWED', 'Only the drawer can clear.');
    // Every stroke started before the clear is closed; later points for it are rejected.
    for (const state of this.strokeStates.values()) state.closed = true;
    this.strokes = [];
    this.historyPoints = 0;
    this.seq += 1;
    this.ctx.transport.broadcast(
      'skribble:clear',
      { matchId: turn.matchId, turnId: turn.turnId, seq: this.seq },
      { except: playerId },
    );
    return ok({ seq: this.seq });
  }

  private handleGuess(playerId: PlayerId, payload: unknown, now: number): AckResult<{ correct: boolean }> {
    const turn = this.turn as TurnContext;
    if (playerId === turn.activePlayerId) return fail('NOT_ALLOWED', 'The drawer cannot guess.');
    if (this.resolved) return fail('INVALID_PHASE', 'The word was already guessed.');
    const parsed = parseGuess(payload);
    if (!parsed.ok) return parsed;
    if (!limiter(this.guessLimiters, playerId, SKRIBBLE_LIMITS.maxGuessesPerSecond).allow(now)) {
      return fail('RATE_LIMITED', 'Guessing too fast.');
    }

    const correct = normalizeGuess(parsed.data.text) === normalizeGuess(this.word as string);
    if (!correct) {
      this.pushMessage('guess', playerId, parsed.data.text, turn.matchId);
      return ok({ correct: false });
    }

    this.resolved = true;
    this.pushMessage('correct', playerId, 'Guessed the word!', turn.matchId);
    this.ctx.reportOutcome({ type: 'correctGuess', turnId: turn.turnId, playerId });
    return ok({ correct: true });
  }

  private pushMessage(kind: ChatMessageKind, playerId: PlayerId | null, text: string, matchId: string | null): void {
    this.messageCounter += 1;
    const message: ChatMessage = {
      id: `${this.ctx.matchId}-${this.messageCounter}`,
      matchId: matchId ?? this.ctx.matchId,
      turnId: this.turn?.turnId ?? null,
      kind,
      playerId,
      text,
      at: this.ctx.clock.now(),
    };
    this.messages.push(message);
    if (this.messages.length > SKRIBBLE_LIMITS.maxChatMessages) {
      this.messages.splice(0, this.messages.length - SKRIBBLE_LIMITS.maxChatMessages);
    }
    this.ctx.transport.broadcast('skribble:guess-result', message);
  }

  private pickWord(): string {
    let available = this.words.filter((w) => !this.usedWords.has(w));
    if (available.length === 0) {
      this.usedWords.clear();
      available = [...this.words];
    }
    const word = available[Math.floor(this.ctx.random() * available.length)] ?? (available[0] as string);
    this.usedWords.add(word);
    return word;
  }

  private resetDrawing(): void {
    this.seq = 0;
    this.strokes = [];
    this.historyPoints = 0;
    this.strokeStates = new Map();
  }
}

function limiter(map: Map<PlayerId, PerSecondLimiter>, playerId: PlayerId, max: number): PerSecondLimiter {
  let found = map.get(playerId);
  if (!found) {
    found = new PerSecondLimiter(max);
    map.set(playerId, found);
  }
  return found;
}

export const skribbleModule: ServerGameModule<'skribble'> = {
  id: 'skribble',
  actionEvents: ['skribble:stroke', 'skribble:clear', 'skribble:guess'],
  createSession: (ctx) => new SkribbleSession(ctx),
};

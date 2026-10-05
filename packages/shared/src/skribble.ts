/**
 * CONTRACT (owner: Agent 3). Skribble payloads, limits and player-specific view.
 */
import type { MatchId, TurnId } from './match.js';
import type { PlayerId } from './room.js';

/** Fixed logical canvas (4:3). Points are normalized to 0..1 against it. */
export const SKRIBBLE_LOGICAL_WIDTH = 800;
export const SKRIBBLE_LOGICAL_HEIGHT = 600;
export const SKRIBBLE_CANVAS_BACKGROUND = '#FFFFFF';

export const SKRIBBLE_PALETTE = [
  '#000000',
  '#757575',
  '#FFFFFF',
  '#D32F2F',
  '#F57C00',
  '#F2C94C',
  '#5D8C3E',
  '#2E7D32',
  '#8DC9EE',
  '#1565C0',
  '#6A1B9A',
  '#79553A',
] as const;
export type SkribbleColor = (typeof SKRIBBLE_PALETTE)[number];

/** Brush widths in logical canvas pixels. */
export const SKRIBBLE_BRUSH_SIZES = [3, 6, 12, 24] as const;
export type SkribbleBrushSize = (typeof SKRIBBLE_BRUSH_SIZES)[number];

export type SkribbleTool = 'pencil' | 'eraser';

export const SKRIBBLE_LIMITS = {
  maxPointsPerBatch: 64,
  maxPointsPerStroke: 4_000,
  maxStrokesPerTurn: 1_000,
  maxHistoryPoints: 40_000,
  maxStrokeBatchesPerSecond: 40,
  maxGuessLength: 40,
  maxGuessesPerSecond: 3,
  maxChatMessages: 50,
} as const;

export type NormalizedPoint = [x: number, y: number];

export interface StrokeBatchInput {
  matchId: MatchId;
  turnId: TurnId;
  /** Client-generated, unique within the turn. */
  strokeId: string;
  tool: SkribbleTool;
  /** Ignored for rendering when tool === 'eraser' (eraser paints SKRIBBLE_CANVAS_BACKGROUND). */
  color: SkribbleColor;
  width: SkribbleBrushSize;
  points: NormalizedPoint[];
  /** True on the batch that ends the stroke. */
  final: boolean;
}

/** Relayed by the server after validation. `seq` orders strokes and clears within a turn. */
export interface StrokeBatch extends StrokeBatchInput {
  seq: number;
}

export interface ClearInput {
  matchId: MatchId;
  turnId: TurnId;
}

export interface ClearEvent extends ClearInput {
  seq: number;
}

export interface GuessInput {
  matchId: MatchId;
  turnId: TurnId;
  text: string;
}

export type ChatMessageKind = 'guess' | 'correct' | 'system';

/** Render `text` as plain text only. */
export interface ChatMessage {
  id: string;
  matchId: MatchId;
  turnId: TurnId | null;
  kind: ChatMessageKind;
  playerId: PlayerId | null;
  text: string;
  at: number;
}

export interface SkribbleWordEvent {
  matchId: MatchId;
  turnId: TurnId;
  word: string;
}

/** Player-specific view. Built explicitly per recipient; never serialize internal game objects. */
export interface SkribbleView {
  /** Only for the current drawer during an active turn; null for the guesser. */
  word: string | null;
  /** Length of the secret word for the masked display; null outside an active turn. */
  wordLength: number | null;
  /** Public only once the turn has ended. */
  revealedWord: string | null;
  /** Bounded current-turn history after the last clear, for late mount/resize replay. */
  strokes: StrokeBatch[];
  lastSeq: number;
  messages: ChatMessage[];
}

/** Trim, collapse internal whitespace, lowercase. Exact match after normalization. */
export function normalizeGuess(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

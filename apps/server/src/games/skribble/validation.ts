// OWNER: Agent 3
// Runtime validation for Skribble client payloads. Builds fresh objects; never relays client objects.
import {
  SKRIBBLE_BRUSH_SIZES,
  SKRIBBLE_LIMITS,
  SKRIBBLE_PALETTE,
  fail,
  ok,
} from '@2p/shared';
import type {
  AckResult,
  ClearInput,
  GuessInput,
  NormalizedPoint,
  SkribbleBrushSize,
  SkribbleColor,
  StrokeBatchInput,
} from '@2p/shared';

const MAX_ID_LENGTH = 64;
const STROKE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Raw guess text above this is rejected before normalization work. */
const MAX_RAW_GUESS_LENGTH = SKRIBBLE_LIMITS.maxGuessLength * 4;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function invalid<T>(message: string): AckResult<T> {
  return fail('INVALID_PAYLOAD', message);
}

export function parseTurnRef(payload: unknown): AckResult<ClearInput> {
  if (!isObject(payload) || !isId(payload.matchId) || !isId(payload.turnId)) {
    return invalid('Missing match or turn.');
  }
  return ok({ matchId: payload.matchId, turnId: payload.turnId });
}

export function parseStroke(payload: unknown): AckResult<StrokeBatchInput> {
  const ref = parseTurnRef(payload);
  if (!ref.ok) return ref;
  const p = payload as Obj;

  if (typeof p.strokeId !== 'string' || !STROKE_ID_PATTERN.test(p.strokeId)) {
    return invalid('Invalid stroke id.');
  }
  if (p.tool !== 'pencil' && p.tool !== 'eraser') return invalid('Invalid tool.');
  if (!(SKRIBBLE_PALETTE as readonly unknown[]).includes(p.color)) return invalid('Invalid colour.');
  if (!(SKRIBBLE_BRUSH_SIZES as readonly unknown[]).includes(p.width)) return invalid('Invalid brush size.');
  if (typeof p.final !== 'boolean') return invalid('Invalid stroke state.');
  if (!Array.isArray(p.points)) return invalid('Invalid points.');
  if (p.points.length === 0 && !p.final) return invalid('Empty stroke batch.');
  if (p.points.length > SKRIBBLE_LIMITS.maxPointsPerBatch) {
    return fail('LIMIT_EXCEEDED', 'Too many points in one batch.');
  }

  const points: NormalizedPoint[] = [];
  for (const point of p.points) {
    if (!Array.isArray(point) || point.length !== 2) return invalid('Invalid point.');
    const [x, y] = point as unknown[];
    if (!isUnit(x) || !isUnit(y)) return invalid('Point out of range.');
    points.push([x, y]);
  }

  return ok({
    ...ref.data,
    strokeId: p.strokeId,
    tool: p.tool,
    color: p.color as SkribbleColor,
    width: p.width as SkribbleBrushSize,
    points,
    final: p.final,
  });
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseGuess(payload: unknown): AckResult<GuessInput> {
  const ref = parseTurnRef(payload);
  if (!ref.ok) return ref;
  const text = (payload as Obj).text;
  if (typeof text !== 'string') return invalid('Guess must be text.');
  if (text.length > MAX_RAW_GUESS_LENGTH) return fail('LIMIT_EXCEEDED', 'Guess is too long.');
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return invalid('Type a guess first.');
  if (cleaned.length > SKRIBBLE_LIMITS.maxGuessLength) return fail('LIMIT_EXCEEDED', 'Guess is too long.');
  return ok({ ...ref.data, text: cleaned });
}

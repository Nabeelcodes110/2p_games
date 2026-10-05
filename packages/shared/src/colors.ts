/**
 * Colors game: payloads, view and pure scoring helpers.
 * One simultaneous turn per round: players see the target for COLORS_REVEAL_MS, then both have
 * COLORS_PICK_MS to lock in a color. The server decides the winner with `decideRound`.
 */
import type { MatchId, TurnId } from './match.js';
import type { PlayerId } from './room.js';

export const COLORS_REVEAL_MS = 3_000;
export const COLORS_PICK_MS = 15_000;

export const COLORS_HEX_PATTERN = /^#[0-9A-F]{6}$/;

/** Returns the color as uppercase `#RRGGBB`, or null if the input is not a 6-digit hex color. */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const upper = input.trim().toUpperCase();
  return COLORS_HEX_PATTERN.test(upper) ? upper : null;
}

export type Rgb = [r: number, g: number, b: number];

export function hexToRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  // sRGB (D65) -> XYZ, normalized by the D65 white point.
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance (CIE76 delta-E in Lab space), rounded to 0.01. 0 means identical colors. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToLab(hexToRgb(a));
  const [l2, a2, b2] = rgbToLab(hexToRgb(b));
  const delta = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  return Math.round(delta * 100) / 100;
}

export interface ColorsSubmitInput {
  matchId: MatchId;
  turnId: TurnId;
  /** `#RRGGBB`. Final: a player can lock in only once per round. */
  color: string;
}

export interface ColorsPick {
  color: string;
  /** Perceptual distance to the target (lower is closer). */
  distance: number;
  /** Time from the moment picking opened to the server receiving the lock-in. */
  elapsedMs: number;
}

export type ColorsRoundReason =
  /** Both answered; the closer color won. */
  | 'closest'
  /** Equal distance; the faster player won. */
  | 'faster'
  /** Only one player locked in in time. */
  | 'forfeit'
  /** Equal distance and equal time: no point. */
  | 'tie'
  /** Nobody locked in: no point. */
  | 'noAnswer';

export interface ColorsRoundResult {
  turnId: TurnId;
  target: string;
  picks: Record<PlayerId, ColorsPick | null>;
  winnerId: PlayerId | null;
  reason: ColorsRoundReason;
}

/** Pure round decision shared by the server module and its tests. */
export function decideRound(
  picks: Record<PlayerId, ColorsPick | null>,
  playerIds: readonly PlayerId[],
): { winnerId: PlayerId | null; reason: ColorsRoundReason } {
  const answered = playerIds.filter((id) => picks[id] != null);
  if (answered.length === 0) return { winnerId: null, reason: 'noAnswer' };
  if (answered.length === 1) return { winnerId: answered[0] as PlayerId, reason: 'forfeit' };

  const [first, second] = answered as [PlayerId, PlayerId];
  const p1 = picks[first] as ColorsPick;
  const p2 = picks[second] as ColorsPick;
  if (p1.distance !== p2.distance) {
    return { winnerId: p1.distance < p2.distance ? first : second, reason: 'closest' };
  }
  if (p1.elapsedMs !== p2.elapsedMs) {
    return { winnerId: p1.elapsedMs < p2.elapsedMs ? first : second, reason: 'faster' };
  }
  return { winnerId: null, reason: 'tie' };
}

/** Player-specific view. Built explicitly per recipient; never serialize internal session objects. */
export interface ColorsView {
  /**
   * The target color, only while it is meant to be visible (the memorize window) and once the
   * round has ended. Null while players are picking.
   */
  target: string | null;
  /** Server epoch ms when the target is hidden and picking opens; null outside an active turn. */
  pickStartsAt: number | null;
  /** Players who have locked in. Their colors stay private until the round ends. */
  lockedIn: PlayerId[];
  /** The recipient's own locked-in pick. */
  myPick: ColorsPick | null;
  /** Set once the round has ended. */
  result: ColorsRoundResult | null;
}

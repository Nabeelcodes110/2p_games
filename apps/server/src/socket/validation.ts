// OWNER: Agent 1
// Runtime validation for room-level payloads. TypeScript types are not runtime guarantees.
import { DISPLAY_NAME_MAX_LENGTH, fail, isValidRoomCode, normalizeRoomCode, ok } from '@2p/shared';
import type { AckResult, GameId, RoomCode } from '@2p/shared';
import { SERVER_GAMES } from '../games/registry.js';

const MAX_RAW_INPUT_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseName(raw: unknown): AckResult<string> {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_INPUT_LENGTH) {
    return fail('INVALID_NAME', 'Enter a display name.');
  }
  const name = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (name.length === 0) return fail('INVALID_NAME', 'Enter a display name.');
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return fail('INVALID_NAME', `Names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`);
  }
  return ok(name);
}

export function parseCreatePayload(payload: unknown): AckResult<{ gameId: GameId; name: string }> {
  if (!isRecord(payload)) return fail('INVALID_PAYLOAD', 'Malformed request.');
  const game = payload.selectedGame;
  if (typeof game !== 'string' || !Object.hasOwn(SERVER_GAMES, game)) {
    return fail('INVALID_GAME', 'That game is not available.');
  }
  const name = parseName(payload.name);
  if (!name.ok) return name;
  return ok({ gameId: game as GameId, name: name.data });
}

export function parseJoinPayload(payload: unknown): AckResult<{ code: RoomCode; name: string }> {
  if (!isRecord(payload)) return fail('INVALID_PAYLOAD', 'Malformed request.');
  const rawCode = payload.code;
  if (typeof rawCode !== 'string' || rawCode.length > MAX_RAW_INPUT_LENGTH) {
    return fail('INVALID_CODE', 'Room codes are six letters or digits.');
  }
  const code = normalizeRoomCode(rawCode);
  if (!isValidRoomCode(code)) return fail('INVALID_CODE', 'Room codes are six letters or digits.');
  const name = parseName(payload.name);
  if (!name.ok) return name;
  return ok({ code, name: name.data });
}

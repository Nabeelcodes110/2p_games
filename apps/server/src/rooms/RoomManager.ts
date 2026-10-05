// OWNER: Agent 1
// The only room store. In-memory, single process; state is lost on restart.
import type { GameId, PlayerId, RoomCode } from '@2p/shared';
import type { MatchController } from '../games/types.js';

export interface Player {
  id: PlayerId;
  socketId: string;
  name: string;
}

export interface Room {
  code: RoomCode;
  gameId: GameId;
  hostId: PlayerId;
  players: Player[];
  revision: number;
  /** Present while a match exists; disposed on abort, room deletion or replacement. */
  match: MatchController | null;
}

export class RoomManager {
  private readonly rooms = new Map<RoomCode, Room>();
  private readonly socketToRoom = new Map<string, RoomCode>();

  // TODO(Agent 1): create/join/leave/disconnect, code generation, host transfer, snapshots.
}

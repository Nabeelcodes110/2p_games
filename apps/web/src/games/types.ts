/**
 * CONTRACT between Agent 2 (GameHost, screens) and Agent 3 (game components).
 * Change only with agreement from both.
 *
 * GameHost subscribes to `game:state`, renders the common timer/rounds/scores/results from
 * `state.match`, and mounts `registry[selectedGame].Component` for the game-specific area.
 * Game components never compute scores, rounds or winners.
 */
import type { ComponentType } from 'react';
import type { GameId, GameInfo, GameStateSnapshot, MusicConfig, PlayerId, RoomSnapshot } from '@2p/shared';
import type { AppSocket } from '../socket/types';

export interface GameComponentProps<G extends GameId = GameId> {
  socket: AppSocket;
  selfId: PlayerId;
  room: RoomSnapshot;
  /** Latest authoritative snapshot (already filtered for stale revisions by GameHost). */
  state: GameStateSnapshot<G>;
  /** Estimated server time = Date.now() + serverOffsetMs. Display only. */
  serverOffsetMs: number;
}

export interface WebGameDefinition<G extends GameId = GameId> {
  id: G;
  info: GameInfo;
  Component: ComponentType<GameComponentProps<G>>;
}

export type WebGameRegistry = { [G in GameId]: WebGameDefinition<G> };

export interface GameHostSession {
  socket: AppSocket;
  selfId: PlayerId;
  room: RoomSnapshot;
}

export interface GameHostProps {
  selectedGame: GameId;
  session: GameHostSession;
  music?: MusicConfig;
  /** Called after the player chooses Leave on the results screen or mid-match. */
  onLeave: () => void;
}

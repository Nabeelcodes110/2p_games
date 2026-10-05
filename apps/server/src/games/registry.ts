// OWNER: Agent 3
import type { GameId } from '@2p/shared';
import type { ServerGameModule } from './types.js';
import { skribbleModule } from './skribble/skribbleModule.js';

export const SERVER_GAMES: { [G in GameId]: ServerGameModule<G> } = {
  skribble: skribbleModule,
};

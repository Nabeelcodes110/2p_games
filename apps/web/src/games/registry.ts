// OWNER: Agent 3 (Agent 2 reads it for game cards and GameHost mounting).
import { GAME_CATALOG } from '@2p/shared';
import { ColorsGame } from './colors/ColorsGame';
import { SkribbleGame } from './skribble/SkribbleGame';
import type { WebGameRegistry } from './types';

export const GAME_REGISTRY: WebGameRegistry = {
  skribble: {
    id: 'skribble',
    info: GAME_CATALOG.skribble,
    icon: 'pencil',
    Component: SkribbleGame,
  },
  colors: {
    id: 'colors',
    info: GAME_CATALOG.colors,
    icon: 'palette',
    Component: ColorsGame,
  },
};

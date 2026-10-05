/**
 * CONTRACT (shared by all agents). Change only with agreement from every workstream.
 * Game identity, rule configuration and optional music input.
 */

export const GAME_IDS = ['skribble', 'colors'] as const;
export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

/** Optional background music. Playback starts only after a user gesture; no audio library yet. */
export interface MusicConfig {
  src: string;
  /** 0..1, defaults to 0.5. */
  volume?: number;
  /** Defaults to true. */
  loop?: boolean;
}

/** Reusable round/winning rules consumed by the shared match engine. Configured per game. */
export interface MatchRules {
  maxRounds: number;
  /** With two players each player is the active player once per round. */
  turnsPerRound: number;
  /** First player to reach this score wins immediately. */
  winThreshold: number;
  turnDurationMs: number;
  /** Pause between turns while the result is shown. */
  resultIntervalMs: number;
}

/** Presentation hints GameHost reads so it never hardcodes a game. */
export interface GameUiHints {
  /** Both players act at the same time, so there is no single "active player" to show. */
  simultaneous?: boolean;
  /** The game component renders its own countdown; GameHost hides the common turn timer. */
  ownTimer?: boolean;
}

export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  playerCount: 2;
  rules: MatchRules;
  ui?: GameUiHints;
}

/** Server and client both read this; the server validates selections against it. */
export const GAME_CATALOG: Record<GameId, GameInfo> = {
  skribble: {
    id: 'skribble',
    name: 'Skribble',
    tagline: 'One draws, one guesses.',
    playerCount: 2,
    rules: {
      maxRounds: 5,
      turnsPerRound: 2,
      winThreshold: 5,
      turnDurationMs: 60_000,
      resultIntervalMs: 3_000,
    },
  },
  colors: {
    id: 'colors',
    name: 'Colors',
    tagline: 'Memorize the color, then match it.',
    playerCount: 2,
    rules: {
      // One simultaneous turn per round: 3 s to memorize + 15 s to pick.
      maxRounds: 5,
      turnsPerRound: 1,
      winThreshold: 5,
      turnDurationMs: 18_000,
      resultIntervalMs: 5_000,
    },
    ui: { simultaneous: true, ownTimer: true },
  },
};

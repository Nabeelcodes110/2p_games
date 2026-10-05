# Workstreams and file ownership

Three agents work in parallel (see `claude.md` → "Three-agent implementation assignments").
Each agent edits **only** files it owns. Contract files need agreement from every listed party;
when one must change, make the smallest additive change, note it in the commit message, and
tell the other agents.

## Ground rules

- **Dependencies are pre-installed.** Do not edit any `package.json` or `package-lock.json`.
  If you need a new package, ask the coordinator to add it so there's one lockfile writer.
- **Root config is frozen** (`package.json`, `tsconfig.base.json`, per-workspace `tsconfig*.json`,
  `vite.config.ts`, `vitest.config.ts`). Ask before changing.
- Shared package imports use `.js` extensions (NodeNext); server likewise. Web uses bundler resolution.
- Put tests next to the code as `*.test.ts(x)`. Use fake timers / the injected `Clock`.
- Before handing off: `npm run typecheck && npm test` from the repo root must pass.
- `TODO(Agent N)` markers show the stubs each agent replaces.

## Contracts (agreed before parallel work; change only by agreement)

| File | Parties | What it fixes |
| --- | --- | --- |
| `packages/shared/src/games.ts` | all | `GameId`, `MusicConfig`, `MatchRules`, `GAME_CATALOG` |
| `packages/shared/src/room.ts` | A1 owns, all read | Room/player snapshots, code rules, `RoomSession` |
| `packages/shared/src/match.ts` | A3 owns, all read | `MatchPhase`, `MatchState`, IDs, `GameOutcome`, `TurnResult` |
| `packages/shared/src/skribble.ts` | A3 owns, A1/A2 read | Stroke/clear/guess payloads, limits, palette, `SkribbleView` |
| `packages/shared/src/socket.ts` | A1 owns, A3 for `skribble:*` | Events, `Ack`/`AckResult`, `ErrorCode`, `GameStateSnapshot` |
| `packages/shared/src/index.ts` | all | Barrel exports |
| `apps/server/src/games/types.ts` | A1 + A3 | `MatchController`, `ServerGameModule`, `GameSession`, `MatchTransport`, `Clock` |
| `apps/web/src/games/types.ts` | A2 + A3 | `GameComponentProps`, `WebGameDefinition`, `GameHostProps` |
| `apps/web/src/socket/types.ts` | A2 owns, A3 reads | `AppSocket` |

## Agent 1 — Socket logic and in-memory rooms

- `apps/server/src/index.ts`, `config.ts`
- `apps/server/src/rooms/**` (`RoomManager`, code generation)
- `apps/server/src/socket/**` (handlers, validation, rate limits)
- `apps/server/.env.example`
- Tests: room lifecycle, codes, capacity races, membership, cleanup, unauthorized actions.
- Integrates `createMatchController` (A3) and `SERVER_GAMES` (A3); does not implement match rules.

## Agent 2 — Screens, theme, GameHost

- `apps/web/index.html`, `apps/web/src/main.tsx`, `App.tsx`
- `apps/web/src/screens/**`, `apps/web/src/components/**` (create as needed)
- `apps/web/src/game-host/**`
- `apps/web/src/socket/client.ts` (+ any client hooks/state under `src/socket/`)
- `apps/web/src/styles/**` and `apps/web/public/**` (fonts with license files)
- `apps/web/.env.example`
- Renders `state.match` from the server; no scoring/round logic in UI.

## Agent 3 — Skribble and shared match logic

- `packages/shared/src/engine/**` (pure `matchReducer`) + its tests
- `apps/server/src/match/**` (authoritative `MatchController`, timers)
- `apps/server/src/games/registry.ts`, `apps/server/src/games/skribble/**` (words, validation, history)
- `apps/web/src/games/registry.ts`, `apps/web/src/games/skribble/**` (PixiJS canvas, tools, guess UI, game animations)
- May `@use` `apps/web/src/styles/tokens` and `mixins`, but not edit them.

## Integration (after all three land)

`README.md` (setup, env, rules, two-browser test steps, single-process in-memory limitation) and
the two-browser playthrough described in `claude.md`.

## Commands

```sh
npm install            # once
npm run dev            # server :3001 + web :5173
npm run typecheck      # all workspaces
npm test               # all workspaces (vitest)
npm run build          # shared -> server -> web
npm run check          # typecheck + test + build
```

How `@2p/shared` resolves: TypeScript reads `packages/shared/dist/*.d.ts` via project references
(`tsc -b` rebuilds it automatically inside `typecheck`/`build`). Vite, Vitest and `tsx` (server
dev) load `packages/shared/src` directly, so edits show up without a rebuild.

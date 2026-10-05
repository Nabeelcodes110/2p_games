# 2P Games

Two-player browser games over Socket.IO rooms, with a Minecraft-inspired block/pixel look. Games: **Skribble** (one player draws a secret word, the other guesses it) and **Colors** (memorize a color, then match it).

**Play it live:** https://inquisitive-lollipop-d4b774.netlify.app/

The frontend is hosted on Netlify and the Socket.IO server on Render. The Render service must list the Netlify origin in `CLIENT_ORIGINS` (`https://inquisitive-lollipop-d4b774.netlify.app`, no trailing slash), and the frontend must be built with `VITE_SERVER_URL` set to the Render URL.

Stack: TypeScript, React + Vite + SCSS modules, PixiJS (drawing surface), Node + Express + Socket.IO, npm workspaces (`apps/web`, `apps/server`, `packages/shared`).

## Setup

```sh
npm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
npm run dev          # builds shared, then runs server (3001) and web (5173)
```

Windows PowerShell: use `Copy-Item` instead of `cp`.

### Environment

| File | Variable | Example | Meaning |
| --- | --- | --- | --- |
| `apps/server/.env` | `PORT` | `3001` | Server port |
| `apps/server/.env` | `CLIENT_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed by Socket.IO CORS |
| `apps/web/.env` | `VITE_SERVER_URL` | `http://localhost:3001` | Socket.IO server URL |

To test from a phone on the same network, add the web origin (for example `http://192.168.1.20:5173`) to `CLIENT_ORIGINS` and set `VITE_SERVER_URL` to the server's LAN address.

### Scripts

- `npm run typecheck`, `npm test`, `npm run build`, or `npm run check` for all three.

## Important limitation: in-memory, single process

Rooms live in a `Map` inside one server process (`RoomManager`). There is no database, Redis or sticky-session support. Restarting the server destroys every room and match, and running more than one server instance is **not supported**: players connected to different instances cannot share a room.

## How to play

1. Pick **Skribble**, enter a display name, and **Create room**. Share the six-character code.
2. The other player enters the code and **Join room**. The room's game is chosen by whoever created it; joining a room for a different game switches your selection and tells you so.
3. The host presses **Start game** once exactly two players are present.
4. Results offer **Play again** (both players must press it) or **Leave**.

### Skribble rules

- Up to 5 rounds. Each round has two 60-second turns: each player draws once and guesses once (10 turns total). The first drawer is random; drawers alternate.
- The drawer sees a secret word; the guesser sees only its length. Guesses are compared exactly after trimming, collapsing whitespace and lower-casing.
- A correct guess gives the guesser 1 point and ends the turn. A timeout gives no points. The word is revealed to both after each turn, followed by a 3-second pause.
- First to 5 points wins immediately. Otherwise after all rounds the higher score wins; equal scores are a draw.
- If a player leaves mid-match, the match is aborted and the other player returns to the lobby. No one is awarded a win.

### Colors rules

- Same room flow as Skribble. 5 rounds; both players play every round at the same time.
- Each round shows a random color in a rectangle for 3 seconds, then hides it. Both players then have 15 seconds to rebuild it from memory with the color picker and press **Lock in color** (one lock-in per round).
- The closest color wins the round (perceptual CIE76 distance, so it matches how different colors look). If the distance is equal, the player who locked in sooner wins. Equal distance and equal time: no point.
- If only one player locks in before time runs out, that player wins the round. If nobody does, no point. A round ends as soon as both have locked in.
- After 5 rounds the higher score wins; equal scores (including five tied rounds) are a draw. Picks stay private until the round ends.

The server owns words, turns, scores, deadlines and results; the browser only renders snapshots.

## Two-browser test steps

1. `npm run dev`, then open `http://localhost:5173` in two independent sessions (a normal window and a private/incognito window, or two different browsers).
2. Window A: Skribble, name, **Create room**; note the code. Window B: Skribble, name, paste the code, **Join room**. Confirm both players show in both lobbies and only A has **Start game**.
3. Start. Confirm the drawer sees the word and the guesser does not; draw with pencil, eraser, colours, sizes and clear, and check both canvases match.
4. Guess wrongly (visible to both), then correctly (point to the guesser, word revealed, 3 s pause, drawers swap).
5. Let one turn time out; confirm no point is awarded.
6. Leave from one window mid-match; the other should return to the lobby with a message.
7. Play to a result; press **Play again** in one window only (should wait), then in the other.
8. Repeat on a phone or in device emulation to check touch drawing and the on-screen keyboard.

## Layout of the code

- `packages/shared`: socket contracts, room/match types, game catalog, pure match engine.
- `apps/server`: Express/Socket.IO setup, `RoomManager`, match controller, game modules.
- `apps/web`: screens (`screens/`), `GameHost` (`game-host/`), game registry and game components (`games/`), theme (`styles/`).
- Adding a game: add an id and `GAME_CATALOG` entry in shared, a server module in `apps/server/src/games`, and a component plus entry in `apps/web/src/games/registry.ts`.

## Credits and licences

Headings and room codes use [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P), served locally through `@fontsource/press-start-2p` under the SIL Open Font License 1.1 (copy in `apps/web/src/assets/OFL-PressStart2P.txt`). All icons and textures are original CSS/SVG. This project is not affiliated with Mojang or Microsoft and uses no Minecraft assets.

## Verification status

Update this section with the checks you actually ran.

- Frontend (Agent 2): type check, production build and `GameHost` unit tests pass; text/background contrast pairs computed at 4.6:1 or better.
- Not yet done: full-stack integration, two-browser playthrough, touch/mobile and responsive checks at 320 px to desktop widths.

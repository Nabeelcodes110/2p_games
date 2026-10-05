# Project instructions

## Goal

Build a lightweight browser app for two people to play together remotely. The first game is Skribble: one player draws a secret word while the other guesses it. Use socket rooms and a reusable game component so more games can be added later.

Implement this specification, not a clone of the full skribbl.io product. Keep the architecture simple and readable. Do not add accounts, a database, Redis, matchmaking, spectators, AI features, or additional games unless requested.

## Default stack

- TypeScript throughout.
- Frontend: React + Vite + SCSS, and PixiJS for the drawing surface. Use SCSS modules or scoped component styles, shared variables, and mixins; do not introduce Tailwind or another styling framework.
- Backend: Node.js + Express + Socket.IO.
- Shared TypeScript socket contracts and public game types.
- npm workspaces: `apps/web`, `apps/server`, `packages/shared`.
- Use existing project conventions instead if a repository already has suitable equivalents.
- Use React for forms, chat, buttons, scoreboards, and layout. Use PixiJS for rendering and pointer input on the drawing canvas.
- Before implementation, verify installed dependency versions and use their matching APIs. Do not copy obsolete PixiJS initialization examples.

## Main user flow

1. First screen: a game-selection drawer/panel. Show Skribble as the only selectable game today, using a game registry that can support additional cards later. Selecting it proceeds to the second screen. Make the drawer a full-width panel on small phones and a bounded panel on larger screens.
2. Second screen: show selected game, display-name input, create-room and join-room options, room-code input, and a back action to game selection.
3. Creating a room stores its selected game on the server, immediately joins its creator, and displays the six-character code and copy button.
4. Joining validates the room code and capacity. The room's server-owned game selection is authoritative. If it differs from the local selection, show the actual game and synchronize the client before entering the lobby.
5. Lobby: show both players, connection status, selected game, and a waiting message until two players are connected. The host can start only with exactly two players.
6. Mount the reusable `GameHost` component with selected-game input and load the registered game inside it.
7. Results: show scores and winner or draw; offer play again and leave. Both players must agree to rematch. Reset the complete match state.

Use inline errors for invalid code, room not found, room full, disconnected socket, and invalid actions. Disable duplicate submissions while awaiting acknowledgements. Do not silently switch games in an occupied room; changing selection requires leaving and creating/joining another room.

## Rooms and memory storage

Implement a small `RoomManager` class backed by `Map<string, Room>`. This is the only room store. Room state belongs to one server process and is lost on restart. Document this explicitly in the README; do not imply multi-instance support.

- Codes are exactly six uppercase alphanumeric characters, using `A-Z` and `0-9`.
- Generate codes with Node's crypto utilities and retry on collision with existing rooms.
- Trim and uppercase join input on the server, then validate against `^[A-Z0-9]{6}$`.
- Maximum two players per room, including the creator. No spectator slots.
- One socket may belong to at most one application room. Reject create/join until it leaves its current room; make repeated requests for its current membership idempotent.
- Enforce capacity on the server, including simultaneous joins. Keep capacity check and insertion synchronous, with no asynchronous gap.
- Generate server-owned player IDs. Never trust a client-provided identity, role, score, or host flag.
- The creator is the initial host. If the host leaves, transfer hosting to the remaining player.
- Explicit leave and socket disconnect both remove the player immediately.
- If zero players remain, delete the room and dispose every game timer and resource immediately.
- If someone leaves during a match, abort the match, clear its timers and drawing state, and return the remaining player to the lobby with an explanatory message. Do not award a disconnect win.
- MVP has no reconnect grace period or reserved seat. Reconnected clients explicitly rejoin the room if it still exists and has space. Clear stale client game state.
- Membership cleanup must be idempotent. Keep a socket-to-room index and remove it on leave/disconnect.
- Leaving must also remove the socket from the Socket.IO transport room. Room codes are invite identifiers, not authentication credentials.

## Reusable game architecture

Separate room infrastructure, reusable match rules, and game-specific interactions.

- `RoomManager`: membership, codes, host, room lifecycle, and immutable selected game for that room.
- `GameHost` React component: accepts `selectedGame: GameId`, room/session context, and optional `music?: MusicConfig`. Mounts the registered game, manages its lifecycle, and presents the common timer, rounds, scores, and results. Unmount on leave, abort, or game change.
- Define a small typed game registry containing the game component and rule configuration. Start with only `skribble`. Do not hardcode Skribble inside `GameHost`.
- Keep reusable winning and round logic in the game-component layer: a shared pure `MatchEngine`/reducer used by `GameHost` and the server match controller. It owns turns, round progression, deadlines, scoring, win threshold, maximum rounds, ties, and completion. Configure these through the registry rather than duplicating them in each game.
- Server remains authoritative: run the shared match engine on the server. `GameHost` renders authoritative snapshots; it must not independently award scores or decide the winner. Keeping logic in the game-component layer does not mean trusting the browser.
- `SkribbleGame` and the server-side Skribble module own secret word assignment, drawing tools, strokes, and guess validation. Emit typed outcomes such as `correctGuess` to the match controller; do not implement round advancement or winner calculation inside Skribble.
- The server validates game outcomes before the shared match engine consumes them. Never expose a client event that directly awards points or declares a correct guess.
- Use a small game lifecycle contract for start-turn, validated actions, player-specific snapshots, turn-end, and dispose. Keep room handlers game-agnostic.
- Keep optional music configuration extensible, with fields such as source, volume, and loop. Do not add an audio library or soundtrack now. When music is supplied later, begin playback only after a user gesture, provide mute/volume controls, and stop/dispose it when the wrapper unmounts.
- Future games can add a registry entry, rule configuration, and game module without rewriting rooms or screens. Do not build an elaborate plugin framework.

## Skribble rules

The following resolves the initial rule ambiguities and is the default behavior unless the user changes it:

- A match has a maximum of five rounds.
- One round contains two drawing turns: each player draws once and guesses once. Therefore a full match has ten turns.
- Randomly choose the first drawer at match start. Alternate drawers thereafter.
- Each drawing turn lasts 60 seconds, beginning when the server assigns the word and activates the turn.
- Server chooses one word from a bundled, family-friendly English word list. Avoid repeated words within a match. Word selection UI is out of scope.
- Only the drawer receives the secret word. The guesser sees masked letters and word length, never the answer until the turn ends.
- The guesser may submit multiple guesses. Compare using trimmed, case-insensitive text with repeated whitespace collapsed. Use exact normalized matching; no fuzzy matching.
- A correct guess awards exactly one win/point to the guesser, awards nothing to the drawer, and ends the turn immediately.
- A timeout awards no points and ends the turn.
- Reveal the word to both players after the turn ends. Show a three-second result interval before the next turn.
- The first player to reach five wins ends the match immediately and wins. Do not add extra turns to equalize opportunities after reaching five.
- Otherwise finish all five rounds: higher score wins; equal scores produce a draw. No sudden death.
- Always show round number (1–5), current drawer, both scores, and the countdown.
- Clear the canvas before every turn. Disable drawing and guessing during result intervals and after the match ends.

## Server authority and timing

- The server owns words, turn order, match state, score, deadline, and results.
- Model phases explicitly: lobby, active turn, turn result, and finished. Return to lobby on abort.
- Send the absolute server deadline plus server time; clients derive a countdown for display only. Do not accept client timeout or score events.
- At every draw/guess action, check membership, role, current match ID, current turn ID, phase, and server deadline.
- Reject actions received at or after the deadline, even if the timeout callback has not executed yet.
- A turn can finish exactly once. Prevent a correct guess and timeout from both awarding points or advancing the game twice.
- Timer callbacks must verify their captured match/turn IDs before mutating state.
- Dispose timers on abort, deletion, rematch, and match completion. Do not leave orphan intervals running.
- Build sanitized public snapshots explicitly. Never broadcast or serialize an internal room/game object containing the secret word. Send the word directly only to the drawer; reveal it publicly only after the turn ends.

## Drawing and guessing

- Support mouse and touch using pointer events; prevent page scrolling only while interacting with the canvas.
- Required tools: pencil, eraser, a visible colour palette, brush size, and clear canvas. Show the selected tool and colour clearly. Pencil uses the selected colour; eraser removes strokes against the plain canvas background consistently on both clients. Synchronize tool/width/colour in each stroke payload. Undo is out of scope.
- Only the drawer may submit drawing actions. The other player views the canvas live.
- Use a fixed logical canvas aspect ratio with normalized coordinates so drawing matches on different screen sizes.
- Represent strokes as bounded point batches with a server sequence number. Render locally immediately, relay accepted batches, and avoid drawing echoed local strokes twice.
- Check colour, width, coordinate ranges, batch size, turn ID, and stroke lifecycle on the server. Never relay arbitrary client objects.
- A clear action is ordered with strokes; reject points for a stroke invalidated by clear. Reset stroke state at turn boundaries.
- Keep bounded drawing history for the current turn, and clear it on the next turn or abort. Put explicit limits on points/history so memory cannot grow indefinitely.
- React owns guessing/chat UI. Show incorrect guesses and system messages to both players. Show a generic success message for a correct guess, then reveal the answer through the turn-result event.
- Keep message history bounded. Render user text as plain text; never inject HTML.
- Destroy PixiJS resources, remove pointer handlers, and unregister specific socket listeners when components unmount. Never remove all listeners indiscriminately from a shared socket.

## Socket contracts

Define typed payloads, acknowledgements, and error codes in `packages/shared`. TypeScript types are not runtime validation: validate every incoming payload on the server.

Include `selectedGame` in create payloads; validate it against the server registry and include the authoritative `gameId` in room snapshots.

Suggested client events: `room:create`, `room:join`, `room:leave`, `game:start`, `game:rematch-ready`, `skribble:stroke`, `skribble:clear`, `skribble:guess`.

Suggested server events: `room:state`, `game:state`, `skribble:word` (drawer only), `skribble:stroke`, `skribble:clear`, `skribble:guess-result`, `game:aborted`.

- Use acknowledgement results for requested actions, with a consistent success/error union.
- Derive the sender's room and identity from server membership, never from payload claims.
- Include match/turn IDs and state revisions where needed to reject stale actions and snapshots.
- Bound display names, guesses, message history, event payloads, and drawing throughput. Add modest per-socket limits for room requests, guesses, and stroke traffic.
- Configure permitted frontend origins through environment variables. Keep secrets out of source control.

## Minecraft-inspired theme, animation, and responsive UX

Use an original Minecraft-inspired block/pixel aesthetic throughout game selection, rooms, lobby, game, and results.

- Square corners, chunky borders, bevelled stone-style buttons, pixel icons, subtle grass/dirt/wood textures, and inventory-slot styling for tools and game cards.
- Theme tokens in shared SCSS: grass green `#5D8C3E`, dirt brown `#79553A`, stone grey `#757575`, charcoal `#252525`, sky blue `#8DC9EE`, parchment `#F5E8C8`, and gold `#F2C94C`. Check text contrast; adjust shades where necessary.
- Use an appropriately licensed, locally hosted pixel-style font for headings and room codes; use a readable font for chat, guesses, labels, and instructions. Preserve font license information.
- Build simple original textures/icons with CSS, SVG, or small pixel assets. Do not depend on Minecraft logos or extracted game assets.
- Home: blocky game-selection drawer with a Skribble card. Room screen: crafting-panel-style form. Lobby: inventory-style player cards. Game: stone/wood frame around a plain, high-contrast drawing canvas and inventory-slot tool palette.
- Preserve normal continuous freehand pencil drawing; the pixel theme must not force strokes onto a block grid.
- Animate drawer opening, screen entry/exit, button hover/press, lobby player arrival, active-player changes, correct guesses, turn results, and final victory. Prefer short 150–250 ms transform/opacity transitions and small bounded particles for game feedback.
- Animations must not delay turn activation, block input, change server timing, or conceal errors. Honor `prefers-reduced-motion`; suppress particles and nonessential motion.
- Mobile-first layouts from 320 px wide through tablets and large desktops. Desktop can place chat beside the canvas; phones stack it below. Keep the canvas aspect ratio consistent and compute pointer coordinates from its actual bounds.
- Support portrait and landscape, dynamic viewport height, safe-area insets, orientation changes, browser zoom, and the mobile keyboard. Keep guess input visible when typing. Avoid horizontal page overflow.
- Use Pointer Events for mouse, touch, and stylus. Capture active drawing pointers; handle `pointerup`, `pointercancel`, lost capture, and unmount. Ignore additional touches during a stroke and finish/cancel it safely on resize or orientation change.
- Use `touch-action: none` only on the drawing surface, not the page. Keep the rest of the page scrollable. Provide labelled tool buttons, visible keyboard focus, Enter-to-submit guesses, and at least 44 px touch targets.
- Scale PixiJS backing resolution appropriately for device pixel ratio, with a reasonable cap on high-density devices. Resize without deleting current strokes; replay logical stroke data when needed.
- Validate layout and interaction at 320 px, common phone widths, tablet, laptop, and wide desktop sizes, plus a real or emulated touch device. Check canvas accuracy, eraser synchronization, keyboard behavior, and scrolling.

Do not use a PixiJS ticker or React state updates for every received point if direct rendering suffices. Batch network points for responsive drawing without flooding the socket.

## Three-agent implementation assignments

Use exactly three implementation agents when parallel agent work is available. Agree on shared contracts first; each agent owns its assigned modules and avoids editing another agent's files without coordination. If agents are unavailable, implement the same three workstreams sequentially.

### Agent 1 — Socket logic and in-memory room storage

Own `apps/server` room infrastructure and shared socket contracts. Build Express/Socket.IO setup, `RoomManager`, code generation, membership, capacity enforcement, selected-game validation, host transfer, acknowledgements, snapshots, and leave/disconnect cleanup. Provide transport handlers that delegate game actions to the registered controller. Integrate the authoritative match controller supplied by Agent 3. Test room lifecycle and unauthorized actions. Do not implement UI or duplicate match rules.

### Agent 2 — Screens, theme, and reusable game component

Own frontend application shell, SCSS, game-selection drawer, room creation/join screen, lobby, socket-client integration, and `GameHost`. Implement selected-game and optional-music props, registry mounting, common scoreboard/timer/results presentation, Minecraft-inspired styling, screen animations, accessibility, and responsive layouts. Render match state supplied by the server using shared types. Coordinate with Agent 3 on the game mounting interface. Do not write a separate scoring or round algorithm in UI code.

### Agent 3 — Skribble and shared match logic

Own `SkribbleGame`, PixiJS drawing and tool controls, guess UI, game animations, server-side word/guess/stroke validation, and the shared pure match engine in `packages/shared`. Keep the engine's reusable rounds/winning logic separate from Skribble interactions, and expose it through the game-component layer used by Agent 2 and authoritative server controller used by Agent 1. Implement turn lifecycle, bounded stroke history, secret-word isolation, and music-input compatibility through the wrapper contract. Test match rules, races, drawing permissions, and lifecycle disposal.

Before parallel changes, agree on `GameId`, `MusicConfig`, `GameHost` props, room/player snapshots, match phases, rule configuration, match/turn IDs, outcome types, socket events, and error acknowledgements. Finish with an integrated two-browser playthrough; individual modules passing alone are insufficient.

## Implementation and verification

Build in working increments: room flow, reusable game host, authoritative turn lifecycle, live drawing, guessing/scoring, then responsive polish. Keep business logic independent of React and socket wiring where practical.

Add meaningful tests for:

- Code format, collision retry, simultaneous joins, third-player rejection, and membership restrictions.
- Leave/disconnect cleanup, host transfer, empty-room deletion, and timer disposal.
- Five rounds/two turns per round, alternating drawers, correct guesses, timeout, threshold winner, end-of-round winner, and draw.
- Secret word isolation, unauthorized drawing/guessing, stale turn events, duplicate correct guesses, and timeout/guess races.
- Rematch reset and both players' consent.

Use fake clocks for timers. Manually verify with two independent browser sessions: create/join, draw/guess in both directions, timeout, clear, leave, rematch, and mobile pointer input. Run type checking, tests, and production builds before declaring completion.

Provide a README with setup commands, environment examples, game rules, two-browser testing steps, and the single-process in-memory limitation. Report actual checks run and any remaining issues. Do not claim tests or multiplayer verification passed unless performed.

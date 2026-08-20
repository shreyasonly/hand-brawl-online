# HAND BRAWL

An online 2-player pixel-art fighting game controlled with hand gestures.

**Two laptops. Two webcams. One match.**

```
                    GitHub
                       |            git push deploys BOTH:
          +------------+------------+
          |                         |
       Vercel                 Render (or any Node host)
          |                         |
  HAND BRAWL WEBSITE       COLYSEUS GAME SERVER
  (Phaser + vision)        (Node + TS, ws://)
          |                         |
   PLAYER 1   PLAYER 2   <----------+
   LAPTOP     LAPTOP        one authoritative GameRoom
   webcam     webcam        slots · ready · countdown ·
   MediaPipe  MediaPipe     round clock · health · score ·
   gestures   gestures      disconnect/reconnect truth
```

Each browser runs its own computer vision locally and sends **only gameplay
intent** — never video, never camera frames, never hand or face imagery.

---

## Architecture

```
Camera  ->  HandTracker      (TensorFlow.js + MediaPipe Hands, 1 hand)
        ->  GestureRecognizer (fingerpose + geometric pinch test)
        ->  GestureSmoother   (debounce, cooldowns, dead zone)
        ->  GameAction
        ->  InputManager
        ->  GameServerSession (WebSocket)
        ->  COLYSEUS GameRoom  (validates, updates authoritative state)
        ->  Opponent's InputManager
        ->  Phaser
```

The computer-vision stack lives in `src/vision` + `src/gestures` and knows
nothing about Phaser. Phaser only ever sees a `PlayerInputState`.

### One device = one player

The camera on your laptop controls **your fighter only**. There is no
"left hand = P1, right hand = P2" — the hand detector is hard-limited to a
single hand (`maxHands: 1`), and the opponent's fighter is driven purely by
messages arriving from the Colyseus game server.

### Who is Player 1?

The **server** decides, never the client:

| Action | What happens |
| --- | --- |
| `CREATE LOBBY` | The Colyseus server creates a `GameRoom` keyed by a 6-character code → you are the first session → **PLAYER 1** |
| `JOIN LOBBY` | Colyseus matches the code to the existing room → you are the second session → **PLAYER 2**, and the room locks |
| Wrong code / room full | `ROOM NOT FOUND (OR ALREADY FULL)` |

Slots are sticky: the server remembers `sessionId -> slot`, so even after a
reconnect you come back as the same player.

### Match authority

The local fighter is simulated locally so controls feel instant; everything
both screens must AGREE on comes from the server:

| Concern | Owner |
| --- | --- |
| Your fighter's movement + animation | your browser (instant, no round-trip) |
| Hits **your** fighter lands | your browser resolves, the **server validates** (damage caps, range, rate) and applies them to authoritative HP |
| Your fighter's position snapshot | your browser (`state`, 10 Hz, relayed) |
| Ready / match start / countdown | **SERVER** |
| Round clock, KO, round results, winner | **SERVER** |
| "Opponent disconnected" | **SERVER** (it owns the sockets - clients never guess) |

Because each client only resolves hits thrown by the fighter it owns - and the
server owns the resulting health - a punch is never counted twice and the two
screens cannot drift.

---

## Gesture controls

| Gesture | Action |
| --- | --- |
| ✊ Fist | PUNCH |
| ✋ Open palm | BLOCK *(held)* |
| ✌ Two fingers | KICK |
| ☝ Index finger | SPECIAL |
| 🤏 Pinch | GRAB |
| 👍 Thumbs up | ULTIMATE |
| Move hand left / right | MOVE_LEFT / MOVE_RIGHT |
| Flick hand upward | JUMP |

Gesture recognition follows the approach used by
[chaitanya-chafale/Hand-Gesture-Gaming](https://github.com/chaitanya-chafale/Hand-Gesture-Gaming):
MediaPipe returns 21 hand landmarks, and
[fingerpose](https://github.com/andypotato/fingerpose) scores them against
per-finger curl + direction descriptions (`src/gestures/handGestures.ts`).
PINCH is detected geometrically instead, because curl/direction cannot express
"thumb tip touching index tip".

**Keyboard fallback** (always available, controls *your* fighter):

`A`/`D` move · `W` jump · `J` punch · `K` kick · `L` special · `I` block ·
`O` grab · `P` ultimate

---

## Setup

### 1. Install

```bash
npm install                # frontend
cd server && npm install   # game server
```

### 2. Run locally (two terminals)

```bash
npm run dev:server   # Colyseus on ws://localhost:2567
npm run dev          # vite on https://localhost:5000
```

In dev the client connects to `ws://<page-hostname>:2567` automatically - no
env vars needed on the same machine.

The dev server runs over **HTTPS** (via `@vitejs/plugin-basic-ssl`) and binds to
`0.0.0.0`, because `getUserMedia` requires a secure context. To test with two
laptops on the same Wi-Fi, open `https://<your-lan-ip>:5000` on the second one
and accept the self-signed certificate warning. (Browsers block `ws://` from an
`https://` page for non-localhost hosts, so for LAN tests either use the
deployed `wss://` server via `VITE_GAME_SERVER_URL`, or test with two browser
windows on one machine.)

### 3. Environment variables

| Variable | Where | Value |
| --- | --- | --- |
| `VITE_GAME_SERVER_URL` | Vercel (Production/Preview) | `wss://<your-game-server>` e.g. `wss://hand-brawl-server.onrender.com` |
| `VITE_GAME_SERVER_URL` | local `.env.local` (optional) | `ws://localhost:2567` (this is already the dev default) |

Without it, a production build disables online play with an on-screen
explanation and PRACTICE mode keeps working. Vite inlines `VITE_*` variables at
**build** time - after changing them in Vercel you must redeploy.

### 4. Build

```bash
npm run build              # frontend: tsc + vite build -> dist/
cd server && npm run build # server:   tsc -> dist/
```

### 5. Test online play end-to-end (two real browsers)

```bash
# with dev:server and dev running:
node tests/e2e-online.cjs
```

---

## Deploy

### Game server (Render - simplest path)

`render.yaml` in the repo root is a ready-made blueprint:

1. <https://dashboard.render.com> → **New → Blueprint** → connect this repo.
2. Render creates the `hand-brawl-server` web service from `server/`.
3. Copy the service URL, e.g. `https://hand-brawl-server.onrender.com`.

Every future `git push` redeploys the server automatically. Any other Node
host with a persistent process + WebSockets (Railway, Fly.io, a VPS, Colyseus
Cloud) works the same way: `cd server && npm install && npm run build && npm start`
with `PORT` provided by the host.

> Free-plan note: Render spins the free instance down after ~15 idle minutes;
> the next connection waits ~30-60s while it wakes. Upgrade if that bothers you.

### Frontend (Vercel - unchanged)

1. Keep the existing GitHub → Vercel integration; `npm run build` → `dist/`.
2. Add **`VITE_GAME_SERVER_URL`** = `wss://<your-render-url>` under
   **Settings → Environment Variables** (Production + Preview).
3. Redeploy (or just push).

---

## Playing a match

**Laptop 1**

1. Open the Vercel URL → `CREATE LOBBY`
2. Share the 6-character room code (e.g. `X7K92P`)
3. `ENABLE CAMERA` → wait for `FACE DETECTED ✓` and `HAND DETECTED ✓`
4. Pick **JACK** → `READY`

**Laptop 2**

1. Open the same URL → `JOIN LOBBY` → type `X7K92P`
2. `ENABLE CAMERA` → wait for `FACE DETECTED ✓` and `HAND DETECTED ✓`
3. Pick **KIRA** → `READY`

Then: `3 · 2 · 1 · FIGHT!` — best of 3 rounds, 60 seconds each. Press `R` (or
click the prompt) for a rematch; both players must agree.

If a player's connection drops, the **server** notices (it owns the sockets),
pauses the round clock and tells the other player `OPPONENT DISCONNECTED`. The
dropped client auto-reconnects with its reconnection token and resumes in the
same slot with the same score. If they stay gone past the ~20s grace window,
the remaining player wins the match. Deliberately leaving (ESC / closing the
tab) ends the match immediately instead of making the opponent wait.

---

## Privacy

- The webcam stream is opened, processed and displayed **entirely in your own
  browser**.
- The only things that cross the network are: room presence, your fighter
  choice, ready state, three booleans (`camera on` / `face seen` / `hand seen`),
  your gameplay actions, your fighter's position and health, and match events.
- Face **detection** answers one question locally: "is someone sitting here?"
- The optional face **profile** (a normalised keypoint signature, stored in
  `localStorage`) only greets you by name on your own machine. It never leaves
  the device and never influences which player slot you get — the lobby decides
  that.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | HTTPS dev server on `0.0.0.0:5000` |
| `npm run dev:server` | Colyseus game server on `:2567` (watch mode) |
| `npm run build` | Type-check then build the frontend to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:gestures` | Score every canonical hand pose against the real gesture descriptions |
| `node tests/e2e-online.cjs` | Two-browser online match E2E (needs dev + dev:server running) |

---

## Project layout

```
server/
  src/
    index.ts                 Colyseus server bootstrap (+ /health endpoint)
    rooms/GameRoom.ts        THE authority: slots, ready, countdown, clock,
                             hit validation, health, score, reconnect grace
    state/GameState.ts       replicated schema: GameState + PlayerState
src/
  config/Constants.ts        tuning: arena, round rules, network cadence
  net/
    Protocol.ts              wire message types (gameplay intent only)
    GameServerSession.ts     WebSocket session to the Colyseus GameRoom
    SupabaseClient.ts        (legacy, unused) old Supabase client
    RoomSession.ts           (legacy, unused) old presence-based netcode
    Emitter.ts               tiny typed event emitter
  vision/
    CameraManager.ts         this laptop's webcam stream
    HandTracker.ts           TF.js + MediaPipe Hands, one hand, landmark overlay
    FaceDetector.ts          MediaPipe face detector + local-only profile
    VisionPipeline.ts        camera -> gesture intent, Phaser-free
  gestures/
    GestureConfig.ts         gesture/action enums, thresholds, cooldowns
    handGestures.ts          fingerpose GestureDescriptions
    GestureRecognizer.ts     fingerpose + geometric pinch + fallback
    GestureClassifier.ts     geometric classifier (fallback + pinch maths)
    GestureSmoother.ts       debounce, cooldowns, hold vs. one-shot
  input/InputManager.ts      local input, network input, strict slot ownership
  game/
    GameManager.ts           match state, mode, authority
    CombatSystem.ts          hitboxes, combos, hit feel, hit authority
    CameraController.ts      dynamic zoom / follow
  characters/                Character, Jack, Kira (+ network sync helpers)
  graphics/                  procedural 16-bit sprite sheets
  audio/                     WebAudio SFX
  scenes/                    Boot, Menu, Lobby, Setup, Select, Fight, HowToPlay
  ui/DomUI.ts                camera PIP, room-code modal, connection badge
tests/gestures.test.cjs      gesture description regression test
```

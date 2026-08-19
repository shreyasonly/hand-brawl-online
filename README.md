# HAND BRAWL

An online 2-player pixel-art fighting game controlled with hand gestures.

**Two laptops. Two webcams. One match.**

```
                    GitHub
                       |
                    Vercel
                       |
             HAND BRAWL WEBSITE
                       |
              Supabase Realtime
              /                \
       PLAYER 1                PLAYER 2
       LAPTOP                  LAPTOP
       webcam                  webcam
       TF.js + MediaPipe       TF.js + MediaPipe
       hand gestures           hand gestures
       JACK                    KIRA
              \                /
                 SAME MATCH
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
        ->  RoomSession
        ->  Supabase Realtime  (broadcast + presence)
        ->  Opponent's InputManager
        ->  Phaser
```

The computer-vision stack lives in `src/vision` + `src/gestures` and knows
nothing about Phaser. Phaser only ever sees a `PlayerInputState`.

### One device = one player

The camera on your laptop controls **your fighter only**. There is no
"left hand = P1, right hand = P2" — the hand detector is hard-limited to a
single hand (`maxHands: 1`), and the opponent's fighter is driven purely by
messages arriving over Supabase Realtime.

### Who is Player 1?

The **room** decides, never the client:

| Action | What happens |
| --- | --- |
| `CREATE LOBBY` | Subscribe to a fresh channel, confirm via presence that the room is empty → you are the first player → **PLAYER 1** |
| `JOIN LOBBY` | Subscribe to that room's channel, confirm via presence that exactly one player is already there → you are the second player → **PLAYER 2** |
| 0 players present | `ROOM NOT FOUND` |
| 2 players present | `ROOM IS FULL` |

Afterwards both browsers re-derive the slots from the same shared presence
state (ordered by join time, tie-broken by client id), so they can never
disagree.

### Match authority

Both browsers simulate the fight, so authority is split to keep them honest:

| Concern | Owner |
| --- | --- |
| Your fighter's movement + animation | your browser |
| Hits **your** fighter lands | your browser (broadcast as `HIT`) |
| Your fighter's position/HP snapshot | your browser (`STATE`, 10 Hz) |
| Round clock, round results, winner | **PLAYER 1** (`MATCH` messages) |

Because each client only resolves hits thrown by the fighter it owns, a punch
is never counted twice.

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
npm install
```

### 2. Create a Supabase project

1. Create a free project at <https://supabase.com>.
2. Open **Project Settings → API** and copy the **Project URL** and the
   **anon / public** key.
3. No database tables and no SQL are needed — the game uses Realtime
   **broadcast** and **presence** only.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`.env.local` is git-ignored. **Never commit real keys, and never put the
`service_role` key in this project** — it is a browser bundle.

Without these variables the game still builds and runs; online play is disabled
with an on-screen explanation and PRACTICE mode keeps working.

### 4. Run locally

```bash
npm run dev
```

The dev server runs over **HTTPS** (via `@vitejs/plugin-basic-ssl`) and binds to
`0.0.0.0`, because `getUserMedia` requires a secure context. To test with two
laptops on the same Wi-Fi, open `https://<your-lan-ip>:5000` on the second one
and accept the self-signed certificate warning.

### 5. Build

```bash
npm run build     # tsc + vite build -> dist/
npm run preview   # serve the production build
```

---

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project** and import the repo.
3. Vercel detects Vite automatically (`vercel.json` pins it anyway):
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add both environment variables under **Settings → Environment Variables**
   (Production, Preview and Development):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Vercel serves over HTTPS, so the webcam works out of the box.

> Vite inlines `VITE_*` variables at **build** time. After changing them in
> Vercel you must redeploy for the change to take effect.

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

If a player drops, the other sees `OPPONENT DISCONNECTED` and the match pauses
until they come back. Supabase Realtime rejoins the channel automatically and
presence is re-published on reconnect.

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
| `npm run build` | Type-check then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:gestures` | Score every canonical hand pose against the real gesture descriptions |

---

## Project layout

```
src/
  config/Constants.ts        tuning: arena, round rules, network cadence
  net/
    Protocol.ts              wire message types (gameplay intent only)
    SupabaseClient.ts        Realtime client + env validation
    RoomSession.ts           channel, presence, slot assignment, reconnect
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

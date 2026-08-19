/**
 * Global tuning constants shared by the Phaser game, the network layer and the
 * computer-vision pipeline.
 */

/** Internal (pixel-art) resolution of the Phaser canvas. */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;

/** Arena bounds - the floor sits at ARENA_FLOOR_Y. */
export const ARENA_FLOOR_Y = 310;
export const P1_SPAWN_X = 180;
export const P2_SPAWN_X = 460;
export const SPAWN_Y = 260;

/** Match rules. */
export const ROUND_TIME_SECONDS = 60;
export const ROUNDS_TO_WIN = 2;

/** Networking cadence. */
export const NET = {
  /** Max Supabase Realtime broadcast messages per second (client -> server). */
  eventsPerSecond: 40,
  /** How often the owner of a fighter re-broadcasts its authoritative state. */
  stateSyncIntervalMs: 100,
  /** Re-send held-input state even when unchanged, so a dropped packet heals. */
  inputKeepaliveMs: 400,
  /** How long the opponent may be silent before we call them disconnected. */
  opponentTimeoutMs: 6000,
  /** Correction strength when reconciling the remote fighter's position. */
  positionLerp: 0.25,
  /** Above this pixel error we snap instead of lerping. */
  positionSnapDistance: 90
} as const;

/** Computer-vision cadence (kept low enough to leave GPU time for Phaser). */
export const VISION = {
  handIntervalMs: 55,
  faceIntervalMs: 260,
  videoWidth: 640,
  videoHeight: 480
} as const;

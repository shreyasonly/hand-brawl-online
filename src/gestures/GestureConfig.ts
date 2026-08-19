export enum Gesture {
  NONE = 'NONE',
  FIST = 'FIST',
  OPEN_PALM = 'OPEN_PALM',
  VICTORY = 'VICTORY',
  INDEX = 'INDEX',
  PINCH = 'PINCH',
  THUMBS_UP = 'THUMBS_UP'
}

export enum Action {
  NONE = 'NONE',
  MOVE_LEFT = 'MOVE_LEFT',
  MOVE_RIGHT = 'MOVE_RIGHT',
  JUMP = 'JUMP',
  PUNCH = 'PUNCH',
  KICK = 'KICK',
  BLOCK = 'BLOCK',
  GRAB = 'GRAB',
  SPECIAL = 'SPECIAL',
  ULTIMATE = 'ULTIMATE'
}

/**
 * Gesture -> game action mapping.
 *
 *   FIST        (fist)          -> PUNCH
 *   OPEN_PALM   (open palm)     -> BLOCK      (held, not a one-shot)
 *   VICTORY     (two fingers)   -> KICK
 *   INDEX       (index finger)  -> SPECIAL
 *   PINCH       (pinch)         -> GRAB
 *   THUMBS_UP   (thumbs up)     -> ULTIMATE
 *
 * Hand movement left/right  -> MOVE_LEFT / MOVE_RIGHT
 * Upward hand flick         -> JUMP
 */
export const GESTURE_ACTIONS: Record<Gesture, Action> = {
  [Gesture.NONE]: Action.NONE,
  [Gesture.FIST]: Action.PUNCH,
  [Gesture.OPEN_PALM]: Action.BLOCK,
  [Gesture.VICTORY]: Action.KICK,
  [Gesture.INDEX]: Action.SPECIAL,
  [Gesture.PINCH]: Action.GRAB,
  [Gesture.THUMBS_UP]: Action.ULTIMATE
};

export interface GestureSetting {
  /** Minimum 0..1 confidence before the gesture counts at all. */
  confidenceThreshold: number;
  /** Consecutive frames the gesture must hold before it fires. */
  stabilityFrames: number;
  /** Minimum delay between two firings of this gesture. */
  cooldownMs: number;
  /** When true the hand must leave the pose before it can fire again. */
  requiresRelease: boolean;
}

export const GESTURE_SETTINGS: Record<Gesture, GestureSetting> = {
  [Gesture.NONE]: { confidenceThreshold: 0.5, stabilityFrames: 1, cooldownMs: 0, requiresRelease: false },
  [Gesture.FIST]: { confidenceThreshold: 0.78, stabilityFrames: 2, cooldownMs: 260, requiresRelease: true },
  [Gesture.OPEN_PALM]: { confidenceThreshold: 0.78, stabilityFrames: 2, cooldownMs: 80, requiresRelease: false },
  [Gesture.VICTORY]: { confidenceThreshold: 0.80, stabilityFrames: 2, cooldownMs: 340, requiresRelease: true },
  [Gesture.INDEX]: { confidenceThreshold: 0.80, stabilityFrames: 3, cooldownMs: 650, requiresRelease: true },
  [Gesture.PINCH]: { confidenceThreshold: 0.75, stabilityFrames: 2, cooldownMs: 560, requiresRelease: true },
  [Gesture.THUMBS_UP]: { confidenceThreshold: 0.85, stabilityFrames: 3, cooldownMs: 1000, requiresRelease: true }
};

export const MOVEMENT_CONFIG = {
  /** Horizontal dead zone around the frame centre, as a fraction of the frame. */
  deadzone: 0.08,
  /** Exponential smoothing factor for the wrist position. */
  smoothingAlpha: 0.35,
  /** Upward normalised velocity that triggers a JUMP. */
  jumpThresholdY: 0.075,
  jumpCooldownMs: 550
} as const;

/** Minimum fingerpose score (0..10) before a pose is accepted. */
export const FINGERPOSE_MIN_SCORE = 7.5;

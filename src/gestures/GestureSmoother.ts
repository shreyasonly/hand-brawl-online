import { Action, GESTURE_ACTIONS, GESTURE_SETTINGS, Gesture, MOVEMENT_CONFIG } from './GestureConfig';
import { RecognizedGesture } from './GestureRecognizer';

/**
 * What one camera frame means for the LOCAL fighter.
 *
 * `hold` values are continuous states (walking, blocking) and `events` are
 * edge-triggered one-shots (punch, kick, jump...). Splitting them is what makes
 * the networked opponent walk smoothly instead of twitching one frame per
 * packet.
 */
export interface GestureIntent {
  handPresent: boolean;
  moveDirection: 'LEFT' | 'RIGHT' | 'STOP';
  blocking: boolean;
  events: Action[];
  gesture: Gesture;
  confidence: number;
  smoothedX: number;
  smoothedY: number;
}

export const EMPTY_INTENT: GestureIntent = {
  handPresent: false,
  moveDirection: 'STOP',
  blocking: false,
  events: [],
  gesture: Gesture.NONE,
  confidence: 0,
  smoothedX: 0.5,
  smoothedY: 0.5
};

/**
 * Smooths the wrist position, debounces gestures and enforces per-gesture
 * cooldowns so a single held pose does not machine-gun attacks.
 */
export class GestureSmoother {
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private prevRawY = 0.5;
  private hasSample = false;

  private history: Gesture[] = [];
  private lastFiredAt: Partial<Record<Gesture, number>> = {};
  private awaitingReleaseOf: Gesture | null = null;

  private lastJumpAt = 0;

  /** Frame centre the hand is measured against - recalibrated on demand. */
  private centerX = 0.5;

  public process(
    hand: { wrist: { x: number; y: number } } | null,
    recognized: RecognizedGesture,
    now: number
  ): GestureIntent {
    if (!hand) {
      this.history.push(Gesture.NONE);
      if (this.history.length > 6) this.history.shift();
      this.awaitingReleaseOf = null;
      this.hasSample = false;
      return { ...EMPTY_INTENT, smoothedX: this.smoothedX, smoothedY: this.smoothedY };
    }

    const { x: rawX, y: rawY } = hand.wrist;

    if (!this.hasSample) {
      this.smoothedX = rawX;
      this.smoothedY = rawY;
      this.prevRawY = rawY;
      this.hasSample = true;
    }

    const alpha = MOVEMENT_CONFIG.smoothingAlpha;
    this.smoothedX = alpha * rawX + (1 - alpha) * this.smoothedX;
    this.smoothedY = alpha * rawY + (1 - alpha) * this.smoothedY;

    // --- movement -----------------------------------------------------------
    let moveDirection: 'LEFT' | 'RIGHT' | 'STOP' = 'STOP';
    const offset = this.smoothedX - this.centerX;
    if (offset < -MOVEMENT_CONFIG.deadzone) moveDirection = 'LEFT';
    else if (offset > MOVEMENT_CONFIG.deadzone) moveDirection = 'RIGHT';

    // --- jump (upward flick) ------------------------------------------------
    const events: Action[] = [];
    const upwardDelta = this.prevRawY - rawY; // screen Y grows downward
    this.prevRawY = rawY;

    if (
      upwardDelta > MOVEMENT_CONFIG.jumpThresholdY &&
      now - this.lastJumpAt > MOVEMENT_CONFIG.jumpCooldownMs
    ) {
      this.lastJumpAt = now;
      events.push(Action.JUMP);
    }

    // --- gesture debounce ---------------------------------------------------
    const settings = GESTURE_SETTINGS[recognized.gesture] ?? GESTURE_SETTINGS[Gesture.NONE];
    const passesConfidence =
      recognized.gesture !== Gesture.NONE && recognized.confidence >= settings.confidenceThreshold;

    this.history.push(passesConfidence ? recognized.gesture : Gesture.NONE);
    if (this.history.length > 6) this.history.shift();

    const required = settings.stabilityFrames;
    const recent = this.history.slice(-required);
    const isStable =
      passesConfidence &&
      recent.length >= required &&
      recent.every((g) => g === recognized.gesture);

    // Release gate: an attack pose must be dropped before it can fire again.
    if (this.awaitingReleaseOf && recognized.gesture !== this.awaitingReleaseOf) {
      this.awaitingReleaseOf = null;
    }

    const blocking = isStable && recognized.gesture === Gesture.OPEN_PALM;

    if (isStable && recognized.gesture !== Gesture.OPEN_PALM) {
      const action = GESTURE_ACTIONS[recognized.gesture];
      const lastFired = this.lastFiredAt[recognized.gesture] ?? 0;
      const cooledDown = now - lastFired >= settings.cooldownMs;
      const released = this.awaitingReleaseOf !== recognized.gesture;

      if (action !== Action.NONE && cooledDown && released) {
        events.push(action);
        this.lastFiredAt[recognized.gesture] = now;
        if (settings.requiresRelease) this.awaitingReleaseOf = recognized.gesture;
      }
    }

    return {
      handPresent: true,
      moveDirection,
      blocking,
      events,
      gesture: isStable ? recognized.gesture : Gesture.NONE,
      confidence: recognized.confidence,
      smoothedX: this.smoothedX,
      smoothedY: this.smoothedY
    };
  }

  /** Treat the hand's current position as "neutral / standing still". */
  public calibrateCenter(x?: number): void {
    this.centerX = x ?? this.smoothedX;
  }

  public reset(): void {
    this.history = [];
    this.lastFiredAt = {};
    this.awaitingReleaseOf = null;
    this.hasSample = false;
    this.centerX = 0.5;
  }
}

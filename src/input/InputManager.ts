import { Action } from '../gestures/GestureConfig';
import { GestureIntent, EMPTY_INTENT } from '../gestures/GestureSmoother';
import { GameServerSession } from '../net/GameServerSession';
import { InputMessage, PlayerSlot, slotToIndex } from '../net/Protocol';
import { NET } from '../config/Constants';

export interface PlayerInputState {
  moveLeft: boolean;
  moveRight: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  block: boolean;
  grab: boolean;
  special: boolean;
  ultimate: boolean;
}

interface HoldState {
  left: boolean;
  right: boolean;
  block: boolean;
}

export type InputMode = 'ONLINE' | 'PRACTICE';

const emptyInput = (): PlayerInputState => ({
  moveLeft: false,
  moveRight: false,
  jump: false,
  punch: false,
  kick: false,
  block: false,
  grab: false,
  special: false,
  ultimate: false
});

/** Keyboard fallback for the player sitting at THIS laptop. */
const LOCAL_KEYS: Record<string, Action> = {
  KeyA: Action.MOVE_LEFT,
  KeyD: Action.MOVE_RIGHT,
  KeyW: Action.JUMP,
  KeyJ: Action.PUNCH,
  KeyK: Action.KICK,
  KeyL: Action.SPECIAL,
  KeyI: Action.BLOCK,
  KeyO: Action.GRAB,
  KeyP: Action.ULTIMATE
};

/** Second keyboard scheme, only used by the offline PRACTICE match. */
const PRACTICE_P2_KEYS: Record<string, Action> = {
  ArrowLeft: Action.MOVE_LEFT,
  ArrowRight: Action.MOVE_RIGHT,
  ArrowUp: Action.JUMP,
  Digit1: Action.PUNCH,
  Digit2: Action.KICK,
  Digit3: Action.SPECIAL,
  Digit4: Action.BLOCK,
  Digit5: Action.GRAB,
  Digit6: Action.ULTIMATE
};

const HOLD_ACTIONS = new Set<Action>([Action.MOVE_LEFT, Action.MOVE_RIGHT, Action.BLOCK]);

/**
 * Converts local gestures + local keys into game input, ships that input to the
 * opponent over Supabase Realtime, and exposes the opponent's input as if it
 * were a second local controller.
 *
 * Hard rule enforced here: a browser only ever DRIVES the fighter in its own
 * assigned slot. The other fighter is driven purely by messages arriving from
 * the network.
 */
export class InputManager {
  private room = GameServerSession.getInstance();

  private mode: InputMode = 'PRACTICE';

  private keysDown: Record<string, boolean> = {};
  private keyPressQueue: Array<{ action: Action; scheme: 'LOCAL' | 'P2' }> = [];

  private intent: GestureIntent = { ...EMPTY_INTENT };
  private pendingGestureEvents: Action[] = [];

  private localHold: HoldState = { left: false, right: false, block: false };
  private lastSentHold: HoldState = { left: false, right: false, block: false };
  private lastSentAt = 0;
  private seq = 0;

  private remoteHold: HoldState = { left: false, right: false, block: false };
  private remoteEvents: Action[] = [];
  private lastRemoteMessageAt = 0;

  private frameInput: Record<1 | 2, PlayerInputState> = {
    1: emptyInput(),
    2: emptyInput()
  };

  constructor() {
    this.bindKeyboard();
    this.bindNetwork();
  }

  public setMode(mode: InputMode): void {
    this.mode = mode;
    this.resetAll();
  }

  public getMode(): InputMode {
    return this.mode;
  }

  /** Slot this browser drives. null while offline / in practice. */
  public get localSlot(): PlayerSlot | null {
    return this.mode === 'ONLINE' ? this.room.slot : null;
  }

  public get localPlayerIndex(): 1 | 2 {
    const slot = this.localSlot;
    return slot ? slotToIndex(slot) : 1;
  }

  /** Fed by the vision pipeline once per camera frame. */
  public feedIntent(intent: GestureIntent): void {
    this.intent = intent;
    if (intent.events.length > 0) this.pendingGestureEvents.push(...intent.events);
  }

  /** One-shot actions the local player produced on the most recent frame. */
  public get lastLocalActions(): Action[] {
    return this.lastLocalEvents;
  }

  public get opponentSilentMs(): number {
    if (this.lastRemoteMessageAt === 0) return 0;
    return Date.now() - this.lastRemoteMessageAt;
  }

  public get isOpponentResponsive(): boolean {
    return this.lastRemoteMessageAt === 0 || this.opponentSilentMs < NET.opponentTimeoutMs;
  }

  /**
   * Called once per Phaser frame BEFORE the fighters are updated. Builds this
   * frame's input for both fighters and transmits the local half.
   */
  public update(): void {
    const localIndex = this.localPlayerIndex;
    const remoteIndex: 1 | 2 = localIndex === 1 ? 2 : 1;

    const localInput = this.buildLocalInput();
    this.frameInput[localIndex] = localInput;

    if (this.mode === 'ONLINE') {
      this.frameInput[remoteIndex] = this.buildRemoteInput();
      this.transmit();
    } else {
      this.frameInput[2] = this.buildPracticeP2Input();
    }
  }

  /** Input for one fighter this frame. Never mixes the two players' sources. */
  public getPlayerInput(playerIndex: 1 | 2): PlayerInputState {
    return this.frameInput[playerIndex];
  }

  public resetAll(): void {
    this.keyPressQueue = [];
    this.pendingGestureEvents = [];
    this.localHold = { left: false, right: false, block: false };
    this.lastSentHold = { left: false, right: false, block: false };
    this.remoteHold = { left: false, right: false, block: false };
    this.remoteEvents = [];
    this.lastRemoteMessageAt = 0;
    this.frameInput = { 1: emptyInput(), 2: emptyInput() };
  }

  // ---------------------------------------------------------------------------
  // Local input
  // ---------------------------------------------------------------------------

  private buildLocalInput(): PlayerInputState {
    const input = emptyInput();

    // 1. Held state from the hand position / open palm.
    const hold: HoldState = {
      left: this.intent.moveDirection === 'LEFT',
      right: this.intent.moveDirection === 'RIGHT',
      block: this.intent.blocking
    };

    // 2. Keyboard fallback, merged on top.
    if (this.keysDown['KeyA']) hold.left = true;
    if (this.keysDown['KeyD']) hold.right = true;
    if (this.keysDown['KeyI']) hold.block = true;

    if (hold.left && hold.right) {
      hold.left = false;
      hold.right = false;
    }

    this.localHold = hold;
    input.moveLeft = hold.left;
    input.moveRight = hold.right;
    input.block = hold.block;

    // 3. One-shot events from gestures and key presses.
    const events = this.drainLocalEvents();
    for (const action of events) this.applyAction(input, action);
    this.lastLocalEvents = events;

    return input;
  }

  private lastLocalEvents: Action[] = [];

  private drainLocalEvents(): Action[] {
    const events: Action[] = [];

    for (const action of this.pendingGestureEvents) {
      if (!HOLD_ACTIONS.has(action)) events.push(action);
    }
    this.pendingGestureEvents = [];

    const remaining: Array<{ action: Action; scheme: 'LOCAL' | 'P2' }> = [];
    for (const press of this.keyPressQueue) {
      if (press.scheme === 'LOCAL') {
        if (!HOLD_ACTIONS.has(press.action)) events.push(press.action);
      } else {
        remaining.push(press);
      }
    }
    this.keyPressQueue = remaining;

    return events;
  }

  private applyAction(input: PlayerInputState, action: Action): void {
    switch (action) {
      case Action.MOVE_LEFT: input.moveLeft = true; break;
      case Action.MOVE_RIGHT: input.moveRight = true; break;
      case Action.JUMP: input.jump = true; break;
      case Action.PUNCH: input.punch = true; break;
      case Action.KICK: input.kick = true; break;
      case Action.BLOCK: input.block = true; break;
      case Action.GRAB: input.grab = true; break;
      case Action.SPECIAL: input.special = true; break;
      case Action.ULTIMATE: input.ultimate = true; break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Remote input (opponent)
  // ---------------------------------------------------------------------------

  private buildRemoteInput(): PlayerInputState {
    const input = emptyInput();

    input.moveLeft = this.remoteHold.left;
    input.moveRight = this.remoteHold.right;
    input.block = this.remoteHold.block;

    // One queued event per frame keeps attack animations from stacking.
    const next = this.remoteEvents.shift();
    if (next) this.applyAction(input, next);

    return input;
  }

  private buildPracticeP2Input(): PlayerInputState {
    const input = emptyInput();

    input.moveLeft = !!this.keysDown['ArrowLeft'];
    input.moveRight = !!this.keysDown['ArrowRight'];
    input.block = !!this.keysDown['Digit4'];

    const remaining: Array<{ action: Action; scheme: 'LOCAL' | 'P2' }> = [];
    for (const press of this.keyPressQueue) {
      if (press.scheme === 'P2') {
        if (!HOLD_ACTIONS.has(press.action)) this.applyAction(input, press.action);
      } else {
        remaining.push(press);
      }
    }
    this.keyPressQueue = remaining;

    return input;
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  private transmit(): void {
    const slot = this.room.slot;
    if (!slot || !this.room.isOnline) return;

    const now = Date.now();
    const holdChanged =
      this.localHold.left !== this.lastSentHold.left ||
      this.localHold.right !== this.lastSentHold.right ||
      this.localHold.block !== this.lastSentHold.block;

    const events = this.lastLocalEvents.filter((a) => !HOLD_ACTIONS.has(a));
    const keepaliveDue = now - this.lastSentAt >= NET.inputKeepaliveMs;

    if (!holdChanged && events.length === 0 && !keepaliveDue) return;

    const message: InputMessage = {
      type: 'INPUT',
      playerId: slot,
      seq: ++this.seq,
      timestamp: now,
      hold: { ...this.localHold },
      events
    };

    this.room.sendInput(message);
    this.lastSentHold = { ...this.localHold };
    this.lastSentAt = now;
  }

  private bindNetwork(): void {
    this.room.events.on('input', (msg) => {
      if (this.mode !== 'ONLINE') return;
      if (!this.room.slot || msg.playerId === this.room.slot) return;

      console.log('[REMOTE INPUT RECEIVED]', {
        playerId: msg.playerId,
        timestamp: msg.timestamp
      });

      this.lastRemoteMessageAt = Date.now();
      this.remoteHold = {
        left: !!msg.hold?.left,
        right: !!msg.hold?.right,
        block: !!msg.hold?.block
      };

      for (const action of msg.events ?? []) {
        if (!HOLD_ACTIONS.has(action)) this.remoteEvents.push(action);
      }
      // Never let a lag spike build a queue that replays for seconds.
      if (this.remoteEvents.length > 6) {
        this.remoteEvents = this.remoteEvents.slice(-6);
      }
    });

    // NOTE: we deliberately do NOT clear remoteHold/remoteEvents on a
    // presence diff. A single presence flap (reconnect, sync, hiccup)
    // must not suddenly freeze the remote fighter mid-fight. The
    // FightScene disconnect watchdog handles actual timeout detection.
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keysDown[e.code] = true;

      const localAction = LOCAL_KEYS[e.code];
      if (localAction) this.keyPressQueue.push({ action: localAction, scheme: 'LOCAL' });

      const p2Action = PRACTICE_P2_KEYS[e.code];
      if (p2Action && this.mode === 'PRACTICE') {
        this.keyPressQueue.push({ action: p2Action, scheme: 'P2' });
      }

      if (this.keyPressQueue.length > 12) this.keyPressQueue.shift();
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown[e.code] = false;
    });

    window.addEventListener('blur', () => {
      this.keysDown = {};
      this.keyPressQueue = [];
    });
  }
}

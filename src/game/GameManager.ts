import { InputManager } from '../input/InputManager';
import { VisionPipeline } from '../vision/VisionPipeline';
import { GameServerSession } from '../net/GameServerSession';
import { CharacterId } from '../net/Protocol';
import { ROUNDS_TO_WIN } from '../config/Constants';

export enum GameState {
  BOOT = 'BOOT',
  MAIN_MENU = 'MAIN_MENU',
  HOW_TO_PLAY = 'HOW_TO_PLAY',
  LOBBY = 'LOBBY',
  CAMERA_SETUP = 'CAMERA_SETUP',
  CHARACTER_SELECT = 'CHARACTER_SELECT',
  FIGHT_ROUND_START = 'FIGHT_ROUND_START',
  FIGHT_ACTIVE = 'FIGHT_ACTIVE',
  FIGHT_ROUND_END = 'FIGHT_ROUND_END',
  FIGHT_MATCH_END = 'FIGHT_MATCH_END'
}

export type MatchMode = 'ONLINE' | 'PRACTICE';

/**
 * Single source of truth for "which match is running and who am I in it".
 *
 * It also owns the two long-lived singletons - the vision pipeline (this
 * laptop's camera and models) and the input manager - and wires them together
 * exactly once.
 */
export class GameManager {
  private static instance: GameManager;

  public currentState: GameState = GameState.BOOT;
  public mode: MatchMode = 'PRACTICE';

  public readonly vision = VisionPipeline.getInstance();
  public readonly room = GameServerSession.getInstance();
  public readonly inputManager = new InputManager();

  public p1Character: CharacterId = 'JACK';
  public p2Character: CharacterId = 'KIRA';

  public p1RoundWins = 0;
  public p2RoundWins = 0;
  public currentRound = 1;
  public matchWinner: 1 | 2 | null = null;

  private presenceTimer: number | null = null;

  private constructor() {
    // Every camera frame becomes a local GestureIntent, and only ever drives
    // the fighter belonging to this browser.
    this.vision.onIntent((intent) => this.inputManager.feedIntent(intent));
  }

  public static getInstance(): GameManager {
    if (!GameManager.instance) GameManager.instance = new GameManager();
    return GameManager.instance;
  }

  /** 1 when this browser is PLAYER 1, 2 when it is PLAYER 2. */
  public get localIndex(): 1 | 2 {
    return this.inputManager.localPlayerIndex;
  }

  public get isOnline(): boolean {
    return this.mode === 'ONLINE' && this.room.isOnline;
  }

  /**
   * ONLINE   : the Colyseus SERVER drives round flow, the clock and the winner
   *            - BOTH browsers are followers, so the screens cannot disagree.
   * PRACTICE : this browser simulates everything itself.
   */
  public get isMatchAuthority(): boolean {
    return this.mode === 'PRACTICE';
  }

  public get localCharacter(): CharacterId {
    return this.localIndex === 1 ? this.p1Character : this.p2Character;
  }

  public setLocalCharacter(character: CharacterId): void {
    if (this.localIndex === 1) this.p1Character = character;
    else this.p2Character = character;
  }

  public startOnlineMatch(): void {
    this.mode = 'ONLINE';
    this.inputManager.setMode('ONLINE');
    this.resetMatch();
    this.startPresenceHeartbeat();
  }

  public startPracticeMatch(): void {
    this.mode = 'PRACTICE';
    this.inputManager.setMode('PRACTICE');
    this.resetMatch();
    this.stopPresenceHeartbeat();
  }

  public resetMatch(): void {
    this.p1RoundWins = 0;
    this.p2RoundWins = 0;
    this.currentRound = 1;
    this.matchWinner = null;
    this.vision.resetGestureState();
    this.inputManager.resetAll();
  }

  public recordRoundWin(winner: 1 | 2): { matchOver: boolean; winner: 1 | 2 } {
    if (winner === 1) this.p1RoundWins++;
    else this.p2RoundWins++;

    if (this.p1RoundWins >= ROUNDS_TO_WIN) {
      this.matchWinner = 1;
      return { matchOver: true, winner: 1 };
    }
    if (this.p2RoundWins >= ROUNDS_TO_WIN) {
      this.matchWinner = 2;
      return { matchOver: true, winner: 2 };
    }

    this.currentRound++;
    return { matchOver: false, winner };
  }

  /** Applies a round result decided by the match authority (PLAYER 1). */
  public applyAuthoritativeScore(p1Wins: number, p2Wins: number, round: number): void {
    this.p1RoundWins = p1Wins;
    this.p2RoundWins = p2Wins;
    this.currentRound = round;
  }

  /**
   * Publishes only booleans - "camera on / face seen / hand seen" - so the
   * other laptop can show a readiness readout. No imagery, ever.
   *
   * Runs on a 1s beat for the whole online session and re-announces even when
   * nothing changed: the repeat is what heals lost presence diffs, dropped
   * LOBBY packets and channel reconnects.
   */
  public startPresenceHeartbeat(): void {
    if (this.presenceTimer !== null) return;
    this.presenceTimer = window.setInterval(() => {
      if (!this.room.isOnline) return;
      const status = this.vision.status;
      void this.room.setVisionStatus({
        cameraEnabled: status.cameraEnabled,
        faceDetected: status.faceDetected,
        handDetected: status.handDetected
      });
    }, 1000);
  }

  public stopPresenceHeartbeat(): void {
    if (this.presenceTimer === null) return;
    window.clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }
}

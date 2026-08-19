import Phaser from 'phaser';
import { Character } from '../characters/Character';
import { Jack } from '../characters/Jack';
import { Kira } from '../characters/Kira';
import { CombatSystem } from '../game/CombatSystem';
import { CameraController } from '../game/CameraController';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';
import { DomUI } from '../ui/DomUI';
import {
  ARENA_FLOOR_Y,
  GAME_HEIGHT,
  GAME_WIDTH,
  NET,
  P1_SPAWN_X,
  P2_SPAWN_X,
  ROUND_TIME_SECONDS,
  SPAWN_Y
} from '../config/Constants';
import {
  CharacterId,
  HitMessage,
  MatchMessage,
  StateMessage,
  indexToSlot,
  slotToIndex
} from '../net/Protocol';

/**
 * The match itself.
 *
 * Both browsers run the same Phaser simulation. Each one:
 *   - drives ONLY its own fighter from local gestures / keys,
 *   - drives the opponent's fighter from INPUT messages,
 *   - resolves ONLY the hits its own fighter throws and reports them,
 *   - re-syncs the opponent's fighter from that player's STATE snapshots.
 *
 * PLAYER 1 additionally owns the round clock, round results and the winner so
 * the two screens can never disagree about the score.
 */
export class FightScene extends Phaser.Scene {
  private p1!: Character;
  private p2!: Character;

  private combatSystem!: CombatSystem;
  private cameraController!: CameraController;

  private roundTimer = ROUND_TIME_SECONDS;
  private roundTimerEvent?: Phaser.Time.TimerEvent;
  private isRoundActive = false;
  private isPausedForDisconnect = false;

  private lastStateSentAt = 0;
  private remoteSnapshot: StateMessage | null = null;
  /**
   * Local deadline: right after a round reset we ignore incoming snapshots for
   * a moment. Uses OUR clock only - the two laptops' Date.now() can differ by
   * seconds, so cross-clock timestamp comparisons are never trustworthy.
   */
  private ignoreStateUntil = 0;
  /** Grace window after we land a hit, during which snapshot HP is ignored. */
  private lastLocalHitAt = 0;
  /** Guards against replaying the same ROUND_START announcement. */
  private announcedRound = 0;

  private localRematch = false;
  private remoteRematch = false;
  private rematchPrompt?: Phaser.GameObjects.Text;

  private unsubscribers: Array<() => void> = [];

  // HUD
  private p1HpBar!: Phaser.GameObjects.Rectangle;
  private p2HpBar!: Phaser.GameObjects.Rectangle;
  private p1SpecialBar!: Phaser.GameObjects.Rectangle;
  private p2SpecialBar!: Phaser.GameObjects.Rectangle;
  private p1UltimateBar!: Phaser.GameObjects.Rectangle;
  private p2UltimateBar!: Phaser.GameObjects.Rectangle;
  private p1WinsText!: Phaser.GameObjects.Text;
  private p2WinsText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private roundTitleText!: Phaser.GameObjects.Text;
  private announcerText!: Phaser.GameObjects.Text;
  private comboTextP1!: Phaser.GameObjects.Text;
  private comboTextP2!: Phaser.GameObjects.Text;
  private disconnectText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'FightScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();

    this.isRoundActive = false;
    this.isPausedForDisconnect = false;
    this.localRematch = false;
    this.remoteRematch = false;
    this.remoteSnapshot = null;
    this.lastStateSentAt = 0;
    this.ignoreStateUntil = 0;
    this.lastLocalHitAt = 0;
    this.announcedRound = 0;

    DomUI.getInstance().showCameraPip(gm.vision.camera.state === 'READY');

    // 1. Stage
    this.add.image(320, 180, 'stage_sky').setScrollFactor(0.2);
    this.add.image(320, 180, 'stage_city').setScrollFactor(0.5);
    this.add.image(320, 180, 'stage_street').setScrollFactor(1.0);
    this.physics.world.setBounds(0, 0, GAME_WIDTH, ARENA_FLOOR_Y);

    // 2. Fighters
    this.p1 = this.createFighter(gm.p1Character, P1_SPAWN_X, SPAWN_Y, 1);
    this.p2 = this.createFighter(gm.p2Character, P2_SPAWN_X, SPAWN_Y, 2);
    this.p1.opponent = this.p2;
    this.p2.opponent = this.p1;
    this.physics.add.collider(this.p1, this.p2);

    const localIndex = gm.localIndex;
    if (gm.isOnline) {
      this.remoteFighter.isNetworkControlled = true;
    }

    // 3. Systems
    this.combatSystem = new CombatSystem(this);
    this.cameraController = new CameraController(this);
    this.combatSystem.setOwnedAttackers(gm.isOnline ? [localIndex] : [1, 2]);
    this.combatSystem.setOnHitCallback((evt) => this.onLocalHit(evt));

    // 4. HUD
    this.createHUD();

    // 5. Networking
    if (gm.isOnline) this.bindNetwork();

    // 6. Keys
    this.input.keyboard?.on('keydown-ESC', () => this.leaveMatch());
    this.input.keyboard?.on('keydown-R', () => this.requestRematch());
    this.input.keyboard?.on('keydown-B', () => gm.vision.setDebug(!gm.vision.isDebug()));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribers.forEach((off) => off());
      this.unsubscribers = [];
      this.roundTimerEvent?.remove();
    });

    // 7. Round 1.
    // PLAYER 1 waits a beat before announcing: PLAYER 2 reaches this scene a
    // network hop later, and would otherwise miss the very first ROUND_START.
    if (gm.isMatchAuthority) {
      if (gm.isOnline) {
        this.announcerText.setText('SYNCING...');
        this.time.delayedCall(900, () => this.startRoundSequence(gm.currentRound));
      } else {
        this.startRoundSequence(gm.currentRound);
      }
    } else {
      this.announcerText.setText('WAITING FOR PLAYER 1...');
    }
  }

  // ---------------------------------------------------------------------------
  // Fighters
  // ---------------------------------------------------------------------------

  private createFighter(type: CharacterId, x: number, y: number, playerIndex: 1 | 2): Character {
    return type === 'JACK'
      ? new Jack(this, x, y, playerIndex)
      : new Kira(this, x, y, playerIndex);
  }

  private get localFighter(): Character {
    return GameManager.getInstance().localIndex === 1 ? this.p1 : this.p2;
  }

  private get remoteFighter(): Character {
    return GameManager.getInstance().localIndex === 1 ? this.p2 : this.p1;
  }

  private fighterFor(index: 1 | 2): Character {
    return index === 1 ? this.p1 : this.p2;
  }

  // ---------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------

  private bindNetwork(): void {
    const gm = GameManager.getInstance();

    this.unsubscribers.push(
      gm.room.events.on('state', (msg) => {
        this.remoteSnapshot = msg;
      }),
      gm.room.events.on('hit', (msg) => this.onRemoteHit(msg)),
      gm.room.events.on('match', (msg) => this.onMatchMessage(msg)),
      gm.room.events.on('presence', (snapshot) => {
        this.setDisconnected(!snapshot.opponentPresent);
      })
    );
  }

  private onLocalHit(evt: {
    attacker: Character;
    defender: Character;
    damage: number;
    comboCount: number;
    isKO: boolean;
    type: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE';
    knockbackX: number;
    knockbackY: number;
  }): void {
    const gm = GameManager.getInstance();

    this.showComboText(evt.attacker.playerIndex, evt.comboCount);
    this.lastLocalHitAt = Date.now();

    if (gm.isOnline && gm.room.slot) {
      const message: HitMessage = {
        type: 'HIT',
        playerId: gm.room.slot,
        target: indexToSlot(evt.defender.playerIndex),
        timestamp: Date.now(),
        damage: evt.damage,
        knockbackX: evt.knockbackX,
        knockbackY: evt.knockbackY,
        targetHpAfter: evt.defender.hp,
        isKO: evt.isKO,
        attackType: evt.type
      };
      gm.room.sendHit(message);
    }

    if (evt.isKO && this.isRoundActive && gm.isMatchAuthority) {
      this.endRound(evt.attacker.playerIndex);
    }
  }

  private onRemoteHit(msg: HitMessage): void {
    const gm = GameManager.getInstance();
    const defender = this.fighterFor(slotToIndex(msg.target));

    this.combatSystem.applyRemoteHit(
      defender,
      msg.damage,
      msg.knockbackX,
      msg.knockbackY,
      msg.targetHpAfter,
      msg.isKO,
      msg.attackType
    );

    const attackerIndex = slotToIndex(msg.playerId);
    this.showComboText(attackerIndex, this.combatSystem.comboFor(attackerIndex));

    if (msg.isKO && this.isRoundActive && gm.isMatchAuthority) {
      this.endRound(attackerIndex);
    }
  }

  private onMatchMessage(msg: MatchMessage): void {
    const gm = GameManager.getInstance();

    switch (msg.kind) {
      case 'ROUND_START':
        gm.applyAuthoritativeScore(msg.p1Wins ?? 0, msg.p2Wins ?? 0, msg.round ?? 1);
        this.startRoundSequence(msg.round ?? 1);
        break;

      case 'TIMER':
        this.roundTimer = msg.secondsLeft ?? this.roundTimer;
        this.timerText.setText(`${Math.max(0, this.roundTimer)}`);
        break;

      case 'ROUND_END':
        gm.applyAuthoritativeScore(msg.p1Wins ?? gm.p1RoundWins, msg.p2Wins ?? gm.p2RoundWins, msg.round ?? gm.currentRound);
        if (msg.roundWinner) this.presentRoundEnd(msg.roundWinner, false);
        break;

      case 'MATCH_END':
        if (msg.matchWinner) {
          gm.applyAuthoritativeScore(msg.p1Wins ?? 0, msg.p2Wins ?? 0, msg.round ?? 1);
          this.presentMatchEnd(msg.matchWinner);
        }
        break;

      case 'REMATCH_REQUEST':
        this.remoteRematch = true;
        this.updateRematchPrompt();
        this.tryStartRematch();
        break;

      case 'REMATCH_ACCEPT':
        this.performRematch();
        break;

      default:
        break;
    }
  }

  private broadcastMatch(kind: MatchMessage['kind'], extra: Partial<MatchMessage> = {}): void {
    const gm = GameManager.getInstance();
    if (!gm.isOnline || !gm.room.slot) return;

    gm.room.sendMatch({
      type: 'MATCH',
      playerId: gm.room.slot,
      timestamp: Date.now(),
      kind,
      ...extra
    });
  }

  private syncOwnState(now: number): void {
    const gm = GameManager.getInstance();
    if (!gm.isOnline || !gm.room.slot) return;
    if (now - this.lastStateSentAt < NET.stateSyncIntervalMs) return;

    this.lastStateSentAt = now;
    const snapshot = this.localFighter.serializeState();

    const message: StateMessage = {
      type: 'STATE',
      playerId: gm.room.slot,
      timestamp: Date.now(),
      ...snapshot
    };
    gm.room.sendState(message);
  }

  private applyRemoteSnapshot(): void {
    const snapshot = this.remoteSnapshot;
    this.remoteSnapshot = null;
    if (!snapshot) return;

    // Drop anything that arrives during the post-reset settling window.
    if (performance.now() < this.ignoreStateUntil) return;

    // Right after we land a hit, an in-flight snapshot still holds the old HP.
    const applyHealth = Date.now() - this.lastLocalHitAt > 400;

    this.remoteFighter.applyNetworkSnapshot(
      snapshot,
      NET.positionLerp,
      NET.positionSnapDistance,
      applyHealth
    );
  }

  private setDisconnected(disconnected: boolean): void {
    if (this.isPausedForDisconnect === disconnected) return;
    this.isPausedForDisconnect = disconnected;

    this.disconnectText.setVisible(disconnected);
    if (disconnected) {
      this.disconnectText.setText('OPPONENT DISCONNECTED\nWAITING FOR THEM TO RECONNECT...\n[ESC] LEAVE MATCH');
    }
  }

  // ---------------------------------------------------------------------------
  // Round flow
  // ---------------------------------------------------------------------------

  private startRoundSequence(round: number): void {
    const gm = GameManager.getInstance();
    if (this.announcedRound === round) return; // duplicate ROUND_START
    this.announcedRound = round;

    gm.currentState = GameState.FIGHT_ROUND_START;
    gm.currentRound = round;

    this.isRoundActive = false;
    this.roundTimer = ROUND_TIME_SECONDS;
    this.timerText.setText(`${ROUND_TIME_SECONDS}`);
    this.roundTitleText.setText(`ROUND ${round}`);
    this.roundTimerEvent?.remove();

    this.p1.resetFighter(P1_SPAWN_X, SPAWN_Y);
    this.p2.resetFighter(P2_SPAWN_X, SPAWN_Y);
    this.combatSystem.resetCombos();
    gm.inputManager.resetAll();
    gm.vision.resetGestureState();

    this.ignoreStateUntil = performance.now() + 800;
    this.remoteSnapshot = null;

    if (gm.isMatchAuthority && gm.isOnline) {
      // Sent three times: a single dropped packet must not strand PLAYER 2 on
      // the "waiting" screen. The receiver ignores duplicates for the round.
      const announce = () =>
        this.broadcastMatch('ROUND_START', {
          round,
          p1Wins: gm.p1RoundWins,
          p2Wins: gm.p2RoundWins
        });
      announce();
      this.time.delayedCall(350, announce);
      this.time.delayedCall(750, announce);
    }

    this.announcerText.setAlpha(1);
    this.announcerText.setText(`ROUND ${round}`);

    // 3 - 2 - 1 - FIGHT!
    const countdown = ['3', '2', '1'];
    countdown.forEach((label, i) => {
      this.time.delayedCall(700 + i * 550, () => {
        this.announcerText.setText(label);
        SoundManager.getInstance().playMenuSelect();
      });
    });

    this.time.delayedCall(700 + countdown.length * 550, () => {
      this.announcerText.setText('FIGHT!');
      SoundManager.getInstance().playSpecial();

      this.time.delayedCall(600, () => {
        this.tweens.add({ targets: this.announcerText, alpha: 0, duration: 300 });
        this.beginRound();
      });
    });
  }

  private beginRound(): void {
    const gm = GameManager.getInstance();
    this.isRoundActive = true;
    gm.currentState = GameState.FIGHT_ACTIVE;

    if (!gm.isMatchAuthority) return;

    this.roundTimerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.isRoundActive || this.isPausedForDisconnect) return;
        this.roundTimer--;
        this.timerText.setText(`${Math.max(0, this.roundTimer)}`);
        this.broadcastMatch('TIMER', { secondsLeft: this.roundTimer });

        if (this.roundTimer <= 0) this.handleTimeOver();
      }
    });
  }

  private handleTimeOver(): void {
    if (!this.isRoundActive) return;
    this.isRoundActive = false;
    this.roundTimerEvent?.remove();

    let winner: 1 | 2 = 1;
    if (this.p2.hp > this.p1.hp) winner = 2;

    this.announcerText.setText('TIME OVER!');
    this.announcerText.setAlpha(1);
    this.time.delayedCall(1400, () => this.endRound(winner));
  }

  /** Authority only: decide the round result and tell the other laptop. */
  private endRound(roundWinner: 1 | 2): void {
    const gm = GameManager.getInstance();
    if (!gm.isMatchAuthority) return;

    this.isRoundActive = false;
    this.roundTimerEvent?.remove();

    const result = gm.recordRoundWin(roundWinner);

    if (result.matchOver) {
      this.broadcastMatch('MATCH_END', {
        matchWinner: result.winner,
        roundWinner,
        round: gm.currentRound,
        p1Wins: gm.p1RoundWins,
        p2Wins: gm.p2RoundWins
      });
      this.presentRoundEnd(roundWinner, true);
    } else {
      this.broadcastMatch('ROUND_END', {
        roundWinner,
        round: gm.currentRound,
        p1Wins: gm.p1RoundWins,
        p2Wins: gm.p2RoundWins
      });
      this.presentRoundEnd(roundWinner, false);
    }
  }

  /** Runs on BOTH laptops - the follower gets here from a ROUND_END message. */
  private presentRoundEnd(roundWinner: 1 | 2, matchOver: boolean): void {
    const gm = GameManager.getInstance();
    this.isRoundActive = false;
    this.roundTimerEvent?.remove();
    gm.currentState = GameState.FIGHT_ROUND_END;

    const winningFighter = this.fighterFor(roundWinner);
    const losingFighter = this.fighterFor(roundWinner === 1 ? 2 : 1);

    winningFighter.playVictory();
    if (!losingFighter.isKO()) losingFighter.forceKO(roundWinner === 1 ? 120 : -120, -80);

    const isPerfect = winningFighter.hp === winningFighter.maxHp;
    this.announcerText.setText(isPerfect ? 'PERFECT!' : 'K.O.');
    this.announcerText.setAlpha(1);
    SoundManager.getInstance().playKO();

    if (matchOver) {
      this.time.delayedCall(1600, () => this.presentMatchEnd(gm.matchWinner ?? roundWinner));
      return;
    }

    if (!gm.isMatchAuthority) {
      // The follower waits for PLAYER 1 to announce the next round.
      this.time.delayedCall(1800, () => this.announcerText.setText('NEXT ROUND...'));
      return;
    }

    this.time.delayedCall(1800, () => this.startRoundSequence(gm.currentRound));
  }

  private presentMatchEnd(matchWinner: 1 | 2): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.FIGHT_MATCH_END;
    gm.matchWinner = matchWinner;
    this.isRoundActive = false;
    this.roundTimerEvent?.remove();

    const youWon = gm.isOnline && gm.localIndex === matchWinner;
    const headline = gm.isOnline
      ? youWon
        ? 'YOU WIN!'
        : 'YOU LOSE'
      : `PLAYER ${matchWinner} WINS!`;

    this.announcerText.setText(headline);
    this.announcerText.setAlpha(1);

    if (!this.rematchPrompt) {
      this.rematchPrompt = this.add
        .text(GAME_WIDTH / 2, 224, '', {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '11px',
          color: '#ffb703',
          align: 'center'
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(60)
        .setInteractive({ useHandCursor: true });

      this.rematchPrompt.on('pointerdown', () => this.requestRematch());
      this.tweens.add({
        targets: this.rematchPrompt,
        alpha: 0.35,
        duration: 600,
        yoyo: true,
        repeat: -1
      });
    }

    this.rematchPrompt.setVisible(true);
    this.updateRematchPrompt();
  }

  // ---------------------------------------------------------------------------
  // Rematch
  // ---------------------------------------------------------------------------

  private requestRematch(): void {
    const gm = GameManager.getInstance();
    if (gm.currentState !== GameState.FIGHT_MATCH_END) return;
    if (this.localRematch) return;

    this.localRematch = true;
    SoundManager.getInstance().playMenuSelect();

    if (!gm.isOnline) {
      this.performRematch();
      return;
    }

    this.broadcastMatch('REMATCH_REQUEST');
    this.updateRematchPrompt();
    this.tryStartRematch();
  }

  private tryStartRematch(): void {
    const gm = GameManager.getInstance();
    if (!gm.isMatchAuthority) return;
    if (!this.localRematch || !this.remoteRematch) return;

    this.broadcastMatch('REMATCH_ACCEPT');
    this.performRematch();
  }

  private performRematch(): void {
    const gm = GameManager.getInstance();
    gm.resetMatch();
    this.scene.restart();
  }

  private updateRematchPrompt(): void {
    if (!this.rematchPrompt) return;
    const gm = GameManager.getInstance();

    if (!gm.isOnline) {
      this.rematchPrompt.setText('PRESS [R] FOR REMATCH   |   [ESC] MENU');
      return;
    }

    if (this.localRematch && !this.remoteRematch) {
      this.rematchPrompt.setText('REMATCH REQUESTED - WAITING FOR OPPONENT...');
    } else if (!this.localRematch && this.remoteRematch) {
      this.rematchPrompt.setText('OPPONENT WANTS A REMATCH! PRESS [R] TO ACCEPT');
    } else {
      this.rematchPrompt.setText('PRESS [R] FOR REMATCH   |   [ESC] MENU');
    }
  }

  private leaveMatch(): void {
    const gm = GameManager.getInstance();
    void gm.room.leave();
    this.scene.start('MenuScene');
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  public override update(time: number, delta: number): void {
    const gm = GameManager.getInstance();

    // 1. Build this frame's input for both fighters and ship the local half.
    gm.inputManager.update();

    if (gm.isOnline && !gm.inputManager.isOpponentResponsive) {
      this.setDisconnected(true);
    } else if (gm.isOnline && gm.room.lastSnapshot?.opponentPresent) {
      this.setDisconnected(false);
    }

    const canAct = this.isRoundActive && !this.isPausedForDisconnect;
    if (canAct) {
      this.p1.updateInput(gm.inputManager.getPlayerInput(1), delta);
      this.p2.updateInput(gm.inputManager.getPlayerInput(2), delta);
    }

    // 2. Combat - only for the fighter(s) this browser owns.
    this.combatSystem.update(this.p1, this.p2, delta);

    // 3. Reconcile the opponent's fighter, then publish ours.
    if (gm.isOnline) {
      this.applyRemoteSnapshot();
      this.syncOwnState(time);
    }

    this.cameraController.update(this.p1, this.p2);
    this.updateHUD();
    DomUI.getInstance().updateVisionStatus(gm.vision.status);
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private createHUD(): void {
    const gm = GameManager.getInstance();
    const youAre = gm.isOnline ? gm.localIndex : 0;

    // P1 panel
    this.add.rectangle(135, 30, 230, 48, 0x0a0a1a, 0.85).setScrollFactor(0).setStrokeStyle(2, 0x00fff9);
    this.add
      .text(25, 12, `P1 ${gm.p1Character}${youAre === 1 ? ' (YOU)' : ''}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#00fff9'
      })
      .setScrollFactor(0);

    this.add.rectangle(135, 28, 180, 10, 0x333333).setScrollFactor(0);
    this.p1HpBar = this.add.rectangle(45, 28, 180, 10, 0x00fff9).setScrollFactor(0).setOrigin(0, 0.5);

    this.add.rectangle(95, 42, 100, 6, 0x222222).setScrollFactor(0);
    this.p1SpecialBar = this.add.rectangle(45, 42, 0, 6, 0xffb703).setScrollFactor(0).setOrigin(0, 0.5);

    this.add.rectangle(185, 42, 60, 6, 0x222222).setScrollFactor(0);
    this.p1UltimateBar = this.add.rectangle(155, 42, 0, 6, 0xff2a6d).setScrollFactor(0).setOrigin(0, 0.5);

    this.p1WinsText = this.add
      .text(230, 12, `W:${gm.p1RoundWins}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffb703'
      })
      .setScrollFactor(0);

    // P2 panel
    this.add.rectangle(505, 30, 230, 48, 0x0a0a1a, 0.85).setScrollFactor(0).setStrokeStyle(2, 0xff2a6d);
    this.add
      .text(615, 12, `${gm.p2Character} P2${youAre === 2 ? ' (YOU)' : ''}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ff2a6d'
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);

    this.add.rectangle(505, 28, 180, 10, 0x333333).setScrollFactor(0);
    this.p2HpBar = this.add.rectangle(595, 28, 180, 10, 0xff2a6d).setScrollFactor(0).setOrigin(1, 0.5);

    this.add.rectangle(545, 42, 100, 6, 0x222222).setScrollFactor(0);
    this.p2SpecialBar = this.add.rectangle(595, 42, 0, 6, 0xffb703).setScrollFactor(0).setOrigin(1, 0.5);

    this.add.rectangle(445, 42, 60, 6, 0x222222).setScrollFactor(0);
    this.p2UltimateBar = this.add.rectangle(475, 42, 0, 6, 0x00fff9).setScrollFactor(0).setOrigin(1, 0.5);

    this.p2WinsText = this.add
      .text(400, 12, `W:${gm.p2RoundWins}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffb703'
      })
      .setScrollFactor(0);

    // Centre
    this.roundTitleText = this.add
      .text(320, 14, `ROUND ${gm.currentRound}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffb703'
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    this.timerText = this.add
      .text(320, 36, `${ROUND_TIME_SECONDS}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '22px',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    this.announcerText = this.add
      .text(320, 150, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '32px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(55);
    this.announcerText.setStroke('#00fff9', 6);

    this.comboTextP1 = this.add
      .text(100, 92, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '14px',
        color: '#00fff9'
      })
      .setScrollFactor(0);

    this.comboTextP2 = this.add
      .text(440, 92, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '14px',
        color: '#ff2a6d'
      })
      .setScrollFactor(0);

    this.disconnectText = this.add
      .text(320, GAME_HEIGHT / 2 + 40, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '11px',
        color: '#ff5f7a',
        align: 'center'
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(70)
      .setVisible(false);
  }

  private updateHUD(): void {
    const gm = GameManager.getInstance();

    this.p1HpBar.width = 180 * Phaser.Math.Clamp(this.p1.hp / this.p1.maxHp, 0, 1);
    this.p2HpBar.width = 180 * Phaser.Math.Clamp(this.p2.hp / this.p2.maxHp, 0, 1);

    this.p1SpecialBar.width = 100 * (this.p1.specialMeter / 100);
    this.p2SpecialBar.width = 100 * (this.p2.specialMeter / 100);

    this.p1UltimateBar.width = 60 * (this.p1.ultimateMeter / 100);
    this.p2UltimateBar.width = 60 * (this.p2.ultimateMeter / 100);

    this.p1WinsText.setText(`W:${gm.p1RoundWins}`);
    this.p2WinsText.setText(`W:${gm.p2RoundWins}`);
    this.roundTitleText.setText(`ROUND ${gm.currentRound}`);
  }

  private showComboText(playerIndex: 1 | 2, count: number): void {
    if (count <= 1) return;
    const txt = playerIndex === 1 ? this.comboTextP1 : this.comboTextP2;
    txt.setText(`${count} HIT!`);
    txt.setAlpha(1);
    this.tweens.add({ targets: txt, alpha: 0, duration: 900, delay: 500 });
  }
}

import Phaser from 'phaser';
import { PlayerInputState } from '../input/InputManager';
import { SoundManager } from '../audio/SoundManager';

export enum CharacterState {
  IDLE = 'IDLE',
  WALK = 'WALK',
  JUMP = 'JUMP',
  FALL = 'FALL',
  PUNCH = 'PUNCH',
  KICK = 'KICK',
  BLOCK = 'BLOCK',
  GRAB = 'GRAB',
  SPECIAL = 'SPECIAL',
  ULTIMATE = 'ULTIMATE',
  HURT = 'HURT',
  KNOCKBACK = 'KNOCKBACK',
  KO = 'KO',
  VICTORY = 'VICTORY'
}

export interface CharacterConfig {
  name: string;
  spriteKey: string;
  maxHp: number;
  speed: number;
  attackPower: number;
  defensePower: number;
}

export class Character extends Phaser.Physics.Arcade.Sprite {
  public playerIndex: 1 | 2;
  public currentState: CharacterState = CharacterState.IDLE;

  public hp: number;
  public maxHp: number;
  public specialMeter: number = 0; // 0 to 100
  public ultimateMeter: number = 0; // 0 to 100

  public isBlocking: boolean = false;
  public isInvulnerable: boolean = false;

  public opponent: Character | null = null;

  // Active Hitbox offsets relative to character body
  public activeHitbox: {
    active: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    damage: number;
    knockbackX: number;
    knockbackY: number;
    type: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE';
  } = {
    active: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    damage: 0,
    knockbackX: 0,
    knockbackY: 0,
    type: 'PUNCH'
  };

  protected stateTimer: number = 0;
  protected speed: number;
  protected attackPower: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    playerIndex: 1 | 2,
    config: CharacterConfig
  ) {
    super(scene, x, y, config.spriteKey, 0);

    this.playerIndex = playerIndex;
    this.maxHp = config.maxHp;
    this.hp = config.maxHp;
    this.speed = config.speed * 30;
    this.attackPower = config.attackPower;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.setBounce(0, 0);
    this.setDragX(800);
    this.setSize(24, 48);
    this.setOffset(20, 16);

    if (playerIndex === 2) {
      this.setFlipX(true);
    }

    this.setupAnimations(config.spriteKey);
  }

  /**
   * Registers every animation for a fighter sprite sheet.
   * Called once from BootScene so menus and the select screen can play them
   * before any Character instance exists.
   */
  public static registerAnimations(scene: Phaser.Scene, key: string): void {
    const anims = scene.anims;

    const createAnim = (animKey: string, frames: number[], frameRate: number, repeat: number) => {
      if (!anims.exists(animKey)) {
        anims.create({
          key: animKey,
          frames: frames.map((f) => ({ key, frame: f })),
          frameRate,
          repeat
        });
      }
    };

    createAnim(`${key}_idle`, [0, 1, 2, 3], 6, -1);
    createAnim(`${key}_walk`, [8, 9, 10, 11, 12, 13], 10, -1);
    createAnim(`${key}_jump`, [16, 17, 18], 8, 0);
    createAnim(`${key}_punch`, [24, 25, 26, 27, 28], 14, 0);
    createAnim(`${key}_kick`, [32, 33, 34, 35, 36], 12, 0);
    createAnim(`${key}_block`, [40, 41, 42], 8, -1);
    createAnim(`${key}_grab`, [48, 49, 50, 51], 10, 0);
    createAnim(`${key}_special`, [56, 57, 58, 59, 60, 61], 12, 0);
    createAnim(`${key}_ultimate`, [64, 65, 66, 67, 68, 69, 70, 71], 12, 0);
    createAnim(`${key}_hurt`, [72, 73, 74], 10, 0);
    createAnim(`${key}_ko`, [80, 81, 82, 83], 6, 0);
    createAnim(`${key}_victory`, [88, 89, 90, 91], 6, -1);
  }

  private setupAnimations(key: string): void {
    Character.registerAnimations(this.scene, key);
    this.play(`${key}_idle`);
  }

  public updateInput(input: PlayerInputState, delta: number): void {
    if (
      this.currentState === CharacterState.HURT ||
      this.currentState === CharacterState.KNOCKBACK ||
      this.currentState === CharacterState.KO ||
      this.currentState === CharacterState.VICTORY
    ) {
      return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    const isGrounded = body.blocked.down || body.touching.down;

    // Face opponent dynamically if neutral
    if (this.opponent && this.currentState === CharacterState.IDLE) {
      this.setFlipX(this.x > this.opponent.x);
    }

    const facingSign = this.flipX ? -1 : 1;

    // Attack State Machine Execution
    if (this.stateTimer > 0) {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.clearAttackHitbox();
        this.changeState(CharacterState.IDLE);
      }
      return;
    }

    // 1. Ultimate Attack
    if (input.ultimate && this.ultimateMeter >= 100) {
      this.ultimateMeter = 0;
      this.executeAttack(CharacterState.ULTIMATE, 250, 45, 180 * facingSign, -100, 'ULTIMATE');
      SoundManager.getInstance().playUltimate();
      return;
    }

    // 2. Special Attack
    if (input.special && this.specialMeter >= 33) {
      this.specialMeter -= 33;
      this.executeAttack(CharacterState.SPECIAL, 220, 22, 140 * facingSign, -80, 'SPECIAL');
      SoundManager.getInstance().playSpecial();
      return;
    }

    // 3. Grab Attack
    if (input.grab) {
      this.executeAttack(CharacterState.GRAB, 180, 16, 160 * facingSign, -60, 'GRAB');
      return;
    }

    // 4. Punch Attack
    if (input.punch) {
      this.executeAttack(CharacterState.PUNCH, 150, 10, 80 * facingSign, -40, 'PUNCH');
      SoundManager.getInstance().playPunch();
      return;
    }

    // 5. Kick Attack
    if (input.kick) {
      this.executeAttack(CharacterState.KICK, 180, 14, 120 * facingSign, -50, 'KICK');
      SoundManager.getInstance().playKick();
      return;
    }

    // 6. Block Defense
    if (input.block && isGrounded) {
      this.isBlocking = true;
      this.setVelocityX(0);
      this.changeState(CharacterState.BLOCK);
      return;
    } else {
      this.isBlocking = false;
    }

    // 7. Jump Movement
    if (input.jump && isGrounded) {
      this.setVelocityY(-400);
      this.changeState(CharacterState.JUMP);
      return;
    }

    // 8. Horizontal Walking Movement
    if (input.moveLeft) {
      this.setVelocityX(-this.speed);
      if (isGrounded) this.changeState(CharacterState.WALK);
    } else if (input.moveRight) {
      this.setVelocityX(this.speed);
      if (isGrounded) this.changeState(CharacterState.WALK);
    } else {
      this.setVelocityX(0);
      if (isGrounded) this.changeState(CharacterState.IDLE);
    }
  }

  protected executeAttack(
    state: CharacterState,
    durationMs: number,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    type: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE'
  ): void {
    this.changeState(state);
    this.stateTimer = durationMs;
    this.setVelocityX(0);

    const facingSign = this.flipX ? -1 : 1;
    this.activeHitbox = {
      active: true,
      x: this.x + facingSign * 24,
      y: this.y - 8,
      width: type === 'SPECIAL' || type === 'ULTIMATE' ? 44 : 28,
      height: 28,
      damage: Math.round(damage * (this.attackPower / 5)),
      knockbackX,
      knockbackY,
      type
    };
  }

  public takeDamage(
    amount: number,
    knockbackX: number,
    knockbackY: number
  ): { actualDamage: number; isKO: boolean } {
    if (this.isInvulnerable || this.currentState === CharacterState.KO) {
      return { actualDamage: 0, isKO: false };
    }

    let actualDamage = amount;
    if (this.isBlocking) {
      actualDamage = Math.round(amount * 0.25); // 75% block damage reduction
      this.hp = Math.max(0, this.hp - actualDamage);
      SoundManager.getInstance().playBlock();
      // Block sparks
      this.spawnBlockShield();
    } else {
      this.hp = Math.max(0, this.hp - actualDamage);

      // Meter gain on hit
      this.specialMeter = Math.min(100, this.specialMeter + 15);
      this.ultimateMeter = Math.min(100, this.ultimateMeter + 10);
    }

    const isKO = this.hp <= 0;

    if (isKO) {
      this.changeState(CharacterState.KO);
      this.setVelocity(knockbackX * 1.5, knockbackY * 1.5);
      SoundManager.getInstance().playKO();
    } else if (!this.isBlocking) {
      this.changeState(CharacterState.HURT);
      this.setVelocity(knockbackX, knockbackY);
      this.stateTimer = 180;
    }

    return { actualDamage, isKO };
  }

  private spawnBlockShield(): void {
    const shield = this.scene.add.image(this.x + (this.flipX ? -15 : 15), this.y, 'vfx_shield');
    shield.setDepth(20);
    this.scene.tweens.add({
      targets: shield,
      alpha: 0,
      scale: 1.3,
      duration: 200,
      onComplete: () => shield.destroy()
    });
  }

  public changeState(newState: CharacterState): void {
    if (this.currentState === newState && newState !== CharacterState.IDLE) return;
    this.currentState = newState;

    const key = this.texture.key;
    switch (newState) {
      case CharacterState.IDLE:
        this.play(`${key}_idle`, true);
        break;
      case CharacterState.WALK:
        this.play(`${key}_walk`, true);
        break;
      case CharacterState.JUMP:
        this.play(`${key}_jump`, true);
        break;
      case CharacterState.PUNCH:
        this.play(`${key}_punch`, true);
        break;
      case CharacterState.KICK:
        this.play(`${key}_kick`, true);
        break;
      case CharacterState.BLOCK:
        this.play(`${key}_block`, true);
        break;
      case CharacterState.GRAB:
        this.play(`${key}_grab`, true);
        break;
      case CharacterState.SPECIAL:
        this.play(`${key}_special`, true);
        break;
      case CharacterState.ULTIMATE:
        this.play(`${key}_ultimate`, true);
        break;
      case CharacterState.HURT:
        this.play(`${key}_hurt`, true);
        break;
      case CharacterState.KO:
        this.play(`${key}_ko`, true);
        break;
      case CharacterState.VICTORY:
        this.play(`${key}_victory`, true);
        break;
    }
  }

  public clearAttackHitbox(): void {
    this.activeHitbox.active = false;
  }

  public resetFighter(x: number, y: number): void {
    this.setPosition(x, y);
    this.setVelocity(0, 0);
    this.hp = this.maxHp;
    this.specialMeter = 0;
    this.ultimateMeter = 0;
    this.stateTimer = 0;
    this.isBlocking = false;
    this.clearAttackHitbox();
    this.currentState = CharacterState.HURT; // force changeState to re-trigger
    this.changeState(CharacterState.IDLE);
    this.setFlipX(this.playerIndex === 2);
  }

  // ---------------------------------------------------------------------------
  // Online sync
  // ---------------------------------------------------------------------------

  /**
   * True when this fighter is driven by input arriving over the network.
   * A network fighter still simulates locally (so it walks and animates
   * smoothly between packets) but its owner's snapshots win on disagreement.
   */
  public isNetworkControlled = false;

  /** Snapshot of everything the other laptop needs to mirror this fighter. */
  public serializeState(): {
    x: number;
    y: number;
    vx: number;
    vy: number;
    facingLeft: boolean;
    hp: number;
    special: number;
    ultimate: number;
  } {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    return {
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      vx: Math.round(body?.velocity.x ?? 0),
      vy: Math.round(body?.velocity.y ?? 0),
      facingLeft: this.flipX,
      hp: this.hp,
      special: Math.round(this.specialMeter),
      ultimate: Math.round(this.ultimateMeter)
    };
  }

  /**
   * Reconciles this fighter against its owner's authoritative snapshot.
   * Small errors are eased away; a large error (lag spike, respawn) snaps.
   */
  public applyNetworkSnapshot(
    snapshot: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      facingLeft: boolean;
      hp: number;
      special: number;
      ultimate: number;
    },
    lerp: number,
    snapDistance: number,
    applyHealth = true
  ): void {
    const distance = Phaser.Math.Distance.Between(this.x, this.y, snapshot.x, snapshot.y);

    if (distance > snapDistance) {
      this.setPosition(snapshot.x, snapshot.y);
    } else {
      this.setPosition(
        Phaser.Math.Linear(this.x, snapshot.x, lerp),
        Phaser.Math.Linear(this.y, snapshot.y, lerp)
      );
    }

    this.setFlipX(snapshot.facingLeft);

    // Skipped for a moment after we land a hit, so a snapshot that was already
    // in flight cannot briefly rewind the health bar we just drained.
    if (applyHealth) {
      this.hp = Phaser.Math.Clamp(snapshot.hp, 0, this.maxHp);
      this.specialMeter = Phaser.Math.Clamp(snapshot.special, 0, 100);
      this.ultimateMeter = Phaser.Math.Clamp(snapshot.ultimate, 0, 100);
    }
  }

  /** Applied when the attacker's browser reports a knockout. */
  public forceKO(knockbackX: number, knockbackY: number): void {
    if (this.currentState === CharacterState.KO) return;
    this.hp = 0;
    this.stateTimer = 0;
    this.clearAttackHitbox();
    this.changeState(CharacterState.KO);
    this.setVelocity(knockbackX * 1.5, knockbackY * 1.5);
  }

  public isKO(): boolean {
    return this.currentState === CharacterState.KO;
  }

  public playVictory(): void {
    this.stateTimer = 0;
    this.clearAttackHitbox();
    this.setVelocityX(0);
    this.changeState(CharacterState.VICTORY);
  }
}

import Phaser from 'phaser';
import { Character } from '../characters/Character';

export type AttackType = 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE';

export interface CombatHitEvent {
  attacker: Character;
  defender: Character;
  damage: number;
  comboCount: number;
  isKO: boolean;
  type: AttackType;
  knockbackX: number;
  knockbackY: number;
}

/**
 * Hitbox resolution, combo tracking and hit feel.
 *
 * ONLINE AUTHORITY: a browser only resolves hits thrown BY the fighter it
 * owns. The result travels to the other laptop as a HIT message, which is
 * applied there through `applyRemoteHit`. Without this split both clients would
 * detect the same punch and the defender would take double damage.
 */
export class CombatSystem {
  private p1Combo = 0;
  private p2Combo = 0;
  private p1ComboTimer = 0;
  private p2ComboTimer = 0;

  private isHitStopActive = false;
  private hitStopTimer = 0;

  private ownedAttackers: Array<1 | 2> = [1, 2];
  private onHitCallback: ((event: CombatHitEvent) => void) | null = null;

  constructor(private scene: Phaser.Scene) {}

  /** Which fighters this browser is allowed to resolve attacks for. */
  public setOwnedAttackers(indices: Array<1 | 2>): void {
    this.ownedAttackers = indices;
  }

  public setOnHitCallback(cb: (event: CombatHitEvent) => void): void {
    this.onHitCallback = cb;
  }

  public update(p1: Character, p2: Character, delta: number): void {
    // 1. Hit-stop freeze frame.
    if (this.isHitStopActive) {
      this.hitStopTimer -= delta;
      if (this.hitStopTimer <= 0) {
        this.isHitStopActive = false;
        this.scene.physics.world.resume();
      }
      return;
    }

    // 2. Combo timer decay.
    if (this.p1ComboTimer > 0) {
      this.p1ComboTimer -= delta;
      if (this.p1ComboTimer <= 0) this.p1Combo = 0;
    }
    if (this.p2ComboTimer > 0) {
      this.p2ComboTimer -= delta;
      if (this.p2ComboTimer <= 0) this.p2Combo = 0;
    }

    // 3. Hitboxes - only for the fighters this client is authoritative for.
    if (this.ownedAttackers.includes(1)) this.checkHitbox(p1, p2);
    if (this.ownedAttackers.includes(2)) this.checkHitbox(p2, p1);

    // A fighter we do not own still needs its stale hitbox cleared so it never
    // lingers into a later frame.
    if (!this.ownedAttackers.includes(1)) p1.clearAttackHitbox();
    if (!this.ownedAttackers.includes(2)) p2.clearAttackHitbox();
  }

  private checkHitbox(attacker: Character, defender: Character): void {
    const hb = attacker.activeHitbox;
    if (!hb || !hb.active) return;

    const defBounds = defender.getBounds();
    const attackRect = new Phaser.Geom.Rectangle(
      hb.x - hb.width / 2,
      hb.y - hb.height / 2,
      hb.width,
      hb.height
    );

    if (!Phaser.Geom.Intersects.RectangleToRectangle(attackRect, defBounds)) return;

    // Clear immediately so one swing cannot hit twice.
    attacker.clearAttackHitbox();

    const result = defender.takeDamage(hb.damage, hb.knockbackX, hb.knockbackY);

    let comboCount = 1;
    if (attacker.playerIndex === 1) {
      this.p1Combo++;
      this.p1ComboTimer = 1500;
      comboCount = this.p1Combo;
    } else {
      this.p2Combo++;
      this.p2ComboTimer = 1500;
      comboCount = this.p2Combo;
    }

    this.playHitFeel(defender, hb.type, result.isKO);

    this.onHitCallback?.({
      attacker,
      defender,
      damage: result.actualDamage,
      comboCount,
      isKO: result.isKO,
      type: hb.type,
      knockbackX: hb.knockbackX,
      knockbackY: hb.knockbackY
    });
  }

  /**
   * A hit the OPPONENT'S browser resolved. We trust its damage number and
   * re-sync the defender's HP so the two screens cannot drift apart.
   */
  public applyRemoteHit(
    defender: Character,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    hpAfter: number,
    isKO: boolean,
    type: AttackType
  ): void {
    defender.takeDamage(damage, knockbackX, knockbackY);
    defender.hp = Phaser.Math.Clamp(hpAfter, 0, defender.maxHp);

    if (isKO) defender.forceKO(knockbackX, knockbackY);
    this.playHitFeel(defender, type, isKO);

    if (defender.playerIndex === 1) {
      this.p2Combo++;
      this.p2ComboTimer = 1500;
    } else {
      this.p1Combo++;
      this.p1ComboTimer = 1500;
    }
  }

  public comboFor(playerIndex: 1 | 2): number {
    return playerIndex === 1 ? this.p1Combo : this.p2Combo;
  }

  private playHitFeel(defender: Character, type: AttackType, isKO: boolean): void {
    // 1. Micro freeze.
    const freezeDuration = isKO ? 250 : type === 'ULTIMATE' ? 120 : type === 'SPECIAL' ? 90 : 60;
    this.isHitStopActive = true;
    this.hitStopTimer = freezeDuration;
    this.scene.physics.world.pause();

    // 2. Damage flash.
    defender.setTint(0xff2a6d);
    this.scene.time.delayedCall(120, () => defender.clearTint());

    // 3. Camera shake.
    const intensity = isKO ? 0.03 : type === 'ULTIMATE' ? 0.025 : type === 'SPECIAL' ? 0.015 : 0.008;
    this.scene.cameras.main.shake(150, intensity);

    // 4. Pixel spark burst.
    const spark = this.scene.add.sprite(defender.x, defender.y - 10, 'vfx_spark');
    spark.setDepth(30);
    spark.play('vfx_spark_anim');
    spark.once('animationcomplete', () => spark.destroy());
  }

  public resetCombos(): void {
    this.p1Combo = 0;
    this.p2Combo = 0;
    this.p1ComboTimer = 0;
    this.p2ComboTimer = 0;
    if (this.isHitStopActive) {
      this.isHitStopActive = false;
      this.hitStopTimer = 0;
      this.scene.physics.world.resume();
    }
  }
}

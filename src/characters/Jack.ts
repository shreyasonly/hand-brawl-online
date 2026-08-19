import Phaser from 'phaser';
import { Character, CharacterState } from './Character';

export class Jack extends Character {
  constructor(scene: Phaser.Scene, x: number, y: number, playerIndex: 1 | 2) {
    super(scene, x, y, playerIndex, {
      name: 'JACK',
      spriteKey: 'jack_sprites',
      maxHp: 100,
      speed: 5,
      attackPower: 5,
      defensePower: 5
    });
  }

  // Custom Jack Special: Thunder Punch
  public override executeAttack(
    state: CharacterState,
    durationMs: number,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    type: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE'
  ): void {
    super.executeAttack(state, durationMs, damage, knockbackX, knockbackY, type);

    if (type === 'SPECIAL' || type === 'ULTIMATE') {
      const facingSign = this.flipX ? -1 : 1;
      const bolt = this.scene.add.image(this.x + facingSign * 40, this.y, 'vfx_lightning');
      bolt.setDepth(15);
      this.scene.tweens.add({
        targets: bolt,
        alpha: 0,
        scaleX: 1.5,
        duration: durationMs,
        onComplete: () => bolt.destroy()
      });
    }
  }
}

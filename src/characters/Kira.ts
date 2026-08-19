import Phaser from 'phaser';
import { Character, CharacterState } from './Character';

export class Kira extends Character {
  constructor(scene: Phaser.Scene, x: number, y: number, playerIndex: 1 | 2) {
    super(scene, x, y, playerIndex, {
      name: 'KIRA',
      spriteKey: 'kira_sprites',
      maxHp: 90,
      speed: 8,
      attackPower: 4,
      defensePower: 3
    });
  }

  // Custom Kira Special: Shadow Dash Strike
  public override executeAttack(
    state: CharacterState,
    durationMs: number,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    type: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE'
  ): void {
    super.executeAttack(state, durationMs, damage, knockbackX, knockbackY, type);

    const facingSign = this.flipX ? -1 : 1;
    if (type === 'SPECIAL') {
      // Teleport forward dash
      this.setVelocityX(facingSign * 450);
    } else if (type === 'ULTIMATE') {
      // Create multi-afterimage clones
      for (let i = 0; i < 3; i++) {
        const afterimage = this.scene.add.sprite(
          this.x - facingSign * (i * 20),
          this.y,
          'kira_sprites',
          64
        );
        afterimage.setAlpha(0.6);
        afterimage.setFlipX(this.flipX);
        this.scene.tweens.add({
          targets: afterimage,
          alpha: 0,
          scale: 1.2,
          duration: 300,
          onComplete: () => afterimage.destroy()
        });
      }
    }
  }
}

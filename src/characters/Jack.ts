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
      const isUltimate = type === 'ULTIMATE';

      const burst = this.scene.add.sprite(
        this.x + facingSign * 30,
        this.y - 6,
        'vfx_thunder_burst'
      );
      burst.setDepth(16);
      burst.setScale(isUltimate ? 1.7 : 1.1);
      burst.play('vfx_thunder_burst_anim');
      burst.once('animationcomplete', () => burst.destroy());

      if (isUltimate) {
        // A second, mirrored burst overlapping the fighter for extra impact.
        const echo = this.scene.add.sprite(this.x - facingSign * 10, this.y - 6, 'vfx_thunder_burst');
        echo.setDepth(16);
        echo.setScale(1.1);
        echo.setAlpha(0.7);
        echo.play('vfx_thunder_burst_anim');
        echo.once('animationcomplete', () => echo.destroy());
      }
    }
  }
}

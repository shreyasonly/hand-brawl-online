import Phaser from 'phaser';
import { PixelSpriteGenerator } from '../graphics/PixelSpriteGenerator';
import { Character } from '../characters/Character';
import { GameManager } from '../game/GameManager';
import { DomUI } from '../ui/DomUI';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  public preload(): void {
    // 16-bit procedural canvas textures (fighters, VFX, parallax stage).
    PixelSpriteGenerator.generateAll(this);

    Character.registerAnimations(this, 'jack_sprites');
    Character.registerAnimations(this, 'kira_sprites');

    if (!this.anims.exists('vfx_spark_anim')) {
      this.anims.create({
        key: 'vfx_spark_anim',
        frames: this.anims.generateFrameNumbers('vfx_spark', { start: 0, end: 3 }),
        frameRate: 16,
        repeat: 0
      });
    }
  }

  public async create(): Promise<void> {
    const dom = DomUI.getInstance();
    const gm = GameManager.getInstance();

    dom.setLoading('LOADING PIXEL ART...', 10);

    // Load TensorFlow.js + MediaPipe models up front. The camera itself is NOT
    // requested here - each player enables their own webcam in SetupScene, so
    // the permission prompt appears in context.
    await gm.vision.initModels((msg, pct) => dom.setLoading(msg, pct));

    dom.setLoading('READY', 100);
    dom.hideLoading();

    this.scene.start('MenuScene');
  }
}

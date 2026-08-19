import Phaser from 'phaser';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';

export class HowToPlayScene extends Phaser.Scene {
  private debugBtnText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'HowToPlayScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.HOW_TO_PLAY;

    this.add.image(320, 180, 'stage_sky');
    this.add.rectangle(320, 180, 610, 330, 0x0a0a1a, 0.92).setStrokeStyle(2, 0x00fff9);

    this.add
      .text(320, 30, 'HOW TO PLAY', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '18px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);

    this.add
      .text(320, 56, 'ONE LAPTOP = ONE WEBCAM = ONE PLAYER = ONE HAND', {
        fontFamily: '"VT323", monospace',
        fontSize: '20px',
        color: '#ffb703'
      })
      .setOrigin(0.5);

    this.add
      .text(320, 74, 'YOUR CAMERA ONLY CONTROLS YOUR OWN FIGHTER', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#00fff9'
      })
      .setOrigin(0.5);

    const gestures: Array<{ emoji: string; name: string; action: string }> = [
      { emoji: '✊', name: 'FIST', action: 'PUNCH' },
      { emoji: '✋', name: 'PALM', action: 'BLOCK' },
      { emoji: '✌', name: '2 FINGERS', action: 'KICK' },
      { emoji: '☝', name: 'INDEX', action: 'SPECIAL' },
      { emoji: '🤏', name: 'PINCH', action: 'GRAB' },
      { emoji: '👍', name: 'THUMBS UP', action: 'ULTIMATE' },
      { emoji: '←→', name: 'MOVE HAND', action: 'WALK L / R' },
      { emoji: '↑', name: 'FLICK UP', action: 'JUMP' }
    ];

    gestures.forEach((g, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? 70 : 340;
      const y = 100 + row * 30;

      this.add.text(x, y, g.emoji, { fontSize: '17px' });
      this.add.text(x + 34, y + 3, `${g.name}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#00fff9'
      });
      this.add.text(x + 160, y + 3, g.action, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#ffffff'
      });
    });

    this.add
      .text(320, 234, 'ONLINE: CREATE LOBBY -> SHARE THE 6-CHARACTER CODE ->\nYOUR OPPONENT JOINS FROM THEIR OWN LAPTOP AND CAMERA.', {
        fontFamily: '"VT323", monospace',
        fontSize: '18px',
        color: '#ffb703',
        align: 'center'
      })
      .setOrigin(0.5);

    this.add
      .text(320, 274, 'KEYBOARD FALLBACK (YOUR FIGHTER): A/D MOVE · W JUMP · J PUNCH\nK KICK · L SPECIAL · I BLOCK · O GRAB · P ULTIMATE', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#00fff9',
        align: 'center'
      })
      .setOrigin(0.5);

    const isDebug = gm.vision.isDebug();
    this.debugBtnText = this.add
      .text(200, 316, `DEBUG SKELETON: ${isDebug ? 'ON' : 'OFF'}`, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: isDebug ? '#00fff9' : '#ffb703'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.debugBtnText.on('pointerdown', () => {
      gm.vision.setDebug(!gm.vision.isDebug());
      const updated = gm.vision.isDebug();
      this.debugBtnText.setText(`DEBUG SKELETON: ${updated ? 'ON' : 'OFF'}`);
      this.debugBtnText.setColor(updated ? '#00fff9' : '#ffb703');
      SoundManager.getInstance().playMenuSelect();
    });

    const backBtn = this.add
      .text(450, 316, '< BACK TO MENU', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      SoundManager.getInstance().playMenuSelect();
      this.scene.start('MenuScene');
    });

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
  }
}

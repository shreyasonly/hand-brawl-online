import Phaser from 'phaser';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';
import { DomUI } from '../ui/DomUI';

/**
 * Per-player camera setup. Each laptop enables ITS OWN webcam here and confirms
 * that a face and a hand are visible before the fight starts. Nothing about
 * this camera is ever sent to the other player - only three booleans.
 */
export class SetupScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private faceText!: Phaser.GameObjects.Text;
  private handText!: Phaser.GameObjects.Text;
  private gestureText!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private enableBtn!: Phaser.GameObjects.Text;
  private continueBtn!: Phaser.GameObjects.Text;
  private profileText!: Phaser.GameObjects.Text;

  private requesting = false;

  constructor() {
    super({ key: 'SetupScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.CAMERA_SETUP;

    const dom = DomUI.getInstance();
    dom.updateNetBadge(gm.room.status, gm.room.roomCode, gm.room.slot);

    this.add.image(320, 180, 'stage_sky');
    this.add.image(320, 180, 'stage_city');
    this.add.rectangle(320, 180, 600, 330, 0x0a0a1a, 0.92).setStrokeStyle(2, 0x00fff9);

    const role = gm.mode === 'ONLINE' ? `YOU ARE PLAYER ${gm.localIndex}` : 'PRACTICE MODE';
    this.add
      .text(320, 34, 'CAMERA SETUP', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '18px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);

    this.add
      .text(320, 58, role, {
        fontFamily: '"VT323", monospace',
        fontSize: '21px',
        color: '#ffb703'
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(320, 86, 'ENABLE YOUR WEBCAM TO FIGHT WITH GESTURES', {
        fontFamily: '"VT323", monospace',
        fontSize: '19px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: 560 }
      })
      .setOrigin(0.5);

    this.enableBtn = this.add
      .text(320, 122, '[ ENABLE CAMERA ]', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '14px',
        color: '#00fff9'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.enableBtn.on('pointerdown', () => void this.enableCamera());

    this.faceText = this.add
      .text(320, 164, 'FACE: ---', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '13px',
        color: '#8a8aa8'
      })
      .setOrigin(0.5);

    this.handText = this.add
      .text(320, 190, 'HAND: ---', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '13px',
        color: '#8a8aa8'
      })
      .setOrigin(0.5);

    this.gestureText = this.add
      .text(320, 214, 'GESTURE: ---', {
        fontFamily: '"VT323", monospace',
        fontSize: '20px',
        color: '#8a8aa8'
      })
      .setOrigin(0.5);

    this.profileText = this.add
      .text(320, 234, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#4dff9f'
      })
      .setOrigin(0.5);

    this.opponentText = this.add
      .text(320, 258, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '18px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);

    const calibrateBtn = this.add
      .text(160, 292, '[ CALIBRATE CENTRE ]', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#ffb703'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    calibrateBtn.on('pointerdown', () => {
      gm.vision.calibrate();
      this.statusText.setText('CENTRE SET - HOLD THIS HAND POSITION TO STAND STILL');
      SoundManager.getInstance().playMenuSelect();
    });

    const debugBtn = this.add
      .text(430, 292, '[ SKELETON: OFF ]', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#ffb703'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    debugBtn.on('pointerdown', () => {
      gm.vision.setDebug(!gm.vision.isDebug());
      debugBtn.setText(`[ SKELETON: ${gm.vision.isDebug() ? 'ON' : 'OFF'} ]`);
    });
    debugBtn.setText(`[ SKELETON: ${gm.vision.isDebug() ? 'ON' : 'OFF'} ]`);

    this.continueBtn = this.add
      .text(320, 322, 'CONTINUE TO FIGHTER SELECT >', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '12px',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.continueBtn.on('pointerdown', () => {
      SoundManager.getInstance().playMenuSelect();
      this.scene.start('SelectScene');
    });

    this.input.keyboard?.on('keydown-ENTER', () => this.scene.start('SelectScene'));
    this.input.keyboard?.on('keydown-ESC', () => {
      void gm.room.leave();
      this.scene.start('MenuScene');
    });

    // The camera may already be running from an earlier match.
    if (gm.vision.camera.state === 'READY') {
      dom.showCameraPip(true);
      gm.vision.start();
      this.enableBtn.setText('[ CAMERA ON ]').setColor('#4dff9f');
    }
  }

  private async enableCamera(): Promise<void> {
    if (this.requesting) return;
    this.requesting = true;

    const gm = GameManager.getInstance();
    this.enableBtn.setText('[ REQUESTING... ]').setColor('#ffb703');
    this.statusText.setText('ALLOW CAMERA ACCESS IN YOUR BROWSER PROMPT');

    const ok = await gm.vision.enableCamera();
    this.requesting = false;

    if (ok) {
      DomUI.getInstance().showCameraPip(true);
      this.enableBtn.setText('[ CAMERA ON ]').setColor('#4dff9f');
      this.statusText.setText('SHOW YOUR FACE AND ONE HAND TO THE CAMERA');
    } else {
      this.enableBtn.setText('[ RETRY CAMERA ]').setColor('#ff5f7a');
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText(
        `${gm.vision.status.error ?? 'CAMERA UNAVAILABLE'}\nYOU CAN STILL PLAY WITH THE KEYBOARD (A/D/W/J/K/L/I/O/P)`
      );
    }
  }

  public override update(): void {
    const gm = GameManager.getInstance();
    const status = gm.vision.status;
    const dom = DomUI.getInstance();

    dom.updateVisionStatus(status);

    this.faceText.setText(status.faceDetected ? 'FACE DETECTED ✓' : 'FACE NOT DETECTED');
    this.faceText.setColor(status.faceDetected ? '#4dff9f' : '#ff5f7a');

    this.handText.setText(status.handDetected ? 'HAND DETECTED ✓' : 'HAND NOT DETECTED');
    this.handText.setColor(status.handDetected ? '#4dff9f' : '#ff5f7a');

    this.gestureText.setText(
      status.gesture === 'NONE'
        ? 'GESTURE: ---'
        : `GESTURE: ${status.gesture} (${Math.round(status.confidence * 100)}%)`
    );
    this.gestureText.setColor(status.gesture === 'NONE' ? '#8a8aa8' : '#00fff9');

    this.profileText.setText(status.profileName ? `WELCOME BACK, ${status.profileName}` : '');

    if (gm.mode === 'ONLINE') {
      const opp = gm.room.opponentMeta;
      if (!opp) {
        this.opponentText.setText('OPPONENT DISCONNECTED - WAITING...');
      } else {
        const cam = opp.cameraEnabled ? 'CAM ✓' : 'CAM --';
        const face = opp.faceDetected ? 'FACE ✓' : 'FACE --';
        const hand = opp.handDetected ? 'HAND ✓' : 'HAND --';
        this.opponentText.setText(`OPPONENT: ${cam}  ${face}  ${hand}`);
      }
    }

    const ready = status.cameraEnabled;
    this.continueBtn.setColor(ready ? '#4dff9f' : '#ffffff');
    this.continueBtn.setText(
      ready ? 'CONTINUE TO FIGHTER SELECT >' : 'CONTINUE WITHOUT CAMERA (KEYBOARD) >'
    );
  }
}

import Phaser from 'phaser';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';
import { DomUI } from '../ui/DomUI';
import { RoomSnapshot } from '../net/RoomSession';

interface LobbyInit {
  intent: 'CREATE' | 'JOIN';
  code?: string;
}

/**
 * Creates or joins a Supabase Realtime room and waits until BOTH laptops are
 * present. The room - not the player - decides who is PLAYER 1 and who is
 * PLAYER 2.
 */
export class LobbyScene extends Phaser.Scene {
  private initData: LobbyInit = { intent: 'CREATE' };

  private headlineText!: Phaser.GameObjects.Text;
  private codeText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private p1Text!: Phaser.GameObjects.Text;
  private p2Text!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private copyBtn!: Phaser.GameObjects.Text;

  private unsubscribers: Array<() => void> = [];
  private advanced = false;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  public init(data: LobbyInit): void {
    this.initData = data ?? { intent: 'CREATE' };
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.LOBBY;
    this.advanced = false;

    const dom = DomUI.getInstance();
    dom.showCameraPip(false);

    this.add.image(320, 180, 'stage_sky');
    this.add.image(320, 180, 'stage_city');
    this.add.rectangle(320, 180, 600, 320, 0x0a0a1a, 0.92).setStrokeStyle(2, 0x00fff9);

    this.headlineText = this.add
      .text(320, 40, this.initData.intent === 'CREATE' ? 'CREATING LOBBY' : 'JOINING LOBBY', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '18px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);

    this.codeText = this.add
      .text(320, 92, 'ROOM CODE: ------', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '22px',
        color: '#00fff9'
      })
      .setOrigin(0.5);

    this.copyBtn = this.add
      .text(320, 118, '[ COPY CODE ]', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#ffb703'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.copyBtn.on('pointerdown', () => void this.copyCode());

    this.statusText = this.add
      .text(320, 150, 'CONNECTING TO SUPABASE REALTIME...', {
        fontFamily: '"VT323", monospace',
        fontSize: '21px',
        color: '#ffb703',
        align: 'center',
        wordWrap: { width: 560 }
      })
      .setOrigin(0.5);

    this.p1Text = this.add
      .text(180, 210, 'PLAYER 1\nWAITING...', {
        fontFamily: '"VT323", monospace',
        fontSize: '20px',
        color: '#00fff9',
        align: 'center'
      })
      .setOrigin(0.5);

    this.p2Text = this.add
      .text(460, 210, 'PLAYER 2\nWAITING...', {
        fontFamily: '"VT323", monospace',
        fontSize: '20px',
        color: '#ff2a6d',
        align: 'center'
      })
      .setOrigin(0.5);

    this.hintText = this.add
      .text(320, 268, 'SHARE THE CODE WITH YOUR OPPONENT.\nTHEY OPEN THE SAME URL AND PICK "JOIN LOBBY".', {
        fontFamily: '"VT323", monospace',
        fontSize: '18px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);

    const backBtn = this.add
      .text(320, 318, '< BACK TO MENU', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      SoundManager.getInstance().playMenuSelect();
      void gm.room.leave();
      this.scene.start('MenuScene');
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      void gm.room.leave();
      this.scene.start('MenuScene');
    });

    this.bindRoomEvents();
    void this.connect();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribers.forEach((off) => off());
      this.unsubscribers = [];
    });
  }

  private bindRoomEvents(): void {
    const gm = GameManager.getInstance();
    const dom = DomUI.getInstance();

    this.unsubscribers.push(
      gm.room.events.on('presence', (snapshot) => this.renderPresence(snapshot)),
      gm.room.events.on('connection', (status) =>
        dom.updateNetBadge(status, gm.room.roomCode, gm.room.slot)
      ),
      gm.room.events.on('slot', () => {
        dom.updateNetBadge(gm.room.status, gm.room.roomCode, gm.room.slot);
        if (gm.room.lastSnapshot) this.renderPresence(gm.room.lastSnapshot);
      })
    );
  }

  private async connect(): Promise<void> {
    const gm = GameManager.getInstance();

    const result =
      this.initData.intent === 'CREATE'
        ? await gm.room.createRoom()
        : await gm.room.joinRoom(this.initData.code ?? '');

    if (!result.ok) {
      this.headlineText.setText('CONNECTION FAILED');
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText(`${result.error}\nPRESS ESC OR CLICK BACK TO MENU`);
      return;
    }

    gm.startOnlineMatch();

    this.headlineText.setText(result.slot === 'p1' ? 'YOU ARE PLAYER 1' : 'YOU ARE PLAYER 2');
    this.codeText.setText(`ROOM CODE: ${result.roomCode}`);
    this.copyBtn.setVisible(true);
    DomUI.getInstance().updateNetBadge(gm.room.status, result.roomCode, result.slot);

    if (gm.room.lastSnapshot) this.renderPresence(gm.room.lastSnapshot);
  }

  private renderPresence(snapshot: RoomSnapshot): void {
    const gm = GameManager.getInstance();
    const mySlot = gm.room.slot;

    const describe = (slot: 'p1' | 'p2'): string => {
      const meta = slot === 'p1' ? snapshot.p1 : snapshot.p2;
      const label = slot === 'p1' ? 'PLAYER 1' : 'PLAYER 2';
      const you = meta && meta.clientId === gm.room.clientId ? '  (YOU)' : '';
      if (!meta) return `${label}\nWAITING...`;
      return `${label}${you}\nCONNECTED ✓`;
    };

    this.p1Text.setText(describe('p1'));
    this.p2Text.setText(describe('p2'));

    if (!mySlot) return;

    if (snapshot.opponentPresent) {
      this.statusText.setColor('#4dff9f');
      this.statusText.setText('BOTH PLAYERS CONNECTED - STARTING CAMERA SETUP...');
      this.hintText.setText('');
      this.advance();
    } else {
      this.statusText.setColor('#ffb703');
      this.statusText.setText('WAITING FOR PLAYER 2...');
    }
  }

  private advance(): void {
    if (this.advanced) return;
    this.advanced = true;
    this.time.delayedCall(900, () => this.scene.start('SetupScene'));
  }

  private async copyCode(): Promise<void> {
    const code = GameManager.getInstance().room.roomCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copyBtn.setText('[ COPIED! ]');
      this.time.delayedCall(1200, () => this.copyBtn.setText('[ COPY CODE ]'));
    } catch {
      this.copyBtn.setText('[ COPY BLOCKED ]');
    }
  }
}

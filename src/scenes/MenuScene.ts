import Phaser from 'phaser';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';
import { DomUI } from '../ui/DomUI';
import { isSupabaseConfigured, supabaseConfigError } from '../net/SupabaseClient';

interface MenuOption {
  label: string;
  action: () => void;
  enabled: boolean;
}

export class MenuScene extends Phaser.Scene {
  private selectedIndex = 0;
  private menuOptions: MenuOption[] = [];
  private menuTexts: Phaser.GameObjects.Text[] = [];
  private noticeText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MenuScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.MAIN_MENU;
    gm.stopPresenceHeartbeat();

    const dom = DomUI.getInstance();
    dom.showCameraPip(false);
    dom.updateNetBadge('OFFLINE', null, null);

    // Leaving any previous room frees the slot for the other player.
    if (gm.room.isOnline) void gm.room.leave();

    this.add.image(320, 180, 'stage_sky');
    this.add.image(320, 180, 'stage_city');
    this.add.image(320, 180, 'stage_street');

    const title = this.add
      .text(320, 62, 'HAND BRAWL', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '40px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);
    title.setStroke('#00fff9', 6);
    title.setShadow(4, 4, '#000000', 0, true, true);

    this.add
      .text(320, 104, 'ONLINE 2-PLAYER GESTURE FIGHTER', {
        fontFamily: '"VT323", monospace',
        fontSize: '22px',
        color: '#ffb703'
      })
      .setOrigin(0.5);

    this.add
      .text(320, 124, 'TWO LAPTOPS  ·  TWO WEBCAMS  ·  ONE MATCH', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#00fff9'
      })
      .setOrigin(0.5);

    const online = isSupabaseConfigured();

    this.menuOptions = [
      {
        label: 'CREATE LOBBY',
        enabled: online,
        action: () => this.scene.start('LobbyScene', { intent: 'CREATE' })
      },
      {
        label: 'JOIN LOBBY',
        enabled: online,
        action: () => void this.askForCode()
      },
      {
        label: 'PRACTICE (THIS LAPTOP)',
        enabled: true,
        action: () => {
          gm.startPracticeMatch();
          this.scene.start('SetupScene');
        }
      },
      {
        label: 'HOW TO PLAY',
        enabled: true,
        action: () => this.scene.start('HowToPlayScene')
      }
    ];

    this.menuTexts = this.menuOptions.map((opt, idx) => {
      const text = this.add
        .text(320, 168 + idx * 32, opt.label, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '15px',
          color: '#ffffff'
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      text.on('pointerover', () => {
        this.selectedIndex = idx;
        this.updateSelection();
        SoundManager.getInstance().playMenuSelect();
      });

      text.on('pointerdown', () => this.activate(idx));
      return text;
    });

    this.noticeText = this.add
      .text(320, 316, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#ff5f7a',
        align: 'center',
        wordWrap: { width: 600 }
      })
      .setOrigin(0.5);

    if (!online) {
      this.noticeText.setText(
        `${supabaseConfigError() ?? 'SUPABASE NOT CONFIGURED'}\nONLINE PLAY DISABLED - PRACTICE MODE STILL WORKS`
      );
      // Land the cursor on the first option the player can actually pick.
      this.selectedIndex = 2;
    }

    this.updateSelection();

    this.input.keyboard?.on('keydown-UP', () => this.move(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.move(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.activate(this.selectedIndex));
    this.input.keyboard?.on('keydown-SPACE', () => this.activate(this.selectedIndex));

    const prompt = this.add
      .text(320, 340, 'ARROWS + ENTER, OR CLICK', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        color: '#00fff9'
      })
      .setOrigin(0.5);

    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });
  }

  private async askForCode(): Promise<void> {
    const dom = DomUI.getInstance();
    const code = await dom.promptRoomCode();
    dom.closeModal(null);
    if (!code) return;
    this.scene.start('LobbyScene', { intent: 'JOIN', code });
  }

  private move(delta: number): void {
    const count = this.menuOptions.length;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.updateSelection();
    SoundManager.getInstance().playMenuSelect();
  }

  private activate(index: number): void {
    const option = this.menuOptions[index];
    if (!option) return;

    if (!option.enabled) {
      this.noticeText.setText(
        `${supabaseConfigError() ?? 'ONLINE UNAVAILABLE'}\nADD YOUR SUPABASE KEYS TO PLAY ONLINE`
      );
      return;
    }

    SoundManager.getInstance().playMenuSelect();
    option.action();
  }

  private updateSelection(): void {
    this.menuTexts.forEach((txt, idx) => {
      const option = this.menuOptions[idx];
      const base = option.enabled ? '#ffffff' : '#5b5b74';

      if (idx === this.selectedIndex) {
        txt.setColor(option.enabled ? '#ff2a6d' : '#7a5b68');
        txt.setText(`> ${option.label} <`);
      } else {
        txt.setColor(base);
        txt.setText(option.label);
      }
    });
  }
}

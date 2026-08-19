import Phaser from 'phaser';
import { GameManager, GameState } from '../game/GameManager';
import { SoundManager } from '../audio/SoundManager';
import { DomUI } from '../ui/DomUI';
import { CharacterId, MatchMessage } from '../net/Protocol';

const STATS: Record<CharacterId, string> = {
  JACK: 'JACK - BALANCED MARTIAL ARTIST\nHP 100 | SPD 5 | ATK 5 | DEF 5\nSPECIAL: THUNDER PUNCH',
  KIRA: 'KIRA - FAST CYBERPUNK FIGHTER\nHP 90 | SPD 8 | ATK 4 | DEF 3\nSPECIAL: SHADOW DASH'
};

const SPRITE_KEY: Record<CharacterId, string> = {
  JACK: 'jack_sprites',
  KIRA: 'kira_sprites'
};

/** Animations are registered as `${spriteKey}_idle` by Character. */
const IDLE_ANIM: Record<CharacterId, string> = {
  JACK: 'jack_sprites_idle',
  KIRA: 'kira_sprites_idle'
};

/**
 * Fighter select.
 *
 * ONLINE   : each player picks THEIR OWN fighter; the choice travels through
 *            Supabase presence so the other laptop sees it live. When both are
 *            ready, PLAYER 1 (the match authority) starts the match.
 * PRACTICE : the original local two-player select is preserved.
 */
export class SelectScene extends Phaser.Scene {
  private p1Selection: CharacterId = 'JACK';
  private p2Selection: CharacterId = 'KIRA';

  private p1Sprite!: Phaser.GameObjects.Sprite;
  private p2Sprite!: Phaser.GameObjects.Sprite;
  private p1StatsText!: Phaser.GameObjects.Text;
  private p2StatsText!: Phaser.GameObjects.Text;
  private p1HeaderText!: Phaser.GameObjects.Text;
  private p2HeaderText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private readyBtn!: Phaser.GameObjects.Text;
  private vsText!: Phaser.GameObjects.Text;

  private localReady = false;
  private launching = false;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super({ key: 'SelectScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.CHARACTER_SELECT;
    this.localReady = false;
    this.launching = false;

    if (gm.mode === 'ONLINE') {
      // Start from whatever this player already published (defaults per slot).
      this.p1Selection = gm.room.lastSnapshot?.p1?.character ?? 'JACK';
      this.p2Selection = gm.room.lastSnapshot?.p2?.character ?? 'KIRA';
      const mine = gm.localIndex === 1 ? this.p1Selection : this.p2Selection;
      void gm.room.setCharacter(mine);
      void gm.room.setReady(false);
    }

    this.add.image(320, 180, 'stage_sky');
    this.add.image(320, 180, 'stage_city');

    const title = this.add
      .text(320, 26, 'SELECT YOUR FIGHTER', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '20px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);
    title.setStroke('#00fff9', 4);

    // ---- Player 1 card ------------------------------------------------------
    this.add.rectangle(170, 176, 240, 210, 0x10002b, 0.85).setStrokeStyle(3, 0x00fff9);
    this.p1HeaderText = this.add
      .text(170, 88, 'PLAYER 1', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '13px',
        color: '#00fff9'
      })
      .setOrigin(0.5);

    this.p1Sprite = this.add.sprite(170, 152, SPRITE_KEY[this.p1Selection], 0).setScale(2);
    this.p1StatsText = this.add
      .text(170, 216, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);

    // ---- Player 2 card ------------------------------------------------------
    this.add.rectangle(470, 176, 240, 210, 0x10002b, 0.85).setStrokeStyle(3, 0xff2a6d);
    this.p2HeaderText = this.add
      .text(470, 88, 'PLAYER 2', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '13px',
        color: '#ff2a6d'
      })
      .setOrigin(0.5);

    this.p2Sprite = this.add.sprite(470, 152, SPRITE_KEY[this.p2Selection], 0).setScale(2);
    this.p2Sprite.setFlipX(true);
    this.p2StatsText = this.add
      .text(470, 216, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '17px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);

    this.vsText = this.add
      .text(320, 152, 'VS', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '20px',
        color: '#ffb703'
      })
      .setOrigin(0.5);

    this.buildPickButtons();

    this.statusText = this.add
      .text(320, 300, '', {
        fontFamily: '"VT323", monospace',
        fontSize: '19px',
        color: '#ffb703',
        align: 'center',
        wordWrap: { width: 600 }
      })
      .setOrigin(0.5);

    this.readyBtn = this.add
      .text(320, 332, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '14px',
        color: '#ffb703'
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.readyBtn.on('pointerdown', () => this.confirm());
    this.input.keyboard?.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard?.on('keydown-SPACE', () => this.confirm());
    this.input.keyboard?.on('keydown-ESC', () => {
      void gm.room.leave();
      this.scene.start('MenuScene');
    });

    if (gm.mode === 'ONLINE') this.bindRoomEvents();

    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribers.forEach((off) => off());
      this.unsubscribers = [];
    });
  }

  private buildPickButtons(): void {
    const gm = GameManager.getInstance();
    const online = gm.mode === 'ONLINE';

    const makeButton = (
      x: number,
      y: number,
      label: CharacterId,
      owner: 1 | 2
    ): Phaser.GameObjects.Text => {
      const btn = this.add
        .text(x, y, label, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '12px',
          color: '#ffffff'
        })
        .setOrigin(0.5);

      const canPick = !online || gm.localIndex === owner;
      if (canPick) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => this.pick(owner, label));
      } else {
        btn.setAlpha(0.4);
      }
      return btn;
    };

    makeButton(125, 268, 'JACK', 1);
    makeButton(215, 268, 'KIRA', 1);
    makeButton(425, 268, 'JACK', 2);
    makeButton(515, 268, 'KIRA', 2);

    if (!online) {
      // Preserve the original practice-mode keyboard picks.
      this.input.keyboard?.on('keydown-A', () => this.pick(1, 'JACK'));
      this.input.keyboard?.on('keydown-D', () => this.pick(1, 'KIRA'));
      this.input.keyboard?.on('keydown-LEFT', () => this.pick(2, 'JACK'));
      this.input.keyboard?.on('keydown-RIGHT', () => this.pick(2, 'KIRA'));
    } else {
      const owner = gm.localIndex;
      this.input.keyboard?.on('keydown-LEFT', () => this.pick(owner, 'JACK'));
      this.input.keyboard?.on('keydown-RIGHT', () => this.pick(owner, 'KIRA'));
    }
  }

  private pick(owner: 1 | 2, character: CharacterId): void {
    const gm = GameManager.getInstance();
    if (gm.mode === 'ONLINE' && gm.localIndex !== owner) return;
    if (this.localReady) return;

    if (owner === 1) this.p1Selection = character;
    else this.p2Selection = character;

    if (gm.mode === 'ONLINE') void gm.room.setCharacter(character);

    SoundManager.getInstance().playMenuSelect();
    this.refresh();
  }

  private confirm(): void {
    const gm = GameManager.getInstance();
    SoundManager.getInstance().playMenuSelect();

    if (gm.mode === 'PRACTICE') {
      gm.p1Character = this.p1Selection;
      gm.p2Character = this.p2Selection;
      gm.resetMatch();
      this.scene.start('FightScene');
      return;
    }

    this.localReady = !this.localReady;
    void gm.room.setReady(this.localReady);
    this.refresh();
    this.tryStartOnlineMatch();
  }

  private bindRoomEvents(): void {
    const gm = GameManager.getInstance();

    this.unsubscribers.push(
      gm.room.events.on('presence', () => {
        this.syncFromPresence();
        this.tryStartOnlineMatch();
      }),
      gm.room.events.on('lobby', (msg) => {
        // Fast path: apply the opponent's pick before presence catches up.
        if (msg.playerId === 'p1') this.p1Selection = msg.character;
        if (msg.playerId === 'p2') this.p2Selection = msg.character;
        this.refresh();
      }),
      gm.room.events.on('match', (msg) => this.onMatchMessage(msg))
    );
  }

  private syncFromPresence(): void {
    const gm = GameManager.getInstance();
    const snapshot = gm.room.lastSnapshot;
    if (!snapshot) return;

    if (snapshot.p1) this.p1Selection = snapshot.p1.character;
    if (snapshot.p2) this.p2Selection = snapshot.p2.character;
    this.refresh();
  }

  /**
   * Our own ready flag is read from local state rather than from presence:
   * `track()` needs a network round-trip, and we should not wait for our own
   * click to come back to us before the match can start.
   */
  private readyFlags(): { p1Ready: boolean; p2Ready: boolean } {
    const gm = GameManager.getInstance();
    const snapshot = gm.room.lastSnapshot;
    return {
      p1Ready: gm.localIndex === 1 ? this.localReady : (snapshot?.p1?.ready ?? false),
      p2Ready: gm.localIndex === 2 ? this.localReady : (snapshot?.p2?.ready ?? false)
    };
  }

  /** Only PLAYER 1 may declare the match started, so both sides agree. */
  private tryStartOnlineMatch(): void {
    const gm = GameManager.getInstance();
    if (this.launching || !gm.isMatchAuthority) return;

    const snapshot = gm.room.lastSnapshot;
    if (!snapshot?.p1 || !snapshot?.p2) return;

    const { p1Ready, p2Ready } = this.readyFlags();
    if (!p1Ready || !p2Ready) return;

    const message: MatchMessage = {
      type: 'MATCH',
      playerId: 'p1',
      timestamp: Date.now(),
      kind: 'START_MATCH',
      p1Character: this.p1Selection,
      p2Character: this.p2Selection
    };

    gm.room.sendMatch(message);
    this.launchMatch(this.p1Selection, this.p2Selection);
  }

  private onMatchMessage(msg: MatchMessage): void {
    if (msg.kind !== 'START_MATCH') return;
    this.launchMatch(msg.p1Character ?? this.p1Selection, msg.p2Character ?? this.p2Selection);
  }

  private launchMatch(p1: CharacterId, p2: CharacterId): void {
    if (this.launching) return;
    this.launching = true;

    const gm = GameManager.getInstance();
    gm.p1Character = p1;
    gm.p2Character = p2;
    gm.resetMatch();

    this.statusText.setColor('#4dff9f');
    this.statusText.setText(`${p1} VS ${p2} - GET READY!`);
    this.time.delayedCall(700, () => this.scene.start('FightScene'));
  }

  private refresh(): void {
    const gm = GameManager.getInstance();
    const online = gm.mode === 'ONLINE';

    this.applyCard(this.p1Sprite, this.p1StatsText, this.p1Selection, false);
    this.applyCard(this.p2Sprite, this.p2StatsText, this.p2Selection, true);

    if (!online) {
      this.p1HeaderText.setText('PLAYER 1 (WASD)');
      this.p2HeaderText.setText('PLAYER 2 (ARROWS)');
      this.statusText.setText('PRACTICE MATCH ON THIS LAPTOP - BOTH FIGHTERS ARE YOURS');
      this.readyBtn.setText('FIGHT! [ENTER]');
      this.readyBtn.setColor('#ffb703');
      return;
    }

    const snapshot = gm.room.lastSnapshot;
    const { p1Ready, p2Ready } = this.readyFlags();

    this.p1HeaderText.setText(
      `PLAYER 1${gm.localIndex === 1 ? ' (YOU)' : ''}${p1Ready ? ' ✓' : ''}`
    );
    this.p2HeaderText.setText(
      `PLAYER 2${gm.localIndex === 2 ? ' (YOU)' : ''}${p2Ready ? ' ✓' : ''}`
    );

    const opponentPresent = snapshot?.opponentPresent ?? false;
    if (!opponentPresent) {
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText('OPPONENT DISCONNECTED - WAITING FOR THEM TO COME BACK...');
    } else if (this.localReady) {
      this.statusText.setColor('#4dff9f');
      this.statusText.setText('YOU ARE READY - WAITING FOR YOUR OPPONENT...');
    } else {
      this.statusText.setColor('#ffb703');
      this.statusText.setText('PICK YOUR FIGHTER, THEN HIT READY');
    }

    this.readyBtn.setText(this.localReady ? 'READY ✓  [CLICK TO CANCEL]' : 'CLICK TO READY');
    this.readyBtn.setColor(this.localReady ? '#4dff9f' : '#ffb703');
  }

  private applyCard(
    sprite: Phaser.GameObjects.Sprite,
    stats: Phaser.GameObjects.Text,
    character: CharacterId,
    flip: boolean
  ): void {
    const key = SPRITE_KEY[character];
    if (sprite.texture.key !== key) {
      sprite.setTexture(key, 0);
    }
    sprite.play(IDLE_ANIM[character], true);
    sprite.setFlipX(flip);
    stats.setText(STATS[character]);
  }

  public override update(): void {
    DomUI.getInstance().updateVisionStatus(GameManager.getInstance().vision.status);
  }
}

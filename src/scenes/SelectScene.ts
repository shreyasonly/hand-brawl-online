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
 * ONLINE   : Each player picks their own fighter and sends READY to the game
 *            server. The SERVER decides when both are ready and broadcasts
 *            START_MATCH - the clients only follow.
 * PRACTICE : The local two-player select is preserved.
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
  private retryTimer: number | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super({ key: 'SelectScene' });
  }

  public create(): void {
    const gm = GameManager.getInstance();
    gm.currentState = GameState.CHARACTER_SELECT;
    this.localReady = false;
    this.launching = false;
    this.launched = false;

    if (gm.mode === 'ONLINE') {
      const roomState = gm.room.getRoomState();
      this.p1Selection = roomState.players.p1?.character ?? gm.p1Character ?? 'JACK';
      this.p2Selection = roomState.players.p2?.character ?? gm.p2Character ?? 'KIRA';
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

    if (gm.mode === 'ONLINE') {
      this.bindRoomEvents();

      // Self-healing UI refresh on a DOM timer (Phaser timers freeze in
      // background tabs). Match start itself is the SERVER's job now.
      this.retryTimer = window.setInterval(() => {
        if (this.launching) return;
        this.syncFromRoomState();
        this.refresh();
      }, 1000);
    }

    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribers.forEach((off) => off());
      this.unsubscribers = [];
      if (this.retryTimer !== null) {
        window.clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
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
    console.log('[READY CLICK]', {
      slot: gm.room.slot,
      localReady: this.localReady
    });

    void gm.room.setReady(this.localReady);
    this.refresh();
  }

  private bindRoomEvents(): void {
    const gm = GameManager.getInstance();

    this.unsubscribers.push(
      gm.room.events.on('roomState', () => {
        this.syncFromRoomState();
        this.refresh();
      }),
      gm.room.events.on('presence', () => {
        this.syncFromRoomState();
        this.refresh();
      }),
      gm.room.events.on('lobby', (msg) => {
        if (msg.playerId === 'p1') this.p1Selection = msg.character;
        if (msg.playerId === 'p2') this.p2Selection = msg.character;
        this.refresh();
      }),
      gm.room.events.on('match', (msg) => {
        console.log('[MATCH MESSAGE RECEIVED]', msg);
        this.onMatchMessage(msg);
      })
    );
  }

  private syncFromRoomState(): void {
    const gm = GameManager.getInstance();
    const roomState = gm.room.getRoomState();

    if (roomState.players.p1?.character) {
      this.p1Selection = roomState.players.p1.character;
    }
    if (roomState.players.p2?.character) {
      this.p2Selection = roomState.players.p2.character;
    }
  }

  private readyFlags(): { p1Ready: boolean; p2Ready: boolean } {
    const gm = GameManager.getInstance();
    const roomState = gm.room.getRoomState();

    const p1Ready =
      gm.localIndex === 1
        ? this.localReady
        : (roomState.players.p1?.ready ?? false);

    const p2Ready =
      gm.localIndex === 2
        ? this.localReady
        : (roomState.players.p2?.ready ?? false);

    return { p1Ready, p2Ready };
  }

  private onMatchMessage(msg: MatchMessage): void {
    const gm = GameManager.getInstance();
    if (msg.kind === 'START_MATCH') {
      console.log('[START_MATCH RECEIVED]', {
        receiver: gm.room.slot,
        msg
      });
      this.launchMatch(msg.p1Character ?? this.p1Selection, msg.p2Character ?? this.p2Selection);
      return;
    }

    // The fight is already running (we lagged behind, were backgrounded, or
    // reconnected) - skip the beauty delay and enter the FightScene NOW.
    if (msg.kind === 'ROUND_START' || msg.kind === 'COUNTDOWN' || msg.kind === 'TIMER') {
      this.launchMatch(this.p1Selection, this.p2Selection, true);
    }
  }

  private launched = false;

  private launchMatch(p1: CharacterId, p2: CharacterId, immediate = false): void {
    if (this.launched) return;

    if (!this.launching) {
      this.launching = true;

      const gm = GameManager.getInstance();
      console.log('[LAUNCH MATCH]', {
        slot: gm.room.slot,
        p1,
        p2
      });

      gm.p1Character = p1;
      gm.p2Character = p2;
      gm.resetMatch();
      gm.room.setMatchState('COUNTDOWN');

      this.statusText.setColor('#4dff9f');
      this.statusText.setText(`${p1} VS ${p2} - GET READY!`);
    }

    // DOM timer, NOT this.time.delayedCall: Phaser's clock freezes in a
    // background tab, and the fight must start even when this window isn't
    // focused (websocket callbacks keep firing regardless).
    const start = () => {
      if (this.launched) return;
      this.launched = true;
      this.scene.start('FightScene');
    };
    if (immediate) start();
    else window.setTimeout(start, 700);
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

    const { p1Ready, p2Ready } = this.readyFlags();

    this.p1HeaderText.setText(
      `PLAYER 1${gm.localIndex === 1 ? ' (YOU)' : ''}${p1Ready ? ' ✓' : ''}`
    );
    this.p2HeaderText.setText(
      `PLAYER 2${gm.localIndex === 2 ? ' (YOU)' : ''}${p2Ready ? ' ✓' : ''}`
    );

    const roomState = gm.room.getRoomState();
    const opponentSlot = gm.room.opponentSlot;
    const opponentPlayer = opponentSlot ? roomState.players[opponentSlot] : null;
    const opponentPresent = (opponentPlayer && opponentPlayer.connected) || (gm.room.lastSnapshot?.opponentPresent ?? false);
    const opponentReady = gm.localIndex === 1 ? p2Ready : p1Ready;

    // OUR socket has problems - say so instead of silently eating clicks.
    if (gm.room.status === 'RECONNECTING') {
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText('CONNECTION LOST - RECONNECTING TO THE GAME SERVER...');
      return;
    }
    if (gm.room.status === 'ERROR' || gm.room.status === 'OFFLINE') {
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText('CONNECTION TO THE GAME SERVER WAS LOST\nPRESS ESC AND CREATE / JOIN A NEW LOBBY');
      return;
    }

    if (!opponentPresent) {
      this.statusText.setColor('#ff5f7a');
      this.statusText.setText('OPPONENT DISCONNECTED - WAITING FOR THEM TO COME BACK...');
    } else if (this.localReady && opponentReady) {
      this.statusText.setColor('#4dff9f');
      this.statusText.setText('BOTH PLAYERS READY - STARTING THE MATCH...');
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

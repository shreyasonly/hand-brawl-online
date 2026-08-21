import { Room, Client } from '@colyseus/core';
import {
  GameState,
  PlayerState,
  PlayerSlot,
  CharacterId,
  MAX_HP
} from '../state/GameState';

const ROUNDS_TO_WIN = 2;
const ROUND_TIME_SECONDS = 60;

/** How long a dropped player may reconnect before the match is forfeited. */
const RECONNECT_GRACE_SECONDS = 20;

/** If a client never reports its FightScene loaded, start anyway after this. */
const FIGHT_READY_TIMEOUT_MS = 8000;

/** Presentation timings, matched to the client's announcer animations. */
const COUNTDOWN_STEPS: Array<{ at: number; value: string }> = [
  { at: 900, value: '3' },
  { at: 1550, value: '2' },
  { at: 2200, value: '1' },
  { at: 2850, value: 'FIGHT' }
];
const ROUND_END_TO_NEXT_ROUND_MS = 4600;
const ROUND_END_TO_MATCH_END_MS = 1600;

/** Max damage per attack type (base damage x the strongest attackPower). */
const DAMAGE_CAP: Record<string, number> = {
  PUNCH: 12,
  KICK: 16,
  GRAB: 18,
  SPECIAL: 24,
  ULTIMATE: 48
};
const MIN_MS_BETWEEN_HITS = 180;
const MAX_HIT_RANGE_PX = 300;

const ARENA_WIDTH = 640;
const ARENA_HEIGHT = 360;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const otherSlot = (slot: PlayerSlot): PlayerSlot => (slot === 'p1' ? 'p2' : 'p1');

interface LobbyPayload {
  character?: CharacterId;
  ready?: boolean;
  cameraEnabled?: boolean;
  faceDetected?: boolean;
  handDetected?: boolean;
}

/** Non-replicated per-player runtime bookkeeping. */
interface Runtime {
  x: number;
  y: number;
  lastHitAt: number;
  fightReady: boolean;
  inputCount: number;
  stateCount: number;
  windowStart: number;
}

/**
 * The authoritative room for one HAND BRAWL match.
 *
 * The server owns: slot assignment, the match phase state machine, the
 * countdown, the round clock, health, the score, the winner, and - most
 * importantly - the truth about who is connected. Clients simulate their own
 * fighter for responsiveness, but every result that both screens must agree on
 * comes from here.
 */
export class GameRoom extends Room<{ state: GameState }> {
  maxClients = 2;

  private slotBySession = new Map<string, PlayerSlot>();
  private runtime = new Map<PlayerSlot, Runtime>();

  private roundActive = false;
  private timerHandle: { clear: () => void } | null = null;
  private pendingTimeouts: Array<{ clear: () => void }> = [];
  /** Guards double round-starts (fightReady race + timeout fallback). */
  private roundSequenceRunning = false;

  onCreate(options: { roomCode?: string }): void {
    const state = new GameState();
    const requested = (options?.roomCode ?? '').toUpperCase();
    state.roomCode = CODE_PATTERN.test(requested) ? requested : this.generateCode();
    this.setState(state);

    // joinRoom() matches on this via filterBy(['roomCode']).
    this.setMetadata({ roomCode: state.roomCode });

    console.log(`[ROOM CREATED] ${this.roomId} code=${state.roomCode}`);

    this.onMessage('lobby', (client, msg: LobbyPayload) => this.handleLobby(client, msg));
    this.onMessage('fightReady', (client) => this.handleFightReady(client));
    this.onMessage('input', (client, msg) => this.relayInput(client, msg));
    this.onMessage('state', (client, msg) => this.relayState(client, msg));
    this.onMessage('hit', (client, msg) => this.handleHit(client, msg));
    this.onMessage('rematch', (client) => this.handleRematch(client));
    this.onMessage('needState', (client) => this.sendRoundState(client));
  }

  onJoin(client: Client, _options: { roomCode?: string }): void {
    const slot: PlayerSlot = this.state.players.has('p1') ? 'p2' : 'p1';

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.slot = slot;
    player.character = slot === 'p1' ? 'JACK' : 'KIRA';
    player.connected = true;
    player.hp = MAX_HP[player.character];
    this.state.players.set(slot, player);

    this.slotBySession.set(client.sessionId, slot);
    this.runtime.set(slot, {
      x: slot === 'p1' ? 180 : 460,
      y: 260,
      lastHitAt: 0,
      fightReady: false,
      inputCount: 0,
      stateCount: 0,
      windowStart: Date.now()
    });

    client.send('slot', { slot, roomCode: this.state.roomCode });

    if (this.state.players.size === 2) {
      this.state.phase = 'LOBBY';
      this.lock();
    }

    console.log(
      `[PLAYER ASSIGNED] room=${this.state.roomCode} session=${client.sessionId} slot=${slot} players=${this.state.players.size}`
    );
  }

  private isFightPhase(): boolean {
    return (
      this.state.phase === 'STARTING' ||
      this.state.phase === 'COUNTDOWN' ||
      this.state.phase === 'FIGHTING' ||
      this.state.phase === 'ROUND_END' ||
      this.state.phase === 'MATCH_END'
    );
  }

  /** Consented leave (client called room.leave(): ESC, back-to-menu, tab close). */
  onLeave(client: Client): void {
    const slot = this.slotBySession.get(client.sessionId);
    if (!slot) return;

    const inFight = this.isFightPhase();
    console.log(
      `[PLAYER LEFT] room=${this.state.roomCode} slot=${slot} consented=true phase=${this.state.phase}`
    );
    this.removePlayer(client, slot);

    if (inFight && this.state.players.size > 0) {
      // Mid-fight rage quit / ESC: the remaining player wins.
      this.finishByAbandon(otherSlot(slot));
    }
  }

  /** Unexpected socket loss - the ONLY authority on "opponent disconnected". */
  async onDrop(client: Client, code?: number): Promise<void> {
    const slot = this.slotBySession.get(client.sessionId);
    if (!slot) return;

    const player = this.state.players.get(slot);
    if (!player) return;

    // A lone room creator whose socket died: nothing to preserve, let the
    // room dispose so the code can be reused.
    if (this.state.phase === 'WAITING_FOR_PLAYER') {
      console.log(
        `[PLAYER LEFT] room=${this.state.roomCode} slot=${slot} dropped code=${code} phase=${this.state.phase}`
      );
      this.removePlayer(client, slot);
      return;
    }

    // Everywhere else (lobby, select AND the fight): hold the slot and give
    // them a reconnect window. A wifi blip during character select must not
    // silently kill the session - that ends in "READY does nothing".
    const wasInFight = this.isFightPhase();
    player.connected = false;
    if (wasInFight) this.state.pausedForDisconnect = true;
    console.log(
      `[PLAYER DISCONNECTED] room=${this.state.roomCode} slot=${slot} code=${code} phase=${this.state.phase} grace=${RECONNECT_GRACE_SECONDS}s`
    );

    try {
      const reconnected = await this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
      // Same player is back on a fresh socket.
      this.slotBySession.delete(client.sessionId);
      this.slotBySession.set(reconnected.sessionId, slot);
      player.sessionId = reconnected.sessionId;
      player.connected = true;
      this.refreshPauseFlag();
      console.log(`[PLAYER RECONNECTED] room=${this.state.roomCode} slot=${slot}`);
      if (this.isFightPhase()) {
        this.sendRoundState(reconnected);
      } else {
        // Both may have readied up around the drop - re-evaluate.
        this.tryStartMatch();
      }
    } catch {
      console.log(`[RECONNECT WINDOW EXPIRED] room=${this.state.roomCode} slot=${slot}`);
      const inFight = this.isFightPhase();
      this.removePlayer(client, slot);
      if (inFight && this.state.players.size > 0) {
        this.finishByAbandon(otherSlot(slot));
      }
    }
  }

  onDispose(): void {
    this.clearTimers();
    console.log(`[ROOM DISPOSED] ${this.roomId} code=${this.state.roomCode}`);
  }

  // ---------------------------------------------------------------------------
  // Lobby: character select + ready
  // ---------------------------------------------------------------------------

  private handleLobby(client: Client, msg: LobbyPayload): void {
    const player = this.playerFor(client);
    if (!player || !msg) return;

    const preFight = this.state.phase === 'WAITING_FOR_PLAYER' || this.state.phase === 'LOBBY';

    if (preFight && (msg.character === 'JACK' || msg.character === 'KIRA')) {
      player.character = msg.character;
      player.hp = MAX_HP[player.character];
    }

    if (typeof msg.cameraEnabled === 'boolean') player.cameraEnabled = msg.cameraEnabled;
    if (typeof msg.faceDetected === 'boolean') player.faceDetected = msg.faceDetected;
    if (typeof msg.handDetected === 'boolean') player.handDetected = msg.handDetected;

    if (preFight && typeof msg.ready === 'boolean') {
      player.ready = msg.ready;
      console.log(`[READY] room=${this.state.roomCode} slot=${player.slot} ready=${msg.ready}`);
      this.tryStartMatch();
    }
  }

  /** Both players READY -> the SERVER (nobody else) starts the match. */
  private tryStartMatch(): void {
    if (this.state.phase !== 'LOBBY') return;

    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    if (!p1 || !p2 || !p1.ready || !p2.ready) return;
    if (!p1.connected || !p2.connected) return;

    this.state.phase = 'STARTING';
    this.state.round = 1;
    p1.wins = 0;
    p2.wins = 0;
    p1.rematch = false;
    p2.rematch = false;
    this.resetRoundRuntime();

    console.log(
      `[BOTH READY] room=${this.state.roomCode} p1=${p1.character} p2=${p2.character} -> START_MATCH`
    );

    this.broadcast('match', {
      kind: 'START_MATCH',
      p1Character: p1.character,
      p2Character: p2.character
    });

    // If a client never reports its FightScene ready, start anyway - it will
    // catch up from ROUND_START / COUNTDOWN / TIMER messages.
    this.pendingTimeouts.push(
      this.clock.setTimeout(() => {
        if (this.state.phase === 'STARTING') {
          console.log(`[FIGHT READY TIMEOUT] room=${this.state.roomCode} - starting anyway`);
          this.beginRoundSequence();
        }
      }, FIGHT_READY_TIMEOUT_MS)
    );
  }

  private handleFightReady(client: Client): void {
    const player = this.playerFor(client);
    if (!player) return;
    const rt = this.runtime.get(player.slot);
    if (rt) rt.fightReady = true;

    console.log(`[FIGHT SCENE READY] room=${this.state.roomCode} slot=${player.slot}`);

    if (this.state.phase !== 'STARTING') return;
    const allReady = ['p1', 'p2'].every((s) => this.runtime.get(s as PlayerSlot)?.fightReady);
    if (allReady) this.beginRoundSequence();
  }

  // ---------------------------------------------------------------------------
  // Round flow: COUNTDOWN -> FIGHTING -> ROUND_END -> (next round | MATCH_END)
  // ---------------------------------------------------------------------------

  private beginRoundSequence(): void {
    if (this.roundSequenceRunning) return;
    this.roundSequenceRunning = true;

    this.clearTimers();
    this.state.phase = 'COUNTDOWN';
    this.state.timerSeconds = ROUND_TIME_SECONDS;
    this.roundActive = false;

    // Fresh HP each round; positions reset client-side on ROUND_START.
    for (const slot of ['p1', 'p2'] as PlayerSlot[]) {
      const p = this.state.players.get(slot);
      if (p) p.hp = MAX_HP[p.character];
      const rt = this.runtime.get(slot);
      if (rt) {
        rt.x = slot === 'p1' ? 180 : 460;
        rt.y = 260;
        rt.lastHitAt = 0;
      }
    }

    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    console.log(`[COUNTDOWN] room=${this.state.roomCode} round=${this.state.round}`);

    this.broadcast('match', {
      kind: 'ROUND_START',
      round: this.state.round,
      p1Wins: p1?.wins ?? 0,
      p2Wins: p2?.wins ?? 0,
      p1Character: p1?.character,
      p2Character: p2?.character
    });

    for (const step of COUNTDOWN_STEPS) {
      this.pendingTimeouts.push(
        this.clock.setTimeout(() => {
          this.broadcast('match', { kind: 'COUNTDOWN', value: step.value });
          if (step.value === 'FIGHT') this.beginFighting();
        }, step.at)
      );
    }
  }

  private beginFighting(): void {
    this.state.phase = 'FIGHTING';
    this.roundActive = true;
    this.roundSequenceRunning = false;
    console.log(`[FIGHT START] room=${this.state.roomCode} round=${this.state.round}`);

    this.timerHandle = this.clock.setInterval(() => {
      if (!this.roundActive || this.state.pausedForDisconnect) return;

      this.state.timerSeconds = Math.max(0, this.state.timerSeconds - 1);
      this.broadcast('match', { kind: 'TIMER', secondsLeft: this.state.timerSeconds });

      if (this.state.timerSeconds <= 0) this.handleTimeOver();
    }, 1000);
  }

  private handleTimeOver(): void {
    if (!this.roundActive) return;
    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    // Same tie-break the old client used: P1 wins unless P2 has strictly more HP.
    const winner: PlayerSlot = (p2?.hp ?? 0) > (p1?.hp ?? 0) ? 'p2' : 'p1';
    console.log(`[TIME OVER] room=${this.state.roomCode} winner=${winner}`);
    this.endRound(winner, true);
  }

  private endRound(winnerSlot: PlayerSlot, byTimeout = false): void {
    if (!this.roundActive) return;
    this.roundActive = false;
    this.clearTimers();

    const winner = this.state.players.get(winnerSlot);
    if (!winner) return;
    winner.wins += 1;

    const p1Wins = this.state.players.get('p1')?.wins ?? 0;
    const p2Wins = this.state.players.get('p2')?.wins ?? 0;
    const matchOver = winner.wins >= ROUNDS_TO_WIN;

    this.state.phase = 'ROUND_END';
    console.log(
      `[ROUND END] room=${this.state.roomCode} round=${this.state.round} winner=${winnerSlot} score=${p1Wins}-${p2Wins} matchOver=${matchOver}`
    );

    this.broadcast('match', {
      kind: 'ROUND_END',
      roundWinner: winnerSlot === 'p1' ? 1 : 2,
      round: this.state.round,
      p1Wins,
      p2Wins,
      byTimeout
    });

    if (matchOver) {
      this.pendingTimeouts.push(
        this.clock.setTimeout(() => {
          this.state.phase = 'MATCH_END';
          console.log(`[MATCH END] room=${this.state.roomCode} winner=${winnerSlot}`);
          this.broadcast('match', {
            kind: 'MATCH_END',
            matchWinner: winnerSlot === 'p1' ? 1 : 2,
            round: this.state.round,
            p1Wins,
            p2Wins
          });
        }, ROUND_END_TO_MATCH_END_MS)
      );
    } else {
      this.state.round += 1;
      this.pendingTimeouts.push(
        this.clock.setTimeout(() => this.beginRoundSequence(), ROUND_END_TO_NEXT_ROUND_MS)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Gameplay relays + validation
  // ---------------------------------------------------------------------------

  private relayInput(client: Client, msg: unknown): void {
    const player = this.playerFor(client);
    if (!player) return;
    if (!this.allowRate(player.slot, 'input', 45)) return;

    const opponent = this.opponentClient(player.slot);
    if (!opponent) return;

    // The server stamps the sender's slot - a client can never speak for its opponent.
    opponent.send('input', { ...(msg as object), playerId: player.slot });
  }

  private relayState(client: Client, msg: Record<string, unknown>): void {
    const player = this.playerFor(client);
    if (!player || !msg) return;
    if (!this.allowRate(player.slot, 'state', 20)) return;

    const rt = this.runtime.get(player.slot);
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (rt && Number.isFinite(x) && Number.isFinite(y)) {
      rt.x = Math.max(0, Math.min(ARENA_WIDTH, x));
      rt.y = Math.max(0, Math.min(ARENA_HEIGHT, y));
    }

    const opponent = this.opponentClient(player.slot);
    if (!opponent) return;
    opponent.send('state', { ...msg, playerId: player.slot });
  }

  /**
   * A hit resolved by the attacker's simulation. The server validates it,
   * applies it to the authoritative HP, and decides KO / round end.
   */
  private handleHit(client: Client, msg: Record<string, unknown>): void {
    const player = this.playerFor(client);
    if (!player || !msg) return;

    if (this.state.phase !== 'FIGHTING' || !this.roundActive) return;

    const attackerSlot = player.slot;
    const defenderSlot = otherSlot(attackerSlot);
    const defender = this.state.players.get(defenderSlot);
    const attackerRt = this.runtime.get(attackerSlot);
    const defenderRt = this.runtime.get(defenderSlot);
    if (!defender || !attackerRt) return;

    const now = Date.now();
    if (now - attackerRt.lastHitAt < MIN_MS_BETWEEN_HITS) {
      console.log(`[HIT REJECTED] room=${this.state.roomCode} ${attackerSlot} rate-limited`);
      return;
    }

    const attackType = String(msg.attackType ?? 'PUNCH');
    const cap = DAMAGE_CAP[attackType] ?? DAMAGE_CAP.PUNCH;
    const damage = Math.max(0, Math.min(cap, Number(msg.damage) || 0));

    if (defenderRt && Math.abs(attackerRt.x - defenderRt.x) > MAX_HIT_RANGE_PX) {
      console.log(
        `[HIT REJECTED] room=${this.state.roomCode} ${attackerSlot} out of range (${Math.round(
          Math.abs(attackerRt.x - defenderRt.x)
        )}px)`
      );
      return;
    }

    attackerRt.lastHitAt = now;
    defender.hp = Math.max(0, defender.hp - damage);
    const isKO = defender.hp <= 0;

    console.log(
      `[HIT] room=${this.state.roomCode} ${attackerSlot} ${attackType} dmg=${damage} -> ${defenderSlot} hp=${defender.hp}${isKO ? ' KO' : ''}`
    );

    const opponent = this.opponentClient(attackerSlot);
    opponent?.send('hit', {
      ...msg,
      playerId: attackerSlot,
      target: defenderSlot,
      damage,
      targetHpAfter: defender.hp,
      isKO
    });

    // Authoritative HP echo for the attacker too, so screens can't drift.
    client.send('hpSync', { slot: defenderSlot, hp: defender.hp });

    if (isKO) this.endRound(attackerSlot);
  }

  // ---------------------------------------------------------------------------
  // Rematch
  // ---------------------------------------------------------------------------

  private handleRematch(client: Client): void {
    if (this.state.phase !== 'MATCH_END') return;
    const player = this.playerFor(client);
    if (!player) return;

    player.rematch = true;
    const opponent = this.opponentClient(player.slot);
    opponent?.send('match', { kind: 'REMATCH_REQUEST' });

    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    if (p1?.rematch && p2?.rematch) {
      console.log(`[REMATCH] room=${this.state.roomCode}`);
      p1.rematch = false;
      p2.rematch = false;
      p1.wins = 0;
      p2.wins = 0;
      this.state.round = 1;
      this.state.phase = 'STARTING';
      this.resetRoundRuntime();

      this.broadcast('match', { kind: 'REMATCH_START' });

      this.pendingTimeouts.push(
        this.clock.setTimeout(() => {
          if (this.state.phase === 'STARTING') this.beginRoundSequence();
        }, FIGHT_READY_TIMEOUT_MS)
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Re-sync one client (late scene load, reconnect, missed packet). */
  private sendRoundState(client: Client): void {
    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    client.send('match', {
      kind: 'ROUND_STATE',
      phase: this.state.phase,
      round: this.state.round,
      secondsLeft: this.state.timerSeconds,
      p1Wins: p1?.wins ?? 0,
      p2Wins: p2?.wins ?? 0,
      p1Character: p1?.character,
      p2Character: p2?.character,
      p1Hp: p1?.hp ?? 0,
      p2Hp: p2?.hp ?? 0,
      roundActive: this.roundActive
    });
  }

  private finishByAbandon(winnerSlot: PlayerSlot): void {
    this.clearTimers();
    this.roundActive = false;
    this.roundSequenceRunning = false;
    this.state.phase = 'MATCH_END';
    this.state.pausedForDisconnect = false;

    const p1 = this.state.players.get('p1');
    const p2 = this.state.players.get('p2');
    console.log(`[MATCH END - OPPONENT LEFT] room=${this.state.roomCode} winner=${winnerSlot}`);
    this.broadcast('match', {
      kind: 'MATCH_END',
      matchWinner: winnerSlot === 'p1' ? 1 : 2,
      reason: 'OPPONENT_LEFT',
      p1Wins: p1?.wins ?? 0,
      p2Wins: p2?.wins ?? 0,
      round: this.state.round
    });
  }

  private removePlayer(client: Client, slot: PlayerSlot): void {
    this.slotBySession.delete(client.sessionId);
    this.state.players.delete(slot);
    this.runtime.delete(slot);
    this.refreshPauseFlag();
    if (this.state.players.size < 2 && (this.state.phase === 'LOBBY' || this.state.phase === 'WAITING_FOR_PLAYER')) {
      this.state.phase = 'WAITING_FOR_PLAYER';
      this.unlock();
    }
  }

  private refreshPauseFlag(): void {
    let anyDisconnected = false;
    this.state.players.forEach((p) => {
      if (!p.connected) anyDisconnected = true;
    });
    this.state.pausedForDisconnect = anyDisconnected;
  }

  private resetRoundRuntime(): void {
    this.roundSequenceRunning = false;
    for (const rt of this.runtime.values()) {
      rt.fightReady = false;
      rt.lastHitAt = 0;
    }
  }

  private playerFor(client: Client): PlayerState | null {
    const slot = this.slotBySession.get(client.sessionId);
    if (!slot) return null;
    return this.state.players.get(slot) ?? null;
  }

  private opponentClient(slot: PlayerSlot): Client | null {
    const opponent = this.state.players.get(otherSlot(slot));
    if (!opponent) return null;
    return this.clients.find((c) => c.sessionId === opponent.sessionId) ?? null;
  }

  /** Cheap sliding-window rate limiter per player and message kind. */
  private allowRate(slot: PlayerSlot, kind: 'input' | 'state', maxPerSecond: number): boolean {
    const rt = this.runtime.get(slot);
    if (!rt) return false;
    const now = Date.now();
    if (now - rt.windowStart >= 1000) {
      rt.windowStart = now;
      rt.inputCount = 0;
      rt.stateCount = 0;
    }
    if (kind === 'input') {
      if (rt.inputCount >= maxPerSecond) return false;
      rt.inputCount++;
    } else {
      if (rt.stateCount >= maxPerSecond) return false;
      rt.stateCount++;
    }
    return true;
  }

  private clearTimers(): void {
    this.timerHandle?.clear();
    this.timerHandle = null;
    for (const t of this.pendingTimeouts) t.clear();
    this.pendingTimeouts = [];
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
  }
}

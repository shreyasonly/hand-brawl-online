import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured, supabaseConfigError } from './SupabaseClient';
import { Emitter } from './Emitter';
import {
  CharacterId,
  HitMessage,
  InputMessage,
  LobbyMessage,
  MatchMessage,
  MatchPhase,
  NetEvent,
  PlayerSlot,
  PlayerState,
  PresenceMeta,
  RoomState,
  StateMessage,
  channelNameFor,
  otherSlot
} from './Protocol';

export type ConnectionStatus =
  | 'OFFLINE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

export interface RoomSnapshot {
  roomCode: string;
  members: PresenceMeta[];
  p1: PresenceMeta | null;
  p2: PresenceMeta | null;
  opponentPresent: boolean;
}

export interface RoomEvents extends Record<string, unknown> {
  /** This client's slot was assigned (or re-assigned) by the realtime room. */
  slot: PlayerSlot;
  /** Presence changed: someone joined, left, readied up or picked a fighter. */
  presence: RoomSnapshot;
  /** Complete room state changed (presence or broadcast). */
  roomState: RoomState;
  lobby: LobbyMessage;
  input: InputMessage;
  state: StateMessage;
  hit: HitMessage;
  match: MatchMessage;
  connection: ConnectionStatus;
  error: string;
}

export type JoinResult =
  | { ok: true; roomCode: string; slot: PlayerSlot }
  | { ok: false; error: string };

/** Unambiguous alphabet - no O/0/I/1 so a room code can be read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const PRESENCE_SETTLE_MS = 900;
const JOIN_LOOKUP_TIMEOUT_MS = 5000;

function randomCode(): string {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function randomClientId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Owns the Supabase Realtime channel for one room.
 *
 * Architecture inspired by Colyseus & Phaser Multiplayer:
 * ROOM -> SHARED ROOM STATE -> PLAYER STATE -> PHASER SCENE RENDERING
 *
 * Slot assignment:
 *   - CREATE LOBBY  -> Assigns PLAYER 1 (p1).
 *   - JOIN LOBBY    -> Assigns PLAYER 2 (p2).
 * Slots are STICKY and NEVER re-derived or overwritten.
 */
export class RoomSession {
  private static instance: RoomSession;

  public readonly events = new Emitter<RoomEvents>();
  public readonly clientId = randomClientId();

  public roomCode: string | null = null;
  public slot: PlayerSlot | null = null;
  public status: ConnectionStatus = 'OFFLINE';
  public lastSnapshot: RoomSnapshot | null = null;

  public roomState: RoomState = {
    roomId: '',
    players: { p1: null, p2: null },
    matchState: 'WAITING'
  };

  private channel: RealtimeChannel | null = null;
  private joinedAt = 0;
  private meta: PresenceMeta;
  private hasSubscribedOnce = false;
  /** Serialized form of the last successfully tracked meta (change detection). */
  private lastTrackedMeta = '';
  /** True once the player actively picked a fighter, so we stop defaulting. */
  private characterPickedByPlayer = false;

  private constructor() {
    this.meta = {
      clientId: this.clientId,
      joinedAt: 0,
      slot: null,
      character: 'JACK',
      ready: false,
      cameraEnabled: false,
      faceDetected: false,
      handDetected: false
    };

    window.addEventListener('beforeunload', () => {
      void this.leave();
    });
  }

  public static getInstance(): RoomSession {
    if (!RoomSession.instance) RoomSession.instance = new RoomSession();
    return RoomSession.instance;
  }

  public get isOnline(): boolean {
    return this.channel !== null && this.slot !== null;
  }

  public get opponentSlot(): PlayerSlot | null {
    return this.slot ? otherSlot(this.slot) : null;
  }

  public get opponentMeta(): PresenceMeta | null {
    if (!this.lastSnapshot || !this.slot) return null;
    return this.slot === 'p1' ? this.lastSnapshot.p2 : this.lastSnapshot.p1;
  }

  public get localMeta(): PresenceMeta {
    return this.meta;
  }

  public getRoomState(): RoomState {
    return this.roomState;
  }

  public isBothReady(): boolean {
    const p1 = this.roomState.players.p1;
    const p2 = this.roomState.players.p2;
    return !!(p1 && p1.ready && p2 && p2.ready);
  }

  public setMatchState(state: MatchPhase): void {
    this.roomState.matchState = state;
    this.events.emit('roomState', this.roomState);
  }

  // -------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------

  public async createRoom(): Promise<JoinResult> {
    const guard = this.assertConfigured();
    if (guard) return guard;

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode();
      const subscribed = await this.openChannel(code);
      if (!subscribed) {
        await this.leave();
        return { ok: false, error: 'COULD NOT REACH SUPABASE REALTIME' };
      }

      await this.wait(PRESENCE_SETTLE_MS);
      const others = this.readMembers().filter((m) => m.clientId !== this.clientId);

      if (others.length === 0) {
        this.roomCode = code;
        this.roomState.roomId = code;
        this.assignSlot('p1');
        await this.trackPresence();
        this.publishSnapshot();
        return { ok: true, roomCode: code, slot: 'p1' };
      }

      // Code collision - roll again
      await this.leave();
    }

    return { ok: false, error: 'COULD NOT ALLOCATE A FREE ROOM CODE' };
  }

  public async joinRoom(rawCode: string): Promise<JoinResult> {
    const guard = this.assertConfigured();
    if (guard) return guard;

    const code = (rawCode || '').trim().toUpperCase();
    if (code.length !== CODE_LENGTH) {
      return { ok: false, error: `ROOM CODE MUST BE ${CODE_LENGTH} CHARACTERS` };
    }

    const subscribed = await this.openChannel(code);
    if (!subscribed) {
      await this.leave();
      return { ok: false, error: 'COULD NOT REACH SUPABASE REALTIME' };
    }

    const deadline = Date.now() + JOIN_LOOKUP_TIMEOUT_MS;
    let others: PresenceMeta[] = [];

    while (Date.now() < deadline) {
      await this.wait(250);
      others = this.readMembers().filter((m) => m.clientId !== this.clientId);
      if (others.length > 0) break;
    }

    if (others.length === 0) {
      await this.leave();
      return { ok: false, error: `ROOM ${code} NOT FOUND` };
    }

    if (others.length >= 2) {
      await this.leave();
      return { ok: false, error: `ROOM ${code} IS FULL` };
    }

    this.roomCode = code;
    this.roomState.roomId = code;
    this.assignSlot('p2');
    await this.trackPresence();
    this.publishSnapshot();
    return { ok: true, roomCode: code, slot: 'p2' };
  }

  public async leave(): Promise<void> {
    const supabase = getSupabase();
    if (this.channel && supabase) {
      try {
        await supabase.removeChannel(this.channel);
      } catch {
        /* channel already gone */
      }
    }
    this.channel = null;
    this.slot = null;
    this.roomCode = null;
    this.lastSnapshot = null;
    this.hasSubscribedOnce = false;
    this.meta = { ...this.meta, slot: null, ready: false };
    this.characterPickedByPlayer = false;
    this.lastTrackedMeta = '';
    this.roomState = {
      roomId: '',
      players: { p1: null, p2: null },
      matchState: 'WAITING'
    };
    this.setStatus('OFFLINE');
  }

  // -------------------------------------------------------------------------
  // Lobby state
  // -------------------------------------------------------------------------

  public async setCharacter(character: CharacterId): Promise<void> {
    this.characterPickedByPlayer = true;
    this.meta.character = character;
    if (this.slot && this.roomState.players[this.slot]) {
      this.roomState.players[this.slot]!.character = character;
    }
    await this.syncLobbyState();
    this.events.emit('roomState', this.roomState);
  }

  public async setReady(ready: boolean): Promise<void> {
    this.meta.ready = ready;
    if (this.slot) {
      if (!this.roomState.players[this.slot]) {
        this.assignSlot(this.slot);
      }
      this.roomState.players[this.slot]!.ready = ready;
      if (this.isBothReady()) {
        this.roomState.matchState = 'BOTH_READY';
      } else {
        this.roomState.matchState = ready ? 'READY' : 'CHARACTER_SELECT';
      }
    }
    await this.syncLobbyState();
    this.events.emit('roomState', this.roomState);
  }

  public async setVisionStatus(status: {
    cameraEnabled: boolean;
    faceDetected: boolean;
    handDetected: boolean;
  }): Promise<void> {
    const changed =
      this.meta.cameraEnabled !== status.cameraEnabled ||
      this.meta.faceDetected !== status.faceDetected ||
      this.meta.handDetected !== status.handDetected;

    this.meta.cameraEnabled = status.cameraEnabled;
    this.meta.faceDetected = status.faceDetected;
    this.meta.handDetected = status.handDetected;

    if (this.slot && this.roomState.players[this.slot]) {
      this.roomState.players[this.slot]!.cameraEnabled = status.cameraEnabled;
      this.roomState.players[this.slot]!.faceDetected = status.faceDetected;
      this.roomState.players[this.slot]!.handDetected = status.handDetected;
    }

    if (changed) {
      await this.syncLobbyState();
    }
  }

  public async announceLobbyState(): Promise<void> {
    await this.syncLobbyState();
  }

  private async syncLobbyState(): Promise<void> {
    if (!this.channel || !this.slot || this.status !== 'CONNECTED') return;

    const serialized = JSON.stringify(this.meta);
    if (serialized !== this.lastTrackedMeta) {
      this.lastTrackedMeta = serialized;
      await this.trackPresence();
    }

    const msg: LobbyMessage = {
      type: 'LOBBY',
      playerId: this.slot,
      timestamp: Date.now(),
      character: this.meta.character,
      ready: this.meta.ready,
      faceDetected: this.meta.faceDetected,
      handDetected: this.meta.handDetected,
      cameraEnabled: this.meta.cameraEnabled
    };
    this.send(NetEvent.LOBBY, msg);
  }

  // -------------------------------------------------------------------------
  // Gameplay messaging
  // -------------------------------------------------------------------------

  public sendInput(msg: InputMessage): void {
    this.send(NetEvent.INPUT, msg);
  }

  public sendState(msg: StateMessage): void {
    this.send(NetEvent.STATE, msg);
  }

  public sendHit(msg: HitMessage): void {
    this.send(NetEvent.HIT, msg);
  }

  public sendMatch(msg: MatchMessage): void {
    this.send(NetEvent.MATCH, msg);
  }

  private send(event: string, payload: unknown): void {
    if (!this.channel || this.status !== 'CONNECTED') return;
    void this.channel.send({ type: 'broadcast', event, payload });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertConfigured(): JoinResult | null {
    if (!isSupabaseConfigured() || !getSupabase()) {
      return { ok: false, error: supabaseConfigError() ?? 'SUPABASE UNAVAILABLE' };
    }
    return null;
  }

  private async openChannel(roomCode: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase) return false;

    if (this.channel) {
      try {
        await supabase.removeChannel(this.channel);
      } catch {
        /* ignore */
      }
      this.channel = null;
    }

    this.setStatus('CONNECTING');
    this.joinedAt = Date.now();
    this.meta = { ...this.meta, joinedAt: this.joinedAt, slot: null, ready: false };
    this.hasSubscribedOnce = false;
    this.lastTrackedMeta = '';

    const channel = supabase.channel(channelNameFor(roomCode), {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.clientId }
      }
    });

    channel.on('presence', { event: 'sync' }, () => this.onPresenceSync());
    channel.on('presence', { event: 'join' }, () => this.onPresenceSync());
    channel.on('presence', { event: 'leave' }, () => this.onPresenceSync());

    channel.on('broadcast', { event: NetEvent.INPUT }, ({ payload }) =>
      this.forwardIfOpponent(payload as InputMessage, 'input')
    );
    channel.on('broadcast', { event: NetEvent.STATE }, ({ payload }) =>
      this.forwardIfOpponent(payload as StateMessage, 'state')
    );
    channel.on('broadcast', { event: NetEvent.HIT }, ({ payload }) =>
      this.forwardIfOpponent(payload as HitMessage, 'hit')
    );
    channel.on('broadcast', { event: NetEvent.LOBBY }, ({ payload }) => {
      const msg = payload as LobbyMessage;
      if (!msg || !msg.playerId) return;
      if (this.slot && msg.playerId === this.slot) return;

      // Update room state from the fast-path broadcast
      const existing = this.roomState.players[msg.playerId];
      this.roomState.players[msg.playerId] = {
        slot: msg.playerId,
        clientId: existing?.clientId ?? 'remote',
        connected: true,
        character: msg.character,
        ready: msg.ready,
        cameraEnabled: msg.cameraEnabled,
        faceDetected: msg.faceDetected,
        handDetected: msg.handDetected
      };

      if (this.isBothReady()) {
        this.roomState.matchState = 'BOTH_READY';
      }

      this.events.emit('lobby', msg);
      this.events.emit('roomState', this.roomState);
    });
    channel.on('broadcast', { event: NetEvent.MATCH }, ({ payload }) => {
      const msg = payload as MatchMessage;
      if (!msg) return;
      if (this.slot && msg.playerId === this.slot) return;

      if (msg.kind === 'START_MATCH') {
        if (msg.p1Character && this.roomState.players.p1) this.roomState.players.p1.character = msg.p1Character;
        if (msg.p2Character && this.roomState.players.p2) this.roomState.players.p2.character = msg.p2Character;
        this.roomState.matchState = 'COUNTDOWN';
      }

      this.events.emit('match', msg);
      this.events.emit('roomState', this.roomState);
    });

    this.channel = channel;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (this.hasSubscribedOnce) {
            this.lastTrackedMeta = JSON.stringify(this.meta);
            void this.trackPresence();
          }
          this.hasSubscribedOnce = true;
          this.setStatus('CONNECTED');
          finish(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.setStatus(this.hasSubscribedOnce ? 'RECONNECTING' : 'ERROR');
          this.events.emit('error', `REALTIME ${status}`);
          finish(false);
        } else if (status === 'CLOSED') {
          this.setStatus(this.hasSubscribedOnce ? 'RECONNECTING' : 'OFFLINE');
        }
      });

      window.setTimeout(() => finish(false), 10000);
    });
  }

  private forwardIfOpponent<K extends 'input' | 'state' | 'hit' | 'lobby' | 'match'>(
    payload: { playerId?: PlayerSlot } | null,
    event: K
  ): void {
    if (!payload || !payload.playerId) return;
    if (this.slot && payload.playerId === this.slot) {
      return;
    }
    this.events.emit(event, payload as RoomEvents[K]);
  }

  private readMembers(): PresenceMeta[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<PresenceMeta>();
    const members: PresenceMeta[] = [];

    for (const key of Object.keys(state)) {
      const entries = state[key];
      if (!entries || entries.length === 0) continue;
      const entry = entries[entries.length - 1];
      if (!entry || typeof entry.clientId !== 'string') continue;
      members.push({
        clientId: entry.clientId,
        joinedAt: entry.joinedAt ?? 0,
        slot: entry.slot ?? null,
        character: entry.character ?? 'JACK',
        ready: !!entry.ready,
        cameraEnabled: !!entry.cameraEnabled,
        faceDetected: !!entry.faceDetected,
        handDetected: !!entry.handDetected
      });
    }

    return members;
  }

  private onPresenceSync(): void {
    if (!this.channel) return;
    this.publishSnapshot(this.readMembers());
  }

  private publishSnapshot(preloaded?: PresenceMeta[]): void {
    const members = preloaded ?? this.readMembers();
    const otherMembers = members.filter((m) => m.clientId !== this.clientId);
    const opponentMeta = otherMembers[0] ?? null;

    // Slot-based assignment:
    // Local player is always this.slot
    // Opponent is always otherSlot(this.slot)
    let p1Meta: PresenceMeta | null = null;
    let p2Meta: PresenceMeta | null = null;

    if (this.slot === 'p1') {
      p1Meta = { ...this.meta, slot: 'p1' };
      p2Meta = opponentMeta ? { ...opponentMeta, slot: 'p2' } : null;
    } else if (this.slot === 'p2') {
      p2Meta = { ...this.meta, slot: 'p2' };
      p1Meta = opponentMeta ? { ...opponentMeta, slot: 'p1' } : null;
    }

    const withSlots: PresenceMeta[] = [];
    if (p1Meta) withSlots.push(p1Meta);
    if (p2Meta) withSlots.push(p2Meta);

    const snapshot: RoomSnapshot = {
      roomCode: this.roomCode ?? '',
      members: withSlots,
      p1: p1Meta,
      p2: p2Meta,
      opponentPresent: otherMembers.length > 0
    };

    // Synchronize into RoomState
    if (this.slot === 'p1') {
      this.roomState.players.p1 = {
        slot: 'p1',
        clientId: this.clientId,
        connected: true,
        character: this.meta.character,
        ready: this.meta.ready,
        cameraEnabled: this.meta.cameraEnabled,
        faceDetected: this.meta.faceDetected,
        handDetected: this.meta.handDetected
      };
      if (p2Meta) {
        const existingP2 = this.roomState.players.p2;
        this.roomState.players.p2 = {
          slot: 'p2',
          clientId: p2Meta.clientId,
          connected: true,
          character: p2Meta.character ?? existingP2?.character ?? 'KIRA',
          ready: p2Meta.ready ?? existingP2?.ready ?? false,
          cameraEnabled: p2Meta.cameraEnabled ?? existingP2?.cameraEnabled ?? false,
          faceDetected: p2Meta.faceDetected ?? existingP2?.faceDetected ?? false,
          handDetected: p2Meta.handDetected ?? existingP2?.handDetected ?? false
        };
      }
    } else if (this.slot === 'p2') {
      this.roomState.players.p2 = {
        slot: 'p2',
        clientId: this.clientId,
        connected: true,
        character: this.meta.character,
        ready: this.meta.ready,
        cameraEnabled: this.meta.cameraEnabled,
        faceDetected: this.meta.faceDetected,
        handDetected: this.meta.handDetected
      };
      if (p1Meta) {
        const existingP1 = this.roomState.players.p1;
        this.roomState.players.p1 = {
          slot: 'p1',
          clientId: p1Meta.clientId,
          connected: true,
          character: p1Meta.character ?? existingP1?.character ?? 'JACK',
          ready: p1Meta.ready ?? existingP1?.ready ?? false,
          cameraEnabled: p1Meta.cameraEnabled ?? existingP1?.cameraEnabled ?? false,
          faceDetected: p1Meta.faceDetected ?? existingP1?.faceDetected ?? false,
          handDetected: p1Meta.handDetected ?? existingP1?.handDetected ?? false
        };
      }
    }

    if (this.isBothReady()) {
      this.roomState.matchState = 'BOTH_READY';
    }

    this.lastSnapshot = snapshot;
    this.events.emit('presence', snapshot);
    this.events.emit('roomState', this.roomState);
  }

  private assignSlot(slot: PlayerSlot): void {
    this.slot = slot;
    this.meta.slot = slot;
    if (!this.characterPickedByPlayer) {
      this.meta.character = slot === 'p1' ? 'JACK' : 'KIRA';
    }

    const existing = this.roomState.players[slot];
    this.roomState.players[slot] = {
      slot,
      clientId: this.clientId,
      connected: true,
      character: this.meta.character,
      ready: existing?.ready ?? false,
      cameraEnabled: this.meta.cameraEnabled,
      faceDetected: this.meta.faceDetected,
      handDetected: this.meta.handDetected
    };

    this.events.emit('slot', slot);
    this.events.emit('roomState', this.roomState);
  }

  private async trackPresence(): Promise<void> {
    if (!this.channel) return;
    try {
      await this.channel.track({ ...this.meta });
    } catch (err) {
      console.warn('presence track failed', err);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.emit('connection', status);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}

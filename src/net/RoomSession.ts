import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured, supabaseConfigError } from './SupabaseClient';
import { Emitter } from './Emitter';
import {
  CharacterId,
  HitMessage,
  InputMessage,
  LobbyMessage,
  MatchMessage,
  NetEvent,
  PlayerSlot,
  PresenceMeta,
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
 * Slot assignment rule (a CLIENT NEVER PICKS ITS OWN SLOT):
 *   - CREATE LOBBY  -> we subscribe to a fresh channel and only continue when
 *                      presence shows the room is empty. We are therefore the
 *                      first player, so the room assigns us PLAYER 1.
 *   - JOIN LOBBY    -> we subscribe and only continue when presence shows
 *                      exactly one existing member. We are therefore the second
 *                      player, so the room assigns us PLAYER 2.
 *                      0 members -> ROOM NOT FOUND, 2+ members -> ROOM FULL.
 *   - Afterwards every client re-derives slots from the same shared presence
 *     state (ordered by joinedAt, tie-broken by clientId), so both browsers
 *     always agree on who is P1 and who is P2.
 */
export class RoomSession {
  private static instance: RoomSession;

  public readonly events = new Emitter<RoomEvents>();
  public readonly clientId = randomClientId();

  public roomCode: string | null = null;
  public slot: PlayerSlot | null = null;
  public status: ConnectionStatus = 'OFFLINE';
  public lastSnapshot: RoomSnapshot | null = null;

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
        this.assignSlot('p1');
        this.roomCode = code;
        await this.trackPresence();
        this.publishSnapshot();
        return { ok: true, roomCode: code, slot: 'p1' };
      }

      // Astronomically unlikely code collision - drop it and roll again.
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

    this.assignSlot('p2');
    this.roomCode = code;
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
    this.setStatus('OFFLINE');
  }

  // -------------------------------------------------------------------------
  // Lobby state (presence is the source of truth, broadcast is the fast path)
  // -------------------------------------------------------------------------

  public async setCharacter(character: CharacterId): Promise<void> {
    this.characterPickedByPlayer = true;
    this.meta.character = character;
    await this.syncLobbyState();
  }

  public async setReady(ready: boolean): Promise<void> {
    this.meta.ready = ready;
    await this.syncLobbyState();
  }

  public async setVisionStatus(status: {
    cameraEnabled: boolean;
    faceDetected: boolean;
    handDetected: boolean;
  }): Promise<void> {
    this.meta.cameraEnabled = status.cameraEnabled;
    this.meta.faceDetected = status.faceDetected;
    this.meta.handDetected = status.handDetected;
    // Deliberately re-announced even when nothing changed: this doubles as the
    // keepalive that repairs the opponent's view after a lost presence diff or
    // a channel reconnect. Without it, state that missed its one delivery
    // window stayed wrong forever.
    await this.syncLobbyState();
  }

  /**
   * Re-publish this client's lobby state (presence + LOBBY broadcast).
   * Called on a slow timer while waiting in the lobby, so a single dropped
   * realtime packet can never deadlock the ready handshake.
   */
  public async announceLobbyState(): Promise<void> {
    await this.syncLobbyState();
  }

  private async syncLobbyState(): Promise<void> {
    if (!this.channel || !this.slot) return;

    // Presence writes are expensive (fanned out to every subscriber and rate
    // limited server-side) - only track when the meta actually changed.
    // The LOBBY broadcast below is cheap and is sent EVERY time; it is the
    // 1s keepalive that heals lost packets on the other side.
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
    if (!this.channel) return;
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
    channel.on('broadcast', { event: NetEvent.LOBBY }, ({ payload }) =>
      this.forwardIfOpponent(payload as LobbyMessage, 'lobby')
    );
    channel.on('broadcast', { event: NetEvent.MATCH }, ({ payload }) =>
      this.forwardIfOpponent(payload as MatchMessage, 'match')
    );

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
            // We dropped and came back - the server forgot our presence entry,
            // so bypass the change-cache and re-track unconditionally.
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
    // broadcast self:false means everything we receive is from the other
    // client. If it carries OUR slot, the two clients somehow claimed the same
    // slot - drop it (applying it would drive the wrong fighter) and shout.
    if (this.slot && payload.playerId === this.slot) {
      console.error('SLOT CONFLICT: opponent message arrived with our own slot', this.slot, payload);
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

    members.sort((a, b) => a.joinedAt - b.joinedAt || a.clientId.localeCompare(b.clientId));
    return members;
  }

  private onPresenceSync(): void {
    if (!this.channel) return;
    // Slots are STICKY: assigned exactly once when the room is created/joined
    // (first player = p1, second = p2) and never re-derived. Presence flaps -
    // a briefly missing entry after a lost diff or a reconnect - must not move
    // a player into the other slot, or both clients end up filtering each
    // other's messages as their own.
    this.publishSnapshot(this.readMembers());
  }

  private publishSnapshot(preloaded?: PresenceMeta[]): void {
    const members = preloaded ?? this.readMembers();
    const withSlots: PresenceMeta[] = members.map((m, idx) => ({
      ...m,
      slot: m.slot ?? (idx === 0 ? 'p1' : idx === 1 ? 'p2' : null)
    }));

    const snapshot: RoomSnapshot = {
      roomCode: this.roomCode ?? '',
      members: withSlots,
      p1: withSlots.find((m) => m.slot === 'p1') ?? null,
      p2: withSlots.find((m) => m.slot === 'p2') ?? null,
      opponentPresent: withSlots.some((m) => m.clientId !== this.clientId)
    };

    this.lastSnapshot = snapshot;
    this.events.emit('presence', snapshot);
  }

  private assignSlot(slot: PlayerSlot): void {
    this.slot = slot;
    this.meta.slot = slot;
    // Sensible default so the lobby opens on JACK vs KIRA rather than a mirror
    // match. The player can still pick either fighter.
    if (!this.characterPickedByPlayer) {
      this.meta.character = slot === 'p1' ? 'JACK' : 'KIRA';
    }
    this.events.emit('slot', slot);
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


import { Client, Room } from '@colyseus/sdk';
import { Emitter } from './Emitter';
import {
  CharacterId,
  HitMessage,
  InputMessage,
  LobbyMessage,
  MatchMessage,
  MatchPhase,
  PlayerSlot,
  PresenceMeta,
  RoomState,
  StateMessage,
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

export interface HpSyncMessage {
  slot: PlayerSlot;
  hp: number;
}

export interface RoomEvents extends Record<string, unknown> {
  /** This client's slot was assigned by the SERVER. */
  slot: PlayerSlot;
  /** Someone joined, left, readied up, picked a fighter or dis/reconnected. */
  presence: RoomSnapshot;
  /** Complete room state changed. */
  roomState: RoomState;
  lobby: LobbyMessage;
  input: InputMessage;
  state: StateMessage;
  hit: HitMessage;
  match: MatchMessage;
  /** Authoritative HP echo for a hit this client landed. */
  hpSync: HpSyncMessage;
  connection: ConnectionStatus;
  error: string;
}

export type JoinResult =
  | { ok: true; roomCode: string; slot: PlayerSlot }
  | { ok: false; error: string };

/** Unambiguous alphabet - no O/0/I/1 so a room code can be read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const ROOM_NAME = 'hand_brawl';

/** How long this client keeps retrying its own dropped socket. */
const RECONNECT_WINDOW_MS = 18000;
const RECONNECT_RETRY_MS = 2000;

function randomCode(): string {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** ws(s):// endpoint of the Colyseus game server. */
export function gameServerEndpoint(): string {
  const raw =
    (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.trim() ||
    (import.meta.env.DEV ? `ws://${window.location.hostname}:2567` : '');
  if (!raw) return '';
  return raw.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/+$/, '');
}

export function isGameServerConfigured(): boolean {
  return gameServerEndpoint() !== '';
}

export function gameServerConfigError(): string | null {
  return isGameServerConfigured() ? null : 'GAME SERVER NOT CONFIGURED (VITE_GAME_SERVER_URL)';
}

/** Maps the server's phase names onto the client's MatchPhase. */
function mapPhase(serverPhase: string): MatchPhase {
  switch (serverPhase) {
    case 'WAITING_FOR_PLAYER': return 'WAITING';
    case 'LOBBY': return 'CHARACTER_SELECT';
    case 'STARTING': return 'BOTH_READY';
    case 'COUNTDOWN': return 'COUNTDOWN';
    case 'FIGHTING': return 'FIGHTING';
    case 'ROUND_END': return 'ROUND_END';
    case 'MATCH_END': return 'MATCH_END';
    default: return 'WAITING';
  }
}

/** Shape of one player inside the server's schema state. */
interface ServerPlayer {
  sessionId: string;
  slot: PlayerSlot;
  character: CharacterId;
  ready: boolean;
  connected: boolean;
  cameraEnabled: boolean;
  faceDetected: boolean;
  handDetected: boolean;
  hp: number;
  wins: number;
  rematch: boolean;
}

interface ServerState {
  roomCode: string;
  phase: string;
  round: number;
  timerSeconds: number;
  pausedForDisconnect: boolean;
  players: { get(slot: string): ServerPlayer | undefined };
}

/**
 * The client's connection to the authoritative Colyseus GameRoom.
 *
 * Deliberately keeps the exact public surface of the old Supabase RoomSession
 * so the Phaser scenes did not have to be rewritten. The difference is where
 * the truth lives: slots, ready state, the countdown, the round clock, health,
 * the score and connectivity all come from the SERVER, not from presence
 * guesswork.
 */
export class GameServerSession {
  private static instance: GameServerSession;

  public readonly events = new Emitter<RoomEvents>();

  public roomCode: string | null = null;
  public slot: PlayerSlot | null = null;
  public status: ConnectionStatus = 'OFFLINE';
  public lastSnapshot: RoomSnapshot | null = null;

  public roomState: RoomState = {
    roomId: '',
    players: { p1: null, p2: null },
    matchState: 'WAITING'
  };

  private client: Client | null = null;
  private room: Room | null = null;
  private reconnectionToken: string | null = null;
  /** Set while leave() runs so onLeave doesn't try to reconnect. */
  private intentionalLeave = false;

  private meta: PresenceMeta;
  private characterPickedByPlayer = false;
  private lastSentVision = '';
  /** Last lobby-relevant fields we saw for the opponent (change detection). */
  private lastOpponentLobby = '';

  private constructor() {
    this.meta = {
      clientId: '',
      joinedAt: 0,
      slot: null,
      character: 'JACK',
      ready: false,
      cameraEnabled: false,
      faceDetected: false,
      handDetected: false
    };

    window.addEventListener('beforeunload', () => {
      // Consented leave: the opponent finds out immediately instead of
      // waiting out the reconnect grace window.
      if (this.room) void this.room.leave(true);
    });
  }

  public static getInstance(): GameServerSession {
    if (!GameServerSession.instance) GameServerSession.instance = new GameServerSession();
    return GameServerSession.instance;
  }

  public get clientId(): string {
    return this.room?.sessionId ?? this.meta.clientId;
  }

  public get isOnline(): boolean {
    return this.room !== null && this.slot !== null;
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

  /** SERVER truth: is the opponent's websocket connected right now? */
  public get opponentConnected(): boolean {
    const opp = this.opponentSlot ? this.roomState.players[this.opponentSlot] : null;
    return !!opp && opp.connected;
  }

  public getRoomState(): RoomState {
    return this.roomState;
  }

  public isBothReady(): boolean {
    const p1 = this.roomState.players.p1;
    const p2 = this.roomState.players.p2;
    return !!(p1 && p1.ready && p2 && p2.ready);
  }

  /** Local mirror only - the server owns the real phase. */
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
    await this.leave();

    const code = randomCode();
    this.setStatus('CONNECTING');

    try {
      const client = this.ensureClient();
      const room = await client.create(ROOM_NAME, { roomCode: code });
      console.log('[ROOM CREATED]', code, 'session', room.sessionId);
      return await this.finishJoin(room);
    } catch (err) {
      this.setStatus('ERROR');
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[ROOM CREATE FAILED]', detail);
      return { ok: false, error: 'COULD NOT REACH THE GAME SERVER' };
    }
  }

  public async joinRoom(rawCode: string): Promise<JoinResult> {
    const guard = this.assertConfigured();
    if (guard) return guard;
    await this.leave();

    const code = (rawCode || '').trim().toUpperCase();
    if (code.length !== CODE_LENGTH) {
      return { ok: false, error: `ROOM CODE MUST BE ${CODE_LENGTH} CHARACTERS` };
    }

    this.setStatus('CONNECTING');

    try {
      const client = this.ensureClient();
      const room = await client.join(ROOM_NAME, { roomCode: code });
      console.log('[ROOM JOINED]', code, 'session', room.sessionId);
      return await this.finishJoin(room);
    } catch (err) {
      this.setStatus('ERROR');
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[ROOM JOIN FAILED]', detail);
      if (/no rooms found|not found|locked|full/i.test(detail)) {
        return { ok: false, error: `ROOM ${code} NOT FOUND (OR ALREADY FULL)` };
      }
      return { ok: false, error: 'COULD NOT REACH THE GAME SERVER' };
    }
  }

  /** Wires the room and waits for the server to assign our slot. */
  private finishJoin(room: Room): Promise<JoinResult> {
    this.attachRoom(room);

    return new Promise<JoinResult>((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        void this.leave();
        resolve({ ok: false, error: 'GAME SERVER DID NOT ASSIGN A PLAYER SLOT' });
      }, 8000);

      const off = this.events.on('slot', (slot) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        off();
        resolve({ ok: true, roomCode: this.roomCode ?? '', slot });
      });
    });
  }

  private attachRoom(room: Room): void {
    this.room = room;
    this.reconnectionToken = room.reconnectionToken;
    this.meta.clientId = room.sessionId;
    this.meta.joinedAt = Date.now();

    room.onMessage('slot', (msg: { slot: PlayerSlot; roomCode: string }) => {
      console.log('[PLAYER ASSIGNED]', msg.slot, 'room', msg.roomCode);
      this.roomCode = msg.roomCode;
      this.roomState.roomId = msg.roomCode;
      this.slot = msg.slot;
      this.meta.slot = msg.slot;
      if (!this.characterPickedByPlayer) {
        this.meta.character = msg.slot === 'p1' ? 'JACK' : 'KIRA';
      }
      this.events.emit('slot', msg.slot);
    });

    room.onMessage('input', (msg: InputMessage) => this.events.emit('input', msg));
    room.onMessage('state', (msg: StateMessage) => this.events.emit('state', msg));
    room.onMessage('hit', (msg: HitMessage) => this.events.emit('hit', msg));
    room.onMessage('hpSync', (msg: HpSyncMessage) => this.events.emit('hpSync', msg));
    room.onMessage('match', (msg: Partial<MatchMessage>) => {
      const full: MatchMessage = {
        type: 'MATCH',
        playerId: this.opponentSlot ?? 'p1',
        timestamp: Date.now(),
        kind: msg.kind ?? 'ROUND_STATE',
        ...msg
      };
      this.events.emit('match', full);
    });

    room.onStateChange((state: unknown) => this.syncFromServerState(state as ServerState));

    room.onError((code, message) => {
      console.error('[ROOM ERROR]', code, message);
      this.events.emit('error', `SERVER ERROR ${code ?? ''}`);
    });

    room.onLeave((code) => {
      console.log('[ROOM LEFT]', 'code', code, 'intentional', this.intentionalLeave);
      if (this.intentionalLeave) return;
      // Unexpected drop: the server holds our slot - try to get back in.
      void this.attemptReconnect();
    });

    this.setStatus('CONNECTED');
  }

  public async leave(): Promise<void> {
    this.intentionalLeave = true;
    const room = this.room;
    this.room = null;
    this.reconnectionToken = null;

    if (room) {
      try {
        await room.leave(true);
      } catch {
        /* socket already gone */
      }
    }

    this.slot = null;
    this.roomCode = null;
    this.lastSnapshot = null;
    this.lastOpponentLobby = '';
    this.lastSentVision = '';
    this.meta = { ...this.meta, slot: null, ready: false };
    this.characterPickedByPlayer = false;
    this.roomState = {
      roomId: '',
      players: { p1: null, p2: null },
      matchState: 'WAITING'
    };
    this.setStatus('OFFLINE');
    this.intentionalLeave = false;
  }

  /**
   * Our own socket dropped (wifi blip, laptop slept...). The server keeps our
   * slot for its grace window - keep retrying until we are back or it expires.
   */
  private async attemptReconnect(): Promise<void> {
    const token = this.reconnectionToken;
    if (!token || !this.client) {
      this.setStatus('OFFLINE');
      return;
    }

    this.setStatus('RECONNECTING');
    const deadline = Date.now() + RECONNECT_WINDOW_MS;

    while (Date.now() < deadline) {
      try {
        console.log('[RECONNECT ATTEMPT]');
        const room = await this.client.reconnect(token);
        console.log('[PLAYER RECONNECTED]', 'session', room.sessionId);
        this.attachRoom(room);
        return;
      } catch (err) {
        console.warn('[RECONNECT FAILED]', err instanceof Error ? err.message : err);
        await new Promise((r) => window.setTimeout(r, RECONNECT_RETRY_MS));
      }
    }

    console.error('[RECONNECT WINDOW EXPIRED]');
    this.setStatus('ERROR');
    this.events.emit('error', 'CONNECTION TO THE GAME SERVER WAS LOST');
  }

  // -------------------------------------------------------------------------
  // Lobby state
  // -------------------------------------------------------------------------

  public async setCharacter(character: CharacterId): Promise<void> {
    this.characterPickedByPlayer = true;
    this.meta.character = character;
    this.send('lobby', { character });
  }

  public async setReady(ready: boolean): Promise<void> {
    this.meta.ready = ready;
    this.send('lobby', { ready, character: this.meta.character });
  }

  public async setVisionStatus(status: {
    cameraEnabled: boolean;
    faceDetected: boolean;
    handDetected: boolean;
  }): Promise<void> {
    this.meta.cameraEnabled = status.cameraEnabled;
    this.meta.faceDetected = status.faceDetected;
    this.meta.handDetected = status.handDetected;

    // Only ship changes - the server state is the keepalive now.
    const serialized = `${status.cameraEnabled}|${status.faceDetected}|${status.handDetected}`;
    if (serialized === this.lastSentVision) return;
    this.lastSentVision = serialized;
    this.send('lobby', { ...status });
  }

  public async announceLobbyState(): Promise<void> {
    this.send('lobby', {
      character: this.meta.character,
      ready: this.meta.ready,
      cameraEnabled: this.meta.cameraEnabled,
      faceDetected: this.meta.faceDetected,
      handDetected: this.meta.handDetected
    });
  }

  // -------------------------------------------------------------------------
  // Gameplay messaging
  // -------------------------------------------------------------------------

  public sendInput(msg: InputMessage): void {
    this.send('input', msg);
  }

  public sendState(msg: StateMessage): void {
    this.send('state', msg);
  }

  public sendHit(msg: HitMessage): void {
    this.send('hit', msg);
  }

  /** FightScene reports its scene is loaded and ready for the countdown. */
  public sendFightReady(): void {
    this.send('fightReady', {});
  }

  public sendRematch(): void {
    this.send('rematch', {});
  }

  /**
   * Legacy MatchMessage entry point. Only the kinds a CLIENT may legitimately
   * emit are forwarded - everything else is server-owned now.
   */
  public sendMatch(msg: MatchMessage): void {
    switch (msg.kind) {
      case 'NEED_STATE':
        this.send('needState', {});
        break;
      case 'REMATCH_REQUEST':
        this.send('rematch', {});
        break;
      default:
        // START_MATCH / ROUND_START / TIMER / ... are decided by the server.
        break;
    }
  }

  private send(type: string, payload: unknown): void {
    if (!this.room || this.status !== 'CONNECTED') return;
    try {
      this.room.send(type, payload);
    } catch (err) {
      console.warn('[SEND FAILED]', type, err);
    }
  }

  // -------------------------------------------------------------------------
  // Server state -> client events
  // -------------------------------------------------------------------------

  private syncFromServerState(state: ServerState): void {
    if (!state || !state.players) return;

    if (state.roomCode) {
      this.roomCode = state.roomCode;
      this.roomState.roomId = state.roomCode;
    }

    const toMeta = (p: ServerPlayer | undefined): PresenceMeta | null =>
      p
        ? {
            clientId: p.sessionId,
            joinedAt: 0,
            slot: p.slot,
            character: p.character,
            ready: p.ready,
            cameraEnabled: p.cameraEnabled,
            faceDetected: p.faceDetected,
            handDetected: p.handDetected
          }
        : null;

    const sp1 = state.players.get('p1');
    const sp2 = state.players.get('p2');

    this.roomState.players.p1 = sp1
      ? {
          slot: 'p1',
          clientId: sp1.sessionId,
          connected: sp1.connected,
          character: sp1.character,
          ready: sp1.ready,
          cameraEnabled: sp1.cameraEnabled,
          faceDetected: sp1.faceDetected,
          handDetected: sp1.handDetected
        }
      : null;
    this.roomState.players.p2 = sp2
      ? {
          slot: 'p2',
          clientId: sp2.sessionId,
          connected: sp2.connected,
          character: sp2.character,
          ready: sp2.ready,
          cameraEnabled: sp2.cameraEnabled,
          faceDetected: sp2.faceDetected,
          handDetected: sp2.handDetected
        }
      : null;
    this.roomState.matchState = mapPhase(state.phase);

    const p1Meta = toMeta(sp1);
    const p2Meta = toMeta(sp2);
    const oppServer = this.slot === 'p1' ? sp2 : sp1;
    const opponentPresent = !!oppServer && oppServer.connected;

    const members: PresenceMeta[] = [];
    if (p1Meta) members.push(p1Meta);
    if (p2Meta) members.push(p2Meta);

    this.lastSnapshot = {
      roomCode: this.roomCode ?? '',
      members,
      p1: p1Meta,
      p2: p2Meta,
      opponentPresent
    };

    // Fire a LOBBY event when the opponent's select-screen state changes, so
    // the scenes tracking picks/readiness refresh instantly.
    if (oppServer) {
      const key = `${oppServer.character}|${oppServer.ready}|${oppServer.cameraEnabled}|${oppServer.faceDetected}|${oppServer.handDetected}`;
      if (key !== this.lastOpponentLobby) {
        this.lastOpponentLobby = key;
        this.events.emit('lobby', {
          type: 'LOBBY',
          playerId: oppServer.slot,
          timestamp: Date.now(),
          character: oppServer.character,
          ready: oppServer.ready,
          faceDetected: oppServer.faceDetected,
          handDetected: oppServer.handDetected,
          cameraEnabled: oppServer.cameraEnabled
        });
      }
    }

    this.events.emit('presence', this.lastSnapshot);
    this.events.emit('roomState', this.roomState);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureClient(): Client {
    if (!this.client) {
      this.client = new Client(gameServerEndpoint());
    }
    return this.client;
  }

  private assertConfigured(): JoinResult | null {
    if (!isGameServerConfigured()) {
      return { ok: false, error: gameServerConfigError() ?? 'GAME SERVER UNAVAILABLE' };
    }
    return null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.emit('connection', status);
  }
}

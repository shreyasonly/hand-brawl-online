/**
 * Wire protocol for HAND BRAWL online play.
 *
 * ONLY gameplay intent travels over the wire. No webcam frames, no hand images,
 * no face data, no landmarks - every bit of computer vision stays inside the
 * browser that owns the camera.
 */
import { Action } from '../gestures/GestureConfig';

export type PlayerSlot = 'p1' | 'p2';
export type CharacterId = 'JACK' | 'KIRA';

/** One Supabase Realtime channel per room. */
export const CHANNEL_PREFIX = 'hand-brawl-room-';
export const channelNameFor = (roomCode: string): string => `${CHANNEL_PREFIX}${roomCode}`;

export const NetEvent = {
  INPUT: 'INPUT',
  STATE: 'STATE',
  HIT: 'HIT',
  LOBBY: 'LOBBY',
  MATCH: 'MATCH'
} as const;
export type NetEventName = (typeof NetEvent)[keyof typeof NetEvent];

/**
 * Continuous "held" inputs plus one-shot action events.
 *
 * Held state is re-sent on every change (and on a slow keepalive) so the remote
 * fighter walks smoothly instead of stuttering one frame per packet.
 */
export interface InputMessage {
  type: 'INPUT';
  playerId: PlayerSlot;
  seq: number;
  timestamp: number;
  hold: {
    left: boolean;
    right: boolean;
    block: boolean;
  };
  /** Edge-triggered actions: PUNCH, KICK, JUMP, GRAB, SPECIAL, ULTIMATE. */
  events: Action[];
}

/** Position/health snapshot. Each client is authoritative for its OWN fighter. */
export interface StateMessage {
  type: 'STATE';
  playerId: PlayerSlot;
  timestamp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingLeft: boolean;
  hp: number;
  special: number;
  ultimate: number;
}

/** A hit landed by `playerId` on `target`. The attacker's client is authoritative. */
export interface HitMessage {
  type: 'HIT';
  playerId: PlayerSlot;
  target: PlayerSlot;
  timestamp: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  /** Attacker's view of the defender's HP after the hit - used to re-sync. */
  targetHpAfter: number;
  isKO: boolean;
  attackType: 'PUNCH' | 'KICK' | 'SPECIAL' | 'GRAB' | 'ULTIMATE';
}

/** Lobby / character-select / vision-status chatter. */
export interface LobbyMessage {
  type: 'LOBBY';
  playerId: PlayerSlot;
  timestamp: number;
  character: CharacterId;
  ready: boolean;
  faceDetected: boolean;
  handDetected: boolean;
  cameraEnabled: boolean;
}

/**
 * Match-flow events.
 *
 * ONLINE   : the Colyseus GAME SERVER is the only authority and emits these.
 * PRACTICE : the local simulation emits them for itself.
 */
export type MatchMessageKind =
  | 'START_MATCH'
  | 'ROUND_START'
  /** Server-paced 3 / 2 / 1 / FIGHT tick. */
  | 'COUNTDOWN'
  | 'TIMER'
  | 'ROUND_END'
  | 'MATCH_END'
  | 'REMATCH_REQUEST'
  | 'REMATCH_ACCEPT'
  /** Server confirms both players want a rematch - restart the fight. */
  | 'REMATCH_START'
  /** Full snapshot for a client that reconnected or missed a packet. */
  | 'ROUND_STATE'
  /** Client asking the server to re-send the current round state. */
  | 'NEED_STATE';

export interface MatchMessage {
  type: 'MATCH';
  playerId: PlayerSlot;
  timestamp: number;
  kind: MatchMessageKind;
  round?: number;
  secondsLeft?: number;
  roundWinner?: 1 | 2;
  matchWinner?: 1 | 2;
  p1Character?: CharacterId;
  p2Character?: CharacterId;
  p1Wins?: number;
  p2Wins?: number;
  /** COUNTDOWN payload: '3' | '2' | '1' | 'FIGHT'. */
  value?: string;
  /** MATCH_END: 'OPPONENT_LEFT' when the other player abandoned the match. */
  reason?: string;
  /** ROUND_STATE extras. */
  phase?: string;
  p1Hp?: number;
  p2Hp?: number;
  roundActive?: boolean;
  byTimeout?: boolean;
}

export type NetMessage =
  | InputMessage
  | StateMessage
  | HitMessage
  | LobbyMessage
  | MatchMessage;

/** What every client publishes through Supabase Presence. */
export interface PresenceMeta {
  clientId: string;
  joinedAt: number;
  slot: PlayerSlot | null;
  character: CharacterId;
  ready: boolean;
  cameraEnabled: boolean;
  faceDetected: boolean;
  handDetected: boolean;
}

export type MatchPhase =
  | 'WAITING'
  | 'CHARACTER_SELECT'
  | 'READY'
  | 'BOTH_READY'
  | 'COUNTDOWN'
  | 'FIGHTING'
  | 'ROUND_END'
  | 'MATCH_END';

export interface PlayerState {
  slot: PlayerSlot;
  clientId: string;
  connected: boolean;
  character: CharacterId;
  ready: boolean;
  cameraEnabled: boolean;
  faceDetected: boolean;
  handDetected: boolean;
}

export interface RoomState {
  roomId: string;
  players: {
    p1: PlayerState | null;
    p2: PlayerState | null;
  };
  matchState: MatchPhase;
}

export const otherSlot = (slot: PlayerSlot): PlayerSlot => (slot === 'p1' ? 'p2' : 'p1');
export const slotToIndex = (slot: PlayerSlot): 1 | 2 => (slot === 'p1' ? 1 : 2);
export const indexToSlot = (index: 1 | 2): PlayerSlot => (index === 1 ? 'p1' : 'p2');


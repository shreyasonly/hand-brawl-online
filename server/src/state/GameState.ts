import { Schema, MapSchema, type } from '@colyseus/schema';

export type PlayerSlot = 'p1' | 'p2';
export type CharacterId = 'JACK' | 'KIRA';

/**
 * Server-side match phases. The server is the ONLY writer of `phase`; clients
 * observe it (plus the broadcast "match" messages) and render accordingly.
 */
export type MatchPhase =
  | 'WAITING_FOR_PLAYER'
  | 'LOBBY'
  | 'STARTING'
  | 'COUNTDOWN'
  | 'FIGHTING'
  | 'ROUND_END'
  | 'MATCH_END';

export const MAX_HP: Record<CharacterId, number> = {
  JACK: 100,
  KIRA: 90
};

export class PlayerState extends Schema {
  @type('string') sessionId = '';
  @type('string') slot: PlayerSlot = 'p1';
  @type('string') character: CharacterId = 'JACK';
  @type('boolean') ready = false;
  @type('boolean') connected = true;
  @type('boolean') cameraEnabled = false;
  @type('boolean') faceDetected = false;
  @type('boolean') handDetected = false;
  @type('number') hp = 100;
  @type('number') wins = 0;
  @type('boolean') rematch = false;
}

export class GameState extends Schema {
  @type('string') roomCode = '';
  @type('string') phase: MatchPhase = 'WAITING_FOR_PLAYER';
  @type('number') round = 1;
  @type('number') timerSeconds = 60;
  /** True while the round clock is frozen because someone dropped. */
  @type('boolean') pausedForDisconnect = false;
  /** Keyed by slot: 'p1' | 'p2'. */
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

import http from 'http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const port = Number(process.env.PORT ?? 2567);

const app = express();

// Health endpoint - lets hosting providers (and humans) verify the process.
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'hand-brawl-server', time: new Date().toISOString() });
});
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

// One room type. Rooms are matched by their 6-character code, so
// join('hand_brawl', { roomCode }) lands in the creator's room.
gameServer.define('hand_brawl', GameRoom).filterBy(['roomCode']);

gameServer.listen(port).then(() => {
  console.log(`[SERVER] hand-brawl Colyseus server listening on :${port}`);
});

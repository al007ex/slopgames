// HTTP + socket entry point. Serves the client, the shared modules and Three.js
// straight out of node_modules, so there is no build step anywhere in this project.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomRegistry } from './rooms.js';
import { CAMPAIGN } from '../shared/levels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use('/', express.static(path.join(ROOT, 'client')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: registry.rooms.size }));

const registry = new RoomRegistry(io);

io.on('connection', (socket) => {
  const withPlayer = (fn) => (...args) => {
    const room = registry.roomOf(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    fn(room, player, ...args);
  };

  socket.on('create', ({ name } = {}, cb) => {
    if (registry.roomOf(socket.id)) return cb?.({ error: 'Already in a room.' });
    const { room, player } = registry.create(socket, name);
    cb?.({ code: room.code, you: player.id, slot: player.slot, lobby: room.lobbyPayload() });
    room.emitLobby();
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    if (registry.roomOf(socket.id)) return cb?.({ error: 'Already in a room.' });
    const res = registry.join(socket, code, name);
    if (res.error) return cb?.({ error: res.error });
    const { room, player } = res;
    cb?.({ code: room.code, you: player.id, slot: player.slot, lobby: room.lobbyPayload() });
    room.emitLobby();
    if (room.phase === 'playing') {
      socket.emit('level', {
        stage: room.stage,
        levelId: room.level.id,
        total: CAMPAIGN.length,
        spawns: [{ id: player.id, pos: player.pos }],
        questText: null,
        rejoin: true,
      });
      room.event({ type: 'toast', text: `${player.name} reconnected.` });
    }
  });

  socket.on('ready', withPlayer((room, player, { ready } = {}) => {
    room.setReady(player.id, ready);
    room.emitLobby();
  }));

  socket.on('start', withPlayer((room) => {
    if (room.start()) room.emitLobby();
  }));

  socket.on('again', withPlayer((room) => {
    if (room.phase !== 'ended') return;
    room.resetToLobby();
  }));

  socket.on('state', withPlayer((room, player, msg) => room.onState(player, msg || {})));
  socket.on('fire', withPlayer((room, player, msg) => room.onFire(player, msg || {})));
  socket.on('melee', withPlayer((room, player, msg) => room.onMelee(player, msg || {})));

  socket.on('task', withPlayer((room, player, msg = {}) => {
    switch (msg.action) {
      case 'flip': return room.onFlip(player, msg.id, msg.pad);
      case 'pickup': return room.onPickup(player, msg.id);
      case 'goal': return room.onGoal(player, msg.id);
      case 'press': return room.onPress(player, msg.id, msg.pad);
      default: return undefined;
    }
  }));

  socket.on('npc', withPlayer((room, player, msg = {}) => {
    if (msg.action === 'hint') room.onHint(player);
  }));

  socket.on('shop', withPlayer((room, player, msg = {}) => {
    if (msg.action === 'buy') room.onBuy(player, msg.item);
    if (msg.action === 'equip') room.onEquip(player, msg.item);
  }));

  socket.on('disconnect', () => {
    const room = registry.leave(socket.id);
    if (room) room.emitLobby();
  });
});

server.listen(PORT, () => {
  console.log(`DUOSTRIKE listening on http://localhost:${PORT}`);
});

// Room registry: short codes, a hard cap of two players, and the shared tick.

import { GameRoom } from './game.js';
import { TICK_MS } from '../shared/constants.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const CODE_LEN = 4;
const EMPTY_ROOM_GRACE_MS = 60_000;

export class RoomRegistry {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // code -> GameRoom
    this.socketRoom = new Map();  // socketId -> code
    this.emptySince = new Map();  // code -> timestamp
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  newCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LEN; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return `R${Date.now().toString(36).toUpperCase().slice(-4)}`;
  }

  create(socket, name) {
    const code = this.newCode();
    const room = new GameRoom(code, this.io);
    this.rooms.set(code, room);
    const player = room.addPlayer(socket, name);
    this.socketRoom.set(socket.id, code);
    return { room, player };
  }

  join(socket, code, name) {
    const room = this.rooms.get((code || '').toUpperCase().trim());
    if (!room) return { error: 'No room with that code.' };
    if (room.phase === 'ended') return { error: 'That run has already finished.' };
    if (room.players.size >= 2) return { error: 'That room is full — it takes exactly two.' };
    const player = room.addPlayer(socket, name);
    if (!player) return { error: 'That room is full — it takes exactly two.' };
    this.socketRoom.set(socket.id, room.code);
    this.emptySince.delete(room.code);

    // a mid-run join fills the empty seat and unpauses
    if (room.phase === 'playing') {
      room.paused = false;
      room.pauseReason = '';
      const lv = room.level;
      player.pos = [...(lv.spawns[player.slot] || lv.spawns[0])];
    }
    return { room, player };
  }

  roomOf(socketId) {
    const code = this.socketRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  leave(socketId) {
    const room = this.roomOf(socketId);
    this.socketRoom.delete(socketId);
    if (!room) return null;
    room.removePlayer(socketId);
    if (room.players.size === 0) {
      this.emptySince.set(room.code, Date.now());
    }
    return room;
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;

    for (const [code, room] of this.rooms) {
      room.tick(dt);
      const since = this.emptySince.get(code);
      if (since && now - since > EMPTY_ROOM_GRACE_MS) {
        this.rooms.delete(code);
        this.emptySince.delete(code);
      }
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

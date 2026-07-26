// Thin socket.io wrapper. All authority lives on the server; this just carries
// intent up and truth down.

import { io } from '/socket.io/socket.io.esm.min.js';

export class Net {
  constructor() {
    this.sock = io({ transports: ['websocket', 'polling'] });
    this.handlers = new Map();
    this.you = null;
    this.code = null;
    this.slot = 0;
    this.online = false;

    for (const k of ['lobby', 'level', 'snap', 'ev', 'gameover']) {
      this.sock.on(k, (data) => this.fire(k, data));
    }
    this.sock.on('connect', () => { this.online = true; this.fire('online'); });
    this.sock.on('disconnect', () => { this.online = false; this.fire('offline'); });
  }

  on(key, fn) {
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(fn);
    return this;
  }

  fire(key, data) {
    const list = this.handlers.get(key);
    if (list) for (const fn of list) fn(data);
  }

  createRoom(name) {
    return new Promise((res) => this.sock.emit('create', { name }, res));
  }

  joinRoom(code, name) {
    return new Promise((res) => this.sock.emit('join', { code, name }, res));
  }

  send(key, data) {
    this.sock.emit(key, data);
  }
}

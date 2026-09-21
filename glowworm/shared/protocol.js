// The wire format. Everything is binary and little-endian: a slither-style game
// sends a lot of bodies a lot of times a second, and JSON would multiply the
// traffic several times over — which matters most on the phones we support.
//
// Body points are the bulk of it. The head goes out as two int16s and every
// other point as an int8 offset from the one before, at COORD_SCALE precision.
// Offsets are taken from the *reconstructed* previous point rather than the
// true one, so rounding error cannot pile up towards the tail.

import { COORD_SCALE, NAME_MAX } from './rules.js';

export const SERVER = {
  WELCOME: 1, SNAPSHOT: 2, FOOD_ADD: 3, FOOD_EAT: 4, SNAKE_INFO: 5,
  DEATH: 6, BOARD: 7, YOU_DIED: 8, PONG: 9,
};
export const CLIENT = { JOIN: 1, INPUT: 2, VIEW: 3, PING: 4 };

export const FLAG_BOOST = 1;
export const LEFT_GAME = 0xffff;   // "killer" id for a player who disconnected

const TAU = Math.PI * 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const quantise = (v) => clamp(Math.round(v * COORD_SCALE), -32768, 32767);

export const angleToByte = (a) => Math.round(((a % TAU + TAU) % TAU) / TAU * 256) & 255;
export const byteToAngle = (b) => (b / 256) * TAU;
export const angleToU16 = (a) => Math.round(((a % TAU + TAU) % TAU) / TAU * 65536) & 0xffff;
export const u16ToAngle = (v) => (v / 65536) * TAU;

class Writer {
  constructor(size = 128) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }
  ensure(extra) {
    if (this.offset + extra <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < this.offset + extra) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; }
  i8(v) { this.ensure(1); this.view.setInt8(this.offset, v); this.offset += 1; }
  u16(v) { this.ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; }
  i16(v) { this.ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; }
  u32(v) { this.ensure(4); this.view.setUint32(this.offset, v >>> 0, true); this.offset += 4; }
  f32(v) { this.ensure(4); this.view.setFloat32(this.offset, v, true); this.offset += 4; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.offset, v, true); this.offset += 8; }
  str(value) {
    // Truncate by characters, never mid-way through a UTF-8 sequence.
    const bytes = encoder.encode([...String(value)].slice(0, NAME_MAX).join(''));
    this.u8(bytes.length);
    this.ensure(bytes.length);
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }
  done() { return new Uint8Array(this.buffer, 0, this.offset).slice(); }
}

class Reader {
  constructor(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  need(n) { if (this.offset + n > this.view.byteLength) throw new RangeError('Truncated message'); }
  u8() { this.need(1); return this.view.getUint8(this.offset++); }
  i8() { this.need(1); return this.view.getInt8(this.offset++); }
  u16() { this.need(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.offset, true); this.offset += 8; return v; }
  str() {
    const length = this.u8();
    this.need(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return decoder.decode(bytes);
  }
}

// ---------------------------------------------------------------- server → client

export function encodeWelcome({ you, arena, simHz, sendEvery, tick }) {
  const w = new Writer(16);
  w.u8(SERVER.WELCOME); w.u16(you); w.u16(arena); w.u8(simHz); w.u8(sendEvery); w.u32(tick);
  return w.done();
}

/**
 * One snake's slice of a snapshot. Every viewer who can see a snake receives
 * the same bytes for it, so the server encodes each snake once per send and
 * splices the blocks into each client's snapshot.
 *
 * `snake`: { id, flags, angle, mass, points } where points is a flat
 * [x0, y0, x1, y1, …] array of world coordinates, head first.
 */
export function encodeSnakeBlock(snake) {
  const count = snake.points.length / 2;
  const w = new Writer(14 + count * 2);
  w.u16(snake.id); w.u8(snake.flags); w.u8(angleToByte(snake.angle));
  w.f32(snake.mass); w.u16(count);
  let qx = quantise(snake.points[0]);
  let qy = quantise(snake.points[1]);
  w.i16(qx); w.i16(qy);
  for (let i = 1; i < count; i++) {
    const dx = clamp(Math.round(snake.points[i * 2] * COORD_SCALE) - qx, -127, 127);
    const dy = clamp(Math.round(snake.points[i * 2 + 1] * COORD_SCALE) - qy, -127, 127);
    w.i8(dx); w.i8(dy);
    qx += dx; qy += dy;
  }
  return w.done();
}

export function assembleSnapshot(tick, cx, cy, blocks) {
  let size = 11;
  for (const block of blocks) size += block.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint8(0, SERVER.SNAPSHOT);
  view.setUint32(1, tick >>> 0, true);
  view.setInt16(5, quantise(cx), true);
  view.setInt16(7, quantise(cy), true);
  view.setUint16(9, blocks.length, true);
  let offset = 11;
  for (const block of blocks) { out.set(block, offset); offset += block.length; }
  return out;
}

export function encodeSnapshot({ tick, cx, cy, snakes }) {
  return assembleSnapshot(tick, cx, cy, snakes.map(encodeSnakeBlock));
}

export function encodeFoodAdd(tick, foods) {
  const w = new Writer(12 + foods.length * 10);
  w.u8(SERVER.FOOD_ADD); w.u32(tick); w.u16(foods.length);
  for (const food of foods) {
    w.u32(food.id); w.i16(quantise(food.x)); w.i16(quantise(food.y));
    w.u8(clamp(Math.round(food.value), 1, 255)); w.u8(food.color);
  }
  return w.done();
}

export function encodeFoodEat(tick, eaten) {
  const w = new Writer(12 + eaten.length * 6);
  w.u8(SERVER.FOOD_EAT); w.u32(tick); w.u16(eaten.length);
  for (const { id, eater } of eaten) { w.u32(id); w.u16(eater); }
  return w.done();
}

export function encodeSnakeInfo(snakes) {
  const w = new Writer(8 + snakes.length * 24);
  w.u8(SERVER.SNAKE_INFO); w.u16(snakes.length);
  for (const snake of snakes) { w.u16(snake.id); w.u8(snake.skin); w.str(snake.name); }
  return w.done();
}

export function encodeDeaths(tick, deaths) {
  const w = new Writer(12 + deaths.length * 8);
  w.u8(SERVER.DEATH); w.u32(tick); w.u16(deaths.length);
  for (const death of deaths) { w.u16(death.victim); w.u16(death.killer); w.u32(Math.floor(death.score)); }
  return w.done();
}

export function encodeBoard({ humans, total, top, rank, score, dots }) {
  const w = new Writer(32 + top.length * 6 + dots.length * 4);
  w.u8(SERVER.BOARD); w.u16(humans); w.u16(total);
  w.u8(top.length);
  for (const row of top) { w.u16(row.id); w.u32(Math.floor(row.score)); }
  w.u16(rank); w.u32(Math.floor(score));
  w.u8(dots.length);
  for (const dot of dots) { w.u8(dot.x); w.u8(dot.y); w.u8(dot.size); w.u8(dot.flags); }
  return w.done();
}

export function encodeYouDied({ tick, killer, score, aliveMs, kills, bestRank }) {
  const w = new Writer(24);
  w.u8(SERVER.YOU_DIED); w.u32(tick); w.u16(killer); w.u32(Math.floor(score));
  w.u32(Math.min(0xffffffff, Math.floor(aliveMs))); w.u16(kills); w.u16(bestRank);
  return w.done();
}

export function encodePong(t) {
  const w = new Writer(9);
  w.u8(SERVER.PONG); w.f64(t);
  return w.done();
}

export function decodeServer(data) {
  const r = new Reader(data);
  const type = r.u8();
  switch (type) {
    case SERVER.WELCOME:
      return { type, you: r.u16(), arena: r.u16(), simHz: r.u8(), sendEvery: r.u8(), tick: r.u32() };
    case SERVER.SNAPSHOT: {
      const tick = r.u32();
      const cx = r.i16() / COORD_SCALE;
      const cy = r.i16() / COORD_SCALE;
      const count = r.u16();
      const snakes = [];
      for (let s = 0; s < count; s++) {
        const id = r.u16();
        const flags = r.u8();
        const angle = byteToAngle(r.u8());
        const mass = r.f32();
        const n = r.u16();
        const points = new Float32Array(n * 2);
        let qx = r.i16();
        let qy = r.i16();
        points[0] = qx / COORD_SCALE; points[1] = qy / COORD_SCALE;
        for (let i = 1; i < n; i++) {
          qx += r.i8(); qy += r.i8();
          points[i * 2] = qx / COORD_SCALE; points[i * 2 + 1] = qy / COORD_SCALE;
        }
        snakes.push({ id, flags, angle, mass, points });
      }
      return { type, tick, cx, cy, snakes };
    }
    case SERVER.FOOD_ADD: {
      const tick = r.u32();
      const count = r.u16();
      const foods = [];
      for (let i = 0; i < count; i++) {
        foods.push({ id: r.u32(), x: r.i16() / COORD_SCALE, y: r.i16() / COORD_SCALE, value: r.u8(), color: r.u8() });
      }
      return { type, tick, foods };
    }
    case SERVER.FOOD_EAT: {
      const tick = r.u32();
      const count = r.u16();
      const eaten = [];
      for (let i = 0; i < count; i++) eaten.push({ id: r.u32(), eater: r.u16() });
      return { type, tick, eaten };
    }
    case SERVER.SNAKE_INFO: {
      const count = r.u16();
      const snakes = [];
      for (let i = 0; i < count; i++) snakes.push({ id: r.u16(), skin: r.u8(), name: r.str() });
      return { type, snakes };
    }
    case SERVER.DEATH: {
      const tick = r.u32();
      const count = r.u16();
      const deaths = [];
      for (let i = 0; i < count; i++) deaths.push({ victim: r.u16(), killer: r.u16(), score: r.u32() });
      return { type, tick, deaths };
    }
    case SERVER.BOARD: {
      const humans = r.u16();
      const total = r.u16();
      const top = [];
      for (let i = 0, n = r.u8(); i < n; i++) top.push({ id: r.u16(), score: r.u32() });
      const rank = r.u16();
      const score = r.u32();
      const dots = [];
      for (let i = 0, n = r.u8(); i < n; i++) dots.push({ x: r.u8(), y: r.u8(), size: r.u8(), flags: r.u8() });
      return { type, humans, total, top, rank, score, dots };
    }
    case SERVER.YOU_DIED:
      return { type, tick: r.u32(), killer: r.u16(), score: r.u32(), aliveMs: r.u32(), kills: r.u16(), bestRank: r.u16() };
    case SERVER.PONG:
      return { type, t: r.f64() };
    default:
      throw new TypeError(`Unknown server message ${type}`);
  }
}

// ---------------------------------------------------------------- client → server

export function encodeJoin(name, skin) {
  const w = new Writer(24);
  w.u8(CLIENT.JOIN); w.u8(skin); w.str(name);
  return w.done();
}

export function encodeInput(angle, boost) {
  const w = new Writer(4);
  w.u8(CLIENT.INPUT); w.u16(angleToU16(angle)); w.u8(boost ? 1 : 0);
  return w.done();
}

export function encodeView(halfWidth, halfHeight) {
  const w = new Writer(5);
  w.u8(CLIENT.VIEW); w.u16(clamp(Math.round(halfWidth), 0, 65535)); w.u16(clamp(Math.round(halfHeight), 0, 65535));
  return w.done();
}

export function encodePing(t) {
  const w = new Writer(9);
  w.u8(CLIENT.PING); w.f64(t);
  return w.done();
}

export function decodeClient(data) {
  const r = new Reader(data);
  const type = r.u8();
  switch (type) {
    case CLIENT.JOIN: return { type, skin: r.u8(), name: r.str() };
    case CLIENT.INPUT: return { type, angle: u16ToAngle(r.u16()), boost: r.u8() === 1 };
    case CLIENT.VIEW: return { type, halfWidth: r.u16(), halfHeight: r.u16() };
    case CLIENT.PING: return { type, t: r.f64() };
    default: throw new TypeError(`Unknown client message ${type}`);
  }
}

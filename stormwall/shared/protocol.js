// The wire format. The hot path — inputs up, snapshots down, 30 times a second
// — is binary; everything rare (lobby, inventory, kill feed, results) is JSON
// in text frames, where readability costs nothing.

export const C_INPUT = 1;
export const C_PING = 2;

export const S_SNAPSHOT = 1;
export const S_PONG = 2;

// Discrete actions ride along with the input of the tick they happened on, so
// the server applies them in the same order the client predicted them.
export const A_SLOT = 1;        // u8 slot (0 = pickaxe)
export const A_BUILD = 2;       // u8 piece type, 255 = leave build mode
export const A_MAT = 3;         // u8 material
export const A_PLACE = 4;       // u8 type, u8 rot, u16 cx, i8 lv, u16 cz
export const A_EDIT = 5;        // u32 piece id, u16 value (tile mask, or ramp selection)
export const A_INTERACT = 6;    // u8 target kind, u32 id
export const A_RELOAD = 7;
export const A_DROP = 8;        // u8 slot
export const A_PING = 9;        // f32 x, y, z
export const A_JUMP = 10;       // leave the blimp
export const A_SWAP = 11;       // u8 a, u8 b
export const A_USE = 12;        // start using the held consumable

export class Writer {
  constructor(size = 1024) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.at = 0;
  }
  ensure(n) {
    if (this.at + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.at + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.at));
    this.buf = next; this.view = new DataView(next); this.bytes = new Uint8Array(next);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.at, v); this.at += 1; return this; }
  i8(v) { this.ensure(1); this.view.setInt8(this.at, v); this.at += 1; return this; }
  u16(v) { this.ensure(2); this.view.setUint16(this.at, v, true); this.at += 2; return this; }
  i16(v) { this.ensure(2); this.view.setInt16(this.at, v, true); this.at += 2; return this; }
  u32(v) { this.ensure(4); this.view.setUint32(this.at, v >>> 0, true); this.at += 4; return this; }
  i32(v) { this.ensure(4); this.view.setInt32(this.at, v | 0, true); this.at += 4; return this; }
  f32(v) { this.ensure(4); this.view.setFloat32(this.at, v, true); this.at += 4; return this; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.at, v, true); this.at += 8; return this; }
  /** Patch a u16 written earlier (counts that are only known afterwards). */
  setU16(offset, v) { this.view.setUint16(offset, v, true); }
  finish() { return this.bytes.slice(0, this.at); }
  reset() { this.at = 0; return this; }
}

export class Reader {
  constructor(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.at = 0;
  }
  get left() { return this.view.byteLength - this.at; }
  u8() { const v = this.view.getUint8(this.at); this.at += 1; return v; }
  i8() { const v = this.view.getInt8(this.at); this.at += 1; return v; }
  u16() { const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  i16() { const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  u32() { const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  i32() { const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  f32() { const v = this.view.getFloat32(this.at, true); this.at += 4; return v; }
  f64() { const v = this.view.getFloat64(this.at, true); this.at += 8; return v; }
}

const TAU = Math.PI * 2;
export const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const packYaw = (yaw) => Math.round(((wrapAngle(yaw) + Math.PI) / TAU) * 65536) & 0xffff;
export const unpackYaw = (v) => (v / 65536) * TAU - Math.PI;
export const packPitch = (p) => Math.max(-32767, Math.min(32767, Math.round((p / (Math.PI / 2)) * 32767)));
export const unpackPitch = (v) => (v / 32767) * (Math.PI / 2);
/** What the server will see: the client predicts with these exact values. */
export const quantizeYaw = (yaw) => unpackYaw(packYaw(yaw));
export const quantizePitch = (p) => unpackPitch(packPitch(p));
export const packAxis = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
export const unpackAxis = (v) => v / 127;

/* ------------------------------------------------------------ input */

export function encodeInput(w, input) {
  w.reset().u8(C_INPUT).u32(input.seq).f32(input.viewTick || 0).u16(input.buttons | 0)
    .i8(packAxis(input.mx || 0)).i8(packAxis(input.mz || 0))
    .u16(packYaw(input.yaw || 0)).i16(packPitch(input.pitch || 0));
  const actions = input.actions || [];
  w.u8(actions.length);
  for (const a of actions) encodeAction(w, a);
  return w.finish();
}

function encodeAction(w, a) {
  w.u8(a.type);
  switch (a.type) {
    case A_SLOT: case A_DROP: w.u8(a.slot); break;
    case A_BUILD: w.u8(a.piece); break;
    case A_MAT: w.u8(a.mat); break;
    case A_PLACE: w.u8(a.piece).u8(a.rot).u16(a.cx).i8(a.lv).u16(a.cz); break;
    case A_EDIT: w.u32(a.id).u16(a.value); break;
    case A_INTERACT: w.u8(a.kind).u32(a.id); break;
    case A_PING: w.f32(a.x).f32(a.y).f32(a.z); break;
    case A_SWAP: w.u8(a.a).u8(a.b); break;
    default: break;          // A_RELOAD, A_JUMP, A_USE carry nothing
  }
}

function decodeAction(r) {
  const type = r.u8();
  switch (type) {
    case A_SLOT: case A_DROP: return { type, slot: r.u8() };
    case A_BUILD: return { type, piece: r.u8() };
    case A_MAT: return { type, mat: r.u8() };
    case A_PLACE: return { type, piece: r.u8(), rot: r.u8(), cx: r.u16(), lv: r.i8(), cz: r.u16() };
    case A_EDIT: return { type, id: r.u32(), value: r.u16() };
    case A_INTERACT: return { type, kind: r.u8(), id: r.u32() };
    case A_PING: return { type, x: r.f32(), y: r.f32(), z: r.f32() };
    case A_SWAP: return { type, a: r.u8(), b: r.u8() };
    case A_RELOAD: case A_JUMP: case A_USE: return { type };
    default: throw new Error(`unknown action ${type}`);
  }
}

/** Decodes any client binary message. Throws on garbage. */
export function decodeClient(data) {
  const r = new Reader(data);
  const type = r.u8();
  if (type === C_INPUT) {
    const input = {
      type, seq: r.u32(), viewTick: r.f32(), buttons: r.u16(),
      mx: unpackAxis(r.i8()), mz: unpackAxis(r.i8()), yaw: unpackYaw(r.u16()), pitch: unpackPitch(r.i16()),
      actions: [],
    };
    const n = r.u8();
    if (n > 16) throw new Error('too many actions');
    for (let i = 0; i < n; i++) input.actions.push(decodeAction(r));
    if (!Number.isFinite(input.viewTick)) input.viewTick = 0;
    return input;
  }
  if (type === C_PING) return { type, t: r.f64() };
  throw new Error(`unknown client message ${type}`);
}

export function encodePing(w, t) { return w.reset().u8(C_PING).f64(t).finish(); }
export function encodePong(w, t) { return w.reset().u8(S_PONG).f64(t).finish(); }

/* --------------------------------------------------------- snapshot */

// A snapshot is a header, the receiver's own authoritative state, the players
// around them, then tagged blocks (structure changes, loot, shots, projectiles…)
// ending with a zero tag, so new kinds of block can be added without breaking old ones.
export const B_END = 0;
export const B_PIECES = 1;
export const B_PROPS = 2;
export const B_ITEMS = 3;
export const B_CHESTS = 4;
export const B_SHOTS = 5;
export const B_PROJECTILES = 6;
export const B_EXPLOSIONS = 7;
export const B_HITS = 8;
export const B_STORM = 9;
export const B_BUS = 10;

export const PF_CROUCH = 1;
export const PF_ADS = 2;
export const PF_BUILD = 4;
export const PF_FIRING = 8;
export const PF_USING = 16;
export const PF_GROUND = 32;
export const PF_TEAM = 64;
export const PF_HARVEST = 128;

export function writeSelf(w, p) {
  const m = p.move;
  w.f32(m.x).f32(m.y).f32(m.z).f32(m.vx).f32(m.vy).f32(m.vz).u8(m.mode)
    .u8((m.ground ? 1 : 0) | (m.crouch ? 2 : 0) | (m.jumpLatch ? 4 : 0) | (m.crouchLatch ? 8 : 0))
    .f32(m.peakY).u8(Math.max(0, Math.min(255, Math.ceil(p.hp)))).u8(Math.max(0, Math.min(255, Math.ceil(p.shield))));
}

export function readSelf(r) {
  const s = { x: r.f32(), y: r.f32(), z: r.f32(), vx: r.f32(), vy: r.f32(), vz: r.f32(), mode: r.u8() };
  const f = r.u8();
  s.ground = f & 1; s.crouch = (f >> 1) & 1; s.jumpLatch = (f >> 2) & 1; s.crouchLatch = (f >> 3) & 1;
  s.peakY = r.f32();
  s.hp = r.u8(); s.shield = r.u8();
  return s;
}

export function writePlayer(w, p, { team = false } = {}) {
  const m = p.move;
  w.u16(p.id).f32(m.x).f32(m.y).f32(m.z).u16(packYaw(p.yaw)).i16(packPitch(p.pitch)).u8(m.mode)
    .u8(p.flags | (team ? PF_TEAM : 0) | (m.ground ? PF_GROUND : 0) | (m.crouch ? PF_CROUCH : 0)).u8(p.heldKind || 0).u8(p.heldRarity || 0);
  if (team) w.u8(Math.ceil(Math.max(0, p.hp))).u8(Math.ceil(Math.max(0, p.shield))).u8(p.dbnoHp ? Math.ceil(p.dbnoHp) : 0);
}

export function readPlayer(r) {
  const p = {
    id: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), yaw: unpackYaw(r.u16()), pitch: unpackPitch(r.i16()),
    mode: r.u8(), flags: r.u8(), held: r.u8(), rarity: r.u8(),
  };
  if (p.flags & PF_TEAM) { p.hp = r.u8(); p.shield = r.u8(); p.dbnoHp = r.u8(); }
  return p;
}

/** Decodes a snapshot's fixed part; `blocks` decoders read the tagged rest. */
export function decodeSnapshot(data, blockReaders = {}) {
  const r = new Reader(data);
  const type = r.u8();
  if (type !== S_SNAPSHOT) return null;
  const snap = { tick: r.u32(), ack: r.u32(), self: null, players: [], blocks: {} };
  if (r.u8()) snap.self = readSelf(r);
  const n = r.u16();
  for (let i = 0; i < n; i++) snap.players.push(readPlayer(r));
  for (;;) {
    const tag = r.u8();
    if (tag === B_END) break;
    const read = blockReaders[tag];
    if (!read) throw new Error(`no reader for block ${tag}`);
    snap.blocks[tag] = read(r);
  }
  return snap;
}

// The wire format: binary, built on typed arrays.
//
// A frame is a run of messages, each a one-byte opcode followed by its fields.
// The server batches everything for a client into one frame per tick. Game
// code works with plain tuples — ['hp', sid, hp, max] — and the schemas below
// turn them into bytes and back, identically on both ends.
//
// Field types:
//   u8 i8 u16 i16 u32 f32   integers / float, little-endian
//   ang                     an angle, as a u16 over a full turn
//   angn                    an angle or null (null is 0xffff)
//   str                     UTF-8, one length byte, at most 255 bytes
//   ['list', count, type]   an array of one scalar type
//   ['flat', count, [t…]]   a flat array of records: [a1, b1, a2, b2, …]

const TAU = Math.PI * 2;
const ANG_STEPS = 65534;   // 0xffff is kept for "no angle"

export const SERVER = {
  welcome: ['u16', 'u16', 'u32'],                            // sid, map size, world seed
  spawned: ['u16', ['list', 'u8', 'u8'], ['list', 'u8', 'u8'], ['list', 'u8', 'u16'], 'u16'], // sid, items, weapons, hats owned, hat worn
  tick: [
    'u32',                                                   // server tick number: the client's clock for smoothing
    // players: sid, x, y, dir, build item (-1 none), weapon, variant, clan id, hat shown, z, clan owner?
    ['flat', 'u8', ['u16', 'u16', 'u16', 'ang', 'i8', 'u8', 'u8', 'u16', 'u16', 'u8', 'u8']],
    // animals: sid, type, x, y, dir, health
    ['flat', 'u8', ['u16', 'u8', 'u16', 'u16', 'ang', 'u16']],
  ],
  objs: [['flat', 'u16', ['u32', 'u16', 'u16', 'ang', 'u8', 'i8', 'i8', 'u16']]], // sid, x, y, dir, scale, resource type, item, owner
  rm: ['u32'],
  wiggle: ['u32', 'ang'],
  hp: ['u16', 'u16', 'u16'],                                 // sid, health, max
  ahp: ['u16', 'u16'],
  txt: ['u16', 'u16', 'i16'],                                // x, y, amount (negative heals)
  swing: ['u16', 'u8', 'u8'],                                // sid, hit something?, weapon
  slam: ['u16'],
  died: [],
  dead: ['u16'],
  kills: ['u16'],
  adead: ['u16'],
  info: ['u16', 'str', 'u8', 'u16', 'u16', 'u8'],            // sid, name, skin, health, max, bot?
  left: ['u16'],
  res: ['u8', 'u32'],                                        // resource type, amount
  xp: ['u32', 'u32', 'u8'],                                  // xp, max xp (0 = same), age (0 = same)
  upg: ['u8', 'u8', ['flat', 'u8', ['u8', 'u8']]],           // points, next upgrade age, choices [kind, id]
  loadout: [['list', 'u8', 'u8'], ['list', 'u8', 'u8']],     // items, weapons
  count: ['u8', 'u8'],                                       // item group, placed
  proj: ['u16', 'u16', 'ang', 'u16', 'u8', 'u8', 'u32'],     // x, y, dir, range, projectile, layer, sid
  prm: ['u32'],                                              // a projectile hit something
  // Your own player, exactly, after the tick that used your input `seq` —
  // the client replays anything newer on top (prediction).
  me: ['u16', 'f32', 'f32', 'f32', 'f32', 'f32', 'u8', 'u8', 'u8'], // seq, x, y, xVel, yVel, slowMult, z, trapped, inputs still queued
  leaders: [['flat', 'u8', ['u16', 'str', 'u32']]],          // sid, name, gold
  mm: [['flat', 'u8', ['u16', 'u16']]],                      // clan mates on the minimap
  chat: ['u16', 'str'],
  ping: ['u16', 'u16'],
  hats: [['list', 'u8', 'u16'], 'u16'],                      // owned, worn
  clans: [['flat', 'u8', ['u16', 'str', 'u16']]],            // id, name, owner sid
  members: ['u16', 'str', 'u8', ['flat', 'u8', ['u16', 'str']]], // clan id (0 none), name, am I the owner?, members
  request: ['u16', 'str'],                                   // sid, name of someone asking to join
  declined: ['str'],
};

export const CLIENT = {
  spawn: ['str', 'u8'],             // name, skin colour
  move: ['angn'],                   // direction, or null to stop (bots and old clients)
  input: ['u16', 'angn'],           // one per tick: sequence number, direction or null
  aim: ['ang'],
  attack: ['u8', 'ang'],            // held?, direction
  auto: [],
  select: ['u8', 'u8'],             // id, is it a weapon?
  upgrade: ['u8', 'u8'],            // kind (0 weapon, 1 item), id
  buy: ['u16'],
  wear: ['u16'],
  chat: ['str'],
  ping: [],
  clanCreate: ['str'],
  clanJoin: ['u16'],
  clanAccept: ['u16'],
  clanDecline: ['u16'],
  clanKick: ['u16'],
  clanLeave: [],
};

const table = (schema) => {
  const names = Object.keys(schema);
  return { schema, names, ops: Object.fromEntries(names.map((n, i) => [n, i + 1])) };
};
export const SERVER_TABLE = table(SERVER);
export const CLIENT_TABLE = table(CLIENT);

const enc = new TextEncoder();
const dec = new TextDecoder();

export class Writer {
  constructor(size = 4096) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.len = 0;
  }

  reset() { this.len = 0; return this; }

  room(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) { this.room(1); this.view.setUint8(this.len, v); this.len += 1; }
  i8(v) { this.room(1); this.view.setInt8(this.len, v); this.len += 1; }
  u16(v) { this.room(2); this.view.setUint16(this.len, v, true); this.len += 2; }
  i16(v) { this.room(2); this.view.setInt16(this.len, v, true); this.len += 2; }
  u32(v) { this.room(4); this.view.setUint32(this.len, v, true); this.len += 4; }
  f32(v) { this.room(4); this.view.setFloat32(this.len, v, true); this.len += 4; }

  ang(a) {
    const turn = ((a % TAU) + TAU) % TAU;
    this.u16(Math.round(turn / TAU * ANG_STEPS) % (ANG_STEPS + 1));
  }

  angn(a) { if (a === null || a === undefined) this.u16(0xffff); else this.ang(a); }

  str(s) {
    let bytes = enc.encode(String(s ?? ''));
    if (bytes.length > 255) bytes = bytes.subarray(0, 255);
    this.u8(bytes.length);
    this.room(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  /** A copy of what has been written — safe to hand to a socket. */
  bytes() { return this.buf.slice(0, this.len); }
}

export class Reader {
  constructor(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.u8arr = u8;
    this.pos = 0;
  }

  get done() { return this.pos >= this.view.byteLength; }
  need(n) { if (this.pos + n > this.view.byteLength) throw new RangeError('short frame'); }

  u8() { this.need(1); return this.view.getUint8(this.pos++); }
  i8() { this.need(1); return this.view.getInt8(this.pos++); }
  u16() { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }

  ang() {
    const q = this.u16();
    if (q > ANG_STEPS) throw new RangeError('bad angle');
    const a = q / ANG_STEPS * TAU;
    return a > Math.PI ? a - TAU : a;
  }

  angn() {
    const q = this.u16();
    if (q === 0xffff) return null;
    const a = q / ANG_STEPS * TAU;
    return a > Math.PI ? a - TAU : a;
  }

  str() {
    const n = this.u8();
    this.need(n);
    const s = dec.decode(this.u8arr.subarray(this.view.byteOffset - this.u8arr.byteOffset + this.pos, this.view.byteOffset - this.u8arr.byteOffset + this.pos + n));
    this.pos += n;
    return s;
  }
}

// Clamp every integer to its type so a stray value never throws or wraps.
const LIMITS = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], u32: [0, 4294967295] };

function writeField(w, type, v) {
  if (typeof type === 'string') {
    const lim = LIMITS[type];
    if (lim) {
      let n = Math.round(Number(v) || 0);
      if (n < lim[0]) n = lim[0]; else if (n > lim[1]) n = lim[1];
      w[type](n);
    } else {
      w[type](v);
    }
    return;
  }
  const [kind, countType, inner] = type;
  const list = Array.isArray(v) ? v : [];
  const max = LIMITS[countType][1];
  if (kind === 'list') {
    const n = Math.min(list.length, max);
    w[countType](n);
    for (let i = 0; i < n; i++) writeField(w, inner, list[i]);
  } else {
    const stride = inner.length;
    const n = Math.min(Math.floor(list.length / stride), max);
    w[countType](n);
    for (let i = 0; i < n * stride; i++) writeField(w, inner[i % stride], list[i]);
  }
}

function readField(r, type) {
  if (typeof type === 'string') return r[type]();
  const [kind, countType, inner] = type;
  const n = r[countType]();
  const out = [];
  if (kind === 'list') for (let i = 0; i < n; i++) out.push(readField(r, inner));
  else for (let i = 0; i < n; i++) for (const t of inner) out.push(readField(r, t));
  return out;
}

/** Append one message tuple ([name, ...fields]) to a Writer. */
export function encodeInto(w, { schema, ops }, msg) {
  const op = ops[msg[0]];
  if (!op) throw new Error(`unknown message ${msg[0]}`);
  w.u8(op);
  const spec = schema[msg[0]];
  for (let i = 0; i < spec.length; i++) writeField(w, spec[i], msg[i + 1]);
}

/** Encode a batch of message tuples into one frame. */
export function encode(tbl, msgs, w = new Writer()) {
  w.reset();
  for (const m of msgs) encodeInto(w, tbl, m);
  return w.bytes();
}

/** Decode a frame into message tuples. Throws on anything malformed. */
export function decode({ schema, names }, data) {
  const r = new Reader(data);
  const out = [];
  while (!r.done) {
    const name = names[r.u8() - 1];
    if (!name) throw new RangeError('bad opcode');
    const msg = [name];
    for (const t of schema[name]) msg.push(readField(r, t));
    out.push(msg);
  }
  return out;
}

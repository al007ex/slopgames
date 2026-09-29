// Smoothness for PvP.
//
// Your own player is predicted: every tick the client runs the same movement
// step as the server (shared/physics.js) on the input it is about to send, so
// moving responds at once. The server echoes back which input it has used and
// exactly where that left you; the client rewinds to that, replays the inputs
// still in flight, and eases any difference out over a few frames.
//
// Everyone else is drawn a little in the past, from a short buffer of
// snapshots timed by the server's tick counter, so they move evenly however
// unevenly packets arrive.

import * as C from '#shared/config.js';
import { WEAPONS } from '#shared/items.js';
import { hatById } from '#shared/hats.js';
import { accelerate, travel, settle, speedMods, bump, hitRadius } from '#shared/physics.js';
import { lerpAngle } from '#shared/util.js';

const T = C.TICK_MS;
const SNAP_DIST = 300;            // corrections bigger than this snap (respawn, teleport)
const EASE_MS = 90;               // corrections halve every this many ms
const RENDER_DELAY = 1.3;         // ticks others are drawn behind the freshest snapshot
const MAX_EXTRAPOLATE = 0.5;      // ticks we will guess ahead when a snapshot is late
const newer = (a, b) => { const d = (a - b) & 0xffff; return d !== 0 && d < 0x8000; };
// Pacing: keep about one input waiting at the server, so it never has to
// guess (a guessed tick is one the client did not predict).
const QUEUE_TARGET = 1;
const PACE_GAIN = 0.04;
const PACE_MIN = 0.94;
const PACE_MAX = 1.08;

export class Predictor {
  constructor(app) {
    this.app = app;
    this.reset(0, 0);
  }

  reset(x, y) {
    this.e = { x, y, xVel: 0, yVel: 0, slowMult: 1, zIndex: 0, lockMove: false, healCol: 0, scale: C.PLAYER_SCALE };
    this.prev = { x, y };
    this.pending = [];
    this.acc = 0;
    this.ox = 0; this.oy = 0;
    this.seq = this.seq || 0;
    this.corrections = 0;
    this.largest = 0;
    this.pace = 1;                  // real ms per tick of input, as a share of a tick
    this.queueAvg = QUEUE_TARGET;
  }

  mods() {
    const me = this.app.me;
    const self = this.app.state.players.get(this.app.state.me);
    const hat = hatById(self?.hat ?? me.hat) || {};
    return {
      spd: speedMods({ building: me.build >= 0, weaponSpd: WEAPONS[me.weapon]?.spdMult || 1, hatSpd: hat.spdMult || 1 }),
      waterImmune: !!hat.waterImmune, currentMult: hat.currentMult,
    };
  }

  /** One tick of movement against the objects we know about, exactly as the server steps it. */
  simulate(dir) {
    const e = this.e;
    const s = this.app.state;
    const friendlyTo = this.app.friendlySids();
    accelerate(e, dir, T, this.mods());
    travel(e, T, (step) => {
      for (const o of s.visibleObjects(e.x - 260, e.y - 260, 520, 520)) {
        bump(e, o, hitRadius(o), step, !!o.owner && friendlyTo.has(o.owner));
      }
      return true;
    });
    settle(e, T);
  }

  /** Advance by real time; every whole (paced) tick, predict and send one input. */
  frame(delta, dir, send) {
    const step = T * this.pace;
    this.acc += delta;
    // After a stall (a hidden tab), do not try to catch up tick by tick.
    if (this.acc > step * 6) this.acc = step;
    while (this.acc >= step) {
      this.acc -= step;
      this.seq = (this.seq + 1) & 0xffff;
      this.prev = { x: this.e.x, y: this.e.y };
      this.simulate(dir);
      this.pending.push({ seq: this.seq, dir });
      if (this.pending.length > 60) this.pending.shift();
      send(this.seq, dir);
    }
    const k = Math.pow(0.5, delta / EASE_MS);
    this.ox *= k; this.oy *= k;
    if (Math.abs(this.ox) < 0.01) this.ox = 0;
    if (Math.abs(this.oy) < 0.01) this.oy = 0;
  }

  /** Where to draw yourself this frame. */
  position() {
    const a = Math.min(1, this.acc / (T * this.pace));
    return { x: this.prev.x + (this.e.x - this.prev.x) * a + this.ox, y: this.prev.y + (this.e.y - this.prev.y) * a + this.oy };
  }

  /** The server's word on where you are after input `seq`: rewind, replay, ease. */
  reconcile(seq, x, y, xVel, yVel, slowMult, z, trapped, queued = QUEUE_TARGET) {
    this.queueAvg = this.queueAvg * 0.9 + queued * 0.1;
    this.pace = Math.min(PACE_MAX, Math.max(PACE_MIN, 1 + (this.queueAvg - QUEUE_TARGET) * PACE_GAIN));
    const before = this.position();
    this.pending = this.pending.filter((p) => newer(p.seq, seq));
    Object.assign(this.e, { x, y, xVel, yVel, slowMult, zIndex: z, lockMove: !!trapped });
    this.prev = { x, y };
    for (const p of this.pending) {
      this.prev = { x: this.e.x, y: this.e.y };
      this.simulate(p.dir);
    }
    const a = Math.min(1, this.acc / (T * this.pace));
    const ax = this.prev.x + (this.e.x - this.prev.x) * a; const ay = this.prev.y + (this.e.y - this.prev.y) * a;
    const dx = before.x - ax; const dy = before.y - ay;
    const err = Math.hypot(dx, dy);
    if (err > SNAP_DIST) { this.ox = 0; this.oy = 0; } else { this.ox = dx; this.oy = dy; }
    if (err > 0.5) this.corrections++;
    this.largest = Math.max(this.largest, err);
  }
}

/** The server's clock, as seen from here: taken from the fastest-arriving snapshots. */
export class Clock {
  constructor() { this.samples = []; this.offset = null; }

  sample(tick, now) {
    this.samples.push(now - tick * T);
    if (this.samples.length > 40) this.samples.shift();
    this.offset = Math.min(...this.samples);
  }

  /** The tick to draw other things at. */
  renderTick(now) { return this.offset === null ? 0 : (now - this.offset) / T - RENDER_DELAY; }
}

/** Remember a snapshot of an entity for buffered interpolation. */
export function remember(e, tick, x, y, dir) {
  if (!e.buf) e.buf = [];
  const last = e.buf[e.buf.length - 1];
  if (last && tick <= last.t) return;
  e.buf.push({ t: tick, x, y, dir });
  if (e.buf.length > 8) e.buf.shift();
}

/** Place an entity at `tick` from its buffer. */
export function place(e, tick) {
  const b = e.buf;
  if (!b?.length) return;
  if (tick <= b[0].t) { e.x = b[0].x; e.y = b[0].y; e.dir = b[0].dir; return; }
  for (let i = b.length - 1; i > 0; i--) {
    const a0 = b[i - 1]; const a1 = b[i];
    if (tick >= a0.t && tick <= a1.t) {
      const k = (tick - a0.t) / (a1.t - a0.t);
      e.x = a0.x + (a1.x - a0.x) * k; e.y = a0.y + (a1.y - a0.y) * k;
      e.dir = lerpAngle(a0.dir, a1.dir, k);
      return;
    }
  }
  // Late: carry on a little along the last known motion, then wait.
  const last = b[b.length - 1]; const before = b[b.length - 2];
  if (!before) { e.x = last.x; e.y = last.y; e.dir = last.dir; return; }
  const k = Math.min(MAX_EXTRAPOLATE, tick - last.t) / (last.t - before.t);
  e.x = last.x + (last.x - before.x) * k; e.y = last.y + (last.y - before.y) * k;
  e.dir = last.dir;
}

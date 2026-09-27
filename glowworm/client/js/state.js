// What the client believes the world looks like, and when.
//
// Snapshots arrive 30 times a second; drawing the newest one would stutter.
// Instead the client renders slightly in the past — INTERP_DELAY behind the
// server — and runs a smooth curve through the snapshots around that moment.
// Straight lines between snapshots were not enough: every snapshot became a
// corner in the head's path, and with the camera locked to the head the whole
// screen jolted at each one, which read as stuttery turning.
//
// Tick-stamped events (food eaten, deaths) wait in a queue until the render
// clock reaches them, so a pellet vanishes when the head that ate it actually
// gets there on screen, not 100 ms early.
//
// Nothing here touches the DOM, which keeps it testable in Node.

import { TICK_MS } from '#shared/rules.js';
import { SERVER, FLAG_BOOST } from '#shared/protocol.js';

// Three snapshots behind: two to blend between, and one beyond them so the
// curve knows where the motion is heading next.
export const INTERP_DELAY = 100;
const OFFSET_WINDOW_MS = 3000;
const SNAPSHOT_KEEP = 40;
export const EAT_ANIM_MS = 160;
export const FADE_MS = 450;
export const POP_IN_MS = 260;

const TAU = Math.PI * 2;
// A clock correction bigger than this is a real discontinuity (a stalled tab,
// a reconnect) and is taken in one step; anything smaller is eased in.
const CLOCK_SNAP_MS = 250;

/**
 * Catmull-Rom through four evenly spaced samples, evaluated between p1 and p2.
 * It passes through every sample and its velocity is continuous at each one —
 * the property straight-line blending lacks.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (p2 - p0) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (3 * p1 - p0 - 3 * p2 + p3) * t3
  );
}

const lerpAngle = (a, b, t) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};

export class GameState {
  constructor() {
    this.you = 0;                 // own snake id while alive
    this.snapshots = [];
    this.info = new Map();        // id -> { name, skin }
    this.food = new Map();        // id -> { x, y, value, color, born, eatenBy, endAt }
    this.leaving = new Set();     // pellets playing their eaten/fade animation
    this.pending = [];            // tick-stamped events waiting for the render clock
    this.offset = null;           // client clock minus server clock, in ms
    this.samples = [];
    this.clock = -Infinity;       // the render clock, in server milliseconds
    this.clockAt = null;          // client time the render clock was last advanced
    this.board = null;
    this.rtt = 0;
    this.buffers = new Map();     // id -> Float32Array reused for blended points
    this.lastCount = new Map();
    this.listeners = { death: [], youDied: [], welcome: [] };
  }

  on(event, fn) { this.listeners[event].push(fn); }
  emit(event, data) { for (const fn of this.listeners[event]) fn(data); }

  /**
   * The render clock: server time, INTERP_DELAY in the past.
   *
   * It runs at real speed and is steered towards where it should be by
   * running up to 8% fast or slow, so a correction to the offset is spread over
   * many frames rather than landing as a jump. Jumps — even small ones — show
   * as the snake hitching forward or pausing. It never runs backwards.
   */
  tickClock(now) {
    if (this.offset === null) return this.clock;
    const target = now - this.offset - INTERP_DELAY;
    if (!Number.isFinite(this.clock) || Math.abs(target - this.clock) > CLOCK_SNAP_MS) {
      this.clock = Math.max(this.clock, target);
      this.clockAt = now;
      return this.clock;
    }
    const elapsed = Math.max(0, now - (this.clockAt ?? now));
    this.clockAt = Math.max(this.clockAt ?? now, now);
    // Drift is measured after a real-speed step, so a clock that is exactly on
    // target runs at exactly real speed.
    const drift = target - (this.clock + elapsed);
    const rate = Math.min(1.08, Math.max(0.92, 1 + drift / 400));
    this.clock += elapsed * rate;
    return this.clock;
  }

  receive(message, now) {
    switch (message.type) {
      case SERVER.WELCOME:
        this.you = message.you;
        this.emit('welcome', message);
        break;
      case SERVER.SNAPSHOT:
        this.addSnapshot(message, now);
        break;
      case SERVER.SNAKE_INFO:
        for (const snake of message.snakes) this.info.set(snake.id, { name: snake.name, skin: snake.skin });
        break;
      case SERVER.FOOD_ADD:
        // The opening sync lands before there is any clock to wait for.
        if (this.offset === null) this.apply(message);
        else this.pending.push(message);
        break;
      case SERVER.FOOD_EAT:
      case SERVER.DEATH:
      case SERVER.YOU_DIED:
        this.pending.push(message);
        break;
      case SERVER.BOARD:
        this.board = message;
        break;
      case SERVER.PONG:
        this.rtt = now - message.t;
        break;
      default:
    }
    this.applyDue(now);
  }

  addSnapshot(message, now) {
    const time = message.tick * TICK_MS;
    // The fastest recent arrival is the best estimate of the true offset: every
    // slower one was just delayed by jitter.
    this.samples.push({ at: now, value: now - time });
    while (this.samples.length && this.samples[0].at < now - OFFSET_WINDOW_MS) this.samples.shift();
    let best = Infinity;
    for (const sample of this.samples) if (sample.value < best) best = sample.value;
    if (this.offset === null || Math.abs(best - this.offset) > 1000) this.offset = best;
    else this.offset += (best - this.offset) * 0.1;

    const snakes = new Map();
    for (const snake of message.snakes) snakes.set(snake.id, snake);
    this.snapshots.push({ tick: message.tick, time, cx: message.cx, cy: message.cy, snakes });
    while (this.snapshots.length > SNAPSHOT_KEEP) this.snapshots.shift();
  }

  applyDue(now) {
    // Half a millisecond of slack: tick times are multiples of 33.3…, and an
    // event exactly on the boundary should not wait a frame for rounding.
    const clock = this.tickClock(now) + 0.5;
    while (this.pending.length && this.pending[0].tick * TICK_MS <= clock) this.apply(this.pending.shift());
    // A tab in the background stops drawing but keeps receiving; never let the
    // queue grow without bound while nobody is looking.
    while (this.pending.length > 600) this.apply(this.pending.shift());
  }

  apply(message) {
    const clock = this.clock;
    switch (message.type) {
      case SERVER.FOOD_ADD:
        for (const food of message.foods) {
          this.food.set(food.id, {
            x: food.x, y: food.y, value: food.value, color: food.color,
            born: Number.isFinite(clock) ? clock : -1e9, eatenBy: 0, endAt: 0,
          });
        }
        break;
      case SERVER.FOOD_EAT:
        for (const { id, eater } of message.eaten) {
          const food = this.food.get(id);
          if (!food || food.endAt) continue;
          food.eatenBy = eater;
          food.endAt = clock + (eater ? EAT_ANIM_MS : FADE_MS);
          food.leftAt = clock;
          this.leaving.add(id);
        }
        break;
      case SERVER.DEATH:
        for (const death of message.deaths) {
          const buffer = this.buffers.get(death.victim);
          const count = this.lastCount.get(death.victim) || 0;
          this.emit('death', {
            ...death,
            victimInfo: this.info.get(death.victim),
            killerInfo: this.info.get(death.killer),
            points: buffer && count ? buffer.slice(0, count * 2) : null,
          });
        }
        break;
      case SERVER.YOU_DIED:
        this.you = 0;
        this.emit('youDied', message);
        break;
      default:
    }
  }

  /** Everything the renderer needs for one frame. */
  frame(now) {
    this.applyDue(now);
    const clock = this.clock;
    for (const id of this.leaving) {
      const food = this.food.get(id);
      if (!food || clock >= food.endAt) { this.food.delete(id); this.leaving.delete(id); }
    }

    const out = { clock, snakes: [], byId: new Map(), camera: null, youSnake: null };
    const snaps = this.snapshots;
    if (!snaps.length) return out;

    // Find the snapshots either side of the clock: a before it, b after it,
    // plus one each side of those for the curve.
    let ia = snaps.length - 1;
    if (clock <= snaps[0].time) ia = 0;
    else {
      for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i].time <= clock && clock < snaps[i + 1].time) { ia = i; break; }
      }
    }
    const a = snaps[ia];
    const b = snaps[Math.min(ia + 1, snaps.length - 1)];
    const before = ia > 0 ? snaps[ia - 1] : null;
    const after = ia + 2 < snaps.length ? snaps[ia + 2] : null;
    const t = a === b ? 0 : Math.min(1, Math.max(0, (clock - a.time) / (b.time - a.time)));
    // Keep one snapshot behind the pair being drawn: the curve needs it.
    while (snaps.length > 3 && snaps[2].time <= clock) snaps.shift();

    const curve = (p0, p1, p2, p3) => (
      a === b ? p1 : catmullRom(p0 ?? 2 * p1 - p2, p1, p2, p3 ?? 2 * p2 - p1, t)
    );
    out.camera = {
      x: curve(before?.cx, a.cx, b.cx, after?.cx),
      y: curve(before?.cy, a.cy, b.cy, after?.cy),
    };

    for (const [id, next] of b.snakes) {
      this.push(out, id, before?.snakes.get(id), a.snakes.get(id), next, after?.snakes.get(id), a === b ? 0 : t);
    }
    // A snake in the older snapshot but not the newer one has just died or left
    // view; keep drawing it until the clock moves past, so it does not blink out
    // before its death plays.
    for (const [id, previous] of a.snakes) if (!b.snakes.has(id)) this.push(out, id, null, null, previous, null, 0);

    out.youSnake = this.you ? out.byId.get(this.you) || null : null;
    if (this.buffers.size > out.snakes.length * 2 + 16) {
      for (const id of this.buffers.keys()) {
        if (!out.byId.has(id)) { this.buffers.delete(id); this.lastCount.delete(id); }
      }
    }
    return out;
  }

  push(out, id, before, from, to, after, t) {
    const count = to.points.length / 2;
    let buffer = this.buffers.get(id);
    if (!buffer || buffer.length < count * 2) {
      buffer = new Float32Array(Math.max(count * 2, 64));
      this.buffers.set(id, buffer);
    }
    if (from && t > 0) {
      // Point i follows point i: the body is a chain, so the same index is the
      // same bit of snake a moment later. Growth adds points at the tail, and a
      // point missing from the outer snapshots is extrapolated in a straight line.
      const shared = Math.min(from.points.length, to.points.length);
      const p0s = before?.points;
      const p3s = after?.points;
      for (let i = 0; i < shared; i++) {
        const p1 = from.points[i];
        const p2 = to.points[i];
        const p0 = p0s && i < p0s.length ? p0s[i] : 2 * p1 - p2;
        const p3 = p3s && i < p3s.length ? p3s[i] : 2 * p2 - p1;
        buffer[i] = catmullRom(p0, p1, p2, p3, t);
      }
      for (let i = shared; i < count * 2; i++) buffer[i] = to.points[i];
    } else {
      // Exactly on a snapshot, or only one to go on: draw it as it is.
      const source = from && from.points.length === to.points.length ? from : to;
      buffer.set(source.points);
    }
    this.lastCount.set(id, count);
    const snake = {
      id,
      points: buffer,
      count,
      angle: from ? lerpAngle(from.angle, to.angle, t) : to.angle,
      mass: from ? from.mass + (to.mass - from.mass) * t : to.mass,
      boosting: Boolean(to.flags & FLAG_BOOST),
      info: this.info.get(id) || { name: '', skin: 0 },
      you: id === this.you,
    };
    out.snakes.push(snake);
    out.byId.set(id, snake);
  }
}

// What the client believes the world looks like, and when.
//
// Snapshots arrive 15 times a second, so drawing the newest one would stutter.
// Instead the client renders slightly in the past — INTERP_DELAY behind the
// server — and blends between the two snapshots either side of that moment.
// Tick-stamped events (food eaten, deaths) wait in a queue until the render
// clock reaches them, so a pellet vanishes when the head that ate it actually
// gets there on screen, not 100 ms early.
//
// Nothing here touches the DOM, which keeps it testable in Node.

import { TICK_MS, SEND_EVERY } from '#shared/rules.js';
import { SERVER, FLAG_BOOST } from '#shared/protocol.js';

export const INTERP_DELAY = TICK_MS * SEND_EVERY * 1.5;
const OFFSET_WINDOW_MS = 3000;
const SNAPSHOT_KEEP = 40;
export const EAT_ANIM_MS = 160;
export const FADE_MS = 450;
export const POP_IN_MS = 260;

const TAU = Math.PI * 2;
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
    this.board = null;
    this.rtt = 0;
    this.buffers = new Map();     // id -> Float32Array reused for blended points
    this.lastCount = new Map();
    this.listeners = { death: [], youDied: [], welcome: [] };
  }

  on(event, fn) { this.listeners[event].push(fn); }
  emit(event, data) { for (const fn of this.listeners[event]) fn(data); }

  /** The render clock: server time, INTERP_DELAY in the past, never running backwards. */
  tickClock(now) {
    if (this.offset === null) return this.clock;
    const target = now - this.offset - INTERP_DELAY;
    if (target > this.clock) this.clock = target;
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

    let a = snaps[0];
    let b = snaps[0];
    if (clock >= snaps[snaps.length - 1].time) {
      a = b = snaps[snaps.length - 1];
    } else if (clock > snaps[0].time) {
      for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i].time <= clock && clock < snaps[i + 1].time) { a = snaps[i]; b = snaps[i + 1]; break; }
      }
    }
    const t = a === b ? 0 : (clock - a.time) / (b.time - a.time);
    while (snaps.length > 2 && snaps[1].time <= clock) snaps.shift();

    out.camera = { x: a.cx + (b.cx - a.cx) * t, y: a.cy + (b.cy - a.cy) * t };

    for (const [id, next] of b.snakes) this.push(out, id, a.snakes.get(id), next, t);
    // A snake in the older snapshot but not the newer one has just died or left
    // view; keep drawing it until the clock moves past, so it does not blink out
    // before its death burst plays.
    for (const [id, previous] of a.snakes) if (!b.snakes.has(id)) this.push(out, id, null, previous, 0);

    out.youSnake = this.you ? out.byId.get(this.you) || null : null;
    if (this.buffers.size > out.snakes.length * 2 + 16) {
      for (const id of this.buffers.keys()) {
        if (!out.byId.has(id)) { this.buffers.delete(id); this.lastCount.delete(id); }
      }
    }
    return out;
  }

  push(out, id, from, to, t) {
    const count = to.points.length / 2;
    let buffer = this.buffers.get(id);
    if (!buffer || buffer.length < count * 2) {
      buffer = new Float32Array(Math.max(count * 2, 64));
      this.buffers.set(id, buffer);
    }
    if (from) {
      // Point i blends with point i: the body is a chain, so the same index is
      // the same bit of snake a moment later. Growth adds points at the tail.
      const shared = Math.min(from.points.length, to.points.length);
      for (let i = 0; i < shared; i++) buffer[i] = from.points[i] + (to.points[i] - from.points[i]) * t;
      for (let i = shared; i < count * 2; i++) buffer[i] = to.points[i];
    } else {
      buffer.set(to.points);
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

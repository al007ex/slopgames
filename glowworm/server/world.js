// The simulation. It owns every snake and pellet, advances them one fixed tick
// at a time and reports what happened as events; it knows nothing about
// sockets, which is what lets the tests drive it directly.

import {
  SIM_HZ, SIM_DT, ARENA_RADIUS, START_MASS, MIN_BOOST_MASS, BASE_SPEED, BOOST_SPEED,
  BOOST_DROP_SECONDS, DEATH_DROP_RATIO, HIT_FORGIVENESS, boostBurn, widthOf, spacingOf,
  segmentsOf, turnRateOf, FOOD_TARGET, FOOD_MAX, FOOD_SPAWN_PER_TICK, FOOD_DECAY_SECONDS,
  EAT_REACH, foodRadius, SNAKE_TARGET, MIN_BOTS, PALETTE, SKINS, BOT_NAMES,
} from '../shared/rules.js';
import { LEFT_GAME } from '../shared/protocol.js';
import { makeRng } from '../shared/rng.js';
import { Grid } from './spatial.js';
import { makeBrain, think } from './bot.js';

const TAU = Math.PI * 2;
const MAX_FOOD_RADIUS = foodRadius(255);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const wrapAngle = (a) => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};

const freshEvents = () => ({ foodAdded: [], foodEaten: [], deaths: [], spawned: [] });

export class World {
  constructor({ seed = 1, bots = true } = {}) {
    this.rng = makeRng(seed);
    this.tick = 0;
    this.snakes = new Map();      // id -> live snake
    this.slots = [];              // live snakes in the order the body grid indexed them
    this.food = new Map();        // id -> pellet
    this.foodGrid = new Grid(128);
    this.bodyGrid = new Grid(96);
    this.dropQueue = [];          // dropped pellets, oldest first, for decay and eviction
    this.naturalFood = 0;
    this.nextFoodId = 1;
    this.nextSnakeId = 1;
    this.useBots = bots;
    this.botsAlive = 0;
    this.humansAlive = 0;         // the server keeps this current
    this.nextBotAt = 0;
    this.events = freshEvents();

    while (this.naturalFood < FOOD_TARGET) this.spawnNaturalFood();
    for (let i = 0; i < this.desiredBots(); i++) this.spawnBot();
    // Clients receive the opening state as a full sync, not as a flood of events.
    this.events = freshEvents();
  }

  takeEvents() {
    const events = this.events;
    this.events = freshEvents();
    return events;
  }

  // ---- population ------------------------------------------------------

  desiredBots() {
    if (!this.useBots) return 0;
    return clamp(SNAKE_TARGET - this.humansAlive, MIN_BOTS, SNAKE_TARGET);
  }

  allocateId() {
    for (let tries = 0; tries < 65000; tries++) {
      const id = this.nextSnakeId;
      this.nextSnakeId = this.nextSnakeId >= 65000 ? 1 : this.nextSnakeId + 1;
      if (!this.snakes.has(id)) return id;
    }
    throw new Error('No snake ids left');
  }

  /** A spawn point as far as possible from every existing body. */
  safeSpot() {
    let best = { x: 0, y: 0 };
    let bestDistance = -1;
    for (let attempt = 0; attempt < 24; attempt++) {
      const r = ARENA_RADIUS * 0.6 * Math.sqrt(this.rng());
      const a = this.rng() * TAU;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      let nearest = 900;
      for (const snake of this.snakes.values()) {
        const p = snake.points;
        for (let i = 0; i < p.length; i += 4) {
          const d = Math.hypot(p[i] - x, p[i + 1] - y);
          if (d < nearest) nearest = d;
        }
      }
      if (nearest > bestDistance) { bestDistance = nearest; best = { x, y }; }
      if (nearest >= 900) break;
    }
    return best;
  }

  spawnSnake({ name, skin = 0, bot = false }) {
    const id = this.allocateId();
    const { x, y } = this.safeSpot();
    // Face roughly inwards, so nobody spawns pointed at the wall.
    const angle = wrapAngle(Math.atan2(-y, -x) + (this.rng() - 0.5) * 2);
    const mass = START_MASS;
    const spacing = spacingOf(mass);
    const points = [];
    for (let i = 0; i < segmentsOf(mass); i++) {
      points.push(x - Math.cos(angle) * spacing * i, y - Math.sin(angle) * spacing * i);
    }
    const snake = {
      id, name, skin: clamp(skin | 0, 0, SKINS.length - 1), bot, alive: true,
      mass, angle, targetAngle: angle, boost: false, boosting: false,
      points, width: widthOf(mass), spacing,
      dropTimer: 0, dropBank: 0, kills: 0, bornTick: this.tick, bestRank: 0,
      brain: bot ? makeBrain(this.rng) : null, owner: null,
      minX: x, minY: y, maxX: x, maxY: y,
    };
    this.bounds(snake);
    this.snakes.set(id, snake);
    if (bot) this.botsAlive += 1;
    this.events.spawned.push(snake);
    return snake;
  }

  spawnBot() {
    const taken = new Set([...this.snakes.values()].map((snake) => snake.name));
    const free = BOT_NAMES.filter((name) => !taken.has(name));
    const pool = free.length ? free : BOT_NAMES;
    const name = pool[Math.floor(this.rng() * pool.length)];
    return this.spawnSnake({ name, skin: Math.floor(this.rng() * SKINS.length), bot: true });
  }

  fillBots() {
    if (!this.useBots || this.botsAlive >= this.desiredBots() || this.tick < this.nextBotAt) return;
    this.spawnBot();
    // Staggered, so a wave of deaths does not refill the arena in one frame.
    this.nextBotAt = this.tick + Math.round((0.6 + this.rng() * 1.8) * SIM_HZ);
  }

  kill(snake, killer = 0) {
    if (!snake.alive) return;
    snake.alive = false;
    this.snakes.delete(snake.id);
    if (snake.bot) this.botsAlive -= 1;

    // The body becomes food in the snake's own colour.
    const n = snake.points.length / 2;
    const total = snake.mass * DEATH_DROP_RATIO;
    const count = Math.max(1, Math.min(n, 160, Math.floor(total)));
    const value = total / count;
    const step = n / count;
    const colour = SKINS[snake.skin]?.food ?? 0;
    const spread = snake.width * 0.32;
    for (let k = 0; k < count; k++) {
      const i = Math.min(n - 1, Math.floor(k * step)) * 2;
      this.addFood(
        snake.points[i] + (this.rng() - 0.5) * spread * 2,
        snake.points[i + 1] + (this.rng() - 0.5) * spread * 2,
        value, colour, true,
      );
    }

    const credited = killer && killer !== LEFT_GAME ? this.snakes.get(killer) : null;
    if (credited) credited.kills += 1;
    this.events.deaths.push({ victim: snake.id, killer, score: snake.mass, snake });
  }

  // ---- food ------------------------------------------------------------

  addFood(x, y, value, color, decays) {
    if (this.food.size >= FOOD_MAX) {
      // Death drops are the reward for a kill, so they push out the oldest
      // dropped pellets rather than being refused. Natural food just waits.
      if (!decays) return null;
      this.evictOldestDrop();
      if (this.food.size >= FOOD_MAX) return null;
    }
    const food = {
      id: this.nextFoodId, x, y, value, color, natural: !decays,
      expires: decays ? this.tick + FOOD_DECAY_SECONDS * SIM_HZ : 0, key: 0,
    };
    this.nextFoodId = this.nextFoodId >= 0xfffffff0 ? 1 : this.nextFoodId + 1;
    food.key = this.foodGrid.insert(x, y, food);
    this.food.set(food.id, food);
    if (decays) this.dropQueue.push(food);
    else this.naturalFood += 1;
    this.events.foodAdded.push(food);
    return food;
  }

  removeFood(food, eater) {
    if (!this.food.delete(food.id)) return;
    this.foodGrid.remove(food.key, food);
    if (food.natural) this.naturalFood -= 1;
    this.events.foodEaten.push({ id: food.id, eater });
  }

  evictOldestDrop() {
    while (this.dropQueue.length) {
      const food = this.dropQueue.shift();
      if (this.food.has(food.id)) { this.removeFood(food, 0); return; }
    }
  }

  spawnNaturalFood() {
    const r = (ARENA_RADIUS - 40) * Math.sqrt(this.rng());
    const a = this.rng() * TAU;
    const roll = this.rng();
    const value = roll < 0.72 ? 1 : roll < 0.93 ? 2 : 3;
    this.addFood(Math.cos(a) * r, Math.sin(a) * r, value, Math.floor(this.rng() * PALETTE.length), false);
  }

  decayFood() {
    while (this.dropQueue.length && this.dropQueue[0].expires <= this.tick) {
      this.removeFood(this.dropQueue.shift(), 0);   // a no-op if it was eaten meanwhile
    }
  }

  // ---- the tick --------------------------------------------------------

  step() {
    this.tick += 1;
    if (this.useBots) {
      // Half the bots think on each tick, so the work is spread out evenly.
      for (const snake of this.snakes.values()) {
        if (snake.bot && (snake.id + this.tick) % 2 === 0) think(this, snake);
      }
    }
    for (const snake of this.snakes.values()) this.move(snake);
    this.indexBodies();
    for (const snake of this.snakes.values()) this.eat(snake);
    for (const [snake, killer] of this.findCollisions()) this.kill(snake, killer);
    this.decayFood();
    for (let i = 0; i < FOOD_SPAWN_PER_TICK && this.naturalFood < FOOD_TARGET; i++) this.spawnNaturalFood();
    this.fillBots();
  }

  move(snake) {
    const turn = turnRateOf(snake.mass) * SIM_DT;
    const diff = wrapAngle(snake.targetAngle - snake.angle);
    snake.angle = wrapAngle(snake.angle + clamp(diff, -turn, turn));

    snake.boosting = snake.boost && snake.mass > MIN_BOOST_MASS;
    const speed = snake.boosting ? BOOST_SPEED : BASE_SPEED;
    const p = snake.points;
    p[0] += Math.cos(snake.angle) * speed * SIM_DT;
    p[1] += Math.sin(snake.angle) * speed * SIM_DT;

    if (snake.boosting) {
      // Boosting is paid for in length, and the length is left behind as food —
      // which is what makes a boosting snake worth chasing.
      const burn = boostBurn(snake.mass) * SIM_DT;
      snake.mass -= burn;
      snake.dropBank += burn;
      snake.dropTimer += SIM_DT;
      if (snake.dropTimer >= BOOST_DROP_SECONDS && snake.dropBank >= 1) {
        const tail = p.length - 2;
        this.addFood(
          p[tail] + (this.rng() - 0.5) * 8, p[tail + 1] + (this.rng() - 0.5) * 8,
          snake.dropBank, SKINS[snake.skin]?.food ?? 0, true,
        );
        snake.dropBank = 0;
        snake.dropTimer = 0;
      }
    } else {
      snake.dropTimer = 0;
    }

    snake.width = widthOf(snake.mass);
    snake.spacing = spacingOf(snake.mass);
    const wanted = segmentsOf(snake.mass) * 2;
    while (p.length < wanted) p.push(p[p.length - 2], p[p.length - 1]);
    if (p.length > wanted) p.length = wanted;

    // Follow the leader: each point is pulled to within one spacing of the
    // point in front of it. The body traces the head's path, and never stretches.
    const spacing = snake.spacing;
    for (let i = 2; i < p.length; i += 2) {
      const dx = p[i - 2] - p[i];
      const dy = p[i - 1] - p[i + 1];
      const d = Math.hypot(dx, dy);
      if (d > spacing) {
        const k = (d - spacing) / d;
        p[i] += dx * k;
        p[i + 1] += dy * k;
      }
    }
    this.bounds(snake);
  }

  bounds(snake) {
    const p = snake.points;
    let minX = p[0]; let maxX = p[0]; let minY = p[1]; let maxY = p[1];
    for (let i = 2; i < p.length; i += 2) {
      if (p[i] < minX) minX = p[i]; else if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1]; else if (p[i + 1] > maxY) maxY = p[i + 1];
    }
    const pad = snake.width / 2;
    snake.minX = minX - pad; snake.maxX = maxX + pad;
    snake.minY = minY - pad; snake.maxY = maxY + pad;
  }

  indexBodies() {
    this.bodyGrid.reset();
    this.slots = [...this.snakes.values()];
    for (let slot = 0; slot < this.slots.length; slot++) {
      const p = this.slots[slot].points;
      for (let i = 0; i < p.length; i += 2) this.bodyGrid.insert(p[i], p[i + 1], (slot << 10) | (i >> 1));
    }
  }

  eat(snake) {
    const hx = snake.points[0];
    const hy = snake.points[1];
    const reach = snake.width / 2 + EAT_REACH;
    const eaten = [];
    this.foodGrid.query(hx, hy, reach + MAX_FOOD_RADIUS, (food) => {
      const r = reach + foodRadius(food.value);
      const dx = food.x - hx;
      const dy = food.y - hy;
      if (dx * dx + dy * dy < r * r) eaten.push(food);
    });
    // Removed after the query, because removal reshuffles the cell being walked.
    for (const food of eaten) {
      if (!this.food.has(food.id)) continue;
      snake.mass += food.value;
      this.removeFood(food, snake.id);
    }
  }

  /** Heads against other snakes' bodies, and against the wall. Returns [snake, killerId] pairs. */
  findCollisions() {
    const deaths = [];
    let maxHalf = 0;
    for (const snake of this.slots) maxHalf = Math.max(maxHalf, snake.width / 2);

    for (let slot = 0; slot < this.slots.length; slot++) {
      const a = this.slots[slot];
      const hx = a.points[0];
      const hy = a.points[1];
      const ra = a.width / 2;
      if (Math.hypot(hx, hy) + ra * 0.5 > ARENA_RADIUS) { deaths.push([a, 0]); continue; }

      let killer = -1;
      this.bodyGrid.query(hx, hy, ra + maxHalf, (item) => {
        if (killer >= 0) return;
        const other = item >> 10;
        if (other === slot) return;   // your own body never kills you
        const b = this.slots[other];
        const i = (item & 1023) * 2;
        const dx = b.points[i] - hx;
        const dy = b.points[i + 1] - hy;
        const reach = (ra + b.width / 2) * HIT_FORGIVENESS;
        if (dx * dx + dy * dy < reach * reach) killer = b.id;
      });
      if (killer >= 0) deaths.push([a, killer]);
    }
    return deaths;
  }

  // ---- queries for the server -----------------------------------------

  ranking() {
    return [...this.snakes.values()].sort((a, b) => b.mass - a.mass || a.id - b.id);
  }

  /** Live snakes whose bounds overlap a view rectangle centred on (cx, cy). */
  visible(cx, cy, halfWidth, halfHeight) {
    const out = [];
    for (const snake of this.snakes.values()) {
      if (snake.maxX < cx - halfWidth || snake.minX > cx + halfWidth) continue;
      if (snake.maxY < cy - halfHeight || snake.minY > cy + halfHeight) continue;
      out.push(snake);
    }
    return out;
  }
}

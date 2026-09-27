// One match: a world, up to a hundred players, and the fixed-order tick that
// moves it forward. The order is deliberate and never changes:
//
//   input → movement → build placement → weapon fire → damage → storm → replication
//
// so a wall placed this tick blocks a shot fired this tick, a shot's damage
// lands before the storm's, and every client sees the result of the whole tick.

import { World } from '../shared/world.js';
import { getWorld, MAP_SEED } from '../shared/worldgen.js';
import { stepMovement, MODE_BUS, MODE_DEAD, MODE_WALK } from '../shared/movement.js';
import {
  TICK_HZ, REP_CELL, REP_N, NEAR_RADIUS, FAR_RADIUS, FAR_EVERY,
} from '../shared/constants.js';
import {
  Writer, S_SNAPSHOT, B_END, writeSelf, writePlayer,
} from '../shared/protocol.js';
import { createPlayer, recordHistory } from './player.js';
import { Rng } from '../shared/rng.js';
import { replicationMethods } from './replication.js';
import { structureMethods } from './structures.js';
import { harvestMethods } from './harvest.js';

export const STAGES = ['input', 'movement', 'build', 'fire', 'damage', 'storm', 'replication'];

const MAX_INPUTS_PER_TICK = 2;
const MAX_QUEUE = 8;
const STALL_TICKS = 6;        // no input for this long and gravity takes over

export class Match {
  constructor({ id = 1, mode = 'sandbox', seed = MAP_SEED, rngSeed = Date.now() >>> 0, log = null, trace = false } = {}) {
    this.id = id;
    this.mode = mode;
    this.seed = seed;
    this.rngSeed = rngSeed;
    this.log = log;
    this.base = getWorld(seed);
    this.world = new World(this.base);
    this.tick = 0;
    this.players = new Map();
    this.nextPlayerId = 1;
    this.conns = new Set();
    this.trace = trace ? [] : null;
    this.writer = new Writer(64 * 1024);
    this.stats = { ticks: 0, totalMs: 0, maxMs: 0, recent: [] };
    this.repBuckets = Array.from({ length: REP_N * REP_N }, () => []);
    this.damageQueue = [];
    this.spawnPoints = [];
    this.rng = new Rng(rngSeed);
    this.initReplication();
  }

  addPlayer(opts) {
    const id = this.nextPlayerId++;
    const p = createPlayer({ ...opts, id, team: opts.team ?? id });
    this.players.set(id, p);
    return p;
  }

  removePlayer(p) {
    this.players.delete(p.id);
    if (p.conn) p.conn.player = null;
    p.conn = null;
  }

  /** Puts a player on the ground at (x, z). */
  placeOnGround(p, x, z) {
    const m = p.move;
    m.x = x; m.z = z;
    m.y = this.world.terrain.heightAt(x, z) + 0.05;
    m.vx = m.vy = m.vz = 0;
    m.mode = MODE_WALK; m.ground = 1; m.peakY = m.y;
  }

  /** Queues a decoded input from a client. */
  queueInput(p, input) {
    if (input.seq <= p.lastSeq) return;
    if (p.inputs.length && input.seq <= p.inputs[p.inputs.length - 1].seq) return;
    p.inputs.push(input);
    if (p.inputs.length > MAX_QUEUE) p.inputs.splice(0, p.inputs.length - MAX_QUEUE);
  }

  step() {
    const started = performance.now();
    this.tick++;
    this.stageInput();
    this.stageMovement();
    this.stageBuild();
    this.stageFire();
    this.stageDamage();
    this.stageStorm();
    this.stageReplicate();
    const ms = performance.now() - started;
    const s = this.stats;
    s.ticks++; s.totalMs += ms; if (ms > s.maxMs) s.maxMs = ms;
    s.recent.push(ms); if (s.recent.length > 300) s.recent.shift();
  }

  mark(stage) { if (this.trace) this.trace.push(stage); }

  /* ---------------------------------------------------------- 1. input */

  stageInput() {
    this.mark('input');
    if (this.mode === 'sandbox') this.sandboxRespawns();
    for (const p of this.players.values()) {
      p.consumed = null;
      if (p.bot) continue;
      if (!p.inputs.length) continue;
      // Normally one input per tick. A client that fell behind (a hitch, a
      // burst after packet loss) catches up two at a time, never faster, so a
      // doctored client cannot move quicker by sending more.
      const take = p.inputs.length > 2 ? MAX_INPUTS_PER_TICK : 1;
      p.consumed = p.inputs.splice(0, take);
      for (const input of p.consumed) this.applyActions(p, input);
    }
  }

  applyActions(p, input) {
    // Filled in by later systems (slots, build selection, interaction…).
    void p; void input;
  }

  /* ------------------------------------------------------- 2. movement */

  stageMovement() {
    this.mark('movement');
    for (const p of this.players.values()) {
      if (!p.alive || p.move.mode === MODE_DEAD || p.move.mode === MODE_BUS) continue;
      if (p.bot) { this.movePlayer(p, p.botInput); continue; }
      if (p.consumed) {
        for (const input of p.consumed) {
          this.movePlayer(p, input);
          p.lastSeq = input.seq;
          p.lastInputTick = this.tick;
        }
      } else if (this.tick - p.lastInputTick > STALL_TICKS) {
        // A client that stopped sending still falls and stops walking.
        this.movePlayer(p, { mx: 0, mz: 0, yaw: p.yaw, pitch: p.pitch, buttons: 0, stall: true });
      }
    }
    for (const p of this.players.values()) recordHistory(p, this.tick);
  }

  movePlayer(p, input) {
    if (!input) return;
    if (!input.stall) {
      p.yaw = input.yaw; p.pitch = input.pitch; p.buttons = input.buttons;
      p.mx = input.mx; p.mz = input.mz; p.viewTick = input.viewTick;
    }
    const fall = stepMovement(p.move, input, this.world);
    if (fall > 0) this.onFallDamage(p, fall);
  }

  onFallDamage(p, amount) { this.damage(p, amount, { kind: 'fall' }); }

  /* ------------------------------------------------- 3‥6. later systems */

  stageBuild() { this.mark('build'); }
  stageFire() {
    this.mark('fire');
    for (const p of this.players.values()) this.swingPickaxe(p);
  }
  /* -------------------------------------------------------- 5. damage */

  /** Queues damage; it is all applied, in order, in the damage stage. */
  damage(target, amount, info = {}) {
    if (amount > 0) this.damageQueue.push({ target, amount, ...info });
  }

  stageDamage() {
    this.mark('damage');
    const queue = this.damageQueue;
    this.damageQueue = [];
    for (const d of queue) {
      if (d.structure) this.applyStructureDamage(d);
      else this.applyDamage(d);
    }
  }

  applyDamage(d) {
    const p = d.target;
    if (!p.alive) return 0;
    let amount = d.amount;
    // Shields soak damage first — except falling, which only ever hurts health.
    if (d.kind !== 'fall' && p.shield > 0) {
      const soaked = Math.min(p.shield, amount);
      p.shield -= soaked;
      amount -= soaked;
    }
    p.hp -= amount;
    p.conn?.sendJson({ t: 'hurt', amount: d.amount, kind: d.kind, from: d.source?.id || 0 });
    if (p.hp <= 0) this.eliminate(p, d);
    return d.amount;
  }

  eliminate(p, d = {}) {
    p.hp = 0;
    p.alive = false;
    p.move.mode = MODE_DEAD;
    p.move.vx = p.move.vy = p.move.vz = 0;
    p.diedAt = this.tick;
    p.conn?.sendJson({ t: 'died', cause: d.kind || 'unknown', by: d.source?.id || 0 });
    if (this.mode === 'sandbox') p.respawnAt = this.tick + 3 * TICK_HZ;
  }

  /** Sandbox only: the dead come back after three seconds at a spawn point. */
  sandboxRespawns() {
    for (const p of this.players.values()) {
      if (p.alive || !p.respawnAt || this.tick < p.respawnAt) continue;
      const spot = this.spawnPoints.length ? this.spawnPoints[p.id % this.spawnPoints.length] : { x: 2260, z: 2560 };
      this.placeOnGround(p, spot.x, spot.z);
      p.alive = true;
      p.hp = 100;
      p.shield = 0;
      p.respawnAt = 0;
      p.conn?.sendJson({ t: 'respawned' });
    }
  }
  stageStorm() { this.mark('storm'); }

  /* ---------------------------------------------------- 7. replication */

  stageReplicate() {
    this.mark('replication');
    // Bucket players by replication cell once, then each client reads the
    // cells around it instead of scanning all hundred players.
    for (const b of this.repBuckets) b.length = 0;
    for (const p of this.players.values()) {
      if (!p.alive && p.move.mode === MODE_DEAD) continue;
      p.repCell = repCellOf(p.move.x, p.move.z);
      if (p.repCell >= 0) this.repBuckets[p.repCell].push(p);
    }
    for (const conn of this.conns) {
      if (!conn.ready || conn.backlogged?.()) continue;
      conn.send(this.snapshotFor(conn));
    }
    this.events.length = 0;
    for (const p of this.players.values()) {
      if (p.invDirty) { p.invDirty = false; p.conn?.sendJson(this.inventoryMessage(p)); }
    }
  }

  inventoryMessage(p) { return { t: 'inv', mats: p.mats }; }

  /** The point a connection sees the world from: its player, or who it spectates. */
  focusOf(conn) {
    const p = conn.player;
    const target = p && (p.alive || p.move.mode !== MODE_DEAD) ? p : this.players.get(conn.spectating) || p;
    return target ? target.move : null;
  }

  snapshotFor(conn) {
    const w = this.writer.reset();
    const me = conn.player;
    w.u8(S_SNAPSHOT).u32(this.tick).u32(me ? me.lastSeq : 0);
    if (me) { w.u8(1); writeSelf(w, me); } else w.u8(0);
    const focus = this.focusOf(conn);
    const countAt = w.at;
    w.u16(0);
    let count = 0;
    if (focus) {
      const far = this.tick % FAR_EVERY === 0;
      const radius = far ? FAR_RADIUS : NEAR_RADIUS;
      const r2near = NEAR_RADIUS * NEAR_RADIUS, r2 = radius * radius;
      const span = Math.ceil(radius / REP_CELL);
      const ci = Math.floor(focus.x / REP_CELL), cj = Math.floor(focus.z / REP_CELL);
      for (let j = Math.max(0, cj - span); j <= Math.min(REP_N - 1, cj + span); j++) {
        for (let i = Math.max(0, ci - span); i <= Math.min(REP_N - 1, ci + span); i++) {
          for (const p of this.repBuckets[j * REP_N + i]) {
            if (p === me) continue;
            const dx = p.move.x - focus.x, dz = p.move.z - focus.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > r2 || (!far && d2 > r2near)) continue;
            writePlayer(w, p, { team: me ? p.team === me.team : false });
            count++;
          }
        }
      }
    }
    w.setU16(countAt, count);
    this.writeBlocks(w, conn, focus);
    w.u8(B_END);
    return w.finish();
  }

  tickStats() {
    const s = this.stats;
    const recent = [...s.recent].sort((a, b) => a - b);
    return {
      ticks: s.ticks,
      avgMs: s.ticks ? s.totalMs / s.ticks : 0,
      p99Ms: recent.length ? recent[Math.floor(recent.length * 0.99)] : 0,
      maxMs: s.maxMs,
    };
  }
}

Object.assign(Match.prototype, replicationMethods, structureMethods, harvestMethods);

export function repCellOf(x, z) {
  const i = Math.floor(x / REP_CELL), j = Math.floor(z / REP_CELL);
  if (i < 0 || j < 0 || i >= REP_N || j >= REP_N) return -1;
  return j * REP_N + i;
}

export { TICK_HZ };

// One match: a world, up to a hundred players, and the fixed-order tick that
// moves it forward. The order is deliberate and never changes:
//
//   input → movement → build placement → weapon fire → damage → storm → replication
//
// so a wall placed this tick blocks a shot fired this tick, a shot's damage
// lands before the storm's, and every client sees the result of the whole tick.

import { World } from '../shared/world.js';
import { getWorld, MAP_SEED } from '../shared/worldgen.js';
import { stepMovement, MODE_BUS, MODE_DEAD, MODE_WALK, MODE_SKYDIVE, MODE_GLIDE } from '../shared/movement.js';
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
import { buildingMethods } from './building.js';
import { combatMethods, EQUIP_TICKS } from './combat.js';
import { lootMethods } from './loot.js';
import { stormMethods } from './storm.js';
import { flowMethods, TEAM_SIZES } from './flow.js';
import { botMethods } from './bots.js';
import { teamMethods } from './teams.js';
import { A_SLOT, A_BUILD, A_MAT, A_PLACE, A_EDIT, A_RELOAD, A_INTERACT, A_DROP, A_JUMP, A_PING, PF_ADS, PF_BUILD, PF_FIRING, PF_USING, PF_HARVEST } from '../shared/protocol.js';
import { itemId, WEAPONS } from '../shared/items.js';
import { poiAt } from '../shared/worldgen.js';

const WEAPON_CLASS = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, ['ar', 'burst', 'scoped'].includes(w.cls) ? 'rifle' : ['pump', 'tactical'].includes(w.cls) ? 'shotgun' : w.cls]));
import { BTN_ADS } from '../shared/movement.js';

export const STAGES = ['input', 'movement', 'build', 'fire', 'damage', 'storm', 'replication'];

const MAX_INPUTS_PER_TICK = 2;
const INPUT_BURST = 6;
const MAX_QUEUE = 8;
const STALL_TICKS = 6;        // no input for this long and gravity takes over

export class Match {
  constructor({ id = 1, mode = 'sandbox', seed = MAP_SEED, rngSeed = Date.now() >>> 0, log = null, trace = false, base = null, loot = true, flow = null } = {}) {
    this.id = id;
    this.mode = mode;
    this.seed = seed;
    this.rngSeed = rngSeed;
    this.log = log;
    this.base = base || getWorld(seed);
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
    this.projectiles = [];
    this.initReplication();
    this.initLoot();
    if (loot) this.spawnLoot();
    this.phase = null;
    if (TEAM_SIZES[mode]) this.initFlow(flow || {});
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
    if (this.phase) this.stageFlow();
    this.driveBots();
    for (const p of this.players.values()) {
      p.consumed = null;
      if (p.bot) continue;
      // A token bucket: one input's worth of credit per tick, banked up to a
      // small burst. A client that hitched catches up two inputs a tick until
      // the bank is spent, but no client — however many it sends — ever gets
      // more than 30 ticks of movement a second.
      p.inputBudget = Math.min(INPUT_BURST, (p.inputBudget ?? INPUT_BURST) + 1);
      if (!p.inputs.length) continue;
      const take = Math.min(p.inputs.length > 2 ? MAX_INPUTS_PER_TICK : 1, Math.floor(p.inputBudget));
      if (take <= 0) continue;
      p.inputBudget -= take;
      p.consumed = p.inputs.splice(0, take);
      for (const input of p.consumed) this.applyActions(p, input);
    }
  }

  applyActions(p, input) {
    for (const a of input.actions) this.onAction(p, a);
  }

  onAction(p, a) {
    switch (a.type) {
      case A_SLOT: this.selectSlot(p, a.slot); break;
      case A_BUILD:
        if (a.piece === 255) p.buildMode = false;
        else if (a.piece <= 3) { p.buildMode = true; p.buildPiece = a.piece; }
        break;
      case A_MAT: if (a.mat <= 2) p.buildMat = a.mat; break;
      case A_PLACE: if (p.pendingBuild.length < 4) p.pendingBuild.push(a); break;
      case A_EDIT: if (p.pendingEdits.length < 4) p.pendingEdits.push(a); break;
      case A_RELOAD: this.startReload(p); break;
      case A_INTERACT: this.tryInteract(p, a); break;
      case A_DROP: this.dropSlot(p, a.slot); break;
      case A_JUMP: if (p.move.mode === MODE_BUS) p.wantsJump = true; break;
      case A_PING: this.ping(p, a); break;
      default: this.onOtherAction?.(p, a);
    }
  }

  selectSlot(p, slot) {
    p.buildMode = false;
    if (slot < 0 || slot > 5 || slot === p.held) return;
    p.held = slot;
    p.equipUntil = this.tick + EQUIP_TICKS;
    p.burstLeft = 0;
    p.invDirty = true;
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
    for (const p of this.players.values()) {
      recordHistory(p, this.tick);
      this.autoPickup(p);
    }
  }

  movePlayer(p, input) {
    if (!input) return;
    if (!input.stall) {
      p.yaw = input.yaw; p.pitch = input.pitch; p.buttons = input.buttons;
      p.mx = input.mx; p.mz = input.mz; p.viewTick = input.viewTick;
    }
    const wasAir = p.move.mode === MODE_SKYDIVE || p.move.mode === MODE_GLIDE;
    const fall = stepMovement(p.move, input, this.world);
    if (fall > 0) this.onFallDamage(p, fall);
    if (wasAir && p.move.mode === MODE_WALK && !p.landedAt) {
      p.landedAt = this.tick;
      p.landedPoi = poiAt(this.base, p.move.x, p.move.z);
    }
  }

  onFallDamage(p, amount) { this.damage(p, amount, { kind: 'fall' }); }

  /* ------------------------------------------------- 3‥6. later systems */

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
    this.stageTeams();
  }

  applyDamage(d) {
    const p = d.target;
    if (!p.alive) return 0;
    if (d.source && this.friendly(d.source, p)) return 0;     // friendly fire is off
    if (this.noDamage && d.kind !== 'storm') return 0;          // the pre-game island
    if (p.dbno) {
      // Knocked: damage comes off knocked health, and zero finishes them.
      const dealt = Math.min(d.amount, p.dbnoHp);
      p.dbnoHp -= d.amount;
      if (d.source && d.source !== p) {
        d.source.damageDealt = (d.source.damageDealt || 0) + dealt;
        d.source.conn?.sendJson({ t: 'hit', dmg: Math.round(d.amount), head: !!d.head, shield: false, x: d.point?.x, y: d.point?.y, z: d.point?.z, kill: p.dbnoHp <= 0, knocked: true });
      }
      if (p.dbnoHp <= 0) this.eliminate(p, { ...d, source: d.source || p.knockedBy });
      return dealt;
    }
    let amount = d.amount;
    const shieldBefore = p.shield;
    // What this hit actually takes off: overkill does not count as damage dealt.
    const effective = Math.min(d.amount, (d.kind === 'fall' ? 0 : p.shield) + Math.max(0, p.hp));
    // Shields soak damage first — except falling, which only ever hurts health.
    if (d.kind !== 'fall' && p.shield > 0) {
      const soaked = Math.min(p.shield, amount);
      p.shield -= soaked;
      amount -= soaked;
    }
    p.hp -= amount;
    p.lastHurtTick = this.tick;
    p.conn?.sendJson({ t: 'hurt', amount: Math.round(d.amount), kind: d.kind, from: d.source?.id || 0 });
    const src = d.source;
    if (src && src !== p) {
      src.damageDealt = (src.damageDealt || 0) + effective;
      const cls = d.weapon && WEAPON_CLASS[d.weapon];
      if (cls) src.damageByClass = { ...src.damageByClass, [cls]: ((src.damageByClass || {})[cls] || 0) + effective };
      src.conn?.sendJson({ t: 'hit', dmg: Math.round(d.amount), head: !!d.head, shield: shieldBefore > 0, x: d.point?.x, y: d.point?.y, z: d.point?.z, kill: p.hp <= 0 });
    }
    if (p.hp <= 0) {
      if (this.canKnock(p)) this.knock(p, d);
      else this.eliminate(p, d);
    }
    return d.amount;
  }

  eliminate(p, d = {}) {
    if (!p.alive) return;
    p.dbno = false;
    p.reviving = null;
    const killer = d.source && d.source !== p ? d.source : null;
    if (killer) killer.kills++;
    p.eliminatedBy = killer ? killer.id : 0;
    this.broadcastFeed({ killer: killer?.id || 0, victim: p.id, cause: d.kind || 'unknown', weapon: d.weapon || '', head: !!d.head });
    // No respawns, no second chances: what you carried is left for whoever finds it.
    if (this.mode !== 'sandbox') this.dropLootPile(p);
    p.hp = 0;
    p.alive = false;
    p.move.mode = MODE_DEAD;
    p.move.vx = p.move.vy = p.move.vz = 0;
    p.diedAt = this.tick;
    p.conn?.sendJson({ t: 'died', cause: d.kind || 'unknown', by: d.source?.id || 0 });
    if (this.mode === 'sandbox') p.respawnAt = this.tick + 3 * TICK_HZ;
    this.aliveDirty = true;
    if (this.phase && !d.finishing) this.teamCheck(p.team);
    if (p.conn && killer) p.conn.spectating = killer.id;
    for (const conn of this.conns) if (conn.spectating === p.id) conn.spectating = killer ? killer.id : 0;
  }

  /** Practice mode gives everyone materials and a full kit to try things with. */
  practiceLoadout(p) {
    p.mats = [300, 300, 300];
    p.inv = [null, null, null, null, null];
    this.giveItem(p, { key: 'ar', rarity: 2 });
    this.giveItem(p, { key: 'pump', rarity: 1 });
    this.giveItem(p, { key: 'sniper', rarity: 2 });
    this.giveItem(p, { key: 'rocket', rarity: 3 });
    this.giveItem(p, { key: 'shield', count: 2 });
    p.ammo = { light: 120, medium: 240, heavy: 40, rockets: 6 };
    p.invDirty = true;
  }

  broadcastFeed(entry) {
    const msg = { t: 'feed', ...entry };
    for (const conn of this.conns) conn.sendJson(msg);
    this.feed = this.feed || [];
    this.feed.push({ ...entry, tick: this.tick });
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
      this.practiceLoadout(p);
      p.conn?.sendJson({ t: 'respawned' });
    }
  }

  /* ---------------------------------------------------- 7. replication */

  stageReplicate() {
    this.mark('replication');
    for (const p of this.players.values()) {
      // What other clients need to draw this player: what they hold and what they are doing.
      const item = p.held > 0 ? p.inv[p.held - 1] : null;
      p.heldKind = p.buildMode ? 255 : item ? itemId(item.key) : 0;
      p.heldRarity = item ? item.rarity || 0 : 0;
      p.flags = ((p.buttons & BTN_ADS) && !p.buildMode ? PF_ADS : 0) | (p.buildMode ? PF_BUILD : 0)
        | (this.tick - p.lastShotTick < 3 ? PF_FIRING : 0) | (p.using ? PF_USING : 0) | (this.tick - p.swingTick < 10 ? PF_HARVEST : 0);
    }
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
    if (this.aliveDirty && this.phase) {
      this.aliveDirty = false;
      const msg = { t: 'alive', players: this.aliveCount(), teams: this.aliveTeams().size };
      for (const conn of this.conns) conn.sendJson(msg);
    }
    for (const p of this.players.values()) {
      if (p.invDirty) { p.invDirty = false; p.conn?.sendJson(this.inventoryMessage(p)); }
    }
  }

  rosterEntry(p) {
    return { id: p.id, name: p.name, team: p.team, bot: p.bot, outfit: p.outfit, glider: p.glider, pickaxe: p.pickaxe };
  }

  matchMessage(p) {
    return {
      t: 'match', id: this.id, mode: this.mode, seed: this.seed, hash: this.base.hash,
      you: p.id, team: p.team, tick: this.tick, tickHz: TICK_HZ, teamSize: this.teamSize || 1,
      roster: [...this.players.values()].map((q) => this.rosterEntry(q)),
    };
  }

  broadcastRoster() {
    const msg = { t: 'roster', players: [...this.players.values()].map((q) => this.rosterEntry(q)) };
    for (const conn of this.conns) conn.sendJson(msg);
  }

  inventoryMessage(p) {
    return {
      t: 'inv', mats: p.mats, slots: p.inv, ammo: p.ammo, held: p.held,
      reload: p.reloadEnd ? { end: p.reloadEnd, total: p.reloadEnd - (p.reloadStart || this.tick) } : null,
      using: p.using ? { key: p.using.key, start: p.using.start, end: p.using.end } : null,
      shots: p.shots,
    };
  }

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
            if (p === me || p.move.mode === MODE_BUS) continue;
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

Object.assign(Match.prototype, replicationMethods, structureMethods, harvestMethods, buildingMethods, combatMethods, lootMethods, stormMethods, flowMethods, botMethods, teamMethods);

export function repCellOf(x, z) {
  const i = Math.floor(x / REP_CELL), j = Math.floor(z / REP_CELL);
  if (i < 0 || j < 0 || i >= REP_N || j >= REP_N) return -1;
  return j * REP_N + i;
}

export { TICK_HZ };

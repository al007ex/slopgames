// Bots fill every match up to a hundred. They are deliberately ordinary
// players: they pick somewhere to land, jump when the blimp is close enough,
// loot what they find, run from the storm, heal when it is quiet, and fight
// whoever they see — aiming with an error that shrinks the longer they track
// you, strafing, and throwing up a wall when they are being shot. When they
// walk into something they cannot get around, they do what anyone would:
// pickaxe straight through it.

import { WEAPONS, HEALS, isWeapon, isHeal, isAmmo, isMaterial } from '../shared/items.js';
import { MODE_WALK, MODE_SKYDIVE, MODE_GLIDE, MODE_BUS, MODE_DEAD, MODE_DBNO, BTN_FIRE, BTN_JUMP, BTN_SPRINT, BTN_ADS, BTN_USE } from '../shared/movement.js';
import { buildTarget } from '../shared/build.js';
import { WALL, RAMP } from '../shared/pieces.js';
import { A_SLOT, A_INTERACT, A_PLACE, A_RELOAD, A_MAT } from '../shared/protocol.js';
import { INTERACT_ITEM, INTERACT_CHEST, INTERACT_REVIVE } from './loot.js';
import { outsideStorm } from '../shared/storm.js';
import { OUTFITS, GLIDERS, PICKAXES } from '../shared/cosmetics.js';
import { OWNER_PROP } from '../shared/collision.js';
import { PROP_KINDS } from '../shared/props.js';
import { TICK_HZ, CELL, WALL_H, MAX_HP } from '../shared/constants.js';

const FIRST = ['Turbo', 'Pixel', 'Rusty', 'Mango', 'Nova', 'Blaze', 'Echo', 'Frosty', 'Gizmo', 'Hexa', 'Jolt', 'Karma', 'Lunar', 'Mocha', 'Nimbus', 'Orbit', 'Pepper', 'Quartz', 'Sable', 'Tango', 'Vortex', 'Whisk', 'Zephyr', 'Bravo', 'Comet', 'Dusty', 'Ember', 'Fizz', 'Glitch', 'Honey', 'Indigo', 'Jazzy', 'Kiwi', 'Lucky', 'Maple', 'Nacho', 'Olive', 'Pogo', 'Ripple', 'Salty', 'Tofu', 'Velvet', 'Wobbly', 'Yolk', 'Ziggy', 'Captain', 'Sir', 'Lil', 'Big', 'Sneaky', 'Cozy', 'Crispy', 'Spicy', 'Sleepy', 'Grumpy', 'Rapid', 'Quiet', 'Loud', 'Tiny'];
const SECOND = ['Fox', 'Panda', 'Wolf', 'Otter', 'Badger', 'Hawk', 'Moose', 'Raven', 'Tiger', 'Llama', 'Gecko', 'Bison', 'Koala', 'Lynx', 'Newt', 'Owl', 'Pike', 'Quail', 'Seal', 'Toad', 'Yak', 'Crab', 'Duck', 'Eel', 'Frog', 'Goat', 'Heron', 'Ibex', 'Jay', 'Kite', 'Lemur', 'Mole', 'Narwhal', 'Pigeon', 'Robin', 'Shark', 'Turtle', 'Walrus', 'Beans', 'Noodle', 'Pickle', 'Waffle', 'Muffin', 'Taco', 'Biscuit'];

const THINK_EVERY = 4;
const SIGHT = 95;
const LOOT_RADIUS = 70;
const TREE_KINDS = new Set(['pine', 'oak', 'deadtree']);

const hit = {};
const scratch = [];
const tsample = {};

export const botMethods = {
  addBot() {
    const rng = this.rng;
    const name = `${rng.pick(FIRST)}${rng.pick(SECOND)}${rng.chance(0.5) ? rng.int(1, 99) : ''}`;
    const p = this.addPlayer({
      name, bot: true, team: this.nextTeam ? this.nextTeam() : undefined,
      outfit: rng.int(0, OUTFITS.length - 1), glider: rng.int(0, GLIDERS.length - 1), pickaxe: rng.int(0, PICKAXES.length - 1),
    });
    p.botInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0 };
    p.ai = {
      skill: rng.range(0.25, 0.9), state: 'idle', goal: null, steer: 0, think: rng.int(0, THINK_EVERY - 1),
      lastPos: { x: 0, z: 0 }, stuckCheck: 0, stuck: 0, breakUntil: 0, errYaw: 0, errPitch: 0, err: 0.2,
      enemy: null, enemySeen: -1e9, strafe: 1, strafeFlip: 0, lastWall: -1e9, blacklist: new Set(), visited: new Set(),
      loot: null, lootSince: 0, drop: null, reach: rng.range(250, 800), semi: 0, tree: null, treeSince: 0,
    };
    this.onRoster?.(p);
    return p;
  },

  /** Runs every bot's brain (a quarter of them per tick) and steering (all of them). */
  driveBots() {
    for (const p of this.players.values()) {
      if (!p.bot || !p.ai || !p.alive) continue;
      const ai = p.ai;
      if ((this.tick + ai.think) % THINK_EVERY === 0) this.botThink(p);
      this.botControl(p);
    }
  },

  /* --------------------------------------------------------------- think */

  botThink(p) {
    const ai = p.ai, m = p.move;
    if (m.mode === MODE_BUS) { this.botBus(p); return; }
    if (m.mode === MODE_SKYDIVE || m.mode === MODE_GLIDE) return;
    if (m.mode === MODE_DBNO) { ai.state = 'crawl'; this.botCrawl(p); this.botSteer(p); return; }
    if (m.mode !== MODE_WALK) return;

    if (ai.landed === undefined) ai.landed = this.tick;
    this.botSee(p);
    this.botStuck(p);
    const storm = this.stormNow?.();
    const urgent = storm && this.botStormUrgent(p, storm);
    const enemy = ai.enemy;
    const d = enemy ? Math.hypot(enemy.move.x - m.x, enemy.move.z - m.z) : Infinity;

    const armed = this.botArmed(p);
    const downed = this.teamSize > 1 ? this.botDownedMate(p) : null;
    if (downed && (!enemy || d > 35) && this.tick - ai.enemySeen > 2 * TICK_HZ) {
      ai.state = 'revive';
      ai.goal = { x: downed.move.x, z: downed.move.z };
      ai.reviveTarget = downed;
      if (Math.hypot(downed.move.x - m.x, downed.move.z - m.z) < 2.3 && !p.reviving) this.onAction(p, { type: A_INTERACT, kind: INTERACT_REVIVE, id: downed.id });
    } else if (enemy && (!urgent || d < 20) && armed) ai.state = 'fight';
    // Pickaxe fights are a last resort: when cornered, or long after landing with nothing left to shoot.
    else if (enemy && !armed && d < 10 && (this.tick - (p.lastHurtTick || -1e9) < TICK_HZ || this.tick - ai.landed > 45 * TICK_HZ)) { ai.state = 'brawl'; ai.goal = null; }
    else if (enemy && !armed && d < 45 && this.botArmed(enemy)) {
      // Caught with no gun: run the other way, towards loot if there is any.
      ai.state = 'flee';
      const ax = p.move.x - enemy.move.x, az = p.move.z - enemy.move.z, al = Math.hypot(ax, az) || 1;
      ai.goal = { x: p.move.x + (ax / al) * 40, z: p.move.z + (az / al) * 40 };
    }
    else if (urgent) { ai.state = 'rotate'; ai.goal = this.botSafeSpot(p, storm); }
    else if (this.botWantsHeal(p) && this.tick - ai.enemySeen > 3 * TICK_HZ) ai.state = 'heal';
    else if (this.botWantsLoot(p) && this.botPickLoot(p)) ai.state = 'loot';
    else if (!this.botArmed(p) && this.botPickBuilding(p, storm)) ai.state = 'search';
    else if (p.mats[0] < 60 && this.tick - ai.enemySeen > 5 * TICK_HZ && this.botPickTree(p)) ai.state = 'harvest';
    else if (this.botWantsLoot(p) && this.botPickBuilding(p, storm)) ai.state = 'search';
    else { ai.state = 'roam'; if (!ai.goal || this.botAt(p, ai.goal, 8)) ai.goal = this.botRoamSpot(p, storm); }

    if (ai.state === 'loot') this.botLootStep(p);
    if (ai.state === 'fight') this.botFightThink(p, enemy, d);
    if (ai.state === 'heal') this.botHealThink(p);
    this.botSteer(p);
  },

  botAt(p, g, r) { return Math.hypot(g.x - p.move.x, g.z - p.move.z) < r; },

  botBus(p) {
    const ai = p.ai;
    if (!this.route) return;
    // Squads drop together: follow the first teammate who picked a spot, and
    // jump when they jump.
    const lead = this.teamSize > 1 ? [...this.players.values()].find((q) => q !== p && q.team === p.team && q.ai?.drop) : null;
    if (!ai.drop) ai.drop = lead ? { x: lead.ai.drop.x + this.rng.range(-15, 15), z: lead.ai.drop.z + this.rng.range(-15, 15) } : this.botPickDrop(p);
    if (lead && lead.jumpedAt) { p.wantsJump = true; return; }
    const bus = this.busPosition();
    const d = Math.hypot(ai.drop.x - bus.x, ai.drop.z - bus.z);
    const r = this.route;
    // Closest point of the route to the target: jump once we are within reach
    // and it is not getting any closer, or at the latest when it starts to recede.
    const ux = (r.x1 - r.x0) / r.length, uz = (r.z1 - r.z0) / r.length;
    const ahead = (ai.drop.x - bus.x) * ux + (ai.drop.z - bus.z) * uz;
    if ((d < ai.reach && ahead < ai.reach * 0.3) || ahead < 0 || bus.t > 0.97) p.wantsJump = true;
  },

  /** Somewhere to land that can actually be reached by gliding from the blimp's line. */
  botPickDrop(p) {
    const rng = this.rng, r = this.route;
    const ux = (r.x1 - r.x0) / r.length, uz = (r.z1 - r.z0) / r.length;
    const offLine = (x, z) => Math.abs((x - r.x0) * uz - (z - r.z0) * ux);
    const inReach = (x, z) => offLine(x, z) < 750;
    const pois = this.base.pois.filter((q) => inReach(q.x, q.z));
    if (pois.length && rng.chance(0.72)) {
      const poi = rng.pick(pois);
      const a = rng.range(0, Math.PI * 2), rr = rng.range(0, poi.r * 0.6);
      return { x: poi.x + Math.cos(a) * rr, z: poi.z + Math.sin(a) * rr };
    }
    for (let i = 0; i < 20; i++) {
      const b = rng.pick(this.base.buildings);
      const x = (b.cx + b.w / 2) * CELL, z = (b.cz + b.d + 1.5) * CELL;
      if (inReach(x, z) && b.poi < 0) return { x, z };
    }
    const t = rng.range(0.2, 0.8);
    return { x: r.x0 + (r.x1 - r.x0) * t + uz * rng.range(-300, 300), z: r.z0 + (r.z1 - r.z0) * t - ux * rng.range(-300, 300) };
  },

  /** Nearest visible enemy within sight, remembered a few seconds after losing sight. */
  botSee(p) {
    const ai = p.ai, m = p.move;
    const eyeY = m.y + 1.6;
    let best = null, bestD = SIGHT;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team || q.move.mode === MODE_BUS || q.move.mode === MODE_DEAD) continue;
      const dx = q.move.x - m.x, dz = q.move.z - m.z;
      if (Math.abs(dx) > bestD || Math.abs(dz) > bestD) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= bestD) continue;
      const dy = q.move.y + 1.1 - eyeY;
      const dist = Math.sqrt(d * d + dy * dy);
      const t = this.world.grid.raycast(m.x, eyeY, m.z, dx, dy, dz, dist, hit);
      if (t < dist - 0.6) continue;
      best = q; bestD = d;
    }
    if (best) {
      if (best !== ai.enemy) { ai.err = 0.28 * (1.25 - ai.skill); ai.errYaw = (this.rng.next() - 0.5) * ai.err * 2; ai.errPitch = (this.rng.next() - 0.5) * ai.err; }
      ai.enemy = best;
      ai.enemySeen = this.tick;
    } else if (ai.enemy && (this.tick - ai.enemySeen > 4 * TICK_HZ || !ai.enemy.alive)) ai.enemy = null;
  },

  botDownedMate(p) {
    let best = null, bd = 70;
    for (const q of this.players.values()) {
      if (q === p || q.team !== p.team || !q.alive || !q.dbno) continue;
      const d = Math.hypot(q.move.x - p.move.x, q.move.z - p.move.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  },

  botArmed(p) { return p.inv.some((s) => s && isWeapon(s.key) && (s.mag > 0 || (p.ammo[WEAPONS[s.key].ammo] || 0) > 0)); },

  /**
   * Time to go? Work out when the wall will actually reach this spot — the
   * rest of the wait plus how far through the shrink it gets here — and leave
   * when running to safety would take about that long. Early phases barely
   * hurt, so bots loot first, as people do.
   */
  botStormUrgent(p, s) {
    const m = p.move;
    if (outsideStorm(s, m.x, m.z)) return true;
    const n = s.next;
    if (!n || n.r <= 0) return s.r > 0 && Math.hypot(m.x - s.x, m.z - s.z) > s.r * 0.6;
    const toNext = Math.hypot(m.x - n.x, m.z - n.z);
    const out = toNext - n.r * 0.85;
    if (out <= 0) return false;
    const phase = this.stormPlan.phases[s.phase - 1];
    const from = this.stormPlan.circles[s.phase - 1];
    const span = Math.max(1, from.r - n.r);
    const reachAt = Math.max(0, Math.min(1, (from.r - toNext) / span));   // how far into the shrink the wall gets here
    const catchIn = s.state === 'wait' ? s.timeLeft + phase.shrink * reachAt : Math.max(0, (s.r - Math.hypot(m.x - s.x, m.z - s.z)) / (span / phase.shrink));
    const travel = out / 5.5;
    const slack = phase.dps <= 1 ? -10 : phase.dps <= 2 ? 5 : 20;
    return catchIn < travel + slack;
  },

  botSafeSpot(p, s) {
    const n = s.next && s.next.r > 0 ? s.next : s;
    const ai = p.ai;
    if (ai.safe && ai.safeFor === n) return ai.safe;
    const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0, Math.max(5, n.r * 0.45));
    ai.safe = { x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r };
    ai.safeFor = n;
    return ai.safe;
  },

  botRoamSpot(p, s) {
    const m = p.move;
    const base = s && s.next && s.next.r > 0 ? s.next : s || { x: m.x, z: m.z, r: 400 };
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(20, Math.max(40, Math.min(300, base.r * 0.7)));
      const x = (i < 3 ? m.x : base.x) + Math.cos(a) * r, z = (i < 3 ? m.z : base.z) + Math.sin(a) * r;
      if (this.world.terrain.heightAt(x, z) > 1.5 && (!s || !outsideStorm(base, x, z))) return { x, z };
    }
    return { x: base.x, z: base.z };
  },

  /* ---------------------------------------------------------------- loot */

  /** Nothing worth having nearby: walk to the nearest building not yet searched. */
  botPickBuilding(p, storm) {
    const ai = p.ai, m = p.move;
    if (ai.building && !ai.visited.has(ai.building)) {
      const c = ai.building;
      const centre = { x: (c.cx + c.w / 2) * CELL, z: (c.cz + c.d / 2) * CELL, y: c.lv * WALL_H + 0.5 };
      if (Math.hypot(centre.x - m.x, centre.z - m.z) < 5) ai.visited.add(c);
      else { ai.goal = this.botRouteTo(p, centre); return true; }
    }
    let best = null, bd = 450;
    const safe = storm && storm.next && storm.next.r > 0 ? storm.next : null;
    for (const b of this.base.buildings) {
      if (ai.visited.has(b)) continue;
      if (b.lv * WALL_H > m.y + 25 && p.mats[0] < 40) continue;     // up a mountain, with nothing to ramp with
      const x = (b.cx + b.w / 2) * CELL, z = (b.cz + b.d / 2) * CELL;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d >= bd) continue;
      if (safe && Math.hypot(x - safe.x, z - safe.z) > safe.r) continue;
      best = b; bd = d;
    }
    ai.building = best;
    if (!best) return false;
    ai.goal = this.botRouteTo(p, { x: (best.cx + best.w / 2) * CELL, z: (best.cz + best.d / 2) * CELL, y: best.lv * WALL_H + 0.5 });
    return true;
  },

  botWantsLoot(p) {
    const weapons = p.inv.filter((s) => s && isWeapon(s.key));
    const heals = p.inv.some((s) => s && isHeal(s.key));
    return weapons.length < 2 || !heals || p.inv.some((s) => !s) || weapons.some((w) => w.rarity < 2) || this.botAmmo(p) < 40;
  },

  /** Rounds available across every gun carried (in magazines and in reserve). */
  botAmmo(p) {
    let n = 0;
    const counted = new Set();
    for (const s of p.inv) {
      if (!s || !isWeapon(s.key)) continue;
      n += s.mag;
      const type = WEAPONS[s.key].ammo;
      if (!counted.has(type)) { counted.add(type); n += p.ammo[type] || 0; }
    }
    return n;
  },

  botUseful(p, it) {
    if (isAmmo(it.key)) return p.inv.some((s) => s && isWeapon(s.key) && WEAPONS[s.key].ammo === it.key) && (p.ammo[it.key] || 0) < 150;
    if (isMaterial(it.key)) return p.mats[['wood', 'stone', 'metal'].indexOf(it.key)] < 300;
    const free = p.inv.some((s) => !s);
    if (isHeal(it.key)) return free || p.inv.some((s) => s && s.key === it.key && s.count < HEALS[it.key].stack);
    const weapons = p.inv.filter((s) => s && isWeapon(s.key));
    if (weapons.some((w) => w.key === it.key && w.rarity >= it.rarity)) return false;
    if (free) return true;
    return weapons.some((w) => w.rarity < it.rarity);
  },

  botPickLoot(p) {
    const ai = p.ai, m = p.move;
    if (ai.loot && ai.loot.obj.alive && !(ai.loot.kind === 'chest' && ai.loot.obj.open) && this.tick - ai.lootSince < ai.lootPatience) return true;
    if (ai.loot) ai.blacklist.add(ai.loot.obj);
    ai.loot = null;
    let best = null, bestScore = Infinity;
    const here = this.buildingAt(m.x, m.z, m.y);
    for (const it of this.itemsNear(m.x, m.z, LOOT_RADIUS, scratch)) {
      if (ai.blacklist.has(it) || !this.botUseful(p, it)) continue;
      // Upstairs is fine if we are in that building and it has stairs up.
      if (it.y > m.y + 2.2 && !(here && here.stairs?.length && this.buildingAt(it.x, it.z, it.y) === here)) continue;
      const score = Math.hypot(it.x - m.x, it.z - m.z) + Math.abs(it.y - m.y) * 4 - (isWeapon(it.key) ? 8 + it.rarity * 4 : 0);
      if (score < bestScore) { bestScore = score; best = { kind: 'item', obj: it }; }
    }
    for (const c of this.chests.values()) {
      if (c.open || ai.blacklist.has(c) || c.y > m.y + 2.2) continue;
      const d = Math.hypot(c.x - m.x, c.z - m.z);
      if (d > LOOT_RADIUS) continue;
      const score = d + Math.abs(c.y - m.y) * 4 - 20;
      if (score < bestScore) { bestScore = score; best = { kind: 'chest', obj: c }; }
    }
    if (!best) return false;
    ai.loot = best;
    ai.lootSince = this.tick;
    ai.lootPatience = (15 + Math.hypot(best.obj.x - m.x, best.obj.z - m.z) / 4) * TICK_HZ;
    ai.goal = { x: best.obj.x, z: best.obj.z };
    return true;
  },

  botLootStep(p) {
    const ai = p.ai, m = p.move;
    const o = ai.loot?.obj;
    if (!o) return;
    const d = Math.hypot(o.x - m.x, o.z - m.z);
    // Standing on the roof over it: pickaxe down through the floor.
    if (d < 4 && o.y < m.y - 2.4) { ai.digUntil = this.tick + 20; return; }
    ai.goal = o.y > m.y + 2.2 ? this.botStairsTo(p, o) || this.botRouteTo(p, o) : this.botRouteTo(p, o);
    if (d < 3.0 && Math.abs(o.y - m.y) < 2.4) {
      if (ai.loot.kind === 'chest') this.onAction(p, { type: A_INTERACT, kind: INTERACT_CHEST, id: o.id });
      else {
        // A full inventory swaps with the held slot: hold the worst thing first.
        if (isWeapon(o.key) && !p.inv.some((s) => !s)) {
          let worst = -1, rarity = 99;
          p.inv.forEach((s, i) => { if (s && isWeapon(s.key) && s.rarity < rarity) { rarity = s.rarity; worst = i; } });
          if (worst >= 0 && p.held !== worst + 1) this.onAction(p, { type: A_SLOT, slot: worst + 1 });
        }
        this.onAction(p, { type: A_INTERACT, kind: INTERACT_ITEM, id: o.id });
      }
      ai.blacklist.add(o);
      ai.loot = null;
    }
  },

  /** Where to walk to reach something: straight there, or via the door if it is indoors. */
  botRouteTo(p, o) {
    const m = p.move;
    const b = this.buildingAt(o.x, o.z, o.y);
    if (!b || !b.door || this.buildingAt(m.x, m.z, m.y) === b) return { x: o.x, z: o.z };
    const door = b.door;
    const atDoor = Math.hypot(door.x - m.x, door.z - m.z) < 2.2 || Math.hypot(door.ix - m.x, door.iz - m.z) < 2.5;
    return atDoor ? { x: door.ix, z: door.iz } : { x: door.x, z: door.z };
  },

  /** Up the stairs of the building we are in: to the foot of the flight, then up it. */
  botStairsTo(p, o) {
    const m = p.move;
    const b = this.buildingAt(m.x, m.z, m.y);
    if (!b || !b.stairs) return null;
    const level = Math.round((m.y - 0.1) / WALL_H);
    const flight = b.stairs.find((f) => f.lv === level);
    if (!flight) return null;
    const atFoot = Math.hypot(flight.x0 - m.x, flight.z - m.z) < 1.3 || (m.x > flight.x0 && m.x < flight.x1 && Math.abs(m.z - flight.z) < 2);
    return atFoot ? { x: flight.x1, z: flight.z } : { x: flight.x0, z: flight.z };
  },

  /** The building footprint containing a point (cached by grid cell). */
  buildingAt(x, z, y) {
    if (!this.buildingIndex) {
      this.buildingIndex = new Map();
      for (const b of this.base.buildings) {
        for (let j = b.cz; j < b.cz + b.d; j++) for (let i = b.cx; i < b.cx + b.w; i++) this.buildingIndex.set(j * 1024 + i, b);
      }
    }
    const b = this.buildingIndex.get(Math.floor(z / CELL) * 1024 + Math.floor(x / CELL));
    if (!b || y < b.lv * WALL_H - 1.5 || y > (b.lv + b.floors) * WALL_H + 1) return null;
    return b;
  },

  botPickTree(p) {
    const ai = p.ai, m = p.move;
    if (ai.tree && ai.tree.alive && this.tick - ai.treeSince < 10 * TICK_HZ) return true;
    ai.tree = null;
    const found = this.world.grid.query(m.x - 22, m.y - 5, m.z - 22, m.x + 22, m.y + 5, m.z + 22, scratch);
    let best = null, bd = Infinity;
    for (const c of found) {
      if (c.kind !== OWNER_PROP) continue;
      const prop = this.world.props[c.ref];
      if (!prop || !prop.alive || !TREE_KINDS.has(PROP_KINDS[prop.kind].name)) continue;
      const d = Math.hypot(prop.x - m.x, prop.z - m.z);
      if (d < bd) { bd = d; best = prop; }
    }
    if (!best) return false;
    ai.tree = best;
    ai.treeSince = this.tick;
    ai.goal = { x: best.x, z: best.z };
    return true;
  },

  /* --------------------------------------------------------- fight / heal */

  botFightThink(p, enemy, d) {
    const ai = p.ai;
    // Pick the gun for the range.
    const order = d < 12 ? ['pump', 'tactical', 'smg', 'ar', 'burst', 'pistol', 'revolver', 'scoped', 'sniper', 'grenade', 'rocket']
      : d < 60 ? ['ar', 'burst', 'scoped', 'smg', 'revolver', 'pistol', 'grenade', 'rocket', 'pump', 'tactical', 'sniper']
        : ['sniper', 'scoped', 'ar', 'burst', 'rocket', 'revolver', 'pistol', 'smg', 'grenade', 'pump', 'tactical'];
    let want = -1;
    for (const key of order) {
      const i = p.inv.findIndex((s) => s && s.key === key && (s.mag > 0 || (p.ammo[WEAPONS[key].ammo] || 0) > 0));
      if (i >= 0) { want = i; break; }
    }
    if (want >= 0 && p.held !== want + 1) this.onAction(p, { type: A_SLOT, slot: want + 1 });
    const item = p.held > 0 ? p.inv[p.held - 1] : null;
    if (item && isWeapon(item.key) && item.mag === 0 && !p.reloadEnd) this.onAction(p, { type: A_RELOAD });
    // Being shot and in the open: wall up towards them.
    if (this.tick - (p.lastHurtTick || -1e9) < 25 && d > 7 && p.mats[0] >= 10 && this.tick - ai.lastWall > 50 && this.rng.chance(0.35 + 0.4 * ai.skill)) {
      ai.lastWall = this.tick;
      const yaw = Math.atan2(-(enemy.move.x - p.move.x), -(enemy.move.z - p.move.z));
      const piece = d < 30 && ai.skill > 0.6 && this.rng.chance(0.4) ? RAMP : WALL;
      const t = buildTarget(piece, p.move, yaw, 0, this.world, {});
      if (p.buildMat !== 0) this.onAction(p, { type: A_MAT, mat: 0 });
      p.yaw = yaw;
      p.botInput.yaw = yaw;
      this.onAction(p, { type: A_PLACE, piece, rot: t.rot, cx: t.cx, lv: t.lv, cz: t.cz });
    }
    if (this.tick >= ai.strafeFlip) { ai.strafe = this.rng.chance(0.5) ? 1 : -1; ai.strafeFlip = this.tick + this.rng.int(20, 60); }
    ai.goal = null;
  },

  botWantsHeal(p) {
    return (p.hp < 75 && p.inv.some((s) => s && (s.key === 'bandage' || s.key === 'medkit')))
      || (p.hp < 40 && p.inv.some((s) => s && s.key === 'medkit'))
      || (p.shield < 50 && p.inv.some((s) => s && s.key === 'shield'));
  },

  botHealThink(p) {
    if (p.using) return;
    let slot = -1;
    const find = (key) => p.inv.findIndex((s) => s && s.key === key);
    if (p.shield < 50 && find('shield') >= 0) slot = find('shield');
    else if (p.hp < 40 && find('medkit') >= 0) slot = find('medkit');
    else if (p.hp < 75 && find('bandage') >= 0) slot = find('bandage');
    else if (p.hp < MAX_HP && find('medkit') >= 0) slot = find('medkit');
    if (slot >= 0 && p.held !== slot + 1) this.onAction(p, { type: A_SLOT, slot: slot + 1 });
    p.ai.healSlot = slot;
  },

  botCrawl(p) {
    const mates = [...this.players.values()].filter((q) => q !== p && q.team === p.team && q.alive && !q.dbno);
    const mate = mates.sort((a, b) => Math.hypot(a.move.x - p.move.x, a.move.z - p.move.z) - Math.hypot(b.move.x - p.move.x, b.move.z - p.move.z))[0];
    p.ai.goal = mate ? { x: mate.move.x, z: mate.move.z } : null;
  },

  /* ------------------------------------------------------------ movement */

  /** Picks a heading towards the goal that is not straight into something. */
  botSteer(p) {
    const ai = p.ai, m = p.move;
    const g = ai.state === 'fight' && ai.enemy ? { x: ai.enemy.move.x, z: ai.enemy.move.z } : ai.state === 'harvest' && ai.tree ? { x: ai.tree.x, z: ai.tree.z } : ai.goal;
    if (!g) return;
    const want = Math.atan2(-(g.x - m.x), -(g.z - m.z));
    if (this.tick < ai.breakUntil || this.tick < (ai.climbUntil || 0)) { ai.steer = want; return; }
    let terrainOnly = true;
    const onGround = m.y - this.world.terrain.heightAt(m.x, m.z) < 1.5;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5]) {
      const yaw = want + off;
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      const knee = this.world.grid.raycast(m.x, m.y + 0.6, m.z, dx, 0, dz, 2.2, hit, null, false);
      const chest = knee === Infinity ? this.world.grid.raycast(m.x, m.y + 1.4, m.z, dx, 0, dz, 2.2, hit, null, false) : 0;
      if (knee !== Infinity || chest !== Infinity) terrainOnly = false;
      const ahead = this.world.terrain.heightAt(m.x + dx * 4, m.z + dz * 4);
      const shore = ahead < -1;
      // Never walk off a cliff: a drop of two walls or more ahead is a wall.
      const cliff = onGround && m.y - ahead > 7;
      // Nor up a slope too steep to walk.
      const steep = onGround && ahead > m.y + 1 && this.world.terrain.sample(m.x + dx * 3, m.z + dz * 3, tsample).ny < 0.7;
      if (knee === Infinity && chest === Infinity && !shore && !cliff && !steep) { ai.steer = yaw; return; }
    }
    ai.steer = want;
    if (terrainOnly && onGround) {
      // A hillside in the way: ramp up it if there is wood, otherwise go round.
      if (p.mats[0] >= 20) ai.climbUntil = this.tick + 75;
      else ai.goal = { x: m.x + Math.cos(want) * 60, z: m.z - Math.sin(want) * 60 };
      return;
    }
    ai.breakUntil = this.tick + 40;     // boxed in by something built: chop through
  },

  botStuck(p) {
    const ai = p.ai, m = p.move;
    if (this.tick < ai.stuckCheck) return;
    ai.stuckCheck = this.tick + TICK_HZ;
    const moved = Math.hypot(m.x - ai.lastPos.x, m.z - ai.lastPos.z);
    ai.lastPos.x = m.x; ai.lastPos.z = m.z;
    const moving = ['loot', 'rotate', 'roam', 'harvest', 'search', 'flee', 'revive', 'crawl', 'brawl'].includes(ai.state);
    if (!moving || moved > 1.2) { ai.stuck = 0; return; }
    ai.stuck++;
    // Stuck on the way to a building for a while: it is not reachable from here.
    if (ai.stuck >= 3 && ai.state === 'search' && ai.building) { ai.visited.add(ai.building); ai.building = null; }
    if (ai.stuck === 1) ai.jumpAt = this.tick;
    else if (ai.stuck < 5) ai.breakUntil = this.tick + 45;
    else {
      ai.stuck = 0;
      if (ai.loot) { ai.blacklist.add(ai.loot.obj); ai.loot = null; }
      const a = this.rng.range(0, Math.PI * 2);
      ai.goal = { x: m.x + Math.cos(a) * 25, z: m.z + Math.sin(a) * 25 };
    }
  },

  /** Turns intent into this tick's input: stick, aim, buttons. */
  botControl(p) {
    const ai = p.ai, m = p.move, inp = p.botInput;
    inp.buttons = 0; inp.mx = 0; inp.mz = 0;
    if (m.mode === MODE_BUS) return;
    if (m.mode === MODE_SKYDIVE || m.mode === MODE_GLIDE) {
      const g = ai.drop || ai.goal;
      if (!g) return;
      const dx = g.x - m.x, dz = g.z - m.z, d = Math.hypot(dx, dz);
      inp.yaw = Math.atan2(-dx, -dz);
      const agl = m.y - this.world.terrain.heightAt(m.x, m.z);
      if (m.mode === MODE_SKYDIVE) { inp.mz = d > 25 ? 1 : 0; inp.pitch = d > agl * 1.6 ? 0.3 : -1.3; }
      else { inp.mz = d > 12 ? 1 : 0; inp.pitch = 0; }
      if (d < 40 && m.mode === MODE_GLIDE) ai.goal = null;
      return;
    }
    const sprint = BTN_SPRINT;
    switch (ai.state) {
      case 'fight': {
        const e = ai.enemy;
        if (!e || !e.alive) break;
        const dx = e.move.x - m.x, dz = e.move.z - m.z, d = Math.hypot(dx, dz);
        const dy = e.move.y + (e.move.crouch ? 0.8 : 1.15) - (m.y + 1.6);
        // Aim error drifts and shrinks the longer the bot tracks the same target.
        ai.err = Math.max(0.012 * (1.3 - ai.skill), ai.err * 0.965);
        ai.errYaw += (this.rng.next() - 0.5) * ai.err * 0.6; ai.errYaw *= 0.9;
        ai.errPitch += (this.rng.next() - 0.5) * ai.err * 0.3; ai.errPitch *= 0.9;
        inp.yaw = Math.atan2(-dx, -dz) + ai.errYaw;
        inp.pitch = Math.atan2(dy, d) + ai.errPitch;
        const item = p.held > 0 ? p.inv[p.held - 1] : null;
        const def = item && WEAPONS[item.key];
        const pref = !def ? 3 : def.pellets ? 5 : def.cls === 'sniper' ? 80 : def.cls === 'smg' || def.cls === 'pistol' ? 15 : 25;
        inp.mz = d > pref * 1.4 ? 1 : d < pref * 0.5 ? -1 : 0;
        inp.mx = ai.strafe;
        if (inp.mz > 0 && d > 30) inp.buttons |= sprint;
        const range = !def ? 0 : def.pellets ? 16 : def.cls === 'sniper' || def.cls === 'scoped' ? 250 : def.cls === 'smg' || def.cls === 'pistol' ? 40 : def.projectile ? 70 : 75;
        if (this.tick - ai.enemySeen < 12 && def && item.mag > 0 && d < range && Math.abs(ai.errYaw) < 0.12) {
          if (def.auto) inp.buttons |= BTN_FIRE;
          else if (++ai.semi % 3 === 0) inp.buttons |= BTN_FIRE;
          if (def.scope && d > 40) inp.buttons |= BTN_ADS;
        } else if (!def && d < 3) inp.buttons |= BTN_FIRE;
        if (this.rng.chance(0.012)) inp.buttons |= BTN_JUMP;
        return;
      }
      case 'brawl': {
        // Nothing to shoot with: close in and swing.
        const e = ai.enemy;
        if (!e || !e.alive) break;
        const dx = e.move.x - m.x, dz = e.move.z - m.z, d = Math.hypot(dx, dz);
        if (p.held !== 0) this.onAction(p, { type: A_SLOT, slot: 0 });
        inp.yaw = Math.atan2(-dx, -dz) + 0.1;
        inp.pitch = Math.atan2(e.move.y + 1 - (m.y + 1.6), d);
        inp.mz = d > 1.6 ? 1 : 0;
        inp.mx = ai.strafe * 0.5;
        if (d < 2.8) inp.buttons |= BTN_FIRE;
        return;
      }
      case 'revive':
        if (p.reviving) { inp.buttons |= BTN_USE; inp.yaw = p.yaw; return; }
        break;
      case 'heal':
        if (ai.healSlot >= 0 && p.held === ai.healSlot + 1 && !p.using && this.tick >= p.equipUntil) inp.buttons |= BTN_FIRE;
        inp.yaw = p.yaw;
        return;
      default:
    }
    // Digging down through a roof to loot underneath.
    if (this.tick < (ai.digUntil || 0)) {
      if (p.held !== 0) this.onAction(p, { type: A_SLOT, slot: 0 });
      inp.yaw = p.yaw; inp.pitch = -1.45; inp.buttons |= BTN_FIRE;
      return;
    }
    // Ramping up a hillside: run at it, dropping a ramp ahead every half second.
    if (this.tick < (ai.climbUntil || 0)) {
      inp.yaw = ai.steer; inp.pitch = -0.2; inp.mz = 1;
      if ((this.tick - ai.think) % 15 === 0 && p.mats[0] >= 10) {
        const t = buildTarget(RAMP, m, ai.steer, -0.2, this.world, {});
        if (p.buildMat !== 0) this.onAction(p, { type: A_MAT, mat: 0 });
        this.onAction(p, { type: A_PLACE, piece: RAMP, rot: t.rot, cx: t.cx, lv: t.lv, cz: t.cz });
      }
      return;
    }
    // Chopping through whatever is in the way.
    if (this.tick < ai.breakUntil) {
      if (p.held !== 0) this.onAction(p, { type: A_SLOT, slot: 0 });
      inp.yaw = ai.steer; inp.pitch = -0.1; inp.buttons |= BTN_FIRE; inp.mz = 0.4;
      // Brick and metal take a while: keep going while it is still in the way (up to 6 s).
      if (this.tick + 1 >= ai.breakUntil && (ai.breakTotal = (ai.breakTotal || 0) + 1) < 5) {
        const dx = -Math.sin(ai.steer), dz = -Math.cos(ai.steer);
        if (this.world.grid.raycast(m.x, m.y + 1.2, m.z, dx, 0, dz, 2.4, hit, null, false) < Infinity) ai.breakUntil = this.tick + 36;
      }
      return;
    }
    ai.breakTotal = 0;
    // Chopping a tree for wood.
    if (ai.state === 'harvest' && ai.tree) {
      const t = ai.tree;
      const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz);
      if (d > 2.2) { inp.mz = 1; inp.yaw = ai.steer; inp.pitch = -0.1; return; }
      inp.yaw = Math.atan2(-dx, -dz) + 0.12;       // the swing lands a little right of centre
      inp.pitch = -0.05;
      if (p.held !== 0) this.onAction(p, { type: A_SLOT, slot: 0 });
      inp.buttons |= BTN_FIRE;
      return;
    }
    // Walking somewhere.
    const g = ai.goal;
    if (!g) return;
    const d = Math.hypot(g.x - m.x, g.z - m.z);
    inp.yaw = ai.steer;
    inp.pitch = -0.1;
    inp.mz = d > 1.2 ? 1 : 0;
    if (d > 12) inp.buttons |= sprint;
    if (ai.jumpAt === this.tick || ai.jumpAt === this.tick - 1) inp.buttons |= BTN_JUMP;
  },
};

export { WALL_H };

// Guns, healing and explosives on the server. Hitscan shots are traced from
// the shooter's eye towards what their crosshair was on, against other players
// rewound to where that shooter saw them (lag compensation), and against the
// world as it is now. Rockets and grenades are simulated projectiles.

import { WEAPONS, HEALS, AMMO, weaponDamage, falloff, isWeapon, isHeal, itemId } from '../shared/items.js';
import { spreadFor, shotDirection, pelletDirection, ticksPerShot } from '../shared/weapons.js';
import { aimFrame } from '../shared/aim.js';
import { BTN_FIRE, BTN_ADS, MODE_WALK, MODE_DEAD, MODE_BUS, MODE_DBNO, capsuleHeight } from '../shared/movement.js';
import { rayCapsule, raySphere, OWNER_PIECE } from '../shared/collision.js';
import { pieceCenter } from '../shared/pieces.js';
import { propCenter } from '../shared/props.js';
import { TICK_HZ, DT, MAX_HP, MAX_SHIELD, INVENTORY_SLOTS } from '../shared/constants.js';
import { EV_SHOT, EV_IMPACT, EV_EXPLOSION, EV_HEAL, EV_RELOAD } from '../shared/events.js';
import { positionAt } from './player.js';
import { B_PROJECTILES } from '../shared/protocol.js';

export const EQUIP_TICKS = Math.round(0.2 * TICK_HZ);
export const MAX_REWIND_TICKS = 9;          // ~300 ms: past that, the shooter lags too much to trust
export const BLOOM_SETTLE_TICKS = Math.round(0.25 * TICK_HZ);
const HEAD_R = 0.26;
const BODY_R = 0.4;

const frame = {};
const hit = {};
const dir = {};
const pos = {};
const c = {};

export const combatMethods = {
  heldItem(p) { return p.held > 0 ? p.inv[p.held - 1] : null; },

  /* ------------------------------------------------------------ fire */

  stageFire() {
    this.mark('fire');
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const item = this.heldItem(p);
      const key = item && item.key;
      // Bloom only settles once you stop shooting: sustained fire keeps opening it.
      if (key && isWeapon(key)) { if (this.tick - p.lastShotTick > BLOOM_SETTLE_TICKS) p.bloom = Math.max(0, p.bloom - WEAPONS[key].bloom.recover * DT); }
      else p.bloom = 0;
      this.progressReload(p);
      this.progressUse(p);
      if (p.held === 0) this.swingPickaxe(p);
      else if (key && isWeapon(key)) this.tryFire(p, item);
      else if (key && isHeal(key)) this.tryUse(p, item);
      p.fireLatch = (p.buttons & BTN_FIRE) !== 0;
    }
    this.stepProjectiles();
  },

  canAct(p) {
    return p.alive && !p.dbno && !p.buildMode && p.move.mode === MODE_WALK && this.tick >= (p.equipUntil || 0);
  },

  tryFire(p, item) {
    const def = WEAPONS[item.key];
    const down = (p.buttons & BTN_FIRE) !== 0;
    // A burst in progress keeps going by itself.
    if (p.burstLeft > 0 && this.tick >= p.nextBurst && p.burstSlot === p.held) {
      if (item.mag > 0) { this.shoot(p, item); p.burstLeft--; p.nextBurst = this.tick + def.burstGap; }
      else p.burstLeft = 0;
      return;
    }
    if (!down || !this.canAct(p) || p.reloadEnd || p.using) return;
    if (!def.auto && p.fireLatch) return;               // semi-automatic: one shot per click
    if (item.mag <= 0) { this.startReload(p); return; }  // a dry click reloads
    if (this.tick < p.nextShot) return;
    this.shoot(p, item);
    p.nextShot = this.tick + ticksPerShot(item.key, TICK_HZ);
    if (def.burst) { p.burstLeft = def.burst - 1; p.nextBurst = this.tick + def.burstGap; p.burstSlot = p.held; }
  },

  shoot(p, item) {
    const def = WEAPONS[item.key];
    item.mag--;
    p.lastShotTick = this.tick;
    p.invDirty = true;
    p.shots = (p.shots || 0) + 1;
    const ads = (p.buttons & BTN_ADS) !== 0;
    const spread = spreadFor(item.key, p.bloom, p.move, ads);
    p.bloom = Math.min(def.bloom.max, p.bloom + def.bloom.shot);
    const f = aimFrame(p.move, p.yaw, p.pitch, ads, frame);
    // Aim at whatever the crosshair is on, then fire from the eye towards it.
    const target = this.aimTarget(p, f, def.range);
    let tx = target.x - f.ex, ty = target.y - f.ey, tz = target.z - f.ez;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    const base = { x: tx / tl, y: ty / tl, z: tz / tl };
    if (def.projectile) { this.launch(p, item, shotDirection(base, spread, p.id, p.shots, 0, dir), f); return; }
    const pellets = def.pellets || 1;
    const perPellet = weaponDamage(item.key, item.rarity) / pellets;
    for (let k = 0; k < pellets; k++) {
      const d = pellets > 1 ? pelletDirection(base, def.spread + spread, p.id, p.shots, k, pellets, dir) : shotDirection(base, spread, p.id, p.shots, 0, dir);
      this.traceShot(p, item, f, d, perPellet, def);
    }
  },

  /** The point under the crosshair: nearest of the world and (rewound) players. */
  aimTarget(p, f, range) {
    const d = f.dir;
    const worldT = this.world.grid.raycast(f.ox, f.oy, f.oz, d.x, d.y, d.z, range, hit);
    const victim = this.rayPlayers(f.ox, f.oy, f.oz, d.x, d.y, d.z, Math.min(worldT, range), p);
    const t = victim ? victim.t : worldT < Infinity ? worldT : range;
    return { x: f.ox + d.x * t, y: f.oy + d.y * t, z: f.oz + d.z * t };
  },

  traceShot(p, item, f, d, damage, def) {
    const range = def.range;
    const worldT = this.world.grid.raycast(f.ex, f.ey, f.ez, d.x, d.y, d.z, range, hit);
    const victim = this.rayPlayers(f.ex, f.ey, f.ez, d.x, d.y, d.z, Math.min(worldT, range), p);
    if (victim) {
      const mult = falloff(item.key, victim.t) * (victim.head ? def.head : 1);
      if (mult > 0) this.hitPlayer(p, victim.player, damage * mult, { kind: 'gun', weapon: item.key, head: victim.head, point: victim.point });
      this.event(EV_SHOT, victim.point.x, victim.point.y, victim.point.z, p.id, itemId(item.key), 1);
      return;
    }
    const t = worldT < Infinity ? worldT : range;
    const ex = f.ex + d.x * t, ey = f.ey + d.y * t, ez = f.ez + d.z * t;
    this.event(EV_SHOT, ex, ey, ez, p.id, itemId(item.key), 0);
    if (worldT === Infinity) return;
    const owner = this.world.ownerOf(hit.collider);
    if (owner && owner.alive) {
      const kind = hit.collider.kind === OWNER_PIECE ? 'piece' : 'prop';
      const mult = falloff(item.key, t);
      this.damageStructure(owner, kind, damage * def.structure * Math.max(mult, 0.35), { source: p, harvest: false });
      this.event(EV_IMPACT, ex, ey, ez, p.id, this.materialOf(owner, kind));
    } else this.event(EV_IMPACT, ex, ey, ez, p.id, 3);
  },

  /**
   * Nearest player along a ray, using where they were at the shooter's view
   * time (rewound up to ~300 ms) — so what you hit is what you saw.
   */
  rayPlayers(ox, oy, oz, dx, dy, dz, maxT, shooter) {
    let best = null;
    const rewind = shooter && !shooter.bot && shooter.viewTick > 0
      ? Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, shooter.viewTick)) : this.tick;
    for (const q of this.players.values()) {
      if (q === shooter || !q.alive || q.move.mode === MODE_DEAD || q.move.mode === MODE_BUS) continue;
      if (shooter && this.friendly(shooter, q)) continue;
      const at = rewind < this.tick ? (positionAt(q, rewind, pos), pos) : q.move;
      const h = capsuleHeight(q.move);
      const dbno = q.move.mode === MODE_DBNO;
      // Cheap reject: distance from the ray to the player's centre.
      const cx = at.x - ox, cy = at.y + h / 2 - oy, cz = at.z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < -1 || along > maxT + 1) continue;
      const px = cx - dx * along, py = cy - dy * along, pz = cz - dz * along;
      if (px * px + py * py + pz * pz > (h / 2 + 0.6) ** 2) continue;
      const headY = at.y + h - HEAD_R - 0.02;
      const tHead = dbno ? Infinity : raySphere(ox, oy, oz, dx, dy, dz, at.x, headY, at.z, HEAD_R);
      const tBody = rayCapsule(ox, oy, oz, dx, dy, dz, at.x, at.y + BODY_R, Math.max(at.y + BODY_R, headY - HEAD_R - 0.05), at.z, BODY_R);
      const t = Math.min(tHead, tBody);
      if (t > maxT || t === Infinity) continue;
      if (!best || t < best.t) {
        best = {
          player: q, t, head: tHead <= tBody, point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
          dist(fr) { const ex = this.point.x - fr.ex, ey = this.point.y - fr.ey, ez = this.point.z - fr.ez; return Math.sqrt(ex * ex + ey * ey + ez * ez); },
        };
      }
    }
    return best;
  },

  friendly(a, b) { return a !== b && a.team === b.team && this.mode !== 'sandbox'; },

  hitPlayer(source, victim, amount, info) {
    this.damage(victim, amount, { source, ...info });
  },

  /* ---------------------------------------------------------- reload */

  startReload(p) {
    const item = this.heldItem(p);
    if (!item || !isWeapon(item.key) || p.reloadEnd || p.using) return false;
    const def = WEAPONS[item.key];
    if (item.mag >= def.mag || (p.ammo[def.ammo] || 0) <= 0) return false;
    p.reloadEnd = this.tick + Math.round(def.reload * TICK_HZ);
    p.reloadStart = this.tick;
    p.reloadSlot = p.held;
    p.burstLeft = 0;
    this.event(EV_RELOAD, p.move.x, p.move.y + 1, p.move.z, p.id);
    p.invDirty = true;
    return true;
  },

  progressReload(p) {
    if (!p.reloadEnd) return;
    if (p.held !== p.reloadSlot || !p.alive) { p.reloadEnd = 0; p.invDirty = true; return; }
    if (this.tick < p.reloadEnd) return;
    const item = this.heldItem(p);
    const def = WEAPONS[item.key];
    const take = Math.min(def.mag - item.mag, p.ammo[def.ammo] || 0);
    item.mag += take;
    p.ammo[def.ammo] -= take;
    p.reloadEnd = 0;
    p.invDirty = true;
  },

  /* --------------------------------------------------------- healing */

  tryUse(p, item) {
    const down = (p.buttons & BTN_FIRE) !== 0;
    if (!down || p.fireLatch || p.using || !this.canAct(p)) return;
    const def = HEALS[item.key];
    if (def.hp && p.hp >= def.cap) { p.conn?.sendJson({ t: 'note', text: def.cap < MAX_HP ? `Bandages only heal to ${def.cap}` : 'Already at full health' }); return; }
    if (def.shield && p.shield >= MAX_SHIELD) { p.conn?.sendJson({ t: 'note', text: 'Shield is full' }); return; }
    p.using = { slot: p.held, key: item.key, start: this.tick, end: this.tick + Math.round(def.use * TICK_HZ) };
    p.invDirty = true;
  },

  progressUse(p) {
    const u = p.using;
    if (!u) return;
    if (p.held !== u.slot || !p.alive || p.dbno || p.buildMode) { p.using = null; p.invDirty = true; return; }
    if (this.tick < u.end) return;
    const item = this.heldItem(p);
    const def = HEALS[u.key];
    if (def.hp) p.hp = Math.max(p.hp, Math.min(def.cap, p.hp + def.hp));
    if (def.shield) p.shield = Math.min(MAX_SHIELD, p.shield + def.shield);
    item.count--;
    if (item.count <= 0) p.inv[p.held - 1] = null;
    p.using = null;
    p.invDirty = true;
    p.healed = (p.healed || 0) + 1;
    this.event(EV_HEAL, p.move.x, p.move.y + 1, p.move.z, p.id, def.shield ? 1 : 0);
  },

  /* ------------------------------------------------------ projectiles */

  launch(p, item, d, f) {
    const def = WEAPONS[item.key];
    const pr = def.projectile;
    this.projectiles.push({
      id: (this.nextProjectile = (this.nextProjectile || 0) + 1) & 0xffff, key: item.key, rarity: item.rarity, owner: p,
      x: f.ex + d.x * 0.8, y: f.ey + d.y * 0.8 - 0.1, z: f.ez + d.z * 0.8,
      vx: d.x * pr.speed, vy: d.y * pr.speed, vz: d.z * pr.speed, until: this.tick + Math.round(pr.fuse * TICK_HZ),
    });
    this.event(EV_SHOT, f.ex + d.x * 2, f.ey + d.y * 2, f.ez + d.z * 2, p.id, itemId(item.key), 0);
  },

  stepProjectiles() {
    if (!this.projectiles.length) return;
    const keep = [];
    for (const pr of this.projectiles) {
      const def = WEAPONS[pr.key].projectile;
      pr.vy -= def.gravity * DT;
      let remaining = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz) * DT;
      let exploded = false;
      for (let bounces = 0; bounces < 3 && remaining > 1e-4 && !exploded; bounces++) {
        const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz) || 1;
        const dx = pr.vx / sp, dy = pr.vy / sp, dz = pr.vz / sp;
        const worldT = this.world.grid.raycast(pr.x, pr.y, pr.z, dx, dy, dz, remaining, hit);
        const victim = this.rayPlayers(pr.x, pr.y, pr.z, dx, dy, dz, Math.min(worldT, remaining), pr.owner);
        if (victim) { pr.x = victim.point.x; pr.y = victim.point.y; pr.z = victim.point.z; exploded = true; break; }
        if (worldT === Infinity) { pr.x += dx * remaining; pr.y += dy * remaining; pr.z += dz * remaining; remaining = 0; break; }
        pr.x += dx * (worldT - 0.05); pr.y += dy * (worldT - 0.05); pr.z += dz * (worldT - 0.05);
        if (!def.bounce) { exploded = true; break; }
        // Grenades bounce off whatever they hit and lose most of their speed.
        const vn = pr.vx * hit.nx + pr.vy * hit.ny + pr.vz * hit.nz;
        pr.vx = (pr.vx - 2 * vn * hit.nx) * 0.45; pr.vy = (pr.vy - 2 * vn * hit.ny) * 0.45; pr.vz = (pr.vz - 2 * vn * hit.nz) * 0.45;
        remaining -= worldT;
      }
      if (exploded || this.tick >= pr.until) this.explode(pr);
      else keep.push(pr);
    }
    this.projectiles = keep;
  },

  explode(pr) {
    const def = WEAPONS[pr.key];
    const r = def.projectile.radius;
    const dmg = weaponDamage(pr.key, pr.rarity);
    this.event(EV_EXPLOSION, pr.x, pr.y, pr.z, pr.owner.id, Math.round(r));
    for (const q of this.players.values()) {
      if (!q.alive || q.move.mode === MODE_DEAD || q.move.mode === MODE_BUS || q === pr.owner || this.friendly(pr.owner, q)) continue;
      const cx = q.move.x, cy = q.move.y + 1, cz = q.move.z;
      const dx = cx - pr.x, dy = cy - pr.y, dz = cz - pr.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r + 0.5) continue;
      // Walls in between soak the blast.
      if (d > 0.3 && this.world.grid.raycast(pr.x, pr.y, pr.z, dx, dy, dz, d - 0.3, hit) < d - 0.3) continue;
      this.hitPlayer(pr.owner, q, dmg * (1 - 0.7 * Math.min(1, d / (r + 0.5))), { kind: 'explosion', weapon: pr.key, head: false, point: { x: cx, y: cy, z: cz } });
    }
    // Explosives are built for knocking down builds.
    const reach = r + 1.5;
    const found = this.world.grid.query(pr.x - reach, pr.y - reach, pr.z - reach, pr.x + reach, pr.y + reach, pr.z + reach, []);
    const done = new Set();
    for (const col of found) {
      const owner = this.world.ownerOf(col);
      if (!owner || !owner.alive || done.has(owner)) continue;
      done.add(owner);
      const kind = col.kind === OWNER_PIECE ? 'piece' : 'prop';
      if (kind === 'piece') pieceCenter(owner, c); else propCenter(owner, c);
      const d = Math.sqrt((c.x - pr.x) ** 2 + (c.y - pr.y) ** 2 + (c.z - pr.z) ** 2);
      if (d > reach + 1.5) continue;
      this.damageStructure(owner, kind, dmg * def.structure * (1 - 0.5 * Math.min(1, d / (reach + 1.5))), { source: pr.owner, harvest: false });
    }
  },

  writeProjectiles(w, focus) {
    const near = [];
    for (const pr of this.projectiles) {
      const dx = pr.x - focus.x, dz = pr.z - focus.z;
      if (dx * dx + dz * dz < 500 * 500) near.push(pr);
    }
    if (!near.length) return;
    w.u8(B_PROJECTILES).u16(near.length);
    for (const pr of near) w.u16(pr.id).u8(itemId(pr.key)).f32(pr.x).f32(pr.y).f32(pr.z);
  },

  /* ------------------------------------------------------- inventory */

  /** Puts an item in the first free slot; returns the slot index or -1. */
  giveItem(p, item) {
    if (isHeal(item.key)) {
      for (let i = 0; i < INVENTORY_SLOTS; i++) {
        const s = p.inv[i];
        if (s && s.key === item.key && s.count < HEALS[item.key].stack) {
          const add = Math.min(item.count, HEALS[item.key].stack - s.count);
          s.count += add; item.count -= add;
          p.invDirty = true;
          if (item.count <= 0) return i;
        }
      }
    }
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!p.inv[i]) {
        p.inv[i] = isWeapon(item.key) ? { key: item.key, rarity: item.rarity ?? WEAPONS[item.key].tiers[0], mag: item.mag ?? WEAPONS[item.key].mag } : { key: item.key, count: item.count || 1, rarity: HEALS[item.key]?.rarity ?? 0 };
        p.invDirty = true;
        return i;
      }
    }
    return -1;
  },

  giveAmmo(p, type, amount) {
    const before = p.ammo[type] || 0;
    p.ammo[type] = Math.min(AMMO[type].cap, before + amount);
    if (p.ammo[type] !== before) p.invDirty = true;
    return p.ammo[type] - before;
  },
};

export { MAX_HP };

// The pickaxe. One swing every half second; it chops whatever the crosshair is
// on within arm's reach. Each hit on something harvestable moves a weak-point
// marker to a new spot on it — hit the marker and the swing does double damage,
// which strips the object twice as fast.

import { aimFrame } from '../shared/aim.js';
import { BTN_FIRE, MODE_WALK } from '../shared/movement.js';
import { EV_HARVEST, EV_SWING, EV_IMPACT } from '../shared/events.js';
import { OWNER_PIECE } from '../shared/collision.js';
import { TICK_HZ } from '../shared/constants.js';

export const SWING_TICKS = Math.round(0.5 * TICK_HZ);
export const PICK_REACH = 3.0;          // metres from the eye
export const PICK_DAMAGE = 50;          // to props and structures
export const PICK_PLAYER_DAMAGE = 20;
export const WEAK_RADIUS = 0.45;
const WEAK_TTL = 6 * TICK_HZ;

const frame = {};
const hit = {};
const probe = {};

export const harvestMethods = {
  swingPickaxe(p) {
    if (!p.alive || p.held !== 0 || p.move.mode !== MODE_WALK || p.buildMode || p.using) return;
    if (!(p.buttons & BTN_FIRE) || this.tick < p.nextSwing) return;
    p.nextSwing = this.tick + SWING_TICKS;
    p.swingTick = this.tick;
    const f = aimFrame(p.move, p.yaw, p.pitch, false, frame);
    const d = f.dir;
    this.event(EV_SWING, f.ex, f.ey, f.ez, p.id);

    const worldT = this.world.grid.raycast(f.ox, f.oy, f.oz, d.x, d.y, d.z, PICK_REACH + 2, hit);
    // A player in the way takes the hit instead.
    const victim = this.rayPlayers?.(f.ox, f.oy, f.oz, d.x, d.y, d.z, Math.min(worldT, PICK_REACH + 2), p);
    if (victim && victim.dist(f) <= PICK_REACH) {
      this.hitPlayer?.(p, victim.player, PICK_PLAYER_DAMAGE, { kind: 'pickaxe', head: false, point: victim.point });
      return;
    }
    if (worldT === Infinity) return;
    const dx = hit.x - f.ex, dy = hit.y - f.ey, dz = hit.z - f.ez;
    if (dx * dx + dy * dy + dz * dz > PICK_REACH * PICK_REACH) return;
    if (!hit.collider) { this.event(EV_IMPACT, hit.x, hit.y, hit.z, p.id, 3); return; }

    const owner = this.world.ownerOf(hit.collider);
    if (!owner || !owner.alive) return;
    const kind = hit.collider.kind === OWNER_PIECE ? 'piece' : 'prop';
    const w = p.weak;
    const onWeak = !!(w && w.target === owner && this.tick - w.tick < WEAK_TTL
      && (hit.x - w.x) ** 2 + (hit.y - w.y) ** 2 + (hit.z - w.z) ** 2 <= WEAK_RADIUS * WEAK_RADIUS);
    const harvest = this.harvestable(owner, kind);
    this.damageStructure(owner, kind, onWeak ? PICK_DAMAGE * 2 : PICK_DAMAGE, { source: p, harvest, weak: onWeak, kind2: 'pickaxe' });
    this.event(EV_HARVEST, hit.x, hit.y, hit.z, p.id, this.materialOf(owner, kind), onWeak ? 1 : 0);
    p.weakHits = (p.weakHits || 0) + (onWeak ? 1 : 0);
    if (harvest) this.moveWeakPoint(p, owner, kind, f);
    else if (p.weak) { p.weak = null; p.conn?.sendJson({ t: 'weak' }); }
  },

  /** Picks a fresh spot on the object's face near where it was struck. */
  moveWeakPoint(p, owner, kind, f) {
    const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = this.rng.range(-0.85, 0.85), b = this.rng.range(-0.6, 0.6);
      const tx = hit.x + right.x * a, ty = hit.y + b, tz = hit.z + right.z * a;
      let dx = tx - f.ox, dy = ty - f.oy, dz = tz - f.oz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= len; dy /= len; dz /= len;
      const t = this.world.grid.raycast(f.ox, f.oy, f.oz, dx, dy, dz, PICK_REACH + 3, probe);
      if (t === Infinity || !probe.collider || this.world.ownerOf(probe.collider) !== owner) continue;
      if (Math.abs(a) < 0.25 && Math.abs(b) < 0.2) continue;   // make it actually move
      p.weak = { target: owner, x: probe.x, y: probe.y, z: probe.z, tick: this.tick, nx: probe.nx, ny: probe.ny, nz: probe.nz };
      p.conn?.sendJson({ t: 'weak', x: probe.x, y: probe.y, z: probe.z, nx: probe.nx, ny: probe.ny, nz: probe.nz });
      return;
    }
    p.weak = null;
    p.conn?.sendJson({ t: 'weak' });
  },
};


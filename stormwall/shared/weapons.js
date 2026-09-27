// How a gun fires, shared by the server (which decides what is hit) and the
// client (which draws its own tracers straight away). The spread of a shot is
// drawn from a hash of who fired and which shot it was, so both sides pick the
// same random direction without talking about it.

import { WEAPONS } from './items.js';
import { hash01 } from './rng.js';
import { MODE_WALK } from './movement.js';

const DEG = Math.PI / 180;

/**
 * Current spread half-angle in degrees. Standing still with a settled
 * crosshair gives the weapon's minimum — zero for rifles — so a patient first
 * shot goes exactly where you aim. Moving, jumping and firing open it up;
 * aiming down sights and crouching tighten it.
 */
export function spreadFor(key, bloom, move, ads) {
  const b = WEAPONS[key].bloom;
  const speed = Math.sqrt(move.vx * move.vx + move.vz * move.vz);
  let s = b.min + bloom;
  if (move.mode !== MODE_WALK || !move.ground) s += b.air;
  else if (speed > 0.3) s += b.move * Math.min(1.5, speed / 4.5);
  if (!ads && b.hip) s += b.hip;
  if (ads) s *= 0.55;
  if (move.crouch) s *= 0.75;
  return Math.min(s, b.max + b.air);
}

/** A shot direction: `dir` turned by up to `spread` degrees, the same on server and client. */
export function shotDirection(dir, spreadDeg, shooter, shot, pellet, out = {}) {
  let dx = dir.x, dy = dir.y, dz = dir.z;
  if (spreadDeg > 0) {
    const r = Math.tan(spreadDeg * DEG) * Math.sqrt(hash01(shooter, shot, pellet * 2 + 1));
    const a = hash01(shooter, shot, pellet * 2 + 2) * Math.PI * 2;
    // Two axes perpendicular to the shot.
    let ux = -dz, uz = dx, uy = 0;
    let ul = Math.sqrt(ux * ux + uz * uz);
    if (ul < 1e-6) { ux = 1; uz = 0; ul = 1; }
    ux /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    dx += ux * ca + vx * sa; dy += uy * ca + vy * sa; dz += uz * ca + vz * sa;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l; dy /= l; dz /= l;
  }
  out.x = dx; out.y = dy; out.z = dz;
  return out;
}

/** Pellets as a fixed pattern (shotguns): spread evenly round the cone, jittered by the hash. */
export function pelletDirection(dir, coneDeg, shooter, shot, pellet, pellets, out = {}) {
  if (pellet === 0) return shotDirection(dir, coneDeg * 0.15, shooter, shot, 0, out);
  const ring = pellet / pellets;
  const spread = coneDeg * (0.45 + 0.55 * ring * hash01(shooter, shot, pellet + 100));
  return shotDirection(dir, spread, shooter, shot, pellet, out);
}

export const ticksPerShot = (key, hz) => Math.max(1, Math.round(hz / WEAPONS[key].rate));

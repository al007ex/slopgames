// Static collision: everything a player can stand on or be stopped by, apart from
// the terrain (which is its own heightfield) and other players (which move).
// Shapes are described by signed distance functions. The distance to a convex
// shape is a convex function along a line, so the point of a capsule's segment
// nearest a shape can be found with a golden-section search, and one routine
// then collides capsules with boxes, pyramids and cylinders alike.

import { CELL, GRID_N } from './constants.js';

export const BOX = 1;
export const HULL = 2;
export const CYL = 3;

export const OWNER_PIECE = 1;
export const OWNER_PROP = 2;

/** An oriented box. Axes are unit vectors in world space. */
export function makeBox(x, y, z, hx, hy, hz, ux = [1, 0, 0], uy = [0, 1, 0], uz = [0, 0, 1]) {
  const c = { type: BOX, x, y, z, hx, hy, hz, ux, uy, uz, kind: 0, ref: 0, stamp: 0 };
  // World AABB of the box.
  const ex = Math.abs(ux[0]) * hx + Math.abs(uy[0]) * hy + Math.abs(uz[0]) * hz;
  const ey = Math.abs(ux[1]) * hx + Math.abs(uy[1]) * hy + Math.abs(uz[1]) * hz;
  const ez = Math.abs(ux[2]) * hx + Math.abs(uy[2]) * hy + Math.abs(uz[2]) * hz;
  c.minX = x - ex; c.maxX = x + ex;
  c.minY = y - ey; c.maxY = y + ey;
  c.minZ = z - ez; c.maxZ = z + ez;
  return c;
}

/** A convex hull given as planes [nx, ny, nz, d] with the inside where n·p ≤ d. */
export function makeHull(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  return { type: HULL, planes, minX, minY, minZ, maxX, maxY, maxZ, kind: 0, ref: 0, stamp: 0 };
}

/** A vertical capped cylinder. */
export function makeCyl(x, z, y0, y1, radius) {
  return {
    type: CYL, x, z, y0, y1, r: radius,
    minX: x - radius, maxX: x + radius, minY: y0, maxY: y1, minZ: z - radius, maxZ: z + radius,
    kind: 0, ref: 0, stamp: 0,
  };
}

export function sdf(c, px, py, pz) {
  switch (c.type) {
    case BOX: {
      const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
      const u = c.ux, v = c.uy, w = c.uz;
      const lx = Math.abs(dx * u[0] + dy * u[1] + dz * u[2]) - c.hx;
      const ly = Math.abs(dx * v[0] + dy * v[1] + dz * v[2]) - c.hy;
      const lz = Math.abs(dx * w[0] + dy * w[1] + dz * w[2]) - c.hz;
      const ox = lx > 0 ? lx : 0, oy = ly > 0 ? ly : 0, oz = lz > 0 ? lz : 0;
      const inside = Math.max(lx, ly, lz);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + (inside < 0 ? inside : 0);
    }
    case HULL: {
      const p = c.planes;
      let best = -Infinity;
      for (let i = 0; i < p.length; i += 4) {
        const d = p[i] * px + p[i + 1] * py + p[i + 2] * pz - p[i + 3];
        if (d > best) best = d;
      }
      return best;
    }
    case CYL: {
      const dx = px - c.x, dz = pz - c.z;
      const radial = Math.sqrt(dx * dx + dz * dz) - c.r;
      const half = (c.y1 - c.y0) / 2;
      const vertical = Math.abs(py - (c.y0 + half)) - half;
      const a = radial > 0 ? radial : 0, b = vertical > 0 ? vertical : 0;
      const inside = Math.max(radial, vertical);
      return Math.sqrt(a * a + b * b) + (inside < 0 ? inside : 0);
    }
    default:
      return Infinity;
  }
}

const GOLDEN = 0.6180339887498949;

/**
 * Deepest penetration of a capsule (segment a→b, radius r) into a shape.
 * Fills out {depth, nx, ny, nz, t} and returns depth (≤ 0 when not touching).
 */
export function capsulePenetration(ax, ay, az, bx, by, bz, r, c, out) {
  const sx = bx - ax, sy = by - ay, sz = bz - az;
  let lo = 0, hi = 1;
  let t1 = hi - GOLDEN * (hi - lo);
  let t2 = lo + GOLDEN * (hi - lo);
  let f1 = sdf(c, ax + sx * t1, ay + sy * t1, az + sz * t1);
  let f2 = sdf(c, ax + sx * t2, ay + sy * t2, az + sz * t2);
  for (let i = 0; i < 16; i++) {
    if (f1 < f2) { hi = t2; t2 = t1; f2 = f1; t1 = hi - GOLDEN * (hi - lo); f1 = sdf(c, ax + sx * t1, ay + sy * t1, az + sz * t1); }
    else { lo = t1; t1 = t2; f1 = f2; t2 = lo + GOLDEN * (hi - lo); f2 = sdf(c, ax + sx * t2, ay + sy * t2, az + sz * t2); }
  }
  let t = (lo + hi) / 2;
  let d = sdf(c, ax + sx * t, ay + sy * t, az + sz * t);
  const d0 = sdf(c, ax, ay, az);
  const d1 = sdf(c, bx, by, bz);
  if (d0 < d) { d = d0; t = 0; }
  if (d1 < d) { d = d1; t = 1; }
  out.depth = r - d;
  out.t = t;
  if (out.depth <= 0) return out.depth;
  const px = ax + sx * t, py = ay + sy * t, pz = az + sz * t;
  gradient(c, px, py, pz, out);
  return out.depth;
}

/** Unit outward gradient of the distance field — the direction to push out. */
export function gradient(c, px, py, pz, out) {
  if (c.type === HULL) {
    const p = c.planes;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < p.length; i += 4) {
      const d = p[i] * px + p[i + 1] * py + p[i + 2] * pz - p[i + 3];
      if (d > best) { best = d; bi = i; }
    }
    out.nx = p[bi]; out.ny = p[bi + 1]; out.nz = p[bi + 2];
    return out;
  }
  const e = 1e-3;
  let gx = sdf(c, px + e, py, pz) - sdf(c, px - e, py, pz);
  let gy = sdf(c, px, py + e, pz) - sdf(c, px, py - e, pz);
  let gz = sdf(c, px, py, pz + e) - sdf(c, px, py, pz - e);
  let len = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (len < 1e-9) { gx = 0; gy = 1; gz = 0; len = 1; }
  out.nx = gx / len; out.ny = gy / len; out.nz = gz / len;
  return out;
}

/** Ray against one shape: returns entry distance (or Infinity) and the hit normal in out. */
export function rayShape(c, ox, oy, oz, dx, dy, dz, maxT, out) {
  switch (c.type) {
    case BOX: {
      const rx = ox - c.x, ry = oy - c.y, rz = oz - c.z;
      const axes = [c.ux, c.uy, c.uz];
      const half = [c.hx, c.hy, c.hz];
      let tMin = -Infinity, tMax = maxT, hitAxis = -1, hitSign = 1;
      for (let i = 0; i < 3; i++) {
        const a = axes[i];
        const o = rx * a[0] + ry * a[1] + rz * a[2];
        const d = dx * a[0] + dy * a[1] + dz * a[2];
        if (Math.abs(d) < 1e-12) {
          if (o < -half[i] || o > half[i]) return Infinity;
          continue;
        }
        let t0 = (-half[i] - o) / d;
        let t1 = (half[i] - o) / d;
        let sign = -1;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; sign = 1; }
        if (t0 > tMin) { tMin = t0; hitAxis = i; hitSign = sign; }
        if (t1 < tMax) tMax = t1;
        if (tMin > tMax) return Infinity;
      }
      if (tMin < 0 || hitAxis < 0) return Infinity;
      const a = axes[hitAxis];
      out.nx = a[0] * hitSign; out.ny = a[1] * hitSign; out.nz = a[2] * hitSign;
      return tMin;
    }
    case HULL: {
      const p = c.planes;
      let tEnter = -Infinity, tExit = maxT, bi = -1;
      for (let i = 0; i < p.length; i += 4) {
        const denom = p[i] * dx + p[i + 1] * dy + p[i + 2] * dz;
        const dist = p[i] * ox + p[i + 1] * oy + p[i + 2] * oz - p[i + 3];
        if (Math.abs(denom) < 1e-12) { if (dist > 0) return Infinity; continue; }
        const t = -dist / denom;
        if (denom < 0) { if (t > tEnter) { tEnter = t; bi = i; } }
        else if (t < tExit) tExit = t;
        if (tEnter > tExit) return Infinity;
      }
      if (bi < 0 || tEnter < 0) return Infinity;
      out.nx = p[bi]; out.ny = p[bi + 1]; out.nz = p[bi + 2];
      return tEnter;
    }
    case CYL: {
      let best = Infinity;
      const rx = ox - c.x, rz = oz - c.z;
      const a = dx * dx + dz * dz;
      if (a > 1e-12) {
        const b = rx * dx + rz * dz;
        const cc = rx * rx + rz * rz - c.r * c.r;
        const disc = b * b - a * cc;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / a;
          if (t >= 0 && t <= maxT) {
            const y = oy + dy * t;
            if (y >= c.y0 && y <= c.y1) {
              best = t;
              const hx = rx + dx * t, hz = rz + dz * t;
              const l = Math.sqrt(hx * hx + hz * hz) || 1;
              out.nx = hx / l; out.ny = 0; out.nz = hz / l;
            }
          }
        }
      }
      if (Math.abs(dy) > 1e-12) {
        for (const [y, ny] of [[c.y1, 1], [c.y0, -1]]) {
          const t = (y - oy) / dy;
          if (t < 0 || t >= best || t > maxT) continue;
          const hx = rx + dx * t, hz = rz + dz * t;
          if (hx * hx + hz * hz <= c.r * c.r && (ny > 0 ? dy < 0 : dy > 0)) {
            best = t; out.nx = 0; out.ny = ny; out.nz = 0;
          }
        }
      }
      return best;
    }
    default:
      return Infinity;
  }
}

const BUCKET_STRIDE = 1024;

/**
 * A 2-D grid of buckets, one per build cell, holding every collider that
 * overlaps it. The terrain cell with the same index is tested alongside, so a
 * ray walks one grid and sees the ground and everything on it in order.
 */
export class CollisionGrid {
  constructor(terrain) {
    this.terrain = terrain;
    this.buckets = new Map();
    this.stamp = 1;
    this.count = 0;
  }

  static range(c) {
    const clampI = (v) => (v < 0 ? 0 : v > GRID_N - 1 ? GRID_N - 1 : v);
    return [
      clampI(Math.floor(c.minX / CELL)), clampI(Math.floor(c.maxX / CELL)),
      clampI(Math.floor(c.minZ / CELL)), clampI(Math.floor(c.maxZ / CELL)),
    ];
  }

  add(c) {
    const [x0, x1, z0, z1] = CollisionGrid.range(c);
    c.bx0 = x0; c.bx1 = x1; c.bz0 = z0; c.bz1 = z1;
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const key = j * BUCKET_STRIDE + i;
        let list = this.buckets.get(key);
        if (!list) { list = []; this.buckets.set(key, list); }
        list.push(c);
      }
    }
    this.count++;
  }

  remove(c) {
    if (c.bx0 === undefined) return;
    for (let j = c.bz0; j <= c.bz1; j++) {
      for (let i = c.bx0; i <= c.bx1; i++) {
        const key = j * BUCKET_STRIDE + i;
        const list = this.buckets.get(key);
        if (!list) continue;
        const at = list.indexOf(c);
        if (at >= 0) { list[at] = list[list.length - 1]; list.pop(); }
        if (!list.length) this.buckets.delete(key);
      }
    }
    c.bx0 = undefined;
    this.count--;
  }

  /** Every collider whose bounds overlap the box, each once. */
  query(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const stamp = ++this.stamp;
    const x0 = Math.max(0, Math.floor(minX / CELL)), x1 = Math.min(GRID_N - 1, Math.floor(maxX / CELL));
    const z0 = Math.max(0, Math.floor(minZ / CELL)), z1 = Math.min(GRID_N - 1, Math.floor(maxZ / CELL));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const list = this.buckets.get(j * BUCKET_STRIDE + i);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxY < minY || c.minY > maxY || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Nearest hit along a ray against terrain and colliders.
   * `skip(collider)` may reject shapes (e.g. a piece being edited).
   * Fills hit {t, x, y, z, nx, ny, nz, collider (null for terrain)}; returns t or Infinity.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit, skip = null, terrainToo = true) {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= len; dy /= len; dz /= len;
    hit.t = Infinity; hit.collider = null;
    const stamp = ++this.stamp;
    const tmp = { nx: 0, ny: 1, nz: 0 };
    let i = Math.floor(ox / CELL);
    let j = Math.floor(oz / CELL);
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaI = stepI ? Math.abs(CELL / dx) : Infinity;
    const tDeltaJ = stepJ ? Math.abs(CELL / dz) : Infinity;
    let tMaxI = stepI > 0 ? ((i + 1) * CELL - ox) / dx : stepI < 0 ? (i * CELL - ox) / dx : Infinity;
    let tMaxJ = stepJ > 0 ? ((j + 1) * CELL - oz) / dz : stepJ < 0 ? (j * CELL - oz) / dz : Infinity;
    let tEnter = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const tExit = Math.min(tMaxI, tMaxJ, maxT);
      if (i >= 0 && j >= 0 && i < GRID_N && j < GRID_N) {
        if (terrainToo) {
          const yA = oy + dy * tEnter, yB = oy + dy * tExit;
          if (Math.min(yA, yB) <= this.terrain.cellMax[j * GRID_N + i] + 0.01) {
            const t = this.terrain.rayCell(i, j, ox, oy, oz, dx, dy, dz, tmp);
            if (t < hit.t && t <= maxT) {
              hit.t = t; hit.collider = null; hit.nx = tmp.nx; hit.ny = tmp.ny; hit.nz = tmp.nz;
            }
          }
        }
        const list = this.buckets.get(j * BUCKET_STRIDE + i);
        if (list) {
          for (let k = 0; k < list.length; k++) {
            const c = list[k];
            if (c.stamp === stamp) continue;
            c.stamp = stamp;
            if (skip && skip(c)) continue;
            const t = rayShape(c, ox, oy, oz, dx, dy, dz, Math.min(maxT, hit.t), tmp);
            if (t < hit.t) { hit.t = t; hit.collider = c; hit.nx = tmp.nx; hit.ny = tmp.ny; hit.nz = tmp.nz; }
          }
        }
      } else if ((stepI > 0 && i >= GRID_N) || (stepI < 0 && i < 0) || (stepJ > 0 && j >= GRID_N) || (stepJ < 0 && j < 0)) {
        break;
      }
      if (hit.t <= tExit || tExit >= maxT) break;
      tEnter = tExit;
      if (tMaxI < tMaxJ) { tMaxI += tDeltaI; i += stepI; } else { tMaxJ += tDeltaJ; j += stepJ; }
    }
    if (hit.t < Infinity) {
      hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
    }
    return hit.t;
  }
}

/** Ray against a sphere; returns t or Infinity. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : Infinity;
}

/** Ray (unit direction) against a vertical capsule from y0 to y1 (sphere centres). */
export function rayCapsule(ox, oy, oz, dx, dy, dz, cx, y0, y1, cz, r) {
  let best = Infinity;
  const rx = ox - cx, rz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = rx * dx + rz * dz;
    const c = rx * rx + rz * rz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  const s0 = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r);
  const s1 = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r);
  return Math.min(best, s0, s1);
}

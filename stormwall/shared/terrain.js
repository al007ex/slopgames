// The island's heightfield: one height per build-grid corner, so terrain cells
// and build cells line up. Each cell is two triangles split along the same
// diagonal the renderer uses, which makes the ground you see and the ground you
// stand on exactly the same surface.

import { CELL, GRID_N, WORLD_SIZE, WORLD_CENTER } from './constants.js';
import { fbm, smoothstep } from './rng.js';

export const SIDE = GRID_N + 1;
export const ISLAND_RADIUS = 2380;

/** Biome weights at a point, 0‥1 each. North is −z. */
export function biomeWeights(x, z, out = {}) {
  const u = (x - WORLD_CENTER) / WORLD_CENTER;
  const v = (z - WORLD_CENTER) / WORLD_CENTER;
  const s = (t) => smoothstep(-0.12, 0.38, t);
  out.farm = s(-u) * s(-v);         // north-west
  out.mountain = s(u) * s(-v);      // north-east
  out.swamp = s(u) * s(v);          // south-east
  out.industrial = s(-u) * s(v);    // south-west
  const r = Math.sqrt(u * u + v * v);
  out.center = 1 - smoothstep(0.12, 0.42, r);
  return out;
}

/** Raw island height before any settlement is levelled into it. */
export function naturalHeight(x, z, seed) {
  const dx = x - WORLD_CENTER;
  const dz = z - WORLD_CENTER;
  const d = Math.sqrt(dx * dx + dz * dz) / ISLAND_RADIUS + 0.07 * fbm(x / 420, z / 420, seed + 1, 3);
  const land = 1 - smoothstep(0.86, 1.0, d);
  if (land <= 0) return -7;

  const w = biomeWeights(x, z);
  const base = 10 + 7 * fbm(x / 700, z / 700, seed + 2, 4);
  const hillNoise = fbm(x / 420, z / 420, seed + 3, 4) + 0.1;
  const hills = (hillNoise > 0 ? hillNoise : 0) * 55;
  const ridge = 1 - Math.abs(fbm(x / 540, z / 540, seed + 4, 5));
  const bump = fbm(x / 260, z / 260, seed + 6, 3);
  const mountain = base + ridge * ridge * ridge * 185 + (bump > 0 ? bump : 0) * 35;
  const farm = 9 + 3 * fbm(x / 900, z / 900, seed + 7, 3);
  const industrial = 5 + 1.2 * fbm(x / 800, z / 800, seed + 8, 2);
  // Low and waterlogged: the dips sit just under sea level as shallow ponds.
  const swampRaw = 0.55 + 2.6 * fbm(x / 170, z / 170, seed + 5, 3);
  const swamp = swampRaw < -1.1 ? -1.1 : swampRaw;         // wading depth, never deep
  const generic = base + hills * 0.55 + w.center * hills * 0.5;

  const rest = 1 - w.farm - w.mountain - w.swamp - w.industrial;
  const h = generic * rest + farm * w.farm + mountain * w.mountain + swamp * w.swamp + industrial * w.industrial;
  // Beaches: the last stretch before the water flattens out to sand.
  const shore = smoothstep(0.86, 0.95, d);
  const beach = 1.2;
  const landH = h + (beach - h) * shore;
  return landH * land + -7 * (1 - land);
}

export function generateHeights(seed) {
  const heights = new Float32Array(SIDE * SIDE);
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) heights[j * SIDE + i] = naturalHeight(i * CELL, j * CELL, seed);
  }
  return heights;
}

export class Terrain {
  constructor(heights) {
    this.h = heights;
    // Per-cell maximum, so a ray can skip cells it is clearly above.
    this.cellMax = new Float32Array(GRID_N * GRID_N);
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const k = j * SIDE + i;
        this.cellMax[j * GRID_N + i] = Math.max(heights[k], heights[k + 1], heights[k + SIDE], heights[k + SIDE + 1]);
      }
    }
  }

  corner(i, j) {
    if (i < 0) i = 0; else if (i > GRID_N) i = GRID_N;
    if (j < 0) j = 0; else if (j > GRID_N) j = GRID_N;
    return this.h[j * SIDE + i];
  }

  heightAt(x, z) {
    const gx = x / CELL;
    const gz = z / CELL;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    if (i < 0) i = 0; else if (i > GRID_N - 1) i = GRID_N - 1;
    if (j < 0) j = 0; else if (j > GRID_N - 1) j = GRID_N - 1;
    let fx = gx - i;
    let fz = gz - j;
    if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
    if (fz < 0) fz = 0; else if (fz > 1) fz = 1;
    const k = j * SIDE + i;
    const h = this.h;
    if (fx + fz <= 1) return h[k] + (h[k + 1] - h[k]) * fx + (h[k + SIDE] - h[k]) * fz;
    const h11 = h[k + SIDE + 1];
    return h11 + (h[k + SIDE] - h11) * (1 - fx) + (h[k + 1] - h11) * (1 - fz);
  }

  /** Height and unit normal of the triangle under (x, z). */
  sample(x, z, out) {
    const gx = x / CELL;
    const gz = z / CELL;
    let i = Math.floor(gx);
    let j = Math.floor(gz);
    if (i < 0) i = 0; else if (i > GRID_N - 1) i = GRID_N - 1;
    if (j < 0) j = 0; else if (j > GRID_N - 1) j = GRID_N - 1;
    let fx = gx - i;
    let fz = gz - j;
    if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
    if (fz < 0) fz = 0; else if (fz > 1) fz = 1;
    const k = j * SIDE + i;
    const h = this.h;
    let dfx;
    let dfz;
    if (fx + fz <= 1) {
      dfx = (h[k + 1] - h[k]) / CELL;
      dfz = (h[k + SIDE] - h[k]) / CELL;
      out.h = h[k] + dfx * CELL * fx + dfz * CELL * fz;
    } else {
      const h11 = h[k + SIDE + 1];
      dfx = (h11 - h[k + SIDE]) / CELL;
      dfz = (h11 - h[k + 1]) / CELL;
      out.h = h11 + (h[k + SIDE] - h11) * (1 - fx) + (h[k + 1] - h11) * (1 - fz);
    }
    const len = Math.sqrt(dfx * dfx + 1 + dfz * dfz);
    out.nx = -dfx / len;
    out.ny = 1 / len;
    out.nz = -dfz / len;
    return out;
  }

  /** Intersects one terrain cell's two triangles; returns t or Infinity. */
  rayCell(i, j, ox, oy, oz, dx, dy, dz, out) {
    const k = j * SIDE + i;
    const h = this.h;
    const x0 = i * CELL;
    const z0 = j * CELL;
    let best = Infinity;
    // Triangle A (00, 01, 10) and B (10, 01, 11), as the renderer indexes them.
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-9 && det < 1e-9) return;
      const inv = 1 / det;
      const sx = ox - ax, sy = oy - ay, sz = oz - az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) return;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) return;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t >= 0 && t < best) {
        best = t;
        // Normal = e1 × e2 pointing up.
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
      }
    };
    const h00 = h[k], h10 = h[k + 1], h01 = h[k + SIDE], h11 = h[k + SIDE + 1];
    tri(x0, h00, z0, x0, h01, z0 + CELL, x0 + CELL, h10, z0);
    tri(x0 + CELL, h10, z0, x0, h01, z0 + CELL, x0 + CELL, h11, z0 + CELL);
    return best;
  }
}

export const inWorld = (x, z) => x >= 0 && z >= 0 && x <= WORLD_SIZE && z <= WORLD_SIZE;

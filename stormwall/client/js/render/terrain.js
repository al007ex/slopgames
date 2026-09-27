// The island's ground: 20×20 chunks of 50×50 cells, each drawn at a level of
// detail picked by distance. Chunks carry a short skirt so the seams between
// different detail levels never show sky. The triangles use the same diagonal
// as the collision heightfield, so up close what you see is what you stand on.

import * as THREE from 'three';
import { CELL, GRID_N } from '#shared/constants.js';
import { SIDE } from '#shared/terrain.js';
import { biomeWeights } from '#shared/terrain.js';
import { hash01 } from '#shared/rng.js';

const CHUNK = 50;
const CHUNKS = GRID_N / CHUNK;
const STEPS = [1, 2, 5, 10, 25];
const LOD_DIST = [260, 560, 1200, 2400];
const SKIRT = 10;

export class TerrainRenderer {
  constructor(scene, terrain, roads = []) {
    this.terrain = terrain;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.colors = computeColors(terrain, roads);
    this.chunks = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let cj = 0; cj < CHUNKS; cj++) {
      for (let ci = 0; ci < CHUNKS; ci++) {
        const mesh = new THREE.Mesh(undefined, this.material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ ci, cj, lod: -1, mesh, geos: [] });
      }
    }
  }

  update(cam) {
    for (const c of this.chunks) {
      const cx = (c.ci + 0.5) * CHUNK * CELL, cz = (c.cj + 0.5) * CHUNK * CELL;
      const dx = Math.max(0, Math.abs(cam.x - cx) - CHUNK * CELL / 2);
      const dz = Math.max(0, Math.abs(cam.z - cz) - CHUNK * CELL / 2);
      const d = Math.sqrt(dx * dx + dz * dz) + Math.max(0, cam.y - 150) * 0.35;
      let lod = 0;
      while (lod < LOD_DIST.length && d > LOD_DIST[lod]) lod++;
      if (lod !== c.lod) {
        c.lod = lod;
        if (!c.geos[lod]) c.geos[lod] = this.build(c.ci, c.cj, STEPS[lod]);
        c.mesh.geometry = c.geos[lod];
      }
    }
  }

  build(ci, cj, step) {
    const h = this.terrain.h;
    const n = CHUNK / step + 1;
    const count = n * n + 4 * n;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const i0 = ci * CHUNK, j0 = cj * CHUNK;
    let v = 0;
    const put = (i, j, drop) => {
      const k = j * SIDE + i;
      pos[v * 3] = i * CELL; pos[v * 3 + 1] = h[k] - drop; pos[v * 3 + 2] = j * CELL;
      const l = Math.max(0, i - step), r = Math.min(GRID_N, i + step);
      const u = Math.max(0, j - step), d = Math.min(GRID_N, j + step);
      const dx = (h[j * SIDE + r] - h[j * SIDE + l]) / ((r - l) * CELL);
      const dz = (h[d * SIDE + i] - h[u * SIDE + i]) / ((d - u) * CELL);
      const len = Math.sqrt(dx * dx + 1 + dz * dz);
      nor[v * 3] = -dx / len; nor[v * 3 + 1] = 1 / len; nor[v * 3 + 2] = -dz / len;
      col[v * 3] = this.colors[k * 3] / 255; col[v * 3 + 1] = this.colors[k * 3 + 1] / 255; col[v * 3 + 2] = this.colors[k * 3 + 2] / 255;
      v++;
    };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) put(i0 + x * step, j0 + y * step, 0);
    const skirtStart = v;
    for (let x = 0; x < n; x++) put(i0 + x * step, j0, SKIRT);                    // north edge
    for (let x = 0; x < n; x++) put(i0 + x * step, j0 + CHUNK, SKIRT);            // south edge
    for (let y = 0; y < n; y++) put(i0, j0 + y * step, SKIRT);                    // west edge
    for (let y = 0; y < n; y++) put(i0 + CHUNK, j0 + y * step, SKIRT);            // east edge

    const idx = [];
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
        // (00, 01, 10) and (10, 01, 11) — the collision heightfield's split.
        idx.push(a, c, b, b, c, d);
      }
    }
    const top = (x) => x, bottom = (x) => (n - 1) * n + x, left = (y) => y * n, right = (y) => y * n + n - 1;
    const sN = skirtStart, sS = skirtStart + n, sW = skirtStart + 2 * n, sE = skirtStart + 3 * n;
    for (let k = 0; k < n - 1; k++) {
      idx.push(top(k), top(k + 1), sN + k, top(k + 1), sN + k + 1, sN + k);
      idx.push(bottom(k), sS + k, bottom(k + 1), bottom(k + 1), sS + k, sS + k + 1);
      idx.push(left(k), sW + k, left(k + 1), left(k + 1), sW + k, sW + k + 1);
      idx.push(right(k), right(k + 1), sE + k, right(k + 1), sE + k + 1, sE + k);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Ground colour per terrain corner, from biome, height and slope. Also used for the map. */
export function computeColors(terrain, roads = []) {
  const h = terrain.h;
  const out = new Uint8Array(SIDE * SIDE * 3);
  const w = {};
  const GRASS = [96, 150, 66], FARM = [148, 168, 76], SWAMP = [78, 96, 58], INDUSTRIAL = [118, 128, 92],
    ROCK = [128, 120, 110], SNOW = [236, 240, 246], SAND = [222, 206, 150], MUD = [110, 98, 70], FOREST = [74, 122, 58];
  for (let j = 0; j < SIDE; j++) {
    for (let i = 0; i < SIDE; i++) {
      const k = j * SIDE + i;
      const x = i * CELL, z = j * CELL, y = h[k];
      biomeWeights(x, z, w);
      const rest = Math.max(0, 1 - w.farm - w.mountain - w.swamp - w.industrial);
      let c = [0, 0, 0];
      const add = (col, wt) => { c[0] += col[0] * wt; c[1] += col[1] * wt; c[2] += col[2] * wt; };
      add(w.center > 0.3 ? FOREST : GRASS, rest); add(FARM, w.farm); add(GRASS, w.mountain); add(SWAMP, w.swamp); add(INDUSTRIAL, w.industrial);
      const l = Math.max(0, i - 1), r = Math.min(GRID_N, i + 1), u = Math.max(0, j - 1), d = Math.min(GRID_N, j + 1);
      const dx = (h[j * SIDE + r] - h[j * SIDE + l]) / ((r - l) * CELL);
      const dz = (h[d * SIDE + i] - h[u * SIDE + i]) / ((d - u) * CELL);
      const ny = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      if (ny < 0.82) c = mix3(c, ROCK, Math.min(1, (0.82 - ny) * 5));
      if (y > 150) c = mix3(c, SNOW, Math.min(1, (y - 150) / 25));
      if (y < 2.3) c = mix3(c, w.swamp > 0.4 ? MUD : SAND, Math.min(1, (2.3 - y) / 1.2));
      const jitter = 0.9 + hash01(i, j, 5) * 0.16;
      out[k * 3] = Math.min(255, c[0] * jitter); out[k * 3 + 1] = Math.min(255, c[1] * jitter); out[k * 3 + 2] = Math.min(255, c[2] * jitter);
    }
  }
  paintRoads(out, h, roads);
  return out;
}

/** Dirt tracks along each road, fading at the edges, skipping water. */
function paintRoads(out, h, roads) {
  const DIRT = [150, 124, 86];
  const half = 4.2, edge = 2.6;
  for (const r of roads) {
    const dx = r.x1 - r.x0, dz = r.z1 - r.z0, len2 = dx * dx + dz * dz;
    const i0 = Math.max(0, Math.floor((Math.min(r.x0, r.x1) - 8) / CELL)), i1 = Math.min(GRID_N, Math.ceil((Math.max(r.x0, r.x1) + 8) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(r.z0, r.z1) - 8) / CELL)), j1 = Math.min(GRID_N, Math.ceil((Math.max(r.z0, r.z1) + 8) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * SIDE + i;
        if (h[k] < 0.4) continue;
        const px = i * CELL - r.x0, pz = j * CELL - r.z0;
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / len2));
        const d = Math.hypot(px - dx * t, pz - dz * t);
        if (d > half + edge) continue;
        const w = d < half ? 0.85 : 0.85 * (1 - (d - half) / edge);
        for (let c = 0; c < 3; c++) out[k * 3 + c] = out[k * 3 + c] * (1 - w) + DIRT[c] * w;
      }
    }
  }
}

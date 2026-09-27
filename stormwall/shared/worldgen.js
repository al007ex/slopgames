// Builds the island from a seed: terrain, named places, buildings, props and
// loot spawn points. It runs on the server and again in every browser, and has
// to produce the same thing bit for bit (see rng.js), so the server never has
// to send the map — only what changes on it during a match.

import { CELL, WALL_H, GRID_N, WORLD_CENTER } from './constants.js';
import { Rng, fbm, smoothstep, hash01, dsin, dcos } from './rng.js';
import { generateHeights, Terrain, SIDE, biomeWeights } from './terrain.js';
import { Builder } from './structures.js';
import { LAYOUTS, filler, FILLER_FOOTPRINT } from './layouts.js';

export const MAP_SEED = 20170926;       // one fixed island, like the real thing: people learn it

// Twenty named places. North is up (−z). The middle of the island is left
// deliberately quiet — hills, woods and three cliff-sided mesas — so early
// matches spread out to the edges and the mid-game is a trek.
export const POIS = [
  { name: 'Haybale Hollow', x: 1150, z: 1120, kind: 'farm', r: 150 },
  { name: 'Duskfield Farms', x: 1680, z: 700, kind: 'farm', r: 140 },
  { name: 'Pinecrest Commons', x: 2280, z: 930, kind: 'suburb', r: 150 },
  { name: 'Cobble Crossing', x: 700, z: 1680, kind: 'town', r: 150 },
  { name: 'Ridgeback Cabins', x: 3020, z: 720, kind: 'cabins', r: 110 },
  { name: 'Cragspire Lodge', x: 3520, z: 1040, kind: 'lodge', r: 110 },
  { name: 'Stonehearth Quarry', x: 4120, z: 1540, kind: 'quarry', r: 140 },
  { name: 'Oldmill Crossing', x: 3420, z: 2080, kind: 'town', r: 140 },
  { name: 'Whistlecreek', x: 4230, z: 2460, kind: 'suburb', r: 150 },
  { name: 'Mirewood', x: 4130, z: 3080, kind: 'swamp', r: 140 },
  { name: 'Fogwater Marsh', x: 3680, z: 3620, kind: 'swamp', r: 150 },
  { name: 'Reedside Docks', x: 3200, z: 4220, kind: 'docks', r: 130 },
  { name: 'Lanternbrook', x: 2480, z: 3720, kind: 'town', r: 160 },
  { name: 'Copperline Docks', x: 1860, z: 4420, kind: 'docks', r: 130 },
  { name: 'Rustmoor Yards', x: 1480, z: 3880, kind: 'industrial', r: 160 },
  { name: 'Ironhook Works', x: 1010, z: 3300, kind: 'factory', r: 150 },
  { name: 'Gasket Junction', x: 700, z: 2700, kind: 'depot', r: 130 },
  { name: 'Brambleton', x: 1880, z: 2920, kind: 'suburb', r: 140 },
  { name: 'Maple Row', x: 1300, z: 2200, kind: 'suburb', r: 140 },
  { name: 'Gullrest Point', x: 4520, z: 3760, kind: 'cabins', r: 100 },
];

// Cliff-sided mesas in the quiet middle: one gentle side to walk up, sheer drops
// everywhere else. High enough (over seven wall-heights) to kill whoever steps off.
export const MESAS = [
  { x: 2560, z: 2380, r: 70, h: 34, gx: -1, gz: 0 },
  { x: 2860, z: 2780, r: 55, h: 30, gx: 0, gz: 1 },
  { x: 2240, z: 2700, r: 60, h: 32, gx: 0.6, gz: 0.8 },
];

export const PREGAME = { x: 330, z: 330, r: 120, h: 4 };

const worlds = new Map();

/** The generated world for a seed, built once per process. */
export function getWorld(seed = MAP_SEED) {
  let world = worlds.get(seed);
  if (!world) { world = generateWorld(seed); worlds.set(seed, world); }
  return world;
}

export function generateWorld(seed = MAP_SEED) {
  const heights = generateHeights(seed);
  const at = (i, j) => j * SIDE + i;

  // Every terrain edit walks the corners inside a square around a centre.
  const around = (x, z, radius, fn) => {
    const i0 = Math.max(0, Math.floor((x - radius) / CELL)), i1 = Math.min(GRID_N, Math.ceil((x + radius) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius) / CELL)), j1 = Math.min(GRID_N, Math.ceil((z + radius) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        fn(i, j, Math.sqrt(dx * dx + dz * dz), dx, dz);
      }
    }
  };

  // The pre-game island, out in the sea off the north-west corner.
  around(PREGAME.x, PREGAME.z, PREGAME.r + 40, (i, j, d) => {
    const land = 1 - smoothstep(PREGAME.r - 20, PREGAME.r + 30, d);
    const h = PREGAME.h + 1.2 * fbm(i / 9, j / 9, seed + 90, 2);
    const k = at(i, j);
    heights[k] = Math.fround(h * land + heights[k] * (1 - land));
  });

  for (const m of MESAS) {
    const gl = Math.sqrt(m.gx * m.gx + m.gz * m.gz);
    const gx = m.gx / gl, gz = m.gz / gl;
    around(m.x, m.z, m.r + 140, (i, j, d, dx, dz) => {
      const facing = d > 0 ? (dx * gx + dz * gz) / d : 0;
      const ext = facing > 0 ? 125 * facing * facing * facing : 0;
      const t = (m.r + ext - d) / (ext + 3);
      const lift = t <= 0 ? 0 : t >= 1 ? 1 : t;
      if (lift > 0) {
        const k = at(i, j);
        heights[k] = Math.fround(heights[k] + m.h * lift);
      }
    });
  }

  // Level each named place into a plateau so its buildings sit on flat ground.
  const pois = POIS.map((p, index) => {
    let base = 0;
    let n = 0;
    around(p.x, p.z, p.r * 0.6, (i, j, d) => { if (d <= p.r * 0.6) { base += heights[at(i, j)]; n++; } });
    base = Math.max(2.5, base / n);
    const level = Math.round(base / WALL_H);
    const flat = level * WALL_H - 0.02;
    around(p.x, p.z, p.r + 60, (i, j, d) => {
      const t = smoothstep(p.r, p.r + 60, d);
      const k = at(i, j);
      heights[k] = Math.fround(flat * (1 - t) + heights[k] * t);
    });
    return { ...p, id: index, level, baseY: level * WALL_H };
  });

  // The quarry: a pit sunk into its plateau with a sheer rim.
  const quarry = pois.find((p) => p.kind === 'quarry');
  if (quarry) {
    const depth = 9 * WALL_H;
    around(quarry.x + 40, quarry.z - 20, 80, (i, j, d) => {
      if (d < 72) {
        const k = at(i, j);
        const t = smoothstep(62, 72, d);
        heights[k] = Math.fround(heights[k] - depth * (1 - t * t * t));
      }
    });
  }

  const world = {
    seed, heights, pois, pregame: { ...PREGAME },
    pieces: [], props: [], lootSpots: [], chestSpots: [], ammoSpots: [], pregameSpots: [], buildings: [],
  };
  const b = new Builder(world);

  // Named places first: dense, and stocked with better loot.
  for (const poi of pois) {
    b.tier = 2;
    b.poi = poi.id;
    LAYOUTS[poi.kind](b, new Rng(seed * 31 + poi.id * 7919), poi);
  }

  // Then unnamed filler — lone houses, cabins, barns and gas stations — each
  // levelled into the hillside it stands on.
  b.tier = 1;
  b.poi = -1;
  const frng = new Rng(seed + 555);
  const fillers = [];
  const clearOf = (x, z) => {
    for (const p of pois) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < (p.r + 120) * (p.r + 120)) return false; }
    for (const m of MESAS) { const dx = m.x - x, dz = m.z - z; if (dx * dx + dz * dz < (m.r + 160) * (m.r + 160)) return false; }
    for (const f of fillers) { const dx = f.x - x, dz = f.z - z; if (dx * dx + dz * dz < 130 * 130) return false; }
    return true;
  };
  for (let gz = 300; gz < 4820 && fillers.length < 72; gz += 95) {
    for (let gx = 300; gx < 4820 && fillers.length < 72; gx += 95) {
      const x = gx + frng.range(-30, 30), z = gz + frng.range(-30, 30);
      if (!frng.chance(0.3) || !clearOf(x, z)) continue;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
      for (let j = cz - 1; j <= cz + FILLER_FOOTPRINT; j++) for (let i = cx - 1; i <= cx + FILLER_FOOTPRINT; i++) {
        const h = heights[at(i, j)];
        lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
      }
      if (lo < 2.5 || hi - lo > 5) continue;
      const lv = Math.round(sum / n / WALL_H);
      const flat = lv * WALL_H - 0.02;
      // Level the lot, blending into the slope over a few cells.
      for (let j = cz - 5; j <= cz + FILLER_FOOTPRINT + 4; j++) for (let i = cx - 5; i <= cx + FILLER_FOOTPRINT + 4; i++) {
        const di = i < cx - 1 ? cx - 1 - i : i > cx + FILLER_FOOTPRINT - 1 ? i - (cx + FILLER_FOOTPRINT - 1) : 0;
        const dj = j < cz - 1 ? cz - 1 - j : j > cz + FILLER_FOOTPRINT - 1 ? j - (cz + FILLER_FOOTPRINT - 1) : 0;
        const t = Math.min(1, Math.max(di, dj) / 4);
        const k = at(i, j);
        heights[k] = Math.fround(flat * (1 - t) + heights[k] * t);
      }
      fillers.push({ x, z });
      filler(b, frng, cx, cz, lv);
    }
  }
  world.fillers = fillers;

  const terrain = new Terrain(heights);
  world.terrain = terrain;

  // Forests, thickest in the quiet middle and on the mountains, thin on the
  // farmland and the industrial flats, and kept out of towns and buildings.
  const w = {};
  const trng = new Rng(seed + 777);
  const TREE_STEP = 17;
  for (let z = 40; z < 5080; z += TREE_STEP) {
    for (let x = 40; x < 5080; x += TREE_STEP) {
      const px = x + trng.range(-6, 6), pz = z + trng.range(-6, 6);
      const h = terrain.heightAt(px, pz);
      if (h < 1.4 || h > 175) continue;
      const cxi = Math.floor(px / CELL), czi = Math.floor(pz / CELL);
      if (b.occupied.has(czi * 1024 + cxi)) continue;
      biomeWeights(px, pz, w);
      let density = 0.1 + 0.42 * w.center + 0.3 * w.mountain + 0.22 * w.swamp + 0.05 * w.farm - 0.06 * w.industrial;
      for (const p of pois) {
        const dx = p.x - px, dz = p.z - pz;
        if (dx * dx + dz * dz < (p.r + 25) * (p.r + 25)) { density *= p.kind === 'cabins' || p.kind === 'swamp' ? 0.35 : 0.06; break; }
      }
      // Clumps rather than an even sprinkle.
      density *= 0.45 + 1.1 * (fbm(px / 160, pz / 160, seed + 31, 2) * 0.5 + 0.5);
      if (hash01(Math.floor(px), Math.floor(pz), seed + 3) >= density) continue;
      const slope = terrain.sample(px, pz, {}).ny;
      if (slope < 0.78) continue;
      const kind = w.mountain > 0.5 ? 'pine' : w.swamp > 0.5 ? (trng.chance(0.55) ? 'deadtree' : 'oak') : w.farm > 0.5 ? 'oak' : (trng.chance(0.5) ? 'pine' : 'oak');
      b.prop(kind, px, h, pz, trng.range(0, 6.28), trng.range(0.8, 1.25));
    }
  }

  // Rocks: scattered everywhere, crowded in the mountains.
  const rrng = new Rng(seed + 888);
  for (let z = 60; z < 5060; z += 46) {
    for (let x = 60; x < 5060; x += 46) {
      const px = x + rrng.range(-18, 18), pz = z + rrng.range(-18, 18);
      const h = terrain.heightAt(px, pz);
      if (h < 1.5) continue;
      if (b.occupied.has(Math.floor(pz / CELL) * 1024 + Math.floor(px / CELL))) continue;
      biomeWeights(px, pz, w);
      const density = 0.04 + 0.4 * w.mountain + 0.08 * w.center;
      if (!rrng.chance(density)) continue;
      let inPoi = false;
      for (const p of pois) { const dx = p.x - px, dz = p.z - pz; if (dx * dx + dz * dz < p.r * p.r) { inPoi = true; break; } }
      if (inPoi) continue;
      b.prop(rrng.chance(0.3) ? 'boulder' : 'rock', px, h, pz, rrng.range(0, 6.28), rrng.range(0.7, 1.4));
    }
  }

  // The pre-game island: trees and rocks to practise harvesting on, crates,
  // and spots where throwaway weapons appear while everyone waits.
  const prng = new Rng(seed + 999);
  for (let i = 0; i < 70; i++) {
    const a = prng.range(0, Math.PI * 2), r = prng.range(10, PREGAME.r - 12);
    const px = PREGAME.x + dcos(a) * r, pz = PREGAME.z + dsin(a) * r;
    const h = terrain.heightAt(px, pz);
    if (i < 30) b.prop(prng.chance(0.5) ? 'pine' : 'oak', px, h, pz, prng.range(0, 6.28), prng.range(0.8, 1.1));
    else if (i < 42) b.prop('rock', px, h, pz, prng.range(0, 6.28), prng.range(0.7, 1.1));
    else if (i < 50) b.prop('crate', px, h, pz, prng.range(0, 6.28));
    else world.pregameSpots.push({ x: px, y: h + 0.1, z: pz });
  }

  world.roads = planRoads(pois);
  world.hash = hashWorld(world);
  return world;
}

/**
 * Dirt roads joining the named places: a minimum spanning tree (every place
 * reachable) plus a few short extra links so it is a network, not a tree.
 */
export function planRoads(pois) {
  const n = pois.length;
  const dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
  const inTree = new Set([0]);
  const roads = [];
  const key = new Set();
  while (inTree.size < n) {
    let best = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < n; j++) {
      if (inTree.has(j)) continue;
      const d = dist(pois[i], pois[j]);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    inTree.add(best[1]);
    roads.push(best);
    key.add(`${Math.min(...best)}-${Math.max(...best)}`);
  }
  for (let i = 0; i < n; i++) {
    let second = -1, sd = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j || key.has(`${Math.min(i, j)}-${Math.max(i, j)}`)) continue;
      const d = dist(pois[i], pois[j]);
      if (d < sd) { sd = d; second = j; }
    }
    if (second >= 0 && sd < 1100) { roads.push([i, second]); key.add(`${Math.min(i, second)}-${Math.max(i, second)}`); }
  }
  return roads.map(([i, j]) => ({ a: i, b: j, x0: pois[i].x, z0: pois[i].z, x1: pois[j].x, z1: pois[j].z }));
}

/** FNV-1a over everything generated; server and client compare these. */
export function hashWorld(world) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  const bits = new Uint32Array(world.heights.buffer, world.heights.byteOffset, world.heights.length);
  for (let i = 0; i < bits.length; i += 7) mix(bits[i]);
  for (const p of world.pieces) { mix(p.id); mix(p.type); mix(p.rot); mix(p.cx); mix(p.lv); mix(p.cz); mix(p.mat); mix(p.edit); }
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (const p of world.props) { mix(p.id); mix(p.kind); f[0] = p.x; mix(u[0]); f[0] = p.z; mix(u[0]); f[0] = p.y; mix(u[0]); }
  mix(world.lootSpots.length); mix(world.chestSpots.length); mix(world.ammoSpots.length);
  return h >>> 0;
}

export const poiAt = (world, x, z) => world.pois.find((p) => {
  const dx = p.x - x, dz = p.z - z;
  return dx * dx + dz * dz <= p.r * p.r;
}) || null;

export { WORLD_CENTER };

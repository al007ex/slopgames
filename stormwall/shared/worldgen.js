// Builds the island from a seed: terrain, named places, buildings, props and
// loot spawn points. It runs on the server and again in every browser, and has
// to produce the same thing bit for bit (see rng.js), so the server never has
// to send the map — only what changes on it during a match.

import { CELL, WALL_H, GRID_N, WORLD_CENTER } from './constants.js';
import { Rng, fbm, smoothstep } from './rng.js';
import { generateHeights, Terrain, SIDE } from './terrain.js';

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

  const terrain = new Terrain(heights);
  const rng = new Rng(seed);
  const world = {
    seed, heights, terrain, pois, pregame: { ...PREGAME },
    pieces: [], props: [], lootSpots: [], chestSpots: [], ammoSpots: [],
  };
  world.hash = hashWorld(world);
  void rng;
  return world;
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

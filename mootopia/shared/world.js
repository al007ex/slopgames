// The natural world: trees, bushes, rocks and gold, scattered from a seed.
// Trees keep out of the river and the desert, bushes out of the river, and
// in the desert every bush is a cactus. Rocks and gold go anywhere.

import { MAP, SNOW_TOP, DESERT_TOP, TREES, BUSHES, ROCKS, GOLD_ORES, inRiver } from './config.js';
import { rng } from './util.js';
import { radiusOf } from './sprites.js';

export const TREE = 0;
export const BUSH = 1;
export const ROCK = 2;
export const GOLD = 3;

/** A stable 0–1 number from a position, so everyone agrees on a resource's look. */
export function spot(x, y, salt = 0) {
  let h = Math.imul(Math.round(x) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(Math.round(y) + salt * 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// The sprite each kind uses: by biome, with a mix of kinds in the grassland.
export function resourceSprite(type, x, y) {
  const snow = y < SNOW_TOP;
  const desert = y > DESERT_TOP;
  const v = spot(x, y, 1);
  if (type === TREE) return snow ? 'wintertree_1' : v < 0.16 ? 'sakuratree_1' : v < 0.32 ? 'automntree_1' : 'tree_1';
  if (type === BUSH) return desert ? 'cactus' : !snow && v < 0.3 ? 'sakurabush_1' : 'bush_1';
  if (type === ROCK) return snow || v < 0.3 ? 'darkstone_1' : 'stone_1';
  return 'gold_1';
}

export const isCactus = (type, y) => type === BUSH && y > DESERT_TOP;

/** A resource's sprite key, as in shared/sprites.js. */
export const resourceKey = (type, x, y) => {
  const name = resourceSprite(type, x, y);
  return name === 'cactus' ? 'drawn/cactus' : `world/${name}`;
};

// How much bigger than true size each kind is drawn — a range, so no two
// trees are quite alike. Tuned to the look of the classic games: big trees,
// solid rocks, modest bushes.
const SIZE = { [TREE]: [1.2, 1.42], [BUSH]: [0.95, 1.06], [ROCK]: [1.08, 1.2], [GOLD]: [1.08, 1.18] };
// Sakura and autumn trees are the smaller, showier kind.
const BLOSSOM = [0.88, 1.02];

export const resourceScale = (type, x, y) => {
  const name = resourceSprite(type, x, y);
  const [lo, hi] = name === 'sakuratree_1' || name === 'automntree_1' ? BLOSSOM : SIZE[type];
  return lo + (hi - lo) * spot(x, y, 2);
};

/** A resource's radius: the silhouette of the sprite it is drawn with, at its size. */
export const resourceRadius = (type, x, y) => +(radiusOf(resourceKey(type, x, y)) * resourceScale(type, x, y)).toFixed(2);

export function generateWorld(seed = 1) {
  const r = rng(seed);
  const out = [];
  const CELL = 400;
  const grid = new Map();
  const key = (cx, cy) => cx * 1000 + cy;
  const free = (x, y, s) => {
    const cx = Math.floor(x / CELL); const cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const o of grid.get(key(cx + i, cy + j)) || []) {
        if (Math.hypot(x - o.x, y - o.y) < s + o.scale + 20) return false;
      }
    }
    return true;
  };
  const add = (type, x, y, scale) => {
    const o = { type, x, y, scale, dir: 0 };
    out.push(o);
    const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  };
  const scatter = (type, n, ok) => {
    for (let placed = 0, tries = 0; placed < n && tries < n * 50; tries++) {
      const x = r.int(60, MAP - 60); const y = r.int(60, MAP - 60);
      const s = resourceRadius(type, x, y);
      if (!ok(x, y) || !free(x, y, s)) continue;
      add(type, x, y, s);
      placed++;
    }
  };
  scatter(TREE, TREES, (x, y) => !inRiver(y) && y < DESERT_TOP);
  scatter(BUSH, BUSHES, (x, y) => !inRiver(y));
  scatter(ROCK, ROCKS, () => true);
  scatter(GOLD, GOLD_ORES, () => true);
  return out;
}

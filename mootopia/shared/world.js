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

// The sprite each kind uses, by biome. `drawn` sprites are painted in code.
export function resourceSprite(type, y) {
  const snow = y < SNOW_TOP;
  const desert = y > DESERT_TOP;
  if (type === TREE) return snow ? 'wintertree_1' : 'tree_1';
  if (type === BUSH) return desert ? 'cactus' : 'bush_1';
  if (type === ROCK) return snow ? 'darkstone_1' : 'stone_1';
  return 'gold_1';
}

export const isCactus = (type, y) => type === BUSH && y > DESERT_TOP;

/** A resource's sprite key, as in shared/sprites.js. */
export const resourceKey = (type, y) => {
  const name = resourceSprite(type, y);
  return name === 'cactus' ? 'drawn/cactus' : `world/${name}`;
};

/** A resource's radius: the silhouette of the sprite it is drawn with. */
export const resourceRadius = (type, y) => radiusOf(resourceKey(type, y));

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
      const s = resourceRadius(type, y);
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

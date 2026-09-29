// Ground scenery: the owner's own decoration sprites (flowers, clover,
// mushrooms, tufts, pebbles, leaves, skulls, snowflakes) and lily pads on the
// water, plus soft darker patches of ground. Pure scenery: no hitboxes, not
// sent over the wire — every client grows the same set from the world seed.

import { MAP, SNOW_TOP, DESERT_TOP, RIVER_TOP, RIVER_BOTTOM, RIVER_PADDING, inRiver } from './config.js';
import { rng } from './util.js';

// Drawn width in world units (a player is 70 across), matched to the look of
// the reference screenshot: flowers about half a player, pebbles smaller.
export const DECOR_SIZE = {
  'decor/flower_flower_0': 42, 'decor/flower_flower_1': 42, 'decor/flower_flower_2': 38,
  'decor/ground_ground_0': 28, 'decor/ground_ground_1': 28,
  'decor/stone_stone_1': 46, 'decor/stone_stone_2': 46, 'decor/stone_stone_3': 28, 'decor/stone_stone_4': 72,
  'decor/particles_particle_3': 30, 'decor/particles_particle_4': 30,
  'decor/moo_particle_0': 46, 'animals/skull_1': 70,
  'decor/lilypads': 70, 'decor/lilybud': 70,
};

// [sprite, relative weight] per place.
export const DECOR_MIX = {
  grass: [['decor/flower_flower_0', 5], ['decor/flower_flower_1', 4.5], ['decor/flower_flower_2', 1.4], ['decor/ground_ground_0', 2.5], ['decor/ground_ground_1', 2.5],
    ['decor/stone_stone_1', 1.2], ['decor/stone_stone_2', 1], ['decor/stone_stone_3', 1.4], ['decor/stone_stone_4', 0.4], ['decor/particles_particle_4', 1.5],
    ['decor/particles_particle_3', 1], ['animals/skull_1', 0.2]],
  snow: [['decor/moo_particle_0', 2.5], ['decor/stone_stone_2', 2], ['decor/stone_stone_3', 1.2]],
  desert: [['decor/stone_stone_1', 2], ['decor/stone_stone_3', 2.2], ['decor/stone_stone_4', 0.6], ['animals/skull_1', 0.5]],
  water: [['decor/lilypads', 2], ['decor/lilybud', 1]],
};
export const DECOR_COUNTS = { grass: 3200, snow: 320, desert: 320, water: 160 };

const pickWeighted = (r, mix) => {
  const total = mix.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [key, w] of mix) { x -= w; if (x <= 0) return key; }
  return mix[mix.length - 1][0];
};

const land = (y) => !inRiver(y) && (y < RIVER_TOP - RIVER_PADDING - 30 || y > RIVER_BOTTOM + RIVER_PADDING + 30);

export function generateDecor(seed) {
  const r = rng((seed ^ 0x5eed) >>> 0);
  const out = [];
  const place = (kind, n, y0, y1, ok) => {
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const x = r.range(40, MAP - 40); const y = r.range(y0, y1);
      if (!ok(y)) continue;
      out.push({ key: pickWeighted(r, DECOR_MIX[kind]), x, y, rot: r.range(-Math.PI, Math.PI) });
      i++;
    }
  };
  place('grass', DECOR_COUNTS.grass, SNOW_TOP + 40, DESERT_TOP - 40, land);
  place('snow', DECOR_COUNTS.snow, 40, SNOW_TOP - 40, () => true);
  place('desert', DECOR_COUNTS.desert, DESERT_TOP + 40, MAP - 40, () => true);
  place('water', DECOR_COUNTS.water, RIVER_TOP + 70, RIVER_BOTTOM - 70, () => true);
  return out;
}

/** Big soft patches of darker ground, each a clump of overlapping circles. */
export function generatePatches(seed) {
  const r = rng((seed ^ 0x9a7c4) >>> 0);
  const out = [];
  for (let i = 0; i < 460; i++) {
    const x = r.range(0, MAP); const y = r.range(0, MAP);
    if (!land(y)) continue;
    const blobs = [];
    const n = r.int(4, 7);
    for (let k = 0; k < n; k++) blobs.push([r.range(-170, 170), r.range(-120, 120), r.range(90, 210)]);
    out.push({ x, y, blobs });
  }
  return out;
}

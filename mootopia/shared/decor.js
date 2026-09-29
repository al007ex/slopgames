// Ground decorations: flowers, tufts, pebbles, hay bales, ice and lily pads.
// Pure scenery — no hitboxes, not sent over the wire. Every client grows the
// same set from the world seed.

import { MAP, SNOW_TOP, DESERT_TOP, RIVER_TOP, RIVER_BOTTOM, RIVER_PADDING, inRiver } from './config.js';
import { rng } from './util.js';

// [sprite, relative weight] per place.
export const DECOR_MIX = {
  grass: [['decor/tuft', 4], ['decor/daisy', 3], ['decor/poppy', 2], ['decor/bluebells', 2], ['decor/pebbles', 2], ['decor/hay', 0.35]],
  snow: [['decor/ice', 2], ['decor/pebbles_dark', 2]],
  desert: [['decor/drytuft', 3], ['decor/pebbles_sand', 3], ['decor/desertbloom', 1.5]],
  water: [['decor/lilypads', 2], ['decor/lilybud', 1]],
};
export const DECOR_COUNTS = { grass: 820, snow: 220, desert: 220, water: 110 };

const pickWeighted = (r, mix) => {
  const total = mix.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [key, w] of mix) { x -= w; if (x <= 0) return key; }
  return mix[mix.length - 1][0];
};

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
  const land = (y) => !inRiver(y) && (y < RIVER_TOP - RIVER_PADDING - 30 || y > RIVER_BOTTOM + RIVER_PADDING + 30);
  place('grass', DECOR_COUNTS.grass, SNOW_TOP + 40, DESERT_TOP - 40, land);
  place('snow', DECOR_COUNTS.snow, 40, SNOW_TOP - 40, () => true);
  place('desert', DECOR_COUNTS.desert, DESERT_TOP + 40, MAP - 40, () => true);
  place('water', DECOR_COUNTS.water, RIVER_TOP + 70, RIVER_BOTTOM - 70, () => true);
  return out;
}

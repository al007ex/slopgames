// How big everything is.
//
// All the art is drawn with the same pen: an outline 8 source pixels thick.
// Every sprite is drawn at PX world units per source pixel, so every outline
// on screen is OUTLINE world units — the same as the player's, which is drawn
// in code. Hitboxes come from the same measurements: a circle with the area
// of the sprite's solid silhouette (its soft halo does not count).

import { MEASURED } from './sprite-sizes.js';

export const PX = 0.5;                 // world units per source pixel
export const OUTLINE_PX = 8;           // the pen, in source pixels
export const OUTLINE = OUTLINE_PX * PX;

// Pieces painted in code (client/js/assets.js). They are painted with the
// same 8 px pen onto canvases of these sizes; r, cx and cy were measured from
// the painted canvases with shared/measure.js, exactly like the drawn art.
export const DRAWN = {
  'drawn/boar': { w: 370, h: 370, outline: 8.49, r: 119.35, cx: 184.4, cy: 182.9 },
  'drawn/tusker': { w: 440, h: 440, outline: 8.49, r: 141.61, cx: 219.4, cy: 218.9 },
  'drawn/bear': { w: 440, h: 440, outline: 8.49, r: 173.84, cx: 219.5, cy: 231 },
  'drawn/chest': { w: 300, h: 300, outline: 8, r: 107.4, cx: 149.5, cy: 149.5 },
  'drawn/cactus': { w: 320, h: 320, outline: 8.49, r: 114.39, cx: 159.5, cy: 159.5 },
  'drawn/turret': { w: 210, h: 210, outline: 7.07, r: 84.91, cx: 104.5, cy: 104.5 },
  'drawn/blocker': { w: 220, h: 220, outline: 8, r: 89.7, cx: 109.5, cy: 109.5 },
  'drawn/musket': { w: 410, h: 410, outline: 8, r: 76.34, cx: 186.2, cy: 205.6 },
  'drawn/grabby': { w: 260, h: 420, outline: 8, r: 65.25, cx: 129.5, cy: 231 },
  'drawn/bullet': { w: 64, h: 64, outline: 8, r: 17.73, cx: 31.5, cy: 31.5 },
  // Ground decorations: walk-over scenery, no hitbox. Outlines measured like the rest.
  'decor/lilypads': { w: 190, h: 190, outline: 8 },
  'decor/lilybud': { w: 190, h: 190, outline: 8 },
};

// Trees, bushes, rocks and gold are drawn larger than true size, each by its
// own amount (shared/world.js): the object's radius says how big it is, and
// the sprite is drawn to fit that radius.
export const isNature = (key) => key.startsWith('world/') || key === 'drawn/cactus';

const table = (key) => MEASURED[key] || DRAWN[key];

/** A sprite's size in world units, its hitbox radius, and how far its silhouette's middle sits from the image middle. */
export function spriteInfo(key) {
  const m = table(key);
  if (!m) throw new Error(`no size for sprite ${key}`);
  const k = PX;
  return {
    w: m.w * k, h: m.h * k,
    r: m.r !== undefined ? +(m.r * k).toFixed(2) : undefined,
    dx: m.cx !== undefined ? (m.cx - m.w / 2) * k : 0,
    dy: m.cy !== undefined ? (m.cy - m.h / 2) * k : 0,
  };
}

export const radiusOf = (key) => spriteInfo(key).r;
export const hasSprite = (key) => !!table(key);

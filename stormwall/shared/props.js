// Props: everything on the map that is not a build piece — trees, rocks, cars,
// containers, furniture. Every one has health and a material, so every one can
// be harvested; nothing on the island is scenery you cannot hit.

import { WOOD, STONE, METAL } from './constants.js';
import { makeBox, makeCyl } from './collision.js';

// size: [x, y, z] for boxes; r and h for cylinders (trees collide at the trunk).
export const PROP_KINDS = [
  { name: 'pine', mat: WOOD, hp: 200, shape: 'cyl', r: 0.45, h: 10 },
  { name: 'oak', mat: WOOD, hp: 250, shape: 'cyl', r: 0.6, h: 7.5 },
  { name: 'deadtree', mat: WOOD, hp: 150, shape: 'cyl', r: 0.35, h: 6 },
  { name: 'rock', mat: STONE, hp: 300, shape: 'box', size: [2.8, 1.9, 2.4], sink: 0.35 },
  { name: 'boulder', mat: STONE, hp: 500, shape: 'box', size: [4.4, 3.2, 3.8], sink: 0.35 },
  { name: 'car', mat: METAL, hp: 350, shape: 'box', size: [4.4, 1.5, 1.9] },
  { name: 'truck', mat: METAL, hp: 550, shape: 'box', size: [6.6, 2.8, 2.4] },
  { name: 'container', mat: METAL, hp: 700, shape: 'box', size: [6.1, 2.6, 2.45] },
  { name: 'pallet', mat: WOOD, hp: 90, shape: 'box', size: [1.2, 0.9, 1.0] },
  { name: 'haybale', mat: WOOD, hp: 110, shape: 'box', size: [1.6, 1.5, 1.6] },
  { name: 'crate', mat: WOOD, hp: 100, shape: 'box', size: [1.1, 1.1, 1.1] },
  { name: 'fence', mat: WOOD, hp: 60, shape: 'box', size: [2.6, 1.1, 0.15] },
  { name: 'sofa', mat: WOOD, hp: 120, shape: 'box', size: [2.0, 0.9, 0.9] },
  { name: 'bed', mat: WOOD, hp: 140, shape: 'box', size: [2.1, 0.7, 1.6] },
  { name: 'table', mat: WOOD, hp: 100, shape: 'box', size: [1.6, 0.8, 0.9] },
  { name: 'chair', mat: WOOD, hp: 60, shape: 'box', size: [0.55, 1.0, 0.55] },
  { name: 'shelf', mat: WOOD, hp: 120, shape: 'box', size: [1.3, 2.0, 0.45] },
  { name: 'fridge', mat: METAL, hp: 180, shape: 'box', size: [0.8, 1.9, 0.75] },
  { name: 'stove', mat: METAL, hp: 150, shape: 'box', size: [0.8, 0.95, 0.7] },
  { name: 'washer', mat: METAL, hp: 150, shape: 'box', size: [0.75, 0.95, 0.7] },
  { name: 'toilet', mat: STONE, hp: 90, shape: 'box', size: [0.5, 0.8, 0.7] },
  { name: 'fireplace', mat: STONE, hp: 220, shape: 'box', size: [1.6, 1.6, 0.7] },
  { name: 'pump', mat: METAL, hp: 160, shape: 'box', size: [0.8, 1.7, 0.5] },
  { name: 'barrel', mat: METAL, hp: 100, shape: 'cyl', r: 0.35, h: 1.0 },
  { name: 'silo', mat: METAL, hp: 900, shape: 'cyl', r: 3.0, h: 13 },
  { name: 'tractor', mat: METAL, hp: 400, shape: 'box', size: [3.6, 2.4, 2.0] },
  { name: 'boat', mat: WOOD, hp: 200, shape: 'box', size: [4.2, 1.0, 1.7] },
  { name: 'pipe', mat: METAL, hp: 300, shape: 'box', size: [6.0, 1.2, 1.2] },
  { name: 'tires', mat: STONE, hp: 120, shape: 'cyl', r: 0.55, h: 1.1 },
  { name: 'lamp', mat: METAL, hp: 110, shape: 'cyl', r: 0.15, h: 5.5 },
];
export const PROP = Object.fromEntries(PROP_KINDS.map((k, i) => [k.name, i]));

// Materials per point of damage dealt: a normal 50-damage pickaxe hit yields
// about ten, a tree gives about forty over its life, and a weak-point hit does
// double damage — so it also yields double, and strips an object twice as fast.
export const YIELD_PER_DAMAGE = 0.2;

export const propMaxHp = (p) => Math.round(PROP_KINDS[p.kind].hp * (p.s || 1));

export function propColliders(p) {
  const k = PROP_KINDS[p.kind];
  const s = p.s || 1;
  if (k.shape === 'cyl') return [makeCyl(p.x, p.z, p.y - 0.5, p.y + k.h * s, k.r * s)];
  const [sx, sy, sz] = k.size;
  const c = Math.cos(p.yaw || 0), n = Math.sin(p.yaw || 0);
  const cy = p.y + (sy * s) / 2 - (k.sink || 0) * sy * s;
  return [makeBox(p.x, cy, p.z, (sx * s) / 2, (sy * s) / 2, (sz * s) / 2, [c, 0, -n], [0, 1, 0], [n, 0, c])];
}

/** A point roughly in the middle of the prop, for aiming and effects. */
export function propCenter(p, out = {}) {
  const k = PROP_KINDS[p.kind];
  const s = p.s || 1;
  out.x = p.x; out.z = p.z;
  out.y = k.shape === 'cyl' ? p.y + Math.min(1.4, k.h * s * 0.5) : p.y + (k.size[1] * s) / 2;
  return out;
}

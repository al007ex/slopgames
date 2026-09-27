// Small worlds and helpers shared by the milestone tests.
import { World } from '../shared/world.js';
import { Terrain, SIDE } from '../shared/terrain.js';
import { createMoveState, stepMovement, MODE_WALK } from '../shared/movement.js';
import { CELL, WALL_H } from '../shared/constants.js';

/** A world with flat ground at height h and nothing on it. */
export function flatWorld(h = 0, shape = null) {
  const heights = new Float32Array(SIDE * SIDE).fill(h);
  if (shape) {
    for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) heights[j * SIDE + i] = shape(i * CELL, j * CELL);
  }
  return new World({ seed: 1, terrain: new Terrain(heights), pieces: [], props: [], lootSpots: [], chestSpots: [], ammoSpots: [] });
}

let nextId = 1;
export function piece(world, type, cx, lv, cz, { rot = 0, mat = 0, edit = 0, start = -1 } = {}) {
  return world.addPiece({ id: 100000 + nextId++, type, rot, cx, lv, cz, mat, edit, start, damage: 0, team: 0 });
}

export function standAt(world, x, z) {
  const s = createMoveState(x, world.terrain.heightAt(x, z) + 0.02, z);
  s.mode = MODE_WALK; s.ground = 1;
  return s;
}

/** Runs n ticks of the same input; returns the total fall damage taken. */
export function run(s, world, n, input) {
  let damage = 0;
  for (let i = 0; i < n; i++) damage += stepMovement(s, typeof input === 'function' ? input(i, s) : input, world);
  return damage;
}

export const YAW_EAST = -Math.PI / 2;    // forward = +x
export const YAW_NORTH = 0;              // forward = −z
export { CELL, WALL_H };

/** A generated-world stand-in with flat ground, for match-level tests. */
export function flatBase(h = 3 * 3.84 - 0.02) {
  const heights = new Float32Array(SIDE * SIDE).fill(h);
  return {
    seed: 1, heights, terrain: new Terrain(heights), pieces: [], props: [], pois: [], buildings: [],
    lootSpots: [], chestSpots: [], ammoSpots: [], pregameSpots: [], pregame: { x: 330, z: 330, r: 120, h: 4 }, hash: 0,
  };
}

/** A stationary test player standing on the ground at the centre of a cell. */
export function standIn(match, cx, cz, { name = 'p', team } = {}) {
  const p = match.addPlayer({ name, bot: true, team });
  p.botInput = null;
  match.placeOnGround(p, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
  return p;
}

export const YAW = { east: -Math.PI / 2, west: Math.PI / 2, south: Math.PI, north: 0 };

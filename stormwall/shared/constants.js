// World scale and timing. Everything is in metres and seconds. The build grid is
// the Unreal-unit numbers divided by a hundred — a cell is 512 uu, a wall 384 uu
// — which is the size where one character can stand under a floor.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;

export const CELL = 5.12;              // one build-grid cell, and one terrain sample
export const WALL_H = 3.84;            // one build level
export const GRID_N = 1000;            // cells per side
export const WORLD_SIZE = CELL * GRID_N; // 5120 m
export const WORLD_CENTER = WORLD_SIZE / 2;
export const SEA_LEVEL = 0;
export const MAX_BUILD_Y = 260;        // nothing is placed above this

export const MAX_PLAYERS = 100;

// The capsule. Radius and heights are chosen so a crouched player fits through
// a window edit (a third of a wall) and a standing one clears a ceiling.
export const PLAYER_RADIUS = 0.42;
export const STAND_HEIGHT = 1.85;
export const CROUCH_HEIGHT = 1.25;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;
export const HEAD_RADIUS = 0.24;

export const MAX_HP = 100;
export const MAX_SHIELD = 100;
export const MAT_CAP = 999;
export const AMMO_CAP = 999;
export const INVENTORY_SLOTS = 5;

// Interest management: the world is split into replication cells, and a client
// only hears about players, loot and structural changes in the cells around it.
export const REP_CELL = 64;
export const REP_N = Math.ceil(WORLD_SIZE / REP_CELL);  // 80
export const NEAR_RADIUS = 360;        // full-rate replication and structure deltas
export const FAR_RADIUS = 1400;        // players out to here at a reduced rate
export const FAR_EVERY = 5;            // …every fifth tick

export const MATERIALS = ['wood', 'stone', 'metal'];
export const WOOD = 0;
export const STONE = 1;
export const METAL = 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Build pieces: what they are, where they sit on the grid, what they collide
// as, what holds them up, and how much health they have at any moment.
//
// The grid is global and three-dimensional. A floor or cone sits in a cell at a
// level; a wall sits on one of a cell's edges; a ramp fills a cell and climbs
// one level in one of four directions. Pieces connect wherever they share a
// lattice edge, and a structure stands only while it is connected to something
// touching the ground.

import { CELL, WALL_H, TICK_HZ } from './constants.js';
import { makeBox, makeHull, OWNER_PIECE } from './collision.js';

export const WALL = 0;
export const FLOOR = 1;
export const RAMP = 2;
export const CONE = 3;
export const PIECE_NAMES = ['wall', 'floor', 'ramp', 'cone'];
export const BUILD_COST = 10;

export const THICK = 0.2;
export const CONE_H = WALL_H / 2;
export const LEVEL_OFFSET = 8;         // levels are stored as lv + 8, so -8‥119 fit in seven bits

// Material health. Every piece starts low and fills up while it builds; wood
// fills fastest, so for the first few seconds — the part of a fight that
// matters — a wood wall is the strongest thing you can put down. That one rule
// is why wood is the combat material.
export const MAT_STATS = [
  { name: 'wood', max: 150, start: 40, buildSec: 2.5 },
  { name: 'stone', max: 300, start: 35, buildSec: 9 },
  { name: 'metal', max: 400, start: 30, buildSec: 15 },
];

// Ramp directions: which way it climbs.
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/* --------------------------------------------------------------- slots */

// Slot kinds: a floor, a wall on the x-facing edge (plane x = cx), a wall on the
// z-facing edge (plane z = cz), and the cell centre (ramp or cone).
export const SLOT_FLOOR = 0;
export const SLOT_WALL_X = 1;
export const SLOT_WALL_Z = 2;
export const SLOT_CENTER = 3;

export const slotKindOf = (type, rot) =>
  type === FLOOR ? SLOT_FLOOR : type === WALL ? (rot === 0 ? SLOT_WALL_X : SLOT_WALL_Z) : SLOT_CENTER;

export const slotKey = (kind, cx, lv, cz) => ((kind * 128 + (lv + LEVEL_OFFSET)) * 1024 + cx) * 1024 + cz;
export const pieceSlotKey = (p) => slotKey(slotKindOf(p.type, p.rot), p.cx, p.lv, p.cz);

/* ------------------------------------------------------------- health */

export function buildTicks(mat) { return Math.round(MAT_STATS[mat].buildSec * TICK_HZ); }

/** The piece's ceiling right now: it grows from `start` to `max` while building. */
export function hpCap(piece, tick) {
  const s = MAT_STATS[piece.mat];
  if (piece.start < 0) return s.max;
  const progress = Math.min(1, Math.max(0, (tick - piece.start) / buildTicks(piece.mat)));
  return s.start + (s.max - s.start) * progress;
}
export const hpAt = (piece, tick) => hpCap(piece, tick) - piece.damage;
export const isBuilding = (piece, tick) => piece.start >= 0 && tick - piece.start < buildTicks(piece.mat);

/* -------------------------------------------------------------- edits */

// Walls edit on a 3×3 grid, floors and cones on 2×2. A set bit is a removed
// tile. Row 0 is the bottom (walls) or the low-z side (floors, cones).
export const EDIT_GRID = [
  { cols: 3, rows: 3 },
  { cols: 2, rows: 2 },
  { cols: 2, rows: 2 },
  { cols: 2, rows: 2 },
];
export const WALL_DOOR = (1 << 1) | (1 << 4);
export const WALL_WINDOW = 1 << 4;
export const WALL_ARCH = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);

export function editIsValid(type, mask) {
  const { cols, rows } = EDIT_GRID[type];
  const all = (1 << (cols * rows)) - 1;
  if (type === RAMP) return rampDirFromSelection(mask) >= 0;
  return (mask & all) !== all && (mask & ~all) === 0;
}

// A ramp is edited by selecting the side it should climb towards: the two
// tiles along that edge. Tiles are indexed col + row*2, col along x, row along z.
export function rampDirFromSelection(mask) {
  switch (mask) {
    case 0b1010: return 0;   // the +x column (col 1)
    case 0b1100: return 1;   // the +z row (row 1)
    case 0b0101: return 2;   // the -x column
    case 0b0011: return 3;   // the -z row
    default: return -1;
  }
}

/** Greedy rectangles covering the tiles still present. Returns [col, row, w, h] each. */
export function tileRects(cols, rows, removed) {
  const used = new Uint8Array(cols * rows);
  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (used[i] || (removed >> i) & 1) continue;
      let w = 1;
      while (c + w < cols && !used[i + w] && !((removed >> (i + w)) & 1)) w++;
      let h = 1;
      outer: while (r + h < rows) {
        for (let k = 0; k < w; k++) {
          const j = (r + h) * cols + c + k;
          if (used[j] || (removed >> j) & 1) break outer;
        }
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used[(r + y) * cols + c + x] = 1;
      rects.push([c, r, w, h]);
    }
  }
  return rects;
}

/* ---------------------------------------------------------- geometry */

/**
 * Solid boxes making up a piece, as {x, y, z, hx, hy, hz, ux, uy, uz} — used
 * for colliders and, on the client, for meshes. Cones are hulls, see coneHulls.
 */
export function pieceBoxes(p) {
  const boxes = [];
  const x0 = p.cx * CELL;
  const z0 = p.cz * CELL;
  const y0 = p.lv * WALL_H;
  if (p.type === WALL) {
    const tw = CELL / 3, th = WALL_H / 3;
    for (const [c, r, w, h] of tileRects(3, 3, p.edit)) {
      const along = (c + w / 2) * tw;
      const y = y0 + (r + h / 2) * th;
      if (p.rot === 0) boxes.push({ x: x0, y, z: z0 + along, hx: THICK / 2, hy: (h * th) / 2, hz: (w * tw) / 2 });
      else boxes.push({ x: x0 + along, y, z: z0, hx: (w * tw) / 2, hy: (h * th) / 2, hz: THICK / 2 });
    }
  } else if (p.type === FLOOR) {
    const t = CELL / 2;
    for (const [c, r, w, h] of tileRects(2, 2, p.edit)) {
      boxes.push({ x: x0 + (c + w / 2) * t, y: y0, z: z0 + (r + h / 2) * t, hx: (w * t) / 2, hy: THICK / 2, hz: (h * t) / 2 });
    }
  } else if (p.type === RAMP) {
    const [dx, dz] = DIRS[p.rot];
    // A 4:3:5 triangle — a 5.12 run, a 3.84 rise, a 6.4 slope — so the slope's
    // sine and cosine are exactly 0.6 and 0.8.
    const s = [0.8 * dx, 0.6, 0.8 * dz];
    const n = [-0.6 * dx, 0.8, -0.6 * dz];
    const w = [dz, 0, -dx];
    const top = [x0 + CELL / 2, y0 + THICK / 2 + WALL_H / 2, z0 + CELL / 2];
    boxes.push({
      x: top[0] - n[0] * THICK / 2, y: top[1] - n[1] * THICK / 2, z: top[2] - n[2] * THICK / 2,
      hx: 3.2, hy: THICK / 2, hz: CELL / 2, ux: s, uy: n, uz: w,
    });
  }
  return boxes;
}

/** Cones: a square pyramid, or the quadrants of one that were not edited away. */
export function coneHulls(p) {
  const a = CELL / 2;
  const xc = p.cx * CELL + a, zc = p.cz * CELL + a;
  const y0 = p.lv * WALL_H;
  const len = Math.sqrt(CONE_H * CONE_H + a * a);
  const nh = CONE_H / len, na = a / len;
  const base = [
    0, -1, 0, -y0,
    nh, na, 0, nh * (xc + a) + na * y0,
    -nh, na, 0, -nh * (xc - a) + na * y0,
    0, na, nh, nh * (zc + a) + na * y0,
    0, na, -nh, -nh * (zc - a) + na * y0,
  ];
  const hulls = [];
  if (!p.edit) {
    hulls.push({ planes: base, min: [xc - a, y0, zc - a], max: [xc + a, y0 + CONE_H, zc + a] });
    return hulls;
  }
  for (let q = 0; q < 4; q++) {
    if ((p.edit >> q) & 1) continue;
    const qx = q & 1, qz = q >> 1;
    const planes = base.slice();
    planes.push(qx ? -1 : 1, 0, 0, qx ? -xc : xc);
    planes.push(0, 0, qz ? -1 : 1, qz ? -zc : zc);
    hulls.push({
      planes,
      min: [qx ? xc : xc - a, y0, qz ? zc : zc - a],
      max: [qx ? xc + a : xc, y0 + CONE_H, qz ? zc + a : zc],
    });
  }
  return hulls;
}

/** Collision shapes for a piece, tagged with its id. */
export function pieceColliders(p) {
  const out = [];
  if (p.type === CONE) {
    for (const h of coneHulls(p)) {
      const c = makeHull(h.planes, h.min[0], h.min[1], h.min[2], h.max[0], h.max[1], h.max[2]);
      c.kind = OWNER_PIECE; c.ref = p.id;
      out.push(c);
    }
    return out;
  }
  for (const b of pieceBoxes(p)) {
    const c = makeBox(b.x, b.y, b.z, b.hx, b.hy, b.hz, b.ux, b.uy, b.uz);
    c.kind = OWNER_PIECE; c.ref = p.id;
    out.push(c);
  }
  return out;
}

export function pieceCenter(p, out = {}) {
  const x0 = p.cx * CELL, z0 = p.cz * CELL, y0 = p.lv * WALL_H;
  if (p.type === WALL) {
    out.x = p.rot === 0 ? x0 : x0 + CELL / 2;
    out.z = p.rot === 0 ? z0 + CELL / 2 : z0;
    out.y = y0 + WALL_H / 2;
  } else {
    out.x = x0 + CELL / 2;
    out.z = z0 + CELL / 2;
    out.y = p.type === FLOOR ? y0 : p.type === RAMP ? y0 + WALL_H / 2 : y0 + CONE_H / 3;
  }
  return out;
}

/* ------------------------------------------------------------ support */

// Lattice edges: along x (0), along z (1) or vertical (2), from lattice point
// (X, Y, Z). Two pieces sharing an edge hold each other up.
export const edgeKey = (axis, X, Y, Z) => ((axis * 128 + (Y + LEVEL_OFFSET)) * 1024 + X) * 1024 + Z;

export function pieceSockets(p) {
  const { cx, lv, cz } = p;
  switch (p.type) {
    case FLOOR:
    case CONE:
      return [edgeKey(0, cx, lv, cz), edgeKey(0, cx, lv, cz + 1), edgeKey(1, cx, lv, cz), edgeKey(1, cx + 1, lv, cz)];
    case WALL:
      return p.rot === 0
        ? [edgeKey(1, cx, lv, cz), edgeKey(1, cx, lv + 1, cz), edgeKey(2, cx, lv, cz), edgeKey(2, cx, lv, cz + 1)]
        : [edgeKey(0, cx, lv, cz), edgeKey(0, cx, lv + 1, cz), edgeKey(2, cx, lv, cz), edgeKey(2, cx + 1, lv, cz)];
    case RAMP:
      switch (p.rot) {
        case 0: return [edgeKey(1, cx, lv, cz), edgeKey(1, cx + 1, lv + 1, cz), edgeKey(0, cx, lv, cz), edgeKey(0, cx, lv, cz + 1)];
        case 1: return [edgeKey(0, cx, lv, cz), edgeKey(0, cx, lv + 1, cz + 1), edgeKey(1, cx, lv, cz), edgeKey(1, cx + 1, lv, cz)];
        case 2: return [edgeKey(1, cx + 1, lv, cz), edgeKey(1, cx, lv + 1, cz), edgeKey(0, cx, lv, cz), edgeKey(0, cx, lv, cz + 1)];
        default: return [edgeKey(0, cx, lv, cz + 1), edgeKey(0, cx, lv + 1, cz), edgeKey(1, cx, lv, cz), edgeKey(1, cx + 1, lv, cz)];
      }
    default:
      return [];
  }
}

const GROUND_TOLERANCE = 0.35;

/** Does the piece rest on (or in) the terrain? Grounded pieces anchor structures. */
export function isGrounded(p, terrain) {
  const x0 = p.cx * CELL, z0 = p.cz * CELL, y0 = p.lv * WALL_H;
  const touches = (x, z, y) => terrain.heightAt(x, z) >= y - GROUND_TOLERANCE;
  if (p.type === WALL) {
    for (const f of [0.1, 0.5, 0.9]) {
      if (p.rot === 0 ? touches(x0, z0 + f * CELL, y0) : touches(x0 + f * CELL, z0, y0)) return true;
    }
    return false;
  }
  if (p.type === RAMP) {
    const [dx, dz] = DIRS[p.rot];
    for (const along of [0.05, 0.35, 0.65, 0.95]) {
      for (const side of [0.1, 0.9]) {
        // Position along the climb, measured from the low edge.
        const ax = dx > 0 ? along : dx < 0 ? 1 - along : side;
        const az = dz > 0 ? along : dz < 0 ? 1 - along : side;
        if (touches(x0 + ax * CELL, z0 + az * CELL, y0 + along * WALL_H)) return true;
      }
    }
    return false;
  }
  for (const [fx, fz] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) {
    if (touches(x0 + fx * CELL, z0 + fz * CELL, y0)) return true;
  }
  return false;
}

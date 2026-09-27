// Where a piece goes when you press build. One function decides it for the
// client's preview ghost and for the server's check, so what you see is what
// you get. The rules follow the feel of the original:
//
//  wall   on the next grid line in front of you, at your level (one up if you
//         look up steeply)
//  floor  the cell in front at your feet's level, your own cell if you look
//         down, or the level above if you look up
//  ramp   the cell across the next grid line, climbing away from you — and if
//         you are already running up a ramp, one level higher, so ramps chain
//  cone   over your own cell, one level up

import { CELL, WALL_H, MAX_BUILD_Y, GRID_N } from './constants.js';
import {
  WALL, FLOOR, RAMP, CONE, DIRS, BUILD_COST, slotKey, slotKindOf, pieceColliders, SLOT_CENTER,
} from './pieces.js';
import { capsulePenetration } from './collision.js';
import { PLAYER_RADIUS } from './constants.js';
import { capsuleHeight } from './movement.js';

export const BUILD_REACH = 9;             // metres from you to the piece's centre
export const PLACE_INTERVAL_TICKS = 3;    // one piece per 0.1 s at most: clicks, not a hose
export const LIFT_LIMIT = 2.0;            // a floor or ramp put under you may lift you this far onto it

/** The compass direction you face: 0 +x, 1 +z, 2 −x, 3 −z (same as ramp directions). */
export function facing(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Math.abs(fx) >= Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
}

/** Is there a ramp under (x, y, z) climbing in direction `dir`? */
function onRampClimbing(world, x, y, z, dir) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  const lv = Math.floor((y - 0.05) / WALL_H);
  const p = world.slots.get(slotKey(SLOT_CENTER, cx, lv, cz));
  return !!(p && p.alive && p.type === RAMP && p.rot === dir);
}

export function buildTarget(type, move, yaw, pitch, world, out = {}) {
  const dir = facing(yaw);
  const [dx, dz] = DIRS[dir];
  const x = move.x, y = move.y, z = move.z;
  const feetLv = Math.floor((y + 0.4) / WALL_H);
  const pcx = Math.floor(x / CELL), pcz = Math.floor(z / CELL);
  // The next grid line ahead. Walls want it at least a body-width in front of
  // you, so you never wall yourself in on a line you stand on; ramps and floors
  // take the very next one, so a ramp rush never skips a cell.
  const along = dx ? x : z;
  const s = dx || dz;
  const clear = PLAYER_RADIUS + 0.15;       // a wall never goes up through your own body
  const wallLine = s > 0 ? Math.ceil((along + clear) / CELL) : Math.floor((along - clear) / CELL);
  const line = s > 0 ? Math.ceil((along + 1e-6) / CELL) : Math.floor((along - 1e-6) / CELL);
  const toLine = Math.abs(line * CELL - along);
  out.type = type;
  out.rot = 0;
  switch (type) {
    case WALL: {
      out.rot = dx ? 0 : 1;
      out.cx = dx ? wallLine : pcx;
      out.cz = dx ? pcz : wallLine;
      out.lv = feetLv + (pitch > 0.75 ? 1 : 0);
      break;
    }
    case FLOOR: {
      const down = pitch < -0.85;
      const next = s > 0 ? line : line - 1;       // the cell beyond the line ahead
      out.cx = down ? pcx : dx ? next : pcx;
      out.cz = down ? pcz : dx ? pcz : next;
      out.lv = feetLv + (pitch > 0.45 ? 1 : 0);
      break;
    }
    case RAMP: {
      // From the back of a cell the ramp goes in your own cell (a ramp inside
      // a box); from the front half it goes across the line ahead.
      const own = toLine >= CELL * 0.6;
      const next = own ? (dx ? pcx : pcz) : s > 0 ? line : line - 1;
      out.rot = dir;
      out.cx = dx ? next : pcx;
      out.cz = dx ? pcz : next;
      if (own) { out.lv = feetLv; break; }
      // Your feet's height when you reach the line: if you are climbing a ramp
      // that way, it keeps rising, so the next ramp starts a level up.
      const climbing = onRampClimbing(world, x, y, z, dir);
      const atLine = y + (climbing ? toLine * (WALL_H / CELL) : 0);
      out.lv = Math.round(atLine / WALL_H - 0.02);
      if (!climbing) out.lv = Math.min(out.lv, feetLv);
      break;
    }
    case CONE: {
      out.cx = pcx;
      out.cz = pcz;
      out.lv = feetLv + 1;
      break;
    }
    default:
      return null;
  }
  return out;
}

/** The piece record a target slot describes (without id). */
export function pieceAt(target, mat, team = 0, start = 0) {
  return { type: target.type, rot: target.rot, cx: target.cx, lv: target.lv, cz: target.cz, mat, edit: 0, start, damage: 0, team };
}

/**
 * Why a piece cannot go there, or null if it can. `players` are the capsules
 * that must not end up inside it: walls refuse to be built in anyone; floors,
 * ramps and cones may lift people standing in them a little, like stepping
 * onto a ramp you just put under your feet.
 */
export function placementProblem(world, target, { mats = null, mat = 0, players = [], builder = null } = {}) {
  if (!target) return 'nowhere';
  const { cx, cz, lv } = target;
  if (cx < 1 || cz < 1 || cx >= GRID_N - 1 || cz >= GRID_N - 1) return 'edge of the world';
  if (lv * WALL_H > MAX_BUILD_Y || lv < -4) return 'too high';
  if (mats && mats[mat] < BUILD_COST) return 'not enough materials';
  const kind = slotKindOf(target.type, target.rot);
  const existing = world.slots.get(slotKey(kind, cx, lv, cz));
  if (existing && existing.alive) return 'occupied';
  const piece = pieceAt(target, mat);
  if (!world.wouldBeSupported(piece)) return 'nothing to attach to';
  if (builder) {
    const c = pieceCentre(piece);
    const ex = builder.x - c.x, ey = builder.y + 1 - c.y, ez = builder.z - c.z;
    if (ex * ex + ey * ey + ez * ez > BUILD_REACH * BUILD_REACH) return 'out of reach';
  }
  const cols = pieceColliders({ ...piece, id: -1 });
  for (const m of players) {
    if (overlaps(m, cols)) {
      if (target.type === WALL) return 'someone is in the way';
      if (liftFor(world, m, cols) === null) return 'someone is in the way';
    }
  }
  return null;
}

const contact = {};
function overlaps(m, cols, dy = 0, tolerance = 0.03) {
  const r = PLAYER_RADIUS, h = capsuleHeight(m);
  for (const c of cols) {
    if (capsulePenetration(m.x, m.y + dy + r, m.z, m.x, m.y + dy + h - r, m.z, r, c, contact) > tolerance) return true;
  }
  return false;
}

/** How far a capsule must rise to clear the new piece (0 if it is clear), or null if too far. */
export function liftFor(world, m, cols) {
  if (!overlaps(m, cols, 0)) return 0;
  // Rise until clear of it — properly on top, not just under the tolerance.
  for (let dy = 0.02; dy <= LIFT_LIMIT + 1e-9; dy += 0.02) {
    if (!overlaps(m, cols, dy, 0.002)) return dy;
  }
  return null;
}

function pieceCentre(p) {
  const x0 = p.cx * CELL, z0 = p.cz * CELL, y0 = p.lv * WALL_H;
  if (p.type === WALL) return p.rot === 0 ? { x: x0, y: y0 + WALL_H / 2, z: z0 + CELL / 2 } : { x: x0 + CELL / 2, y: y0 + WALL_H / 2, z: z0 };
  return { x: x0 + CELL / 2, y: y0 + (p.type === RAMP ? WALL_H / 2 : 0.5), z: z0 + CELL / 2 };
}

export { WALL, FLOOR, RAMP, CONE };

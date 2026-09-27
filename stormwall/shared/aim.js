// Third-person aiming, shared by the client's camera and the server's shots.
// The crosshair looks along the view direction from a point beside the head;
// a shot goes from the player's eye towards whatever that line hits first.
// So you cannot shoot through a wall your character is behind, even when the
// over-the-shoulder camera can see past it — and both sides agree exactly.

import { eyeHeight } from './movement.js';

export const CAM_BACK = 2.7;
export const CAM_RIGHT = 0.62;
export const CAM_UP = 0.3;
export const ADS_BACK = 1.25;
export const ADS_RIGHT = 0.78;
export const ADS_UP = 0.26;

export function viewDir(yaw, pitch, out = {}) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** The eye, the aim origin (beside the head) and the view direction. */
export function aimFrame(move, yaw, pitch, ads, out = {}) {
  const eye = eyeHeight(move);
  out.ex = move.x; out.ey = move.y + eye; out.ez = move.z;
  const right = ads ? ADS_RIGHT : CAM_RIGHT, up = ads ? ADS_UP : CAM_UP;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out.ox = out.ex + c * right; out.oy = out.ey + up; out.oz = out.ez - s * right;
  viewDir(yaw, pitch, out.dir || (out.dir = {}));
  return out;
}

/**
 * Where the crosshair points: the first thing along the aim line (or a point
 * `range` away). Returns {x, y, z, t, hit}. `grid` is a CollisionGrid.
 */
export function aimPoint(frame, grid, range, out = {}, skip = null) {
  const d = frame.dir;
  const hit = aimHit;
  const t = grid.raycast(frame.ox, frame.oy, frame.oz, d.x, d.y, d.z, range, hit, skip);
  const tt = t < Infinity ? t : range;
  out.x = frame.ox + d.x * tt; out.y = frame.oy + d.y * tt; out.z = frame.oz + d.z * tt;
  out.t = tt; out.hit = t < Infinity ? hit.collider : undefined;
  return out;
}
const aimHit = {};

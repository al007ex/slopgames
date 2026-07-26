// Kinematic AABB collision + raycasting.
//
// Imported by BOTH the browser client (player movement, local shot preview) and
// the Node server (enemy grounding, authoritative hit registration). Sharing the
// file is the whole point: the two sides can never disagree about where a wall is.

import { STEP_HEIGHT } from './constants.js';

const EPS = 1e-3;

// ---------------------------------------------------------------- world build

function toAABB(b, extra) {
  const [cx, by, cz] = b.p;
  const [w, h, d] = b.s;
  return {
    min: [cx - w / 2, by, cz - d / 2],
    max: [cx + w / 2, by + h, cz + d / 2],
    color: b.c,
    ...extra,
  };
}

function toSlope(s) {
  const a = toAABB(s, {});
  return {
    ...a,
    dir: s.dir,
    baseY: s.p[1],
    rise: s.s[1],
  };
}

/** Turn a level definition into the flat structure the collider walks over. */
export function buildWorld(level) {
  const world = {
    boxes: (level.boxes || []).map((b) => toAABB(b, { solid: true })),
    slopes: (level.slopes || []).map(toSlope),
    gates: (level.gates || []).map((g) => toAABB(g, { solid: true, gateId: g.id, open: false })),
    ground: null,
    killY: level.kill ?? -25,
  };
  if (level.ground) {
    const [w, d] = level.ground.size;
    const [cx, cz] = level.ground.center || [0, 0];
    world.ground = { y: 0, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
  }
  return world;
}

export function setGate(world, id, open) {
  for (const g of world.gates) if (g.gateId === id) g.open = open;
}

/** Every solid box right now (closed gates count, open ones do not). */
function solids(world) {
  const out = world.boxes;
  if (!world.gates.length) return out;
  const list = out.slice();
  for (const g of world.gates) if (!g.open) list.push(g);
  return list;
}

// ---------------------------------------------------------------- height query

function slopeSurface(s, x, z) {
  const w = s.max[0] - s.min[0];
  const d = s.max[2] - s.min[2];
  let t;
  switch (s.dir) {
    case '+x': t = (x - s.min[0]) / w; break;
    case '-x': t = (s.max[0] - x) / w; break;
    case '+z': t = (z - s.min[2]) / d; break;
    default:   t = (s.max[2] - z) / d; break; // '-z'
  }
  t = Math.max(0, Math.min(1, t));
  return s.baseY + t * s.rise;
}

function insideXZ(a, x, z, pad = 0) {
  return x >= a.min[0] - pad && x <= a.max[0] + pad && z >= a.min[2] - pad && z <= a.max[2] + pad;
}

/**
 * Highest walkable surface at (x,z) that is at or below `ceil`.
 * Used for standing NPCs, enemy grounding and spawn snapping.
 */
export function surfaceHeightAt(world, x, z, ceil = Infinity) {
  let best = -Infinity;
  for (const b of solids(world)) {
    if (!insideXZ(b, x, z)) continue;
    if (b.max[1] <= ceil + 0.05 && b.max[1] > best) best = b.max[1];
  }
  for (const s of world.slopes) {
    if (!insideXZ(s, x, z)) continue;
    const y = slopeSurface(s, x, z);
    if (y <= ceil + 0.05 && y > best) best = y;
  }
  const g = world.ground;
  if (g && x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) {
    if (g.y <= ceil + 0.05 && g.y > best) best = g.y;
  }
  return best === -Infinity ? null : best;
}

// ---------------------------------------------------------------- box overlap

function overlapsBody(b, x, y, z, r, h) {
  return (
    x + r > b.min[0] && x - r < b.max[0] &&
    y + h > b.min[1] + EPS && y < b.max[1] - EPS &&
    z + r > b.min[2] && z - r < b.max[2]
  );
}

/** Is a body of this size free-standing at (x,y,z)? */
function fits(list, x, y, z, r, h) {
  for (const b of list) if (overlapsBody(b, x, y, z, r, h)) return false;
  return true;
}

/**
 * Move a capsule-ish body (approximated as a box r x h x r, `pos` = feet centre)
 * by `disp`, resolving one axis at a time. Mutates and returns `pos`.
 *
 * Returns flags: grounded, ceiling, wallNormal (last wall pushed off), groundY.
 */
export function collideMove(world, pos, r, h, disp) {
  const list = solids(world);
  const res = { grounded: false, ceiling: false, wallNormal: null, hitWall: false };

  // ---- horizontal, twice, so a push-out cannot leave us inside a second box
  for (let pass = 0; pass < 2; pass++) {
    const dx = pass === 0 ? disp[0] : 0;
    const dz = pass === 0 ? disp[2] : 0;
    pos[0] += dx;
    for (const b of list) {
      if (!overlapsBody(b, pos[0], pos[1], pos[2], r, h)) continue;
      const stepTo = b.max[1];
      if (stepTo > pos[1] && stepTo - pos[1] <= STEP_HEIGHT &&
          fits(list, pos[0], stepTo + EPS, pos[2], r, h)) {
        pos[1] = stepTo + EPS;
        res.grounded = true;
        continue;
      }
      if (dx > 0 || (dx === 0 && pos[0] < (b.min[0] + b.max[0]) / 2)) {
        pos[0] = b.min[0] - r - EPS;
        res.wallNormal = [-1, 0, 0];
      } else {
        pos[0] = b.max[0] + r + EPS;
        res.wallNormal = [1, 0, 0];
      }
      res.hitWall = true;
    }

    pos[2] += dz;
    for (const b of list) {
      if (!overlapsBody(b, pos[0], pos[1], pos[2], r, h)) continue;
      const stepTo = b.max[1];
      if (stepTo > pos[1] && stepTo - pos[1] <= STEP_HEIGHT &&
          fits(list, pos[0], stepTo + EPS, pos[2], r, h)) {
        pos[1] = stepTo + EPS;
        res.grounded = true;
        continue;
      }
      if (dz > 0 || (dz === 0 && pos[2] < (b.min[2] + b.max[2]) / 2)) {
        pos[2] = b.min[2] - r - EPS;
        res.wallNormal = [0, 0, -1];
      } else {
        pos[2] = b.max[2] + r + EPS;
        res.wallNormal = [0, 0, 1];
      }
      res.hitWall = true;
    }
  }

  // ---- vertical
  pos[1] += disp[1];
  for (const b of list) {
    if (!overlapsBody(b, pos[0], pos[1], pos[2], r, h)) continue;
    if (disp[1] <= 0) {
      pos[1] = b.max[1];
      res.grounded = true;
    } else {
      pos[1] = b.min[1] - h - EPS;
      res.ceiling = true;
    }
  }

  // ---- slopes are walk-on-top only (no side blocking); they win if higher
  for (const s of world.slopes) {
    if (!insideXZ(s, pos[0], pos[2], r * 0.5)) continue;
    const sy = slopeSurface(s, pos[0], pos[2]);
    if (pos[1] <= sy + 0.35 && pos[1] > s.baseY - 1.2 && disp[1] <= 0.05) {
      pos[1] = sy;
      res.grounded = true;
    }
  }

  // ---- the flat ground plane
  const g = world.ground;
  if (g && pos[0] >= g.minX && pos[0] <= g.maxX && pos[2] >= g.minZ && pos[2] <= g.maxZ) {
    if (pos[1] < g.y) {
      pos[1] = g.y;
      res.grounded = true;
    }
  }

  if (res.grounded) res.groundY = pos[1];
  return res;
}

/** Can this body stand up (uncrouch) where it is? */
export function hasHeadroom(world, pos, r, h) {
  return fits(solids(world), pos[0], pos[1], pos[2], r, h);
}

/** Is there a wall within `reach` horizontally? Returns its outward normal. */
export function wallProbe(world, pos, r, h, reach = 0.35) {
  const list = solids(world);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const x = pos[0] + dx * reach;
    const z = pos[2] + dz * reach;
    for (const b of list) {
      if (overlapsBody(b, x, pos[1] + 0.3, z, r, Math.max(0.5, h - 0.5))) {
        return [-dx, 0, -dz];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- raycasting

/** Slab test. Returns entry distance, or -1. */
export function rayAABB(o, d, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (min[i] - o[i]) * inv;
      let t2 = (max[i] - o[i]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

function normalAt(b, p) {
  const n = [0, 0, 0];
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const dLo = Math.abs(p[i] - b.min[i]);
    const dHi = Math.abs(p[i] - b.max[i]);
    if (dLo < best) { best = dLo; n[0] = 0; n[1] = 0; n[2] = 0; n[i] = -1; }
    if (dHi < best) { best = dHi; n[0] = 0; n[1] = 0; n[2] = 0; n[i] = 1; }
  }
  return n;
}

/** Nearest level-geometry hit along a ray. */
export function raycastWorld(world, o, d, maxDist) {
  let best = maxDist;
  let hitBox = null;
  const list = solids(world);
  for (const b of list) {
    const t = rayAABB(o, d, b.min, b.max);
    if (t >= 0 && t < best) { best = t; hitBox = b; }
  }
  for (const s of world.slopes) {
    const t = rayAABB(o, d, s.min, s.max);
    if (t >= 0 && t < best) { best = t; hitBox = s; }
  }
  const g = world.ground;
  if (g && d[1] < -1e-8) {
    const t = (g.y - o[1]) / d[1];
    if (t >= 0 && t < best) {
      const x = o[0] + d[0] * t;
      const z = o[2] + d[2] * t;
      if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) {
        return { hit: true, dist: t, point: [x, g.y, z], normal: [0, 1, 0], ground: true };
      }
    }
  }
  if (!hitBox) return { hit: false, dist: maxDist, point: [o[0] + d[0] * maxDist, o[1] + d[1] * maxDist, o[2] + d[2] * maxDist], normal: [0, 1, 0] };
  const point = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
  return { hit: true, dist: best, point, normal: normalAt(hitBox, point) };
}

/** Clear line of sight between two points (used by ranged enemy AI). */
export function hasLineOfSight(world, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.001) return true;
  d[0] /= len; d[1] /= len; d[2] /= len;
  const r = raycastWorld(world, a, d, len - 0.2);
  return !r.hit;
}

// ---------------------------------------------------------------- misc math

export function dist2D(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function dist3D(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

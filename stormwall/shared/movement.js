// The character controller. The server runs it to decide where everyone is; the
// client runs the very same function on its own inputs to predict where it is
// before the server has answered, then replays unacknowledged inputs on top of
// each correction. Anything that affects movement must live in here.

import {
  DT, WALL_H, WORLD_SIZE, PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, EYE_STAND, EYE_CROUCH, clamp,
} from './constants.js';
import { capsulePenetration } from './collision.js';

export const MODE_WALK = 0;
export const MODE_SKYDIVE = 1;
export const MODE_GLIDE = 2;
export const MODE_BUS = 3;
export const MODE_DBNO = 4;
export const MODE_DEAD = 5;

export const BTN_JUMP = 1;
export const BTN_SPRINT = 2;
export const BTN_CROUCH = 4;
export const BTN_FIRE = 8;
export const BTN_ADS = 16;
export const BTN_USE = 32;

// Speeds in m/s. Walking is the default — sprint is held, and there is no
// stamina — and there is no sliding or mantling.
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 6.6;
export const CROUCH_SPEED = 2.4;
export const ADS_SPEED = 3.2;
export const CRAWL_SPEED = 1.4;
export const GRAVITY = 20;
export const JUMP_SPEED = 7.75;        // a ~1.37 m hop at 30 Hz (gravity acts on the take-off tick too)
export const TERMINAL_FALL = 60;
export const STEP_HEIGHT = 0.55;
const GROUND_ACCEL = 70;
const GROUND_FRICTION = 55;
const AIR_ACCEL = 9;
const WALKABLE = 0.64;                 // cos of the steepest walkable slope (~50°)
const SNAP_DOWN = 0.4;
const MAX_SUBSTEP = 0.3;
const SKIN = 0.001;

// Skydiving. Freefall is the default; hold forward and look down to dive.
export const FREEFALL_SPEED = 13;
export const FREEFALL_FORWARD = 24;
export const DIVE_SPEED = 42;
export const DIVE_FORWARD = 11;
export const GLIDE_FALL = 6.5;
export const GLIDE_FORWARD = 14;
export const GLIDER_DEPLOY_AGL = 85;   // the glider opens this far above the ground

// Fall damage starts past three wall heights and is lethal at seven.
export const FALL_SAFE = 3 * WALL_H;
export const FALL_LETHAL = 7 * WALL_H;
export function fallDamage(drop) {
  if (drop <= FALL_SAFE) return 0;
  return Math.min(100, Math.ceil(((drop - FALL_SAFE) / (FALL_LETHAL - FALL_SAFE)) * 100));
}

export const DEEP_WATER = -1.5;        // the invisible shoreline nobody can cross

export function createMoveState(x = 0, y = 0, z = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    mode: MODE_WALK, ground: 0, crouch: 0, peakY: y,
    jumpLatch: 0, crouchLatch: 0,
  };
}

export function copyMoveState(from, to = {}) {
  to.x = from.x; to.y = from.y; to.z = from.z;
  to.vx = from.vx; to.vy = from.vy; to.vz = from.vz;
  to.mode = from.mode; to.ground = from.ground; to.crouch = from.crouch; to.peakY = from.peakY;
  to.jumpLatch = from.jumpLatch; to.crouchLatch = from.crouchLatch;
  return to;
}

export const capsuleHeight = (s) => (s.mode === MODE_DBNO ? CROUCH_HEIGHT * 0.7 : s.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
export const eyeHeight = (s) => (s.mode === MODE_DBNO ? 0.6 : s.crouch ? EYE_CROUCH : EYE_STAND);

export function forwardOf(yaw, out = {}) { out.x = -Math.sin(yaw); out.z = -Math.cos(yaw); return out; }

const contact = { depth: 0, nx: 0, ny: 0, nz: 0, t: 0 };
const tsample = { h: 0, nx: 0, ny: 1, nz: 0 };
const nearby = [];

/**
 * Pushes the capsule out of everything it overlaps. Returns the highest
 * ground-facing normal y seen (0 if none), and clips velocity against contacts.
 */
function resolve(s, height, world, cols, clipVelocity) {
  const r = PLAYER_RADIUS;
  let best = 0;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    // Terrain first: a sphere at the capsule's foot against the triangle below.
    world.terrain.sample(s.x, s.z, tsample);
    const dist = (s.y + r - tsample.h) * tsample.ny;
    if (dist < r) {
      const push = r - dist + SKIN;
      s.x += tsample.nx * push; s.y += tsample.ny * push; s.z += tsample.nz * push;
      if (tsample.ny > best) best = tsample.ny;
      if (clipVelocity) clip(s, tsample.nx, tsample.ny, tsample.nz);
      moved = true;
    }
    if (s.y < tsample.h - 1) s.y = tsample.h;     // tunnelled: put back on top
    // Then the deepest overlap among nearby shapes.
    let deepest = 0, dnx = 0, dny = 0, dnz = 0;
    const ay = s.y + r, by = s.y + height - r;
    for (let i = 0; i < cols.length; i++) {
      const d = capsulePenetration(s.x, ay, s.z, s.x, by, s.z, r, cols[i], contact);
      if (d > deepest) { deepest = d; dnx = contact.nx; dny = contact.ny; dnz = contact.nz; }
    }
    if (deepest > 0) {
      const push = deepest + SKIN;
      s.x += dnx * push; s.y += dny * push; s.z += dnz * push;
      if (dny > best) best = dny;
      if (clipVelocity) clip(s, dnx, dny, dnz);
      moved = true;
    }
    if (!moved) break;
  }
  return best;
}

function clip(s, nx, ny, nz) {
  const into = s.vx * nx + s.vy * ny + s.vz * nz;
  if (into < 0) { s.vx -= nx * into; s.vy -= ny * into; s.vz -= nz * into; }
}

function gather(s, height, world, reach) {
  const r = PLAYER_RADIUS + reach;
  world.grid.query(s.x - r, s.y - reach - 0.5, s.z - r, s.x + r, s.y + height + reach, s.z + r, nearby);
  return nearby;
}

function blockedByShore(world, x, z) {
  if (x < 1 || z < 1 || x > WORLD_SIZE - 1 || z > WORLD_SIZE - 1) return true;
  return world.terrain.heightAt(x, z) < DEEP_WATER;
}

/** Moves the capsule by (dx, dy, dz) in substeps, resolving after each one. */
function slide(s, dx, dy, dz, height, world, cols) {
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  let groundNy = 0;
  for (let i = 0; i < n; i++) {
    const px = s.x, pz = s.z;
    s.x += dx / n; s.y += dy / n; s.z += dz / n;
    if (blockedByShore(world, s.x, s.z)) { s.x = px; s.z = pz; s.vx = 0; s.vz = 0; }
    const ny = resolve(s, height, world, cols, true);
    if (ny > groundNy) groundNy = ny;
  }
  return groundNy;
}

/** Deepest overlap of the capsule with terrain or shapes (no pushing). */
function overlap(s, height, world, cols, out) {
  const r = PLAYER_RADIUS;
  world.terrain.sample(s.x, s.z, tsample);
  let depth = r - (s.y + r - tsample.h) * tsample.ny;
  out.ny = tsample.ny;
  const ay = s.y + r, by = s.y + height - r;
  for (let i = 0; i < cols.length; i++) {
    const d = capsulePenetration(s.x, ay, s.z, s.x, by, s.z, r, cols[i], contact);
    if (d > depth) { depth = d; out.ny = contact.ny; }
  }
  out.depth = depth;
  return depth;
}
const lap = { depth: 0, ny: 0 };

/**
 * Lowers the capsule by up to `dist` until it first touches something, and
 * leaves it resting there. Returns the up-component of the surface touched
 * (0 if nothing was within reach, in which case the capsule is not moved).
 */
function sweepDown(s, dist, height, world, cols) {
  const y0 = s.y;
  const stepSize = 0.05;
  for (let moved = 0; moved < dist;) {
    const d = Math.min(stepSize, dist - moved);
    s.y -= d;
    moved += d;
    if (overlap(s, height, world, cols, lap) > 0) {
      let lo = s.y, hi = s.y + d;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        s.y = mid;
        if (overlap(s, height, world, cols, lap) > 0) lo = mid; else hi = mid;
      }
      s.y = lo;
      overlap(s, height, world, cols, lap);
      const ny = lap.ny;
      s.y = hi;
      return ny;
    }
  }
  s.y = y0;
  return 0;
}

const before = {};
const stepped = {};

/**
 * Advances one tick. `input` has mx (strafe) and mz (forward) in −1‥1, yaw,
 * pitch and a button mask. Returns fall damage taken on landing (0 usually).
 */
export function stepMovement(s, input, world, dt = DT) {
  if (s.mode === MODE_BUS || s.mode === MODE_DEAD) return 0;
  if (s.mode === MODE_SKYDIVE || s.mode === MODE_GLIDE) return stepAir(s, input, world, dt);

  const buttons = input.buttons | 0;
  const dbno = s.mode === MODE_DBNO;

  // Crouch toggles on the press, and only stands up if there is room.
  const crouchDown = (buttons & BTN_CROUCH) !== 0;
  if (!dbno && crouchDown && !s.crouchLatch) {
    if (s.crouch) { if (canStand(s, world)) s.crouch = 0; } else s.crouch = 1;
  }
  s.crouchLatch = crouchDown ? 1 : 0;

  let mx = clamp(input.mx || 0, -1, 1);
  let mz = clamp(input.mz || 0, -1, 1);
  const ml = Math.sqrt(mx * mx + mz * mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  const sin = Math.sin(input.yaw || 0), cos = Math.cos(input.yaw || 0);
  // forward = (−sin, −cos), right = (cos, −sin)
  const ads = (buttons & BTN_ADS) !== 0;
  let speed = dbno ? CRAWL_SPEED : s.crouch ? CROUCH_SPEED : (buttons & BTN_SPRINT) && mz > 0.3 && !ads ? SPRINT_SPEED : WALK_SPEED;
  if (ads && speed > ADS_SPEED) speed = ADS_SPEED;
  if (mz < 0) speed *= 0.8;
  const wishX = (cos * mx - sin * mz) * speed;
  const wishZ = (-sin * mx - cos * mz) * speed;

  const jumpDown = (buttons & BTN_JUMP) !== 0;
  const jumpPressed = jumpDown && !s.jumpLatch;
  s.jumpLatch = jumpDown ? 1 : 0;

  if (s.ground) {
    const accel = (wishX || wishZ) ? GROUND_ACCEL : GROUND_FRICTION;
    approach(s, wishX, wishZ, accel * dt);
    if (jumpPressed && !dbno) {
      if (s.crouch && canStand(s, world)) s.crouch = 0;
      if (!s.crouch) { s.vy = JUMP_SPEED; s.ground = 0; }
    }
  } else {
    approach(s, wishX, wishZ, AIR_ACCEL * dt);
  }
  if (!s.ground) s.vy = Math.max(-TERMINAL_FALL, s.vy - GRAVITY * dt);
  else if (s.vy < 0) s.vy = 0;

  const height = capsuleHeight(s);
  const reach = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz) * dt + STEP_HEIGHT + 0.5;
  const cols = gather(s, height, world, reach);
  const wasGround = s.ground;
  copyMoveState(s, before);

  let groundNy = slide(s, s.vx * dt, s.vy * dt, s.vz * dt, height, world, cols);
  // Pushing into a wall's edge can clip a sliver of upward speed out of the
  // contact normal; someone standing who did not jump stays standing.
  if (wasGround && s.vy > 0) s.vy = 0;

  // Step up onto a low ledge (a floor laid on the ground, a kerb) when walking
  // into it would otherwise stop us.
  if (wasGround) {
    const wantX = before.vx * dt, wantZ = before.vz * dt;
    const want = Math.sqrt(wantX * wantX + wantZ * wantZ);
    const gotX = s.x - before.x, gotZ = s.z - before.z;
    const got = Math.sqrt(gotX * gotX + gotZ * gotZ);
    if (want > 0.02 && got < want * 0.6) {
      // Reach at least 15 cm forward: from a standstill against the ledge one
      // tick's travel would leave the capsule balanced on the corner instead
      // of over the top.
      const reachF = Math.max(want, 0.15) / want;
      copyMoveState(before, stepped);
      slide(stepped, 0, STEP_HEIGHT, 0, height, world, cols);
      stepped.vx = before.vx; stepped.vz = before.vz; stepped.vy = 0;
      slide(stepped, wantX * reachF, 0, wantZ * reachF, height, world, cols);
      const ny = sweepDown(stepped, STEP_HEIGHT + 0.05, height, world, cols);
      const sx = stepped.x - before.x, sz = stepped.z - before.z;
      if (ny >= WALKABLE && Math.sqrt(sx * sx + sz * sz) > got + 0.01 && stepped.y - before.y <= STEP_HEIGHT + 0.01) {
        copyMoveState(stepped, s);
        s.vy = 0;
        groundNy = ny;
      }
    }
  }

  let grounded = groundNy >= WALKABLE;
  // Settle onto ground that is just below: exactly onto it when landing, and
  // further when already walking, so going down a ramp or slope stays glued
  // to it instead of skipping off in a string of tiny falls.
  if (!grounded && s.vy <= 0) {
    copyMoveState(s, stepped);
    const ny = sweepDown(stepped, wasGround ? SNAP_DOWN : 0.08, height, world, cols);
    if (ny >= WALKABLE) { copyMoveState(stepped, s); grounded = true; }
  }

  let damage = 0;
  if (grounded) {
    if (!wasGround) damage = fallDamage(s.peakY - s.y);
    s.ground = 1;
    if (s.vy < 0) s.vy = 0;
    s.peakY = s.y;
  } else {
    s.ground = 0;
    if (wasGround) s.peakY = s.y;
    if (s.y > s.peakY) s.peakY = s.y;
  }
  return damage;
}

function approach(s, tx, tz, maxDelta) {
  const dx = tx - s.vx, dz = tz - s.vz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d < 1e-6) { s.vx = tx; s.vz = tz; return; }
  s.vx += (dx / d) * maxDelta;
  s.vz += (dz / d) * maxDelta;
}

export function canStand(s, world) {
  const test = copyMoveState(s, standState);
  const cols = gather(test, STAND_HEIGHT, world, 0.2);
  const r = PLAYER_RADIUS;
  for (let i = 0; i < cols.length; i++) {
    if (capsulePenetration(test.x, test.y + r + 0.05, test.z, test.x, test.y + STAND_HEIGHT - r, test.z, r, cols[i], contact) > 0.02) return false;
  }
  return true;
}
const standState = {};

/** Skydiving and gliding. Returns 0 — landing from the sky never hurts. */
function stepAir(s, input, world, dt) {
  const mz = clamp(input.mz || 0, -1, 1);
  const mx = clamp(input.mx || 0, -1, 1);
  const sin = Math.sin(input.yaw || 0), cos = Math.cos(input.yaw || 0);
  let fall, forward;
  if (s.mode === MODE_GLIDE) {
    fall = GLIDE_FALL;
    forward = GLIDE_FORWARD * (1 + 0.2 * mz);
  } else {
    const dive = mz > 0.3 && (input.pitch || 0) < -0.55;
    fall = dive ? DIVE_SPEED : FREEFALL_SPEED;
    forward = mz > 0 ? (dive ? DIVE_FORWARD : FREEFALL_FORWARD) * mz : mz < 0 ? 6 * mz : 0;
  }
  // Gliders always drift forward; freefall only moves where you steer.
  const wishX = -sin * forward + cos * mx * 8;
  const wishZ = -cos * forward - sin * mx * 8;
  approach(s, wishX, wishZ, 14 * dt);
  const vyTarget = -fall;
  s.vy += clamp(vyTarget - s.vy, -30 * dt, 30 * dt);

  const height = STAND_HEIGHT;
  const reach = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz) * dt + 1;
  const cols = gather(s, height, world, reach);
  const ny = slide(s, s.vx * dt, s.vy * dt, s.vz * dt, height, world, cols);

  let landed = ny >= WALKABLE;
  if (!landed && s.vy <= 0) {
    copyMoveState(s, stepped);
    if (sweepDown(stepped, 0.08, height, world, cols) >= WALKABLE) { copyMoveState(stepped, s); landed = true; }
  }
  if (landed) {
    s.mode = MODE_WALK; s.ground = 1; s.vy = 0; s.peakY = s.y;
    return 0;
  }
  if (s.mode === MODE_SKYDIVE && s.y - world.terrain.heightAt(s.x, s.z) <= GLIDER_DEPLOY_AGL) s.mode = MODE_GLIDE;
  s.peakY = s.y;
  return 0;
}

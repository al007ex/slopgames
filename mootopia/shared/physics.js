// Player movement, shared by the server (which decides) and the client (which
// predicts its own player with exactly the same step, so moving feels instant).
//
// One tick is: accelerate → move in sub-steps, colliding after each →
// (the server pushes players apart here) → settle (friction, map edge).

import * as C from './config.js';

/** Speed multiplier from what you hold and wear. */
export function speedMods({ building, weaponSpd = 1, hatSpd = 1 }) {
  return (building ? C.BUILD_SPEED : 1) * weaponSpd * hatSpd;
}

/**
 * Speed back after a swing, then push towards `moveDir` (radians, or null).
 * `mods`: { spd, waterImmune, currentMult }.
 */
export function accelerate(e, moveDir, delta, mods) {
  if (e.slowMult < 1) e.slowMult = Math.min(1, e.slowMult + C.SLOW_RECOVER * delta);
  if (e.lockMove) { e.xVel = 0; e.yVel = 0; return; }
  let spd = mods.spd * e.slowMult;
  if (e.y <= C.SNOW_TOP) spd *= C.SNOW_SPEED;
  if (!e.zIndex && C.inRiver(e.y)) {
    if (mods.waterImmune) { spd *= 0.75; e.xVel += C.WATER_CURRENT * (mods.currentMult ?? 0.4) * delta; }
    else { spd *= C.WATER_SPEED; e.xVel += C.WATER_CURRENT * delta; }
  }
  if (moveDir !== null && moveDir !== undefined) {
    e.xVel += Math.cos(moveDir) * C.PLAYER_SPEED * spd * delta;
    e.yVel += Math.sin(moveDir) * C.PLAYER_SPEED * spd * delta;
  }
}

/**
 * Move in up to four sub-steps. After each, `collide(step)` resolves contacts;
 * it returns false to stop (the player died). Contacts set zIndex (platforms),
 * lockMove (traps) and healCol (healing pads) afresh every tick.
 */
export function travel(e, delta, collide) {
  e.zIndex = 0; e.lockMove = false; e.healCol = 0;
  const dist = Math.hypot(e.xVel, e.yVel) * delta;
  const depth = Math.min(4, Math.max(1, Math.round(dist / 40)));
  const step = 1 / depth;
  for (let i = 0; i < depth; i++) {
    e.x += e.xVel * delta * step;
    e.y += e.yVel * delta * step;
    if (collide(step) === false) return false;
  }
  return true;
}

/** Friction and the edge of the world. */
export function settle(e, delta) {
  const f = Math.pow(C.DECEL, delta);
  if (e.xVel) { e.xVel *= f; if (Math.abs(e.xVel) <= 0.01) e.xVel = 0; }
  if (e.yVel) { e.yVel *= f; if (Math.abs(e.yVel) <= 0.01) e.yVel = 0; }
  const s = e.scale;
  e.x = Math.min(C.MAP - s, Math.max(s, e.x));
  e.y = Math.min(C.MAP - s, Math.max(s, e.y));
}

/**
 * The solid part of bumping into an object, shared by both sides: being
 * pushed out of it, lifted by a platform, caught by a trap or flung by a boost
 * pad. `friendly` says whether it belongs to you or your clan. Returns 'solid'
 * when it pushed you out (the server then applies spike damage).
 */
export function bump(e, o, radius, step, friendly) {
  const reach = e.scale + radius;
  const dx = e.x - o.x; const dy = e.y - o.y;
  if (Math.abs(dx) > reach && Math.abs(dy) > reach) return null;
  if (Math.hypot(dx, dy) > reach) return null;
  const item = o.item;
  let hit = 'touch';
  if (!item?.ignoreCollision) {
    const dir = Math.atan2(dy, dx);
    e.x = o.x + reach * Math.cos(dir);
    e.y = o.y + reach * Math.sin(dir);
    e.xVel *= 0.75; e.yVel *= 0.75;
    hit = 'solid';
  } else if (item.trap) {
    if (!friendly && !e.noTrap) e.lockMove = true;
  } else if (item.boostSpeed) {
    const b = step * item.boostSpeed * (e.weight || 1);
    e.xVel += b * Math.cos(o.dir); e.yVel += b * Math.sin(o.dir);
  } else if (item.healCol) {
    e.healCol = item.healCol;
  }
  const z = item?.zIndex || 0;
  if (z > e.zIndex) e.zIndex = z;
  return hit;
}

/** Collision radius of an object: its silhouette, or a pad's smaller trigger zone. */
export const hitRadius = (o) => o.scale * (o.item?.colDiv || 1);

/**
 * Ticks between swings for a reload of `ms`. The server counts a reload down
 * once a tick and swings on the first tick it has run out: the hammer (300 ms)
 * every 4th tick, daggers (100 ms) every 2nd, the polearm (700 ms) every 8th.
 */
export const swingTicks = (ms) => Math.ceil(ms / C.TICK_MS) + 1;

// The storm: a table of phases, each a wait (the next circle is shown) and a
// shrink (the wall moves in). Each new circle is 0.55 of the last, centred
// somewhere random inside it, and the last one closes to nothing. Damage ticks
// once a second outside the eye, hitting shields before health.

import { WORLD_CENTER, WORLD_SIZE } from './constants.js';
import { Rng } from './rng.js';

export const STORM_PHASES = [
  { wait: 180, shrink: 180, dps: 1, ratio: 0.55 },
  { wait: 120, shrink: 120, dps: 1, ratio: 0.55 },
  { wait: 90, shrink: 90, dps: 2, ratio: 0.55 },
  { wait: 60, shrink: 60, dps: 5, ratio: 0.55 },
  { wait: 45, shrink: 45, dps: 5, ratio: 0.55 },
  { wait: 30, shrink: 30, dps: 5, ratio: 0.55 },
  { wait: 30, shrink: 30, dps: 10, ratio: 0.55 },
  { wait: 20, shrink: 20, dps: 10, ratio: 0.55 },
  { wait: 10, shrink: 10, dps: 10, ratio: 0.55 },
  { wait: 10, shrink: 30, dps: 10, ratio: 0 },
];

// The first circle takes in the whole map, corners and all.
export const STORM_START_RADIUS = Math.ceil(WORLD_SIZE * 0.7072);

/**
 * All the circles for one match. `onLand(x, z)` keeps each centre over land.
 * circles[0] is the starting circle; circles[k] is the eye after phase k.
 */
export function planStorm(seed, onLand = () => true, phases = STORM_PHASES) {
  const rng = new Rng(seed);
  const circles = [{ x: WORLD_CENTER, z: WORLD_CENTER, r: STORM_START_RADIUS }];
  for (const phase of phases) {
    const cur = circles[circles.length - 1];
    const r = cur.r * phase.ratio;
    // The new eye sits wholly inside the current one; the first is also kept
    // well inside the island so the early game is not in the sea.
    const room = circles.length === 1 ? Math.min(cur.r - r, 1100) : cur.r - r;
    let x = cur.x, z = cur.z;
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * room;
      const cx = cur.x + Math.cos(a) * d, cz = cur.z + Math.sin(a) * d;
      if (onLand(cx, cz) || attempt === 39) { x = cx; z = cz; break; }
    }
    circles.push({ x, z, r });
  }
  return { seed, circles, phases };
}

/** Total seconds from the storm starting to the last circle closing. */
export const stormLength = (phases = STORM_PHASES) => phases.reduce((s, p) => s + p.wait + p.shrink, 0);

/**
 * The storm at `t` seconds after it started: which phase, whether it is
 * waiting or shrinking, how long until that changes, the eye right now and
 * the next one, and how hard the storm hits.
 */
export function stormAt(plan, t) {
  const { circles, phases } = plan;
  let start = 0;
  for (let k = 0; k < phases.length; k++) {
    const p = phases[k];
    const from = circles[k], to = circles[k + 1];
    if (t < start + p.wait) {
      return { phase: k + 1, state: 'wait', timeLeft: start + p.wait - t, x: from.x, z: from.z, r: from.r, next: to, dps: p.dps, phaseStart: start };
    }
    if (t < start + p.wait + p.shrink) {
      const f = (t - start - p.wait) / p.shrink;
      return {
        phase: k + 1, state: 'shrink', timeLeft: start + p.wait + p.shrink - t,
        x: from.x + (to.x - from.x) * f, z: from.z + (to.z - from.z) * f, r: from.r + (to.r - from.r) * f,
        next: to, dps: p.dps, phaseStart: start,
      };
    }
    start += p.wait + p.shrink;
  }
  const last = circles[circles.length - 1];
  return { phase: phases.length, state: 'closed', timeLeft: 0, x: last.x, z: last.z, r: 0, next: last, dps: phases[phases.length - 1].dps, phaseStart: start };
}

/** Outside the eye — and once the last circle has closed, everyone is. */
export const outsideStorm = (s, x, z) => s.r <= 0 || (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) > s.r * s.r;

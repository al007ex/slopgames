// Small maths helpers shared by the server and the client.

export const TAU = Math.PI * 2;

export const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);

/** Angle pointing from (x2, y2) towards (x1, y1). */
export const dirTo = (x1, y1, x2, y2) => Math.atan2(y1 - y2, x1 - x2);

/** Smallest absolute difference between two angles, 0…π. */
export function angleDist(a, b) {
  const d = Math.abs(b - a) % TAU;
  return d > Math.PI ? TAU - d : d;
}

export const lerp = (a, b, t) => a + (b - a) * t;

export function lerpAngle(from, to, t) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return from + d * t;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const round = (v, dp = 0) => { const m = 10 ** dp; return Math.round(v * m) / m; };

/** A small seeded generator (mulberry32) so a world can be rebuilt exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.range = (lo, hi) => lo + next() * (hi - lo);
  return next;
}

/** Does the segment (x1,y1)→(x2,y2) touch the rectangle? Liang–Barsky clip. */
export function segmentHitsRect(x1, y1, x2, y2, left, top, right, bottom) {
  let t0 = 0; let t1 = 1;
  const dx = x2 - x1; const dy = y2 - y1;
  const edges = [[-dx, x1 - left], [dx, right - x1], [-dy, y1 - top], [dy, bottom - y1]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

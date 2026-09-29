// The map: one night city in three parts.
//
//  · Downtown (north): a grid of streets lined with towers, lamps and parked
//    cars, a roundabout, and an empty car park to play in.
//  · The Pit: the plaza where the boulevard crosses Main Street, cleared out
//    for takeovers.
//  · The Harbor Circuit (south): a walled drift track, reached down the
//    boulevard through the paddock.
//
// Everything is generated from fixed numbers and a seed, so the client and
// the tests build exactly the same world.

import { Shapes } from './collide.js';
import { rng, clamp } from './math.js';

// N–S avenues and E–W streets: centre line and width.
export const AVENUES = [
  { x: -400, w: 16 }, { x: -270, w: 16 }, { x: -140, w: 18 }, { x: 0, w: 26 },
  { x: 150, w: 18 }, { x: 290, w: 16 }, { x: 420, w: 16 },
];
export const STREETS = [
  { y: 60, w: 18 }, { y: 180, w: 16 }, { y: 310, w: 26 }, { y: 450, w: 18 },
  { y: 580, w: 16 }, { y: 700, w: 18 },
];
const SIDEWALK = 3.6;
const OUTER = 60; // depth of the ring of buildings closing the city in

export const PIT = { x: 0, y: 310, half: 44, ring: 27 };
export const ROUNDABOUT = { x: 290, y: 450, island: 10, clear: 30 };
export const CARPARK = { x0: -262, x1: -149, y0: 459, y1: 571 };
export const PADDOCK = { x0: -300, x1: 300, y0: -112, y1: -34 };
export const BOULEVARD = { x0: -13, x1: 13, y0: -40, y1: 60 };
// The harbour: the walled-in ground round the circuit, south of the city.
export const HARBOR = { x0: -440, x1: 420, y0: -640, y1: -9 };

// The circuit's centre line, clockwise from the start of the main straight.
const TRACK_POINTS = [
  [-240, -135], [0, -135], [95, -142], [165, -180], [195, -250], [180, -320],
  [210, -390], [290, -420], [352, -462], [345, -540], [270, -565], [160, -535],
  [60, -560], [-40, -592], [-150, -575], [-225, -520], [-240, -448], [-185, -392],
  [-200, -318], [-290, -290], [-355, -230], [-335, -160],
];
export const TRACK_WIDTH = 16;
const WALL_GAP = 1.6; // concrete wall this far outside the track edge

export function buildWorld(seed = 1) {
  const random = rng(seed);
  const shapes = new Shapes(16);
  const world = {
    bounds: { x0: -470, x1: 490, y0: HARBOR.y0, y1: 770 },
    shapes,
    buildings: [], sidewalks: [], lamps: [], parked: [], markings: [], cones: [], barriers: [], trees: [],
    pit: PIT, roundabout: ROUNDABOUT, carpark: CARPARK, paddock: PADDOCK, boulevard: BOULEVARD,
  };

  const ax = AVENUES.map((a) => a.x), sy = STREETS.map((s) => s.y);
  const west = AVENUES[0].x - AVENUES[0].w / 2, east = AVENUES.at(-1).x + AVENUES.at(-1).w / 2;
  const south = STREETS[0].y - STREETS[0].w / 2, north = STREETS.at(-1).y + STREETS.at(-1).w / 2;
  world.city = { west, east, south, north };

  const blocked = (x0, y0, x1, y1) => {
    // The Pit and the roundabout keep their ground clear.
    const px0 = PIT.x - PIT.half, px1 = PIT.x + PIT.half, py0 = PIT.y - PIT.half, py1 = PIT.y + PIT.half;
    if (x1 > px0 && x0 < px1 && y1 > py0 && y0 < py1) return true;
    const cx = clamp(ROUNDABOUT.x, x0, x1), cy = clamp(ROUNDABOUT.y, y0, y1);
    if (Math.hypot(cx - ROUNDABOUT.x, cy - ROUNDABOUT.y) < ROUNDABOUT.clear) return true;
    if (x1 > CARPARK.x0 && x0 < CARPARK.x1 && y1 > CARPARK.y0 && y0 < CARPARK.y1) return true;
    return false;
  };

  const addBuilding = (x0, y0, x1, y1, h, style) => {
    const b = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0, h, style, seed: Math.floor(random() * 1e9) };
    world.buildings.push(b);
    shapes.box(b.x, b.y, b.w / 2, b.d / 2, 0, 'building');
    return b;
  };

  /** Fill a lot with a few buildings, leaving alleys between some of them. */
  const fillLot = (x0, y0, x1, y1, tall, solid = false) => {
    const w = x1 - x0, d = y1 - y0;
    const nx = Math.max(1, Math.round(w / (28 + random() * 20)));
    const ny = Math.max(1, Math.round(d / (28 + random() * 20)));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      let bx0 = x0 + w * i / nx, bx1 = x0 + w * (i + 1) / nx;
      let by0 = y0 + d * j / ny, by1 = y0 + d * (j + 1) / ny;
      if (!solid && i > 0 && random() < 0.35) bx0 += 4;
      if (!solid && j > 0 && random() < 0.35) by0 += 4;
      if (blocked(bx0, by0, bx1, by1)) continue;
      const h = tall * (0.45 + random() * 0.75) + random() * 10;
      addBuilding(bx0, by0, bx1, by1, Math.round(h), random() < 0.25 ? 1 : 0);
    }
  };

  // ---- city blocks
  const blocks = [];
  for (let i = 0; i < AVENUES.length - 1; i++) for (let j = 0; j < STREETS.length - 1; j++) {
    blocks.push({
      x0: AVENUES[i].x + AVENUES[i].w / 2, x1: AVENUES[i + 1].x - AVENUES[i + 1].w / 2,
      y0: STREETS[j].y + STREETS[j].w / 2, y1: STREETS[j + 1].y - STREETS[j + 1].w / 2,
    });
  }
  // The ring of blocks closing the city, with the boulevard's gap to the south.
  blocks.push({ x0: west - OUTER, x1: west, y0: HARBOR.y1, y1: north + OUTER, outer: true });
  blocks.push({ x0: east, x1: east + OUTER, y0: HARBOR.y1, y1: north + OUTER, outer: true });
  blocks.push({ x0: west, x1: east, y0: north, y1: north + OUTER, outer: true });
  blocks.push({ x0: west, x1: BOULEVARD.x0 - SIDEWALK, y0: 0, y1: south, outer: true, noWalk: 'south' });
  blocks.push({ x0: BOULEVARD.x1 + SIDEWALK, x1: east, y0: 0, y1: south, outer: true, noWalk: 'south' });
  world.blocks = blocks;

  for (const b of blocks) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    // Downtown is tallest in the middle.
    const centre = 1 - clamp(Math.hypot(cx - 60, cy - 380) / 520, 0, 1);
    const tall = b.outer ? 26 : 22 + 70 * centre * centre;
    if (b.outer) {
      fillLot(b.x0, b.y0, b.x1, b.y1, tall, true);
      continue;
    }
    world.sidewalks.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
    fillLot(b.x0 + SIDEWALK, b.y0 + SIDEWALK, b.x1 - SIDEWALK, b.y1 - SIDEWALK, tall);
  }
  // The south row faces the boulevard; its sidewalk runs along the city side only.
  world.sidewalks.push({ x0: west, y0: south - SIDEWALK, x1: BOULEVARD.x0, y1: south });
  world.sidewalks.push({ x0: BOULEVARD.x1, y0: south - SIDEWALK, x1: east, y1: south });

  // ---- the roundabout's island
  shapes.circle(ROUNDABOUT.x, ROUNDABOUT.y, ROUNDABOUT.island, 'island');

  // ---- street lamps down both sides of every street
  const lampAt = (x, y, angle) => {
    world.lamps.push({ x, y, angle });
    shapes.circle(x, y, 0.2, 'lamp');
  };
  const nearCross = (x, y) => ax.some((a) => Math.abs(x - a) < 22) && sy.some((b) => Math.abs(y - b) < 22);
  const inClear = (x, y) => (Math.abs(x - PIT.x) < PIT.half && Math.abs(y - PIT.y) < PIT.half)
    || Math.hypot(x - ROUNDABOUT.x, y - ROUNDABOUT.y) < ROUNDABOUT.clear + 4;
  for (const s of STREETS) for (const side of [-1, 1]) {
    for (let x = west + 20; x < east - 10; x += 34) {
      const y = s.y + side * (s.w / 2 + 0.9);
      if (!nearCross(x, s.y) && !inClear(x, y) && !(s === STREETS[0] && side < 0 && Math.abs(x) < 20)) lampAt(x, y, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  for (const a of AVENUES) for (const side of [-1, 1]) {
    for (let y = south + 20; y < north - 10; y += 34) {
      const x = a.x + side * (a.w / 2 + 0.9);
      if (!nearCross(a.x, y) && !inClear(x, y)) lampAt(x, y, side > 0 ? Math.PI : 0);
    }
  }

  // ---- parked cars along the kerbs, never in the way of a junction
  const parkRow = (x0, y0, x1, y1, angle) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 8; d < len - 8; d += 6.2 + random() * 5) {
      if (random() < 0.45) continue;
      const x = x0 + (x1 - x0) * d / len, y = y0 + (y1 - y0) * d / len;
      if (nearCross(x, y) || inClear(x, y)) continue;
      addParked(x, y, angle + (random() < 0.5 ? Math.PI : 0));
    }
  };
  const addParked = (x, y, angle) => {
    world.parked.push({ x, y, angle, color: Math.floor(random() * 8), kind: Math.floor(random() * 3) });
    shapes.box(x, y, 2.2, 0.92, angle, 'car');
  };
  for (let j = 0; j < STREETS.length; j++) {
    const s = STREETS[j];
    if (s.w < 17 || j === 2) continue; // Main Street stays clear for drifting
    for (let i = 0; i < AVENUES.length - 1; i++) {
      const xa = AVENUES[i].x + AVENUES[i].w / 2, xb = AVENUES[i + 1].x - AVENUES[i + 1].w / 2;
      if (random() < 0.5) parkRow(xa, s.y + s.w / 2 - 1.1, xb, s.y + s.w / 2 - 1.1, 0);
      if (random() < 0.5 && j > 0) parkRow(xa, s.y - s.w / 2 + 1.1, xb, s.y - s.w / 2 + 1.1, 0);
    }
  }
  for (const a of [AVENUES[1], AVENUES[5]]) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      const ya = STREETS[j].y + STREETS[j].w / 2, yb = STREETS[j + 1].y - STREETS[j + 1].w / 2;
      if (random() < 0.6) parkRow(a.x - a.w / 2 + 1.1, ya, a.x - a.w / 2 + 1.1, yb, Math.PI / 2);
    }
  }

  // ---- the car park: bays round the edge, lamps in a grid, the middle open
  {
    const { x0, x1, y0, y1 } = CARPARK;
    for (let x = x0 + 6; x < x1 - 4; x += 3) {
      for (const [y, ang] of [[y0 + 3.2, Math.PI / 2], [y1 - 3.2, -Math.PI / 2]]) {
        world.markings.push({ x: x - 1.5, y: y + (ang > 0 ? 0.4 : -0.4), w: 0.12, h: 5.4, angle: 0 });
        if (random() < 0.3 && x > x0 + 10 && x < x1 - 10) addParked(x, y, ang);
      }
    }
    for (let x = x0 + 30; x < x1 - 20; x += 36) for (let y = y0 + 32; y < y1 - 20; y += 34) lampAt(x, y, 0);
  }

  // ---- lane markings: dashed centre lines, and zebra crossings at junctions
  for (const s of STREETS) {
    for (let x = west + 4; x < east - 4; x += 9) {
      if (ax.some((a) => Math.abs(x - a) < 26) || inClear(x, s.y)) continue;
      world.markings.push({ x, y: s.y, w: 4, h: 0.16, angle: 0, color: s.w > 20 ? 1 : 0 });
    }
  }
  for (const a of AVENUES) {
    for (let y = south + 4; y < north - 4; y += 9) {
      if (sy.some((b) => Math.abs(y - b) < 26) || inClear(a.x, y)) continue;
      world.markings.push({ x: a.x, y, w: 0.16, h: 4, angle: 0, color: a.w > 20 ? 1 : 0 });
    }
  }
  for (const a of AVENUES) for (const s of STREETS) {
    if (Math.abs(a.x - PIT.x) < 1 && Math.abs(s.y - PIT.y) < 1) continue;
    if (Math.hypot(a.x - ROUNDABOUT.x, s.y - ROUNDABOUT.y) < 1) continue;
    for (const side of [-1, 1]) {
      // Stripes across the avenue, north and south of the junction…
      const yy = s.y + side * (s.w / 2 + 2.2);
      if (yy > south && yy < north) for (let x = a.x - a.w / 2 + 1.2; x < a.x + a.w / 2 - 0.6; x += 1.4) world.markings.push({ x, y: yy, w: 0.7, h: 3, angle: 0 });
      // …and across the street, east and west of it.
      const xx = a.x + side * (a.w / 2 + 2.2);
      if (xx > west && xx < east) for (let y = s.y - s.w / 2 + 1.2; y < s.y + s.w / 2 - 0.6; y += 1.4) world.markings.push({ x: xx, y, w: 3, h: 0.7, angle: 0 });
    }
  }

  // ---- the boulevard down to the harbour, and the paddock
  {
    const B = BOULEVARD, P = PADDOCK;
    // Warehouses either side of the boulevard.
    addBuilding(HARBOR.x0, P.y1, B.x0 - 1, 0, 14, 2);
    addBuilding(B.x1 + 1, P.y1, east + 20, 0, 14, 2);
    for (let y = B.y0 + 10; y < B.y1 - 6; y += 30) { lampAt(B.x0 + 0.8, y, 0); lampAt(B.x1 - 0.8, y, Math.PI); }
    for (let y = -30; y < 40; y += 9) world.markings.push({ x: 0, y, w: 0.16, h: 4, angle: 0, color: 1 });
    // Paddock edges: walls, with shipping containers stacked about.
    shapes.wall(P.x0, P.y1, B.x0 - 1, P.y1, 1);
    shapes.wall(B.x1 + 1, P.y1, P.x1, P.y1, 1);
    shapes.wall(P.x0, P.y0, P.x0, P.y1, 1);
    shapes.wall(P.x1, P.y0, P.x1, P.y1, 1);
    world.barriers.push({ x1: P.x0, y1: P.y1, x2: B.x0 - 1, y2: P.y1, kind: 'wall' });
    world.barriers.push({ x1: B.x1 + 1, y1: P.y1, x2: P.x1, y2: P.y1, kind: 'wall' });
    world.barriers.push({ x1: P.x0, y1: P.y0, x2: P.x0, y2: P.y1, kind: 'wall' });
    world.barriers.push({ x1: P.x1, y1: P.y0, x2: P.x1, y2: P.y1, kind: 'wall' });
    world.containers = [];
    for (const [x, y, a, stack] of [[-240, -55, 0, 2], [-226, -55, 0, 1], [-160, -92, 0.1, 3], [190, -60, 0, 2], [204, -60, 0, 2], [250, -92, -0.2, 1], [-90, -48, Math.PI / 2, 1]]) {
      world.containers.push({ x, y, angle: a, stack, color: Math.floor(random() * 4) });
      shapes.box(x, y, 6.1, 1.25, a, 'container');
    }
    for (let x = P.x0 + 30; x < P.x1 - 20; x += 60) lampAt(x, P.y1 - 1, -Math.PI / 2);
  }

  // ---- the circuit
  world.track = buildTrack(shapes, world);

  // ---- the harbour's fence (the city is closed in by its ring of buildings)
  {
    const H = HARBOR;
    shapes.wall(H.x0, H.y0, H.x1, H.y0, 2); shapes.wall(H.x1, H.y0, H.x1, H.y1, 2); shapes.wall(H.x0, H.y1, H.x0, H.y0, 2);
    world.barriers.push({ x1: H.x0, y1: H.y0, x2: H.x1, y2: H.y0, kind: 'fence' });
    world.barriers.push({ x1: H.x1, y1: H.y0, x2: H.x1, y2: H.y1, kind: 'fence' });
    world.barriers.push({ x1: H.x0, y1: H.y1, x2: H.x0, y2: H.y0, kind: 'fence' });
  }
  world.harbor = HARBOR;

  // ---- cones: a few slalom lines in the car park and a gate on the circuit
  for (let i = 0; i < 6; i++) world.cones.push({ x: CARPARK.x0 + 25 + i * 13, y: (CARPARK.y0 + CARPARK.y1) / 2 });
  for (const c of world.track.clips) if (c.kind === 'inner') world.cones.push({ x: c.cx, y: c.cy, clip: true });

  world.spawns = {
    street: { x: -330, y: 304, heading: 0 },
    takeover: { x: PIT.x - 12, y: PIT.y - 6, heading: 0 },
    track: { ...world.track.start },
  };
  return world;
}

// ---------------------------------------------------------------------- track

/** Sample a closed centripetal Catmull–Rom spline every `step` metres. */
function sampleLoop(points, step) {
  const n = points.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const k = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
    const segs = 40;
    for (let s = 0; s < segs; s++) {
      const t = t1 + (t2 - t1) * s / segs;
      const lerp = (a, b, ta, tb) => [a[0] * (tb - t) / (tb - ta) + b[0] * (t - ta) / (tb - ta), a[1] * (tb - t) / (tb - ta) + b[1] * (t - ta) / (tb - ta)];
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      dense.push(lerp(b1, b2, t1, t2));
    }
  }
  // Re-sample at even spacing.
  const out = [dense[0]];
  let carry = 0;
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let from = 0;
    while (carry + (seg - from) >= step) {
      from += step - carry;
      carry = 0;
      const t = from / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    carry += seg - from;
  }
  if (Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < step * 0.5) out.pop();
  return out;
}

function buildTrack(shapes, world) {
  const step = 2;
  const pts = sampleLoop(TRACK_POINTS, step);
  const n = pts.length;
  const half = TRACK_WIDTH / 2;
  const nodes = pts.map(([x, y], i) => {
    const [px, py] = pts[(i - 1 + n) % n], [qx, qy] = pts[(i + 1) % n];
    const tx = qx - px, ty = qy - py, l = Math.hypot(tx, ty);
    return { x, y, tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l, s: i * step, curv: 0 };
  });
  // Signed curvature (+ = turning left) from the change of direction.
  for (let i = 0; i < n; i++) {
    const a = nodes[(i - 3 + n) % n], b = nodes[(i + 3) % n];
    const turn = Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty);
    nodes[i].curv = turn / (6 * step);
  }
  const length = n * step;

  // Walls: a chain of short segments along both edges, with a gap to the paddock.
  const gate = (x, y) => Math.abs(x) < 14 && y > -130;
  const walls = { left: [], right: [] };
  for (const side of [1, -1]) {
    const list = side > 0 ? walls.left : walls.right;
    for (let i = 0; i < n; i += 2) {
      const a = nodes[i], b = nodes[(i + 2) % n];
      const off = side * (half + WALL_GAP);
      const x1 = a.x + a.nx * off, y1 = a.y + a.ny * off, x2 = b.x + b.nx * off, y2 = b.y + b.ny * off;
      list.push([x1, y1]);
      if (side > 0 && gate((x1 + x2) / 2, (y1 + y2) / 2)) continue;
      shapes.wall(x1, y1, x2, y2, 0.8, 'barrier');
    }
  }

  // Corners, found from the curvature, each with an inner clipping point at its
  // apex and an outer zone along the wall into it — the judging line.
  const clips = [];
  let i = 0;
  const visited = new Uint8Array(n);
  while (i < n) {
    if (Math.abs(nodes[i].curv) > 1 / 95 && !visited[i]) {
      let j = i;
      const sgn = Math.sign(nodes[i].curv);
      while (Math.abs(nodes[j % n].curv) > 1 / 140 && Math.sign(nodes[j % n].curv) === sgn && j - i < n) { visited[j % n] = 1; j++; }
      let k = i;
      while (Math.abs(nodes[(k - 1 + n) % n].curv) > 1 / 140 && Math.sign(nodes[(k - 1 + n) % n].curv) === sgn && i - k < 40) { k--; visited[(k + n) % n] = 1; }
      if ((j - k) * step >= 24) {
        let apex = k;
        for (let m = k; m < j; m++) if (Math.abs(nodes[(m + n) % n].curv) > Math.abs(nodes[(apex + n) % n].curv)) apex = m;
        const a = nodes[(apex + n) % n];
        const inside = sgn; // + = the left edge is the inside
        clips.push({
          kind: 'inner', index: (apex + n) % n, s: a.s, side: inside,
          cx: a.x + a.nx * inside * (half - 0.6), cy: a.y + a.ny * inside * (half - 0.6),
        });
        const from = (k + n) % n, to = (apex + n) % n;
        clips.push({ kind: 'outer', from, to, s: nodes[from].s, side: -inside });
      }
      i = j;
    } else i++;
  }
  clips.sort((a, b) => a.s - b.s);
  clips.forEach((c, idx) => { c.id = idx; });

  const s0 = nodes[4];
  return {
    nodes, length, width: TRACK_WIDTH, half, wallGap: WALL_GAP, walls, clips,
    start: { x: s0.x + s0.tx * 6, y: s0.y + s0.ty * 6, heading: Math.atan2(s0.ty, s0.tx) },
    finish: { x: nodes[20].x, y: nodes[20].y, nx: nodes[20].nx, ny: nodes[20].ny, index: 20 },
  };
}

/**
 * Where a point is on the circuit: the nearest node (searching around `hint`
 * when given) and the signed offset from the centre line (+ = left).
 */
export function trackPlace(track, x, y, hint = -1) {
  const nodes = track.nodes, n = nodes.length;
  let best = -1, bd = Infinity;
  const scan = (from, to) => {
    for (let k = from; k <= to; k++) {
      const i = ((k % n) + n) % n;
      const d = (nodes[i].x - x) ** 2 + (nodes[i].y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  };
  if (hint >= 0) scan(hint - 30, hint + 30);
  if (hint < 0 || bd > 30 * 30) scan(0, n - 1);
  const node = nodes[best];
  const off = (x - node.x) * node.nx + (y - node.y) * node.ny;
  return { index: best, s: node.s, offset: off, dist: Math.sqrt(bd), onTrack: Math.abs(off) <= track.half + track.wallGap };
}

export const inPit = (x, y, r = PIT.ring) => Math.hypot(x - PIT.x, y - PIT.y) < r;

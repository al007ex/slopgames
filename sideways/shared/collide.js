// Collisions on the ground plane. Everything solid is an oriented box or a
// circle in a spatial hash; the car is an oriented box. Contacts are resolved
// with an impulse at the contact point, so a glancing touch scrapes along a
// wall, a corner clip spins the car, and a head-on hit stops it.

import { clamp } from './math.js';

export class Shapes {
  constructor(cell = 16) {
    this.cell = cell;
    this.grid = new Map();
    this.all = [];
    this._seen = 0;
  }

  key(ix, iy) { return ix * 73856093 ^ iy * 19349663; }

  insert(s) {
    s.id = this.all.length;
    s.mark = 0;
    this.all.push(s);
    const c = this.cell;
    const x0 = Math.floor((s.x - s.r) / c), x1 = Math.floor((s.x + s.r) / c);
    const y0 = Math.floor((s.y - s.r) / c), y1 = Math.floor((s.y + s.r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = this.key(ix, iy);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, list = []);
      list.push(s);
    }
    return s;
  }

  /** A box centred on (x, y), half sizes hw × hh, turned by `angle`. */
  box(x, y, hw, hh, angle = 0, tag = 'wall') {
    return this.insert({ kind: 'box', x, y, hw, hh, angle, c: Math.cos(angle), s: Math.sin(angle), r: Math.hypot(hw, hh), tag });
  }

  circle(x, y, r, tag = 'post') {
    return this.insert({ kind: 'circle', x, y, r, tag });
  }

  /** A wall along a segment, `thick` metres thick. */
  wall(x1, y1, x2, y2, thick = 0.6, tag = 'wall') {
    const len = Math.hypot(x2 - x1, y2 - y1);
    return this.box((x1 + x2) / 2, (y1 + y2) / 2, len / 2, thick / 2, Math.atan2(y2 - y1, x2 - x1), tag);
  }

  /** Call `fn(shape)` once for every shape whose bounds come within `r` of (x, y). */
  query(x, y, r, fn) {
    const c = this.cell;
    const stamp = ++this._seen;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const list = this.grid.get(this.key(ix, iy));
      if (!list) continue;
      for (const s of list) {
        if (s.mark === stamp) continue;
        s.mark = stamp;
        const d = s.r + r;
        if ((s.x - x) ** 2 + (s.y - y) ** 2 <= d * d) fn(s);
      }
    }
  }

  /** Distance from (x, y) to the nearest solid surface within `r`, or r. */
  clearance(x, y, r) {
    let best = r;
    this.query(x, y, r, (s) => {
      const d = s.kind === 'circle' ? Math.hypot(x - s.x, y - s.y) - s.r : boxDistance(s, x, y);
      if (d < best) best = d;
    });
    return Math.max(best, 0);
  }
}

/** Distance from a point to a box's surface (0 inside). */
export function boxDistance(b, x, y) {
  const dx = x - b.x, dy = y - b.y;
  const lx = Math.abs(dx * b.c + dy * b.s) - b.hw;
  const ly = Math.abs(-dx * b.s + dy * b.c) - b.hh;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}

/** The car's footprint as a box: centred between the axles. */
export function carBox(car, out = {}) {
  const s = car.spec;
  const c = Math.cos(car.heading), sn = Math.sin(car.heading);
  const off = (s.cgFront - (s.wheelbase - s.cgFront)) / 2;
  out.x = car.x + c * off;
  out.y = car.y + sn * off;
  out.hw = s.length / 2;
  out.hh = s.width / 2;
  out.c = c; out.s = sn; out.angle = car.heading;
  return out;
}

const corners = (b, out) => {
  let i = 0;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out[i++] = b.x + b.c * b.hw * sx - b.s * b.hh * sy;
    out[i++] = b.y + b.s * b.hw * sx + b.c * b.hh * sy;
  }
  return out;
};

const inside = (b, x, y, pad = 0) => {
  const dx = x - b.x, dy = y - b.y;
  return Math.abs(dx * b.c + dy * b.s) <= b.hw + pad && Math.abs(-dx * b.s + dy * b.c) <= b.hh + pad;
};

const CA = new Float64Array(8), CB = new Float64Array(8);

/** Box against box: the separating axis with least overlap, pointing from `b` to `a`. */
function boxBox(a, b, hit) {
  const axes = [a.c, a.s, -a.s, a.c, b.c, b.s, -b.s, b.c];
  let best = Infinity, nx = 0, ny = 0;
  const dx = a.x - b.x, dy = a.y - b.y;
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i], ay = axes[i + 1];
    const ra = a.hw * Math.abs(a.c * ax + a.s * ay) + a.hh * Math.abs(-a.s * ax + a.c * ay);
    const rb = b.hw * Math.abs(b.c * ax + b.s * ay) + b.hh * Math.abs(-b.s * ax + b.c * ay);
    const d = dx * ax + dy * ay;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return false;
    if (overlap < best) { best = overlap; const sg = d < 0 ? -1 : 1; nx = ax * sg; ny = ay * sg; }
  }
  // Contact: the average of whichever corners are inside the other box.
  corners(a, CA); corners(b, CB);
  let px = 0, py = 0, n = 0;
  for (let i = 0; i < 8; i += 2) if (inside(b, CA[i], CA[i + 1], 0.02)) { px += CA[i]; py += CA[i + 1]; n++; }
  for (let i = 0; i < 8; i += 2) if (inside(a, CB[i], CB[i + 1], 0.02)) { px += CB[i]; py += CB[i + 1]; n++; }
  if (!n) { px = a.x - nx * a.hw * 0.5; py = a.y - ny * a.hh * 0.5; n = 1; }
  hit.nx = nx; hit.ny = ny; hit.depth = best; hit.px = px / n; hit.py = py / n;
  return true;
}

/** Box against circle, normal pointing from the circle to the box. */
function boxCircle(a, s, hit) {
  const dx = s.x - a.x, dy = s.y - a.y;
  const lx = dx * a.c + dy * a.s, ly = -dx * a.s + dy * a.c;
  const cx = clamp(lx, -a.hw, a.hw), cy = clamp(ly, -a.hh, a.hh);
  let nx, ny, depth;
  if (cx === lx && cy === ly) {
    // Centre inside the box: push out through the nearest face.
    const fx = a.hw - Math.abs(lx), fy = a.hh - Math.abs(ly);
    if (fx < fy) { nx = -Math.sign(lx) || -1; ny = 0; depth = fx + s.r; } else { nx = 0; ny = -Math.sign(ly) || -1; depth = fy + s.r; }
  } else {
    const ex = lx - cx, ey = ly - cy;
    const d = Math.hypot(ex, ey);
    if (d >= s.r) return false;
    nx = -ex / d; ny = -ey / d; depth = s.r - d;
  }
  // Back to world axes.
  hit.nx = nx * a.c - ny * a.s;
  hit.ny = nx * a.s + ny * a.c;
  hit.depth = depth;
  hit.px = a.x + cx * a.c - cy * a.s;
  hit.py = a.y + cx * a.s + cy * a.c;
  return true;
}

const HIT = { nx: 0, ny: 0, depth: 0, px: 0, py: 0 };
const BOX = {};

/**
 * Push the car out of anything solid and bounce it off. Returns the hardest
 * impact this step as { speed, x, y, nx, ny, tag, scrape } or null.
 */
export function collideCar(car, shapes, { restitution = 0.22, friction = 0.35 } = {}) {
  let worst = null;
  for (let pass = 0; pass < 3; pass++) {
    const box = carBox(car, BOX);
    let any = false;
    shapes.query(box.x, box.y, Math.hypot(box.hw, box.hh), (s) => {
      if (s.soft) return;
      const touching = s.kind === 'circle' ? boxCircle(box, s, HIT) : boxBox(box, s, HIT);
      if (!touching) return;
      any = true;
      const speed = resolve(car, HIT, restitution, friction);
      if (!worst || speed > worst.speed) worst = { speed, x: HIT.px, y: HIT.py, nx: HIT.nx, ny: HIT.ny, tag: s.tag, shape: s };
      carBox(car, box);
    });
    if (!any) break;
  }
  return worst;
}

function resolve(car, h, e, mu) {
  const s = car.spec;
  // Separate first, so nothing ever sinks in.
  car.x += h.nx * h.depth;
  car.y += h.ny * h.depth;
  const rx = h.px - car.x, ry = h.py - car.y;
  const vx = car.vx - car.yawRate * ry, vy = car.vy + car.yawRate * rx;
  const vn = vx * h.nx + vy * h.ny;
  if (vn >= 0) return 0;
  const invM = 1 / s.mass, invI = 1 / s.izz;
  const rn = rx * h.ny - ry * h.nx;
  const j = -(1 + e) * vn / (invM + rn * rn * invI);
  car.vx += j * h.nx * invM;
  car.vy += j * h.ny * invM;
  car.yawRate += rn * j * invI;
  // Friction along the surface: a scrape, not a stop.
  const tx = -h.ny, ty = h.nx;
  const vt = (car.vx - car.yawRate * ry) * tx + (car.vy + car.yawRate * rx) * ty;
  const rt = rx * ty - ry * tx;
  let jt = -vt / (invM + rt * rt * invI);
  jt = clamp(jt, -mu * j, mu * j);
  car.vx += jt * tx * invM;
  car.vy += jt * ty * invM;
  car.yawRate += rt * jt * invI;
  return -vn;
}

/**
 * Light things the car can knock about (cones, bins). Each is a circle with a
 * little mass; the car barely feels them.
 */
export class Props {
  constructor() { this.list = []; }

  add(x, y, r, mass, kind) {
    const p = { x, y, r, mass, kind, vx: 0, vy: 0, spin: 0, angle: 0, tilt: 0, tiltV: 0, home: { x, y }, hit: 0 };
    this.list.push(p);
    return p;
  }

  /** Car against every prop near it; returns the props hit this step. */
  hitByCar(car, out = []) {
    const box = carBox(car, BOX);
    for (const p of this.list) {
      if (Math.abs(p.x - box.x) > 6 || Math.abs(p.y - box.y) > 6) continue;
      if (!boxCircle(box, p, HIT)) continue;
      // The prop takes nearly all of it.
      const rx = HIT.px - car.x, ry = HIT.py - car.y;
      const cvx = car.vx - car.yawRate * ry, cvy = car.vy + car.yawRate * rx;
      const rel = (p.vx - cvx) * -HIT.nx + (p.vy - cvy) * -HIT.ny;
      p.x -= HIT.nx * HIT.depth; p.y -= HIT.ny * HIT.depth;
      if (rel < 0) {
        const j = -1.6 * rel * p.mass * car.spec.mass / (p.mass + car.spec.mass);
        p.vx += -HIT.nx * j / p.mass; p.vy += -HIT.ny * j / p.mass;
        car.vx += HIT.nx * j / car.spec.mass; car.vy += HIT.ny * j / car.spec.mass;
        p.spin += (Math.random() - 0.5) * 20;
        p.tiltV += Math.min(-rel, 20) * 0.9;
        p.hit = 1;
        out.push({ prop: p, speed: -rel });
      }
    }
    return out;
  }

  step(dt, shapes) {
    for (const p of this.list) {
      if (p.vx === 0 && p.vy === 0 && p.tilt === 0 && p.tiltV === 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const sp = Math.hypot(p.vx, p.vy);
      const drop = Math.min(sp, 7 * dt);
      if (sp > 0) { p.vx -= p.vx / sp * drop; p.vy -= p.vy / sp * drop; }
      if (Math.hypot(p.vx, p.vy) < 0.02) { p.vx = 0; p.vy = 0; }
      p.angle += p.spin * dt;
      p.spin *= Math.exp(-3 * dt);
      // Knocked over, it rolls about and settles on its side.
      p.tilt = Math.min(Math.PI / 2, p.tilt + p.tiltV * dt);
      p.tiltV = p.tilt >= Math.PI / 2 ? 0 : p.tiltV * Math.exp(-2 * dt);
      if (p.tilt < Math.PI / 2 && p.tiltV < 0.5) { p.tilt = Math.max(0, p.tilt - 2 * dt); if (p.tilt === 0) p.tiltV = 0; }
      if (shapes) shapes.query(p.x, p.y, p.r, (s) => {
        if (s.kind !== 'box') return;
        const dx = p.x - s.x, dy = p.y - s.y;
        const lx = dx * s.c + dy * s.s, ly = -dx * s.s + dy * s.c;
        const cx = clamp(lx, -s.hw, s.hw), cy = clamp(ly, -s.hh, s.hh);
        const ex = lx - cx, ey = ly - cy, d = Math.hypot(ex, ey);
        if (d >= p.r || d === 0) return;
        const nx = (ex * s.c - ey * s.s) / d, ny = (ex * s.s + ey * s.c) / d;
        p.x += nx * (p.r - d); p.y += ny * (p.r - d);
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) { p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny; }
      });
    }
  }
}

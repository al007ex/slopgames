// Everything on the canvas. The renderer reads a frame from GameState and
// never changes it.
//
// Snakes are stroked paths rather than hundreds of circles: one path per snake,
// stroked a few times (shadow, outline, body, bands, shine). That keeps a screen
// full of huge snakes cheap enough for a mid-range phone at 60 fps. Food is a
// set of pre-rendered glow sprites composited additively, which is what gives
// the pellets their neon bloom without any real blur.

import { ARENA_RADIUS, PALETTE, SKINS, widthOf, foodRadius } from '#shared/rules.js';
import { POP_IN_MS } from './state.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function makeGlowSprite(colour) {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.09, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.17, rgba(colour, 1));
  gradient.addColorStop(0.3, rgba(colour, 0.6));
  gradient.addColorStop(0.5, rgba(colour, 0.16));
  gradient.addColorStop(1, rgba(colour, 0));
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * The hex floor. Flat-topped hexes tile every 1.5 radii across and every √3
 * radii down; the tile is rounded to whole pixels so the pattern repeats
 * without a seam (the 1% squash is invisible).
 */
function makeHexTile() {
  const r = 30;
  const w = r * 3;        // two columns
  const h = 52;           // ≈ √3 · r
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#04050b';
  g.fillRect(0, 0, w, h);
  const ry = h / 2 / Math.sin(Math.PI / 3);
  const hex = (cx, cy, rad, radY) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * radY;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };
  for (let col = -1; col <= 2; col++) {
    for (let row = -1; row <= 2; row++) {
      const cx = col * r * 1.5;
      const cy = row * h + (col % 2 ? h / 2 : 0);
      const gradient = g.createRadialGradient(cx, cy - 6, 2, cx, cy, r);
      gradient.addColorStop(0, '#121a33');
      gradient.addColorStop(1, '#0a0e1e');
      hex(cx, cy, r - 2.2, ry - 2.2);
      g.fillStyle = gradient;
      g.fill();
      g.strokeStyle = 'rgba(120, 160, 255, 0.07)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  return canvas;
}

/** Trace a snake tail-to-head through the midpoints; returns its approximate length. */
function tracePath(path, points, count) {
  let length = 0;
  let px = points[(count - 1) * 2];
  let py = points[(count - 1) * 2 + 1];
  path.moveTo(px, py);
  for (let i = count - 2; i > 0; i--) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const mx = (x + points[(i - 1) * 2]) / 2;
    const my = (y + points[(i - 1) * 2 + 1]) / 2;
    path.quadraticCurveTo(x, y, mx, my);
    length += Math.hypot(x - px, y - py);
    px = x; py = y;
  }
  path.lineTo(points[0], points[1]);
  return length + Math.hypot(points[0] - px, points[1] - py);
}

/**
 * Draw one snake in world space. Exported so the menu can draw its preview
 * with exactly the same code the game uses.
 */
export function drawSnake(ctx, points, count, width, skin, { angle, boost = 0, time = 0, alpha = 1 }) {
  if (count < 2 || alpha <= 0) return;
  const w = width;
  const path = new Path2D();
  const length = tracePath(path, points, count);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Drop shadow, offset down the screen so the snake sits above the floor.
  ctx.save();
  ctx.translate(w * 0.05, w * 0.2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.lineWidth = w * 1.04;
  ctx.stroke(path);
  ctx.restore();

  if (boost > 0.01) {
    // The glow swells in and out with the boost level rather than switching,
    // so starting and stopping a boost reads as a surge, not a flicker.
    const pulse = 0.78 + 0.22 * Math.sin(time * 18);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = skin.glow;
    ctx.globalAlpha = alpha * 0.14 * pulse * boost;
    ctx.lineWidth = w * (1.3 + 1.4 * boost);
    ctx.stroke(path);
    ctx.globalAlpha = alpha * 0.22 * pulse * boost;
    ctx.lineWidth = w * (1.1 + 0.6 * boost);
    ctx.stroke(path);
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(3, 5, 12, 0.82)';
  ctx.lineWidth = w + Math.max(2, w * 0.14);
  ctx.stroke(path);

  ctx.strokeStyle = skin.body;
  ctx.lineWidth = w;
  ctx.stroke(path);

  // Bands, anchored to the head so they travel with the body rather than
  // sliding along it as the snake grows at the tail.
  const period = w * 1.1;
  const band = w * 0.44;
  ctx.setLineDash([band, period - band]);
  ctx.lineDashOffset = -(length % period);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = skin.stripe;
  ctx.lineWidth = w * 0.84;
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.lineCap = 'round';

  // Specular shine along the top edge — the cheap trick that makes it a tube.
  ctx.save();
  ctx.translate(-w * 0.06, -w * 0.17);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
  ctx.lineWidth = w * 0.24;
  ctx.stroke(path);
  ctx.restore();

  // Head
  const hx = points[0];
  const hy = points[1];
  const head = w * 0.56;
  ctx.fillStyle = 'rgba(3, 5, 12, 0.82)';
  ctx.beginPath();
  ctx.arc(hx, hy, head + Math.max(1, w * 0.07), 0, TAU);
  ctx.fill();
  ctx.fillStyle = skin.body;
  ctx.beginPath();
  ctx.arc(hx, hy, head, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.ellipse(hx - w * 0.12, hy - w * 0.2, w * 0.22, w * 0.12, -0.5, 0, TAU);
  ctx.fill();

  // Eyes, looking where the snake is going.
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (const side of [-1, 1]) {
    const ex = hx + dx * w * 0.17 - dy * side * w * 0.25;
    const ey = hy + dy * w * 0.17 + dx * side * w * 0.25;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, w * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b0d18';
    ctx.beginPath();
    ctx.arc(ex + dx * w * 0.075, ey + dy * w * 0.075, w * 0.115, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(ex + dx * w * 0.075 - w * 0.035, ey + dy * w * 0.075 - w * 0.04, w * 0.035, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.targetScale = 1;
    this.camera = { x: 0, y: 0 };
    this.pan = null;
    this.particles = [];
    this.visuals = new Map();   // id -> { boost, born, seen, sparks }: eased per-snake effects
    this.ghosts = [];           // dead snakes fading out
    this.hexPattern = this.ctx.createPattern(makeHexTile(), 'repeat');
    this.sprites = PALETTE.map(makeGlowSprite);
    this.lastTime = 0;
    this.resize();
  }

  resize() {
    // Capped at 2x: a 3x phone screen costs more than twice the fill for a
    // difference nobody can see in a moving game.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    const g = this.ctx;
    this.vignette = g.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.hypot(this.width, this.height) * 0.62,
    );
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
    this.danger = g.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.3,
      this.width / 2, this.height / 2, Math.hypot(this.width, this.height) * 0.6,
    );
    this.danger.addColorStop(0, 'rgba(255,40,90,0)');
    this.danger.addColorStop(1, 'rgba(255,40,90,0.5)');
  }

  /** Aim the camera. Following your own head is exact; anything else eases. */
  aim(target, locked, dt) {
    if (!target) return;
    const jump = Math.hypot(target.x - this.camera.x, target.y - this.camera.y);
    if (jump > 700 && !this.pan) this.pan = { from: { ...this.camera }, t: 0 };
    if (this.pan) {
      this.pan.t = Math.min(1, this.pan.t + dt / 0.75);
      const k = 1 - (1 - this.pan.t) ** 3;
      this.camera.x = this.pan.from.x + (target.x - this.pan.from.x) * k;
      this.camera.y = this.pan.from.y + (target.y - this.pan.from.y) * k;
      if (this.pan.t >= 1) this.pan = null;
      return;
    }
    if (locked) { this.camera.x = target.x; this.camera.y = target.y; return; }
    const k = 1 - Math.exp(-dt * 6);
    this.camera.x += (target.x - this.camera.x) * k;
    this.camera.y += (target.y - this.camera.y) * k;
  }

  zoomTo(scale, dt) {
    this.targetScale = scale;
    this.scale += (scale - this.scale) * (1 - Math.exp(-dt * 2.5));
  }

  toScreen(x, y) {
    return { x: this.width / 2 + (x - this.camera.x) * this.scale, y: this.height / 2 + (y - this.camera.y) * this.scale };
  }

  toWorld(x, y) {
    return { x: this.camera.x + (x - this.width / 2) / this.scale, y: this.camera.y + (y - this.height / 2) / this.scale };
  }

  /** How boosted a snake currently looks, 0–1 — eased, so the camera can follow it too. */
  boostLevel(id) {
    return this.visuals.get(id)?.boost ?? 0;
  }

  /** A death: the body swells and fades out while sparks fly off it. */
  burst(points, skinIndex, mass = 10) {
    if (!points) return;
    const skin = SKINS[skinIndex] || SKINS[0];
    this.ghosts.push({ points, count: points.length / 2, width: widthOf(mass), skin, age: 0 });
    const count = points.length / 2;
    const stride = Math.max(1, Math.floor(count / 70));
    for (let i = 0; i < count && this.particles.length < 1200; i += stride) {
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * TAU;
        const speed = 30 + Math.random() * 150;
        this.particles.push({
          x: points[i * 2], y: points[i * 2 + 1],
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          life: 0, max: 0.45 + Math.random() * 0.5,
          size: 4 + Math.random() * 7, colour: k ? skin.glow : skin.body,
        });
      }
    }
  }

  draw(frame, state, { time, dt, focusMass = 10 }) {
    const { ctx } = this;
    const W = this.width;
    const H = this.height;
    const s = this.scale;
    const dpr = this.dpr;
    const cam = this.camera;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04050b';
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cam.x * s), dpr * (H / 2 - cam.y * s));
    const x0 = cam.x - W / 2 / s;
    const x1 = cam.x + W / 2 / s;
    const y0 = cam.y - H / 2 / s;
    const y1 = cam.y + H / 2 / s;

    ctx.fillStyle = this.hexPattern;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    this.drawEdge(x0, y0, x1, y1, time);
    this.drawFood(state, frame, x0 - 60, y0 - 60, x1 + 60, y1 + 60, time);

    this.drawGhosts(dt, time);

    // Small under big, and your own snake on top of everything.
    const order = frame.snakes.slice().sort((a, b) => (a.you - b.you) || (a.mass - b.mass));
    for (const snake of order) {
      const visual = this.visualOf(snake, time, dt);
      const width = widthOf(snake.mass);
      // Cheap cull: skip snakes whose head and tail are both far off screen.
      const p = snake.points;
      const tail = (snake.count - 1) * 2;
      const margin = width + 400;
      if ((p[0] < x0 - margin && p[tail] < x0 - margin) || (p[0] > x1 + margin && p[tail] > x1 + margin)
        || (p[1] < y0 - margin && p[tail + 1] < y0 - margin) || (p[1] > y1 + margin && p[tail + 1] > y1 + margin)) continue;
      const skin = SKINS[snake.info.skin] || SKINS[0];
      if (visual.boost > 0.05) this.sparkTail(snake, skin, visual, width, dt);
      drawSnake(ctx, p, snake.count, width, skin, {
        angle: snake.angle,
        boost: visual.boost,
        time,
        // New arrivals fade in over a third of a second instead of popping in.
        alpha: Math.min(1, (time - visual.born) / 0.33),
      });
    }
    for (const [id, visual] of this.visuals) if (time - visual.seen > 2) this.visuals.delete(id);

    this.drawParticles(dt);

    // Screen-space layers
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawNames(frame, focusMass);
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, W, H);
    const you = frame.youSnake;
    if (you) {
      const toEdge = ARENA_RADIUS - Math.hypot(you.points[0], you.points[1]);
      if (toEdge < 420) {
        ctx.globalAlpha = clamp(1 - toEdge / 420, 0, 1) * (0.75 + 0.25 * Math.sin(time * 8));
        ctx.fillStyle = this.danger;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Per-snake eased state: how boosted it looks and when it first appeared. */
  visualOf(snake, time, dt) {
    let visual = this.visuals.get(snake.id);
    if (!visual) {
      visual = { boost: snake.boosting ? 1 : 0, born: time, seen: time, sparks: 0 };
      this.visuals.set(snake.id, visual);
    }
    // ~90% of the way in a fifth of a second: quick, but visibly a transition.
    const target = snake.boosting ? 1 : 0;
    visual.boost += (target - visual.boost) * (1 - Math.exp(-dt / 0.085));
    visual.seen = time;
    return visual;
  }

  /** Sparks streaming off the tail of a boosting snake. */
  sparkTail(snake, skin, visual, width, dt) {
    const p = snake.points;
    const tail = (snake.count - 1) * 2;
    const before = Math.max(0, tail - 4);
    let bx = p[tail] - p[before];
    let by = p[tail + 1] - p[before + 1];
    const len = Math.hypot(bx, by) || 1;
    bx /= len;
    by /= len;
    visual.sparks += dt * 55 * visual.boost;
    while (visual.sparks >= 1 && this.particles.length < 1400) {
      visual.sparks -= 1;
      const spread = (Math.random() - 0.5) * 1.1;
      const speed = 50 + Math.random() * 110;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      this.particles.push({
        x: p[tail] + (Math.random() - 0.5) * width * 0.5,
        y: p[tail + 1] + (Math.random() - 0.5) * width * 0.5,
        vx: (bx * cos - by * sin) * speed,
        vy: (bx * sin + by * cos) * speed,
        life: 0, max: 0.28 + Math.random() * 0.3,
        size: width * (0.08 + Math.random() * 0.1), colour: Math.random() < 0.6 ? skin.glow : '#ffffff',
      });
    }
    if (visual.sparks > 1) visual.sparks = 0;
  }

  drawGhosts(dt, time) {
    if (!this.ghosts.length) return;
    for (const ghost of this.ghosts) {
      ghost.age += dt;
      const k = Math.min(1, ghost.age / 0.42);
      drawSnake(this.ctx, ghost.points, ghost.count, ghost.width * (1 + 0.35 * k), ghost.skin, {
        angle: 0, boost: 1 - k, time, alpha: (1 - k) ** 2,
      });
    }
    this.ghosts = this.ghosts.filter((ghost) => ghost.age < 0.42);
  }

  drawEdge(x0, y0, x1, y1, time) {
    const { ctx } = this;
    const reach = Math.hypot(this.camera.x, this.camera.y) + Math.hypot(x1 - x0, y1 - y0) / 2;
    if (reach < ARENA_RADIUS - 40) return;
    // Everything beyond the edge is dimmed and tinted.
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.arc(0, 0, ARENA_RADIUS, 0, TAU, true);
    ctx.fillStyle = 'rgba(20, 2, 10, 0.78)';
    ctx.fill('evenodd');
    const pulse = 0.8 + 0.2 * Math.sin(time * 2.4);
    ctx.lineWidth = 70;
    ctx.strokeStyle = `rgba(255, 85, 125, ${0.07 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 22;
    ctx.strokeStyle = `rgba(255, 85, 125, ${0.16 * pulse})`;
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ff557d';
    ctx.stroke();
  }

  drawFood(state, frame, x0, y0, x1, y1, time) {
    const { ctx } = this;
    const clock = state.clock;
    ctx.globalCompositeOperation = 'lighter';
    for (const [id, food] of state.food) {
      if (food.x < x0 || food.x > x1 || food.y < y0 || food.y > y1) continue;
      const phase = id * 1.618;
      let x = food.x + Math.sin(time * 1.3 + phase) * 1.8;
      let y = food.y + Math.cos(time * 1.1 + phase) * 1.8;
      let size = 1;
      let alpha = 1;
      const age = clock - food.born;
      if (age < POP_IN_MS) size = Math.max(0, easeOutBack(clamp(age / POP_IN_MS, 0, 1)));
      if (food.endAt) {
        const k = clamp((clock - food.leftAt) / (food.endAt - food.leftAt), 0, 1);
        const eater = food.eatenBy ? frame.byId.get(food.eatenBy) : null;
        if (eater) {
          // Sucked into the mouth that ate it.
          x += (eater.points[0] - x) * k * k;
          y += (eater.points[1] - y) * k * k;
          size *= 1 - k * 0.75;
        } else {
          alpha = 1 - k;
        }
      }
      const r = foodRadius(food.value) * (1 + 0.16 * Math.sin(time * 3.2 + phase)) * size;
      const d = r * 4.8;
      if (d <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.sprites[food.color % this.sprites.length], x - d / 2, y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawParticles(dt) {
    if (!this.particles.length) return;
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      const k = 1 - p.life / p.max;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  drawNames(frame) {
    const { ctx } = this;
    ctx.font = "600 12px 'Space Grotesk', system-ui, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    for (const snake of frame.snakes) {
      if (snake.you || !snake.info.name) continue;
      const { x, y } = this.toScreen(snake.points[0], snake.points[1]);
      if (x < -60 || x > this.width + 60 || y < -40 || y > this.height + 40) continue;
      const lift = widthOf(snake.mass) * 0.6 * this.scale + 8;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(4, 5, 11, 0.85)';
      ctx.strokeText(snake.info.name, x, y - lift);
      ctx.fillStyle = 'rgba(234, 240, 255, 0.92)';
      ctx.fillText(snake.info.name, x, y - lift);
    }
  }
}

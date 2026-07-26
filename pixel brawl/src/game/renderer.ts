import { TILE, TEAM_COLORS, TEAM_COLORS_DARK } from '@shared/constants';
import { Tile, type MapTheme, type Snapshot } from '@shared/types';
import { getBrawler } from '@shared/brawlers';
import { brawlerArt, item, petArt, tilesFor, type TileSet } from '../art/sprites';
import { drawText } from '../art/font';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  kind: 'square' | 'ring' | 'text' | 'spark';
  text?: string;
  r?: number;
  r1?: number;
}

export interface WorldMap {
  w: number;
  h: number;
  tiles: Uint8Array;
  theme: MapTheme;
}

interface ProjStyle {
  w: number;
  h: number;
  color: string;
  edge?: string;
  trail?: number;
  glow?: boolean;
  round?: boolean;
}

const PROJ_STYLES: Record<string, ProjStyle> = {
  pellet: { w: 5, h: 3, color: '#ffe066', edge: '#ff9f1c', trail: 2 },
  pellet_super: { w: 7, h: 4, color: '#fff3b0', edge: '#ff6b3d', trail: 3, glow: true },
  bullet: { w: 8, h: 2, color: '#ffe066', edge: '#ff9f1c', trail: 3 },
  bullet_super: { w: 11, h: 3, color: '#fff6d0', edge: '#ff6b3d', trail: 5, glow: true },
  orb: { w: 6, h: 6, color: '#8ef5b0', edge: '#25a05a', round: true, glow: true },
  shock: { w: 14, h: 12, color: '#a8e6ff', edge: '#2a9fd6', round: true, glow: true },
  rocket: { w: 10, h: 5, color: '#ff8a3d', edge: '#c23a10', trail: 5, glow: true },
  rocket_super: { w: 12, h: 6, color: '#ffb03d', edge: '#c23a10', trail: 7, glow: true },
  arrow: { w: 10, h: 3, color: '#e8d8a0', edge: '#7a5a2a', trail: 2 },
  card: { w: 6, h: 8, color: '#f0e0ff', edge: '#7b3fd4', trail: 2 },
  dagger: { w: 8, h: 3, color: '#9ef0a8', edge: '#2f8f3f', trail: 2 },
  scrap: { w: 4, h: 4, color: '#d0d8e0', edge: '#6b7280', trail: 1 },
  ric: { w: 6, h: 3, color: '#8ff0ff', edge: '#2a9fd6', trail: 3, glow: true },
  ric_super: { w: 8, h: 4, color: '#c8f8ff', edge: '#2a9fd6', trail: 5, glow: true },
  snipe: { w: 12, h: 3, color: '#ffc0e0', edge: '#c03a7a', trail: 6, glow: true },
  wave: { w: 12, h: 14, color: '#ffd0f0', edge: '#e04a8a', round: true, glow: true },
  fist: { w: 8, h: 8, color: '#ffd23f', edge: '#c23a10', round: true },
  dynamite: { w: 6, h: 8, color: '#e04a4a', edge: '#7a1a1a' },
  barrel: { w: 12, h: 14, color: '#c98a45', edge: '#5f3a18' },
  bottle: { w: 6, h: 8, color: '#8ef0b0', edge: '#2a7f4a' },
  bottle_super: { w: 7, h: 9, color: '#b0ffd0', edge: '#2a7f4a', glow: true },
  cactus: { w: 8, h: 8, color: '#7ee88a', edge: '#2a8f3a', round: true },
  bat: { w: 9, h: 6, color: '#c8a0ff', edge: '#5a2a9a', glow: true },
  shovel: { w: 10, h: 6, color: '#c0c8d0', edge: '#4a5460' },
  grenade: { w: 6, h: 6, color: '#ffb0d0', edge: '#c03a7a', round: true },
  swoop: { w: 10, h: 6, color: '#8ef0a8', edge: '#1f6f3a', glow: true },
  mine: { w: 8, h: 8, color: '#ffd23f', edge: '#c23a10', round: true },
  leap: { w: 8, h: 8, color: '#ffd23f', edge: '#c23a10', round: true },
  dash: { w: 8, h: 8, color: '#ffffff', edge: '#888888', round: true },
  heal: { w: 8, h: 8, color: '#8ef0b0', edge: '#2a8f5a', round: true },
  gravity: { w: 8, h: 8, color: '#c8a0ff', edge: '#5a2a9a', round: true },
};

const DEFAULT_STYLE: ProjStyle = { w: 6, h: 4, color: '#ffe066', edge: '#c07a10', trail: 2 };

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  buf: HTMLCanvasElement;
  bctx: CanvasRenderingContext2D;
  scale = 4;
  viewW = 320;
  viewH = 180;
  cssW = 0;
  cssH = 0;
  dpr = 1;

  map: WorldMap | null = null;
  tiles: TileSet | null = null;
  private groundCanvas: HTMLCanvasElement | null = null;
  private groundDirty = true;

  cam = { x: 0, y: 0 };
  shake = 0;
  particles: Particle[] = [];
  time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d', { alpha: false })!;
    this.resize();
  }

  setMap(map: WorldMap) {
    this.map = map;
    this.tiles = tilesFor(map.theme);
    this.groundDirty = true;
    this.cam.x = (map.w * TILE) / 2;
    this.cam.y = (map.h * TILE) / 2;
  }

  markTilesChanged() {
    this.groundDirty = true;
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = dw;
    this.canvas.height = dh;

    const minD = Math.min(dw, dh);
    const maxD = Math.max(dw, dh);
    // Aim for ~12 tiles across the short axis (phones) without letting ultrawide
    // screens see the whole map at once. Integer scale keeps pixels crisp.
    this.scale = Math.max(2, Math.min(10, Math.round(Math.max(minD / 200, maxD / 560))));
    this.viewW = Math.ceil(dw / this.scale);
    this.viewH = Math.ceil(dh / this.scale);
    this.buf.width = this.viewW;
    this.buf.height = this.viewH;
    this.bctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
  }

  /* ------------------------------ particles ----------------------------- */

  burst(x: number, y: number, n: number, color: string, speed = 60, life = 0.35, size = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size,
        color,
        gravity: 0,
        kind: 'square',
      });
    }
  }

  ring(x: number, y: number, r: number, color: string, life = 0.3) {
    this.particles.push({ x, y, vx: 0, vy: 0, life, max: life, size: 2, color, gravity: 0, kind: 'ring', r: 4, r1: r });
  }

  floatText(x: number, y: number, text: string, color: string) {
    this.particles.push({ x, y, vx: 0, vy: -26, life: 0.7, max: 0.7, size: 1, color, gravity: 0, kind: 'text', text });
  }

  private recentNumbers: { p: Particle; x: number; y: number; value: number; t: number; prefix: string }[] = [];

  /**
   * Damage/heal numbers, merged when they land close together in quick
   * succession — otherwise a shotgun blast or a healing turret buries the screen.
   */
  floatNumber(x: number, y: number, value: number, color: string, prefix = '') {
    const now = this.time;
    this.recentNumbers = this.recentNumbers.filter((r) => r.p.life > 0 && now - r.t < 0.6);
    for (const r of this.recentNumbers) {
      if (r.prefix !== prefix || r.p.color !== color) continue;
      if (Math.hypot(r.x - x, r.y - y) > 18) continue;
      r.value += value;
      r.t = now;
      r.p.text = prefix + Math.round(r.value);
      r.p.life = Math.max(r.p.life, 0.55);
      return;
    }
    const p: Particle = {
      x,
      y,
      vx: 0,
      vy: -26,
      life: 0.7,
      max: 0.7,
      size: 1,
      color,
      gravity: 0,
      kind: 'text',
      text: prefix + Math.round(value),
    };
    this.particles.push(p);
    this.recentNumbers.push({ p, x, y, value, t: now, prefix });
  }

  private stepParticles(dt: number) {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      keep.push(p);
    }
    this.particles = keep;
  }

  /* -------------------------------- ground ------------------------------ */

  private buildGround() {
    const map = this.map!;
    const ts = this.tiles!;
    const c = document.createElement('canvas');
    c.width = map.w * TILE;
    c.height = map.h * TILE;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.tiles[y * map.w + x] as Tile;
        const vi = (x * 7 + y * 13) % ts.grass.length;
        if (t === Tile.Water) g.drawImage(ts.water[(x + y) % ts.water.length], x * TILE, y * TILE);
        else g.drawImage(ts.grass[vi], x * TILE, y * TILE);
      }
    }
    // static blockers baked into the ground layer
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = map.tiles[y * map.w + x] as Tile;
        if (t === Tile.Wall) {
          g.drawImage(ts.rock[(x + y) % ts.rock.length], x * TILE, y * TILE);
        } else if (t === Tile.Fence) {
          g.drawImage(ts.fence, x * TILE, y * TILE);
        } else if (t === Tile.Skull) {
          g.drawImage(ts.skull, x * TILE, y * TILE);
        }
      }
    }
    this.groundCanvas = c;
    this.groundDirty = false;
  }

  /* -------------------------------- render ------------------------------ */

  render(
    snap: Snapshot,
    opts: {
      dt: number;
      you: number;
      mapTheme: MapTheme;
      followX: number;
      followY: number;
    },
  ) {
    if (!this.map || !this.tiles) return;
    this.time += opts.dt;
    this.stepParticles(opts.dt);
    if (this.groundDirty) this.buildGround();

    const map = this.map;
    const ts = this.tiles;
    const b = this.bctx;
    const worldW = map.w * TILE;
    const worldH = map.h * TILE;

    // camera
    const targetX = opts.followX;
    const targetY = opts.followY;
    this.cam.x += (targetX - this.cam.x) * Math.min(1, opts.dt * 9);
    this.cam.y += (targetY - this.cam.y) * Math.min(1, opts.dt * 9);
    let camX = this.cam.x;
    let camY = this.cam.y;
    if (worldW <= this.viewW) camX = worldW / 2;
    else camX = Math.max(this.viewW / 2, Math.min(worldW - this.viewW / 2, camX));
    if (worldH <= this.viewH) camY = worldH / 2;
    else camY = Math.max(this.viewH / 2, Math.min(worldH - this.viewH / 2, camY));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - opts.dt * 26);
      camX += (Math.random() - 0.5) * this.shake;
      camY += (Math.random() - 0.5) * this.shake;
    }

    const ox = Math.round(camX - this.viewW / 2);
    const oy = Math.round(camY - this.viewH / 2);
    this.lastOx = ox;
    this.lastOy = oy;

    b.fillStyle = ts.pal.fog;
    b.fillRect(0, 0, this.viewW, this.viewH);
    b.drawImage(this.groundCanvas!, -ox, -oy);

    /* --------------------------- areas (under) --------------------------- */
    for (const a of snap.areas) {
      this.drawArea(b, a, ox, oy);
    }

    /* ------------------------------ pickups ------------------------------ */
    for (const pk of snap.pickups) {
      const sx = pk.x - ox;
      const sy = pk.y - oy;
      if (sx < -20 || sy < -20 || sx > this.viewW + 20 || sy > this.viewH + 20) continue;
      const bob = Math.sin(this.time * 4 + pk.id) * 1.5;
      b.globalAlpha = 0.32;
      b.fillStyle = '#000';
      b.beginPath();
      b.ellipse(sx, sy + 4, 5, 2.5, 0, 0, Math.PI * 2);
      b.fill();
      b.globalAlpha = 1;
      const sprite = pk.k === 'gem' ? item('gem') : item('cube');
      b.drawImage(sprite, Math.round(sx - 4), Math.round(sy - 5 + bob));
    }

    /* ---------------------------- crates layer --------------------------- */
    const t0x = Math.max(0, Math.floor(ox / TILE));
    const t1x = Math.min(map.w - 1, Math.ceil((ox + this.viewW) / TILE));
    const t0y = Math.max(0, Math.floor(oy / TILE));
    const t1y = Math.min(map.h - 1, Math.ceil((oy + this.viewH) / TILE));
    for (let y = t0y; y <= t1y; y++) {
      for (let x = t0x; x <= t1x; x++) {
        if ((map.tiles[y * map.w + x] as Tile) === Tile.Crate) {
          b.drawImage(ts.crate, x * TILE - ox, y * TILE - oy);
        }
      }
    }

    /* ------------------------- entities (y-sorted) ----------------------- */
    interface Drawable {
      y: number;
      draw: () => void;
    }
    const drawables: Drawable[] = [];

    for (const p of snap.players) {
      if (!(p.st & 1)) continue;
      drawables.push({ y: p.y, draw: () => this.drawPlayer(b, p, ox, oy, opts.you, snap) });
    }
    for (const pt of snap.pets) {
      drawables.push({ y: pt.y, draw: () => this.drawPet(b, pt, ox, oy) });
    }
    for (let y = t0y; y <= t1y; y++) {
      for (let x = t0x; x <= t1x; x++) {
        if ((map.tiles[y * map.w + x] as Tile) === Tile.Tree) {
          const wy = y * TILE;
          drawables.push({
            y: wy + TILE,
            draw: () => b.drawImage(ts.tree, x * TILE - ox, wy - oy - 8),
          });
        }
      }
    }
    drawables.sort((a, c) => a.y - c.y);
    for (const d of drawables) d.draw();

    /* ---------------------------- projectiles ---------------------------- */
    for (const pr of snap.projs) {
      this.drawProj(b, pr, ox, oy);
    }

    /* ------------------------------- bushes ------------------------------ */
    for (let y = t0y; y <= t1y; y++) {
      for (let x = t0x; x <= t1x; x++) {
        if ((map.tiles[y * map.w + x] as Tile) === Tile.Bush) {
          b.drawImage(ts.bush, x * TILE - ox, y * TILE - oy);
        }
      }
    }

    /* ------------------------------ particles ---------------------------- */
    for (const p of this.particles) {
      const k = p.life / p.max;
      const sx = p.x - ox;
      const sy = p.y - oy;
      if (p.kind === 'ring') {
        const r = (p.r ?? 4) + (1 - k) * ((p.r1 ?? 20) - (p.r ?? 4));
        b.globalAlpha = k;
        b.strokeStyle = p.color;
        b.lineWidth = 2;
        b.beginPath();
        b.arc(sx, sy, r, 0, Math.PI * 2);
        b.stroke();
        b.globalAlpha = 1;
      } else if (p.kind === 'text') {
        b.globalAlpha = Math.min(1, k * 1.6);
        drawText(b, p.text ?? '', Math.round(sx), Math.round(sy), { scale: 1, color: p.color, align: 'center' });
        b.globalAlpha = 1;
      } else {
        b.globalAlpha = Math.min(1, k * 1.5);
        b.fillStyle = p.color;
        const s = Math.max(1, Math.round(p.size * (0.4 + k * 0.9)));
        b.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
        b.globalAlpha = 1;
      }
    }

    /* ------------------------------- poison ------------------------------ */
    if (snap.poison > 0) {
      const p = snap.poison;
      b.fillStyle = 'rgba(120, 40, 160, 0.42)';
      const left = p - ox;
      const top = p - oy;
      const right = worldW - p - ox;
      const bottom = worldH - p - oy;
      b.fillRect(0, 0, Math.max(0, left), this.viewH);
      b.fillRect(Math.max(0, right), 0, this.viewW, this.viewH);
      b.fillRect(0, 0, this.viewW, Math.max(0, top));
      b.fillRect(0, Math.max(0, bottom), this.viewW, this.viewH);
      b.strokeStyle = '#c084fc';
      b.lineWidth = 1;
      b.strokeRect(left + 0.5, top + 0.5, right - left, bottom - top);
      if (Math.random() < 0.3) {
        const side = Math.floor(Math.random() * 4);
        const px = side === 0 ? left : side === 1 ? right : Math.random() * this.viewW;
        const py = side === 2 ? top : side === 3 ? bottom : Math.random() * this.viewH;
        this.particles.push({
          x: px + ox,
          y: py + oy,
          vx: (Math.random() - 0.5) * 12,
          vy: -8 - Math.random() * 12,
          life: 0.8,
          max: 0.8,
          size: 2,
          color: '#c084fc',
          gravity: 0,
          kind: 'square',
        });
      }
    }

    /* ------------------------ blit to the real canvas -------------------- */
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, this.canvas.width, this.canvas.height);
  }

  lastOx = 0;
  lastOy = 0;

  /** world -> css pixels */
  worldToScreen(x: number, y: number) {
    return {
      x: ((x - this.lastOx) * this.scale) / this.dpr,
      y: ((y - this.lastOy) * this.scale) / this.dpr,
    };
  }

  /* ------------------------------ draw parts ---------------------------- */

  private drawArea(b: CanvasRenderingContext2D, a: Snapshot['areas'][number], ox: number, oy: number) {
    const x = a.x - ox;
    const y = a.y - oy;
    if (x < -a.r - 20 || y < -a.r - 20 || x > this.viewW + a.r + 20 || y > this.viewH + a.r + 20) return;
    const t = this.time;
    b.save();
    switch (a.k) {
      case 'puddle':
      case 'poison': {
        const col = a.k === 'poison' ? '#8b5cf6' : '#3ddc84';
        b.globalAlpha = 0.34 + Math.sin(t * 6) * 0.05;
        b.fillStyle = col;
        b.beginPath();
        b.arc(x, y, a.r, 0, Math.PI * 2);
        b.fill();
        b.globalAlpha = 0.6;
        b.strokeStyle = col;
        b.lineWidth = 1;
        b.stroke();
        for (let i = 0; i < 3; i++) {
          const ang = t * 2 + i * 2.1;
          b.globalAlpha = 0.5;
          b.fillRect(Math.round(x + Math.cos(ang) * a.r * 0.55), Math.round(y + Math.sin(ang) * a.r * 0.55), 2, 2);
        }
        break;
      }
      case 'spikes':
      case 'field': {
        b.globalAlpha = 0.3;
        b.fillStyle = '#3ddc84';
        b.beginPath();
        b.arc(x, y, a.r, 0, Math.PI * 2);
        b.fill();
        b.globalAlpha = 0.9;
        b.fillStyle = '#1f8a4c';
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + t;
          const rr = a.r * (0.35 + ((i * 37) % 60) / 100);
          b.fillRect(Math.round(x + Math.cos(ang) * rr), Math.round(y + Math.sin(ang) * rr) - 2, 1, 4);
        }
        break;
      }
      case 'gravity': {
        b.globalAlpha = 0.28;
        b.fillStyle = '#8b5cf6';
        b.beginPath();
        b.arc(x, y, a.r, 0, Math.PI * 2);
        b.fill();
        b.globalAlpha = 0.9;
        b.strokeStyle = '#c084fc';
        b.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const rr = a.r * (0.3 + ((t * 0.6 + i / 3) % 1) * 0.7);
          b.globalAlpha = 0.8 * (1 - ((t * 0.6 + i / 3) % 1));
          b.beginPath();
          b.arc(x, y, rr, 0, Math.PI * 2);
          b.stroke();
        }
        break;
      }
      case 'heal': {
        b.globalAlpha = a.l * 0.5;
        b.strokeStyle = '#7ef0a8';
        b.lineWidth = 2;
        b.beginPath();
        b.arc(x, y, a.r * (1 - a.l * 0.4), 0, Math.PI * 2);
        b.stroke();
        break;
      }
      case 'mine': {
        const blink = Math.sin(t * 8) > 0;
        b.globalAlpha = 0.55;
        b.strokeStyle = '#ffd23f';
        b.lineWidth = 1;
        b.beginPath();
        b.arc(x, y, a.r * 0.5, 0, Math.PI * 2);
        b.stroke();
        b.globalAlpha = 1;
        b.fillStyle = blink ? '#ff4d4d' : '#7a2020';
        b.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        break;
      }
      case 'grenade': {
        b.globalAlpha = a.l * 0.4;
        b.fillStyle = '#ffb0d0';
        b.beginPath();
        b.arc(x, y, a.r * 0.8, 0, Math.PI * 2);
        b.fill();
        break;
      }
      default: {
        // explosion flashes: kinds ending in _fx
        if (a.k.endsWith('_fx')) {
          const k = a.l;
          b.globalAlpha = k * 0.85;
          b.fillStyle = '#fff3b0';
          b.beginPath();
          b.arc(x, y, a.r * (1.05 - k * 0.35), 0, Math.PI * 2);
          b.fill();
          b.globalAlpha = k;
          b.strokeStyle = '#ff8a3d';
          b.lineWidth = 2;
          b.stroke();
        }
      }
    }
    b.restore();
  }

  private drawPlayer(
    b: CanvasRenderingContext2D,
    p: Snapshot['players'][number],
    ox: number,
    oy: number,
    you: number,
    snap: Snapshot,
  ) {
    const x = p.x - ox;
    const y = p.y - oy;
    if (x < -30 || y < -40 || x > this.viewW + 30 || y > this.viewH + 40) return;

    const isYou = p.i === you;
    const teamCol = TEAM_COLORS[p.t % TEAM_COLORS.length];
    const teamDark = TEAM_COLORS_DARK[p.t % TEAM_COLORS_DARK.length];
    const art = brawlerArt(p.b);
    const def = getBrawler(p.b);
    const hidden = !!(p.st & 2);
    const airborne = !!(p.st & 32);

    const bob = Math.sin(this.time * 8 + p.i * 1.7) * 0.6;
    const lift = airborne ? -Math.sin(Math.min(1, this.time % 1) * Math.PI) * 10 - 6 : 0;
    const py = y + bob + lift;

    // shadow
    b.globalAlpha = airborne ? 0.18 : 0.34;
    b.fillStyle = '#000';
    b.beginPath();
    b.ellipse(x, y + 7, 7, 3, 0, 0, Math.PI * 2);
    b.fill();
    b.globalAlpha = 1;

    // team ring
    b.strokeStyle = isYou ? '#ffffff' : teamCol;
    b.lineWidth = 1;
    b.globalAlpha = 0.85;
    b.beginPath();
    b.ellipse(x, y + 7, 8, 3.6, 0, 0, Math.PI * 2);
    b.stroke();
    b.globalAlpha = 1;

    if (hidden) b.globalAlpha = 0.45;

    // weapon behind or in front depending on facing
    const aim = p.a;
    const facingLeft = Math.cos(aim) < 0;
    const wx = x + Math.cos(aim) * 8;
    const wy = py + Math.sin(aim) * 4 - 1;
    const drawWeapon = () => {
      if (def.weapon === 'none' || def.weapon === 'fists') return;
      b.save();
      b.translate(Math.round(wx), Math.round(wy));
      b.rotate(aim);
      if (Math.cos(aim) < 0) b.scale(1, -1);
      b.drawImage(art.weapon, -2, -4);
      b.restore();
    };

    if (Math.sin(aim) < -0.2) drawWeapon();

    // body
    b.save();
    b.translate(Math.round(x), Math.round(py));
    if (facingLeft) b.scale(-1, 1);
    b.drawImage(art.body, -8, -12);
    b.restore();

    if (Math.sin(aim) >= -0.2) drawWeapon();

    // super-ready glow
    if (p.sc >= 100) {
      b.globalAlpha = 0.5 + Math.sin(this.time * 7) * 0.25;
      b.strokeStyle = '#ffd23f';
      b.lineWidth = 1;
      b.beginPath();
      b.arc(x, py - 3, 11, 0, Math.PI * 2);
      b.stroke();
      b.globalAlpha = 1;
    }
    if (p.st & 4) {
      b.globalAlpha = 0.35 + Math.sin(this.time * 14) * 0.2;
      b.strokeStyle = '#9ee6ff';
      b.beginPath();
      b.arc(x, py - 3, 12, 0, Math.PI * 2);
      b.stroke();
      b.globalAlpha = 1;
    }
    if (p.st & 16) {
      b.globalAlpha = 0.8;
      b.fillStyle = '#8b5cf6';
      for (let i = 0; i < 2; i++) {
        const a2 = this.time * 3 + i * 3;
        b.fillRect(Math.round(x + Math.cos(a2) * 7), Math.round(py - 10 + Math.sin(a2 * 1.4) * 3), 2, 2);
      }
      b.globalAlpha = 1;
    }

    b.globalAlpha = 1;

    /* -------------------------- nameplate + bars ------------------------- */
    const barW = 22;
    const barX = Math.round(x - barW / 2);
    const barY = Math.round(py - 20);
    const hpFrac = Math.max(0, Math.min(1, p.hp / Math.max(1, p.mx)));

    b.fillStyle = '#0d0a12';
    b.fillRect(barX - 1, barY - 1, barW + 2, 5);
    b.fillStyle = teamDark;
    b.fillRect(barX, barY, barW, 3);
    b.fillStyle = isYou ? '#4ade80' : teamCol;
    b.fillRect(barX, barY, Math.round(barW * hpFrac), 3);

    // super charge pips under the health bar for your own brawler
    if (isYou) {
      const scFrac = Math.min(1, p.sc / 100);
      b.fillStyle = '#0d0a12';
      b.fillRect(barX - 1, barY + 4, barW + 2, 3);
      b.fillStyle = p.sc >= 100 ? '#ffd23f' : '#8b5cf6';
      b.fillRect(barX, barY + 5, Math.round(barW * scFrac), 1);
    }

    // carried gems / stars
    if (p.g > 0 && (snap.cdTeam !== undefined)) {
      const icon = item('gem');
      const label = String(p.g);
      const w = 4 + label.length * 4;
      const gx = Math.round(x - w / 2);
      const gy = barY - 9;
      b.fillStyle = 'rgba(10,8,16,0.75)';
      b.fillRect(gx - 2, gy - 1, w + 4, 8);
      b.drawImage(icon, 0, 0, 8, 8, gx - 2, gy - 1, 7, 7);
      drawText(b, label, gx + 6, gy, { scale: 1, color: '#7ef0a8' });
    }

    if (!isYou) {
      const nameCol = hidden ? '#8a8a9a' : p.bot ? '#c8cdd6' : '#ffffff';
      drawText(b, p.n.slice(0, 10), Math.round(x), barY - 8, { scale: 1, color: nameCol, align: 'center', shadow: '#000' });
    }
  }

  private drawPet(b: CanvasRenderingContext2D, pt: Snapshot['pets'][number], ox: number, oy: number) {
    const x = pt.x - ox;
    const y = pt.y - oy;
    if (x < -30 || y < -30 || x > this.viewW + 30 || y > this.viewH + 30) return;
    const teamCol = TEAM_COLORS[pt.t % TEAM_COLORS.length];
    b.globalAlpha = 0.3;
    b.fillStyle = '#000';
    b.beginPath();
    b.ellipse(x, y + 7, 7, 3, 0, 0, Math.PI * 2);
    b.fill();
    b.globalAlpha = 1;
    const sprite = petArt(pt.k, teamCol);
    b.save();
    b.translate(Math.round(x), Math.round(y));
    if (pt.k === 'bear' && Math.cos(pt.a) < 0) b.scale(-1, 1);
    b.drawImage(sprite, -8, -12);
    b.restore();

    const barW = 16;
    const frac = Math.max(0, Math.min(1, pt.hp / Math.max(1, pt.mx)));
    b.fillStyle = '#0d0a12';
    b.fillRect(Math.round(x - barW / 2) - 1, Math.round(y - 17), barW + 2, 4);
    b.fillStyle = teamCol;
    b.fillRect(Math.round(x - barW / 2), Math.round(y - 16), Math.round(barW * frac), 2);
  }

  private drawProj(b: CanvasRenderingContext2D, pr: Snapshot['projs'][number], ox: number, oy: number) {
    const x = pr.x - ox;
    const y = pr.y - oy;
    if (x < -30 || y < -30 || x > this.viewW + 30 || y > this.viewH + 30) return;
    const st = PROJ_STYLES[pr.k] ?? DEFAULT_STYLE;
    const s = pr.s || 1;
    const w = st.w * s;
    const h = st.h * s;

    b.save();
    b.translate(x, y);
    b.rotate(pr.a);

    if (st.trail) {
      b.globalAlpha = 0.28;
      b.fillStyle = st.color;
      b.fillRect(-w / 2 - st.trail * s, -Math.max(1, h / 3), st.trail * s, Math.max(1, h * 0.66));
      b.globalAlpha = 1;
    }
    if (st.glow) {
      b.globalAlpha = 0.35;
      b.fillStyle = st.color;
      if (st.round) {
        b.beginPath();
        b.arc(0, 0, Math.max(w, h) * 0.75, 0, Math.PI * 2);
        b.fill();
      } else {
        b.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
      }
      b.globalAlpha = 1;
    }
    if (st.edge) {
      b.fillStyle = st.edge;
      if (st.round) {
        b.beginPath();
        b.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2);
        b.fill();
      } else {
        b.fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
      }
    }
    b.fillStyle = st.color;
    if (st.round) {
      b.beginPath();
      b.arc(0, 0, Math.max(1, Math.max(w, h) / 2 - 1), 0, Math.PI * 2);
      b.fill();
    } else {
      b.fillRect(-w / 2, -h / 2, w, h);
    }
    b.restore();
  }
}

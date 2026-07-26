import { GameMode, PLAYER_RADIUS, TILE } from '@shared/constants';
import { BLOCKS_MOVE, Tile, type MatchInitMsg, type Snapshot } from '@shared/types';
import { getBrawler } from '@shared/brawlers';
import { Renderer } from './renderer';
import { Controls } from './input';
import { drawHud, layoutHud } from './hud';
import { sfx } from '../audio';

const RENDER_DELAY = 110; // ms of interpolation buffer
const INPUT_INTERVAL = 1000 / 30;

interface Buffered {
  t: number;
  snap: Snapshot;
}

export class GameClient {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  controls = new Controls();
  init: MatchInitMsg | null = null;
  mode: GameMode = GameMode.GemGrab;
  you = 0;

  private buffer: Buffered[] = [];
  private latest: Snapshot | null = null;
  private mapTiles: Uint8Array = new Uint8Array(0);
  private mapW = 0;
  private mapH = 0;
  private brokenSeen = 0;

  private pred = { x: 0, y: 0, valid: false };
  private raf = 0;
  private lastFrame = 0;
  private inputInterval: number | null = null;
  private lastCmd = { mx: 0, my: 0, ax: 1, ay: 0, ad: 1, shoot: false, useSuper: false };
  private seq = 0;
  private events: { text: string; color: string; life: number }[] = [];
  private lastPhase = '';
  private lastCount = -1;

  ping = 0;
  running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private sendInput: (cmd: any) => void,
  ) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
  }

  private onResize() {
    this.renderer.resize();
    this.controls.layout = layoutHud(this.renderer.cssW, this.renderer.cssH, this.controls.touchMode);
  }

  start(init: MatchInitMsg) {
    this.init = init;
    this.mode = init.mode;
    this.you = init.you;
    this.mapW = init.map.w;
    this.mapH = init.map.h;
    this.mapTiles = Uint8Array.from(init.map.tiles);
    this.brokenSeen = 0;
    this.buffer = [];
    this.latest = null;
    this.pred.valid = false;
    this.events = [];
    this.lastPhase = '';
    this.lastCount = -1;

    this.renderer.setMap({ w: this.mapW, h: this.mapH, tiles: this.mapTiles, theme: init.map.theme as any });
    this.onResize();
    this.controls.attach(this.canvas);
    this.running = true;
    this.lastFrame = performance.now();
    // Input runs on its own clock so a throttled or stuttering frame rate never
    // starves the server of commands.
    if (this.inputInterval) clearInterval(this.inputInterval);
    this.inputInterval = window.setInterval(() => this.pumpInput(), INPUT_INTERVAL);
    this.loop(this.lastFrame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.inputInterval) clearInterval(this.inputInterval);
    this.inputInterval = null;
    this.controls.detach();
  }

  private pumpInput() {
    if (!this.running || !this.latest) return;
    const me = this.latest.players.find((p) => p.i === this.you);
    const def = getBrawler(me ? me.b : 'shelly');
    const rangePx = (def.attack.range * this.renderer.scale) / this.renderer.dpr;
    const cmd = this.controls.sample(rangePx);
    this.lastCmd = cmd;
    this.sendInput({
      t: 'input',
      q: ++this.seq,
      mx: cmd.mx,
      my: cmd.my,
      ax: cmd.ax,
      ay: cmd.ay,
      ad: cmd.ad,
      f: cmd.shoot,
      s: cmd.useSuper,
    });
  }

  /* -------------------------------- network ------------------------------ */

  onSnapshot(snap: Snapshot) {
    const now = performance.now();
    this.buffer.push({ t: now, snap });
    while (this.buffer.length > 24) this.buffer.shift();
    this.latest = snap;

    // apply destroyed crates
    if (snap.broken.length !== this.brokenSeen) {
      for (let i = this.brokenSeen; i < snap.broken.length; i++) {
        const idx = snap.broken[i];
        if (idx >= 0 && idx < this.mapTiles.length) this.mapTiles[idx] = Tile.Grass;
      }
      this.brokenSeen = snap.broken.length;
      this.renderer.markTilesChanged();
    }

    this.handleFx(snap);

    if (snap.phase !== this.lastPhase) {
      if (snap.phase === 'live') this.pushEvent('FIGHT!', '#ffd23f');
      this.lastPhase = snap.phase;
    }
    if (snap.phase === 'countdown') {
      const n = Math.ceil(snap.time);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        sfx.countdown();
      }
    }
  }

  private handleFx(snap: Snapshot) {
    const r = this.renderer;
    const me = snap.players.find((p) => p.i === this.you);
    for (const f of snap.fx) {
      const near = me ? Math.hypot(f.x - me.x, f.y - me.y) < 260 : true;
      switch (f.k) {
        case 'shoot':
          r.burst(f.x + Math.cos(f.a ?? 0) * 8, f.y + Math.sin(f.a ?? 0) * 8, 3, '#ffe066', 40, 0.15, 2);
          if (near) sfx.shoot();
          break;
        case 'super':
          r.ring(f.x, f.y, 26, '#ffd23f', 0.4);
          r.burst(f.x, f.y, 12, '#ffd23f', 90, 0.4, 2);
          if (near) sfx.superShot();
          break;
        case 'hit':
          r.burst(f.x, f.y, 4, '#ff8a3d', 55, 0.25, 2);
          if ((f.v ?? 0) > 0 && near) r.floatNumber(f.x, f.y - 12, f.v ?? 0, '#ffffff');
          if (near) sfx.hit();
          break;
        case 'explode':
          r.ring(f.x, f.y, f.v ?? 20, '#ff8a3d', 0.35);
          r.burst(f.x, f.y, 16, '#ffb03d', 110, 0.45, 3);
          r.shake = Math.min(6, (f.v ?? 20) / 5);
          if (near) sfx.explode();
          break;
        case 'kill':
          r.burst(f.x, f.y, 22, '#ff6b6b', 100, 0.6, 3);
          r.ring(f.x, f.y, 22, '#ff6b6b', 0.5);
          if (near) sfx.kill();
          break;
        case 'break':
          r.burst(f.x, f.y, 10, '#9a6b3f', 70, 0.4, 2);
          if (near) sfx.crate();
          break;
        case 'pickup':
          r.burst(f.x, f.y, 8, f.s === 'gem' ? '#7ef0a8' : '#c084fc', 60, 0.35, 2);
          if (near) (f.s === 'gem' ? sfx.gem : sfx.pickup)();
          break;
        case 'heal':
          if (near) {
            r.floatNumber(f.x, f.y - 14, f.v ?? 0, '#7ef0a8', '+');
            r.burst(f.x, f.y, 3, '#7ef0a8', 30, 0.4, 2);
            sfx.heal();
          }
          break;
        case 'star':
          r.floatText(f.x, f.y - 14, '+' + (f.v ?? 1), '#ffd23f');
          break;
        case 'bounce':
          r.burst(f.x, f.y, 3, '#8ff0ff', 50, 0.2, 1);
          break;
        case 'wallhit':
          r.burst(f.x, f.y, 3, '#c8cdd6', 40, 0.18, 1);
          break;
        case 'maul':
          r.burst(f.x, f.y, 6, '#8a5a3a', 60, 0.3, 2);
          break;
        case 'petdie':
          r.burst(f.x, f.y, 12, '#c8cdd6', 70, 0.4, 2);
          break;
      }
    }
  }

  pushEvent(text: string, color: string) {
    this.events.unshift({ text, color, life: 2.4 });
    if (this.events.length > 4) this.events.pop();
  }

  /* ------------------------------ prediction ----------------------------- */

  private blocked(x: number, y: number, r: number) {
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return true;
        const t = this.mapTiles[ty * this.mapW + tx] as Tile;
        if (!BLOCKS_MOVE.has(t)) continue;
        const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
        const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
        if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  private predict(dt: number, speed: number, mx: number, my: number) {
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      const dx = (mx * speed * dt) / steps;
      const dy = (my * speed * dt) / steps;
      if (!this.blocked(this.pred.x + dx, this.pred.y, PLAYER_RADIUS)) this.pred.x += dx;
      if (!this.blocked(this.pred.x, this.pred.y + dy, PLAYER_RADIUS)) this.pred.y += dy;
    }
  }

  /* ------------------------------ interpolation -------------------------- */

  private sample(renderTime: number): Snapshot | null {
    if (!this.buffer.length) return null;
    if (this.buffer.length === 1) return this.buffer[0].snap;
    let a = this.buffer[0];
    let b = this.buffer[this.buffer.length - 1];
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].t <= renderTime && this.buffer[i + 1].t >= renderTime) {
        a = this.buffer[i];
        b = this.buffer[i + 1];
        break;
      }
    }
    if (renderTime >= b.t) return b.snap;
    const span = b.t - a.t || 1;
    const k = Math.max(0, Math.min(1, (renderTime - a.t) / span));
    return lerpSnap(a.snap, b.snap, k);
  }

  /* --------------------------------- loop -------------------------------- */

  private loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    const view = this.sample(now - RENDER_DELAY);
    if (!view || !this.latest) return;

    for (const e of this.events) e.life -= dt;
    this.events = this.events.filter((e) => e.life > 0);

    const meLatest = this.latest.players.find((p) => p.i === this.you);
    const meView = view.players.find((p) => p.i === this.you);
    const def = meLatest ? getBrawler(meLatest.b) : getBrawler('shelly');

    // auto-aim target for tap-to-fire
    if (meLatest) {
      let best: { x: number; y: number } | null = null;
      let bd = 1e9;
      for (const p of this.latest.players) {
        if (p.i === this.you || p.t === meLatest.t || !(p.st & 1)) continue;
        const d = (p.x - meLatest.x) ** 2 + (p.y - meLatest.y) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        const dx = best.x - meLatest.x;
        const dy = best.y - meLatest.y;
        const len = Math.hypot(dx, dy) || 1;
        this.controls.autoAim = { x: dx / len, y: dy / len, dist: Math.min(1, len / def.attack.range), found: true };
      } else {
        this.controls.autoAim.found = false;
      }
    }

    // prediction rides on the most recent command the input pump produced
    const cmd = this.lastCmd;

    if (meLatest && meLatest.st & 1) {
      if (!this.pred.valid) {
        this.pred.x = meLatest.x;
        this.pred.y = meLatest.y;
        this.pred.valid = true;
      }
      const slow = meLatest.st & 8 ? 0.55 : 1;
      this.predict(dt, def.speed * slow, cmd.mx, cmd.my);
      const ex = meLatest.x - this.pred.x;
      const ey = meLatest.y - this.pred.y;
      const err = Math.hypot(ex, ey);
      if (err > 34) {
        this.pred.x = meLatest.x;
        this.pred.y = meLatest.y;
      } else {
        this.pred.x += ex * Math.min(1, dt * 6);
        this.pred.y += ey * Math.min(1, dt * 6);
      }
      if (meView) {
        meView.x = this.pred.x;
        meView.y = this.pred.y;
        const aimA = Math.atan2(cmd.ay, cmd.ax);
        meView.a = aimA;
      }
    } else {
      this.pred.valid = false;
    }

    const fx = meView ? meView.x : (this.mapW * TILE) / 2;
    const fy = meView ? meView.y : (this.mapH * TILE) / 2;
    this.renderer.render(view, { dt, you: this.you, mapTheme: (this.init?.map.theme ?? 'grass') as any, followX: fx, followY: fy });

    // keep the controls aware of where our brawler is on screen (mouse aiming)
    if (meView) {
      const s = this.renderer.worldToScreen(meView.x, meView.y);
      this.controls.setPlayerScreen(s.x, s.y);
    }

    drawHud(this.renderer.ctx, {
      snap: view,
      you: this.you,
      mode: this.mode,
      controls: this.controls,
      cssW: this.renderer.cssW,
      cssH: this.renderer.cssH,
      dpr: this.renderer.dpr,
      ping: this.ping,
      events: this.events,
    });
  };
}

/* ------------------------------ snapshot lerp ----------------------------- */

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function lerpSnap(a: Snapshot, b: Snapshot, k: number): Snapshot {
  const players = b.players.map((pb) => {
    const pa = a.players.find((p) => p.i === pb.i);
    if (!pa) return { ...pb };
    return { ...pb, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), a: lerpAngle(pa.a, pb.a, k) };
  });
  const projs = b.projs.map((pb) => {
    const pa = a.projs.find((p) => p.id === pb.id);
    if (!pa) return { ...pb };
    return { ...pb, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k) };
  });
  const pets = b.pets.map((pb) => {
    const pa = a.pets.find((p) => p.id === pb.id);
    if (!pa) return { ...pb };
    return { ...pb, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k), a: lerpAngle(pa.a, pb.a, k) };
  });
  const pickups = b.pickups.map((pb) => {
    const pa = a.pickups.find((p) => p.id === pb.id);
    if (!pa) return { ...pb };
    return { ...pb, x: lerp(pa.x, pb.x, k), y: lerp(pa.y, pb.y, k) };
  });
  return {
    ...b,
    players,
    projs,
    pets,
    pickups,
    time: lerp(a.time, b.time, k),
    cdTime: lerp(a.cdTime, b.cdTime, k),
    poison: b.poison < 0 ? b.poison : lerp(Math.max(0, a.poison), b.poison, k),
    // effects fire once on arrival, never during interpolation
    fx: [],
  };
}

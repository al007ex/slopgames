import { GameMode, TILE } from './constants.js';
import { Tile, type MapData, type MapTheme } from './types.js';

/* ------------------------------ seeded rng ------------------------------ */

export class Rng {
  private s: number;
  constructor(seed: number) {
    // Avalanche the seed first: sequential seeds otherwise produce near-identical
    // first draws, which made every generated map pick the same theme.
    let s = seed >>> 0 || 1;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    this.s = (s ^ (s >>> 16)) >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/* ------------------------------ dimensions ------------------------------ */

interface Dim {
  w: number;
  h: number;
}

const DIMS: Record<GameMode, Dim> = {
  [GameMode.Duel]: { w: 25, h: 21 },
  [GameMode.Bounty]: { w: 29, h: 23 },
  [GameMode.GemGrab]: { w: 33, h: 25 },
  [GameMode.Showdown]: { w: 43, h: 43 },
};

const THEMES: MapTheme[] = ['grass', 'desert', 'snow', 'mine'];

/* ------------------------------ generation ------------------------------ */

class Grid {
  w: number;
  h: number;
  t: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.t = new Uint8Array(w * h);
  }
  idx(x: number, y: number) {
    return y * this.w + x;
  }
  in(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): Tile {
    return this.in(x, y) ? (this.t[this.idx(x, y)] as Tile) : Tile.Wall;
  }
  set(x: number, y: number, v: Tile) {
    if (this.in(x, y)) this.t[this.idx(x, y)] = v;
  }
}

/** Writes a tile and every symmetric counterpart. */
function symSet(g: Grid, x: number, y: number, v: Tile, mode: 'rot180' | 'quad') {
  g.set(x, y, v);
  const mx = g.w - 1 - x;
  const my = g.h - 1 - y;
  if (mode === 'rot180') {
    g.set(mx, my, v);
  } else {
    g.set(mx, y, v);
    g.set(x, my, v);
    g.set(mx, my, v);
  }
}

function blob(g: Grid, rng: Rng, cx: number, cy: number, size: number, tile: Tile, sym: 'rot180' | 'quad') {
  let x = cx;
  let y = cy;
  for (let i = 0; i < size; i++) {
    if (g.in(x, y) && g.get(x, y) === Tile.Grass) symSet(g, x, y, tile, sym);
    const d = rng.int(0, 3);
    if (d === 0) x++;
    else if (d === 1) x--;
    else if (d === 2) y++;
    else y--;
    x = Math.max(1, Math.min(g.w - 2, x));
    y = Math.max(1, Math.min(g.h - 2, y));
  }
}

function rect(g: Grid, x0: number, y0: number, w: number, h: number, tile: Tile, sym: 'rot180' | 'quad') {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (g.in(x, y) && g.get(x, y) === Tile.Grass) symSet(g, x, y, tile, sym);
    }
  }
}

function clearArea(g: Grid, cx: number, cy: number, r: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!g.in(x, y)) continue;
      if (x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r + r) g.set(x, y, Tile.Grass);
    }
  }
}

const WALKABLE = (t: Tile) => t === Tile.Grass || t === Tile.Bush;

/** Carve a path between two points so the map is always traversable. */
function carve(g: Grid, x0: number, y0: number, x1: number, y1: number) {
  let x = x0;
  let y = y0;
  let guard = 0;
  while ((x !== x1 || y !== y1) && guard++ < 500) {
    if (!WALKABLE(g.get(x, y))) g.set(x, y, Tile.Grass);
    if (!WALKABLE(g.get(x, y - 1)) && g.in(x, y - 1) && y !== y1) g.set(x, y, Tile.Grass);
    if (x !== x1 && (y === y1 || Math.random() < 0.5)) x += Math.sign(x1 - x);
    else if (y !== y1) y += Math.sign(y1 - y);
    else x += Math.sign(x1 - x);
  }
  if (g.in(x1, y1) && !WALKABLE(g.get(x1, y1))) g.set(x1, y1, Tile.Grass);
}

function reachable(g: Grid, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(g.w * g.h);
  if (!WALKABLE(g.get(sx, sy))) return seen;
  const stack = [g.idx(sx, sy)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % g.w;
    const y = (i / g.w) | 0;
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nb) {
      if (!g.in(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (seen[j] || !WALKABLE(g.get(nx, ny))) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

export function generateMap(mode: GameMode, seed: number): MapData {
  const rng = new Rng(seed);
  const dim = DIMS[mode];
  const g = new Grid(dim.w, dim.h);
  const theme: MapTheme = THEMES[Math.floor(rng.next() * THEMES.length)];
  const sym: 'rot180' | 'quad' = mode === GameMode.Showdown ? 'quad' : 'rot180';

  // outer wall
  for (let x = 0; x < g.w; x++) {
    g.set(x, 0, Tile.Wall);
    g.set(x, g.h - 1, Tile.Wall);
  }
  for (let y = 0; y < g.h; y++) {
    g.set(0, y, Tile.Wall);
    g.set(g.w - 1, y, Tile.Wall);
  }

  const halfW = Math.floor(g.w / 2);
  const halfH = Math.floor(g.h / 2);
  const area = g.w * g.h;

  // ---- structural cover -------------------------------------------------
  const wallClusters = Math.round((area / 190) * rng.range(0.85, 1.25));
  for (let i = 0; i < wallClusters; i++) {
    const x = rng.int(2, sym === 'quad' ? halfW : g.w - 3);
    const y = rng.int(2, halfH);
    const kind = rng.next();
    if (kind < 0.42) {
      // rock outcrop
      blob(g, rng, x, y, rng.int(3, 9), Tile.Wall, sym);
    } else if (kind < 0.62) {
      // straight wall segment
      const len = rng.int(2, 5);
      const horiz = rng.chance(0.5);
      rect(g, x, y, horiz ? len : 1, horiz ? 1 : len, Tile.Wall, sym);
    } else if (kind < 0.78) {
      // fence line (blocks movement, not shots)
      const len = rng.int(3, 6);
      const horiz = rng.chance(0.5);
      rect(g, x, y, horiz ? len : 1, horiz ? 1 : len, Tile.Fence, sym);
    } else if (kind < 0.9) {
      blob(g, rng, x, y, rng.int(4, 10), Tile.Water, sym);
    } else {
      symSet(g, x, y, Tile.Tree, sym);
      if (rng.chance(0.6)) symSet(g, x + 1, y, Tile.Tree, sym);
    }
  }

  // ---- bushes -----------------------------------------------------------
  const bushPatches = Math.round((area / 120) * rng.range(0.9, 1.3));
  for (let i = 0; i < bushPatches; i++) {
    const x = rng.int(2, sym === 'quad' ? halfW : g.w - 3);
    const y = rng.int(2, halfH);
    blob(g, rng, x, y, rng.int(3, 12), Tile.Bush, sym);
  }

  // ---- destructible crates ---------------------------------------------
  const crates = Math.round((area / 150) * rng.range(0.8, 1.4));
  for (let i = 0; i < crates; i++) {
    const x = rng.int(2, sym === 'quad' ? halfW : g.w - 3);
    const y = rng.int(2, halfH);
    if (g.get(x, y) === Tile.Grass) symSet(g, x, y, Tile.Crate, sym);
  }

  // ---- spawns -----------------------------------------------------------
  const spawns: { x: number; y: number; team: number }[] = [];
  let gemSpawn: { x: number; y: number } | undefined;

  if (mode === GameMode.Showdown) {
    // eight spawns around the ring
    const pts: [number, number][] = [
      [3, 3],
      [halfW, 3],
      [g.w - 4, 3],
      [3, halfH],
      [g.w - 4, halfH],
      [3, g.h - 4],
      [halfW, g.h - 4],
      [g.w - 4, g.h - 4],
    ];
    pts.forEach(([x, y], i) => {
      clearArea(g, x, y, 2);
      spawns.push({ x, y, team: i });
    });
    // a rich centre worth fighting over
    clearArea(g, halfW, halfH, 3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cx = Math.round(halfW + Math.cos(a) * 3);
      const cy = Math.round(halfH + Math.sin(a) * 3);
      if (g.get(cx, cy) === Tile.Grass) g.set(cx, cy, Tile.Crate);
    }
  } else {
    const teamSize = mode === GameMode.GemGrab ? 3 : mode === GameMode.Bounty ? 2 : 1;
    const sx = 3;
    for (let s = 0; s < teamSize; s++) {
      const off = teamSize === 1 ? 0 : (s - (teamSize - 1) / 2) * 3;
      const y = Math.round(halfH + off);
      clearArea(g, sx, y, 2);
      clearArea(g, g.w - 1 - sx, g.h - 1 - y, 2);
      spawns.push({ x: sx, y, team: 0 });
      spawns.push({ x: g.w - 1 - sx, y: g.h - 1 - y, team: 1 });
    }
    if (mode === GameMode.GemGrab) {
      clearArea(g, halfW, halfH, 2);
      gemSpawn = { x: halfW, y: halfH };
      // decorative ring of bushes around the mine
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bx = Math.round(halfW + Math.cos(a) * 3);
        const by = Math.round(halfH + Math.sin(a) * 3);
        if (g.get(bx, by) === Tile.Grass) g.set(bx, by, Tile.Bush);
      }
    } else {
      clearArea(g, halfW, halfH, 2);
    }
  }

  // ---- guarantee connectivity ------------------------------------------
  const centre = { x: halfW, y: halfH };
  if (!WALKABLE(g.get(centre.x, centre.y))) g.set(centre.x, centre.y, Tile.Grass);
  let seen = reachable(g, centre.x, centre.y);
  for (const sp of spawns) {
    if (!seen[g.idx(sp.x, sp.y)]) {
      carve(g, sp.x, sp.y, centre.x, centre.y);
      seen = reachable(g, centre.x, centre.y);
    }
  }
  // seal off any pocket that nothing can reach so bots never path into it
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = g.idx(x, y);
      if (WALKABLE(g.get(x, y)) && !seen[i]) g.set(x, y, Tile.Wall);
    }
  }

  return {
    w: g.w,
    h: g.h,
    tiles: g.t,
    spawns,
    gemSpawn,
    seed,
    theme,
  };
}

/* ------------------------------- helpers -------------------------------- */

export function tileAt(map: { w: number; h: number; tiles: Uint8Array | number[] }, wx: number, wy: number): Tile {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return Tile.Wall;
  return map.tiles[ty * map.w + tx] as Tile;
}

export function worldW(map: { w: number }) {
  return map.w * TILE;
}
export function worldH(map: { h: number }) {
  return map.h * TILE;
}

export function tileCenter(tx: number, ty: number) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

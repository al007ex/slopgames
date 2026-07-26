/**
 * Every pixel in the game is authored here as palette-indexed character art and
 * baked into offscreen canvases once at boot. No external image assets.
 */
import { BRAWLERS, type BrawlerDef } from '@shared/brawlers';
import type { MapTheme } from '@shared/types';

export type Pal = Record<string, string>;

export function makeSprite(rows: string[], pal: Pal): HTMLCanvasElement {
  const w = rows[0].length;
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const col = pal[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function blank(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------ body shapes ------------------------------ */

const BODY_MEDIUM = [
  '................',
  '....KKKKKKKK....',
  '..KKHHHHHHHHKK..',
  '..KHHHHHHHHHHK..',
  '.KHHSSSSSSSSHHK.',
  '.KHSSSSSSSSSSHK.',
  '.KSSEPSSSSEPSSK.',
  '.KSSSSSSSSSSSSK.',
  '.KSSSSSssSSSSSK.',
  '..KSSSSSSSSSSK..',
  '...KKKKKKKKKK...',
  '..KCCCCCCCCCCK..',
  '.KSCCCCAACCCCSK.',
  '.KSCCCCCCCCCCSK.',
  '..KcCCCCCCCCcK..',
  '..KKcc....ccKK..',
];

const BODY_SMALL = [
  '................',
  '...KKKKKKKKKK...',
  '..KHHHHHHHHHHK..',
  '.KHHHHHHHHHHHHK.',
  '.KHHSSSSSSSSHHK.',
  '.KHSSSSSSSSSSHK.',
  '.KSSEPSSSSEPSSK.',
  '.KSSSSSSSSSSSSK.',
  '.KSSSSSssSSSSSK.',
  '..KSSSSSSSSSSK..',
  '...KKKKKKKKKK...',
  '...KCCCCCCCCK...',
  '..KSCCCAACCCSK..',
  '..KSCCCCCCCCSK..',
  '...KcCCCCCCcK...',
  '...KKcc..ccKK...',
];

const BODY_LARGE = [
  '................',
  '....KKKKKKKK....',
  '..KKHHHHHHHHKK..',
  '..KHHHHHHHHHHK..',
  '..KHSSSSSSSSHK..',
  '..KSSSSSSSSSSK..',
  '..KSEPSSSSEPSK..',
  '..KSSSSSSSSSSK..',
  '..KSSSSSssSSSK..',
  '...KSSSSSSSSK...',
  '.KKKKKKKKKKKKKK.',
  '.KCCCCCCCCCCCCK.',
  'KSSCCCCAACCCCSSK',
  'KSSCCCCCCCCCCSSK',
  '.KcCCCCCCCCCCcK.',
  '.KKccc....cccKK.',
];

const BODIES = { small: BODY_SMALL, medium: BODY_MEDIUM, large: BODY_LARGE };

/* --------------------------------- hats ---------------------------------- */

const E16 = '................';
const pad = (rows: string[]) => {
  const out = rows.slice();
  while (out.length < 16) out.push(E16);
  return out;
};

const HATS: Record<string, string[]> = {
  none: pad([]),
  cap: pad([E16, '....KKKKKKKK....', '..KKAAAAAAAAKK..', '..KAAAAAAAAAAK..', '.KKAAAAAAAAAAKK.', '.KAAAAAAAAAAAAK.']),
  cowboy: pad([E16, '....KKKKKKKK....', '...KAAAAAAAAK...', '...KAAAAAAAAK...', 'KKKKAAAAAAAAKKKK', 'KAAAAAAAAAAAAAAK']),
  top: pad(['....KKKKKKKK....', '....KAAAAAAK....', '....KAAAAAAK....', '....KAAAAAAK....', '..KKKKKKKKKKKK..', '..KAAAAAAAAAAK..']),
  helmet: pad([E16, '....KKKKKKKK....', '..KKAAAAAAAAKK..', '.KAAAAAAAAAAAAK.', '.KAAAAAAAAAAAAK.', '.KAAAAAAAAAAAAK.']),
  hood: pad([
    E16,
    '....KKKKKKKK....',
    '..KKAAAAAAAAKK..',
    '.KAAAAAAAAAAAAK.',
    '.KAAAAAAAAAAAAK.',
    '.KAA........AAK.',
    '.KA..........AK.',
    '.KA..........AK.',
    '.KAA........AAK.',
    '..KA........AK..',
  ]),
  mask: pad([
    E16,
    '....KKKKKKKK....',
    '..KKAAAAAAAAKK..',
    '..KAAAAAAAAAAK..',
    '.KAAAAAAAAAAAAK.',
    '.KAAAAAAAAAAAAK.',
    '.KAA..AAAA..AAK.',
    '.KAAAAAAAAAAAAK.',
    '.KAA........AAK.',
  ]),
  bandana: pad([E16, E16, E16, E16, '.KAAAAAAAAAAAAK.', '.KAAAAAAAAAAAAK.']),
  hair: pad([
    E16,
    E16,
    E16,
    E16,
    '.HH..........HH.',
    '.HH..........HH.',
    'HHH..........HHH',
    'HHH..........HHH',
    '.HH..........HH.',
    '.HH..........HH.',
    '..H..........H..',
  ]),
  horns: pad(['.AA..........AA.', '.AAA........AAA.', '..AAK......KAA..', E16, E16]),
  beak: pad([
    '.......AA.......',
    '......AAAA......',
    E16,
    E16,
    E16,
    E16,
    E16,
    '......AAAA......',
    '.....AAAAAA.....',
    '......AAAA......',
  ]),
};

/* -------------------------------- weapons -------------------------------- */

const WEAPONS: Record<string, string[]> = {
  none: ['........', '........', '........', '........', '........', '........', '........', '........'],
  fists: ['........', '..KKKK..', '.KGGGGK.', '.KGGGGK.', '.KGGGGK.', '.KGGGGK.', '..KKKK..', '........'],
  gun: ['........', '........', 'KKKKKK..', 'KGGGGGK.', 'KGGGGGGK', 'KKKgggK.', '..KggK..', '...KK...'],
  shotgun: ['........', 'KKKKKKKK', 'KGGGGGGK', 'KKKKKKKK', 'KGGGGGGK', 'KKKKgggK', '...KggK.', '....KK..'],
  rifle: ['........', '........', 'KKKKKKKK', 'KGGGGGGK', 'KKKKKKKK', '..KgggK.', '..KggK..', '...KK...'],
  bottle: ['...KK...', '...KK...', '..KAAK..', '.KAAAAK.', '.KAAAAK.', '.KAAAAK.', '.KAAAAK.', '..KKKK..'],
  sticks: ['....K...', '...K....', '..KAAK..', '.KAAAAK.', '.KAAAAK.', '.KAAAAK.', '.KAAAAK.', '..KKKK..'],
  axe: ['..KKKK..', '.KGGGGK.', '.KGGGGK.', '..KKKK..', '...Kg...', '...Kg...', '...Kg...', '...KK...'],
  blade: ['....K...', '...KGK..', '..KGGK..', '..KGGK..', '..KGGK..', '.KKKKKK.', '...KK...', '...KK...'],
  staff: ['......K.', '.....KGK', '..KKKGK.', '.KAAAK..', 'KAAAAAK.', 'KAAAAAK.', '.KAAAK..', '..KKK...'],
};

/* ------------------------------- environment ----------------------------- */

const BUSH = [
  '..LLLL....LLLL..',
  '.LLLLLL..LLLLLL.',
  'LLLLLLLLLLLLLLLL',
  'LLLdLLLLLLLLdLLL',
  'LLLLLLLdLLLLLLLL',
  'LLLLLLLLLLLLLLLL',
  'LLdLLLLLLLLLLdLL',
  'LLLLLLLLLLLLLLLL',
  'LLLLLLLLdLLLLLLL',
  'LLLLLLLLLLLLLLLL',
  'LLdLLLLLLLLLdLLL',
  'LLLLLLLLLLLLLLLL',
  'LLLLLLLdLLLLLLLL',
  'LLLLLLLLLLLLLLLL',
  '.LLLLLL..LLLLLL.',
  '..LLLL....LLLL..',
];

const CRATE = [
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWWK',
  'KWddWWWWWWWWddWK',
  'KWWWWWWWWWWWWWWK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWWK',
  'KWWddWWWWWWddWWK',
  'KWWWWWWWWWWWWWWK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWWK',
  'KWddWWWWWWWWddWK',
  'KWWWWWWWWWWWWWWK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
];

const FENCE = [
  '................',
  '..KK........KK..',
  '..KW........KW..',
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
  '..KW........KW..',
  '..KW........KW..',
  'KKKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
  '..KW........KW..',
  '..KW........KW..',
  '..KW........KW..',
  '..KK........KK..',
  '................',
];

const TREE = [
  '.....LLLLLL.....',
  '...LLLLLLLLLL...',
  '..LLLLLLLLLLLL..',
  '.LLLLLLLLLLLLLL.',
  '.LLLdLLLLLLdLLL.',
  'LLLLLLLLLLLLLLLL',
  'LLLLLLLdLLLLLLLL',
  'LLLLLLLLLLLLLLLL',
  'LLLdLLLLLLLLdLLL',
  '.LLLLLLLLLLLLLL.',
  '.LLLLLLLLLLLLLL.',
  '..LLLLLLLLLLLL..',
  '...LLLLLLLLLL...',
  '.....LLLLLL.....',
  '......TTTT......',
  '......TtTT......',
  '......TTtT......',
  '......TTTT......',
  '......TtTT......',
  '......TTTT......',
  '.....TTTTTT.....',
  '....TTTTTTTT....',
  '...TTTTTTTTTT...',
  '................',
];

const SKULL = [
  '................',
  '...KKKKKKKKKK...',
  '..KWWWWWWWWWWK..',
  '.KWWWWWWWWWWWWK.',
  '.KWWKKWWWWKKWWK.',
  '.KWKKKKWWKKKKWK.',
  '.KWKKKKWWKKKKWK.',
  '.KWWKKWWWWKKWWK.',
  '.KWWWWWWWWWWWWK.',
  '.KWWWWKWWKWWWWK.',
  '..KWWWWWWWWWWK..',
  '..KWKWKWKWKWWK..',
  '...KKKKKKKKKK...',
  '................',
  '................',
  '................',
];

/* ---------------------------------- items -------------------------------- */

const GEM = ['..GGGG..', '.GhhhhG.', 'GhhhhhhG', 'GhhhhhhG', '.GhhhhG.', '..GhhG..', '...GG...', '........'];
const CUBE = ['..KKKK..', '.KAAAAK.', 'KAWWWWAK', 'KAWWWWAK', 'KAWWWWAK', 'KAWWWWAK', '.KAAAAK.', '..KKKK..'];
const STAR = ['...XX...', '...XX...', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '.XXXXXX.', '.XX..XX.', '........'];
const TROPHY = ['.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...', '..XXXX..', '.XXXXXX.'];
const COIN = ['..XXXX..', '.XXXXXX.', 'XXddddXX', 'XXdXXdXX', 'XXdXXdXX', 'XXddddXX', '.XXXXXX.', '..XXXX..'];
const TOKEN = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXddXXX', 'XXXddXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'];
const GEMICON = ['..XXXX..', '.XddddX.', 'XddddddX', 'XddddddX', '.XddddX.', '..XddX..', '...XX...', '........'];
const PP = ['...XX...', '..XXXX..', '.XXXXXX.', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...', '........'];

const BOX = [
  '................',
  '..KKKKKKKKKKKK..',
  '..KAAAAAAAAAAK..',
  '..KWWWWWWWWWWK..',
  '..KWWWWWWWWWWK..',
  '.KAAAAAAAAAAAAK.',
  '.KKKKKKKKKKKKKK.',
  '.KWWWWWAAWWWWWK.',
  '.KWWWWWAAWWWWWK.',
  '.KWWWWWAAWWWWWK.',
  '.KWWWWWAAWWWWWK.',
  '.KWWWWWWWWWWWWK.',
  '.KWWWWWWWWWWWWK.',
  '.KKKKKKKKKKKKKK.',
  '................',
  '................',
];

const BEAR = [
  '..KK........KK..',
  '.KBBK......KBBK.',
  '.KBBKKKKKKKKBBK.',
  '..KBBBBBBBBBBK..',
  '.KBBBBBBBBBBBBK.',
  '.KBBEPBBBBEPBBK.',
  '.KBBBBBBBBBBBBK.',
  '.KBBBBWWWWBBBBK.',
  '.KBBBBWddWBBBBK.',
  '..KBBBWWWWBBBK..',
  '.KKBBBBBBBBBBKK.',
  'KBBBBBBBBBBBBBBK',
  'KBBBBBBBBBBBBBBK',
  '.KBBBBBBBBBBBBK.',
  '..KKBB....BBKK..',
  '................',
];

const TURRET = [
  '................',
  '................',
  '.....KKKK.......',
  '....KAAAAK......',
  '...KAWWWWAKKKK..',
  '...KAWWWWAGGGK..',
  '...KAAAAAKKKKK..',
  '....KAAAAK......',
  '...KKAAAAKK.....',
  '..KGGGGGGGGK....',
  '..KGGGGGGGGK....',
  '.KKKKKKKKKKKK...',
  '.KGGGGGGGGGGK...',
  '..KKKKKKKKKK....',
  '................',
  '................',
];

const HEALTURRET = [
  '................',
  '......KKKK......',
  '.....KAAAAK.....',
  '....KAWWWWAK....',
  '....KAWddWAK....',
  '....KAWddWAK....',
  '...KAAWWWWAAK...',
  '...KAAAAAAAAK...',
  '..KGGGGGGGGGGK..',
  '..KGGGGGGGGGGK..',
  '.KKKKKKKKKKKKKK.',
  '.KGGGGGGGGGGGGK.',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
  '................',
];

/* ------------------------------ theme palettes --------------------------- */

export interface ThemePal {
  grass: [string, string, string];
  rock: [string, string, string];
  water: [string, string, string];
  bush: [string, string];
  wood: [string, string];
  tree: [string, string, string, string];
  fog: string;
}

export const THEME_PALETTES: Record<MapTheme, ThemePal> = {
  grass: {
    grass: ['#5aa84a', '#4b8f3e', '#6fc25c'],
    rock: ['#8b9099', '#5c6169', '#adb3bd'],
    water: ['#3b82c4', '#2a5f96', '#69b0e8'],
    bush: ['#2f7d3a', '#25632e'],
    wood: ['#9a6b3f', '#6f4a29'],
    tree: ['#2f7d3a', '#25632e', '#7a5230', '#5c3d24'],
    fog: '#0b1a10',
  },
  desert: {
    grass: ['#d3ac68', '#bb9455', '#e6c689'],
    rock: ['#a8895f', '#7c6343', '#c4a67c'],
    water: ['#4aa3c4', '#357f9b', '#7ac9e2'],
    bush: ['#7f9a3e', '#647a30'],
    wood: ['#a8763f', '#7a5329'],
    tree: ['#7f9a3e', '#647a30', '#8a6236', '#644526'],
    fog: '#2a1d0e',
  },
  snow: {
    grass: ['#dfe9f0', '#c3d2de', '#f2f8fb'],
    rock: ['#8fa0ad', '#65737e', '#b3c1cc'],
    water: ['#5ab3d8', '#3d8db3', '#8fd8f0'],
    bush: ['#3f7f5a', '#2f6446'],
    wood: ['#8a6a4a', '#63492f'],
    tree: ['#3f7f5a', '#2f6446', '#6b4a30', '#4e3421'],
    fog: '#0d1620',
  },
  mine: {
    grass: ['#7a6a55', '#615343', '#93816a'],
    rock: ['#6d6a76', '#4b4954', '#8b8895'],
    water: ['#4b6ea8', '#36527e', '#7093c4'],
    bush: ['#4a7040', '#385733'],
    wood: ['#8a6238', '#5f4325'],
    tree: ['#4a7040', '#385733', '#6b4a2c', '#4c341e'],
    fog: '#120e14',
  },
};

/* ------------------------------ tile builders ---------------------------- */

function rngFrom(seed: number) {
  let s = seed >>> 0 || 7;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function grassTile(pal: ThemePal, seed: number): HTMLCanvasElement {
  const c = blank(16, 16);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.grass[0];
  ctx.fillRect(0, 0, 16, 16);
  const r = rngFrom(seed);
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = r() < 0.55 ? pal.grass[1] : pal.grass[2];
    ctx.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 1);
  }
  // a couple of little tufts
  for (let i = 0; i < 3; i++) {
    const x = 1 + Math.floor(r() * 13);
    const y = 2 + Math.floor(r() * 12);
    ctx.fillStyle = pal.grass[1];
    ctx.fillRect(x, y, 1, 2);
    ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillRect(x - 1, y + 1, 1, 1);
  }
  return c;
}

function rockTile(pal: ThemePal, seed: number): HTMLCanvasElement {
  const c = blank(16, 16);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.rock[0];
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = pal.rock[2];
  ctx.fillRect(0, 0, 16, 2);
  ctx.fillRect(0, 0, 2, 16);
  ctx.fillStyle = pal.rock[1];
  ctx.fillRect(0, 14, 16, 2);
  ctx.fillRect(14, 0, 2, 16);
  const r = rngFrom(seed);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = r() < 0.5 ? pal.rock[1] : pal.rock[2];
    ctx.fillRect(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 1 + (r() < 0.3 ? 1 : 0), 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 15, 16, 1);
  return c;
}

function waterTile(pal: ThemePal, seed: number): HTMLCanvasElement {
  const c = blank(16, 16);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.water[0];
  ctx.fillRect(0, 0, 16, 16);
  const r = rngFrom(seed);
  ctx.fillStyle = pal.water[1];
  for (let i = 0; i < 5; i++) {
    const y = Math.floor(r() * 16);
    ctx.fillRect(Math.floor(r() * 10), y, 4 + Math.floor(r() * 4), 1);
  }
  ctx.fillStyle = pal.water[2];
  for (let i = 0; i < 4; i++) {
    const y = Math.floor(r() * 16);
    ctx.fillRect(Math.floor(r() * 11), y, 3 + Math.floor(r() * 3), 1);
  }
  return c;
}

/* -------------------------------- registry -------------------------------- */

export interface TileSet {
  grass: HTMLCanvasElement[];
  rock: HTMLCanvasElement[];
  water: HTMLCanvasElement[];
  bush: HTMLCanvasElement;
  crate: HTMLCanvasElement;
  fence: HTMLCanvasElement;
  tree: HTMLCanvasElement;
  skull: HTMLCanvasElement;
  pal: ThemePal;
}

const tileCache = new Map<MapTheme, TileSet>();

export function tilesFor(theme: MapTheme): TileSet {
  const hit = tileCache.get(theme);
  if (hit) return hit;
  const pal = THEME_PALETTES[theme] ?? THEME_PALETTES.grass;
  const set: TileSet = {
    grass: [grassTile(pal, 11), grassTile(pal, 977), grassTile(pal, 40213), grassTile(pal, 7717)],
    rock: [rockTile(pal, 31), rockTile(pal, 8191)],
    water: [waterTile(pal, 5), waterTile(pal, 909)],
    bush: makeSprite(BUSH, { L: pal.bush[0], d: pal.bush[1] }),
    crate: makeSprite(CRATE, { K: '#3a2413', W: pal.wood[0], d: pal.wood[1] }),
    fence: makeSprite(FENCE, { K: '#3a2413', W: pal.wood[0] }),
    tree: makeSprite(TREE, { L: pal.tree[0], d: pal.tree[1], T: pal.tree[2], t: pal.tree[3] }),
    skull: makeSprite(SKULL, { K: '#2b2b33', W: '#e6e6ee' }),
    pal,
  };
  tileCache.set(theme, set);
  return set;
}

/* --------------------------------- items ---------------------------------- */

export const ITEMS = {
  gem: () => makeSprite(GEM, { G: '#7ef0a8', h: '#28c46a' }),
  cube: () => makeSprite(CUBE, { K: '#20142a', A: '#c084fc', W: '#f0d6ff' }),
  star: () => makeSprite(STAR, { X: '#ffd23f' }),
  trophy: () => makeSprite(TROPHY, { X: '#ffd23f' }),
  coin: () => makeSprite(COIN, { X: '#ffd23f', d: '#a97a10' }),
  token: () => makeSprite(TOKEN, { X: '#8fd4ff', d: '#2a7ba8' }),
  gemicon: () => makeSprite(GEMICON, { X: '#7ef0a8', d: '#28c46a' }),
  pp: () => makeSprite(PP, { X: '#ffd23f' }),
  box: () => makeSprite(BOX, { K: '#2b1a10', W: '#c98a45', A: '#ffd23f' }),
};

let itemCache: Record<string, HTMLCanvasElement> | null = null;
export function item(name: keyof typeof ITEMS): HTMLCanvasElement {
  if (!itemCache) {
    itemCache = {};
    for (const k of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) itemCache[k] = ITEMS[k]();
  }
  return itemCache[name];
}

/* -------------------------------- brawlers -------------------------------- */

export interface BrawlerArt {
  body: HTMLCanvasElement;
  weapon: HTMLCanvasElement;
  /** body with a white silhouette, used for hit flashes */
  flash: HTMLCanvasElement;
}

const brawlerCache = new Map<string, BrawlerArt>();

function palFor(def: BrawlerDef): Pal {
  const c = def.colors;
  return {
    K: '#1a1420',
    S: c.skin,
    s: c.skinDark,
    H: c.hair,
    h: c.hairDark,
    C: c.cloth,
    c: c.clothDark,
    A: c.accent,
    E: '#ffffff',
    P: '#241a2e',
    G: c.gun,
    g: c.gunDark,
    L: c.cloth,
    B: c.cloth,
    W: '#ffffff',
    d: c.accent,
    X: c.accent,
  };
}

function whiten(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = blank(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function brawlerArt(id: string): BrawlerArt {
  const hit = brawlerCache.get(id);
  if (hit) return hit;
  const def = BRAWLERS.find((b) => b.id === id) ?? BRAWLERS[0];
  const pal = palFor(def);

  const body = blank(16, 16);
  const bctx = body.getContext('2d')!;
  bctx.drawImage(makeSprite(BODIES[def.build], pal), 0, 0);
  const hat = HATS[def.hat] ?? HATS.none;
  bctx.drawImage(makeSprite(hat, pal), 0, 0);

  const weapon = makeSprite(WEAPONS[def.weapon] ?? WEAPONS.none, pal);

  const art: BrawlerArt = { body, weapon, flash: whiten(body) };
  brawlerCache.set(id, art);
  return art;
}

export function petArt(kind: string, teamColor: string): HTMLCanvasElement {
  const key = 'pet:' + kind + teamColor;
  const hit = brawlerCache.get(key);
  if (hit) return hit.body;
  let cv: HTMLCanvasElement;
  if (kind === 'bear') {
    cv = makeSprite(BEAR, { K: '#1a1420', B: '#8a5a3a', E: '#ffffff', P: '#241a2e', W: '#f4e6d0', d: '#241a2e' });
  } else if (kind === 'healturret') {
    cv = makeSprite(HEALTURRET, { K: '#1a1420', A: '#4ec97a', W: '#eafff0', d: '#e0446a', G: teamColor });
  } else {
    cv = makeSprite(TURRET, { K: '#1a1420', A: '#ffd23f', W: '#fff6d0', G: teamColor });
  }
  brawlerCache.set(key, { body: cv, weapon: cv, flash: cv });
  return cv;
}

/* ------------------------------ dom helpers ------------------------------- */

/** Scales a sprite canvas up with nearest-neighbour for use in the DOM. */
export function upscale(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = blank(src.width * scale, src.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const dataUrlCache = new Map<string, string>();

/** A ready-to-use <img> src for a brawler, cached per id+scale. */
export function brawlerDataUrl(id: string, scale = 4): string {
  const key = id + ':' + scale;
  const hit = dataUrlCache.get(key);
  if (hit) return hit;
  const art = brawlerArt(id);
  const def = BRAWLERS.find((b) => b.id === id) ?? BRAWLERS[0];
  const c = blank(24 * scale, 20 * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // weapon peeking out to the side, then the body on top
  ctx.drawImage(art.weapon, 0, 0, 8, 8, 15 * scale, 10 * scale, 8 * scale, 8 * scale);
  ctx.drawImage(art.body, 0, 0, 16, 16, 4 * scale, 2 * scale, 16 * scale, 16 * scale);
  void def;
  const url = c.toDataURL();
  dataUrlCache.set(key, url);
  return url;
}

export function itemDataUrl(name: keyof typeof ITEMS, scale = 3): string {
  const key = 'item:' + name + ':' + scale;
  const hit = dataUrlCache.get(key);
  if (hit) return hit;
  const url = upscale(item(name), scale).toDataURL();
  dataUrlCache.set(key, url);
  return url;
}

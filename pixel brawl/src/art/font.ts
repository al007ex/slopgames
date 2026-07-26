/**
 * A hand-drawn 5x7 bitmap font, rendered to per-colour glyph atlases so text
 * stays crisp at any integer scale.
 */

const G: Record<string, string[]> = {
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '..XX.', '.X...', 'X....', 'XXXXX'],
  '3': ['XXXXX', '...X.', '..X..', '...X.', '....X', 'X...X', '.XXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['..XX.', '.X...', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '...X.', '.XX..'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'],
  G: ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  J: ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
  K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X.X.X', 'X..XX', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'XX.XX', 'X...X'],
  X: ['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..X..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..X..', '.X...'],
  ':': ['.....', '..X..', '.....', '.....', '..X..', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.XXX.', '.....', '.....', '.....'],
  '+': ['.....', '..X..', '..X..', 'XXXXX', '..X..', '..X..', '.....'],
  '/': ['....X', '....X', '...X.', '..X..', '.X...', 'X....', 'X....'],
  '!': ['..X..', '..X..', '..X..', '..X..', '..X..', '.....', '..X..'],
  '?': ['.XXX.', 'X...X', '....X', '..XX.', '..X..', '.....', '..X..'],
  '%': ['XX..X', 'XX.X.', '..X..', '.X...', 'X.XX.', '..XX.', '.....'],
  '*': ['..X..', 'X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X', '..X..'],
  '(': ['..XX.', '.X...', '.X...', '.X...', '.X...', '.X...', '..XX.'],
  ')': ['.XX..', '...X.', '...X.', '...X.', '...X.', '...X.', '.XX..'],
  "'": ['..X..', '..X..', '.....', '.....', '.....', '.....', '.....'],
  '#': ['.X.X.', 'XXXXX', '.X.X.', '.X.X.', 'XXXXX', '.X.X.', '.....'],
  '<': ['...X.', '..X..', '.X...', 'X....', '.X...', '..X..', '...X.'],
  '>': ['.X...', '..X..', '...X.', '....X', '...X.', '..X..', '.X...'],
  '=': ['.....', '.....', 'XXXXX', '.....', 'XXXXX', '.....', '.....'],
  '"': ['.X.X.', '.X.X.', '.....', '.....', '.....', '.....', '.....'],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;
const CHARS = Object.keys(G);

const atlases = new Map<string, HTMLCanvasElement>();

function atlasFor(color: string): HTMLCanvasElement {
  const existing = atlases.get(color);
  if (existing) return existing;
  const c = document.createElement('canvas');
  c.width = CHARS.length * GLYPH_W;
  c.height = GLYPH_H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  CHARS.forEach((ch, i) => {
    const rows = G[ch];
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        if (rows[y][x] === 'X') ctx.fillRect(i * GLYPH_W + x, y, 1, 1);
      }
    }
  });
  atlases.set(color, c);
  return c;
}

const index = new Map<string, number>(CHARS.map((c, i) => [c, i]));

export function textWidth(text: string, scale = 1, tracking = 1): number {
  return text.length ? (text.length * (GLYPH_W + tracking) - tracking) * scale : 0;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { scale?: number; color?: string; align?: 'left' | 'center' | 'right'; tracking?: number; shadow?: string } = {},
) {
  const scale = opts.scale ?? 2;
  const tracking = opts.tracking ?? 1;
  const color = opts.color ?? '#ffffff';
  const upper = text.toUpperCase();
  const w = textWidth(upper, scale, tracking);
  let px = Math.round(opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x);
  const py = Math.round(y);

  if (opts.shadow) {
    drawRaw(ctx, upper, px, py + scale, scale, tracking, opts.shadow);
  }
  drawRaw(ctx, upper, px, py, scale, tracking, color);
}

function drawRaw(
  ctx: CanvasRenderingContext2D,
  text: string,
  px: number,
  py: number,
  scale: number,
  tracking: number,
  color: string,
) {
  const atlas = atlasFor(color);
  let cx = px;
  for (const ch of text) {
    const i = index.get(ch);
    if (i !== undefined && ch !== ' ') {
      ctx.drawImage(atlas, i * GLYPH_W, 0, GLYPH_W, GLYPH_H, cx, py, GLYPH_W * scale, GLYPH_H * scale);
    }
    cx += (GLYPH_W + tracking) * scale;
  }
}

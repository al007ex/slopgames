// Sprites: the drawn art in img/, finishes derived from it by recolouring, and
// the few pieces painted here in code in the same outlined style.

import { DRAWN, OUTLINE_PX } from '#shared/sprites.js';

// The outline colour of the drawn art.
const OUT = '#282828';
const cache = new Map();

function load(src) {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => { img.ready = true; };
    img.src = src;
    cache.set(src, img);
  }
  return img;
}

const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.ready = true; return c; };

/** Recolour a loaded image, keeping its shading and outline. Returns a canvas (or null until ready). */
function tinted(img, color, strength = 1, mode = 'color') {
  if (!img?.ready) return null;
  const c = canvas(img.naturalWidth, img.naturalHeight);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalAlpha = strength;
  g.globalCompositeOperation = mode;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  return c;
}

const TINTS = {
  _g: ['#f2c641', 0.85],
  _d: ['#6fd3f2', 0.85],
  _r: ['#e0374f', 0.9],
  castle: ['#7d8aa6', 0.55],
  poison: ['#8d4fc1', 0.7],
  power: ['#8a6fd1', 0.45],
  steel: ['#aeb6c6', 0.8],
};

const derived = new Map();
function derive(key, make) {
  let c = derived.get(key);
  if (!c) { c = make(); if (c) derived.set(key, c); }
  return c;
}

// ── weapons ──────────────────────────────────────────────────────────────
export function weaponSprite(w, variant = 0) {
  const suffix = ['', '_g', '_d', '_r'][variant] || '';
  if (w.drawn === 'musket' || w.drawn === 'grabby') {
    const base = derive(`drawn:${w.drawn}`, () => (w.drawn === 'musket' ? drawMusket() : drawGrabby()));
    return suffix ? derive(`drawn:${w.drawn}${suffix}`, () => tintCanvas(base, TINTS[suffix])) : base;
  }
  if (w.drawn === 'repeater') {
    const cross = weaponSprite({ ...w, drawn: null }, variant);
    return cross ? derive(`repeater${suffix}`, () => addMagazine(cross)) : null;
  }
  if (w.plain) {
    // Only the gold daggers are drawn; the plain pair is those, back in steel.
    const gold = load(`img/weapons/${w.sprite}.png`);
    const plain = derive(`plain:${w.sprite}`, () => tinted(gold, TINTS.steel[0], TINTS.steel[1]));
    if (!suffix) return plain;
    if (suffix === '_g') return gold.ready ? gold : null;
    return derive(`plain:${w.sprite}${suffix}`, () => tinted(gold, TINTS[suffix][0], TINTS[suffix][1]));
  }
  if (!suffix) return ready(load(`img/weapons/${w.sprite}.png`));
  if (w.variants.includes(suffix)) return ready(load(`img/weapons/${w.sprite}${suffix}.png`));
  // No drawn finish: ruby is made from diamond (or the plain one), others from plain.
  const from = suffix === '_r' && w.variants.includes('_d') ? load(`img/weapons/${w.sprite}_d.png`) : load(`img/weapons/${w.sprite}.png`);
  return derive(`${w.sprite}${suffix}`, () => tinted(from, TINTS[suffix][0], TINTS[suffix][1]));
}

const ready = (img) => (img.ready ? img : null);

function tintCanvas(c, [color, strength]) {
  const out = canvas(c.width, c.height);
  const g = out.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalAlpha = strength;
  g.globalCompositeOperation = 'color';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(c, 0, 0);
  return out;
}

// ── items, resources, animals, hats, icons ──────────────────────────────
export function itemSprite(item) {
  if (item.drawn) return derive(`drawn:${item.drawn}`, () => (item.drawn === 'turret' ? drawTurretBase() : drawBlocker()));
  const file = item.sprite === 'mill' ? 'mill_1' : item.sprite;
  const img = load(`img/items/${file}.${item.svg ? 'svg' : 'png'}`);
  if (item.tint) return derive(`item:${file}:${item.tint}`, () => tinted(img, ...TINTS[item.tint]));
  return ready(img);
}

export function millBlades(item) {
  const img = load('img/items/mill_2.png');
  if (item.tint) return derive(`blades:${item.tint}`, () => tinted(img, ...TINTS[item.tint]));
  return ready(img);
}

export const turretTop = () => derive('drawn:turretTop', drawTurretTop);

export function worldSprite(name) {
  if (name === 'cactus') return derive('drawn:cactus', drawCactus);
  return ready(load(`img/world/${name}.png`));
}

export const leafSprite = (name) => ready(load(`img/world/${name}_d.png`));

export function animalSprite(data) {
  if (data.drawn) return derive(`drawn:${data.drawn}`, DRAWN_ANIMALS[data.drawn]);
  return ready(load(`img/animals/${data.sprite}.png`));
}

export const hatSprite = (id) => ready(load(`img/hats/hat_${id}.png`));
const SHADOWS = new Set([1001, 1002, 1003, 1004, 1005, 1006]);
export const hatShadow = (id) => (SHADOWS.has(id) ? ready(load(`img/hats/hat_${id}_shadow.png`)) : null);
export const icon = (name) => ready(load(`img/icons/${name}.png`));
export const projectileSprite = (name) => (name === 'bullet' ? derive('drawn:bullet', drawBullet) : ready(load(`img/weapons/${name}.png`)));

/** Warm the cache so the first frame of play has its art. */
export function preload({ weapons, items, animals, hats }) {
  for (const w of weapons) for (let v = 0; v < 4; v++) weaponSprite(w, v);
  for (const it of items) { itemSprite(it); if (it.sprite === 'mill') millBlades(it); }
  for (const a of animals) animalSprite(a);
  for (const h of hats) { hatSprite(h.id); hatShadow(h.id); }
  for (const n of ['tree_1', 'wintertree_1', 'bush_1', 'stone_1', 'darkstone_1', 'gold_1', 'cactus']) worldSprite(n);
  for (const n of ['tree_1', 'wintertree_1', 'bush_1']) leafSprite(n);
  icon('crown'); icon('skull'); projectileSprite('arrow_1');
}

// ── painted pieces ───────────────────────────────────────────────────────
// Each is painted in a 256-wide design space onto a canvas of the size given
// in shared/sprites.js, with the art's own pen: every outline is exactly
// OUTLINE_PX canvas pixels, so drawn at PX it matches everything else.
// Animals face down the canvas (+y), like the drawn animals do.

let PEN = OUTLINE_PX;

function sheet(key) {
  const { w, h } = DRAWN[key];
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const u = w / 256;
  g.scale(u, u);
  PEN = OUTLINE_PX / u;
  return [c, g];
}

function pen(g, fill) {
  g.fillStyle = fill; g.strokeStyle = OUT; g.lineWidth = PEN; g.lineJoin = 'round'; g.lineCap = 'round';
}
function blob(g, fill, draw) { pen(g, fill); g.beginPath(); draw(); g.fill(); g.stroke(); }
const ellipse = (g, x, y, rx, ry, rot = 0) => () => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
const circle = (g, x, y, r) => () => g.arc(x, y, r, 0, Math.PI * 2);
/** The soft grey glow the drawn art has around its outline. */
function halo(g, draw) {
  g.save(); g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = PEN * 3.2; g.lineJoin = 'round'; g.beginPath(); draw(); g.stroke(); g.restore();
}
function shine(g, x, y, rx, ry, alpha = 0.18) {
  g.save(); g.fillStyle = `rgba(255,255,255,${alpha})`; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.restore();
}
function strokes(g, color, width, segs) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  for (const [x1, y1, x2, y2] of segs) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  g.restore();
}

function drawBoar() { return paintBoar('drawn/boar', { body: '#8a5a3b', dark: '#5e3b27', snout: '#c98b73', tusk: '#f4ecd8', big: false }); }
function drawTusker() { return paintBoar('drawn/tusker', { body: '#6e6258', dark: '#4a403a', snout: '#a98f80', tusk: '#fff7e0', big: true }); }

function paintBoar(key, { body, dark, snout, tusk, big }) {
  const [c, g] = sheet(key);
  blob(g, dark, () => { g.moveTo(122, 36); g.quadraticCurveTo(112, 20, 126, 12); g.quadraticCurveTo(132, 22, 134, 36); g.closePath(); });
  const back = ellipse(g, 128, 104, 62, 76);
  halo(g, back);
  blob(g, body, back);
  g.save(); g.fillStyle = dark; g.beginPath();
  for (let i = 0; i <= 8; i++) g.lineTo(128 + (i % 2 ? 10 : -10), 42 + i * 13);
  for (let i = 8; i >= 0; i--) g.lineTo(128 + (i % 2 ? 4 : -4), 48 + i * 13);
  g.fill(); g.restore();
  shine(g, 104, 84, 18, 30);
  if (big) strokes(g, '#3a322d', 6, [[92, 70, 110, 88], [148, 66, 164, 90], [100, 124, 118, 140]]);
  blob(g, body, ellipse(g, 128, 176, 50, 44));
  blob(g, dark, () => { g.moveTo(88, 150); g.lineTo(72, 128); g.lineTo(100, 138); g.closePath(); });
  blob(g, dark, () => { g.moveTo(168, 150); g.lineTo(184, 128); g.lineTo(156, 138); g.closePath(); });
  g.fillStyle = '#1f1f22';
  g.beginPath(); g.arc(106, 176, 6, 0, Math.PI * 2); g.arc(150, 176, 6, 0, Math.PI * 2); g.fill();
  blob(g, snout, ellipse(g, 128, 208, 26, 20));
  g.fillStyle = '#5a3a2e';
  g.beginPath(); g.ellipse(119, 208, 4, 6, 0, 0, Math.PI * 2); g.ellipse(137, 208, 4, 6, 0, 0, Math.PI * 2); g.fill();
  const t = big ? 1.5 : 1;
  blob(g, tusk, () => { g.moveTo(104, 206); g.quadraticCurveTo(84 - 6 * t, 214 + 6 * t, 90 - 4 * t, 230 + 10 * t); g.quadraticCurveTo(100, 224, 108, 214); });
  blob(g, tusk, () => { g.moveTo(152, 206); g.quadraticCurveTo(172 + 6 * t, 214 + 6 * t, 166 + 4 * t, 230 + 10 * t); g.quadraticCurveTo(156, 224, 148, 214); });
  return c;
}

function drawBear() {
  const [c, g] = sheet('drawn/bear');
  const fur = '#7a5234'; const dark = '#553722'; const muzzle = '#caa47a';
  const body = ellipse(g, 128, 108, 84, 82);
  halo(g, body);
  blob(g, fur, body);
  shine(g, 96, 80, 26, 34, 0.14);
  blob(g, '#8d939b', ellipse(g, 128, 152, 70, 22));
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.1 + i * 0.133); const x = 128 + Math.cos(a) * 70; const y = 152 + Math.sin(a) * 22;
    blob(g, '#c9ced4', () => { g.moveTo(x - 8, y); g.lineTo(x, y + 16); g.lineTo(x + 8, y); g.closePath(); });
  }
  for (const side of [-1, 1]) {
    blob(g, dark, ellipse(g, 128 + side * 72, 190, 24, 30));
    strokes(g, '#ece4d2', 5, [-1, 0, 1].map((k) => [128 + side * 72 + k * 9, 212, 128 + side * 72 + k * 11, 224]));
  }
  blob(g, fur, ellipse(g, 128, 188, 54, 48));
  blob(g, fur, circle(g, 84, 152, 16));
  blob(g, fur, circle(g, 172, 152, 16));
  blob(g, muzzle, ellipse(g, 128, 210, 28, 20));
  g.fillStyle = '#26211f';
  g.beginPath(); g.ellipse(128, 202, 11, 7, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(106, 182, 6, 0, Math.PI * 2); g.arc(150, 182, 6, 0, Math.PI * 2); g.fill();
  strokes(g, '#e6b8a2', 4, [[140, 166, 160, 196], [146, 174, 156, 172], [150, 184, 160, 182]]);
  return c;
}

function drawChest() {
  const [c, g] = sheet('drawn/chest');
  const box = () => g.roundRect(40, 58, 176, 140, 18);
  halo(g, box);
  blob(g, '#9a6a3f', box);
  strokes(g, '#6f4a2a', 5, [[52, 92, 204, 92], [52, 126, 204, 126], [52, 160, 204, 160]]);
  for (const x of [66, 172]) blob(g, '#e2b53e', () => g.roundRect(x, 58, 18, 140, 4));
  blob(g, '#e2b53e', () => g.roundRect(108, 104, 40, 46, 8));
  g.fillStyle = OUT; g.beginPath(); g.arc(128, 122, 6, 0, Math.PI * 2); g.fill(); g.fillRect(125, 124, 6, 14);
  shine(g, 90, 80, 30, 10, 0.2);
  return c;
}

function drawCactus() {
  const [c, g] = sheet('drawn/cactus');
  const shape = () => {
    for (let i = 0; i <= 8; i++) {
      const a = (i % 8) / 8 * Math.PI * 2; const r = i % 2 ? 74 : 98;
      const x = 128 + Math.cos(a) * r; const y = 128 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(128 + Math.cos(a - 0.4) * (r + 14), 128 + Math.sin(a - 0.4) * (r + 14), x, y);
    }
    g.closePath();
  };
  halo(g, shape);
  blob(g, '#6f9d4a', shape);
  blob(g, '#8cbc5c', circle(g, 128, 128, 46));
  g.fillStyle = '#f4efd6';
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const r = i % 2 ? 62 : 84; g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 3.5, 0, Math.PI * 2); g.fill(); }
  blob(g, '#e57a9a', circle(g, 128, 128, 12));
  return c;
}

function drawTurretBase() {
  const [c, g] = sheet('drawn/turret');
  const oct = () => { for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; g.lineTo(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104); } g.closePath(); };
  halo(g, oct);
  blob(g, '#a3a7ad', oct);
  blob(g, '#8a8e95', circle(g, 128, 128, 64));
  return c;
}

function drawTurretTop() {
  const [c, g] = sheet('drawn/turret');
  blob(g, '#5d6168', () => g.roundRect(128, 112, 108, 32, 10));
  blob(g, '#6f747b', circle(g, 128, 128, 50));
  shine(g, 112, 112, 16, 12, 0.25);
  return c;
}

function drawBlocker() {
  const [c, g] = sheet('drawn/blocker');
  const r = circle(g, 128, 128, 100);
  halo(g, r);
  blob(g, '#b88d5d', r);
  blob(g, '#d6ae78', circle(g, 128, 128, 70));
  strokes(g, '#c24d4d', 22, [[90, 90, 166, 166], [166, 90, 90, 166]]);
  return c;
}

// Held pointing forward: along +x of the canvas.
function drawMusket() {
  const [c, g] = sheet('drawn/musket');
  blob(g, '#8a5a36', () => { g.moveTo(10, 118); g.lineTo(98, 112); g.lineTo(104, 144); g.lineTo(14, 150); g.closePath(); });
  blob(g, '#5c6068', () => g.roundRect(90, 116, 160, 18, 7));
  blob(g, '#7b8089', () => g.roundRect(118, 132, 34, 12, 4));
  shine(g, 170, 121, 60, 3, 0.28);
  return c;
}

// Held like a polearm: a long pole running down the canvas with a claw at the end.
function drawGrabby() {
  const [c, g] = sheet('drawn/grabby');
  blob(g, '#8a6446', () => g.roundRect(118, 10, 20, 300, 9));
  blob(g, '#9aa1ab', () => g.roundRect(104, 300, 48, 24, 8));
  for (const side of [-1, 1]) {
    blob(g, '#b9c0c9', () => { g.moveTo(128 + side * 16, 320); g.quadraticCurveTo(128 + side * 50, 350, 128 + side * 22, 398); g.lineTo(128 + side * 10, 390); g.quadraticCurveTo(128 + side * 28, 352, 128 + side * 4, 326); g.closePath(); });
  }
  return c;
}

/** The repeater: the crossbow with a bolt magazine on top, same pen. */
function addMagazine(cross) {
  const w = cross.width || cross.naturalWidth; const h = cross.height || cross.naturalHeight;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.drawImage(cross, 0, 0);
  const u = w / 256;
  g.scale(u, u);
  PEN = OUTLINE_PX / u;
  blob(g, '#7a5a3c', () => g.roundRect(104, 70, 48, 58, 8));
  strokes(g, '#d9d3c4', 5, [[116, 80, 116, 118], [128, 80, 128, 118], [140, 80, 140, 118]]);
  return c;
}

function drawBullet() {
  const [c, g] = sheet('drawn/bullet');
  blob(g, '#9aa0a8', circle(g, 128, 128, 56));
  return c;
}

const DRAWN_ANIMALS = { boar: drawBoar, tusker: drawTusker, bear: drawBear, chest: drawChest };

/** Every painted piece, keyed like shared/sprites.js, for measuring. */
export const PAINTED = {
  'drawn/boar': drawBoar, 'drawn/tusker': drawTusker, 'drawn/bear': drawBear, 'drawn/chest': drawChest, 'drawn/cactus': drawCactus,
  'drawn/turret': drawTurretBase, 'drawn/blocker': drawBlocker, 'drawn/musket': drawMusket, 'drawn/grabby': drawGrabby, 'drawn/bullet': drawBullet,
};

// ── ground decorations ───────────────────────────────────────────────────
// Walk-over scenery. Same pen, no hitbox.

function drawDaisy() {
  const [c, g] = sheet('decor/daisy');
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    blob(g, '#fbf6ea', ellipse(g, 128 + Math.cos(a) * 64, 128 + Math.sin(a) * 64, 44, 20, a));
  }
  blob(g, '#f2a93b', circle(g, 128, 128, 36));
  shine(g, 118, 116, 12, 8, 0.35);
  return c;
}

function drawPoppy() {
  const [c, g] = sheet('decor/poppy');
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    blob(g, '#e0574a', circle(g, 128 + Math.cos(a) * 48, 128 + Math.sin(a) * 48, 60));
  }
  blob(g, '#3b2a2a', circle(g, 128, 128, 26));
  g.fillStyle = '#f0d58a';
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.arc(128 + Math.cos(a) * 14, 128 + Math.sin(a) * 14, 5, 0, Math.PI * 2); g.fill(); }
  return c;
}

function drawBluebells() {
  const [c, g] = sheet('decor/bluebells');
  blob(g, '#7fae55', ellipse(g, 80, 176, 46, 22, -0.5));
  blob(g, '#7fae55', ellipse(g, 180, 172, 44, 20, 0.5));
  for (const [x, y] of [[92, 96], [166, 104], [128, 164]]) {
    blob(g, '#7d9be0', circle(g, x, y, 42));
    blob(g, '#9db6ee', circle(g, x, y, 18));
  }
  return c;
}

function drawTuft(key, blade, tip) {
  const [c, g] = sheet(key);
  const blades = [[-1.05, 96], [0, 124], [1.05, 94]];
  for (const [a, len] of blades) {
    blob(g, blade, () => {
      const bx = 128 + Math.sin(a) * 34; const by = 200;
      const tx = 128 + Math.sin(a) * len; const ty = 200 - Math.cos(a) * len * 1.15;
      g.moveTo(bx - 22, by); g.quadraticCurveTo(bx - 18, (by + ty) / 2, tx, ty); g.quadraticCurveTo(bx + 18, (by + ty) / 2, bx + 22, by); g.closePath();
    });
  }
  if (tip) for (const [a, len] of blades) { g.fillStyle = tip; g.beginPath(); g.arc(128 + Math.sin(a) * len, 200 - Math.cos(a) * len * 1.15, 8, 0, Math.PI * 2); g.fill(); }
  return c;
}
const drawGrassTuft = () => drawTuft('decor/tuft', '#8fb84f');
const drawDryTuft = () => drawTuft('decor/drytuft', '#cfae63', '#e8cf8e');

function drawPebbles(key, tones) {
  const [c, g] = sheet(key);
  const stones = [[96, 110, 58, 46, 0.3], [168, 150, 44, 36, -0.4], [112, 180, 30, 24, 0.8]];
  stones.forEach(([x, y, rx, ry, rot], i) => {
    blob(g, tones[i % tones.length], ellipse(g, x, y, rx, ry, rot));
    shine(g, x - rx * 0.3, y - ry * 0.35, rx * 0.35, ry * 0.25, 0.3);
  });
  return c;
}
const drawPebblesGrey = () => drawPebbles('decor/pebbles', ['#b7b2a8', '#a39d92', '#c7c2b8']);
const drawPebblesSand = () => drawPebbles('decor/pebbles_sand', ['#d8c08e', '#c9ae7a', '#e4d0a4']);
const drawPebblesDark = () => drawPebbles('decor/pebbles_dark', ['#8d8a96', '#7c7985', '#9a97a3']);

function drawLilypads(bud) {
  const [c, g] = sheet(bud ? 'decor/lilybud' : 'decor/lilypads');
  const pad = (x, y, r, notch) => blob(g, '#6f9f4d', () => { g.moveTo(x, y); g.arc(x, y, r, notch + 0.35, notch - 0.35 + Math.PI * 2); g.closePath(); });
  pad(98, 110, 76, 0.6);
  pad(176, 170, 54, -2.4);
  g.save(); g.strokeStyle = 'rgba(40, 60, 24, 0.35)'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) { const a = 0.6 + 0.9 + i * 1.05; g.beginPath(); g.moveTo(98, 110); g.lineTo(98 + Math.cos(a) * 60, 110 + Math.sin(a) * 60); g.stroke(); }
  g.restore();
  if (bud) {
    blob(g, '#f4a7b9', ellipse(g, 176, 170, 26, 34, 0.3));
    blob(g, '#f9c9d4', ellipse(g, 170, 160, 12, 18, 0.3));
  }
  return c;
}

function drawHayBale() {
  const [c, g] = sheet('decor/hay');
  const bale = () => g.roundRect(34, 70, 188, 116, 26);
  halo(g, bale);
  blob(g, '#e3be5f', bale);
  strokes(g, 'rgba(150, 110, 40, 0.45)', 5, [[60, 96, 196, 96], [56, 128, 200, 128], [60, 160, 196, 160]]);
  strokes(g, '#9a6a3a', 9, [[92, 72, 92, 184], [164, 72, 164, 184]]);
  shine(g, 90, 88, 40, 8, 0.3);
  return c;
}

function drawIcePatch() {
  const [c, g] = sheet('decor/ice');
  const shape = () => { g.moveTo(52, 130); g.bezierCurveTo(46, 70, 150, 40, 200, 86); g.bezierCurveTo(236, 120, 214, 196, 150, 204); g.bezierCurveTo(90, 212, 56, 180, 52, 130); g.closePath(); };
  blob(g, '#cfe6ef', shape);
  shine(g, 110, 100, 40, 12, 0.6);
  shine(g, 168, 158, 22, 7, 0.5);
  return c;
}

function drawDesertBloom() {
  const [c, g] = sheet('decor/desertbloom');
  blob(g, '#88a95a', ellipse(g, 128, 150, 70, 40));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    blob(g, '#ec8fb0', ellipse(g, 128 + Math.cos(a) * 36, 118 + Math.sin(a) * 30, 30, 18, a));
  }
  blob(g, '#fbd46b', circle(g, 128, 118, 20));
  return c;
}

export const DECOR_PAINTERS = {
  'decor/daisy': drawDaisy, 'decor/poppy': drawPoppy, 'decor/bluebells': drawBluebells, 'decor/tuft': drawGrassTuft,
  'decor/drytuft': drawDryTuft, 'decor/pebbles': drawPebblesGrey, 'decor/pebbles_sand': drawPebblesSand, 'decor/pebbles_dark': drawPebblesDark,
  'decor/lilypads': () => drawLilypads(false), 'decor/lilybud': () => drawLilypads(true), 'decor/hay': drawHayBale, 'decor/ice': drawIcePatch,
  'decor/desertbloom': drawDesertBloom,
};

export const decorSprite = (key) => derive(key, DECOR_PAINTERS[key]);
Object.assign(PAINTED, DECOR_PAINTERS);

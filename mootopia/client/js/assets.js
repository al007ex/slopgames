// Sprites: the drawn art in img/, finishes derived from it by recolouring, and
// the few pieces painted here in code in the same outlined style.

const OUT = '#3d3f42';
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
// Each is painted on a 256 px canvas in the same thick-outline style as the
// drawn art. Animals face down the canvas (+y), like the drawn animals do.

function pen(g, fill, width = 12) {
  g.fillStyle = fill; g.strokeStyle = OUT; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
}
function blob(g, fill, draw, width = 12) { pen(g, fill, width); g.beginPath(); draw(); g.fill(); g.stroke(); }
const ellipse = (g, x, y, rx, ry, rot = 0) => () => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
const circle = (g, x, y, r) => () => g.arc(x, y, r, 0, Math.PI * 2);
function halo(g, draw) {
  g.save(); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 26; g.lineJoin = 'round'; g.beginPath(); draw(); g.stroke(); g.restore();
}
function shine(g, x, y, rx, ry, alpha = 0.18) {
  g.save(); g.fillStyle = `rgba(255,255,255,${alpha})`; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.restore();
}

function drawBoar() { return paintBoar({ body: '#8a5a3b', dark: '#5e3b27', snout: '#c98b73', tusk: '#f4ecd8', big: false }); }
function drawTusker() { return paintBoar({ body: '#6e6258', dark: '#4a403a', snout: '#a98f80', tusk: '#fff7e0', big: true }); }

function paintBoar({ body, dark, snout, tusk, big }) {
  const c = canvas(256); const g = c.getContext('2d');
  // tail
  blob(g, dark, () => { g.moveTo(128, 34); g.quadraticCurveTo(116, 16, 128, 8); }, 10);
  const back = ellipse(g, 128, 104, 62, 76);
  halo(g, back);
  blob(g, body, back);
  // bristly ridge down the spine
  g.save(); g.fillStyle = dark; g.beginPath();
  for (let i = 0; i <= 8; i++) { const y = 42 + i * 13; g.lineTo(128 + (i % 2 ? 10 : -10), y); }
  for (let i = 8; i >= 0; i--) { const y = 42 + i * 13; g.lineTo(128 + (i % 2 ? 4 : -4), y + 6); }
  g.fill(); g.restore();
  shine(g, 104, 84, 18, 30);
  if (big) {
    // a battered leather saddle of scars
    g.save(); g.strokeStyle = '#3a322d'; g.lineWidth = 6; g.lineCap = 'round';
    for (const [x1, y1, x2, y2] of [[92, 70, 110, 88], [148, 66, 164, 90], [100, 124, 118, 140]]) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    g.restore();
  }
  // head
  const head = ellipse(g, 128, 176, 50, 44);
  blob(g, body, head);
  // ears
  blob(g, dark, () => { g.moveTo(88, 150); g.lineTo(72, 128); g.lineTo(100, 138); g.closePath(); }, 9);
  blob(g, dark, () => { g.moveTo(168, 150); g.lineTo(184, 128); g.lineTo(156, 138); g.closePath(); }, 9);
  // eyes
  g.fillStyle = '#1f1f22';
  g.beginPath(); g.arc(106, 176, 6, 0, Math.PI * 2); g.arc(150, 176, 6, 0, Math.PI * 2); g.fill();
  // snout
  blob(g, snout, ellipse(g, 128, 208, 26, 20), 10);
  g.fillStyle = '#5a3a2e';
  g.beginPath(); g.ellipse(119, 208, 4, 6, 0, 0, Math.PI * 2); g.ellipse(137, 208, 4, 6, 0, 0, Math.PI * 2); g.fill();
  // tusks
  const t = big ? 1.5 : 1;
  blob(g, tusk, () => { g.moveTo(104, 206); g.quadraticCurveTo(84 - 6 * t, 214 + 6 * t, 90 - 4 * t, 230 + 10 * t); g.quadraticCurveTo(100, 224, 108, 214); }, 7);
  blob(g, tusk, () => { g.moveTo(152, 206); g.quadraticCurveTo(172 + 6 * t, 214 + 6 * t, 166 + 4 * t, 230 + 10 * t); g.quadraticCurveTo(156, 224, 148, 214); }, 7);
  return c;
}

function drawBear() {
  const c = canvas(256); const g = c.getContext('2d');
  const fur = '#7a5234'; const dark = '#553722'; const muzzle = '#caa47a';
  const body = ellipse(g, 128, 104, 86, 84);
  halo(g, body);
  blob(g, fur, body);
  shine(g, 96, 76, 26, 34, 0.14);
  // a spiked iron collar where the head meets the body
  pen(g, '#8d939b', 10);
  g.beginPath(); g.ellipse(128, 150, 70, 22, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.1 + i * 0.133); const x = 128 + Math.cos(a) * 70; const y = 150 + Math.sin(a) * 22;
    blob(g, '#c9ced4', () => { g.moveTo(x - 8, y); g.lineTo(x, y + 18); g.lineTo(x + 8, y); g.closePath(); }, 6);
  }
  // paws with claws
  for (const side of [-1, 1]) {
    blob(g, dark, ellipse(g, 128 + side * 74, 190, 24, 30));
    g.save(); g.strokeStyle = '#ece4d2'; g.lineWidth = 5; g.lineCap = 'round';
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(128 + side * 74 + k * 9, 212); g.lineTo(128 + side * 74 + k * 11, 226); g.stroke(); }
    g.restore();
  }
  // head
  blob(g, fur, ellipse(g, 128, 186, 54, 50));
  blob(g, fur, circle(g, 84, 150, 16), 10);
  blob(g, fur, circle(g, 172, 150, 16), 10);
  blob(g, muzzle, ellipse(g, 128, 208, 28, 22), 10);
  g.fillStyle = '#26211f';
  g.beginPath(); g.ellipse(128, 200, 11, 7, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(106, 180, 6, 0, Math.PI * 2); g.arc(150, 180, 6, 0, Math.PI * 2); g.fill();
  // an old scar over one eye
  g.save(); g.strokeStyle = '#e6b8a2'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(140, 164); g.lineTo(160, 194); g.stroke();
  g.beginPath(); g.moveTo(146, 172); g.lineTo(156, 170); g.moveTo(150, 182); g.lineTo(160, 180); g.stroke();
  g.restore();
  return c;
}

function drawChest() {
  const c = canvas(256); const g = c.getContext('2d');
  const box = () => g.roundRect(40, 58, 176, 140, 18);
  halo(g, box);
  blob(g, '#9a6a3f', box);
  g.save(); g.strokeStyle = '#6f4a2a'; g.lineWidth = 5;
  for (const y of [92, 126, 160]) { g.beginPath(); g.moveTo(52, y); g.lineTo(204, y); g.stroke(); }
  g.restore();
  pen(g, '#e2b53e', 9);
  for (const x of [66, 172]) { g.beginPath(); g.roundRect(x, 58, 18, 140, 4); g.fill(); g.stroke(); }
  g.beginPath(); g.roundRect(108, 104, 40, 46, 8); g.fill(); g.stroke();
  g.fillStyle = OUT; g.beginPath(); g.arc(128, 122, 6, 0, Math.PI * 2); g.fill(); g.fillRect(125, 124, 6, 14);
  shine(g, 90, 80, 30, 10, 0.2);
  return c;
}

function drawCactus() {
  const c = canvas(256); const g = c.getContext('2d');
  const shape = () => {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2; const r = i % 2 ? 72 : 96;
      const x = 128 + Math.cos(a) * r; const y = 128 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.quadraticCurveTo(128 + Math.cos(a - 0.4) * (r + 16), 128 + Math.sin(a - 0.4) * (r + 16), x, y);
    }
    g.quadraticCurveTo(128 + Math.cos(-0.4) * 112, 128 + Math.sin(-0.4) * 112, 224, 128);
  };
  halo(g, shape);
  blob(g, '#6f9d4a', shape);
  blob(g, '#8cbc5c', circle(g, 128, 128, 46), 10);
  g.fillStyle = '#f4efd6';
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const r = i % 2 ? 62 : 84; g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 3.5, 0, Math.PI * 2); g.fill(); }
  blob(g, '#e57a9a', circle(g, 128, 128, 12), 6);
  return c;
}

function drawTurretBase() {
  const c = canvas(256); const g = c.getContext('2d');
  const oct = () => { for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; g.lineTo(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104); } g.closePath(); };
  halo(g, oct);
  blob(g, '#a3a7ad', oct);
  blob(g, '#8a8e95', circle(g, 128, 128, 64), 10);
  return c;
}

function drawTurretTop() {
  const c = canvas(256); const g = c.getContext('2d');
  blob(g, '#5d6168', () => g.roundRect(128, 110, 110, 36, 10));
  blob(g, '#6f747b', circle(g, 128, 128, 50));
  shine(g, 112, 112, 16, 12, 0.25);
  return c;
}

function drawBlocker() {
  const c = canvas(256); const g = c.getContext('2d');
  const r = circle(g, 128, 128, 100);
  halo(g, r);
  blob(g, '#b88d5d', r);
  blob(g, '#d6ae78', circle(g, 128, 128, 70), 10);
  g.save(); g.strokeStyle = '#c24d4d'; g.lineWidth = 22; g.lineCap = 'round';
  g.beginPath(); g.moveTo(90, 90); g.lineTo(166, 166); g.moveTo(166, 90); g.lineTo(90, 166); g.stroke();
  g.restore();
  return c;
}

// Held pointing forward: along +x of the canvas.
function drawMusket() {
  const c = canvas(256); const g = c.getContext('2d');
  blob(g, '#8a5a36', () => { g.moveTo(10, 118); g.lineTo(98, 112); g.lineTo(104, 144); g.lineTo(14, 150); g.closePath(); }, 10);
  blob(g, '#5c6068', () => g.roundRect(90, 116, 160, 18, 7), 10);
  blob(g, '#7b8089', () => g.roundRect(118, 132, 34, 12, 4), 8);
  shine(g, 170, 121, 60, 3, 0.28);
  return c;
}

// Held like a polearm: a long pole running down the canvas with a claw at the end.
function drawGrabby() {
  const c = canvas(256, 410); const g = c.getContext('2d');
  blob(g, '#8a6446', () => g.roundRect(118, 10, 20, 300, 9), 10);
  pen(g, '#9aa1ab', 10);
  g.beginPath(); g.roundRect(104, 300, 48, 24, 8); g.fill(); g.stroke();
  for (const side of [-1, 1]) {
    blob(g, '#b9c0c9', () => { g.moveTo(128 + side * 16, 320); g.quadraticCurveTo(128 + side * 50, 350, 128 + side * 22, 398); g.lineTo(128 + side * 10, 390); g.quadraticCurveTo(128 + side * 28, 352, 128 + side * 4, 326); g.closePath(); }, 8);
  }
  return c;
}

function addMagazine(cross) {
  const c = canvas(cross.width || cross.naturalWidth, cross.height || cross.naturalHeight);
  const g = c.getContext('2d');
  g.drawImage(cross, 0, 0);
  const s = c.width / 256;
  g.scale(s, s);
  blob(g, '#7a5a3c', () => g.roundRect(104, 70, 48, 58, 8), 9);
  g.save(); g.strokeStyle = '#d9d3c4'; g.lineWidth = 5;
  for (const x of [116, 128, 140]) { g.beginPath(); g.moveTo(x, 80); g.lineTo(x, 118); g.stroke(); }
  g.restore();
  return c;
}

function drawBullet() {
  const c = canvas(64); const g = c.getContext('2d');
  blob(g, '#4a4d52', circle(g, 32, 32, 14), 6);
  return c;
}

const DRAWN_ANIMALS = { boar: drawBoar, tusker: drawTusker, bear: drawBear, chest: drawChest };

// Textures painted at start-up on a canvas: no image files to load.

import * as THREE from 'three';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

let seed = 12345;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Asphalt: fine grain, a little aggregate, faint tar patches. */
export function asphalt(tone = 34, size = 512) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = tone + (rand() - 0.5) * 16 + (rand() < 0.03 ? 18 * rand() : 0);
    img.data[i * 4] = n; img.data[i * 4 + 1] = n; img.data[i * 4 + 2] = n + 3; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 18; i++) {
    g.fillStyle = rand() < 0.5 ? '#000' : '#fff';
    g.beginPath(); g.ellipse(rand() * size, rand() * size, 20 + rand() * 60, 10 + rand() * 40, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A soft round glow, for lamp pools, headlight flares and the like. */
export function glow(size = 128, falloff = 2.2) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - d) ** falloff;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Four soft, lumpy puffs of smoke in a 2 × 2 atlas. */
export function smoke(size = 256) {
  const [c, g] = canvas(size);
  const half = size / 2;
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * half, oy = Math.floor(k / 2) * half;
    for (let i = 0; i < 26; i++) {
      const r = half * (0.12 + rand() * 0.2);
      const a = rand() * Math.PI * 2, d = rand() * half * 0.22;
      const x = ox + half / 2 + Math.cos(a) * d, y = oy + half / 2 + Math.sin(a) * d;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(ox, oy, half, half);
    }
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** A skid mark's cross-section: dark in the middle, soft at the edges, streaky. */
export function tread(w = 64, h = 256) {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const streak = Array.from({ length: w }, () => 0.7 + rand() * 0.3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1) * 2 - 1;
    const a = Math.max(0, 1 - Math.abs(u) ** 3) * streak[x] * (0.85 + rand() * 0.15);
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Kerb stripes: red and white. */
export function kerb() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#e8e6df'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d4283b'; g.fillRect(0, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Procedural textures for the three building materials, painted on canvases
// at start-up so the game ships no image files.

import * as THREE from 'three';

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export const TEXTURES = {
  wood: () => canvas(256, (g, s) => {
    g.fillStyle = '#a8743f'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
      const shade = 0.85 + rand() * 0.3;
      g.fillStyle = `rgb(${168 * shade | 0},${116 * shade | 0},${63 * shade | 0})`;
      g.fillRect(0, y, s, 31);
      g.strokeStyle = 'rgba(70,40,15,0.25)';
      for (let k = 0; k < 6; k++) { g.beginPath(); const yy = y + 3 + rand() * 26; g.moveTo(0, yy); g.bezierCurveTo(s * 0.3, yy + rand() * 6 - 3, s * 0.6, yy + rand() * 6 - 3, s, yy); g.stroke(); }
      g.fillStyle = '#5a3818'; g.fillRect(0, y + 30, s, 2);
      const seam = rand() * s; g.fillRect(seam, y, 2, 30);
      g.fillStyle = '#3a2410'; g.fillRect(seam - 8, y + 12, 3, 3); g.fillRect(seam + 7, y + 12, 3, 3);
    }
  }),
  stone: () => canvas(256, (g, s) => {
    g.fillStyle = '#8c8680'; g.fillRect(0, 0, s, s);
    const bh = 32, bw = 64;
    for (let row = 0; row < s / bh; row++) {
      for (let col = -1; col < s / bw + 1; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
        const v = 0.8 + rand() * 0.35;
        g.fillStyle = `rgb(${170 * v | 0},${104 * v | 0},${82 * v | 0})`;
        g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 3, y + 3, bw - 6, 4);
      }
    }
  }),
  metal: () => canvas(256, (g, s) => {
    for (let x = 0; x < s; x++) {
      const t = 0.5 + 0.5 * Math.sin((x / s) * Math.PI * 16);
      const v = 0.72 + t * 0.28;
      g.fillStyle = `rgb(${128 * v | 0},${146 * v | 0},${158 * v | 0})`;
      g.fillRect(x, 0, 1, s);
    }
    g.fillStyle = 'rgba(40,50,60,0.6)';
    for (const y of [10, s - 14]) for (let x = 8; x < s; x += 32) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(120,70,40,0.18)';
    for (let k = 0; k < 14; k++) g.fillRect(rand() * s, rand() * s, 6 + rand() * 20, 2 + rand() * 30);
  }),
};

export const MATERIAL_COLORS = [0xb07a44, 0x9a6a5a, 0x8ea2b0];

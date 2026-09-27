// The minimap (top right) and the full map (M). Both are drawn from the same
// terrain colours the ground uses, with the named places, the storm eye (the
// storm shaded purple outside it), the next circle as a white ring, the blimp's
// route, teammates, pings and you.

import { CELL, GRID_N, WORLD_SIZE } from '#shared/constants.js';
import { SIDE } from '#shared/terrain.js';

const $ = (id) => document.getElementById(id);

export class MapView {
  constructor(app, colors, terrain, pois, roads = []) {
    this.app = app;
    this.pois = pois;
    this.roads = roads;
    this.open = false;
    // One pixel per terrain corner, water drawn as sea, with a little hill shading.
    const img = document.createElement('canvas');
    img.width = img.height = SIDE;
    const g = img.getContext('2d');
    const data = g.createImageData(SIDE, SIDE);
    const h = terrain.h;
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const k = j * SIDE + i, o = k * 4;
        const shade = i > 0 && j > 0 ? Math.max(-0.25, Math.min(0.25, (h[k] - h[k - 1 - SIDE]) * 0.06)) : 0;
        if (h[k] < 0) { data.data[o] = 38; data.data[o + 1] = 92; data.data[o + 2] = 150; }
        else {
          data.data[o] = colors[k * 3] * (1 + shade);
          data.data[o + 1] = colors[k * 3 + 1] * (1 + shade);
          data.data[o + 2] = colors[k * 3 + 2] * (1 + shade);
        }
        data.data[o + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    this.image = img;
    this.mini = $('minimap');
    this.full = $('fullmap');
    this.bus = null;
    this.pings = [];
  }

  toggle(force) {
    this.open = force ?? !this.open;
    $('mapview').hidden = !this.open;
  }

  frame(focus, yaw, storm, teammates = []) {
    this.drawMini(focus, yaw, storm, teammates);
    if (this.open) this.drawFull(focus, yaw, storm, teammates);
  }

  drawMini(focus, yaw, storm, teammates) {
    const c = this.mini;
    const size = c.width;
    const g = c.getContext('2d');
    const span = 460;                                   // metres across
    const scale = size / span;
    const toX = (x) => (x - focus.x) * scale + size / 2, toY = (z) => (z - focus.z) * scale + size / 2;
    g.fillStyle = '#26608f';
    g.fillRect(0, 0, size, size);
    const px = SIDE / WORLD_SIZE;
    g.drawImage(this.image, (focus.x - span / 2) * px, (focus.z - span / 2) * px, span * px, span * px, 0, 0, size, size);
    this.drawRoads(g, toX, toY, 3);
    this.drawStorm(g, storm, toX, toY, scale, size);
    this.drawMarks(g, toX, toY, teammates, 1);
    this.drawMe(g, size / 2, size / 2, yaw, 1);
  }

  drawFull(focus, yaw, storm, teammates) {
    const c = this.full;
    const size = c.width;
    const g = c.getContext('2d');
    const scale = size / WORLD_SIZE;
    const toX = (x) => x * scale, toY = (z) => z * scale;
    g.drawImage(this.image, 0, 0, size, size);
    // Grid, like the paper map: A–J across, 1–10 down.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = `${Math.round(size / 60)}px system-ui`;
    for (let i = 1; i < 10; i++) {
      g.beginPath(); g.moveTo(i * size / 10, 0); g.lineTo(i * size / 10, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * size / 10); g.lineTo(size, i * size / 10); g.stroke();
    }
    for (let i = 0; i < 10; i++) { g.fillText('ABCDEFGHIJ'[i], i * size / 10 + 4, 14); g.fillText(String(i + 1), 4, i * size / 10 + 28); }
    this.drawRoads(g, toX, toY, 2);
    if (this.bus) {
      g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      g.setLineDash([8, 6]);
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(toX(this.bus.x0), toY(this.bus.z0)); g.lineTo(toX(this.bus.x1), toY(this.bus.z1)); g.stroke();
      g.setLineDash([]);
    }
    this.drawStorm(g, storm, toX, toY, scale, size);
    g.textAlign = 'center';
    for (const p of this.pois) {
      const x = toX(p.x), y = toY(p.z);
      g.font = `700 ${Math.round(size / 58)}px system-ui`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(p.name.toUpperCase(), x, y);
      g.fillStyle = '#fff';
      g.fillText(p.name.toUpperCase(), x, y);
    }
    g.textAlign = 'start';
    this.drawMarks(g, toX, toY, teammates, size / 700);
    this.drawMe(g, toX(focus.x), toY(focus.z), yaw, size / 700);
  }

  drawRoads(g, toX, toY, width) {
    g.strokeStyle = 'rgba(160, 128, 84, 0.85)';
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    for (const r of this.roads) { g.moveTo(toX(r.x0), toY(r.z0)); g.lineTo(toX(r.x1), toY(r.z1)); }
    g.stroke();
  }

  drawStorm(g, storm, toX, toY, scale, size) {
    if (!storm) return;
    // Everything outside the eye is storm: fill the canvas, cut the eye out.
    g.save();
    g.beginPath();
    g.rect(0, 0, size, size);
    if (storm.r > 0) g.arc(toX(storm.x), toY(storm.z), storm.r * scale, 0, Math.PI * 2, true);
    g.fillStyle = 'rgba(120, 60, 220, 0.38)';
    g.fill('evenodd');
    g.restore();
    if (storm.r > 0) {
      g.strokeStyle = 'rgba(190, 140, 255, 0.95)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(toX(storm.x), toY(storm.z), storm.r * scale, 0, Math.PI * 2); g.stroke();
    }
    const n = storm.next;
    if (n && n.r > 0) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath(); g.arc(toX(n.x), toY(n.z), n.r * scale, 0, Math.PI * 2); g.stroke();
    }
  }

  drawMarks(g, toX, toY, teammates, k) {
    for (const t of teammates) {
      g.fillStyle = t.color || '#4fd2ff';
      g.beginPath(); g.arc(toX(t.x), toY(t.z), 4.5 * k, 0, Math.PI * 2); g.fill();
    }
    for (const p of this.pings) {
      g.strokeStyle = '#ffd24a';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(toX(p.x), toY(p.z) - 10 * k); g.lineTo(toX(p.x), toY(p.z)); g.stroke();
      g.fillStyle = '#ffd24a';
      g.beginPath(); g.arc(toX(p.x), toY(p.z) - 12 * k, 4 * k, 0, Math.PI * 2); g.fill();
    }
  }

  drawMe(g, x, y, yaw, k) {
    g.save();
    g.translate(x, y);
    g.rotate(-yaw);
    g.fillStyle = '#ffd24a';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9 * k); g.lineTo(6 * k, 7 * k); g.lineTo(0, 3 * k); g.lineTo(-6 * k, 7 * k); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
}

export { CELL, GRID_N };

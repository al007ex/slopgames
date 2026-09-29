// Draw the whole map top-down to a PNG, colliders and all: node tools/map.mjs out.png
import { buildWorld } from '../shared/world.js';
import { Raster } from './png.js';
const w = buildWorld();
const S = Number(process.argv[3] || 1.2); // pixels per metre
const B = w.bounds;
const W = Math.ceil((B.x1 - B.x0) * S), H = Math.ceil((B.y1 - B.y0) * S);
const r = new Raster(W, H, [20, 22, 28]);
const X = (x) => (x - B.x0) * S, Y = (y) => (B.y1 - y) * S;
for (const s of w.sidewalks) r.rect(X(s.x0), Y(s.y0), X(s.x1), Y(s.y1), [55, 58, 66]);
const t = w.track;
for (const n of t.nodes) r.disc(X(n.x), Y(n.y), Math.round(t.half * S), [44, 46, 52]);
for (const b of w.buildings) r.rect(X(b.x - b.w / 2), Y(b.y - b.d / 2), X(b.x + b.w / 2), Y(b.y + b.d / 2), b.style === 2 ? [70, 60, 50] : [90 + b.h, 90 + b.h, 110 + b.h]);
for (const s of w.shapes.all) {
  if (s.kind === 'circle') { r.disc(X(s.x), Y(s.y), Math.max(1, Math.round(s.r * S)), s.tag === 'lamp' ? [255, 190, 90] : [80, 160, 90]); continue; }
  if (s.tag === 'building') continue;
  const col = s.tag === 'car' ? [200, 70, 70] : s.tag === 'barrier' ? [230, 230, 230] : [160, 160, 200];
  const cs = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [s.x + s.c * s.hw * a - s.s * s.hh * b, s.y + s.s * s.hw * a + s.c * s.hh * b]);
  for (let i = 0; i < 4; i++) r.line(X(cs[i][0]), Y(cs[i][1]), X(cs[(i + 1) % 4][0]), Y(cs[(i + 1) % 4][1]), col, s.tag === 'barrier' ? 2 : 1);
}
for (const c of t.clips) {
  if (c.kind === 'inner') r.disc(X(c.cx), Y(c.cy), 4, [255, 60, 200]);
  else for (let i = c.from; i !== c.to; i = (i + 1) % t.nodes.length) { const n = t.nodes[i]; const o = c.side * (t.half - 1); r.dot(X(n.x + n.nx * o), Y(n.y + n.ny * o), [60, 220, 255]); }
}
for (const [k, sp] of Object.entries(w.spawns)) { r.disc(X(sp.x), Y(sp.y), 5, [80, 255, 80]); r.line(X(sp.x), Y(sp.y), X(sp.x + Math.cos(sp.heading) * 14), Y(sp.y + Math.sin(sp.heading) * 14), [80, 255, 80], 2); }
r.disc(X(w.pit.x), Y(w.pit.y), Math.round(w.pit.ring * S), [120, 40, 40]);
const f = t.finish; r.line(X(f.x - f.nx * 8), Y(f.y - f.ny * 8), X(f.x + f.nx * 8), Y(f.y + f.ny * 8), [255, 255, 0], 2);
r.save(process.argv[2] || 'map.png');
console.log(W, H);

// A round minimap, heading-up. The map is painted once to an offscreen
// canvas; each frame only rotates and crops it.

const SCALE = 0.6; // pixels per metre in the painted map

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.world = world;
    const B = world.bounds;
    this.B = B;
    const map = document.createElement('canvas');
    map.width = Math.ceil((B.x1 - B.x0) * SCALE);
    map.height = Math.ceil((B.y1 - B.y0) * SCALE);
    const g = map.getContext('2d');
    const X = (x) => (x - B.x0) * SCALE, Y = (y) => (B.y1 - y) * SCALE;
    g.fillStyle = '#20222b';
    g.fillRect(0, 0, map.width, map.height);
    // Harbour ground and the circuit.
    const H = world.harbor;
    g.fillStyle = '#14151b';
    g.fillRect(X(H.x0), Y(H.y1), (H.x1 - H.x0) * SCALE, (H.y1 - H.y0) * SCALE);
    const t = world.track;
    g.strokeStyle = '#555a68';
    g.lineWidth = t.width * SCALE;
    g.lineJoin = 'round';
    g.beginPath();
    t.nodes.forEach((n, i) => (i ? g.lineTo(X(n.x), Y(n.y)) : g.moveTo(X(n.x), Y(n.y))));
    g.closePath();
    g.stroke();
    const P = world.paddock;
    g.fillStyle = '#3a3d48';
    g.fillRect(X(P.x0), Y(P.y1), (P.x1 - P.x0) * SCALE, (P.y1 - P.y0) * SCALE);
    const Bv = world.boulevard;
    g.fillRect(X(Bv.x0), Y(Bv.y1 + 10), (Bv.x1 - Bv.x0) * SCALE, (Bv.y1 - Bv.y0 + 10) * SCALE);
    // City: the streets are what's left between the blocks.
    const C = world.city;
    g.fillStyle = '#3a3d48';
    g.fillRect(X(C.west), Y(C.north), (C.east - C.west) * SCALE, (C.north - C.south) * SCALE);
    g.fillStyle = '#16171d';
    for (const b of world.buildings) g.fillRect(X(b.x - b.w / 2), Y(b.y + b.d / 2), b.w * SCALE, b.d * SCALE);
    // The Pit and the roundabout.
    g.fillStyle = 'rgba(255, 61, 90, 0.5)';
    g.beginPath(); g.arc(X(world.pit.x), Y(world.pit.y), world.pit.ring * SCALE, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16171d';
    g.beginPath(); g.arc(X(world.roundabout.x), Y(world.roundabout.y), world.roundabout.island * SCALE, 0, Math.PI * 2); g.fill();
    this.map = map;
    this.X = X; this.Y = Y;
  }

  draw(x, y, heading, view = 170) {
    const c = this.canvas, g = this.g;
    const w = c.width, h = c.height, r = w / 2;
    const k = r / view; // canvas pixels per metre
    g.save();
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.clip();
    g.translate(r, r);
    g.rotate(heading - Math.PI / 2);
    g.scale(k / SCALE, k / SCALE);
    g.translate(-this.X(x), -this.Y(y));
    g.globalAlpha = 0.95;
    g.drawImage(this.map, 0, 0);
    g.restore();
    // The car, always pointing up.
    g.fillStyle = '#ff3d5a';
    g.beginPath(); g.moveTo(r, r - 8); g.lineTo(r + 6, r + 7); g.lineTo(r, r + 3); g.lineTo(r - 6, r + 7); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.stroke();
  }
}

// Measures a sprite from its pixels: how thick its outer outline is, and how
// big its solid silhouette is. Works on { width, height, data: RGBA } from a
// canvas or from tools/png.js, so the browser and Node agree exactly.
//
// Solid = alpha ≥ 200 (the soft grey halo around the art is not solid); a
// sprite drawn see-through all over (the pit trap) is read at alpha ≥ 150.
// Ink   = solid and dark (the outline colour is a near-black grey).

const SOLID = 200;           // opaque enough to be part of the object…
const SOLID_FALLBACK = 150;  // …unless the whole sprite is see-through (the pit trap)
const INK = 90;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function measureSprite(img) {
  let m = measureAt(img, SOLID);
  if (!m) { m = measureAt(img, SOLID_FALLBACK); if (m) m.alpha = SOLID_FALLBACK; }
  return m;
}

function measureAt({ width, height, data }, cut) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= cut;
  const ink = (x, y) => {
    if (!solid(x, y)) return false;
    const i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < INK;
  };

  let count = 0; let sx = 0; let sy = 0;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!solid(x, y)) continue;
    count++; sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!count) return null;
  const cx = sx / count; const cy = sy / count;

  // Outline thickness: at every inked pixel on the outer edge, walk inwards
  // along each direction that starts from outside, and keep the shortest crossing.
  const samples = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!ink(x, y)) continue;
    let best = Infinity;
    for (const [dx, dy] of DIRS) {
      if (solid(x - dx, y - dy)) continue;
      let n = 0;
      while (ink(x + dx * n, y + dy * n)) n++;
      const len = n * (dx && dy ? Math.SQRT2 : 1);
      if (len < best) best = len;
    }
    if (best < Infinity) samples.push(best);
  }
  samples.sort((a, b) => a - b);
  const outline = samples.length ? samples[Math.floor(samples.length / 2)] : 0;

  // The first ring of ink met walking out from the middle (a tree's core).
  const rings = [];
  for (let k = 0; k < 72; k++) {
    const a = k / 72 * Math.PI * 2; const ux = Math.cos(a); const uy = Math.sin(a);
    let r = 0; let seenFill = false;
    for (; r < Math.max(width, height); r++) {
      const x = Math.round(cx + ux * r); const y = Math.round(cy + uy * r);
      if (!solid(x, y)) break;
      if (ink(x, y)) { if (seenFill) { rings.push(r); break; } } else seenFill = true;
    }
  }
  rings.sort((a, b) => a - b);

  return {
    width, height,
    outline: +outline.toFixed(2),
    radius: +Math.sqrt(count / Math.PI).toFixed(2),     // radius of a circle with the silhouette's area
    cx: +cx.toFixed(1), cy: +cy.toFixed(1),
    box: [minX, minY, maxX, maxY],
    inner: rings.length ? rings[Math.floor(rings.length / 2)] : 0,
  };
}

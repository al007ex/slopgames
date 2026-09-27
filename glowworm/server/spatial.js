// A uniform grid for "what is near this point?". The world asks that constantly
// — every head against every body, every head against the food — and a grid
// turns each question from a scan of the whole arena into a handful of cells.

const OFFSET = 512;   // keeps cell coordinates positive; the arena spans ±25 cells

export class Grid {
  constructor(size) {
    this.size = size;
    this.cells = new Map();
  }

  keyOf(x, y) {
    return ((Math.floor(x / this.size) + OFFSET) << 10) | (Math.floor(y / this.size) + OFFSET);
  }

  insert(x, y, item) {
    const key = this.keyOf(x, y);
    let cell = this.cells.get(key);
    if (!cell) { cell = []; this.cells.set(key, cell); }
    cell.push(item);
    return key;
  }

  remove(key, item) {
    const cell = this.cells.get(key);
    if (!cell) return false;
    const at = cell.indexOf(item);
    if (at < 0) return false;
    cell[at] = cell[cell.length - 1];
    cell.pop();
    return true;
  }

  /** Empty every cell but keep the arrays, so a per-tick rebuild allocates nothing. */
  reset() {
    for (const cell of this.cells.values()) cell.length = 0;
  }

  /** Visit everything in the cells overlapping a circle. Callers do the exact test. */
  query(x, y, radius, visit) {
    const size = this.size;
    const x0 = Math.floor((x - radius) / size) + OFFSET;
    const x1 = Math.floor((x + radius) / size) + OFFSET;
    const y0 = Math.floor((y - radius) / size) + OFFSET;
    const y1 = Math.floor((y + radius) / size) + OFFSET;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get((cx << 10) | cy);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) visit(cell[i]);
      }
    }
  }
}

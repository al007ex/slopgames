// The board, and the pathfinding that makes this a maze game rather than a
// shooting gallery. Packets always walk the shortest open route, so where you
// put a tower changes where they go — and the one rule that keeps it fair is
// that you may never wall the route off completely.

import { COLS, ROWS, ENTRY, CORE, TRACES } from '#shared/constants.js';

export const EMPTY = 0;
export const TRACE = 1;   // fixed obstacle, cannot be built on
export const TOWER = 2;   // player-placed

export const idx = (col, row) => row * COLS + col;
export const colOf = (i) => i % COLS;
export const rowOf = (i) => Math.floor(i / COLS);
export const inBounds = (col, row) => col >= 0 && col < COLS && row >= 0 && row < ROWS;

export function createBoard() {
  const cells = new Uint8Array(COLS * ROWS);
  for (const { col, row } of TRACES) cells[idx(col, row)] = TRACE;
  return cells;
}

export const isOpen = (cells, col, row) => inBounds(col, row) && cells[idx(col, row)] === EMPTY;

/** Cells a packet may stand on: anything that is not a trace or a tower. */
const passable = (cells, i) => cells[i] === EMPTY;

// Neighbour order is fixed so equal-length routes always resolve the same way.
// Without that, an unrelated placement elsewhere on the board could flip a tie
// and visibly yank every packet onto a different lane.
const STEPS = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/**
 * Breadth-first search from `start` to the core.
 * Returns an array of cell indices beginning with `start`, or null if the core
 * cannot be reached. The core itself is always walkable.
 */
export function findPath(cells, startCol = ENTRY.col, startRow = ENTRY.row) {
  const start = idx(startCol, startRow);
  const goal = idx(CORE.col, CORE.row);
  if (!inBounds(startCol, startRow)) return null;
  if (start === goal) return [start];

  const cameFrom = new Int32Array(COLS * ROWS).fill(-1);
  const seen = new Uint8Array(COLS * ROWS);
  const queue = [start];
  seen[start] = 1;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const col = colOf(current);
    const row = rowOf(current);

    for (const [dc, dr] of STEPS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const next = idx(nc, nr);
      if (seen[next]) continue;
      // The core is the destination, so it stays reachable even though a packet
      // never has to step past it.
      if (next !== goal && !passable(cells, next)) continue;
      seen[next] = 1;
      cameFrom[next] = current;
      if (next === goal) {
        const path = [next];
        for (let at = current; at !== -1; at = cameFrom[at]) path.push(at);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Whether a tower may go on this cell. Placement is refused when it would trap
 * the entry or strand a packet already on the board, which is the rule that
 * stops a full wall from being the whole game.
 *
 * `occupied` is the set of cell indices packets are standing on right now.
 */
export function canPlace(cells, col, row, occupied = new Set()) {
  if (!isOpen(cells, col, row)) return { ok: false, reason: 'That cell is taken.' };
  if (col === ENTRY.col && row === ENTRY.row) return { ok: false, reason: 'Packets enter there.' };
  if (col === CORE.col && row === CORE.row) return { ok: false, reason: 'That is the core.' };
  if (occupied.has(idx(col, row))) return { ok: false, reason: 'A packet is on that cell.' };

  cells[idx(col, row)] = TOWER;
  const entryOk = findPath(cells) !== null;
  let packetsOk = entryOk;
  if (entryOk) {
    for (const cell of occupied) {
      if (findPath(cells, colOf(cell), rowOf(cell)) === null) { packetsOk = false; break; }
    }
  }
  cells[idx(col, row)] = EMPTY;

  if (!entryOk) return { ok: false, reason: 'That would seal the board off.' };
  if (!packetsOk) return { ok: false, reason: 'That would strand a packet.' };
  return { ok: true };
}

/** Centre of a cell, in cell units — where packets and towers actually sit. */
export const centreOf = (cell) => ({ x: colOf(cell) + 0.5, y: rowOf(cell) + 0.5 });

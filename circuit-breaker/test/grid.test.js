// Board and pathfinding tests. The maze rules are the part of this game that
// players will try hardest to break, so they get the most attention here.

import { ok, eq, section, report } from './harness.js';
import { COLS, ROWS, ENTRY, CORE, TRACES } from '#shared/constants.js';
import { createBoard, findPath, canPlace, isOpen, idx, colOf, rowOf, TOWER, EMPTY } from '#shared/grid.js';

section('A fresh board is solvable');
{
  const cells = createBoard();
  const path = findPath(cells);
  ok(path !== null, 'entry reaches the core');
  eq(path[0], idx(ENTRY.col, ENTRY.row), 'the path starts at the entry');
  eq(path[path.length - 1], idx(CORE.col, CORE.row), 'the path ends at the core');
  ok(path.length >= COLS, 'the path is at least as long as the board is wide');

  let contiguous = true;
  for (let i = 1; i < path.length; i++) {
    const step = Math.abs(colOf(path[i]) - colOf(path[i - 1])) + Math.abs(rowOf(path[i]) - rowOf(path[i - 1]));
    if (step !== 1) contiguous = false;
  }
  ok(contiguous, 'every step moves exactly one cell');

  const onTrace = path.some((cell) => TRACES.some((t) => idx(t.col, t.row) === cell));
  ok(!onTrace, 'the path never crosses a fixed trace');
}

section('Placement rules');
{
  const cells = createBoard();
  ok(!canPlace(cells, ENTRY.col, ENTRY.row).ok, 'cannot build on the entry');
  ok(!canPlace(cells, CORE.col, CORE.row).ok, 'cannot build on the core');
  ok(!canPlace(cells, TRACES[0].col, TRACES[0].row).ok, 'cannot build on a trace');
  ok(!canPlace(cells, -1, 4).ok, 'cannot build off the board');
  ok(canPlace(cells, 3, 3).ok, 'can build on an empty cell');

  cells[idx(3, 3)] = TOWER;
  ok(!canPlace(cells, 3, 3).ok, 'cannot build on an existing tower');
}

section('A maze may never be sealed');
{
  const cells = createBoard();
  // Wall off column 2 completely except for one gap, then close the gap.
  for (let row = 0; row < ROWS; row++) {
    if (row === 7) continue;
    cells[idx(2, row)] = TOWER;
  }
  ok(findPath(cells) !== null, 'a single gap still lets packets through');
  const sealing = canPlace(cells, 2, 7);
  ok(!sealing.ok, 'closing the last gap is refused');
  ok(/seal/i.test(sealing.reason), 'and it says why', sealing.reason);
  eq(cells[idx(2, 7)], EMPTY, 'the rejected placement left the board untouched');
}

section('Placing a tower reroutes packets');
{
  const cells = createBoard();
  const before = findPath(cells).length;
  // The board has several routes of equal length, so a short wall can be
  // absorbed without the journey growing at all. Leaving one gap at the very
  // bottom is what actually forces the detour a maze is built to create.
  for (let row = 0; row < ROWS - 1; row++) cells[idx(3, row)] = TOWER;
  const after = findPath(cells).length;
  ok(after > before, 'funnelling the route through one gap makes it longer', `${before} -> ${after}`);
  ok(findPath(cells) !== null, 'and packets can still get through');
  ok(findPath(cells).includes(idx(3, ROWS - 1)), 'the route goes through the gap that was left');
}

section('Packets already on the board cannot be stranded');
{
  const cells = createBoard();
  // Box a packet into cell (1,6) on three sides, then try to close the fourth.
  cells[idx(1, 5)] = TOWER;
  cells[idx(1, 7)] = TOWER;
  cells[idx(0, 6)] = TOWER;
  const occupied = new Set([idx(1, 6)]);
  const trapping = canPlace(cells, 2, 6, occupied);
  ok(!trapping.ok, 'sealing the last exit of an occupied cell is refused');
  ok(/strand|seal/i.test(trapping.reason), 'and it says why', trapping.reason);
  ok(canPlace(cells, 8, 1, occupied).ok, 'an unrelated cell is still buildable');
}

section('Pathfinding is stable');
{
  const a = findPath(createBoard());
  const b = findPath(createBoard());
  ok(a.length === b.length && a.every((cell, i) => cell === b[i]), 'the same board gives the same route every time');
}

section('Board sanity');
{
  const cells = createBoard();
  ok(isOpen(cells, ENTRY.col, ENTRY.row), 'the entry cell is open');
  ok(isOpen(cells, CORE.col, CORE.row), 'the core cell is open');
  ok(TRACES.every((t) => t.col >= 0 && t.col < COLS && t.row >= 0 && t.row < ROWS), 'every trace is on the board');
}

report();

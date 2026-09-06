// Simulation tests. These run the real Game with no browser attached, which is
// the whole reason the simulation was kept free of canvas and DOM: a wave that
// leaks, a tower that never cools down or an economy that prints money all show
// up here in milliseconds instead of on the site.

import { ok, eq, near, section, report } from './harness.js';
import {
  START_CREDITS, START_INTEGRITY, BUILD_SECONDS, TOWERS, PACKETS, WAVES,
  HEAT_MAX, SELL_RATIO, OVERCLOCK, SURGE, WAVE_CLEAR_BONUS,
} from '#shared/constants.js';
import { Game, upgradeCost } from '#shared/sim.js';
import { idx, colOf, rowOf, isOpen, findPath } from '#shared/grid.js';

const DT = 1 / 60;
/** Step the game forward `seconds`, optionally calling back each frame. */
function run(game, seconds, onFrame) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    onFrame?.(game, i);
    game.step(DT);
  }
  return game;
}

/** Step until `done(game)` is true, giving up after `limit` seconds. */
function runUntil(game, done, limit = 180) {
  for (let i = 0; i < Math.round(limit / DT); i++) {
    if (done(game)) return true;
    game.step(DT);
  }
  return done(game);
}

/** Place `count` towers on open cells next to the route, ignoring the price. */
function fortify(game, type, count) {
  game.credits = 1e9;
  let placed = 0;
  for (const cell of game.currentPath()) {
    if (placed >= count) break;
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (placed >= count) break;
      const col = colOf(cell) + dc;
      const row = rowOf(cell) + dr;
      if (!isOpen(game.cells, col, row)) continue;
      if (game.place(col, row, type).ok) placed++;
    }
  }
  return placed;
}

section('A new game');
{
  const game = new Game({ seed: 7 });
  eq(game.credits, START_CREDITS, 'starts with the opening budget');
  eq(game.integrity, START_INTEGRITY, 'starts at full core integrity');
  eq(game.phase, 'build', 'starts in the build phase');
  eq(game.waveNumber, 1, 'is about to run wave 1');
  ok(game.currentPath().length > 0, 'has a route from entry to core');
  ok(game.packets.length === 0, 'has no packets yet');
}

section('Building and selling');
{
  const game = new Game({ seed: 1 });
  const before = game.credits;
  const placed = game.place(2, 4, 'pulse');
  ok(placed.ok, 'a tower goes down on an open cell');
  eq(game.credits, before - TOWERS.pulse.cost, 'the price is deducted');
  eq(game.towers.size, 1, 'the tower is on the board');
  ok(!game.place(2, 4, 'pulse').ok, 'a second tower cannot share the cell');

  const poor = new Game({ seed: 1 });
  poor.credits = 10;
  const refused = poor.place(3, 3, 'laser');
  ok(!refused.ok && /credit/i.test(refused.reason), 'an unaffordable tower is refused', refused.reason);
  eq(poor.towers.size, 0, 'and nothing is placed');

  const creditsWithTower = game.credits;
  game.sell(idx(2, 4));
  eq(game.towers.size, 0, 'selling removes the tower');
  eq(game.credits, creditsWithTower + Math.round(TOWERS.pulse.cost * SELL_RATIO), 'and refunds part of the cost');
  ok(game.place(2, 4, 'pulse').ok, 'the freed cell can be built on again');
}

section('Upgrading');
{
  const game = new Game({ seed: 1 });
  game.credits = 5000;
  game.place(2, 4, 'pulse');
  const cell = idx(2, 4);
  const cost = upgradeCost('pulse', 1);
  const before = game.credits;
  ok(game.upgrade(cell).ok, 'a tower upgrades');
  eq(game.towers.get(cell).level, 2, 'and gains a level');
  eq(game.credits, before - cost, 'and charges the upgrade price');
  ok(game.upgrade(cell).ok, 'it upgrades once more');
  const maxed = game.upgrade(cell);
  ok(!maxed.ok && /maximum/i.test(maxed.reason), 'but stops at the last level', maxed.reason);
  eq(game.towers.get(cell).invested, TOWERS.pulse.cost + upgradeCost('pulse', 1) + upgradeCost('pulse', 2), 'the invested total tracks every purchase');
}

section('Waves start, packets walk, the core takes the hit');
{
  const game = new Game({ seed: 3 });
  run(game, BUILD_SECONDS + 0.2);
  eq(game.phase, 'wave', 'the wave begins when the build timer runs out');
  run(game, 2);
  ok(game.packets.length > 0, 'packets are on the board');

  const leader = game.packets[0];
  const startX = leader.x;
  run(game, 1);
  ok(leader.x > startX, 'packets move towards the core', `${startX.toFixed(2)} -> ${leader.x.toFixed(2)}`);

  // No towers at all, so wave 1 must get through and cost integrity.
  run(game, 60);
  ok(game.integrity < START_INTEGRITY, 'an undefended wave damages the core');
  ok(game.leaked > 0, 'and the leak is counted');
}

section('Towers actually stop things');
{
  const game = new Game({ seed: 5 });
  const placed = fortify(game, 'pulse', 8);
  ok(placed >= 6, 'the test could build a defence', `placed ${placed}`);
  game.rush();
  run(game, 60);
  eq(game.integrity, START_INTEGRITY, 'wave 1 is held without a scratch');
  ok(game.kills > 0, 'packets were destroyed');
  ok(game.creditsEarned > 0, 'and paid out bounties');
  ok(game.wave >= 1, 'the wave is marked cleared');
}

section('Losing');
{
  const game = new Game({ seed: 9 });
  game.integrity = 1;
  run(game, BUILD_SECONDS + 120);
  eq(game.phase, 'over', 'the run ends when integrity is gone');
  eq(game.integrity, 0, 'integrity floors at zero rather than going negative');
  const before = game.time;
  game.step(DT);
  eq(game.time, before, 'and a finished game stops simulating');
}

section('Heat and overclock');
{
  // Real play first: something on the board should get warm.
  const game = new Game({ seed: 11 });
  fortify(game, 'laser', 3);
  game.rush();
  let peakHeat = 0;
  run(game, 25, (g) => {
    for (const tower of g.towers.values()) peakHeat = Math.max(peakHeat, tower.heat);
  });
  ok(peakHeat > 0, 'firing builds heat', `peak ${peakHeat.toFixed(1)}`);

  // Then a rig: one laser with an immovable, effectively unkillable target
  // parked in range, so the heat curve is the only thing being measured.
  const solo = new Game({ seed: 13 });
  solo.credits = 1e9;
  const spot = solo.currentPath()
    .map((cell) => ({ col: colOf(cell), row: rowOf(cell) - 1 }))
    .find(({ col, row }) => isOpen(solo.cells, col, row));
  solo.place(spot.col, spot.row, 'laser');
  const tower = [...solo.towers.values()][0];
  solo.rush();

  const dummy = solo.spawn('daemon', 500);
  dummy.x = tower.col + 1.5;
  dummy.y = tower.row + 0.5;
  dummy.speed = 0;

  run(solo, 6);
  ok(tower.heat >= HEAT_MAX || tower.overheated, 'sustained fire drives a laser to its ceiling');
  runUntil(solo, (g) => !tower.overheated, 30);
  ok(!tower.overheated, 'and it cools back into service on its own');

  runUntil(solo, () => tower.heat < HEAT_MAX * 0.5, 30);
  ok(solo.overclock(tower.cell).ok, 'overclock engages');
  near(tower.overclockLeft, OVERCLOCK.seconds, 0.001, 'and runs for its full window');

  let firedWhileRedlined = false;
  run(solo, OVERCLOCK.seconds - 0.1, () => {
    if (tower.heat >= HEAT_MAX && tower.overclockLeft > 0 && !tower.overheated) firedWhileRedlined = true;
  });
  ok(firedWhileRedlined, 'an overclocked tower keeps working past the redline');
  ok(!tower.overheated, 'and is not shut down while boosted');

  run(solo, 0.3);
  eq(tower.overclockLeft, 0, 'the boost expires');
  ok(tower.overheated, 'and the shutdown lands the moment it does');
  ok(tower.overclockCooldown > 0, 'overclock then has to recharge');
  ok(!solo.overclock(tower.cell).ok, 'and cannot be used again immediately');
}

section('Surge');
{
  const game = new Game({ seed: 17 });
  run(game, BUILD_SECONDS + 4);
  const before = game.packets.map((packet) => packet.hp);
  ok(before.length > 0, 'there are packets to hit');
  ok(game.surge().ok, 'surge fires');
  const hitEverything = game.packets.every((packet, i) => packet.hp < before[i] ?? true);
  ok(hitEverything || game.packets.length < before.length, 'every packet on the board took damage');
  ok(game.packets.every((packet) => packet.stunUntil > game.time), 'and everything left is stunned');
  ok(!game.surge().ok, 'surge cannot be spammed');
  eq(game.surgeCooldown > 0, true, 'it goes on cooldown');
}

section('Rushing a wave');
{
  const game = new Game({ seed: 19 });
  const before = game.credits;
  const result = game.rush();
  ok(result.ok, 'the next wave can be called early');
  ok(result.bonus > 0, 'which pays a bonus for the time saved', `+${result.bonus}`);
  eq(game.credits, before + result.bonus, 'the bonus is credited');
  eq(game.phase, 'wave', 'and the wave starts immediately');
  ok(!game.rush().ok, 'a running wave cannot be rushed again');
}

section('Clearing a wave pays out');
{
  const game = new Game({ seed: 23 });
  fortify(game, 'pulse', 10);
  game.rush();
  const earnedBefore = game.creditsEarned;
  // Stop as soon as the wave is banked; running a fixed 60s would roll straight
  // into wave 2 and make every number below a different measurement.
  runUntil(game, (g) => g.phase !== 'wave');
  eq(game.wave, 1, 'the wave counter advances');
  eq(game.phase, 'build', 'and the game returns to building');
  ok(game.creditsEarned >= earnedBefore + WAVE_CLEAR_BONUS, 'the clear bonus is paid');
  near(game.buildTimer, BUILD_SECONDS, 0.05, 'the build timer resets');
}

section('The maze cannot be sealed mid-wave');
{
  const game = new Game({ seed: 29 });
  game.credits = 1e9;
  run(game, BUILD_SECONDS + 3);
  ok(game.packets.length > 0, 'a wave is in progress');
  let sealed = false;
  for (let col = 0; col < 20 && !sealed; col++) {
    for (let row = 0; row < 13; row++) game.place(col, row, 'pulse');
    if (findPath(game.cells) === null) sealed = true;
  }
  ok(!sealed, 'no amount of building can close the route');
  ok(game.packets.every((packet) => packet.path.length > 0), 'and every packet still has somewhere to go');
}

section('The same seed and inputs give the same run');
{
  const play = (seed) => {
    const game = new Game({ seed });
    fortify(game, 'pulse', 6);
    game.rush();
    run(game, 45);
    return `${game.wave}/${game.integrity}/${game.kills}/${game.creditsEarned}`;
  };
  eq(play(42), play(42), 'two identical runs finish identically');
}

section('Scoring');
{
  const game = new Game({ seed: 31 });
  const opening = game.score();
  eq(opening, 0, 'a run that has not started scores nothing');
  fortify(game, 'pulse', 10);
  game.rush();
  run(game, 60);
  ok(game.score() > opening, 'surviving a wave scores higher');
}

report();

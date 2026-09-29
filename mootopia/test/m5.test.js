// M5 — animals: wandering, fleeing, charging, the boss's slam and the treasure.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks } from './util.js';
import * as C from '#shared/config.js';
import { ITEMS } from '#shared/items.js';
import { ANIMALS } from '#shared/animals.js';

const byName = (name) => ANIMALS.find((a) => a.name === name);
/** A game whose animals are all asleep, and one awake at (x, y). */
function withAnimal(name, x, y) {
  const g = emptyGame({ animals: true });
  for (const a of g.animals) { a.alive = false; a.spawnCounter = 1e12; }
  const a = g.animals.find((an) => an.data.name === name);
  Object.assign(a, { alive: true, x, y, xVel: 0, yVel: 0, health: a.maxHealth, waitCount: 1, moveCount: 0, runFrom: null, chargeTarget: null, hitWait: 0, spawnCounter: 0 });
  return { g, a };
}

section('Where they live');
{
  const g = emptyGame({ animals: true });
  const inBand = (a) => {
    const y = a.y;
    return a.data.biomes.some((b) => (b === 'snow' ? y < C.SNOW_TOP : b === 'desert' ? y > C.DESERT_TOP : y >= C.SNOW_TOP && y <= C.DESERT_TOP));
  };
  const roaming = g.animals.filter((a) => !a.data.fixedSpawn);
  ok(roaming.every(inBand), `all ${roaming.length} roaming animals start in their own biome`);
  ok(g.animals.every((a) => !C.inRiver(a.y) || a.data.fixedSpawn), 'none start in the river');
  const boss = g.animals.find((a) => a.data.boss);
  eq(`${boss.x},${boss.y}`, byName('OLD GRIZZLE').fixedSpawn.join(','), 'the boss holds its den');
  eq(g.animals.length, ANIMALS.reduce((n, a) => n + a.count, 0), `${g.animals.length} animals in all`);
}

section('Passive animals');
{
  const { g, a } = withAnimal('Deer', 5000, 5000);
  ticks(g, 60);
  ok(Math.hypot(a.x - 5000, a.y - 5000) > 30, 'a deer wanders off on its own');
  const p = spawnAt(g, a.x - 150, a.y);
  a.waitCount = 1e9; a.moveCount = 0;
  a.changeHealth(-10, p, p);
  const d0 = Math.hypot(a.x - p.x, a.y - p.y);
  ticks(g, 15);
  ok(Math.hypot(a.x - p.x, a.y - p.y) > d0 + 100, 'hit, it runs away from you');
  eq(a.chargeTarget, null, 'and never fights back');
}

section('Hostile animals');
{
  const { g, a } = withAnimal('Wolf', 5000, 5000);
  const far = spawnAt(g, 5000 + byName('Wolf').viewRange + 300, 5000);
  ticks(g, 20);
  eq(a.chargeTarget, null, 'a wolf ignores players beyond its view range');
  // Put it back where it started, so the nearer player is unambiguous.
  Object.assign(a, { x: 5000, y: 5000, xVel: 0, yVel: 0, moveCount: 0, waitCount: 1 });
  const p = spawnAt(g, 5300, 5000);
  ticks(g, 2);
  eq(a.chargeTarget, p, 'and charges the nearest one inside it');
  let bitten = false;
  for (let i = 0; i < 60 && !bitten; i++) { g.tick(); bitten = p.health < 100; }
  ok(bitten, 'it catches up and bites');
  ok(p.health % byName('Wolf').dmg === 100 % byName('Wolf').dmg, 'for 8 a bite');
  void far;

  const w = withAnimal('Boar', 5000, 5000);
  const owner = spawnAt(w.g, 9000, 9000);
  const wall = ITEMS.find((i) => i.name === 'Stone Wall');
  // A ring of stone walls around a player, with the boar outside it.
  const cx = 5500; const cy = 5000; const ring = 150;
  const n = Math.ceil(Math.PI * 2 * ring / (wall.scale * 2));
  for (let i = 0; i < n; i++) w.g.addObject({ x: cx + Math.cos(i / n * Math.PI * 2) * ring, y: cy + Math.sin(i / n * Math.PI * 2) * ring, scale: wall.scale, item: wall, owner });
  const hiding = spawnAt(w.g, cx, cy);
  w.a.waitCount = 1;
  let closest = Infinity; let charged = false;
  for (let t = 0; t < 90; t++) { w.g.tick(); closest = Math.min(closest, Math.hypot(w.a.x - cx, w.a.y - cy)); charged ||= w.a.chargeTarget === hiding; }
  ok(charged, 'a boar charges a player walled in');
  // The nearest it can get is nestled in the notch between two neighbouring walls, touching both.
  const half = Math.PI / n; const touch = wall.scale + w.a.scale;
  const notch = ring * Math.cos(half) + Math.sqrt(touch * touch - (ring * Math.sin(half)) ** 2);
  ok(closest >= notch - 1, `but the walls hold it outside: closest ${closest.toFixed(1)}, the notch between two walls is ${notch.toFixed(1)}`);
  eq(hiding.health, 100, 'so it never lands a hit');

  const t = withAnimal('Wolf', 6000, 6000);
  const trapper = spawnAt(t.g, 12000, 12000);
  const trap = ITEMS.find((i) => i.name === 'Pit Trap');
  t.g.addObject({ x: 6000, y: 6000, scale: trap.scale, item: trap, owner: trapper });
  const bait = spawnAt(t.g, 6400, 6000);
  t.a.waitCount = 1;
  ticks(t.g, 30);
  ok(Math.hypot(t.a.x - 6000, t.a.y - 6000) < trap.scale, 'a pit trap holds a wolf');
  eq(bait.health, 100, 'which stays put while you watch');
  const f = withAnimal('Fox', 7000, 7000 - 2000);
  f.g.addObject({ x: 7000, y: 5000, scale: trap.scale, item: trap, owner: trapper });
  f.a.runFrom = spawnAt(f.g, 7000 - 200, 5000); f.a.moveCount = 3000; f.a.waitCount = 0;
  ticks(f.g, 30);
  ok(Math.hypot(f.a.x - 7000, f.a.y - 5000) > trap.scale, 'foxes are too quick for traps');
}

section('The boss');
{
  const data = byName('OLD GRIZZLE');
  const { g, a } = withAnimal('OLD GRIZZLE', 6000, 6000);
  const owner = spawnAt(g, 12000, 12000);
  const wall = ITEMS.find((i) => i.name === 'Wood Wall');
  const w = g.addObject({ x: 6000, y: 6000 - data.hitRange + 20, scale: wall.scale, item: wall, owner });
  const p = spawnAt(g, 6000 + a.scale + C.PLAYER_SCALE + 40, 6000);
  a.waitCount = 1;
  ticks(g, 2);
  eq(a.chargeTarget, p, 'Old Grizzle goes for you');
  ok(a.hitWait > 0, 'and winds up once you are in reach');
  eq(p.health, 100, 'no damage during the wind-up — time to run');
  p.x = a.x + a.scale + 20; p.y = a.y;
  ticks(g, Math.ceil(data.hitDelay / C.TICK_MS) + 1);
  near(p.health, 100 - data.dmg, 1e-9, 'then slams for 40');
  ok(!w.active || w.health <= wall.health - data.dmg * 5, 'and flattens buildings in reach (200 a slam)');
}

section('The treasure');
{
  const data = byName('Treasure');
  const { g, a } = withAnimal('Treasure', 11000, 12000);
  const p = spawnAt(g, 11000 - a.scale - C.PLAYER_SCALE - 30, 12000);
  ticks(g, 40);
  near(a.x, 11000, 1e-9, 'the treasure never moves');
  a.health = 5;
  p.dir = 0; p.mouseState = 1; p.hits = 1;
  ticks(g, 1);
  ok(!a.alive, 'break it open…');
  eq(p.gold, data.score, '…for 5000 gold');
  ticks(g, Math.ceil(data.respawn / C.TICK_MS) + 2);
  ok(a.alive && a.x === data.fixedSpawn[0] && a.y === data.fixedSpawn[1], 'and a new one appears two minutes later');
}

section('Respawning and the river');
{
  const { g, a } = withAnimal('Deer', 5000, 5000);
  a.changeHealth(-1e6, null);
  ok(!a.alive, 'a dead deer is gone');
  ticks(g, Math.ceil(30000 / C.TICK_MS) + 2);
  ok(a.alive && a.health === a.maxHealth, 'another is out there 30 seconds later');
  const r = withAnimal('Deer', 5000, C.MAP / 2);
  r.a.waitCount = 1e9;
  ticks(r.g, 5);
  ok(r.a.x > 5000, 'the river carries animals downstream too');
}

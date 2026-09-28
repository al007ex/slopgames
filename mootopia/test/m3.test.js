// M3 — the arsenal: bows, crossbows, the musket, shields, McGrabby and the upgrade tree.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks, sent } from './util.js';
import * as C from '#shared/config.js';
import { WEAPONS, ITEMS, PROJECTILES, upgradeChoices } from '#shared/items.js';

const weapon = (name) => WEAPONS.find((w) => w.name === name);
const item = (name) => ITEMS.find((i) => i.name === name);
const arm = (p, name) => { const w = weapon(name); p.weapons[w.type] = w.id; p.weaponIndex = w.id; p.buildIndex = -1; return w; };
const fire = (p, dir = 0) => { p.dir = dir; p.mouseState = 1; p.hits = 1; };
const stop = (p) => { p.mouseState = 0; };
const flyFor = (g, dist, speed) => ticks(g, Math.ceil(dist / (speed * C.TICK_MS)) + 3);

section('The hunting bow');
{
  const g = emptyGame();
  const archer = spawnAt(g, 5000, 5000); archer.wood = 100;
  const bow = arm(archer, 'Hunting Bow');
  const target = spawnAt(g, 5600, 5000);
  fire(archer); ticks(g, 1); stop(archer);
  eq(g.projectiles.length, 1, 'an arrow is loosed');
  eq(archer.wood, 100 - bow.cost.wood, 'for 4 wood');
  const pr = g.projectiles[0];
  near(pr.x - archer.x, C.PLAYER_SCALE * 2, 2, 'from just in front of the archer');
  ok(sent(target, 'proj').length === 1, 'anyone who can see it is told');
  flyFor(g, 600, PROJECTILES[bow.projectile].speed);
  eq(target.health, 100 - PROJECTILES[0].dmg, 'and it hits for 25');
  eq(g.projectiles.length, 0, 'the arrow stops at what it hits');
  ok(sent(target, 'prm').length === 1, 'and viewers are told it landed');

  const empty = spawnAt(g, 9000, 9000); arm(empty, 'Hunting Bow'); empty.wood = 3;
  fire(empty); ticks(g, 1);
  eq(g.projectiles.length, 0, 'no wood, no arrow');

  const far = spawnAt(g, 3000, 3000); far.wood = 10; arm(far, 'Hunting Bow');
  // It leaves 70 units out and flies 1000, so it ends at +1070; this target's near edge is at +1165.
  const way = spawnAt(g, 3000 + 1200, 3000);
  fire(far); ticks(g, 1); stop(far); flyFor(g, 1200, 1.6);
  eq(way.health, 100, 'an arrow falls after 1000 units');
}

section('Walls, platforms and shields');
{
  const g = emptyGame();
  const owner = spawnAt(g, 12000, 12000);
  const wood = item('Wood Wall');
  const wall = g.addObject({ x: 5300, y: 5000, scale: wood.scale, item: wood, owner });
  const archer = spawnAt(g, 5000, 5000); archer.wood = 100; arm(archer, 'Hunting Bow');
  const behind = spawnAt(g, 5600, 5000);
  fire(archer); ticks(g, 1); stop(archer); flyFor(g, 600, 1.6);
  eq(behind.health, 100, 'a wall stops an arrow');
  eq(wall.health, wood.health - 25, 'wood walls take the damage');
  const stoneW = item('Stone Wall');
  const s2 = g.addObject({ x: 5300, y: 7000, scale: stoneW.scale, item: stoneW, owner });
  const a2 = spawnAt(g, 5000, 7000); a2.wood = 100; arm(a2, 'Hunting Bow');
  fire(a2); ticks(g, 1); stop(a2); flyFor(g, 600, 1.6);
  eq(s2.health, stoneW.health, 'stone walls just shrug arrows off');

  const plat = item('Platform');
  const high = spawnAt(g, 8000, 9000); high.wood = 100; arm(high, 'Hunting Bow');
  g.addObject({ x: 8000, y: 9000, scale: plat.scale, item: plat, owner: high });
  g.addObject({ x: 8300, y: 9000, scale: wood.scale, item: wood, owner });
  const hiding = spawnAt(g, 8600, 9000);
  ticks(g, 1);
  eq(high.zIndex, 1, 'the archer stands on a platform');
  fire(high); ticks(g, 1); stop(high); flyFor(g, 600, 1.6);
  eq(hiding.health, 75, 'and shoots clean over the wall');

  const shield = spawnAt(g, 11000, 5600, { dir: Math.PI });
  arm(shield, 'Wooden Shield');
  const a3 = spawnAt(g, 11000 - 600, 5600); a3.wood = 100; arm(a3, 'Hunting Bow');
  fire(a3); ticks(g, 1); stop(a3); flyFor(g, 600, 1.6);
  eq(shield.health, 100, 'a raised shield blocks arrows from the front');
  const back = spawnAt(g, 11000, 3000, { dir: 0 });
  arm(back, 'Wooden Shield');
  const a4 = spawnAt(g, 11000 - 600, 3000); a4.wood = 100; arm(a4, 'Hunting Bow');
  fire(a4); ticks(g, 1); stop(a4); flyFor(g, 600, 1.6);
  eq(back.health, 75, 'but not from behind');
}

section('Crossbows and the musket');
{
  const g = emptyGame();
  const shots = [['Crossbow', 'wood', 5, 35], ['Repeater Crossbow', 'wood', 10, 30], ['Musket', 'stone', 10, 50]];
  let y = 3000;
  for (const [name, res, cost, dmg] of shots) {
    const p = spawnAt(g, 5000, y); p.wood = 100; p.stone = 100;
    const w = arm(p, name);
    const t = spawnAt(g, 5500, y);
    fire(p); ticks(g, 1); stop(p);
    eq(p[res], 100 - cost, `the ${name.toLowerCase()} costs ${cost} ${res}`);
    if (w.rec) ok(p.xVel < 0, 'and kicks you backwards');
    flyFor(g, 500, PROJECTILES[w.projectile].speed);
    eq(t.health, 100 - dmg, `and hits for ${dmg}`);
    y += 2000;
  }
  const rep = spawnAt(g, 9000, 9000); rep.wood = 1000; arm(rep, 'Repeater Crossbow');
  fire(rep); ticks(g, 9);
  ok(g.projectiles.length + 0 >= 3 || sent(rep, 'swing').length >= 3, `the repeater fires fast (${sent(rep, 'swing').length} bolts a second)`);
}

section('McGrabby');
{
  const g = emptyGame();
  const thief = spawnAt(g, 5000, 5000); arm(thief, 'McGrabby');
  const mark = spawnAt(g, 5100, 5000); mark.gold = 1000;
  fire(thief); ticks(g, 1); stop(thief);
  eq(thief.gold, 250, 'McGrabby snatches 250 gold');
  eq(mark.gold, 750, 'straight from the victim');
  eq(mark.health, 100, 'without hurting them');
  ok(mark.xVel > 0, 'though it does shove them');
}

section('The upgrade tree');
{
  const at = (age, items = [0, 3, 6, 10], weapons = [0]) => upgradeChoices(age, items, weapons).map((c) => (c.kind === 'weapon' ? WEAPONS[c.id].name : ITEMS[c.id].name));
  eq(at(6).sort().join(', '), ['Hunting Bow', 'Great Hammer', 'Wooden Shield', 'McGrabby'].sort().join(', '), 'age 6 offers the secondaries');
  ok(!at(8).includes('Crossbow'), 'no crossbow without a bow…');
  ok(at(8, [0, 3, 6, 10], [0, 9]).includes('Crossbow'), '…but with one it is on offer');
  ok(at(8, [0, 3, 6, 10], [3]).includes('Katana') && !at(8).includes('Katana'), 'the katana needs the short sword');
  ok(at(8, [0, 3, 6, 10], [1]).includes('Great Axe'), 'the great axe needs the hand axe');
  const greater = item('Greater Spikes').id; const stone = item('Stone Wall').id;
  ok(at(7, [0, stone, 6, 10]).includes('Castle Wall') && !at(7).includes('Castle Wall'), 'castle walls need stone walls');
  ok(at(9, [0, 3, greater, 10]).includes('Poison Spikes') && !at(9).includes('Poison Spikes'), 'poison spikes need greater spikes');
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  p.upgradePoints = 1; p.upgrAge = 6;
  ok(p.upgrade('weapon', weapon('Hunting Bow').id), 'picking a secondary…');
  eq(p.weapons[1], weapon('Hunting Bow').id, '…puts it in the second weapon slot');
  eq(p.weaponIndex, 0, 'while you keep holding your primary');
  p.select(weapon('Hunting Bow').id, true);
  eq(p.weaponIndex, weapon('Hunting Bow').id, 'switching to it works');
  p.select(weapon('Katana').id, true);
  eq(p.weaponIndex, weapon('Hunting Bow').id, 'switching to a weapon you do not own does not');
}

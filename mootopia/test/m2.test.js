// M2 — building and items: placement, limits, food, pads, mills, traps and turrets.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks, sent } from './util.js';
import * as C from '#shared/config.js';
import { ITEMS } from '#shared/items.js';

const item = (name) => ITEMS.find((i) => i.name === name);
const rich = (p) => { p.wood = p.food = p.stone = 5000; p.gold = 0; return p; };
const give = (p, name) => { const it = item(name); if (!p.items.includes(it.id)) p.items.push(it.id); return it; };
const place = (p, name, dir = 0) => { const it = give(p, name); p.dir = dir; p.buildIndex = it.id; return p.build(it); };

section('Placing things');
{
  const g = emptyGame();
  const p = rich(spawnAt(g, 5000, 5000));
  const wall = item('Wood Wall');
  ok(place(p, 'Wood Wall'), 'a wood wall goes down');
  const o = g.objects.list.at(-1);
  near(o.x - p.x, C.PLAYER_SCALE + wall.scale + wall.placeOffset, 1e-9, 'right in front of you, touching your body');
  eq(p.wood, 5000 - 10, 'it costs 10 wood');
  eq(p.itemCounts[wall.group.id], 1, 'and counts towards your wall limit');
  eq(p.buildIndex, -1, 'your hands go back to your weapon');
  ok(sent(p, 'count').some((m) => m[1] === wall.group.id && m[2] === 1), 'the client hears about the count');
  ok(!place(p, 'Wood Wall'), 'nothing goes down on top of something else');
  const poor = spawnAt(g, 8000, 5000);
  ok(!place(poor, 'Wood Wall'), 'nothing goes down without the resources');
  const limit = rich(spawnAt(g, 8000, 8000));
  limit.itemCounts[wall.group.id] = wall.group.limit;
  ok(!place(limit, 'Wood Wall'), `you can have ${wall.group.limit} walls and no more`);
  const swim = rich(spawnAt(g, 5000, C.MAP / 2));
  ok(!place(swim, 'Wood Wall'), 'nothing is built in the river…');
  ok(place(swim, 'Platform'), '…except platforms');

  const blocker = rich(spawnAt(g, 11000, 11000));
  ok(place(blocker, 'Blocker'), 'a blocker goes down');
  const near1 = rich(spawnAt(g, 11000, 11200));
  ok(!place(near1, 'Wood Wall', Math.PI / 2), 'and stops anyone building within 300 of it');
}

section('Food');
{
  const g = emptyGame();
  const p = rich(spawnAt(g, 5000, 5000));
  ok(!place(p, 'Apple'), 'at full health an apple is not eaten');
  eq(p.food, 5000, 'and costs nothing');
  p.health = 50;
  ok(place(p, 'Apple'), 'hurt, it is eaten');
  eq(p.health, 70, 'an apple heals 20');
  eq(p.food, 4990, 'for 10 food');
  p.health = 50; place(p, 'Cookie');
  eq(p.health, 90, 'a cookie heals 40');
  p.health = 20; place(p, 'Cheese');
  eq(p.health, 50, 'cheese heals 30 at once…');
  ticks(g, 9 * 6);
  eq(p.health, 100, '…and 50 more over five seconds');

  const glutton = rich(spawnAt(g, 8000, 8000));
  for (let i = 0; i < C.SHAME_LIMIT; i++) {
    glutton.health = 50;
    glutton.hitTime = g.time - 50;          // hit 50 ms ago…
    place(glutton, 'Apple');               // …and straight onto the food
  }
  eq(glutton.shownHat, C.CLOWN_HAT, 'eating straight after being hit eight times earns the clown hat');
  glutton.health = 50;
  ok(!place(glutton, 'Apple'), 'and no food until it comes off');
  ticks(g, Math.ceil(C.SHAME_MS / C.TICK_MS) + 1);
  eq(glutton.shownHat, 0, 'which it does after 30 seconds');
}

section('Spikes and traps');
{
  const g = emptyGame();
  const owner = rich(spawnAt(g, 5000, 5000));
  place(owner, 'Poison Spikes');
  const spike = g.objects.list.at(-1);
  const victim = spawnAt(g, spike.x + spike.scale + C.PLAYER_SCALE - 1, spike.y);
  ticks(g, 1);
  eq(victim.health, 100 - item('Poison Spikes').dmg, 'poison spikes hurt on contact…');
  ok(victim.poison && victim.poison.dmg === item('Poison Spikes').pDmg, '…and poison');
  const self = spawnAt(g, 0, 0); self.x = owner.x; self.y = owner.y;
  owner.x = spike.x - spike.scale - C.PLAYER_SCALE + 1; owner.health = 100;
  ticks(g, 1);
  eq(owner.health, 100, 'your own spikes never hurt you');

  const trapper = rich(spawnAt(g, 9000, 9000));
  place(trapper, 'Pit Trap');
  const trap = g.objects.list.at(-1);
  const walker = spawnAt(g, trap.x + 400, trap.y);
  ticks(g, 1);
  const seen = sent(walker, 'objs').flatMap((m) => m[1]);
  ok(!seen.includes(trap.sid), 'enemies are not sent your hidden traps');
  walker.moveDir = Math.PI; ticks(g, 20);
  ok(walker.lockMove || Math.hypot(walker.x - trap.x, walker.y - trap.y) < trap.scale, 'walking over one traps you');
  const stuckAt = walker.x; ticks(g, 10);
  near(walker.x, stuckAt, 0.5, 'and holds you there');
  ok(!trap.hideFromEnemy, 'a sprung trap is no longer hidden');
  ok(sent(walker, 'objs').flatMap((m) => m[1]).includes(trap.sid), 'so your victim can see it now');
}

section('Pads');
{
  const g = emptyGame();
  const p = rich(spawnAt(g, 5000, 5000));
  place(p, 'Boost Pad');
  const pad = g.objects.list.at(-1);
  const runner = spawnAt(g, pad.x, pad.y);
  ticks(g, 1);
  ok(runner.xVel > 0.5, 'a boost pad flings you the way it faces');

  place(p, 'Healing Pad', Math.PI);
  const heal = g.objects.list.at(-1);
  const hurt = spawnAt(g, heal.x, heal.y); hurt.health = 40;
  ticks(g, 1);                      // step onto the pad
  hurt.secondTimer = 1;
  ticks(g, 1); ticks(g, 9);
  eq(hurt.health, 40 + 2 * item('Healing Pad').healCol, 'a healing pad heals 15 a second');

  const tele = rich(spawnAt(g, 9000, 9000));
  place(tele, 'Teleporter');
  const tp = g.objects.list.at(-1);
  const jumper = spawnAt(g, tp.x, tp.y);
  ticks(g, 1);
  ok(Math.hypot(jumper.x - tp.x, jumper.y - tp.y) > 200, 'a teleporter sends you somewhere else');

  const spawner = rich(spawnAt(g, 11000, 5000));
  place(spawner, 'Spawn Pad');
  const sp = g.objects.list.at(-1);
  g.killPlayer(spawner, null);
  g.spawn(spawner, {});
  ok(spawner.alive && spawner.x === sp.x && spawner.y === sp.y, 'you come back to life on your spawn pad');
  ok(!sp.active, 'which is used up');
}

section('Gold from windmills, stone from mines, wood from saplings');
{
  const g = emptyGame();
  const p = rich(spawnAt(g, 5000, 5000));
  place(p, 'Windmill', 0); place(p, 'Windmill', Math.PI);
  eq(p.pps, 2, 'two windmills make 2 gold a second');
  p.secondTimer = 1; const g0 = p.gold; const xp0 = p.xp;
  ticks(g, 1);
  eq(p.gold - g0, 2, 'paid once a second');
  ok(p.xp > xp0, 'with XP to match');
  const mill = g.objects.list.find((o) => o.item?.name === 'Windmill' && o.owner === p);
  g.damageObject(mill, 1e6, null, 0);
  eq(p.pps, 1, 'losing a windmill loses its income');

  const miner = rich(spawnAt(g, 9000, 9000));
  place(miner, 'Mine', 0);
  miner.buildIndex = -1; miner.dir = 0; miner.mouseState = 1; miner.hits = 1;
  const stone0 = miner.stone;
  ticks(g, 1);
  eq(miner.stone - stone0, 1, 'a mine gives stone to whoever hits it');
  const farmer = rich(spawnAt(g, 3000, 9500));
  place(farmer, 'Sapling', 0);
  farmer.dir = 0; farmer.mouseState = 1; farmer.hits = 1;
  const wood0 = farmer.wood;
  ticks(g, 1);
  eq(farmer.wood - wood0, 1, 'a sapling grows wood');
}

section('Turrets and platforms');
{
  const g = emptyGame({ animals: false });
  const owner = rich(spawnAt(g, 5000, 5000));
  place(owner, 'Turret');
  const turret = g.objects.list.at(-1);
  const enemy = spawnAt(g, turret.x + 400, turret.y);
  const friend = spawnAt(g, turret.x - 300, turret.y + 300);
  g.createClan(owner, 'TUR'); g.requestClan(friend, [...g.clans.values()][0].id); g.answerClan(owner, friend.sid, true);
  turret.shootCount = 0;
  ticks(g, 30);
  ok(enemy.health < 100, 'a turret shoots enemies in range');
  eq(friend.health, 100, 'but not your clan');
  eq(owner.health, 100, 'or you');

  const builder = rich(spawnAt(g, 9000, C.MAP / 2 - 100));
  place(builder, 'Platform', Math.PI / 2);
  const plat = g.objects.list.at(-1);
  builder.x = plat.x; builder.y = plat.y;
  ticks(g, 1);
  eq(builder.zIndex, 1, 'standing on a platform lifts you up a layer');
  builder.moveDir = null; builder.xVel = 0; builder.yVel = 0;
  ticks(g, 1);
  ok(Math.abs(builder.xVel) < 0.01, 'the river current does not reach you up there');
}

section('Leaving');
{
  const g = emptyGame();
  const p = rich(spawnAt(g, 5000, 5000));
  place(p, 'Wood Wall'); place(p, 'Windmill', Math.PI);
  const other = spawnAt(g, 5300, 5000);
  g.tick();
  eq(g.objects.ownedBy(p).length, 2, 'two buildings stand');
  g.killPlayer(p, null);
  eq(g.objects.ownedBy(p).length, 2, 'dying leaves them standing');
  g.leave(p);
  eq(g.objects.ownedBy(p).length, 0, 'leaving the game takes them away');
  ok(sent(other, 'rm').length >= 2, 'and everyone who could see them is told');
}

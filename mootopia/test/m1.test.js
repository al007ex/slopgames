// M1 — gathering and fighting: the swing, the cone, resources, damage and ageing.

import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks, sent } from './util.js';
import * as C from '#shared/config.js';
import { WEAPONS, ITEMS } from '#shared/items.js';
import { ANIMALS } from '#shared/animals.js';
import { animate, startSwing, weaponBox } from '#shared/pose.js';
import { spriteInfo } from '#shared/sprites.js';
import { TREE, ROCK, GOLD } from '#shared/world.js';

const HAMMER = WEAPONS[0];
const holdMouse = (p, dir = p.dir) => { p.dir = dir; p.mouseState = 1; p.hits = 1; };

// ── the swing itself ────────────────────────────────────────────────────
section('The swing');
{
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  holdMouse(p);
  ticks(g, 9);
  const swings = sent(p, 'swing').length;
  eq(swings, 3, 'holding the mouse with the tool hammer swings 3 times a second (every 4th tick at 9 Hz)');
  p.outbox = []; p.weaponIndex = 7; p.weapons = [7]; ticks(g, 9);
  ok(sent(p, 'swing').length >= 4, `daggers (100 ms) swing every other tick (${sent(p, 'swing').length} a second)`);
  p.outbox = []; p.weaponIndex = 5; p.weapons = [5]; ticks(g, 18);
  eq(sent(p, 'swing').length, 3, 'the polearm (700 ms) swings once every 7 ticks');

  // The animation: a quarter of the reload out, three quarters back.
  const e = { dirPlus: 0 };
  startSwing(e, true, 300);
  animate(e, 75);
  near(e.dirPlus, -C.HIT_ANGLE, 1e-9, 'a swing that hits reaches a quarter turn a quarter of the way in');
  animate(e, 112.5);
  near(e.dirPlus, -C.HIT_ANGLE / 2, 1e-9, '…is halfway back halfway through the return');
  animate(e, 112.6);
  eq(e.dirPlus, 0, '…and is back to rest when the reload ends');
  const m = { dirPlus: 0 };
  startSwing(m, false, 300); animate(m, 75);
  near(m.dirPlus, -Math.PI, 1e-9, 'a swing that only cuts air goes a half turn');
}

section('Where the weapon sits');
{
  // At the classic box size the grip is exactly the classic placement.
  const fake = { ...WEAPONS[3], xOff: -8, yOff: 46, length: 256 * 0.5, width: 410 * 0.5 };
  const box = weaponBox(fake, C.PLAYER_SCALE);
  near(box.x, C.PLAYER_SCALE - 8 - fake.length / 2, 1e-9, 'a sprite drawn to its classic box sits exactly where the classic layout puts it (x)');
  near(box.y, 46 - fake.width / 2, 1e-9, '…and (y)');
  // Resized sprites stay gripped: the hand point is a fixed point of the resize.
  const hand = { x: C.PLAYER_SCALE * Math.cos(Math.PI / 4), y: C.PLAYER_SCALE * Math.sin(Math.PI / 4) };
  let drift = 0;
  for (const w of WEAPONS) {
    const b = weaponBox(w, C.PLAYER_SCALE);
    const ha = Math.PI / 4 * (w.armS || 1);
    const hx = C.PLAYER_SCALE * Math.cos(ha); const hy = C.PLAYER_SCALE * Math.sin(ha);
    // The point of the sprite that the classic box put under the hand is still under it.
    const u = (hx - (C.PLAYER_SCALE + w.xOff - w.length / 2)) / w.length;
    const v = (hy - (w.yOff - w.width / 2)) / w.width;
    drift = Math.max(drift, Math.hypot(b.x + u * b.width - hx, b.y + v * b.height - hy));
  }
  ok(drift < 1e-9, `every weapon keeps its grip in the hand at its true size (worst drift ${drift.toExponential(1)})`);
  const sword = spriteInfo('weapons/sword_1');
  ok(Math.abs(sword.w - 130) < 5 && Math.abs(sword.h - 210) < 6, `the sword is drawn ${sword.w}×${sword.h}, the classic 130×210 give or take a few units`);
  void hand;
}

// ── gathering ───────────────────────────────────────────────────────────
section('Gathering');
{
  const g = emptyGame();
  const tree = g.addObject({ x: 5140, y: 5000, scale: 98, type: TREE });
  const p = spawnAt(g, 5000, 5000);
  ticks(g, 1);                      // the tree comes on screen first
  holdMouse(p, 0);
  ticks(g, 1);
  eq(p.wood, HAMMER.gather, 'a hammer swing at a tree gives 1 wood');
  eq(p.xp, 4 * HAMMER.gather, 'and 4 XP');
  ok(sent(p, 'wiggle').some((m) => m[1] === tree.sid), 'the tree jolts');
  p.mouseState = 0; ticks(g, 8);
  const behind = spawnAt(g, 8000, 5000); g.addObject({ x: 7860, y: 5000, scale: 98, type: TREE });
  holdMouse(behind, 0); ticks(g, 1);
  eq(behind.wood, 0, 'swinging away from a tree gets nothing');
  const side = spawnAt(g, 3000, 3000); g.addObject({ x: 3000, y: 3140, scale: 98, type: TREE });
  holdMouse(side, -(C.GATHER_ANGLE + 0.05) + Math.PI / 2); ticks(g, 1);
  eq(side.wood, 0, 'something just outside the cone is missed');
  const edge = spawnAt(g, 3000, 9500); g.addObject({ x: 3000, y: 9640, scale: 98, type: TREE });
  holdMouse(edge, -(C.GATHER_ANGLE - 0.05) + Math.PI / 2); ticks(g, 1);
  eq(edge.wood, 1, 'something just inside it is hit');
  const far = spawnAt(g, 11000, 3000); g.addObject({ x: 11000 + 98 + HAMMER.range + 3, y: 3000, scale: 98, type: TREE });
  holdMouse(far, 0); ticks(g, 1);
  eq(far.wood, 0, 'a tree just beyond reach is missed');

  const miner = spawnAt(g, 9000, 9000); g.addObject({ x: 9130, y: 9000, scale: 86, type: GOLD });
  holdMouse(miner, 0); ticks(g, 1);
  eq(miner.gold, HAMMER.gather + 4, 'gold ore gives the gather amount plus 4');
  const stoner = spawnAt(g, 9000, 11000); g.addObject({ x: 9130, y: 11000, scale: 86, type: ROCK });
  stoner.weapons = [1]; stoner.weaponIndex = 1;
  holdMouse(stoner, 0); ticks(g, 1);
  eq(stoner.stone, WEAPONS[1].gather, 'the hand axe mines 2 stone a swing');
  eq(stoner.weaponXP[1], 2, 'and every resource gathered is weapon XP');
}

// ── hitting people ──────────────────────────────────────────────────────
section('Hitting people');
{
  const g = emptyGame();
  const a = spawnAt(g, 5000, 5000);
  const b = spawnAt(g, 5100, 5000);
  holdMouse(a, 0);
  ticks(g, 1);
  eq(b.health, 100 - HAMMER.dmg, 'a hammer hit does 25 damage');
  ok(b.xVel > 0, 'and knocks the target back');
  ok(a.slowMult < 1, 'swinging slows you down for a moment');
  ok(sent(a, 'txt').some((m) => m[3] === HAMMER.dmg), 'the attacker sees the number');
  a.mouseState = 0; ticks(g, 20);
  eq(a.slowMult, 1, 'and your speed comes back');

  const reach = spawnAt(g, 7000, 7000); const target = spawnAt(g, 7000 + HAMMER.range + C.PLAYER_SCALE * C.PLAYER_HIT_PAD - 1, 7000);
  holdMouse(reach, 0); ticks(g, 1);
  ok(target.health < 100, 'players are hit out to range + 1.8 × their radius, the classic reach');

  const gold = spawnAt(g, 3000, 9000); const g2 = spawnAt(g, 3100, 9000);
  gold.weaponXP[0] = C.VARIANTS[1].xp;
  holdMouse(gold, 0); ticks(g, 1);
  near(g2.health, 100 - HAMMER.dmg * 1.1, 1e-9, 'a gold hammer hits 10% harder');
  const ruby = spawnAt(g, 3000, 11000); const r2 = spawnAt(g, 3100, 11000);
  ruby.weaponXP[0] = C.VARIANTS[3].xp;
  holdMouse(ruby, 0); ticks(g, 1); ruby.mouseState = 0;
  const after = r2.health; ticks(g, 9 * 6);
  near(r2.health, after - C.POISON.dmg * C.POISON.ticks, 1e-9, 'ruby poisons: 5 a second for 5 seconds');

  const sh = spawnAt(g, 11000, 5000); const shielded = spawnAt(g, 11100, 5000, { dir: Math.PI });
  shielded.weapons = [0, 11]; shielded.weaponIndex = 11;
  holdMouse(sh, 0); ticks(g, 1);
  near(shielded.health, 100 - HAMMER.dmg * 0.2, 1e-9, 'a shield facing the blow takes only a fifth of it');

  const c1 = spawnAt(g, 11000, 9000); const c2 = spawnAt(g, 11100, 9000);
  g.createClan(c1, 'CLAN'); g.requestClan(c2, [...g.clans.values()][0].id); g.answerClan(c1, c2.sid, true);
  holdMouse(c1, 0); ticks(g, 1);
  eq(c2.health, 100, 'clan mates cannot hurt each other');
}

section('Kills and ageing');
{
  const g = emptyGame();
  const killer = spawnAt(g, 5000, 5000);
  const victim = spawnAt(g, 5100, 5000);
  victim.age = 3; victim.health = 20;
  holdMouse(killer, 0);
  ticks(g, 1);
  ok(!victim.alive, 'a hit that takes the last health kills');
  ok(sent(victim, 'died').length === 1, 'the victim is told');
  eq(killer.kills, 1, 'the killer scores a kill');
  eq(killer.gold, 300, 'and earns 100 gold per age of the victim');
  ok(killer.age >= 2, 'which is enough XP to age up');
  ok(sent(killer, 'upg').some((m) => m[1] >= 1 && m[3].length), 'and offers an upgrade');
  const choices = sent(killer, 'upg').at(-1)[3];
  const ids = []; for (let i = 0; i < choices.length; i += 2) ids.push(`${choices[i]}:${choices[i + 1]}`);
  eq(ids.sort().join(' '), ['0:1', '0:3', '0:5', '0:6', '0:7', '0:8'].sort().join(' '), 'age 2 offers the hand axe, sword, polearm, bat, daggers and stick');

  const p = spawnAt(g, 9000, 9000);
  p.earnXP(C.FIRST_XP);
  eq(p.age, 2, '300 XP reaches age 2');
  near(p.maxXP, C.FIRST_XP * C.XP_GROWTH, 1e-9, 'and each age needs 20% more');
  ok(p.upgrade('weapon', 3), 'pick the short sword');
  eq(p.weaponIndex, 3, 'it goes straight into your hand');
  ok(!p.upgrade('weapon', 1), 'one point, one pick');
  p.earnXP(p.maxXP); p.earnXP(p.maxXP);
  ok(p.upgrade('item', ITEMS.findIndex((i) => i.name === 'Cookie')), 'age 3 can swap the apple for a cookie');
  eq(p.items[0], ITEMS.findIndex((i) => i.name === 'Cookie'), 'which replaces the apple in its slot');
}

section('Hats in a fight');
{
  const g = emptyGame();
  const hit = (hatA, hatB) => {
    const a = spawnAt(g, 3000 + Math.random() * 8000, 3000 + Math.random() * 8000);
    const b = spawnAt(g, a.x + 100, a.y);
    a.hatId = hatA; a.applyHat(); b.hatId = hatB; b.applyHat();
    b.health = b.maxHealth;
    holdMouse(a, 0); g.tick(); a.mouseState = 0;
    return { a, b };
  };
  near(100 - hit(0, 1002).b.health, 25 * 0.75, 1e-9, 'Knight Hat: a quarter less damage taken');
  near(100 - hit(1005, 0).b.health, 25 * 1.25, 1e-9, 'Mutant Hat: a quarter more damage dealt');
  const spike = hit(0, 1009);
  near(100 - spike.a.health, 25 * 0.25, 1e-9, 'Spike Hat: a quarter of the blow comes back');
  const tuff = hit(0, 1007);
  eq(tuff.b.maxHealth, 750, 'Tuff Hat: 650 extra health');
  near(100 - hit(1004, 0).b.health, 25 * 0.8, 1e-9, 'Samurai Gear: softer hits…');
  const sam = spawnAt(g, 12000, 12000); sam.hatId = 1004; sam.applyHat(); sam.weapons = [7]; sam.weaponIndex = 7;
  holdMouse(sam, 0); g.tick();
  eq(sam.reloads[7], WEAPONS[7].speed * 0.9, '…but a tenth faster reload');
  const mut = spawnAt(g, 2000, 12000); mut.hatId = 1005; mut.applyHat(); mut.secondTimer = 1;
  g.tick();
  eq(mut.health, 95, 'the Mutant Hat drains 5 health a second');
}

section('Hitting animals and buildings');
{
  const g = emptyGame({ animals: true });
  for (const an of g.animals) an.alive = false, an.spawnCounter = 1e9;
  const deer = g.animals.find((an) => an.data.name === 'Deer');
  const p = spawnAt(g, 5000, 5000);
  Object.assign(deer, { alive: true, x: 5000 + 35 + deer.scale, y: 5000, xVel: 0, yVel: 0, health: 20, waitCount: 1e9 });
  holdMouse(p, 0); ticks(g, 1);
  ok(!deer.alive, 'a deer can be hunted');
  eq(p.food, ANIMALS[0].drop, 'it drops food');
  eq(p.gold, ANIMALS[0].score, 'and its score in gold');

  const owner = spawnAt(g, 12000, 12000);
  const wall = ITEMS.find((i) => i.name === 'Wood Wall');
  owner.changeItemCount(wall.group.id, 1);
  const o = g.addObject({ x: 8000 + 35 + wall.scale + 5, y: 8000, scale: wall.scale, item: wall, owner });
  const raider = spawnAt(g, 8000, 8000);
  raider.weapons = [0, 10]; raider.weaponIndex = 10;
  holdMouse(raider, 0); ticks(g, 1);
  eq(o.health, wall.health - WEAPONS[10].dmg * WEAPONS[10].sDmg, 'the great hammer does 7.5× its damage to buildings');
  ticks(g, 30);
  ok(!o.active, 'and knocks a wood wall down');
  eq(raider.wood, 10, 'whoever destroys a building gets what it cost');
  eq(owner.itemCounts[wall.group.id], 0, 'and the owner can build it again');
}

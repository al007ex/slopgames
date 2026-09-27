// M4 — weapons and damage: hitscan with bloom, shotgun pellets and falloff,
// headshots, rarity, shared ammo, damage to builds, healing, lag compensation.
// Done when two players can fight and one dies, and a shotgun into a ramp rush
// behaves the way it should.
import { ok, eq, near, section, report } from './harness.js';
import { flatBase, standIn, YAW, CELL, WALL_H } from './util.js';
import { Match } from '../server/match.js';
import { WEAPONS, weaponDamage, falloff, RARITIES } from '../shared/items.js';
import { spreadFor } from '../shared/weapons.js';
import { aimFrame } from '../shared/aim.js';
import { BTN_FIRE, BTN_ADS, BTN_SPRINT, capsuleHeight, MODE_DEAD } from '../shared/movement.js';
import { WALL, RAMP, hpAt, slotKey, SLOT_CENTER } from '../shared/pieces.js';
import { buildTarget } from '../shared/build.js';
import { A_PLACE } from '../shared/protocol.js';
import { TICK_HZ } from '../shared/constants.js';
import { EQUIP_TICKS } from '../server/combat.js';

const newMatch = () => new Match({ base: flatBase(), mode: 'test' });
const wait = (m, n) => { for (let i = 0; i < n; i++) m.step(); };

function arm(m, p, key, rarity, ammo = 200) {
  const slot = m.giveItem(p, { key, rarity: rarity ?? WEAPONS[key].tiers[0] });
  m.giveAmmo(p, WEAPONS[key].ammo, ammo);
  m.selectSlot(p, slot + 1);
  wait(m, EQUIP_TICKS + 1);
  return p.inv[slot];
}

/** Aim so the crosshair line passes through a point. */
function aimAt(p, x, y, z, ads = false) {
  let yaw = p.yaw, pitch = p.pitch;
  for (let i = 0; i < 8; i++) {
    const f = aimFrame(p.move, yaw, pitch, ads, {});
    const ax = x - f.ox, ay = y - f.oy, az = z - f.oz;
    yaw = Math.atan2(-ax, -az);
    pitch = Math.atan2(ay, Math.hypot(ax, az));
  }
  p.yaw = yaw; p.pitch = pitch;
}
const headOf = (q) => ({ x: q.move.x, y: q.move.y + capsuleHeight(q.move) - 0.28, z: q.move.z });
const bodyOf = (q) => ({ x: q.move.x, y: q.move.y + 1.0, z: q.move.z });

/** One trigger pull (press for a tick, release for a tick). Returns damage the target took. */
function pull(m, p, target, where = bodyOf, ads = false) {
  const before = target.hp + target.shield;
  const pt = where(target);
  aimAt(p, pt.x, pt.y, pt.z, ads);
  p.buttons = BTN_FIRE | (ads ? BTN_ADS : 0);
  m.step();
  p.buttons = ads ? BTN_ADS : 0;
  m.step();
  return before - (target.hp + target.shield);
}

section('Bloom and first-shot accuracy');
{
  const still = { vx: 0, vz: 0, mode: 0, ground: 1, crouch: 0 };
  eq(spreadFor('ar', 0, still, false), 0, 'a settled rifle has zero spread: the first shot goes where you aim');
  ok(spreadFor('ar', 0, { ...still, vx: 4.5 }, false) > 1.5, 'walking opens the crosshair');
  ok(spreadFor('ar', 0, { ...still, ground: 0 }, false) > spreadFor('ar', 0, { ...still, vx: 4.5 }, false), 'jumping opens it more');
  ok(spreadFor('ar', 2, still, true) < spreadFor('ar', 2, still, false), 'aiming down sights tightens it');
  const m = newMatch();
  const a = standIn(m, 100, 100, { name: 'a' });
  const b = standIn(m, 100, 112, { name: 'b' });   // ~61 m away
  arm(m, a, 'ar', 2, 400);
  b.hp = 10000;
  // Settled first shot: a headshot at 60 m.
  const first = pull(m, a, b, headOf);
  near(first, weaponDamage('ar', 2) * 2 * falloff('ar', 61.4), 0.6, `a settled first shot at 61 m is a headshot (${first.toFixed(1)} damage)`);
  // Hold the trigger: bloom climbs.
  aimAt(a, headOf(b).x, headOf(b).y, headOf(b).z);
  a.buttons = BTN_FIRE;
  let heads = 0, shots = 0, maxBloom = 0;
  const orig = m.hitPlayer.bind(m);
  m.hitPlayer = (src, v, amt, info) => { if (src === a) { shots++; if (info.head) heads++; } orig(src, v, amt, info); };
  for (let i = 0; i < 90; i++) { m.step(); maxBloom = Math.max(maxBloom, a.bloom); }
  a.buttons = 0;
  m.hitPlayer = orig;
  ok(maxBloom >= 3, `spraying blooms the spread (to ${maxBloom.toFixed(1)}°)`);
  ok(heads < shots * 0.7, `…so a held trigger stops landing every headshot (${heads}/${shots})`);
  wait(m, TICK_HZ);
  eq(a.bloom, 0, 'a second of rest resets it');
}

section('Headshots, rarity and falloff');
{
  eq(WEAPONS.ar.head, 2, 'rifle headshots do double');
  eq(WEAPONS.sniper.head, 2.5, 'sniper headshots do two and a half times');
  near(weaponDamage('ar', 1) / weaponDamage('ar', 0), 1.1, 1e-9, 'one rarity up is +10% damage');
  near(weaponDamage('ar', 4) / weaponDamage('ar', 0), 1.4, 1e-9, 'legendary is +40% over common');
  eq(RARITIES.join(' '), 'Common Uncommon Rare Epic Legendary', 'five rarity tiers');
  eq(falloff('sniper', 400), 1, 'snipers have no falloff');
  ok(falloff('ar', 140) < 0.75 && falloff('ar', 30) === 1, 'rifles fall off past 50 m');
  ok(falloff('pump', 4) === 1 && falloff('pump', 20) <= 0.4 && falloff('pump', 50) === 0, 'shotguns fall off hard: full at 4 m, 40% at 20 m, nothing at 50 m');
  const m = newMatch();
  const a = standIn(m, 200, 200, { name: 'sniper' });
  const b = standIn(m, 200, 240, { name: 'target' });   // ~205 m
  b.shield = 100;
  arm(m, a, 'sniper', 2, 10);
  const dmg = pull(m, a, b, headOf, true);
  ok(!b.alive, `a rare bolt-action headshot at 205 m kills through full health and shield (${Math.round(dmg)}+)`);
}

section('Shotguns');
{
  const m = newMatch();
  const a = standIn(m, 300, 300, { name: 'a' });
  const b = standIn(m, 300, 300, { name: 'b' });
  b.move.z = a.move.z - 3;
  arm(m, a, 'pump', 1, 20);
  b.hp = 10000;
  let pellets = 0;
  const orig = m.hitPlayer.bind(m);
  m.hitPlayer = (src, v, amt, info) => { pellets++; orig(src, v, amt, info); };
  const close = pull(m, a, b, bodyOf);
  m.hitPlayer = orig;
  ok(pellets >= 8 && pellets <= 10, `ten pellets, nearly all land at 3 m (${pellets})`);
  ok(close >= 70, `an uncommon pump at 3 m does ~80 to the body (${close.toFixed(0)})`);
  wait(m, TICK_HZ * 2);
  const head = pull(m, a, b, headOf);
  ok(head > 110, `and far more to the head (${head.toFixed(0)})`);
  b.move.z = a.move.z - 30;
  wait(m, TICK_HZ * 2);
  const far = pull(m, a, b, bodyOf);
  ok(far < 25, `at 30 m it barely tickles (${far.toFixed(0)})`);
}

section('Ammo and reloading');
{
  eq(WEAPONS.ar.ammo, WEAPONS.scoped.ammo, 'rifles share medium ammo');
  eq(WEAPONS.pump.ammo, 'heavy', 'shotguns take heavy ammo');
  eq(WEAPONS.rocket.ammo, WEAPONS.grenade.ammo, 'rocket and grenade launchers share rockets');
  const m = newMatch();
  const a = standIn(m, 400, 400);
  const b = standIn(m, 400, 404);
  b.hp = 1e6;
  const gun = arm(m, a, 'pistol', 0, 20);
  a.ammo.light = 20;
  gun.mag = 1;
  pull(m, a, b);
  eq(gun.mag, 0, 'a shot empties the magazine');
  pull(m, a, b);
  ok(a.reloadEnd > 0, 'pulling the trigger on empty starts a reload');
  wait(m, Math.round(WEAPONS.pistol.reload * TICK_HZ) + 1);
  eq(gun.mag, 16, 'the reload fills the magazine');
  eq(a.ammo.light, 4, '…from your reserve');
}

section('Damage to builds');
{
  const m = newMatch();
  const a = standIn(m, 500, 500, { name: 'a' });
  a.mats = [100, 0, 0];
  const wall = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 1, cx: 500, lv: 3, cz: 497, mat: 0, edit: 0, start: -1, damage: 0, team: 9 });
  arm(m, a, 'ar', 0, 60);
  const c = { x: 500.5 * CELL, y: 3 * WALL_H + 1.5, z: 497 * CELL };
  aimAt(a, c.x, c.y, c.z);
  a.buttons = BTN_FIRE; m.step(); a.buttons = 0; m.step();
  near(wall.damage, WEAPONS.ar.damage, 0.01, `a rifle bullet takes ${WEAPONS.ar.damage} off a wall`);
  arm(m, a, 'rocket', 3, 4);
  const behind = standIn(m, 500, 494, { name: 'behind' });
  aimAt(a, c.x, c.y, c.z);
  wait(m, TICK_HZ);
  a.buttons = BTN_FIRE; m.step(); a.buttons = 0;
  wait(m, TICK_HZ);
  ok(!wall.alive, 'one rocket flattens a wood wall (structure damage is several times player damage)');
  ok(behind.hp === 100, 'and the wall soaked the blast for whoever was behind it');
}

section('Healing');
{
  const m = newMatch();
  const p = standIn(m, 600, 600);
  p.hp = 40;
  const slot = m.giveItem(p, { key: 'bandage', count: 5 });
  m.selectSlot(p, slot + 1);
  wait(m, EQUIP_TICKS + 1);
  const use = () => { p.buttons = BTN_FIRE; m.step(); p.buttons = 0; wait(m, Math.round(3.5 * TICK_HZ) + 2); };
  use();
  eq(p.hp, 55, 'a bandage heals 15');
  use(); use(); use();
  eq(p.hp, 75, 'bandages stop at 75');
  eq(p.inv[slot].count, 2, '…and the extra use was refused, not wasted');
  const kit = m.giveItem(p, { key: 'medkit', count: 1 });
  m.selectSlot(p, kit + 1);
  wait(m, EQUIP_TICKS + 1);
  p.buttons = BTN_FIRE; m.step(); p.buttons = 0;
  wait(m, 5 * TICK_HZ);
  eq(p.hp, 75, 'a med kit takes ten seconds…');
  wait(m, 5 * TICK_HZ + 2);
  eq(p.hp, 100, '…and then you are at full health');
  const pot = m.giveItem(p, { key: 'shield', count: 2 });
  m.selectSlot(p, pot + 1);
  wait(m, EQUIP_TICKS + 1);
  for (let i = 0; i < 2; i++) { p.buttons = BTN_FIRE; m.step(); p.buttons = 0; wait(m, 5 * TICK_HZ + 2); if (i === 0) eq(p.shield, 50, 'a shield potion gives 50 shield'); }
  eq(p.shield, 100, 'two stack to 100');
  // Damage hits shield first.
  const q = standIn(m, 600, 604, { name: 'q' });
  arm(m, q, 'ar', 0, 30);
  pull(m, q, p);
  ok(p.shield < 100 && p.hp === 100, 'bullets hit the shield before health');
}

section('Lag compensation');
{
  const m = newMatch();
  const shooter = standIn(m, 700, 700, { name: 'shooter' });
  shooter.bot = false;          // a human: its view time is honoured
  const runner = standIn(m, 700, 704, { name: 'runner' });
  runner.botInput = { mx: 1, mz: 0, yaw: YAW.north, pitch: 0, buttons: BTN_SPRINT };
  arm(m, shooter, 'sniper', 2, 10);
  runner.hp = 1e6;
  wait(m, TICK_HZ);
  // The shooter's screen shows the runner where it was 6 ticks (200 ms) ago.
  const seenTick = m.tick - 6;
  const h = runner.history;
  const i = (seenTick % 32) * 4;
  const seen = { x: h[i + 1], y: h[i + 2] + 1.0, z: h[i + 3] };
  aimAt(shooter, seen.x, seen.y, seen.z, true);
  shooter.viewTick = seenTick;
  const before = runner.hp;
  shooter.buttons = BTN_FIRE | BTN_ADS; m.step(); shooter.buttons = BTN_ADS;
  ok(runner.hp < before, `aiming at where you saw a sprinting player 200 ms ago hits them (they had moved ${(runner.move.x - seen.x).toFixed(2)} m)`);
  wait(m, 4 * TICK_HZ);
  const i2 = ((m.tick - 20) % 32) * 4;
  shooter.viewTick = m.tick - 20;            // too far back to trust
  aimAt(shooter, h[i2 + 1], h[i2 + 2] + 1.0, h[i2 + 3], true);
  const b2 = runner.hp;
  shooter.buttons = BTN_FIRE | BTN_ADS; m.step(); shooter.buttons = 0;
  eq(runner.hp, b2, 'but rewinding stops at ~300 ms: a 660 ms old view misses');
}

section('Done when: two players fight, one dies — and a shotgun into a ramp rush feels right');
{
  const m = newMatch();
  const rusher = standIn(m, 800, 800, { name: 'rusher' });
  const holder = standIn(m, 800, 792, { name: 'holder' });   // 41 m north
  rusher.mats = [500, 0, 0];
  rusher.shield = 50;
  arm(m, rusher, 'pump', 2, 20);
  arm(m, holder, 'ar', 1, 120);
  // The holder sprays the rusher the whole time; the rusher ramps in behind cover.
  let rampHits = 0;
  const origDmg = m.damageStructure.bind(m);
  m.damageStructure = (obj, kind, amt, info) => { if (info.source === holder && kind === 'piece') rampHits++; origDmg(obj, kind, amt, info); };
  rusher.botInput = { mz: 1, mx: 0, yaw: YAW.north, pitch: -0.2, buttons: BTN_SPRINT };
  let t = 0;
  for (; t < 12 * TICK_HZ; t++) {
    const d = Math.hypot(rusher.move.x - holder.move.x, rusher.move.z - holder.move.z);
    if (d < 9) break;
    if (t % 4 === 0) {
      const target = buildTarget(RAMP, rusher.move, YAW.north, -0.2, m.world, {});
      if (!m.world.slots.get(slotKey(SLOT_CENTER, target.cx, target.lv, target.cz))) {
        rusher.buildMode = true;
        m.onAction(rusher, { type: A_PLACE, piece: RAMP, rot: target.rot, cx: target.cx, lv: target.lv, cz: target.cz });
      }
    }
    const aim = bodyOf(rusher);
    aimAt(holder, aim.x, aim.y, aim.z);
    holder.buttons = BTN_FIRE;
    m.step();
  }
  holder.buttons = 0;
  rusher.buildMode = false;
  ok(rampHits > 5, `the ramps soaked the rifle fire on the way in (${rampHits} bullets into builds)`);
  ok(rusher.alive, `the rusher closes the distance alive (${Math.round(rusher.hp)} HP, ${Math.round(rusher.shield)} shield left)`);
  // Drop off the ramp and pump them.
  rusher.botInput = null;
  rusher.move.x = holder.move.x; rusher.move.z = holder.move.z + 4; rusher.move.y = holder.move.y;
  wait(m, EQUIP_TICKS + 1);
  const dmg = pull(m, rusher, holder, headOf);
  ok(dmg >= 100, `a pump to the head at 4 m does ${Math.round(dmg)}`);
  ok(!holder.alive && holder.move.mode === MODE_DEAD, 'and the holder is dead');
  eq(rusher.kills, 1, 'the rusher gets the elimination');
}

report();

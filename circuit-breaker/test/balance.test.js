// Data tests. These are cheap to run and catch the kind of mistake that is
// invisible until wave 19 — a wave referring to a packet that does not exist, an
// upgrade that costs more and does less, or a heat curve that quietly turned
// every tower into the same tower.

import { ok, eq, section, report } from './harness.js';
import {
  TOWERS, TOWER_ORDER, PACKETS, WAVES, HEAT_MAX, HEAT_RESET, OVERCLOCK,
  MIN_DAMAGE, START_CREDITS,
} from '#shared/constants.js';
import { upgradeCost } from '#shared/sim.js';

section('Towers are coherent');
{
  eq(TOWER_ORDER.length, Object.keys(TOWERS).length, 'the shop lists every tower');
  for (const id of TOWER_ORDER) {
    const tower = TOWERS[id];
    ok(Boolean(tower), `${id} exists`);
    eq(tower.levels.length, 3, `${id} has three levels`);

    let damageClimbs = true;
    let rangeHolds = true;
    let rateHolds = true;
    for (let i = 1; i < tower.levels.length; i++) {
      if (tower.levels[i].damage <= tower.levels[i - 1].damage) damageClimbs = false;
      if (tower.levels[i].range < tower.levels[i - 1].range) rangeHolds = false;
      if (tower.levels[i].fireRate > tower.levels[i - 1].fireRate) rateHolds = false;
    }
    ok(damageClimbs, `${id} hits harder every level`);
    ok(rangeHolds, `${id} never loses range on upgrade`);
    ok(rateHolds, `${id} never fires slower on upgrade`);
    ok(tower.cost > 0 && tower.heatPerShot > 0 && tower.coolRate > 0, `${id} has sane costs and heat`);
    ok(upgradeCost(id, 2) > upgradeCost(id, 1), `${id} upgrades get more expensive`);
  }
  ok(TOWERS.pulse.cost <= START_CREDITS, 'the opening budget affords the starter tower');
}

section('Heat separates the cheap towers from the heavy ones');
{
  const sustained = (id, level) => TOWERS[id].heatPerShot / TOWERS[id].levels[level].fireRate;
  const net = (id, level) => sustained(id, level) - TOWERS[id].coolRate;

  ok(net('cryo', 0) < 0 && net('cryo', 2) < 0, 'Cryo Vent never overheats on its own — it is the reliable one');
  ok(net('pulse', 0) < 0, 'a level 1 Pulse Node runs cool');
  ok(net('pulse', 2) > 0, 'but a fully upgraded one runs warm');
  ok(net('rail', 0) > 0, 'Rail Cannon runs hot from the start');
  ok(net('laser', 0) > 0, 'Laser Grid runs hot from the start');

  const boosted = (id, level) => sustained(id, level) * OVERCLOCK.fireRateScale * OVERCLOCK.heatScale;
  for (const id of TOWER_ORDER) {
    ok(boosted(id, 0) > TOWERS[id].coolRate, `overclocking ${id} outruns its cooling`);
  }
  ok(HEAT_RESET < HEAT_MAX, 'a shut-down tower has something to cool back to');
  ok(OVERCLOCK.cooldown > OVERCLOCK.seconds, 'overclock cannot be held permanently');
}

section('Packets are coherent');
{
  for (const [id, packet] of Object.entries(PACKETS)) {
    ok(packet.hp > 0 && packet.speed > 0, `${id} has sane hp and speed`);
    ok(packet.bounty > 0 && packet.damage > 0, `${id} pays out and hurts`);
    ok(packet.armor >= 0, `${id} has non-negative armour`);
  }
  const toughest = Math.max(...Object.values(PACKETS).map((p) => p.armor));
  ok(MIN_DAMAGE > 0 && toughest > 0, 'armour exists but a hit always lands for something');
  ok(PACKETS.root.boss === true, 'the Root Kit is flagged as a boss');
  ok(PACKETS.worm.speed > PACKETS.byte.speed, 'Worms outrun Bytes');
  ok(PACKETS.daemon.armor > PACKETS.bit.armor, 'Daemons are better armoured than Bits');
}

section('The campaign ramps');
{
  eq(WAVES.length, 25, 'there are 25 waves');

  let typesKnown = true;
  let shapesValid = true;
  let scalesValid = true;
  for (const wave of WAVES) {
    if (!(wave.hpScale > 0)) scalesValid = false;
    for (const group of wave.groups) {
      if (!PACKETS[group.type]) typesKnown = false;
      if (!(group.count > 0) || !(group.gap > 0)) shapesValid = false;
    }
  }
  ok(scalesValid, 'every wave has a positive hp scale');
  ok(typesKnown, 'every wave only spawns packets that exist');
  ok(shapesValid, 'every group has a positive count and gap');

  const effort = WAVES.map((wave) => wave.groups.reduce(
    (total, group) => total + group.count * PACKETS[group.type].hp * wave.hpScale, 0,
  ));
  ok(effort[24] > effort[0] * 40, 'the last wave dwarfs the first', `${Math.round(effort[0])} -> ${Math.round(effort[24])}`);

  const firstThird = effort.slice(0, 8).reduce((a, b) => a + b, 0);
  const lastThird = effort.slice(17).reduce((a, b) => a + b, 0);
  ok(lastThird > firstThird * 5, 'the back half is far heavier than the opening');

  const bossWaves = WAVES.map((wave, i) => (wave.boss ? i + 1 : 0)).filter(Boolean);
  ok(bossWaves.length === 3, 'there are three boss waves', bossWaves.join(', '));
  for (const number of bossWaves) {
    ok(WAVES[number - 1].groups.some((group) => PACKETS[group.type].boss), `wave ${number} actually contains a boss`);
  }
  ok(WAVES[WAVES.length - 1].final === true, 'the last wave is flagged as the finale');
}

report();

// M6 — the storm: a table-driven state machine of ten phases, each new circle
// inside the last, damage once a second outside the eye (shields first), and
// the next circle revealed during each wait. Done when an AFK player reliably
// dies on schedule and the map knows the incoming circle.
import { ok, eq, near, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { STORM_PHASES, STORM_START_RADIUS, planStorm, stormAt, stormLength, outsideStorm } from '../shared/storm.js';
import { getWorld } from '../shared/worldgen.js';
import { TICK_HZ, WORLD_SIZE } from '../shared/constants.js';
import { MODE_DEAD } from '../shared/movement.js';

section('The table');
{
  eq(STORM_PHASES.length, 10, 'ten phases');
  eq(STORM_PHASES.map((p) => p.dps).join(','), '1,1,2,5,5,5,10,10,10,10', 'damage per second climbs 1 → 2 → 5 → 10');
  eq(STORM_PHASES[0].wait, 180, 'phase 1 waits three minutes…');
  eq(STORM_PHASES[0].shrink, 180, '…and shrinks for three');
  ok(STORM_PHASES.slice(3, 6).every((p, i) => p.wait === [60, 45, 30][i]), 'phases 4–6 wait 60 → 30 s');
  ok(STORM_PHASES.slice(6).every((p) => p.wait <= 30 && p.wait >= 10), 'phases 7+ wait 30 → 10 s');
  ok(STORM_PHASES.slice(0, 9).every((p) => p.ratio === 0.55), 'each circle is 0.55 of the one before');
  eq(STORM_PHASES[9].ratio, 0, 'and the last closes to nothing');
  ok(STORM_START_RADIUS * STORM_START_RADIUS * 2 >= (WORLD_SIZE / 2) ** 2 * 2, 'the first circle covers the whole map, corners included');
  ok(stormLength() > 1100 && stormLength() < 1300, `a full storm lasts about twenty minutes (${Math.round(stormLength() / 60)} min)`);
}

section('Circles');
{
  const world = getWorld();
  const land = (x, z) => world.terrain.heightAt(x, z) > 2;
  let nested = true, onLand = 0, total = 0, moved = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const plan = planStorm(seed, land);
    for (let k = 1; k < plan.circles.length; k++) {
      const a = plan.circles[k - 1], b = plan.circles[k];
      if (Math.hypot(b.x - a.x, b.z - a.z) + b.r > a.r + 1e-6) nested = false;
      total++;
      if (land(b.x, b.z)) onLand++;
      if (Math.hypot(b.x - a.x, b.z - a.z) > 1) moved++;
    }
  }
  ok(nested, 'every next circle lies wholly inside the current one (60 storms)');
  ok(onLand / total > 0.97, `circle centres land on the island (${onLand}/${total})`);
  ok(moved / total > 0.9, 'and the eye really does wander');
  const p1 = planStorm(1, land), p2 = planStorm(2, land);
  ok(p1.circles[3].x !== p2.circles[3].x, 'different matches get different storms');
  const plan = planStorm(5, land);
  const w = stormAt(plan, 60);
  ok(w.state === 'wait' && w.phase === 1 && w.r === plan.circles[0].r, 'a minute in: phase 1, waiting, eye at full size');
  eq(w.next, plan.circles[1], '…with the next circle already known (the map shows it)');
  const mid = stormAt(plan, 270);
  ok(mid.state === 'shrink' && Math.abs(mid.r - (plan.circles[0].r + plan.circles[1].r) / 2) < 1, 'halfway through the shrink, halfway between the two circles');
  eq(stormAt(plan, stormLength() + 5).r, 0, 'at the very end there is no safe place left');
}

section('Damage');
{
  const m = new Match({ mode: 'test', loot: false });
  const p = m.addPlayer({ name: 'outside', bot: true });
  p.botInput = null;
  m.placeOnGround(p, 2560, 2560);
  p.shield = 12;
  m.startStorm(m.tick, [{ wait: 1, shrink: 1, dps: 5, ratio: 0.0001 }, { wait: 100, shrink: 1, dps: 5, ratio: 0 }]);
  // Move the player out of the tiny eye.
  const eye = m.stormPlan.circles[1];
  m.placeOnGround(p, eye.x + 300, eye.z);
  for (let i = 0; i < 5 * TICK_HZ + 1; i++) m.step();
  // Out from t = 2 s: four ticks of 5 = 20 → 12 from the shield, 8 from health.
  ok(p.shield === 0 && p.hp === 92, `storm damage eats shields first, then health (${p.shield} shield, ${p.hp} HP)`);
  const hp = p.hp;
  for (let i = 0; i < TICK_HZ; i++) m.step();
  eq(hp - p.hp, 5, 'one tick of damage per second, at the phase rate');
}

section('Done when: an AFK player dies on schedule');
{
  const m = new Match({ mode: 'test', loot: false, rngSeed: 31337 });
  const spots = [[700, 2560], [2560, 900], [4200, 3800], [2500, 2600]];
  const afk = spots.map(([x, z], i) => {
    const p = m.addPlayer({ name: `afk${i}`, bot: true });
    p.botInput = null;
    m.placeOnGround(p, x, z);
    return p;
  });
  // A late spot: right where the final circle closes.
  const last = m.addPlayer({ name: 'afk-center', bot: true });
  last.botInput = null;
  m.startStorm(m.tick);
  const plan = m.stormPlan;
  const end = plan.circles[plan.circles.length - 1];
  m.placeOnGround(last, end.x, end.z);
  afk.push(last);
  // Predict each death by replaying the storm second by second.
  const predicted = afk.map((p) => {
    let hp = 100, shield = 0;
    for (let t = 1; t < 5000; t++) {
      const s = stormAt(plan, t);
      if (!outsideStorm(s, p.move.x, p.move.z)) continue;
      const soak = Math.min(shield, s.dps); shield -= soak; hp -= s.dps - soak;
      if (hp <= 0) return t;
    }
    return Infinity;
  });
  const died = afk.map(() => null);
  const start = m.tick;
  while (died.some((d) => d === null) && m.tick - start < (stormLength() + 120) * TICK_HZ) {
    m.step();
    afk.forEach((p, i) => { if (died[i] === null && !p.alive) died[i] = (m.tick - start) / TICK_HZ; });
  }
  ok(died.every((d) => d !== null), 'every AFK player dies — nobody outlasts the storm');
  afk.forEach((p, i) => near(died[i], predicted[i], 1.01, `${p.name} dies at ${fmt(died[i])} (predicted ${fmt(predicted[i])})`));
  ok(afk.every((p) => p.move.mode === MODE_DEAD), 'they are dead, not knocked');
  const msg = m.stormMessage();
  ok(msg.circles.length <= msg.phase + 1, 'clients are only told the circles up to the next one');
}

function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; }

report();

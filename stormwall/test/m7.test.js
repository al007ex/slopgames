// M7 — match flow: lobby fills to 100, a minute on the pre-game island (no
// damage, everything wiped at launch), the Drop Blimp on a random line, skydive
// and glider, then land, loot, fight and storm until one is left. Done when a
// hundred bots play a whole match, start to finish, with nobody touching it.
import { ok, eq, near, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { MODE_BUS, MODE_WALK, MODE_DEAD, MODE_SKYDIVE, MODE_GLIDE } from '../shared/movement.js';
import { PREGAME } from '../shared/worldgen.js';
import { stormLength } from '../shared/storm.js';
import { TICK_HZ, MAX_PLAYERS } from '../shared/constants.js';
import { BUS_ALTITUDE, BUS_SPEED } from '../server/flow.js';
import { isWeapon } from '../shared/items.js';

section('No two systems fight over a method name');
{
  const mods = await Promise.all(['replication', 'structures', 'harvest', 'building', 'combat', 'loot', 'storm', 'flow', 'bots'].map((n) => import(`../server/${n}.js`)));
  const seen = new Map();
  const clashes = [];
  for (const m of mods) for (const [k, v] of Object.entries(m)) if (k.endsWith('Methods')) for (const name of Object.keys(v)) { if (seen.has(name)) clashes.push(`${name} (${seen.get(name)} / ${k})`); seen.set(name, k); }
  eq(clashes.join(', '), '', `the match's ${seen.size} mixed-in methods are all distinct`);
}

section('The pre-game island');
{
  const m = new Match({ mode: 'solo', flow: { pregameSeconds: 3 } });
  eq(m.phase, 'pregame', 'a match starts in the pre-game');
  const a = m.addPlayer({ name: 'early', bot: true, team: m.nextTeam() });
  a.botInput = null;
  m.joinPregame(a);
  ok(Math.hypot(a.move.x - PREGAME.x, a.move.z - PREGAME.z) < PREGAME.r, 'players wait on the island off the coast');
  const guns = [...m.items.values()].filter((it) => isWeapon(it.key) && Math.hypot(it.x - PREGAME.x, it.z - PREGAME.z) < PREGAME.r);
  ok(guns.length >= 10, `throwaway guns are lying around (${guns.length})`);
  m.damage(a, 50, { kind: 'gun', source: a });
  m.step();
  eq(a.hp, 100, 'nothing does damage on the pre-game island');
  a.mats = [200, 0, 0];
  m.giveItem(a, { key: 'ar', rarity: 2 });
  for (let i = 0; i < 3 * TICK_HZ + 2; i++) m.step();
  eq(m.phase, 'bus', 'after the countdown, the blimp launches');
  eq(m.players.size, MAX_PLAYERS, `the lobby is filled to ${MAX_PLAYERS} with bots`);
  ok(a.inv.every((s) => !s) && a.mats[0] === 0, 'everything you picked up on the island vanished');
  ok(![...m.items.values()].some((it) => Math.hypot(it.x - PREGAME.x, it.z - PREGAME.z) < PREGAME.r), '…and so did everything lying there');
  ok([...m.players.values()].every((p) => p.move.mode === MODE_BUS), 'everyone is on the blimp');
  const r = m.route;
  near(r.y, BUS_ALTITUDE, 0.01, `the blimp flies at a fixed ${BUS_ALTITUDE} m`);
  ok(r.length > 4000, `on a straight line right across the island (${Math.round(r.length)} m)`);
  const b0 = m.busPosition(), b1 = m.busPosition(m.tick + TICK_HZ);
  near(Math.hypot(b1.x - b0.x, b1.z - b0.z), BUS_SPEED, 0.5, `at a fixed ${BUS_SPEED} m/s`);
  ok(m.stormPlan && m.stormStart === r.start, 'the storm clock starts when the blimp launches');
  const m2 = new Match({ mode: 'solo', flow: { pregameSeconds: 0 }, loot: false });
  m2.step(); m2.step();
  ok(Math.abs(Math.atan2(m2.route.z1 - m2.route.z0, m2.route.x1 - m2.route.x0) - Math.atan2(r.z1 - r.z0, r.x1 - r.x0)) > 0.01, 'every match flies a different line');
}

section('Done when: 100 bots play a full match end to end');
{
  const started = performance.now();
  const m = new Match({ mode: 'solo', flow: { pregameSeconds: 5 }, rngSeed: 4242 });
  const stats = { jumped: 0, landed: 0, armed: new Set(), chests: 0, built: 0, causes: {}, firstKill: null, phases: {} };
  const landedAt = new Map();
  const armedAt = new Map();
  let lastPhase = m.phase;
  let tickMs = 0, ticks = 0, worst = 0;
  const limit = (5 + 120 + stormLength() + 120) * TICK_HZ;
  const origElim = m.eliminate.bind(m);
  m.eliminate = (p, d) => {
    stats.causes[d.kind || '?'] = (stats.causes[d.kind || '?'] || 0) + 1;
    if (d.source && d.source !== p && stats.firstKill === null) stats.firstKill = m.tick;
    origElim(p, d);
  };
  while (!m.finished && m.tick < limit) {
    const t0 = performance.now();
    m.step();
    const dt = performance.now() - t0;
    if (m.phase !== 'pregame') { tickMs += dt; ticks++; worst = Math.max(worst, dt); }
    if (m.phase !== lastPhase) { stats.phases[m.phase] = m.tick; lastPhase = m.phase; }
    if (m.tick % 30 === 0) {
      for (const p of m.players.values()) {
        if (p.jumpedAt && !landedAt.has(p.id) && p.move.mode === MODE_WALK) landedAt.set(p.id, m.tick - p.jumpedAt);
        if (p.inv.some((s) => s && isWeapon(s.key))) { stats.armed.add(p.id); if (!armedAt.has(p.id) && landedAt.has(p.id)) armedAt.set(p.id, m.tick - p.jumpedAt - landedAt.get(p.id)); }
      }
    }
  }
  const seconds = (performance.now() - started) / 1000;
  const players = [...m.players.values()];
  eq(players.length, 100, 'a hundred players took part');
  ok(players.every((p) => p.jumpedAt), 'every one of them left the blimp');
  ok(stats.phases.playing - stats.phases.bus < 90 * TICK_HZ, `the blimp crossing took ${((stats.phases.playing - stats.phases.bus) / TICK_HZ).toFixed(0)} s`);
  const landTimes = [...landedAt.values()].sort((a, b) => a - b);
  ok(landTimes.length >= 95, `${landTimes.length} landed on their feet`);
  ok(landTimes[Math.floor(landTimes.length / 2)] < 70 * TICK_HZ, `median time from jump to landing ${(landTimes[Math.floor(landTimes.length / 2)] / TICK_HZ).toFixed(0)} s`);
  const toGun = [...armedAt.values()].sort((a, b) => a - b);
  ok(stats.armed.size >= 45, `${stats.armed.size} found a weapon (most of the rest lost a hot drop to someone who found one first)`);
  ok(toGun[Math.floor(toGun.length / 2)] < 30 * TICK_HZ, `looting is quick: a median ${(toGun[Math.floor(toGun.length / 2)] / TICK_HZ).toFixed(0)} s from landing to a gun`);
  const opened = [...m.chests.values()].filter((c) => c.open && !c.box).length;
  ok(opened >= 20, `${opened} chests were opened`);
  const built = [...m.world.pieces.values()].filter((p) => p.team !== 0).length + (m.builtRemoved || 0);
  const gunKills = (stats.causes.gun || 0) + (stats.causes.explosion || 0) + (stats.causes.pickaxe || 0);
  ok(gunKills >= 25, `they fought: ${gunKills} eliminations by other players (${JSON.stringify(stats.causes)})`);
  ok(stats.firstKill !== null && stats.firstKill - stats.phases.playing < 240 * TICK_HZ, `first blood ${((stats.firstKill - stats.phases.bus) / TICK_HZ).toFixed(0)} s after launch`);
  eq(m.phase, 'ended', 'the match reached its end without anyone stepping in');
  const winners = players.filter((p) => p.placement === 1);
  eq(winners.length, 1, `one winner: ${winners[0]?.name} (${winners[0]?.kills} eliminations)`);
  const places = players.map((p) => p.placement).sort((a, b) => a - b);
  eq(places.join(','), Array.from({ length: 100 }, (_, i) => i + 1).join(','), 'every player has a distinct placement, 1 to 100');
  ok(players.filter((p) => p.placement !== 1).every((p) => !p.alive && p.move.mode === MODE_DEAD), 'everyone but the winner is dead');
  const length = ((m.endTick - stats.phases.bus) / TICK_HZ / 60).toFixed(1);
  ok(m.endTick - stats.phases.bus <= (stormLength() + 30) * TICK_HZ, `the match lasted ${length} minutes from launch (the storm takes ${(stormLength() / 60).toFixed(1)})`);
  const avg = tickMs / ticks;
  ok(avg < 8, `a tick with 100 bots averaged ${avg.toFixed(2)} ms (worst ${worst.toFixed(1)} ms) — ${seconds.toFixed(0)} s to simulate`);
  void MODE_BUS; void MODE_SKYDIVE; void MODE_GLIDE; void built;
}

report();

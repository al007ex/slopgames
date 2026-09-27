// M9 — duos and squads: teams of two and four, friendly fire off, knocked-
// not-killed with a forty-second bleed-out, ten-second revives at low health,
// team status and pings, and the last knock finishing a team. Done when a
// squad wins a match together.
import { ok, eq, near, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { DBNO_HP, BLEED_SECONDS, REVIVE_SECONDS, REVIVE_HP } from '../server/teams.js';
import { INTERACT_REVIVE } from '../server/loot.js';
import { A_INTERACT, A_PING, A_PLACE } from '../shared/protocol.js';
import { MODE_DBNO, MODE_DEAD, MODE_WALK, BTN_USE, BTN_FIRE, BTN_SPRINT, CRAWL_SPEED } from '../shared/movement.js';
import { WALL } from '../shared/pieces.js';
import { buildTarget } from '../shared/build.js';
import { TICK_HZ } from '../shared/constants.js';
import { EQUIP_TICKS } from '../server/combat.js';

function fakeConn(name) {
  const conn = { name, inbox: [], ready: true, known: null, spectating: 0, sendJson(m) { conn.inbox.push(m); }, send() {}, backlogged: () => false };
  conn.of = (t) => conn.inbox.filter((m) => m.t === t);
  return conn;
}

/** A small duos or squads match on the ground: two teams, next to each other. */
function teamMatch(mode, perTeam = mode === 'duos' ? 2 : 4) {
  const m = new Match({ mode, flow: { pregameSeconds: 0.2, fillTo: perTeam * 2 }, loot: false, rngSeed: 11 });
  const ps = [];
  for (let i = 0; i < perTeam * 2; i++) {
    const p = m.addPlayer({ name: `p${i}`, team: m.nextTeam() });
    p.bot = true; p.botInput = null;
    const c = fakeConn(p.name); p.conn = c; c.player = p; m.conns.add(c);
    ps.push(p);
  }
  for (let i = 0; i < 10; i++) m.step();
  ps.forEach((p, i) => { m.placeOnGround(p, 2400 + i * 3, 2400 + (p.team - 1) * 30); p.move.mode = MODE_WALK; });
  m.step(); m.step();
  return { m, ps, teamA: ps.filter((p) => p.team === 1), teamB: ps.filter((p) => p.team === 2) };
}

section('Teams');
{
  const d = teamMatch('duos');
  eq(d.teamA.length, 2, 'duos: teams of two');
  const s = teamMatch('squads');
  eq(s.teamA.length, 4, 'squads: teams of four');
  const [a1, a2] = s.teamA;
  s.m.damage(a2, 50, { source: a1, kind: 'gun', weapon: 'ar' });
  s.m.step();
  eq(a2.hp, 100, 'friendly fire is off');
}

section('Knocked, not killed');
{
  const { m, teamA, teamB } = teamMatch('duos');
  const [a1] = teamA;
  const [b1] = teamB;
  m.giveItem(a1, { key: 'ar', rarity: 1 }); a1.ammo.medium = 60;
  m.damage(a1, 150, { source: b1, kind: 'gun', weapon: 'ar' });
  m.step();
  ok(a1.alive && a1.dbno, 'lethal damage with a teammate still up knocks you down');
  eq(a1.move.mode, MODE_DBNO, 'you are crawling');
  near(a1.dbnoHp, DBNO_HP, 3, `with ${DBNO_HP} knocked health`);
  ok(teamA[0].conn.of('feed').at(-1)?.knocked, 'the feed says knocked, not eliminated');
  // Crawl only.
  a1.botInput = { mz: 1, mx: 0, yaw: 0, pitch: 0, buttons: BTN_SPRINT };
  const x0 = a1.move.x, z0 = a1.move.z;
  for (let i = 0; i < TICK_HZ; i++) m.step();
  near(Math.hypot(a1.move.x - x0, a1.move.z - z0), CRAWL_SPEED, 0.3, `you can only crawl (${CRAWL_SPEED} m/s)`);
  a1.botInput = { mz: 0, mx: 0, yaw: 0, pitch: 0, buttons: BTN_FIRE };
  m.selectSlot(a1, 1);
  const shotsBefore = a1.shots;
  for (let i = 0; i < EQUIP_TICKS + 10; i++) m.step();
  eq(a1.shots, shotsBefore, 'and you cannot shoot');
  a1.mats = [100, 0, 0];
  const t = buildTarget(WALL, a1.move, 0, 0, m.world, {});
  const before = m.world.nextPieceId;
  m.onAction(a1, { type: A_PLACE, piece: WALL, rot: t.rot, cx: t.cx, lv: t.lv, cz: t.cz });
  m.step();
  eq(m.world.nextPieceId, before, 'or build');
  a1.botInput = null;
  // Bleed out.
  const knockedAt = m.tick;
  while (a1.alive && m.tick - knockedAt < (BLEED_SECONDS + 5) * TICK_HZ) m.step();
  ok(!a1.alive && a1.move.mode === MODE_DEAD, 'left alone, you bleed out');
  near((m.tick - knockedAt) / TICK_HZ, BLEED_SECONDS - 1, 1.5, `…in about ${BLEED_SECONDS} seconds`);
  eq(b1.kills, 1, 'and the knock gets the elimination');
}

section('Revives');
{
  const { m, teamA, teamB } = teamMatch('squads');
  const [a1, a2] = teamA;
  const [b1] = teamB;
  m.damage(a1, 200, { source: b1, kind: 'gun' });
  m.step();
  a2.move.x = a1.move.x + 1.2; a2.move.z = a1.move.z;
  m.onAction(a2, { type: A_INTERACT, kind: INTERACT_REVIVE, id: a1.id });
  a2.botInput = { mz: 0, mx: 0, yaw: 0, pitch: 0, buttons: BTN_USE };
  ok(a2.reviving, 'a teammate holding interact beside you starts reviving');
  for (let i = 0; i < (REVIVE_SECONDS - 1) * TICK_HZ; i++) m.step();
  ok(a1.dbno, 'nine seconds in, still down');
  for (let i = 0; i < TICK_HZ + 2; i++) m.step();
  ok(!a1.dbno && a1.alive && a1.move.mode === MODE_WALK, `after ${REVIVE_SECONDS} seconds you are back up`);
  eq(a1.hp, REVIVE_HP, `…on ${REVIVE_HP} health`);
  // Interrupted revive.
  m.damage(a1, 200, { source: b1, kind: 'gun' });
  m.step();
  m.onAction(a2, { type: A_INTERACT, kind: INTERACT_REVIVE, id: a1.id });
  for (let i = 0; i < 3 * TICK_HZ; i++) m.step();
  a2.botInput = { mz: 0, mx: 0, yaw: 0, pitch: 0, buttons: 0 };
  m.step();
  ok(!a2.reviving && a1.dbno, 'letting go of interact cancels the revive');
  // An enemy can finish you while you are down.
  m.damage(a1, 120, { source: b1, kind: 'gun', weapon: 'ar' });
  m.step();
  ok(!a1.alive, 'an enemy can finish off a knocked player');
  eq(b1.kills, 1, '…and gets the elimination');
}

section('The last knock finishes the team');
{
  const { m, teamA, teamB } = teamMatch('duos');
  const [a1, a2] = teamA;
  const [b1] = teamB;
  m.damage(a1, 200, { source: b1, kind: 'gun' });
  m.step();
  ok(a1.dbno, 'first teammate knocked');
  m.damage(a2, 200, { source: b1, kind: 'gun' });
  m.step();
  ok(!a1.alive && !a2.alive, 'knocking the last one standing eliminates the whole team');
  eq(a1.placement, 2, 'the team places 2nd');
  m.step();
  eq(m.phase, 'ended', 'and with one team left, the match is over');
  ok(teamB.every((p) => p.placement === 1), 'the other team wins together');
}

section('Team status and pings');
{
  const { m, teamA, teamB } = teamMatch('squads');
  for (let i = 0; i < 16; i++) m.step();
  const status = teamA[0].conn.of('team').at(-1);
  eq(status?.members.length, 4, 'you get your whole squad\'s status');
  ok(status.members.every((q) => teamA.some((a) => a.id === q.id)), '…and only your squad\'s');
  ok(status.members.every((q) => typeof q.hp === 'number' && typeof q.x === 'number'), 'with health and position for the HUD and map');
  m.onAction(teamA[0], { type: A_PING, x: 2500, y: 10, z: 2500 });
  ok(teamA.every((p) => p.conn.of('ping').length === 1), 'a ping reaches every teammate');
  ok(teamB.every((p) => p.conn.of('ping').length === 0), '…and no enemy');
}

section('Done when: a squad wins a match together');
{
  const m = new Match({ mode: 'squads', flow: { pregameSeconds: 2 }, rngSeed: 777 });
  let knocks = 0, revived = 0;
  const origKnock = m.knock.bind(m);
  m.knock = (p, d) => { knocks++; origKnock(p, d); };
  const origRevive = m.progressRevive.bind(m);
  m.progressRevive = (p) => { const t = p.reviving.target; origRevive(p); if (t.alive && !t.dbno) revived++; };
  const limit = 30 * 60 * TICK_HZ;
  while (!m.finished && m.tick < limit) m.step();
  const players = [...m.players.values()];
  eq(players.length, 100, '25 squads of four took part');
  eq(m.phase, 'ended', 'the match ran to its end');
  const winners = players.filter((p) => p.placement === 1);
  ok(winners.length === 4 && new Set(winners.map((p) => p.team)).size === 1, `one squad won together (${winners.map((p) => p.name).join(', ')})`);
  ok(winners.some((p) => p.alive), '…with at least one of them still standing');
  const places = [...new Set(players.map((p) => `${p.team}:${p.placement}`))].map((s) => Number(s.split(':')[1])).sort((a, b) => a - b);
  eq(places.join(','), Array.from({ length: 25 }, (_, i) => i + 1).join(','), 'every squad has its own placement, 1 to 25');
  ok(knocks > 20, `players were knocked rather than killed (${knocks} knocks)`);
  ok(revived > 0, `and squadmates picked each other up (${revived} revives)`);
}

report();

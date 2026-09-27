// M8 — death, feedback, scoreboard: an eliminated player drops everything
// (materials up to a cap) in a pile, everyone sees the kill feed and the
// players-remaining count, and each player gets their placement, eliminations
// and damage at the end. No respawns.
import { ok, eq, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { DROP_MAT_CAP } from '../server/loot.js';
import { MODE_DEAD, MODE_WALK } from '../shared/movement.js';
import { TICK_HZ } from '../shared/constants.js';
import { isWeapon } from '../shared/items.js';

function fakeConn(name) {
  const conn = { name, inbox: [], ready: true, known: null, spectating: 0, sendJson(m) { conn.inbox.push(m); }, send() {}, backlogged: () => false };
  conn.of = (t) => conn.inbox.filter((m) => m.t === t);
  return conn;
}

/** A four-player solo match, already on the ground in a square 20 m apart. */
function smallMatch() {
  const m = new Match({ mode: 'solo', flow: { pregameSeconds: 0.2, fillTo: 4 }, loot: false, rngSeed: 5 });
  const names = ['ana', 'ben', 'cy', 'dee'];
  const ps = names.map((name, i) => {
    const p = m.addPlayer({ name, team: m.nextTeam() });
    p.bot = true; p.botInput = null;
    if (i < 2) { const c = fakeConn(name); p.conn = c; c.player = p; m.conns.add(c); }
    return p;
  });
  for (let i = 0; i < 10; i++) m.step();                 // launch
  ps.forEach((p, i) => { m.placeOnGround(p, 2400 + (i % 2) * 20, 2400 + Math.floor(i / 2) * 20); p.move.mode = MODE_WALK; });
  m.step(); m.step();
  return { m, ps };
}

section('Eliminated players drop everything');
{
  const { m, ps } = smallMatch();
  const [ana, ben] = ps;
  eq(m.phase, 'playing', 'the match is under way');
  m.giveItem(ben, { key: 'pump', rarity: 2 });
  m.giveItem(ben, { key: 'ar', rarity: 1 });
  m.giveItem(ben, { key: 'bandage', count: 6 });
  ben.ammo.medium = 120; ben.ammo.heavy = 18;
  ben.mats = [800, 90, 0];
  const where = { x: ben.move.x, z: ben.move.z };
  m.damage(ben, 250, { source: ana, kind: 'gun', weapon: 'ar' });
  m.step();
  ok(!ben.alive && ben.move.mode === MODE_DEAD, 'ben is eliminated');
  const pile = [...m.items.values()].filter((it) => Math.hypot(it.x - where.x, it.z - where.z) < 3);
  eq(pile.filter((it) => isWeapon(it.key)).map((it) => it.key).sort().join(','), 'ar,pump', 'both his guns are in the pile');
  ok(pile.some((it) => it.key === 'bandage' && it.count === 6), 'so are his bandages');
  ok(pile.some((it) => it.key === 'medium' && it.count === 120) && pile.some((it) => it.key === 'heavy' && it.count === 18), 'and all of his ammo');
  eq(pile.find((it) => it.key === 'wood')?.count, DROP_MAT_CAP, `materials are capped: 800 wood drops as ${DROP_MAT_CAP}`);
  eq(pile.find((it) => it.key === 'stone')?.count, 90, '…below the cap, everything drops');
  ok(ben.inv.every((s) => !s) && ben.mats.every((n) => n === 0), 'and he keeps nothing');
}

section('Kill feed, callouts and the players-left counter');
{
  const { m, ps } = smallMatch();
  const [ana, ben, cy] = ps;
  m.damage(cy, 300, { source: ana, kind: 'gun', weapon: 'pump', head: true });
  m.step();
  for (const conn of [ana.conn, ben.conn]) {
    const feed = conn.of('feed').at(-1);
    ok(feed && feed.killer === ana.id && feed.victim === cy.id && feed.weapon === 'pump' && feed.head, `${conn.name} sees "ana ✦ pump cy" in the feed`);
  }
  eq(ana.kills, 1, 'the elimination is credited to ana');
  const alive = ana.conn.of('alive').at(-1);
  eq(alive?.players, 3, 'everyone is told there are 3 players left');
  m.damage(ben, 30, { kind: 'fall' });
  m.damage(ben, 200, { kind: 'storm' });
  m.step();
  const f2 = ana.conn.of('feed').at(-1);
  ok(f2.victim === ben.id && f2.cause === 'storm' && !f2.killer, 'deaths without a killer say how (storm)');
}

section('Results and no second chances');
{
  const { m, ps } = smallMatch();
  const [ana, ben, cy, dee] = ps;
  m.damage(ben, 40, { source: ana, kind: 'gun', weapon: 'ar' });
  m.step();
  m.damage(ben, 300, { source: cy, kind: 'gun', weapon: 'smg' });
  m.step();
  const res = ben.conn.of('results').at(-1);
  ok(res, 'ben gets his results as soon as he is out');
  eq(res.placement, 4, '…placed 4th of 4');
  eq(res.killer, 'cy', '…eliminated by cy');
  eq(res.damage, 0, '…having dealt no damage');
  m.damage(dee, 300, { source: ana, kind: 'gun', weapon: 'ar' });
  m.step();
  eq(dee.placement, 3, 'dee places 3rd');
  m.damage(cy, 300, { source: ana, kind: 'gun', weapon: 'ar' });
  m.step(); m.step();
  eq(m.phase, 'ended', 'one left: the match ends');
  const win = ana.conn.of('results').at(-1);
  ok(win && win.victory && win.placement === 1, 'ana gets #1 VICTORY');
  eq(win.kills, 2, '…with 2 eliminations');
  eq(win.damage, 240, '…and 240 damage dealt (40 + 100 + 100: overkill does not count)');
  for (let i = 0; i < 10 * TICK_HZ; i++) m.step();
  ok(!ben.alive && ben.move.mode === MODE_DEAD, 'ten seconds later ben is still dead: no respawns');
  eq(cy.placement, 2, 'cy places 2nd');
  void isWeapon;
}

report();

// M12 — scale and hardening: interest management with a hundred players and
// thousands of builds, lag compensation, server-side validation of everything
// a client asks for, reconnection, a crashing match that does not take the
// others down, matchmaking queues and region routing.
import WebSocket from 'ws';
import { ok, eq, near, section, report } from './harness.js';
import { Match } from '../server/match.js';
import { Lobby } from '../server/lobby.js';
import { startServer } from '../server/index.js';
import { getWorld } from '../shared/worldgen.js';
import { positionAt } from '../server/player.js';
import { MAX_REWIND_TICKS, EQUIP_TICKS } from '../server/combat.js';
import { flatBase, standIn, YAW } from './util.js';
import { WALL, FLOOR } from '../shared/pieces.js';
import { A_PLACE, A_INTERACT, A_EDIT, Writer, encodeInput } from '../shared/protocol.js';
import { MODE_WALK, BTN_SPRINT, BTN_FIRE, SPRINT_SPEED } from '../shared/movement.js';
import { TICK_HZ, CELL, WALL_H } from '../shared/constants.js';
import { WEAPONS } from '../shared/items.js';

const fakeConn = (name) => {
  const conn = { name, inbox: [], ready: true, known: null, spectating: 0, sendJson(m) { conn.inbox.push(m); }, sent: [], send(b) { conn.sent.push(b.length); }, backlogged: () => false };
  return conn;
};

section('A hundred players and thousands of builds');
{
  const m = new Match({ mode: 'squads', flow: { pregameSeconds: 1 }, rngSeed: 3 });
  for (let i = 0; i < 40; i++) m.step();
  while (m.phase === 'bus') m.step();
  // Six thousand player-built pieces around the busiest spot: towers of walls and floors.
  const players = [...m.players.values()].filter((p) => p.alive);
  const centre = players[0].move;
  let built = 0;
  for (let t = 0; t < 2500 && built < 6000; t++) {
    const cx = Math.floor(centre.x / CELL) + (t % 50) * 2 - 50, cz = Math.floor(centre.z / CELL) + Math.floor(t / 50) * 2 - 50;
    const base = Math.floor(m.world.terrain.heightAt((cx + 0.5) * CELL, (cz + 0.5) * CELL) / WALL_H);
    for (let lv = base; lv < base + 6; lv++) {
      for (const [type, rot, dx, dz] of [[WALL, 0, 0, 0], [WALL, 0, 1, 0], [FLOOR, 0, 0, 0]]) {
        const piece = { id: m.world.nextPieceId++, type, rot, cx: cx + dx, lv: lv + (type === FLOOR ? 1 : 0), cz, mat: 0, edit: 0, start: -1, damage: 0, team: 99 };
        if (m.world.slots.get(((type === FLOOR ? 0 : 1) * 128 + piece.lv + 8) * 1024 * 1024 + piece.cx * 1024 + cz)) continue;
        m.world.addPiece(piece);
        m.touch('piece', piece);
        built++;
      }
    }
  }
  ok(built >= 5000, `${built} player-built pieces in one area`);
  const watcher = fakeConn('watcher');
  const eye = m.addPlayer({ name: 'watcher', bot: true });
  eye.botInput = null;
  m.placeOnGround(eye, centre.x, centre.z);
  eye.conn = watcher; watcher.player = eye; m.conns.add(watcher);
  const t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < 20 * TICK_HZ; i++) { const s = performance.now(); m.step(); worst = Math.max(worst, performance.now() - s); }
  const avg = (performance.now() - t0) / (20 * TICK_HZ);
  ok(avg < 10, `a tick with ${players.length} bots and ${m.world.pieces.size} pieces averages ${avg.toFixed(2)} ms (worst ${worst.toFixed(1)})`);
  const biggest = Math.max(...watcher.sent);
  ok(biggest < 64 * 1024, `the largest snapshot a client got was ${(biggest / 1024).toFixed(1)} KB (changes stream in over a few ticks)`);
  const steady = watcher.sent.slice(-60).reduce((a, b) => a + b, 0) / 60;
  ok(steady < 8 * 1024, `once caught up, snapshots average ${(steady / 1024).toFixed(1)} KB`);
}

section('Lag compensation');
{
  const m = new Match({ base: flatBase(), mode: 'test', loot: false });
  const p = standIn(m, 300, 300);
  p.botInput = { mz: 1, mx: 0, yaw: YAW.east, pitch: 0, buttons: BTN_SPRINT };
  for (let i = 0; i < 30; i++) m.step();
  const at5 = {}, at4 = {}, mid = {};
  positionAt(p, m.tick - 5, at5);
  positionAt(p, m.tick - 4, at4);
  positionAt(p, m.tick - 4.5, mid);
  near(p.move.x - at5.x, SPRINT_SPEED * 5 / TICK_HZ, 0.05, `the server remembers where a sprinting player was 5 ticks ago (${(p.move.x - at5.x).toFixed(2)} m back)`);
  near(mid.x, (at4.x + at5.x) / 2, 1e-4, 'and interpolates between ticks for view times in between');
  eq(MAX_REWIND_TICKS, 9, 'rewinds are capped at ~300 ms, so a laggy shooter cannot reach far into the past');
}

section('The server checks everything a client asks for');
{
  const m = new Match({ base: flatBase(), mode: 'test', loot: false });
  const cheat = m.addPlayer({ name: 'cheat' });
  m.placeOnGround(cheat, 400 * CELL, 400 * CELL);
  // Speedhack: three inputs every tick for ten seconds.
  const x0 = cheat.move.x;
  let seq = 0;
  for (let t = 0; t < 10 * TICK_HZ; t++) {
    for (let k = 0; k < 3; k++) m.queueInput(cheat, { seq: ++seq, mx: 0, mz: 1, yaw: YAW.east, pitch: 0, buttons: BTN_SPRINT, actions: [], viewTick: 0 });
    m.step();
  }
  const speed = (cheat.move.x - x0) / 10;
  ok(speed < SPRINT_SPEED * 1.05, `sending triple the inputs does not make you faster (${speed.toFixed(2)} m/s, sprint is ${SPRINT_SPEED})`);
  // Rate of fire.
  const shooter = standIn(m, 410, 410, { name: 'shooter' });
  const target = standIn(m, 410, 413, { name: 'target' });
  target.hp = 1e9;
  const slot = m.giveItem(shooter, { key: 'pistol', rarity: 0 });
  shooter.ammo.light = 500;
  m.selectSlot(shooter, slot + 1);
  for (let i = 0; i < EQUIP_TICKS + 1; i++) m.step();
  const shots0 = shooter.shots;
  for (let t = 0; t < TICK_HZ; t++) { shooter.buttons = t % 2 ? 0 : BTN_FIRE; m.step(); }
  ok(shooter.shots - shots0 <= Math.ceil(WEAPONS.pistol.rate) + 1, `mashing the trigger fires at most the weapon's rate (${shooter.shots - shots0} in a second, rate ${WEAPONS.pistol.rate})`);
  // Remote building, editing and looting.
  cheat.mats = [500, 500, 500];
  const before = m.world.nextPieceId;
  m.onAction(cheat, { type: A_PLACE, piece: WALL, rot: 0, cx: 900, lv: 3, cz: 900 });
  m.step();
  eq(m.world.nextPieceId, before, 'a wall 2 km away is refused');
  const far = m.dropItem({ key: 'ar', rarity: 4, mag: 30 }, cheat.move.x + 40, cheat.move.y, cheat.move.z);
  m.onAction(cheat, { type: A_INTERACT, kind: 1, id: far.id });
  ok(far.alive, 'a legendary 40 m away cannot be picked up');
  const enemyWall = m.world.addPiece({ id: m.world.nextPieceId++, type: WALL, rot: 0, cx: 402, lv: 3, cz: 400, mat: 0, edit: 0, start: -1, damage: 0, team: 555 });
  m.onAction(cheat, { type: A_EDIT, id: enemyWall.id, value: 16 });
  m.step();
  eq(enemyWall.edit, 0, "an enemy's wall cannot be edited open");
  eq(cheat.move.mode, MODE_WALK, 'and positions only ever come from the server’s own simulation');
}

section('Reconnection, crash isolation, queues and regions');
{
  const server = await startServer({ port: 0, log: null, maxPerIp: 50, pregameSeconds: 30, dataDir: null, maxMatches: 2 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const client = () => new Promise((resolve) => {
    const ws = new WebSocket(url);
    const c = { ws, inbox: [], wait: (t, ms = 4000) => new Promise((res, rej) => {
      const found = c.inbox.find((m) => m.t === t);
      if (found) return res(found);
      const timer = setTimeout(() => rej(new Error(`no ${t}`)), ms);
      c.waiters.push({ t, res: (m) => { clearTimeout(timer); res(m); } });
    }), waiters: [] };
    ws.on('message', (data, bin) => {
      if (bin) return;
      const m = JSON.parse(String(data));
      c.inbox.push(m);
      c.waiters = c.waiters.filter((w) => (w.t === m.t ? (w.res(m), false) : true));
    });
    ws.on('open', () => resolve(c));
  });
  // Reconnect.
  const a = await client();
  a.ws.send(JSON.stringify({ t: 'hello', name: 'Wanderer' }));
  const welcome = await a.wait('welcome');
  a.ws.send(JSON.stringify({ t: 'queue', mode: 'solo' }));
  const first = await a.wait('match');
  a.ws.terminate();
  await new Promise((r) => setTimeout(r, 400));
  const match = [...server.matches].find((mm) => mm.id === first.id);
  ok(match && match.players.has(first.you), 'after the tab closes, the character stays in the match');
  const b = await client();
  b.ws.send(JSON.stringify({ t: 'hello', name: 'Wanderer', id: welcome.account.id, token: welcome.account.token }));
  const again = await b.wait('match');
  await b.wait('resumed');
  ok(again.id === first.id && again.you === first.you, 'reconnecting with the same account puts you back in the same match, as the same player');
  // Queues: two matches allowed, so a third mode waits for a slot.
  const c2 = await client();
  c2.ws.send(JSON.stringify({ t: 'hello', name: 'Duo' }));
  await c2.wait('welcome');
  c2.ws.send(JSON.stringify({ t: 'queue', mode: 'duos' }));
  await c2.wait('match');
  const c3 = await client();
  c3.ws.send(JSON.stringify({ t: 'hello', name: 'Squaddie' }));
  await c3.wait('welcome');
  c3.ws.send(JSON.stringify({ t: 'queue', mode: 'squads' }));
  const q = await c3.wait('queue');
  ok(q.position === 1, 'with every match slot busy, the next player waits in a queue');
  // Crash isolation: the duos match starts throwing on every tick.
  const duos = [...server.matches].find((mm) => mm.mode === 'duos');
  duos.step = () => { throw new Error('boom'); };
  const kicked = await c2.wait('lobby', 3000);
  ok(/problem/.test(kicked.reason), 'a match that keeps failing is stopped and its players sent to the lobby');
  ok(!server.matches.has(duos), '…and removed');
  const soloTick = match.tick;
  await new Promise((r) => setTimeout(r, 300));
  ok(match.tick > soloTick, 'while the other match carries on ticking');
  const got = await c3.wait('match', 3000);
  ok(got.mode === 'squads', 'and the freed slot goes to the player who was waiting');
  // Regions.
  const regions = await (await fetch(`http://127.0.0.1:${server.port}/regions`)).json();
  ok(Array.isArray(regions.regions) && regions.regions.length >= 1 && regions.regions[0].name, `the server lists its region(s) for the client to pick from (${regions.regions.map((r) => r.name).join(', ')})`);
  for (const c of [b, c2, c3]) c.ws.terminate();
  await server.close();
  void Lobby; void getWorld; void Writer; void encodeInput;
}

report();

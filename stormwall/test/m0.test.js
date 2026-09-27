// M0 — foundations: deterministic world, collision, protocol, the fixed tick
// order, interest management, and a server holding 100 clients at a stable tick.
import WebSocket from 'ws';
import { ok, eq, near, section, report } from './harness.js';
import { generateWorld, getWorld } from '../shared/worldgen.js';
import { Rng, fbm } from '../shared/rng.js';
import { CollisionGrid, makeBox, makeCyl, capsulePenetration } from '../shared/collision.js';
import { Terrain, SIDE } from '../shared/terrain.js';
import {
  Writer, encodeInput, decodeClient, decodeSnapshot, A_PLACE, A_SLOT, quantizeYaw, C_INPUT,
} from '../shared/protocol.js';
import { Match, STAGES } from '../server/match.js';
import { startServer } from '../server/index.js';
import { TICK_HZ, WORLD_SIZE, CELL, GRID_N } from '../shared/constants.js';

section('Deterministic world');
{
  const a = generateWorld(1234);
  const b = generateWorld(1234);
  eq(a.hash, b.hash, 'the same seed generates the same world, bit for bit');
  ok(generateWorld(99).hash !== a.hash, 'a different seed generates a different world');
  const r1 = new Rng(7), r2 = new Rng(7);
  let same = true;
  for (let i = 0; i < 1000; i++) if (r1.next() !== r2.next()) same = false;
  ok(same, 'the seeded generator repeats exactly');
  eq(fbm(12.5, 99.25, 3), fbm(12.5, 99.25, 3), 'noise is a pure function');
  eq(WORLD_SIZE, 5120, 'the island is 5.12 km across');
  const w = getWorld();
  ok(w.pois.length === 20, 'twenty named places');
  ok(w.terrain.heightAt(2560, 2560) > 0, 'the middle of the island is land');
  ok(w.terrain.heightAt(60, 2560) < 0, 'the edge of the map is sea');
}

section('Collision');
{
  const heights = new Float32Array(SIDE * SIDE);
  const grid = new CollisionGrid(new Terrain(heights));
  const wall = makeBox(100, 2, 100, 0.1, 2, 2.5);
  grid.add(wall);
  const out = {};
  const d = capsulePenetration(99.7, 0.5, 100, 99.7, 1.5, 100, 0.42, wall, out);
  near(d, 0.22, 0.01, 'a capsule 0.3 m from a wall face overlaps it by 0.22 m');
  near(out.nx, -1, 0.01, '…and is pushed straight back out');
  ok(capsulePenetration(98, 0.5, 100, 98, 1.5, 100, 0.42, wall, out) <= 0, 'a capsule 2 m away does not touch');
  const tree = makeCyl(110, 110, 0, 8, 0.5);
  grid.add(tree);
  const hit = {};
  grid.raycast(90, 1, 100, 1, 0, 0, 100, hit);
  near(hit.t, 9.9, 0.01, 'a ray finds the wall face first');
  grid.raycast(100, 50, 110, 0, -1, 0, 100, hit);
  near(hit.t, 50, 0.01, 'a ray straight down finds flat ground');
  eq(hit.collider, null, '…and knows it hit terrain');
  grid.raycast(105, 1, 110, 1, 0, 0, 100, hit);
  near(hit.t, 4.5, 0.01, 'a ray finds a tree trunk');
  grid.remove(wall);
  grid.raycast(90, 1, 100, 1, 0, 0, 30, hit);
  ok(hit.t === Infinity, 'removed shapes no longer block rays');
  const found = grid.query(105, 0, 105, 115, 10, 115, []);
  eq(found.length, 1, 'area queries return each nearby shape once');
  eq(GRID_N * CELL, WORLD_SIZE, 'build grid and terrain grid are the same grid');
}

section('Protocol');
{
  const w = new Writer(64);
  const bytes = encodeInput(w, {
    seq: 77, viewTick: 1234.5, buttons: 9, mx: -1, mz: 0.5, yaw: 1.25, pitch: -0.3,
    actions: [{ type: A_SLOT, slot: 3 }, { type: A_PLACE, piece: 2, rot: 1, cx: 512, lv: -2, cz: 999 }],
  });
  const msg = decodeClient(bytes);
  eq(msg.type, C_INPUT, 'inputs decode');
  eq(msg.seq, 77, 'sequence number survives');
  near(msg.viewTick, 1234.5, 1e-3, 'view tick survives (lag compensation needs it)');
  near(msg.yaw, quantizeYaw(1.25), 1e-9, 'yaw arrives exactly as the client quantised it');
  near(msg.mz, 0.5, 0.01, 'movement axes survive');
  eq(JSON.stringify(msg.actions[1]), JSON.stringify({ type: A_PLACE, piece: 2, rot: 1, cx: 512, lv: -2, cz: 999 }), 'actions ride along intact');
  let threw = false;
  try { decodeClient(new Uint8Array([200, 1, 2])); } catch { threw = true; }
  ok(threw, 'garbage is rejected rather than half-read');
}

section('Tick order');
{
  const match = new Match({ trace: true });
  match.step(); match.step();
  eq(match.trace.join(' → '), [...STAGES, ...STAGES].join(' → '), 'input → movement → build → fire → damage → storm → replication, every tick');
}

section('Interest management');
{
  const match = new Match();
  const sent = [];
  const conn = { ready: true, send: (b) => sent.push(b), sendJson() {}, backlogged: () => false, player: null };
  const me = match.addPlayer({ name: 'me' });
  me.conn = conn; conn.player = me;
  match.conns.add(conn);
  match.placeOnGround(me, 2000, 2000);
  const near1 = match.addPlayer({ name: 'near' });
  match.placeOnGround(near1, 2100, 2000);
  const mid = match.addPlayer({ name: 'mid' });
  match.placeOnGround(mid, 2000, 2900);
  const far = match.addPlayer({ name: 'far' });
  match.placeOnGround(far, 4400, 4400);
  match.step();
  let seen = new Set();
  // Collect over a few ticks so the reduced-rate ring shows up too.
  for (let i = 0; i < 10; i++) {
    match.step();
    for (const p of decodeSnapshot(sent[sent.length - 1]).players) seen.add(p.id);
  }
  ok(seen.has(near1.id), 'a player 100 m away is replicated');
  ok(seen.has(mid.id), 'a player 900 m away is replicated, at a lower rate');
  ok(!seen.has(far.id), 'a player across the island is not');
  const snap = decodeSnapshot(sent[sent.length - 1]);
  ok(snap.self && Math.abs(snap.self.x - 2000) < 1, 'each client gets its own authoritative state');
}

section('100 connected clients at a stable tick');
{
  const server = await startServer({ port: 0, log: null, maxPerIp: 200 });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const clients = [];
  for (let i = 0; i < 100; i++) {
    const ws = new WebSocket(url);
    const c = { ws, snaps: 0, joined: false, seq: 0, writer: new Writer(64) };
    ws.binaryType = 'arraybuffer';
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name: `dummy${i}` })); ws.send(JSON.stringify({ t: 'play', mode: 'sandbox' })); });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) { if (JSON.parse(String(data)).t === 'match') c.joined = true; return; }
      if (new Uint8Array(data)[0] === 1) c.snaps++;
    });
    clients.push(c);
  }
  await new Promise((r) => setTimeout(r, 1500));
  eq(clients.filter((c) => c.joined).length, 100, 'all 100 dummy clients joined the match');
  // Every client walks about at 30 Hz, like a real one.
  const pump = setInterval(() => {
    for (const c of clients) {
      if (c.ws.readyState !== 1) continue;
      c.seq++;
      const t = c.seq / 30;
      c.ws.send(encodeInput(c.writer, { seq: c.seq, buttons: c.seq % 90 === 0 ? 1 : 2, mx: Math.sin(t), mz: 1, yaw: t * 0.3 + c.seq * 0 + clients.indexOf(c), pitch: 0 }));
    }
  }, 1000 / 30);
  const match = [...server.matches][0];
  const tick0 = match.tick;
  for (const c of clients) c.snaps = 0;
  const started = performance.now();
  await new Promise((r) => setTimeout(r, 6000));
  const seconds = (performance.now() - started) / 1000;
  clearInterval(pump);
  const rate = (match.tick - tick0) / seconds;
  near(rate, TICK_HZ, 1.5, `the server ticks at ${TICK_HZ} Hz with 100 players (measured ${rate.toFixed(2)})`);
  const snapRates = clients.map((c) => c.snaps / seconds).sort((a, b) => a - b);
  ok(snapRates[0] > 26, `every client receives ~30 snapshots a second (slowest ${snapRates[0].toFixed(1)}/s)`);
  const stats = match.tickStats();
  ok(stats.avgMs < 8, `a tick with 100 players averages ${stats.avgMs.toFixed(2)} ms (budget 33 ms)`);
  ok(stats.p99Ms < 25, `99th percentile tick ${stats.p99Ms.toFixed(2)} ms`);
  const moved = [...match.players.values()].filter((p) => Math.hypot(p.move.vx, p.move.vz) > 1).length;
  ok(moved > 90, `the dummies are actually moving (${moved}/100 under way)`);
  for (const c of clients) c.ws.terminate();
  await server.close();
}

report();

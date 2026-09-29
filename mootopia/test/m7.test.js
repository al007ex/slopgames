// M7 — bots, abuse and load: a lively empty server, a sturdy busy one.

import WebSocket from 'ws';
import { ok, eq, section } from './harness.js';
import { emptyGame, spawnAt, ticks } from './util.js';
import * as C from '#shared/config.js';
import { ITEMS } from '#shared/items.js';
import { CLIENT_TABLE, SERVER_TABLE, encode, decode } from '#shared/protocol.js';
import { Bots } from '../server/bots.js';
import { Game } from '../server/game.js';
import { startServer } from '../server/index.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

section('Bots');
{
  const g = new Game({ seed: 11, animals: false });
  const bots = new Bots(g, 6);
  bots.fill();
  eq(bots.list.length, 6, 'an empty server fills with 6 bots');
  ok(bots.list.every((b) => b.alive), 'all of them in the world');
  eq(new Set(bots.list.map((b) => b.name)).size, 6, 'each with its own name');
  ok(!bots.list.every((b) => /^[A-Z][a-z]+$/.test(b.name)), `and names that look typed by people (${bots.list.map((b) => b.name).join(', ')})`);
  bots.makeRoom();                       // the server makes room just before someone joins
  const human = g.join({ name: 'Real' });
  eq(bots.list.length, 5, 'a real player arriving sends one home');
  g.leave(human); bots.fill();
  eq(bots.list.length, 6, 'and one comes back when they leave');

  let offGrid = 0; let snaps = 0; let moves = 0;
  const walked = new Map(bots.list.map((b) => [b, 0]));
  const last = new Map(bots.list.map((b) => [b, { x: b.x, y: b.y, dir: b.dir, alive: true }]));
  for (let t = 0; t < 9 * 90; t++) {
    bots.update(); g.tick();
    for (const b of bots.list) {
      const l = last.get(b);
      if (b.alive && l.alive) {
        if (b.moveDir !== null) { moves++; const k = b.moveDir / (Math.PI / 4); if (Math.abs(k - Math.round(k)) > 1e-9) offGrid++; }
        if (Math.abs(Math.atan2(Math.sin(b.dir - l.dir), Math.cos(b.dir - l.dir))) > 0.7) snaps++;
        walked.set(b, walked.get(b) + Math.hypot(b.x - l.x, b.y - l.y));
      }
      last.set(b, { x: b.x, y: b.y, dir: b.dir, alive: b.alive });
    }
  }
  eq(offGrid, 0, `bots only ever move in the eight keyboard directions (${moves} moving ticks)`);
  eq(snaps, 0, 'and their aim turns like a hand on a mouse, never snapping');
  const busy = [...walked.values()].filter((d) => d > 600).length;
  ok(busy >= 5, `bots walk about their business (${busy} of 6 walked over 600 units)`);
  const gathered = bots.list.reduce((n, b) => n + b.wood + b.stone + b.food + b.gold, 0);
  ok(gathered > 100, `and farm (${gathered} resources in 90 seconds)`);
  ok(bots.list.some((b) => b.age >= 2), `and age up (oldest is age ${Math.max(...bots.list.map((b) => b.age))})`);
}

section('A bot builds a home');
{
  const g = emptyGame({ nature: true });
  const bots = new Bots(g, 1);
  bots.fill();
  const b = bots.list[0];
  Object.assign(b, { wood: 3000, stone: 3000, food: 500 });
  b.items = [...new Set([...b.items, ITEMS.findIndex((i) => i.name === 'Pit Trap')])];
  for (let t = 0; t < 9 * 150 && g.objects.ownedBy(b).length < 14; t++) { bots.update(); g.tick(); b.health = b.maxHealth; }
  const mine = g.objects.ownedBy(b);
  const home = b.brain.home;
  const by = (name) => mine.filter((o) => o.item.name === name);
  ok(by('Windmill').length >= 4, `it rings its home with windmills (${by('Windmill').length})`);
  ok(by('Windmill').every((o) => Math.abs(Math.hypot(o.x - home.x, o.y - home.y) - 150) < 40), 'in a ring 150 out');
  const ring = by('Windmill').map((o) => Math.atan2(o.y - home.y, o.x - home.x)).sort((a, b) => a - b);
  const gaps = ring.map((a, i) => { const next = i + 1 < ring.length ? ring[i + 1] : ring[0] + Math.PI * 2; return 2 * 150 * Math.sin((next - a) / 2) - 2 * ITEMS.find((i2) => i2.name === 'Windmill').scale; });
  ok(Math.max(...gaps) > C.PLAYER_SCALE * 2, `with a gap to walk out through (widest ${Math.max(...gaps).toFixed(0)} units)`);
  const edge = [...by('Wood Wall'), ...by('Spikes'), ...by('Pit Trap')];
  ok(edge.length >= 6, `then walls, spikes and traps round the edge (${by('Wood Wall').length} walls, ${by('Spikes').length} spikes, ${by('Pit Trap').length} traps)`);
  ok(edge.every((o) => Math.abs(Math.hypot(o.x - home.x, o.y - home.y) - 330) < 60), 'about 330 out from the middle');
  g.killPlayer(b, null);
  for (let t = 0; t < 9 * 12 && !b.alive; t++) { bots.update(); g.tick(); }
  ok(b.alive, 'after dying it comes back within a few seconds');
  for (let t = 0; t < 9 * 60 && Math.hypot(b.x - home.x, b.y - home.y) > 900; t++) { bots.update(); g.tick(); b.health = b.maxHealth; }
  ok(Math.hypot(b.x - home.x, b.y - home.y) < 900, 'and walks back home');
}

section('Bots at work');
{
  const g = emptyGame();
  const bots = new Bots(g, 1);
  bots.fill();
  const b = bots.list[0];
  Object.assign(b, { x: 5000, y: 5000, wood: 200, stone: 200, food: 200 });
  b.brain.home = { x: 5000, y: 5000 };
  b.health = 40; b.hitTime = 0;
  for (let t = 0; t < 30 && b.health <= 40; t++) { bots.update(); g.tick(); }
  ok(b.health > 40, 'a hurt bot eats (in its own time)');

  const rival = spawnAt(g, b.x + 160, b.y);
  b.health = b.maxHealth;
  // The rival picks a fight.
  b.changeHealth(-10, rival);
  let hit = false;
  for (let t = 0; t < 60 && !hit; t++) { bots.update(); g.tick(); hit = rival.health < 100; }
  ok(hit, 'a bot hits back when someone picks a fight');

  if (!rival.alive) g.spawn(rival, {});
  rival.x = b.x + 150; rival.y = b.y; rival.health = 100;
  b.health = 12; b.food = 0; b.brain.hurtAt = g.time;
  const d0 = Math.hypot(b.x - rival.x, b.y - rival.y);
  for (let t = 0; t < 12; t++) { bots.update(); g.tick(); }
  ok(!b.alive || Math.hypot(b.x - rival.x, b.y - rival.y) > d0, 'and runs when it is losing');
}

section('Abuse');
{
  const srv = startServer({ port: 3694, log: () => {}, bots: 0, maxPerIp: 3 });
  await wait(150);
  const open = () => new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:3694/ws');
    ws.on('open', () => resolve(ws)); ws.on('error', () => resolve(null)); ws.on('close', () => resolve(null));
  });
  const a = await open();
  a.send(encode(CLIENT_TABLE, [['spawn', 'Victim', 1]]));
  const b = await open();
  b.send(encode(CLIENT_TABLE, [['spawn', 'Rude', 1]]));
  await wait(300);
  const rude = [...srv.game.players.values()].find((p) => p.name === 'Rude');
  b.send(Buffer.from([250, 1, 2, 3]));
  b.send(Buffer.from('not binary at all, just text'));
  b.send(Buffer.alloc(3000, 7));
  b.send(encode(CLIENT_TABLE, [['chat', 'x'.repeat(250)]]));
  await wait(200);
  ok(srv.game.players.size === 2 && rude.alive, 'garbage, text and oversized frames are ignored, not fatal');
  let chatSeen = 0;
  a.on('message', (d) => { for (const m of decode(SERVER_TABLE, d)) if (m[0] === 'chat') chatSeen++; });
  rude.x = srv.game.players.get(1).x + 100; rude.y = srv.game.players.get(1).y;
  for (let i = 0; i < 200; i++) b.send(encode(CLIENT_TABLE, [['chat', `spam ${i}`]]));
  await wait(600);
  ok(chatSeen <= 2, `a flood of 200 chat messages gets ${chatSeen} through`);
  for (let i = 0; i < 300; i++) b.send(encode(CLIENT_TABLE, [['input', i + 1, 0]]));
  await wait(300);
  ok(rude.inputs.length <= 4, 'a flood of inputs cannot queue up');
  const c = await open(); const d = await open();
  ok(c && !d, 'a fourth connection from one address is turned away');
  const health = await fetch('http://localhost:3694/health').then((r) => r.json());
  ok(health.ok, 'and the server is still healthy');
  for (const ws of [a, b, c]) ws?.close();
  await srv.close();
}

section('Forty players');
{
  const srv = startServer({ port: 3695, log: () => {}, bots: 0, maxPerIp: 100 });
  await wait(150);
  const clients = [];
  for (let i = 0; i < 40; i++) {
    const ws = new WebSocket('ws://localhost:3695/ws');
    const c = { ws, bytes: 0, frames: 0 };
    ws.on('message', (d) => { c.bytes += d.length; c.frames++; });
    await new Promise((r) => ws.on('open', r));
    ws.send(encode(CLIENT_TABLE, [['spawn', `P${i}`, i % 10]]));
    clients.push(c);
  }
  await wait(500);
  // Crowd them into one area so everyone sees plenty of everyone.
  const ps = [...srv.game.players.values()];
  ps.forEach((p, i) => { p.x = 6000 + (i % 8) * 90; p.y = 5000 + Math.floor(i / 8) * 90; });
  for (const c of clients) { c.bytes = 0; c.frames = 0; }
  // Keep everyone on their feet: the point is the load, not a winner.
  const heal = setInterval(() => { for (const p of ps) { if (!p.alive) srv.game.spawn(p, {}); p.health = p.maxHealth; } }, 300);
  let seq = 0;
  await wait(300);
  srv.timing.reset();                      // measure the fight, not the forty arrivals
  const t0 = Date.now();
  const drive = setInterval(() => {
    seq++;
    for (const [i, c] of clients.entries()) {
      const dir = ((seq + i * 7) % 36) / 36 * Math.PI * 2;
      c.ws.send(encode(CLIENT_TABLE, [['input', seq & 0xffff, dir], ['aim', dir], ['attack', seq % 6 < 3 ? 1 : 0, dir]]));
    }
  }, C.TICK_MS);
  const samples = [];
  const probe = setInterval(async () => { samples.push(await fetch('http://localhost:3695/health').then((r) => r.json())); }, 1000);
  await wait(6000);
  clearInterval(drive); clearInterval(probe); clearInterval(heal);
  const secs = (Date.now() - t0) / 1000;
  const last = samples.at(-1);
  const kbps = clients.reduce((n, c) => n + c.bytes, 0) / clients.length / secs / 1024;
  ok(srv.game.players.size === 40 && ps.every((p) => p.alive), '40 players crowded together, swinging at each other');
  ok(last.avgMs < 12, `a tick takes ${last.avgMs} ms on average (budget ${C.TICK_MS.toFixed(0)})`);
  ok(last.maxMs < C.TICK_MS / 2, `the slowest tick took ${last.maxMs} ms — under half the budget, so the 9 Hz beat never slips`);
  ok(kbps < 12, `each player downloads ${kbps.toFixed(1)} KB/s`);
  const frames = clients.reduce((n, c) => n + c.frames, 0) / clients.length / secs;
  ok(frames > 8 && frames < 10.5, `in ${frames.toFixed(1)} frames a second — one per tick`);
  for (const c of clients) c.ws.close();
  await srv.close();
}

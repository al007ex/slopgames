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
  bots.makeRoom();                       // the server makes room just before someone joins
  const human = g.join({ name: 'Real' });
  eq(bots.list.length, 5, 'a real player arriving sends one home');
  g.leave(human); bots.fill();
  eq(bots.list.length, 6, 'and one comes back when they leave');

  const start = bots.list.map((b) => ({ wood: b.wood, x: b.x, y: b.y }));
  for (let t = 0; t < 9 * 90; t++) { bots.update(); g.tick(); }
  const moved = bots.list.filter((b, i) => Math.hypot(b.x - start[i].x, b.y - start[i].y) > 200).length;
  ok(moved >= 4, `bots get around (${moved} of 6 moved)`);
  const gathered = bots.list.reduce((n, b) => n + b.wood + b.stone + b.food, 0);
  ok(gathered > 60, `and gather (${gathered} resources in 90 seconds)`);
  ok(bots.list.some((b) => b.age >= 2), `and age up (oldest is age ${Math.max(...bots.list.map((b) => b.age))})`);
}

section('Bots at work');
{
  const g = emptyGame();
  const bots = new Bots(g, 1);
  bots.fill();
  const b = bots.list[0];
  Object.assign(b, { x: 5000, y: 5000, wood: 200, stone: 200, food: 200 });
  b.health = 40; b.hitTime = 0;
  bots.update();
  ok(b.health > 40, 'a hurt bot eats');
  const mills = () => b.itemCounts[ITEMS.find((i) => i.name === 'Windmill').group.id] || 0;
  for (let t = 0; t < 60 && !mills(); t++) { bots.update(); g.tick(); }
  ok(mills() >= 1, 'a bot with the wood and stone puts up a windmill');

  const rival = spawnAt(g, b.x + 200, b.y);
  b.health = b.maxHealth;
  for (let t = 0; t < 45; t++) { bots.update(); g.tick(); }
  ok(rival.health < 100, 'a bot fights a player who comes close');

  // The bot has usually won that fight by now; bring the rival back beside it.
  if (!rival.alive) g.spawn(rival, {});
  rival.x = b.x + 150; rival.y = b.y; rival.health = 100;
  b.health = 20;
  const d0 = Math.hypot(b.x - rival.x, b.y - rival.y);
  b.food = 0;
  for (let t = 0; t < 12; t++) { bots.update(); g.tick(); }
  ok(!b.alive || Math.hypot(b.x - rival.x, b.y - rival.y) > d0, 'and runs when it is losing');
  g.killPlayer(b, null);
  for (let t = 0; t < 9 * 7; t++) { bots.update(); g.tick(); }
  ok(b.alive, 'a fallen bot is back within seven seconds');
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
  ok(last.maxMs < 60, `and ${last.maxMs} ms at worst`);
  ok(kbps < 12, `each player downloads ${kbps.toFixed(1)} KB/s`);
  const frames = clients.reduce((n, c) => n + c.frames, 0) / clients.length / secs;
  ok(frames > 8 && frames < 10.5, `in ${frames.toFixed(1)} frames a second — one per tick`);
  for (const c of clients) c.ws.close();
  await srv.close();
}

// M0 — foundations: the wire format, the world, movement and who sees what.

import WebSocket from 'ws';
import { ok, eq, near, section } from './harness.js';
import { emptyGame, spawnAt, ticks, sent, drain } from './util.js';
import * as C from '#shared/config.js';
import { SERVER_TABLE, CLIENT_TABLE, SERVER, CLIENT, encode, decode, Writer } from '#shared/protocol.js';
import { generateWorld, TREE, BUSH, ROCK, GOLD, isCactus } from '#shared/world.js';
import { ITEMS } from '#shared/items.js';
import { startServer } from '../server/index.js';

// ── the wire ────────────────────────────────────────────────────────────
section('Binary protocol');
{
  const msgs = [
    ['welcome', 12, 14400, 20160101],
    ['tick', 123456, [1, 3000, 7000, 1.5, -1, 0, 2, 0, 1004, 0, 1, 2, 3100, 7100, -2.25, 4, 3, 0, 5, 0, 1, 0], [9, 4, 3200, 7200, 0.5, 300]],
    ['objs', [70000, 100, 200, 3.1, 175, 0, -1, 0, 70001, 110, 210, -1, 50, -1, 3, 12]],
    ['info', 3, 'Björn', 4, 100, 750, 1],
    ['leaders', [1, 'alpha', 123456, 2, 'beta', 99]],
    ['members', 4, 'CLAN', 1, [1, 'alpha', 2, 'beta']],
    ['upg', 2, 3, [0, 3, 1, 4]],
    ['xp', 42, 360, 2],
    ['txt', 100, 200, -20],
    ['died'],
  ];
  const frame = encode(SERVER_TABLE, msgs);
  ok(frame instanceof Uint8Array, 'a batch encodes to one Uint8Array frame');
  const back = decode(SERVER_TABLE, frame);
  eq(back.length, msgs.length, 'every message in the batch comes back');
  eq(JSON.stringify(back[0]), JSON.stringify(msgs[0]), 'plain integers round-trip exactly');
  eq(back[3][2], 'Björn', 'UTF-8 names survive');
  eq(JSON.stringify(back[4]), JSON.stringify(msgs[4]), 'flat records with strings round-trip');
  eq(back[1][1], 123456, 'the server tick number rides along');
  near(back[1][2][3], 1.5, 1e-4, 'angles come back within 0.0001 rad');
  near(back[1][2][14], -2.25, 1e-4, 'negative angles too');
  eq(back[1][2][4], -1, 'signed fields keep their sign (no item held)');
  eq(back[2][1][0], 70000, 'object ids go past 65535');
  eq(back[8][3], -20, 'heals are negative numbers on the wire');

  const tickOnly = encode(SERVER_TABLE, [['tick', 1, Array(11).fill(1), []]]);
  ok(tickOnly.length <= 26, `a snapshot with one player is tiny (${tickOnly.length} bytes)`);
  const me = decode(SERVER_TABLE, encode(SERVER_TABLE, [['me', 7, 1234.5678, 42.25, 0.123456, -0.5, 0.75, 1, 0]]))[0];
  ok(Math.abs(me[2] - 1234.5678) < 1e-3 && Math.abs(me[4] - 0.123456) < 1e-6, 'your own position and velocity come back exactly enough to replay from');

  const move = decode(CLIENT_TABLE, encode(CLIENT_TABLE, [['move', null], ['move', Math.PI / 2], ['attack', 1, -1]]));
  eq(move[0][1], null, 'a stopped player sends a null direction');
  near(move[1][1], Math.PI / 2, 1e-4, 'a direction survives');
  eq(move[2][1], 1, 'attack held flag survives');

  let threw = 0;
  for (const bad of [new Uint8Array([200]), new Uint8Array([CLIENT_TABLE.ops.attack, 1]), new Uint8Array([CLIENT_TABLE.ops.chat, 9, 65])]) {
    try { decode(CLIENT_TABLE, bad); } catch { threw++; }
  }
  eq(threw, 3, 'unknown opcodes and short frames are rejected, not half-read');

  const w = new Writer(4);
  encode(SERVER_TABLE, [['chat', 1, 'x'.repeat(400)]], w);
  eq(decode(SERVER_TABLE, w.bytes())[0][2].length, 255, 'long strings are cut to 255 bytes and the writer grows');
  eq(decode(SERVER_TABLE, encode(SERVER_TABLE, [['res', 3, -50]]))[0][2], 0, 'out-of-range numbers are clamped, never wrapped');
  ok(Object.keys(SERVER).length < 255 && Object.keys(CLIENT).length < 255, 'every message type fits a one-byte opcode');
}

// ── the world ───────────────────────────────────────────────────────────
section('World');
{
  const a = generateWorld(99); const b = generateWorld(99);
  eq(JSON.stringify(a), JSON.stringify(b), 'the same seed builds the same world');
  const count = (t) => a.filter((r) => r.type === t).length;
  eq(count(TREE), C.TREES, `${C.TREES} trees`);
  eq(count(BUSH), C.BUSHES, `${C.BUSHES} bushes`);
  eq(count(ROCK), C.ROCKS, `${C.ROCKS} rocks`);
  eq(count(GOLD), C.GOLD_ORES, `${C.GOLD_ORES} gold ores`);
  ok(a.filter((r) => r.type === TREE).every((r) => !C.inRiver(r.y) && r.y < C.DESERT_TOP), 'no trees in the river or the desert');
  ok(a.filter((r) => r.type === BUSH).every((r) => !C.inRiver(r.y)), 'no bushes in the river');
  ok(a.some((r) => isCactus(r.type, r.y)) && a.filter((r) => isCactus(r.type, r.y)).every((r) => r.y > C.DESERT_TOP), 'desert bushes are cacti, and only there');
  let overlaps = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) < a[i].scale + a[j].scale) overlaps++;
  eq(overlaps, 0, 'no two things overlap: every silhouette stands clear of the rest');
  ok(a.every((r) => r.x > 0 && r.y > 0 && r.x < C.MAP && r.y < C.MAP), 'everything is on the map');
}

// ── movement ────────────────────────────────────────────────────────────
section('Movement');
{
  const g = emptyGame();
  const p = spawnAt(g, 5000, 5000);
  p.moveDir = 0;
  ticks(g, 40);
  // v' = (v + a·dt)·decel^dt settles at a·dt·d / (1 − d).
  const d = Math.pow(C.DECEL, C.TICK_MS); const a = C.PLAYER_SPEED * C.TICK_MS;
  near(p.xVel, a * d / (1 - d), 0.002, `top speed settles at the classic ${(a * d / (1 - d)).toFixed(3)} units/ms`);
  const vTop = a * d / (1 - d);
  const x0 = p.x; ticks(g, 9);
  near(p.x - x0, 9 * (vTop + a) * C.TICK_MS, 3, `about ${Math.round(9 * (vTop + a) * C.TICK_MS)} units a second across open grass`);
  p.moveDir = null;
  ticks(g, 30);
  eq(p.xVel, 0, 'letting go glides to a stop');

  const snow = spawnAt(g, 5000, 1200); snow.moveDir = 0; ticks(g, 40);
  near(snow.xVel / vTop, C.SNOW_SPEED, 0.02, 'snow slows you to three quarters');
  const water = spawnAt(g, 5000, C.MAP / 2); water.moveDir = Math.PI / 2; ticks(g, 3);
  ok(water.xVel > 0, 'the river current pushes you east');
  const build = spawnAt(g, 8000, 5000); build.buildIndex = 3; build.moveDir = 0; ticks(g, 40);
  near(build.xVel / vTop, C.BUILD_SPEED, 0.02, 'holding an item halves your speed');
  const edge = spawnAt(g, 20, 20); edge.moveDir = Math.PI; ticks(g, 20);
  ok(edge.x >= C.PLAYER_SCALE && edge.y >= C.PLAYER_SCALE, 'the map edge holds you in');
}

section('Collisions');
{
  const g = emptyGame();
  const rock = g.addObject({ x: 5300, y: 5000, scale: 90, type: ROCK });
  const p = spawnAt(g, 5000, 5000);
  p.moveDir = 0;
  ticks(g, 40);
  near(p.x, rock.x - rock.scale - C.PLAYER_SCALE, 1, 'you stop flush against a rock');
  const tree = g.addObject({ x: 7300, y: 5000, scale: 98, type: TREE });
  const q = spawnAt(g, 7000, 5000); q.moveDir = 0; ticks(g, 40);
  near(q.x, tree.x - tree.scale - C.PLAYER_SCALE, 1, 'trees block at the edge of their drawn canopy');

  const owner = spawnAt(g, 9000, 9000);
  g.addObject({ x: 6000, y: 6000, scale: ITEMS[6].scale, item: ITEMS[6], owner });
  const victim = spawnAt(g, 6000 - ITEMS[6].scale - C.PLAYER_SCALE + 2, 6000);
  const hp = victim.health;
  ticks(g, 1);
  eq(victim.health, hp - ITEMS[6].dmg, 'touching an enemy spike hurts by its damage');
  near(victim.xVel, -1.5 * Math.pow(C.DECEL, C.TICK_MS), 0.01, 'and knocks you away at 1.5, less a tick of friction');

  const a1 = spawnAt(g, 3000, 3000); const a2 = spawnAt(g, 3010, 3000);
  ticks(g, 1);
  ok(Math.hypot(a1.x - a2.x, a1.y - a2.y) >= C.PLAYER_SCALE * 2 - 1, 'players push each other apart');
}

section('What each player is sent');
{
  const g = emptyGame();
  const near1 = g.addObject({ x: 5200, y: 5000, scale: 90, type: ROCK });
  const far1 = g.addObject({ x: 9000, y: 5000, scale: 90, type: ROCK });
  const p = spawnAt(g, 5000, 5000);
  const other = spawnAt(g, 5400, 5100);
  const far2 = spawnAt(g, 12000, 12000);
  g.tick();
  const objs = sent(p, 'objs').flatMap((m) => m[1]);
  ok(objs.includes(near1.sid) && !objs.includes(far1.sid), 'objects arrive once they are on screen, not before');
  const tick = sent(p, 'tick')[0];
  const sids = []; for (let i = 0; i < tick[2].length; i += 11) sids.push(tick[2][i]);
  ok(sids.includes(p.sid) && sids.includes(other.sid) && !sids.includes(far2.sid), 'snapshots hold you and whoever is on your screen');
  ok(sent(p, 'info').some((m) => m[1] === other.sid), 'a newcomer on screen comes with a name card');
  drain(g); g.tick();
  eq(sent(p, 'objs').length, 0, 'objects are only sent once');
  g.removeObject(near1);
  ok(sent(p, 'rm').some((m) => m[1] === near1.sid), 'removing an object tells whoever had it');
  const outboxBytes = encode(SERVER_TABLE, [...p.outbox, ...sent(p, 'tick')]).length;
  ok(outboxBytes < 240, `a quiet tick costs ${outboxBytes} bytes`);
}

// ── over a real socket ──────────────────────────────────────────────────
section('Over a real socket');
{
  const srv = startServer({ port: 3693, log: () => {}, bots: 0 });
  await new Promise((r) => setTimeout(r, 150));
  const client = async (name) => {
    const ws = new WebSocket('ws://localhost:3693/ws');
    const got = [];
    ws.on('message', (d) => { for (const m of decode(SERVER_TABLE, d)) got.push(m); });
    await new Promise((r) => ws.on('open', r));
    ws.send(encode(CLIENT_TABLE, [['spawn', name, 2]]));
    return { ws, got };
  };
  const a = await client('Alpha'); const b = await client('Bravo');
  await new Promise((r) => setTimeout(r, 400));
  const pa = [...srv.game.players.values()].find((p) => p.name === 'Alpha');
  const pb = [...srv.game.players.values()].find((p) => p.name === 'Bravo');
  ok(pa?.alive && pb?.alive, 'two clients spawn');
  pb.x = pa.x + 300; pb.y = pa.y;
  await new Promise((r) => setTimeout(r, 400));
  const lastTick = [...a.got].reverse().find((m) => m[0] === 'tick');
  const seen = []; for (let i = 0; i < lastTick[2].length; i += 11) seen.push(lastTick[2][i]);
  ok(seen.includes(pb.sid), 'Alpha sees Bravo walk into view');
  ok(a.got.some((m) => m[0] === 'info' && m[2] === 'Bravo'), 'with Bravo’s name');
  const res = await fetch('http://localhost:3693/health').then((r) => r.json());
  eq(res.online, 2, '/health counts the two players');
  const page = await fetch('http://localhost:3693/').then((r) => r.text());
  ok(page.includes('MOOTOPIA'), 'the page is served');
  const shared = await fetch('http://localhost:3693/shared/protocol.js');
  eq(shared.status, 200, 'shared modules are served to the browser');
  const secret = await fetch('http://localhost:3693/shared/../server/game.js');
  ok(secret.status !== 200, 'server code is not');
  a.ws.close(); b.ws.close();
  await new Promise((r) => setTimeout(r, 200));
  eq(srv.game.players.size, 0, 'closing the socket removes the player');
  await srv.close();
}

// ── true sizes and hitboxes ─────────────────────────────────────────────
section('Every sprite at its true size, every hitbox from its sprite');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { readPng } = await import('../tools/png.js');
  const { measureSprite } = await import('#shared/measure.js');
  const { MEASURED } = await import('#shared/sprite-sizes.js');
  const { DRAWN, PX, OUTLINE, radiusOf } = await import('#shared/sprites.js');
  const { ITEMS, itemSpriteKey } = await import('#shared/items.js');
  const { ANIMALS, animalSpriteKey } = await import('#shared/animals.js');
  const { resourceKey } = await import('#shared/world.js');
  const root = new URL('../client/img/', import.meta.url).pathname;

  let stale = []; let files = 0;
  for (const dir of ['world', 'items', 'animals', 'hats', 'weapons']) {
    for (const f of readdirSync(root + dir).filter((n) => n.endsWith('.png') && !n.includes('_shadow'))) {
      files++;
      const key = `${dir}/${f.slice(0, -4)}`;
      const m = measureSprite(readPng(root + dir + '/' + f));
      const t = MEASURED[key];
      if (!t || t.r !== m.radius || t.outline !== m.outline || t.w !== m.width) stale.push(key);
    }
  }
  eq(stale.join(', '), '', `the size table matches a fresh measurement of all ${files} sprites`);

  const { scaleOf, NATURE } = await import('#shared/sprites.js');
  const off = Object.entries({ ...MEASURED, ...DRAWN }).filter(([, m]) => m.outline !== undefined && Math.abs(m.outline * PX - OUTLINE) > 0.5);
  eq(off.map(([k, m]) => `${k} ${m.outline}px`).join(', '), '', `every sprite, drawn or painted, uses the same pen: ${OUTLINE} ± 0.5 world units at true size`);
  eq(scaleOf('world/tree_1') * scaleOf('items/wood_wall'), NATURE, 'only nature is drawn larger than true size');
  ok(OUTLINE * NATURE - OUTLINE < 1, 'nature\u2019s slightly larger size keeps its outline within a unit of everything else');
  eq(OUTLINE, 4, 'which is the art’s 8 px pen at 0.5 world units per pixel');
  const render = readFileSync(new URL('../client/js/render.js', import.meta.url), 'utf8');
  ok(render.includes('const OUTLINE_W = OUTLINE;'), 'and the player, drawn in code, uses the same outline');

  const placed = ITEMS.filter((it) => it.group.place);
  ok(placed.every((it) => it.scale === radiusOf(itemSpriteKey(it))), `all ${placed.length} buildings collide at their sprite’s silhouette`);
  ok(ANIMALS.every((a) => a.scale === radiusOf(animalSpriteKey(a))), `all ${ANIMALS.length} animals do too`);
  const world = generateWorld(3);
  ok(world.every((o) => o.scale === radiusOf(resourceKey(o.type, o.y))), 'and every tree, bush, cactus, rock and gold ore');

  const g = emptyGame();
  const wall = ITEMS.find((it) => it.name === 'Wood Wall');
  const owner = spawnAt(g, 9000, 9000);
  const o = g.addObject({ x: 6000, y: 6000, scale: wall.scale, item: wall, owner });
  const p = spawnAt(g, 5800, 6000); p.moveDir = 0; ticks(g, 30);
  near(p.x, o.x - wall.scale - C.PLAYER_SCALE, 0.5, 'walking into a wall stops you exactly at its drawn edge');
}

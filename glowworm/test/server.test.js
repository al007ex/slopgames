// End-to-end: a real server on a spare port, real WebSocket clients, the real
// wire format. This is the test that proves a browser would actually be able
// to join, see itself, steer and leave.

import { WebSocket } from 'ws';
import { ok, eq, near, section, report } from './harness.js';
import { startServer } from '../server/index.js';
import * as P from '../shared/protocol.js';
import { NAME_MAX, SNAKE_TARGET, SIM_HZ, FOOD_TARGET } from '../shared/rules.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A client that records everything it is sent. */
function connect(port, path = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.binaryType = 'arraybuffer';
    const client = { ws, messages: [], closed: false };
    ws.on('message', (data) => client.messages.push(P.decodeServer(new Uint8Array(data))));
    ws.on('close', () => { client.closed = true; });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
const ofType = (client, type) => client.messages.filter((m) => m.type === type);
const lastOf = (client, type) => ofType(client, type).at(-1);
async function until(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return true; await wait(20); }
  return check();
}
const health = async (port) => (await fetch(`http://127.0.0.1:${port}/health`)).json();

const server = await startServer({ port: 0, seed: 42, log: null });
const { port, world } = server;

try {
  section('Arriving');
  const alice = await connect(port);
  await until(() => ofType(alice, P.SERVER.SNAPSHOT).length && ofType(alice, P.SERVER.BOARD).length, 2500);
  const welcome = ofType(alice, P.SERVER.WELCOME)[0];
  ok(Boolean(welcome), 'a new connection is welcomed');
  eq(welcome?.you, 0, 'as a spectator until it joins');
  const infos = ofType(alice, P.SERVER.SNAKE_INFO).flatMap((m) => m.snakes);
  ok(infos.length >= SNAKE_TARGET - 1, 'and told who is already in the arena', `${infos.length} snakes`);
  const synced = ofType(alice, P.SERVER.FOOD_ADD).reduce((n, m) => n + m.foods.length, 0);
  ok(synced >= FOOD_TARGET, 'and sent every pellet on the board', `${synced}`);
  ok(ofType(alice, P.SERVER.SNAPSHOT).length > 0, 'snapshots start straight away');
  ok(lastOf(alice, P.SERVER.SNAPSHOT).snakes.length > 0, 'spectators watch a live snake before they join');
  ok(Boolean(lastOf(alice, P.SERVER.BOARD)), 'and get the leaderboard');
  eq((await health(port)).online, 1, 'the health check counts the connection');

  section('Joining');
  const rlo = String.fromCodePoint(0x202e);
  alice.ws.send(P.encodeJoin(`  ali${rlo}ce the very long named worm  `, 4));
  await until(() => ofType(alice, P.SERVER.WELCOME).some((m) => m.you));
  const you = ofType(alice, P.SERVER.WELCOME).find((m) => m.you)?.you;
  ok(you > 0, 'joining assigns a snake');
  await until(() => ofType(alice, P.SERVER.SNAKE_INFO).some((m) => m.snakes.some((s) => s.id === you)));
  const mine = ofType(alice, P.SERVER.SNAKE_INFO).flatMap((m) => m.snakes).find((s) => s.id === you);
  ok(mine && !mine.name.includes(rlo), 'the name is cleaned of control characters');
  ok(mine && [...mine.name].length <= NAME_MAX, 'and cut to length', mine?.name);
  eq(mine?.skin, 4, 'the chosen skin is kept');

  await until(() => lastOf(alice, P.SERVER.SNAPSHOT)?.snakes.some((s) => s.id === you));
  const snap = lastOf(alice, P.SERVER.SNAPSHOT);
  const self = snap.snakes.find((s) => s.id === you);
  ok(Boolean(self), 'your snake appears in your snapshots');
  near(snap.cx, self.points[0], 0.5, 'and the view is centred on your head');
  eq((await health(port)).playing, 1, 'the health check counts players');

  alice.ws.send(P.encodeJoin('again', 0));
  await wait(150);
  eq([...world.snakes.values()].filter((s) => !s.bot).length, 1, 'joining twice does not spawn a second snake');

  section('Steering');
  const snake = world.snakes.get(you);
  alice.ws.send(P.encodeInput(Math.PI / 2, false));
  await until(() => Math.abs(snake.targetAngle - Math.PI / 2) < 0.001);
  near(snake.targetAngle, Math.PI / 2, 0.001, 'input sets the heading');
  alice.ws.send(P.encodeInput(0, true));
  await until(() => snake.boost);
  ok(snake.boost, 'and asks for boost');
  alice.ws.send(P.encodeInput(0, false));

  section('Watching others');
  const bob = await connect(port);
  await until(() => ofType(bob, P.SERVER.SNAKE_INFO).some((m) => m.snakes.some((s) => s.id === you)), 1500);
  ok(ofType(bob, P.SERVER.SNAKE_INFO).some((m) => m.snakes.some((s) => s.id === you)), 'a newcomer learns about players already in the game');
  bob.ws.send(P.encodeView(300, 200));
  await wait(200);
  const narrow = lastOf(bob, P.SERVER.SNAPSHOT);
  bob.ws.send(P.encodeView(2600, 2600));
  await wait(200);
  const wide = lastOf(bob, P.SERVER.SNAPSHOT);
  ok(wide.snakes.length >= narrow.snakes.length, 'a wider view receives at least as many snakes');
  ok(narrow.snakes.length < world.snakes.size, 'and a narrow one is not sent the whole arena',
    `${narrow.snakes.length} of ${world.snakes.size}`);

  section('Robustness');
  bob.ws.send(new Uint8Array([200, 1, 2, 3]));
  bob.ws.send(new Uint8Array([]));
  bob.ws.send('hello as text');
  bob.ws.send(P.encodeJoin('x', 250));
  await wait(200);
  ok(!bob.closed, 'garbage messages are ignored rather than crashing anything');
  const bobs = [...world.snakes.values()].find((s) => s.owner && s.name === 'x');
  ok(bobs && bobs.skin < 12, 'an out-of-range skin is clamped');

  const flood = await connect(port);
  for (let i = 0; i < 600; i++) flood.ws.send(P.encodeInput(i / 100, false));
  await until(() => flood.closed, 2000);
  ok(flood.closed, 'a client flooding the server is disconnected');

  const before = world.tick;
  await wait(300);
  ok(world.tick > before, 'the world keeps ticking through all of that');

  section('Leaving');
  const beforeLeave = world.snakes.has(you);
  alice.ws.close();
  await until(() => !world.snakes.has(you), 1500);
  ok(beforeLeave && !world.snakes.has(you), 'a player who disconnects is removed from the arena');
  // The removal is broadcast on the next tick, so wait for it to arrive.
  const leftEventOf = () => ofType(bob, P.SERVER.DEATH).flatMap((m) => m.deaths).find((d) => d.victim === you);
  await until(() => leftEventOf(), 1500);
  eq(leftEventOf()?.killer, P.LEFT_GAME, 'and others are told they left rather than died');
  await until(async () => (await health(port)).online === 1);
  eq((await health(port)).online, 1, 'the health check notices');

  section('Static files');
  const get = (path, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method });
  eq((await get('/')).status, 200, 'the client is served');
  eq((await get('/shared/protocol.js')).headers.get('content-type'), 'application/javascript; charset=utf-8', 'shared modules are served as JavaScript');
  eq((await get('/js/main.js')).status, 200, 'client modules are served');
  eq((await get('/health', 'HEAD')).status, 200, 'HEAD works for uptime checks');
  const sneaky = await fetch(`http://127.0.0.1:${port}/shared/..%2f..%2fserver/index.js`);
  ok(sneaky.status === 403 || sneaky.status === 404, 'paths cannot climb out of the served folders');
  eq((await get('/nope.js')).status, 404, 'unknown files are 404');
  eq((await get('/health', 'POST')).status, 405, 'only GET is accepted');

  section('Rates');
  const counter = await connect(port);
  await wait(1100);
  const snaps = ofType(counter, P.SERVER.SNAPSHOT).length;
  ok(snaps >= 12 && snaps <= 17, 'snapshots arrive at about 15 a second', `${snaps} in 1.1 s`);
  let bytes = 0;
  const started = Date.now();
  counter.ws.on('message', (data) => { bytes += data.byteLength; });
  await wait(2000);
  const perSecond = bytes / ((Date.now() - started) / 1000);
  ok(perSecond < 60_000, 'a spectator costs a modest amount of bandwidth', `${Math.round(perSecond / 1024)} KB/s`);
  counter.ws.close();
  bob.ws.close();
} finally {
  await server.close();
}

report();
process.exit(process.exitCode ?? 0);

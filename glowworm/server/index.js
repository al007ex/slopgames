// Glowworm's server: serves the client, runs the world at a fixed tick and
// streams it over a WebSocket. The simulation is server-authoritative — clients
// only ever send a heading and whether they are boosting — so nobody can
// teleport, grow or survive a collision by editing their own copy.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { World } from './world.js';
import {
  SIM_HZ, TICK_MS, SEND_EVERY, ARENA_RADIUS, SKINS, MAX_PLAYERS, cleanName,
} from '../shared/rules.js';
import {
  CLIENT, FLAG_BOOST, LEFT_GAME, decodeClient, encodeWelcome, encodeSnakeBlock,
  assembleSnapshot, encodeFoodAdd, encodeFoodEat, encodeSnakeInfo, encodeDeaths,
  encodeBoard, encodeYouDied, encodePong,
} from '../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const MAX_CONNECTIONS = 150;
const MAX_PER_IP = 8;
const SEND_BACKLOG_LIMIT = 256 * 1024;     // skip snapshots for a client this far behind
const DROP_BACKLOG_LIMIT = 4 * 1024 * 1024; // give up on a client this far behind
const FOOD_CHUNK = 1500;
const VIEW_MIN = 300;
const VIEW_MAX = 2600;
const VIEW_MARGIN = 140;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function sendFile(res, base, relative) {
  const file = path.resolve(base, relative.replace(/^\/+/, ''));
  if (file !== base && !file.startsWith(base + path.sep)) return reply(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    reply(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch {
    reply(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

/** Behind Nginx every socket comes from loopback, so the real address is in the header. */
function addressOf(req) {
  const remote = req.socket.remoteAddress || '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = loopback ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return forwarded || remote || 'unknown';
}

export function startServer({ port = 3400, host, seed = Date.now() >>> 0, log = console.log } = {}) {
  const world = new World({ seed });
  const clients = new Set();

  const http = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (method !== 'GET') return reply(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/health') {
      let playing = 0;
      for (const client of clients) if (client.snake?.alive) playing += 1;
      return reply(res, 200, { ok: true, online: clients.size, playing, snakes: world.snakes.size });
    }
    if (url.pathname.startsWith('/shared/')) return sendFile(res, path.join(root, 'shared'), url.pathname.slice(8));
    return sendFile(res, path.join(root, 'client'), url.pathname === '/' ? 'index.html' : url.pathname);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024, perMessageDeflate: false });

  const send = (client, bytes) => {
    const { ws } = client;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > DROP_BACKLOG_LIMIT) { ws.terminate(); return; }
    ws.send(bytes, { binary: true });
  };
  const broadcast = (bytes) => { for (const client of clients) send(client, bytes); };

  function syncNewcomer(client) {
    send(client, encodeWelcome({ you: 0, arena: ARENA_RADIUS, simHz: SIM_HZ, sendEvery: SEND_EVERY, tick: world.tick }));
    const snakes = [...world.snakes.values()];
    if (snakes.length) send(client, encodeSnakeInfo(snakes));
    const food = [...world.food.values()];
    for (let i = 0; i < food.length; i += FOOD_CHUNK) send(client, encodeFoodAdd(world.tick, food.slice(i, i + FOOD_CHUNK)));
  }

  function handle(client, message) {
    switch (message.type) {
      case CLIENT.JOIN: {
        if (client.snake?.alive) return;
        const now = Date.now();
        if (now - client.lastJoin < 700) return;
        let playing = 0;
        for (const other of clients) if (other.snake?.alive) playing += 1;
        if (playing >= MAX_PLAYERS) return;
        client.lastJoin = now;
        const snake = world.spawnSnake({
          name: cleanName(message.name),
          skin: Math.min(Math.max(0, message.skin), SKINS.length - 1),
          bot: false,
        });
        snake.owner = client;
        client.snake = snake;
        client.follow = 0;
        send(client, encodeWelcome({ you: snake.id, arena: ARENA_RADIUS, simHz: SIM_HZ, sendEvery: SEND_EVERY, tick: world.tick }));
        return;
      }
      case CLIENT.INPUT:
        if (client.snake?.alive) {
          client.snake.targetAngle = message.angle;
          client.snake.boost = message.boost;
        }
        return;
      case CLIENT.VIEW:
        client.view.halfWidth = Math.min(VIEW_MAX, Math.max(VIEW_MIN, message.halfWidth));
        client.view.halfHeight = Math.min(VIEW_MAX, Math.max(VIEW_MIN, message.halfHeight));
        return;
      case CLIENT.PING:
        send(client, encodePong(message.t));
        return;
      default:
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = addressOf(req);
    let sameIp = 0;
    for (const other of clients) if (other.ip === ip) sameIp += 1;
    if (clients.size >= MAX_CONNECTIONS || sameIp >= MAX_PER_IP) { ws.close(1013, 'Server full'); return; }

    const client = {
      ws, ip, snake: null, follow: 0, focus: { x: 0, y: 0 },
      view: { halfWidth: 900, halfHeight: 600 },
      lastJoin: 0, budget: 0, budgetAt: Date.now(), alive: true,
    };
    clients.add(client);
    syncNewcomer(client);

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      // A generous allowance — input goes out at most ~30 times a second —
      // so only a misbehaving client ever gets near it.
      const now = Date.now();
      if (now - client.budgetAt >= 1000) { client.budget = 0; client.budgetAt = now; }
      client.budget += 1;
      if (client.budget > 400) { ws.terminate(); return; }
      if (client.budget > 120) return;
      try {
        handle(client, decodeClient(data));
      } catch {
        // Malformed input is dropped; one bad packet is not worth a disconnect.
      }
    });
    ws.on('pong', () => { client.alive = true; });
    ws.on('close', () => {
      clients.delete(client);
      if (client.snake?.alive) world.kill(client.snake, LEFT_GAME);
      client.snake = null;
    });
    ws.on('error', () => {});
  });

  // Where a client's camera is pointed: their own head while alive, whoever
  // killed them afterwards, and the current leader while they sit in the menu —
  // which is why the start screen has a live game playing behind it.
  function focusOf(client) {
    const head = (snake) => ({ x: snake.points[0], y: snake.points[1] });
    if (client.snake?.alive) return (client.focus = head(client.snake));
    let target = client.follow ? world.snakes.get(client.follow) : null;
    if (!target && !client.snake) {
      const leader = world.ranking()[0];
      if (leader) { client.follow = leader.id; target = leader; }
    }
    if (target) return (client.focus = head(target));
    client.follow = 0;
    return client.focus;
  }

  function flushEvents() {
    const events = world.takeEvents();
    if (events.spawned.length) broadcast(encodeSnakeInfo(events.spawned));
    for (let i = 0; i < events.foodAdded.length; i += FOOD_CHUNK) {
      broadcast(encodeFoodAdd(world.tick, events.foodAdded.slice(i, i + FOOD_CHUNK)));
    }
    if (events.foodEaten.length) broadcast(encodeFoodEat(world.tick, events.foodEaten));
    if (events.deaths.length) {
      broadcast(encodeDeaths(world.tick, events.deaths));
      for (const death of events.deaths) {
        const owner = death.snake.owner;
        if (!owner || owner.snake !== death.snake) continue;
        send(owner, encodeYouDied({
          tick: world.tick,
          killer: death.killer,
          score: death.snake.mass,
          aliveMs: (world.tick - death.snake.bornTick) * TICK_MS,
          kills: death.snake.kills,
          bestRank: death.snake.bestRank,
        }));
        owner.follow = death.killer && death.killer !== LEFT_GAME ? death.killer : 0;
      }
    }
  }

  function sendSnapshots() {
    const blocks = new Map();
    const blockOf = (snake) => {
      let block = blocks.get(snake.id);
      if (!block) {
        block = encodeSnakeBlock({
          id: snake.id, flags: snake.boosting ? FLAG_BOOST : 0,
          angle: snake.angle, mass: snake.mass, points: snake.points,
        });
        blocks.set(snake.id, block);
      }
      return block;
    };
    for (const client of clients) {
      if (client.ws.bufferedAmount > SEND_BACKLOG_LIMIT) continue;
      const { x, y } = focusOf(client);
      const visible = world.visible(x, y, client.view.halfWidth + VIEW_MARGIN, client.view.halfHeight + VIEW_MARGIN);
      send(client, assembleSnapshot(world.tick, x, y, visible.map(blockOf)));
    }
  }

  function sendBoards() {
    const ranking = world.ranking();
    const rankOf = new Map();
    ranking.forEach((snake, i) => {
      rankOf.set(snake.id, i + 1);
      if (!snake.bestRank || i + 1 < snake.bestRank) snake.bestRank = i + 1;
    });
    const top = ranking.slice(0, 10).map((snake) => ({ id: snake.id, score: snake.mass }));
    const toByte = (v) => Math.max(0, Math.min(255, Math.round((v / ARENA_RADIUS + 1) * 127.5)));
    const dots = ranking.slice(0, 200).map((snake) => ({
      id: snake.id, x: toByte(snake.points[0]), y: toByte(snake.points[1]),
      size: Math.max(1, Math.min(255, Math.round(snake.width / 2))),
    }));
    let humans = 0;
    for (const client of clients) if (client.snake?.alive) humans += 1;
    const leaderId = ranking[0]?.id;
    for (const client of clients) {
      const you = client.snake?.alive ? client.snake : null;
      send(client, encodeBoard({
        humans, total: world.snakes.size, top,
        rank: you ? rankOf.get(you.id) : 0,
        score: you ? you.mass : 0,
        dots: dots.map((dot) => ({ ...dot, flags: (dot.id === you?.id ? 1 : 0) | (dot.id === leaderId ? 2 : 0) })),
      }));
    }
  }

  const loop = setInterval(() => {
    let humans = 0;
    for (const client of clients) if (client.snake?.alive) humans += 1;
    world.humansAlive = humans;
    world.step();
    flushEvents();
    if (world.tick % SEND_EVERY === 0) sendSnapshots();
    if (world.tick % SIM_HZ === 0) sendBoards();
  }, TICK_MS);

  // Drop sockets that stopped answering, so a phone that lost signal does not
  // leave a snake steering itself around the arena for minutes.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.ws.terminate(); continue; }
      client.alive = false;
      try { client.ws.ping(); } catch { /* already closing */ }
    }
  }, 20_000);

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      const actual = http.address().port;
      log?.(`Glowworm listening on http://localhost:${actual}`);
      resolve({
        port: actual,
        world,
        clients,
        close: () => new Promise((done) => {
          clearInterval(loop);
          clearInterval(heartbeat);
          for (const client of clients) client.ws.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // In production only Nginx should reach the game, so it listens on loopback.
  // In development it listens everywhere, so a phone on the same Wi-Fi can play.
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);
  const running = await startServer({ port: Number(process.env.PORT) || 3400, host });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { running.close().then(() => process.exit(0)); });
  }
}

// Stormwall's server: serves the client, runs matches at a fixed 30 Hz, and
// talks to browsers over one WebSocket each — JSON for the lobby and rare
// events, binary for inputs and snapshots.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Match } from './match.js';
import { TICK_MS, TICK_HZ } from '../shared/constants.js';
import { C_INPUT, C_PING, decodeClient, encodePong, Writer } from '../shared/protocol.js';
import { getWorld, MESAS } from '../shared/worldgen.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const MAX_CONNECTIONS = 220;
const MAX_PER_IP = 12;
const BACKLOG_SKIP = 512 * 1024;
const BACKLOG_DROP = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function reply(res, status, body, type = 'application/json; charset=utf-8', cache = 'no-store') {
  res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function sendFile(res, base, relative, cache) {
  const file = path.resolve(base, relative.replace(/^\/+/, ''));
  if (file !== base && !file.startsWith(base + path.sep)) return reply(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    reply(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream', cache);
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

export async function startServer({ port = 3500, host, log = console.log, seed, maxPerIp = MAX_PER_IP } = {}) {
  const base = getWorld(seed);
  const conns = new Set();
  const matches = new Set();
  let sandbox = null;
  let nextConnId = 1;
  let nextMatchId = 1;
  const pong = new Writer(16);

  const game = {
    base, conns, matches, log,
    getSandbox() {
      if (!sandbox || !matches.has(sandbox)) {
        sandbox = new Match({ id: nextMatchId++, mode: 'sandbox', seed: base.seed, log });
        // The sandbox starts at the foot of the first mesa: a gentle slope up
        // one side, a lethal drop off the others.
        const mesa = MESAS[0];
        for (let i = 0; i < 24; i++) {
          sandbox.spawnPoints.push({ x: mesa.x - mesa.r - 150 + (i % 6) * 9, z: mesa.z - 25 + Math.floor(i / 6) * 14 });
        }
        matches.add(sandbox);
      }
      return sandbox;
    },
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    if (method !== 'GET') return reply(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/health') {
      let playing = 0;
      for (const conn of conns) if (conn.player) playing++;
      return reply(res, 200, {
        ok: true, online: conns.size, playing, matches: matches.size,
        tick: [...matches].map((m) => ({ id: m.id, mode: m.mode, players: m.players.size, ...m.tickStats() })),
      });
    }
    if (url.pathname.startsWith('/shared/')) return sendFile(res, path.join(root, 'shared'), url.pathname.slice(8));
    if (url.pathname.startsWith('/vendor/')) {
      return sendFile(res, path.join(root, 'node_modules', 'three', 'build'), url.pathname.slice(8), 'public, max-age=86400');
    }
    return sendFile(res, path.join(root, 'client'), url.pathname === '/' ? 'index.html' : url.pathname);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

  function makeConn(ws, ip) {
    const conn = {
      id: nextConnId++, ws, ip, player: null, match: null, ready: false, spectating: 0,
      budget: 0, budgetAt: Date.now(), alive: true, name: 'Player',
      send(bytes) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > BACKLOG_DROP) { ws.terminate(); return; }
        ws.send(bytes, { binary: true });
      },
      sendJson(obj) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(obj));
      },
      backlogged() { return ws.bufferedAmount > BACKLOG_SKIP; },
    };
    return conn;
  }

  function joinSandbox(conn) {
    leaveMatch(conn);
    const match = game.getSandbox();
    const p = match.addPlayer({ name: conn.name, bot: false });
    const spot = match.spawnPoints[p.id % match.spawnPoints.length];
    match.placeOnGround(p, spot.x, spot.z);
    p.conn = conn;
    conn.player = p;
    conn.match = match;
    match.conns.add(conn);
    conn.sendJson({
      t: 'match', id: match.id, mode: match.mode, seed: match.seed, hash: base.hash,
      you: p.id, team: p.team, tick: match.tick, tickHz: TICK_HZ,
      roster: [...match.players.values()].map((q) => ({ id: q.id, name: q.name, team: q.team, bot: q.bot, outfit: q.outfit })),
    });
    for (const other of match.conns) if (other !== conn) other.sendJson({ t: 'joined', player: { id: p.id, name: p.name, team: p.team, bot: false, outfit: p.outfit } });
    conn.ready = true;
  }

  function leaveMatch(conn) {
    const { match, player } = conn;
    if (!match) return;
    match.conns.delete(conn);
    if (player && match.mode === 'sandbox') {
      match.removePlayer(player);
      for (const other of match.conns) other.sendJson({ t: 'left', id: player.id });
    }
    conn.player = null;
    conn.match = null;
    conn.ready = false;
  }

  function handleJson(conn, msg) {
    switch (msg.t) {
      case 'hello':
        conn.name = String(msg.name || 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';
        conn.sendJson({ t: 'welcome', conn: conn.id, hash: base.hash, seed: base.seed, tickHz: TICK_HZ });
        return;
      case 'play':
        if (msg.mode === 'sandbox') joinSandbox(conn);
        return;
      case 'leave':
        leaveMatch(conn);
        return;
      default:
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = addressOf(req);
    let sameIp = 0;
    for (const other of conns) if (other.ip === ip) sameIp++;
    if (conns.size >= MAX_CONNECTIONS || sameIp >= maxPerIp) { ws.close(1013, 'Server full'); return; }
    const conn = makeConn(ws, ip);
    conns.add(conn);

    ws.on('message', (data, isBinary) => {
      // Inputs arrive ~30 times a second; anything far beyond that is abuse.
      const now = Date.now();
      if (now - conn.budgetAt >= 1000) { conn.budget = 0; conn.budgetAt = now; }
      if (++conn.budget > 240) { ws.terminate(); return; }
      try {
        if (!isBinary) {
          if (data.length > 4096) return;
          handleJson(conn, JSON.parse(String(data)));
          return;
        }
        const msg = decodeClient(data);
        if (msg.type === C_INPUT) { if (conn.player && conn.match) conn.match.queueInput(conn.player, msg); }
        else if (msg.type === C_PING) conn.send(encodePong(pong, msg.t));
      } catch {
        // A malformed message is dropped; one bad packet is not worth a disconnect.
      }
    });
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => { conns.delete(conn); leaveMatch(conn); });
    ws.on('error', () => {});
  });

  // A fixed-rate loop that corrects its own drift: if a tick runs late, the
  // next one is scheduled sooner, and a long stall is caught up (up to a point).
  let running = true;
  let next = performance.now() + TICK_MS;
  let timer = null;
  function loop() {
    if (!running) return;
    const now = performance.now();
    let steps = 0;
    while (now >= next && steps < 4) {
      for (const match of matches) {
        try { match.step(); } catch (error) { log?.(`[match ${match.id}] tick failed: ${error.stack || error}`); }
      }
      next += TICK_MS;
      steps++;
    }
    if (now - next > 1000) next = now + TICK_MS;
    timer = setTimeout(loop, Math.max(0, next - performance.now()));
  }
  timer = setTimeout(loop, TICK_MS);

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) { conn.ws.terminate(); continue; }
      conn.alive = false;
      try { conn.ws.ping(); } catch { /* closing */ }
    }
  }, 20_000);

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      const actual = http.address().port;
      log?.(`Stormwall listening on http://localhost:${actual}`);
      resolve({
        port: actual, game, conns, matches,
        close: () => new Promise((done) => {
          running = false;
          clearTimeout(timer);
          clearInterval(heartbeat);
          for (const conn of conns) conn.ws.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // In production only Nginx should reach the game, so it listens on loopback.
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);
  const running = await startServer({ port: Number(process.env.PORT) || 3500, host });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { running.close().then(() => process.exit(0)); });
  }
}

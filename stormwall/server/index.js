// Stormwall's server: serves the client, runs matches at a fixed 30 Hz, and
// talks to browsers over one WebSocket each — JSON for the lobby and rare
// events, binary for inputs and snapshots.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Match } from './match.js';
import { Lobby } from './lobby.js';
import { AccountStore } from './accounts.js';
import { TICK_MS, TICK_HZ } from '../shared/constants.js';
import { C_INPUT, C_PING, decodeClient, encodePong, Writer } from '../shared/protocol.js';
import { getWorld } from '../shared/worldgen.js';

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

export async function startServer({ port = 3500, host, log = console.log, seed, maxPerIp = MAX_PER_IP, pregameSeconds, maxMatches, dataDir = path.join(root, 'data') } = {}) {
  const base = getWorld(seed);
  const conns = new Set();
  let sandbox = null;
  let nextConnId = 1;
  const pong = new Writer(16);
  const accounts = new AccountStore(dataDir ? path.join(dataDir, 'accounts.json') : null, { log });
  const lobby = new Lobby({
    base, log, pregameSeconds, maxMatches,
    // Humans' results go on their account: XP, coins, challenges, stats.
    onMatchCreated(match) { match.onPlayerResults = accounts.resultsHook(); },
  });
  const matches = lobby.matches;

  const game = {
    base, conns, matches, lobby, log,
    getSandbox() {
      if (!sandbox || !matches.has(sandbox)) {
        sandbox = new Match({ id: lobby.nextId++, mode: 'sandbox', seed: base.seed, log });
        // Practice starts on the flat edge of Brambleton, with houses to
        // harvest on one side and open, level ground to build on.
        const poi = base.pois.find((q) => q.name === 'Brambleton');
        for (let i = 0; i < 24; i++) {
          sandbox.spawnPoints.push({ x: poi.x - 60 + (i % 6) * 9, z: poi.z + poi.r - 8 - Math.floor(i / 6) * 4 });
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
      id: nextConnId++, ws, ip, player: null, match: null, ready: false, spectating: 0, queued: null,
      budget: 0, budgetAt: Date.now(), alive: true, name: 'Player', outfit: 0, glider: 0, pickaxe: 0,
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
      /** Puts this connection in control of a player in a match. */
      attach(match, p) {
        conn.detach();
        p.conn = conn;
        conn.player = p;
        conn.match = match;
        conn.known = null;
        conn.spectating = 0;
        match.conns.add(conn);
        conn.sendJson(match.matchMessage(p));
        if (match.phase) conn.sendJson(match.phaseMessage());
        const storm = match.stormMessage();
        if (storm) conn.sendJson(storm);
        p.invDirty = true;
        conn.ready = true;
      },
      /** Leaves the match (the player stays behind in a real match, as in the original). */
      detach() {
        const { match, player } = conn;
        if (!match) return;
        match.conns.delete(conn);
        if (player) {
          if (match.mode === 'sandbox') {
            match.removePlayer(player);
            for (const other of match.conns) other.sendJson({ t: 'left', id: player.id });
          } else if (player.conn === conn) player.conn = null;
        }
        conn.player = null;
        conn.match = null;
        conn.ready = false;
      },
    };
    return conn;
  }

  function joinSandbox(conn) {
    conn.detach();
    lobby.cancel(conn);
    const match = game.getSandbox();
    const p = match.addPlayer({ name: conn.name, bot: false, outfit: conn.outfit, glider: conn.glider, pickaxe: conn.pickaxe });
    const spot = match.spawnPoints[p.id % match.spawnPoints.length];
    match.placeOnGround(p, spot.x, spot.z);
    match.practiceLoadout(p);
    conn.attach(match, p);
    for (const other of match.conns) if (other !== conn) other.sendJson({ t: 'joined', player: match.rosterEntry(p) });
  }

  function handleJson(conn, msg) {
    switch (msg.t) {
      case 'hello': {
        const { account, token } = accounts.login(typeof msg.id === 'string' ? msg.id : '', typeof msg.token === 'string' ? msg.token : '', msg.name);
        conn.account = account;
        conn.name = account.name;
        conn.outfit = account.equipped.outfit; conn.glider = account.equipped.glider; conn.pickaxe = account.equipped.pickaxe;
        conn.sendJson({ t: 'welcome', conn: conn.id, hash: base.hash, seed: base.seed, tickHz: TICK_HZ, account: { id: account.id, token } });
        conn.sendJson(accounts.profile(account));
        return;
      }
      case 'profile':
        if (conn.account) conn.sendJson(accounts.profile(conn.account));
        return;
      case 'buy':
      case 'equip': {
        if (!conn.account) return;
        const problem = msg.t === 'buy' ? accounts.buy(conn.account, msg.kind, msg.id | 0) : accounts.equip(conn.account, msg.kind, msg.id | 0);
        if (problem) conn.sendJson({ t: 'shop', error: problem });
        const e = conn.account.equipped;
        conn.outfit = e.outfit; conn.glider = e.glider; conn.pickaxe = e.pickaxe;
        conn.sendJson(accounts.profile(conn.account));
        return;
      }
      case 'leaderboard':
        conn.sendJson(accounts.leaderboard());
        return;
      case 'queue':
        if (conn.match) return;
        lobby.enqueue(conn, msg.mode);
        return;
      case 'cancel':
        lobby.cancel(conn);
        conn.sendJson({ t: 'lobby', reason: 'cancelled' });
        return;
      case 'play':
      case 'practice':
        joinSandbox(conn);
        return;
      case 'leave':
        conn.detach();
        conn.sendJson({ t: 'lobby', reason: 'left' });
        return;
      case 'dev':
        // Development helpers, never available in production.
        if (process.env.NODE_ENV === 'production' || !conn.match || conn.match.mode !== 'sandbox') return;
        if (msg.cmd === 'storm') conn.match.startStorm(conn.match.tick, [{ wait: 15, shrink: 30, dps: 5, ratio: 0.3 }, { wait: 20, shrink: 30, dps: 10, ratio: 0 }]);
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
    ws.on('close', () => { conns.delete(conn); lobby.cancel(conn); conn.detach(); });
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
      lobby.tick();
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
        port: actual, game, conns, matches, lobby, accounts,
        close: () => new Promise((done) => {
          running = false;
          accounts.saveNow();
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
  const running = await startServer({
    port: Number(process.env.PORT) || 3500, host,
    pregameSeconds: Number(process.env.PREGAME_SECONDS) || undefined,
    maxMatches: Number(process.env.MAX_MATCHES) || undefined,
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { running.close().then(() => process.exit(0)); });
  }
}

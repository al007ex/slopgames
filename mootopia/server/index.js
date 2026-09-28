// HTTP for the client files, a WebSocket for the game, and the 9 Hz loop.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_MS, MAX_PLAYERS } from '#shared/config.js';
import { ITEMS, WEAPONS } from '#shared/items.js';
import { Game } from './game.js';
import { Bots } from './bots.js';
import { CLIENT_TABLE, decode } from '#shared/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const STATIC = { '/js/': 'client/js/', '/css/': 'client/css/', '/img/': 'client/img/', '/shared/': 'shared/' };

export function startServer({ port = 3600, host, log = console.log, seed, maxPerIp = 6, bots = 8, tick = true } = {}) {
  const game = new Game({ seed, log });
  const botManager = new Bots(game, bots);
  const perIp = new Map();
  const timing = { ticks: 0, total: 0, max: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/health') {
      const humans = [...game.players.values()].filter((x) => !x.bot);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, online: humans.length, playing: humans.filter((x) => x.alive).length, bots: game.players.size - humans.length,
        animals: game.animals.filter((a) => a.alive).length, objects: game.objects.list.length,
        avgMs: timing.ticks ? +(timing.total / timing.ticks).toFixed(2) : 0, maxMs: +timing.max.toFixed(2) }));
      return;
    }
    if (p === '/' || p === '/index.html') p = '/client/index.html';
    else {
      const prefix = Object.keys(STATIC).find((k) => p.startsWith(k));
      if (!prefix) { res.writeHead(404); res.end('not found'); return; }
      p = '/' + STATIC[prefix] + p.slice(prefix.length);
    }
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}server${path.sep}`)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const cache = file.includes(`${path.sep}img${path.sep}`) ? 'public, max-age=86400' : 'no-cache';
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.split('?')[0].endsWith('/ws')) { socket.destroy(); return; }
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    if ((perIp.get(ip) || 0) >= maxPerIp) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const humans = [...game.players.values()].filter((x) => !x.bot).length;
      if (humans >= MAX_PLAYERS) { ws.close(4000, 'full'); return; }
      perIp.set(ip, (perIp.get(ip) || 0) + 1);
      botManager.makeRoom();
      const player = game.join();
      player.socket = ws;
      game.flush(player);
      let tokens = 40; let last = Date.now();
      ws.on('message', (raw) => {
        const now = Date.now();
        tokens = Math.min(40, tokens + (now - last) * 0.06); last = now;
        if (tokens < 1) return;
        tokens -= 1;
        if (!(raw instanceof Buffer) || raw.length > 512) return;
        let msgs;
        try { msgs = decode(CLIENT_TABLE, raw); } catch { return; }
        for (const m of msgs.slice(0, 8)) handle(game, player, m);
      });
      ws.on('close', () => {
        perIp.set(ip, perIp.get(ip) - 1);
        if (perIp.get(ip) <= 0) perIp.delete(ip);
        game.leave(player);
        botManager.fill();
      });
      ws.on('error', () => {});
    });
  });

  let timer = null;
  if (tick) {
    let next = Date.now();
    const loop = () => {
      const t0 = performance.now();
      try {
        botManager.update();
        game.tick(TICK_MS);
      } catch (err) {
        log(`tick failed: ${err.stack || err}`);
      }
      const ms = performance.now() - t0;
      timing.ticks++; timing.total += ms; timing.max = Math.max(timing.max, ms);
      if (timing.ticks >= 900) { timing.ticks = 0; timing.total = 0; timing.max = 0; }
      next += TICK_MS;
      const wait = next - Date.now();
      if (wait < -1000) next = Date.now();
      timer = setTimeout(loop, Math.max(0, wait));
    };
    timer = setTimeout(loop, TICK_MS);
  }
  botManager.fill();

  server.listen(port, host);
  const close = () => new Promise((resolve) => {
    clearTimeout(timer);
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.close(() => resolve());
  });
  return { server, game, bots: botManager, close };
}

/** One decoded message from a client. Types are already fixed by the schema. */
export function handle(game, p, [type, a, b]) {
  switch (type) {
    case 'spawn':
      if (!p.alive) game.spawn(p, { name: a, skin: b });
      break;
    case 'move':
      if (p.alive) p.moveDir = a;
      break;
    case 'aim':
      if (p.alive) p.dir = a;
      break;
    case 'attack':
      if (!p.alive) break;
      p.dir = b;
      if (p.buildIndex >= 0) {
        if (a) p.build(ITEMS[p.buildIndex]);
        p.mouseState = 0; p.hits = 0;
      } else {
        p.mouseState = a ? 1 : 0;
        if (a) p.hits++;
      }
      break;
    case 'auto':
      if (p.alive) p.autoGather = !p.autoGather;
      break;
    case 'select':
      if (p.alive && (b ? WEAPONS[a] : ITEMS[a])) p.select(a, !!b);
      break;
    case 'upgrade':
      if (p.alive) p.upgrade(a === 0 ? 'weapon' : 'item', b);
      break;
    case 'buy': game.buyHat(p, a); break;
    case 'wear': game.equipHat(p, a); break;
    case 'chat': game.chat(p, a); break;
    case 'ping': game.mapPing(p); break;
    case 'clanCreate': game.createClan(p, a); break;
    case 'clanJoin': game.requestClan(p, a); break;
    case 'clanAccept': game.answerClan(p, a, true); break;
    case 'clanDecline': game.answerClan(p, a, false); break;
    case 'clanKick': game.kickFromClan(p, a); break;
    case 'clanLeave': game.leaveClan(p); break;
    default:
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3600);
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);
  const bots = process.env.BOTS !== undefined ? Number(process.env.BOTS) : 8;
  startServer({ port, host, bots });
  console.log(`Mootopia on http://${host || 'localhost'}:${port}`);
  process.on('uncaughtException', (err) => console.error('uncaught', err));
  process.on('unhandledRejection', (err) => console.error('unhandled', err));
}

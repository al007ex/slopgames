import { createServer, request as httpRequest } from 'node:http';
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PORT || 3200);
const idleMs = Number(process.env.GAME_IDLE_MS || 15 * 60_000);
const heartbeatGraceMs = 90_000;
const analyticsDir = path.join(here, 'data');
const analyticsSecret = process.env.ANALYTICS_SECRET || randomBytes(32).toString('hex');
const adminToken = process.env.ADMIN_TOKEN || '';

const games = {
  duostrike: {
    name: 'DuoStrike',
    dir: path.join(root, 'duostrike'),
    port: 3201,
    health: '/health',
    description: 'A two-player co-op arena adventure.',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  'pixel-brawl': {
    name: 'Pixel Brawl',
    dir: path.join(root, 'pixel brawl'),
    port: 3202,
    health: '/api/status',
    description: 'A rapid-fire pixel arena brawler.',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
};

const launchAttempts = new Map();
function send(res, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function remoteIp(req) { return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }
function cookie(req, name) {
  const value = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
}
function sessionCookie(req, slug, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sg_${slug}=${encodeURIComponent(token)}; Path=/; Max-Age=120; HttpOnly; SameSite=Strict${secure}`;
}
function botName(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (/googlebot/.test(ua)) return 'Googlebot';
  if (/bingbot/.test(ua)) return 'Bingbot';
  if (/duckduckbot/.test(ua)) return 'DuckDuckBot';
  if (/facebookexternalhit|facebot/.test(ua)) return 'Facebook';
  if (/twitterbot/.test(ua)) return 'Twitter';
  if (/discordbot/.test(ua)) return 'Discord';
  return /bot|crawler|spider|slurp|preview/.test(ua) ? 'Other bot' : '';
}
function visitorKey(req) {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', analyticsSecret).update(`${day}|${remoteIp(req)}|${req.headers['user-agent'] || ''}`).digest('base64url').slice(0, 22);
}
function eventDay(at = Date.now()) { return new Date(at).toISOString().slice(0, 10); }
function logEvent(event) {
  const at = Date.now();
  appendFile(path.join(analyticsDir, `${eventDay(at)}.jsonl`), `${JSON.stringify({ at, ...event })}\n`, { mode: 0o600 }).catch((error) => console.error('Analytics write failed:', error.message));
}
function logPageView(req, pathname) { logEvent({ type: 'page_view', path: pathname, visitor: visitorKey(req), bot: botName(req) || undefined }); }
function allowLaunch(req) {
  const ip = remoteIp(req); const now = Date.now();
  const attempts = (launchAttempts.get(ip) || []).filter((t) => now - t < 60_000);
  if (attempts.length >= 12) return false;
  attempts.push(now); launchAttempts.set(ip, attempts); return true;
}
function healthCheck(game) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: game.port, path: game.health, timeout: 1_000 }, (res) => {
      res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); }); req.end();
  });
}
function connectedPlayers(game) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port: game.port, path: game.health, timeout: 1_000 }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { const data = JSON.parse(body); resolve(Number(data.online || data.connections || 0)); } catch { resolve(0); } });
    });
    req.on('error', () => resolve(0)); req.on('timeout', () => { req.destroy(); resolve(0); }); req.end();
  });
}
async function waitForHealth(game) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) { if (await healthCheck(game)) return true; await new Promise((r) => setTimeout(r, 500)); }
  return false;
}
async function startGame(game) {
  if (game.state === 'running') return;
  if (game.startPromise) return game.startPromise;
  game.state = 'starting';
  game.startPromise = (async () => {
    const child = spawn('npm', ['start'], {
      cwd: game.dir, env: { ...process.env, PORT: String(game.port), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    game.process = child;
    child.stdout.on('data', (line) => process.stdout.write(`[${game.name}] ${line}`));
    child.stderr.on('data', (line) => process.stderr.write(`[${game.name}] ${line}`));
    child.on('exit', (code, signal) => {
      if (game.process === child) { game.process = null; game.state = 'stopped'; game.startPromise = null; }
      console.log(`[${game.name}] exited (${signal || code || 0})`);
    });
    if (!await waitForHealth(game)) {
      if (!child.killed) child.kill('SIGTERM');
      throw new Error(`${game.name} did not pass its health check`);
    }
    game.state = 'running'; game.lastActivity = Date.now();
  })();
  try { await game.startPromise; } catch (error) { game.state = 'stopped'; game.startPromise = null; throw error; }
}
function stopGame(game) {
  if (!game.process || game.state === 'stopped') return;
  const child = game.process; game.state = 'stopping';
  for (const [token, session] of game.sessions) finishSession(game, token, session);
  console.log(`[${game.name}] stopping after idle timeout`);
  child.kill('SIGTERM');
  setTimeout(() => { if (game.process === child && !child.killed) child.kill('SIGKILL'); }, 10_000).unref();
}
setInterval(async () => {
  const now = Date.now();
  for (const game of Object.values(games)) {
    for (const [token, session] of game.sessions) if (now - session.lastSeen > heartbeatGraceMs) finishSession(game, token, session);
    if (game.state === 'running' && game.sessions.size === 0) {
      if (await connectedPlayers(game) > 0) game.lastActivity = now;
      else if (now - game.lastActivity > idleMs) stopGame(game);
    }
  }
}, 30_000).unref();

function finishSession(game, token, session) {
  if (!game.sessions.delete(token)) return;
  const seconds = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
  logEvent({ type: 'game_session', game: Object.entries(games).find(([, value]) => value === game)?.[0], visitor: session.visitor, seconds });
}
function hasAdminAccess(req) { return Boolean(adminToken) && req.headers.authorization === `Bearer ${adminToken}`; }
async function analyticsSummary(days = 30) {
  const cutoff = Date.now() - days * 86_400_000;
  let entries = [];
  try {
    const files = (await readdir(analyticsDir)).filter((file) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(file));
    const contents = await Promise.all(files.map(async (file) => { try { return await readFile(path.join(analyticsDir, file), 'utf8'); } catch { return ''; } }));
    entries = contents.flatMap((content) => content.trim().split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean)).filter((event) => event.at >= cutoff);
  } catch { /* Fresh install: no events yet. */ }
  const views = entries.filter((event) => event.type === 'page_view');
  const botViews = views.filter((event) => event.bot);
  const sessions = entries.filter((event) => event.type === 'game_session');
  const launches = entries.filter((event) => event.type === 'game_launch');
  const byGame = Object.fromEntries(Object.keys(games).map((game) => [game, { launches: 0, sessions: 0, minutes: 0 }]));
  for (const event of launches) if (byGame[event.game]) byGame[event.game].launches++;
  for (const event of sessions) if (byGame[event.game]) { byGame[event.game].sessions++; byGame[event.game].minutes += Math.round(event.seconds / 60); }
  const daily = {};
  for (const event of views) { const day = eventDay(event.at); daily[day] ||= { views: 0, visitors: new Set(), bots: 0 }; daily[day].views++; if (event.bot) daily[day].bots++; else daily[day].visitors.add(event.visitor); }
  return {
    rangeDays: days, generatedAt: Date.now(), overview: { pageViews: views.length, uniqueVisitors: new Set(views.filter((event) => !event.bot).map((event) => event.visitor)).size, botCrawls: botViews.length, gameLaunches: launches.length, completedSessions: sessions.length, playMinutes: Math.round(sessions.reduce((sum, event) => sum + event.seconds, 0) / 60) },
    games: byGame,
    crawlers: Object.entries(botViews.reduce((result, event) => ({ ...result, [event.bot]: (result[event.bot] || 0) + 1 }), {})).map(([name, views]) => ({ name, views })),
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, views: value.views, visitors: value.visitors.size, bots: value.bots })),
  };
}

const mime = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8' };
async function staticFile(res, relative) {
  const file = path.resolve(here, 'public', relative.replace(/^\/+/, ''));
  if (!file.startsWith(path.join(here, 'public') + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try { if (!(await stat(file)).isFile()) throw new Error('not file'); send(res, 200, await readFile(file), mime[path.extname(file)] || 'application/octet-stream'); }
  catch { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); }
}
function offlinePage(game) {
  const slug = Object.entries(games).find(([, value]) => value === game)[0];
  const title = `${game.name} — play free in your browser | Slopgames`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${game.description} Play ${game.name} free in your browser on Slopgames."><link rel="canonical" href="https://slopgames.al007ex.com/${slug}/"><meta property="og:type" content="website"><meta property="og:site_name" content="Slopgames"><meta property="og:title" content="${title}"><meta property="og:description" content="${game.description}"><meta property="og:url" content="https://slopgames.al007ex.com/${slug}/"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${game.description}"><link rel="stylesheet" href="/assets/site.css"><script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoGame","name":"${game.name}","description":"${game.description}","url":"https://slopgames.al007ex.com/${slug}/","applicationCategory":"Game","operatingSystem":"Web browser","isAccessibleForFree":true}</script></head><body class="offline"><main><a class="wordmark" href="/">SLOP<span>GAMES</span></a><section class="offline-card"><p class="eyebrow">GAME SERVER SLEEPING</p><h1>${game.name}</h1><p>${game.description} Start a fresh game server when you are ready to play.</p><button data-launch="${slug}">Launch game</button><p class="small">The server automatically sleeps after 15 minutes without active players.</p></section></main><script src="/assets/site.js"></script></body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) return staticFile(res, url.pathname.slice(8));
  if (req.method === 'GET' && url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nAllow: /\nSitemap: https://slopgames.al007ex.com/sitemap.xml\n', 'text/plain; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/sitemap.xml') return send(res, 200, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://slopgames.al007ex.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url><url><loc>https://slopgames.al007ex.com/duostrike/</loc><changefreq>weekly</changefreq><priority>0.9</priority></url><url><loc>https://slopgames.al007ex.com/pixel-brawl/</loc><changefreq>weekly</changefreq><priority>0.9</priority></url></urlset>', 'application/xml; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/admin') return staticFile(res, 'admin.html');
  if (req.method === 'GET' && url.pathname === '/api/admin/stats') { if (!hasAdminAccess(req)) return send(res, 401, { error: 'Unauthorized' }); return send(res, 200, await analyticsSummary(Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30)))); }
  if (req.method === 'GET' && url.pathname.startsWith('/__game-offline/')) {
    const game = games[url.pathname.split('/').pop()];
    if (!game) return send(res, 404, { error: 'Game not found' });
    logPageView(req, `/${Object.entries(games).find(([, value]) => value === game)[0]}/`);
    return send(res, 200, offlinePage(game), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/games') return send(res, 200, { games: Object.entries(games).map(([slug, g]) => ({ slug, name: g.name, state: g.state, players: g.sessions.size })) });
  const match = url.pathname.match(/^\/api\/games\/([a-z-]+)\/(launch|heartbeat)$/);
  if (req.method === 'POST' && match) {
    const game = games[match[1]]; if (!game) return send(res, 404, { error: 'Game not found' });
    if (match[2] === 'launch') {
      if (!allowLaunch(req)) return send(res, 429, { error: 'Please wait a moment before launching again.' });
      const token = randomBytes(24).toString('base64url'); game.sessions.set(token, { startedAt: Date.now(), lastSeen: Date.now(), visitor: visitorKey(req) }); game.lastActivity = Date.now();
      try { await startGame(game); logEvent({ type: 'game_launch', game: match[1], visitor: visitorKey(req) }); return send(res, 200, { ok: true, token, url: `/${match[1]}/` }, undefined, { 'set-cookie': sessionCookie(req, match[1], token) }); }
      catch (error) { game.sessions.delete(token); return send(res, 503, { error: 'The game server could not start. Please try again shortly.' }); }
    }
    const token = req.headers['x-game-session'] || cookie(req, `sg_${match[1]}`);
    if (typeof token === 'string' && game.sessions.has(token)) { game.sessions.get(token).lastSeen = Date.now(); game.lastActivity = Date.now(); return send(res, 204, '', undefined, { 'set-cookie': sessionCookie(req, match[1], token) }); }
    return send(res, 401, { error: 'Session expired' });
  }
  if (req.method === 'GET' && url.pathname === '/') { logPageView(req, '/'); return staticFile(res, 'index.html'); }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});
await mkdir(analyticsDir, { recursive: true, mode: 0o700 });
server.listen(port, '127.0.0.1', () => console.log(`Slopgames portal listening on 127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const game of Object.values(games)) stopGame(game); server.close(() => process.exit(0)); });

import { createServer, request as httpRequest } from 'node:http';
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PORT || 3200);
const idleMs = Number(process.env.GAME_IDLE_MS || 15 * 60_000);
const heartbeatGraceMs = 90_000;
const analyticsDir = path.join(here, 'data');
const publicDir = path.join(here, 'public');
const analyticsSecret = process.env.ANALYTICS_SECRET || randomBytes(32).toString('hex');
const adminToken = process.env.ADMIN_TOKEN || '';
const origin = process.env.SITE_ORIGIN || 'https://slopgames.al007ex.com';

// One entry per game. `dir`, `port` and `health` drive the launcher; the rest is
// presentation, so adding a game to the arcade means adding an object here.
const games = {
  sideways: {
    name: 'Sideways',
    dir: path.join(root, 'sideways'),
    port: 3207,
    health: '/health',
    description: 'Street drifting, takeovers and track drifting in one night city.',
    blurb: 'Throw it sideways through downtown, own the intersection with donuts, rollbacks and flames while the crowd goes wild, then get judged on the harbor circuit. Easy to drift on a keyboard, deep enough to master.',
    art: '/assets/art/sideways.jpg',
    tags: ['racing', 'drifting', '3d', 'solo'],
    players: 'SOLO · 3D',
    fresh: true,
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  mootopia: {
    name: 'Mootopia',
    dir: path.join(root, 'mootopia'),
    port: 3206,
    health: '/health',
    description: 'A cosy top-down gather, build and fight .io game.',
    blurb: 'Chop trees, mine stone and gold, age up and build a windmill village, then defend it. Clans, hats, a boss bear and fast, smooth PvP, with bots keeping the fields busy.',
    art: '/assets/art/mootopia.jpg',
    tags: ['io', 'building', 'pvp', 'multiplayer'],
    players: 'LIVE MULTIPLAYER',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  stormwall: {
    name: 'Stormwall',
    dir: path.join(root, 'stormwall'),
    port: 3205,
    health: '/health',
    description: 'A 100-player build-and-shoot battle royale.',
    blurb: 'Drop from the blimp, harvest everything, throw up walls and ramps in a heartbeat, and be the last one standing as the storm closes in. Solo, duos or squads, with bots filling every empty seat.',
    art: '/assets/art/stormwall.jpg',
    tags: ['battle royale', 'building', 'shooter', 'multiplayer'],
    players: '100-PLAYER BATTLE ROYALE',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  glowworm: {
    name: 'Glowworm',
    dir: path.join(root, 'glowworm'),
    port: 3204,
    health: '/health',
    description: 'A multiplayer neon snake game for desktop and mobile.',
    blurb: 'Eat the light, cut other worms off and grow as long as you can. Live multiplayer in the slither.io mould, with mouse, keyboard or touch.',
    art: '/assets/art/glowworm.jpg',
    tags: ['multiplayer', 'io', 'snake'],
    players: 'LIVE MULTIPLAYER',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  duostrike: {
    name: 'DuoStrike',
    dir: path.join(root, 'duostrike'),
    port: 3201,
    health: '/health',
    description: 'A two-player co-op arena adventure.',
    blurb: 'Bring a friend, clear the arena, and do not leave your teammate behind. Krunker-style movement meets co-op objectives.',
    art: '/assets/art/duostrike.jpg',
    tags: ['co-op', 'shooter', 'multiplayer'],
    players: '2 PLAYERS',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  'pixel-brawl': {
    name: 'Pixel Brawl',
    dir: path.join(root, 'pixel brawl'),
    port: 3202,
    health: '/api/status',
    description: 'A rapid-fire pixel arena brawler.',
    blurb: 'Pick a brawler, queue up, and take the arena one round at a time. Gem Grab, Showdown, Bounty and Duels, solo or against players.',
    art: '/assets/art/pixel-brawl.jpg',
    tags: ['brawler', 'pixel', 'multiplayer', 'solo'],
    players: 'SOLO OR ONLINE',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
  'circuit-breaker': {
    name: 'Circuit Breaker',
    dir: path.join(root, 'circuit-breaker'),
    port: 3203,
    health: '/health',
    description: 'A neon maze tower defence with overheating towers.',
    blurb: 'Bend the route, then manage the heat. Every tower shuts down if you push it, and Overclock buys five seconds of doubled fire for a guaranteed shutdown after.',
    art: '/assets/art/circuit-breaker.jpg',
    tags: ['strategy', 'tower defence', 'solo'],
    players: 'SOLO',
    state: 'stopped', process: null, sessions: new Map(), lastActivity: 0, startPromise: null,
  },
};

const slugOf = (game) => Object.keys(games).find((slug) => games[slug] === game);

const launchAttempts = new Map();
function send(res, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...extraHeaders,
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
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
// Every game runs in its own process group. `npm start` wraps the real server
// in one or more extra processes (npm, cross-env, tsx…), and a signal sent to npm
// alone does not reliably reach the server underneath: it was being orphaned,
// kept its port, and went on serving old code long after it was "stopped".
// Signalling the group reaches every process in it.
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch { return false; }
}
async function startGame(game) {
  if (game.state === 'running') return;
  if (game.startPromise) return game.startPromise;
  game.state = 'starting';
  game.startPromise = (async () => {
    const child = spawn('npm', ['start'], {
      cwd: game.dir, env: { ...process.env, PORT: String(game.port), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    game.process = child;
    child.stdout.on('data', (line) => process.stdout.write(`[${game.name}] ${line}`));
    child.stderr.on('data', (line) => process.stderr.write(`[${game.name}] ${line}`));
    child.on('exit', (code, signal) => {
      if (game.process === child) { game.process = null; game.state = 'stopped'; game.startPromise = null; }
      console.log(`[${game.name}] exited (${signal || code || 0})`);
    });
    if (!await waitForHealth(game)) {
      signalGroup(child.pid, 'SIGTERM');
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
  signalGroup(child.pid, 'SIGTERM');
  // Whatever is still alive in the group ten seconds later is killed outright.
  // This deliberately checks the group rather than npm: npm exiting while the
  // server underneath carries on is the exact failure being guarded against.
  const pid = child.pid;
  setTimeout(() => signalGroup(pid, 'SIGKILL'), 10_000).unref();
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
  logEvent({ type: 'game_session', game: slugOf(game), visitor: session.visitor, seconds });
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

/* ------------------------------------------------------------ rendering */
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const favicon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23090b14'/><text x='16' y='23' font-size='19' font-family='monospace' font-weight='bold' fill='%23d9ff55' text-anchor='middle'>S</text></svg>";

function head({ title, description, url, image }) {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#090b14">`
    + `<title>${escape(title)}</title><meta name="description" content="${escape(description)}">`
    + `<link rel="canonical" href="${escape(url)}"><link rel="icon" href="${favicon}">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Slopgames">`
    + `<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}">`
    + (image ? `<meta property="og:image" content="${escape(origin + image)}"><meta name="twitter:image" content="${escape(origin + image)}">` : '')
    + `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">`
    + `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="/assets/site.css">`;
}

const wordmark = '<a class="wordmark" href="/">SLOP<span>GAMES</span></a>';

// Art is served with a long cache lifetime, so its URL carries a content hash;
// replacing an image changes the URL and the browser fetches the new one.
const assetVersions = new Map();
function asset(relative) {
  if (!assetVersions.has(relative)) {
    try {
      const bytes = readFileSync(path.join(publicDir, relative.replace(/^\/assets\//, '')));
      assetVersions.set(relative, `${relative}?v=${createHash('sha1').update(bytes).digest('hex').slice(0, 10)}`);
    } catch { assetVersions.set(relative, relative); }
  }
  return assetVersions.get(relative);
}

const ICONS = {
  new: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.6 6.2 20.1l1.6-6.5L2.7 9.2l6.7-.5z"/></svg>',
  multi: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 19c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6z"/><path d="M14.2 19c0-1.9-.6-3.5-1.7-4.7.9-.6 2.2-1 3.6-1 2.8 0 5.3 2 5.3 5.7z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

/** One game tile. `size` is 'big', 'small' or 'mini'. */
function tile(slug, game, size = 'small', eager = false) {
  const multi = game.tags.includes('multiplayer');
  const badge = game.fresh ? `<span class="tile-badge new" title="New">${ICONS.new}</span>`
    : multi ? `<span class="tile-badge multi" title="Multiplayer">${ICONS.multi}</span>` : '';
  return `<a class="tile ${size}" href="/${slug}/" data-launch="${slug}" data-slug="${slug}" data-name="${escape(game.name)}" data-tags="${game.tags.join(',')}" aria-label="Play ${escape(game.name)}">`
    + `<img src="${asset(game.art)}" width="1200" height="675" alt=""${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`
    + badge
    + `<span class="tile-live" hidden><i></i><b></b></span>`
    + `<span class="tile-name">${escape(game.name)}</span></a>`;
}

function homePage() {
  const entries = Object.entries(games);
  // Only categories with a few games in them earn a chip.
  const counts = {};
  for (const [, game] of entries) for (const tag of game.tags) counts[tag] = (counts[tag] || 0) + 1;
  const tags = Object.keys(counts).filter((tag) => counts[tag] >= 2).sort((a, b) => counts[b] - counts[a]);
  const names = entries.map(([, game]) => game.name);
  const description = `Free browser games, no download: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.`;
  const picks = entries.slice(0, 6);
  const together = entries.filter(([, game]) => game.tags.includes('multiplayer'));

  return `<!doctype html><html lang="en"><head>${head({
    title: 'Slopgames — free browser games, no download',
    description,
    url: `${origin}/`,
    image: asset(entries[0][1].art),
  })}<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Slopgames',
    url: `${origin}/`,
    description,
    hasPart: entries.map(([slug, game]) => ({
      '@type': 'VideoGame', name: game.name, description: game.description,
      url: `${origin}/${slug}/`, image: origin + asset(game.art),
      applicationCategory: 'Game', operatingSystem: 'Web browser', isAccessibleForFree: true,
    })),
  })}</script></head><body>
<header class="site-header"><div class="bar">${wordmark}
<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
<input id="search" type="search" placeholder="Search" aria-label="Search games" autocomplete="off"></label></div>
<nav class="cats bar" aria-label="Categories"><button class="chip" data-tag="all" aria-pressed="true">All</button>${tags.map((tag) => `<button class="chip" data-tag="${escape(tag)}" aria-pressed="false">${escape(tag)}</button>`).join('')}</nav></header>
<main class="bar">
<section class="row" id="continue" hidden><h2>Continue playing ${ICONS.chevron}</h2><div class="strip minis"></div></section>
<section class="row" id="picks"><h2>Top picks for you</h2><div class="picks">${picks.map(([slug, game], i) => tile(slug, game, i === 0 || i === picks.length - 1 ? 'big' : 'small', i < 3)).join('')}</div></section>
<section class="row" id="featured"><h2>Featured games</h2><div class="strip">${entries.map(([slug, game]) => tile(slug, game)).join('')}</div></section>
${together.length ? `<section class="row" id="together"><h2>Play with friends</h2><div class="strip">${together.map(([slug, game]) => tile(slug, game)).join('')}</div></section>` : ''}
<section class="row" id="results" hidden><h2 id="results-title">All games</h2><div class="grid">${entries.map(([slug, game]) => tile(slug, game)).join('')}</div><p class="empty" id="no-results" hidden>Nothing matches that.</p></section>
</main>
<footer class="bar">${wordmark}</footer>

<div class="launcher" id="launcher" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="launch-title">
<div class="launcher-box"><button class="close" aria-label="Close game">×</button>
<h2 id="launch-title">Loading…</h2><p id="launch-text"></p>
<div class="progress"><i></i></div>
<div class="embed-actions"><button id="full-screen">Fullscreen</button><button class="close">Back</button></div>
<iframe id="game-frame" title="Game" allow="fullscreen; autoplay; gamepad; pointer-lock" allowfullscreen></iframe></div></div>
<script src="/assets/site.js"></script></body></html>`;
}

function offlinePage(game) {
  const slug = slugOf(game);
  const title = `${game.name} — play free in your browser | Slopgames`;
  return `<!doctype html><html lang="en"><head>${head({
    title,
    description: `${game.description} Play ${game.name} free in your browser on Slopgames.`,
    url: `${origin}/${slug}/`,
    image: asset(game.art),
  })}<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'VideoGame', name: game.name, description: game.description,
    url: `${origin}/${slug}/`, image: origin + asset(game.art),
    applicationCategory: 'Game', operatingSystem: 'Web browser', isAccessibleForFree: true,
  })}</script></head><body class="offline"><main>${wordmark}
<section class="offline-card"><img class="offline-art" src="${asset(game.art)}" width="1200" height="675" alt="${escape(game.name)} key art" fetchpriority="high">
<h1>${escape(game.name)}</h1>
<button data-launch="${slug}">Play</button></section>
</main><script src="/assets/site.js"></script></body></html>`;
}

/* --------------------------------------------------------- static assets */
const mime = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8' };
async function staticFile(res, relative, cache = false) {
  const file = path.resolve(publicDir, relative.replace(/^\/+/, ''));
  if (!file.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    send(res, 200, await readFile(file), mime[path.extname(file)] || 'application/octet-stream',
      cache ? { 'cache-control': 'public, max-age=604800' } : {});
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  // Crawlers and uptime checks send HEAD; Node drops the body for those itself,
  // so every GET route can answer them unchanged.
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method === 'GET' && url.pathname.startsWith('/assets/')) {
    return staticFile(res, url.pathname.slice(8), url.pathname.startsWith('/assets/art/'));
  }
  if (method === 'GET' && url.pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  if (method === 'GET' && url.pathname === '/sitemap.xml') {
    const urls = [`${origin}/`, ...Object.keys(games).map((slug) => `${origin}/${slug}/`)];
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((loc, index) => `<url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${index === 0 ? '1.0' : '0.9'}</priority></url>`).join('')}</urlset>`, 'application/xml; charset=utf-8');
  }
  if (method === 'GET' && url.pathname === '/admin') return staticFile(res, 'admin.html');
  if (method === 'GET' && url.pathname === '/api/admin/stats') { if (!hasAdminAccess(req)) return send(res, 401, { error: 'Unauthorized' }); return send(res, 200, await analyticsSummary(Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30)))); }
  if (method === 'GET' && url.pathname.startsWith('/__game-offline/')) {
    const game = games[url.pathname.split('/').pop()];
    if (!game) return send(res, 404, { error: 'Game not found' });
    logPageView(req, `/${slugOf(game)}/`);
    return send(res, 200, offlinePage(game), 'text/html; charset=utf-8');
  }
  if (method === 'GET' && url.pathname === '/api/games') {
    return send(res, 200, { games: Object.entries(games).map(([slug, game]) => ({
      slug, name: game.name, state: game.state, players: game.sessions.size,
      description: game.description, blurb: game.blurb, art: game.art, tags: game.tags,
    })) });
  }
  const match = url.pathname.match(/^\/api\/games\/([a-z-]+)\/(launch|heartbeat)$/);
  if (method === 'POST' && match) {
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
  if (method === 'GET' && url.pathname === '/') { logPageView(req, '/'); return send(res, 200, homePage(), 'text/html; charset=utf-8'); }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});
await mkdir(analyticsDir, { recursive: true, mode: 0o700 });
server.listen(port, '127.0.0.1', () => console.log(`Slopgames portal listening on 127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const game of Object.values(games)) stopGame(game); server.close(() => process.exit(0)); });

import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { games } from './games.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3200);
const idleMs = Number(process.env.GAME_IDLE_MS || 15 * 60_000);
const heartbeatGraceMs = 90_000;
const publicDir = path.join(here, 'public');
const origin = process.env.SITE_ORIGIN || 'https://slopgames.al007ex.com';
const siteName = 'Slopgames';

// Anything specific to whoever runs the site (visitor statistics, ads, legal
// pages, search console tags) lives outside this repository, in a module that
// SLOPGAMES_EXTENSION points at. Without one the portal runs exactly as it is.
// A module may export any of:
//   init({ games, origin, layout, escape })  once, at start-up
//   handle(req, res, url)                    true if it answered the request
//   head(page), slot(name, page)             HTML for the <head> and named slots
//   event(type, data, req)                   page views, launches, play sessions
//   sitemap()                                extra [{ path, priority }] entries
const extension = process.env.SLOPGAMES_EXTENSION
  ? await import(pathToFileURL(path.resolve(process.env.SLOPGAMES_EXTENSION)).href)
  : {};
function hook(name, ...args) {
  try { return extension[name]?.(...args); } catch (error) { console.error(`Extension ${name}() failed:`, error.message); return undefined; }
}
function slot(name, page) {
  const html = hook('slot', name, page);
  return html ? `<div class="slot slot-${name}">${html}</div>` : '';
}

const slugOf = (game) => Object.keys(games).find((slug) => games[slug] === game);

/* ------------------------------------------------------------ launcher */
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
function html(res, status, body) { send(res, status, body, 'text/html; charset=utf-8', { 'cache-control': 'no-cache' }); }
function remoteIp(req) { return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }
function cookie(req, name) {
  const value = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
}
function sessionCookie(req, slug, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sg_${slug}=${encodeURIComponent(token)}; Path=/; Max-Age=120; HttpOnly; SameSite=Strict${secure}`;
}
function allowLaunch(req) {
  const ip = remoteIp(req); const now = Date.now();
  const attempts = (launchAttempts.get(ip) || []).filter((t) => now - t < 60_000);
  if (attempts.length >= 12) return false;
  attempts.push(now); launchAttempts.set(ip, attempts); return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of launchAttempts) if (!attempts.some((t) => now - t < 60_000)) launchAttempts.delete(ip);
}, 60_000).unref();
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
  // Played until the last heartbeat, not until the session timed out.
  const seconds = Math.max(0, Math.round((session.lastSeen - session.startedAt) / 1000));
  hook('event', 'game_session', { game: slugOf(game), seconds, launch: session.launch });
}

/* ------------------------------------------------------------ rendering */
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const json = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

// Everything under /assets/ is served for a year, so its URL carries a hash of
// the file: replacing a file changes the URL and browsers fetch the new one.
const assetVersions = new Map();
function asset(relative) {
  if (!assetVersions.has(relative)) {
    try {
      const bytes = readFileSync(path.join(publicDir, relative.replace(/^\/assets\//, '')));
      assetVersions.set(relative, `${relative}?v=${createHash('sha1').update(bytes).digest('hex').slice(0, 10)}`);
    } catch { assetVersions.set(relative, null); }
  }
  return assetVersions.get(relative) ?? relative;
}
const hasAsset = (relative) => { asset(relative); return assetVersions.get(relative) !== null; };

// Each piece of art comes in three WebP widths next to the original JPEG, and
// a 1200×630 link-preview version. A game added without them still works: its
// tiles use the JPEG and its previews use the art as it is.
const artWidths = [480, 800, 1200];
function srcset(art) {
  const files = artWidths.map((w) => [art.replace(/\.jpg$/, `-${w}.webp`), w]);
  return files.every(([file]) => hasAsset(file)) ? files.map(([file, w]) => `${asset(file)} ${w}w`).join(', ') : '';
}
const srcsetAttrs = (art, sizes) => { const set = srcset(art); return set ? ` srcset="${set}" sizes="${sizes}"` : ''; };
const preloadArt = (art, sizes) => { const set = srcset(art); return `<link rel="preload" as="image" href="${asset(art)}"${set ? ` imagesrcset="${set}" imagesizes="${sizes}"` : ''} fetchpriority="high">`; };
const ogImage = (slug, art) => (hasAsset(`/assets/og/${slug}.jpg`) ? `/assets/og/${slug}.jpg` : art);

// Categories are the tags that more than one game shares.
const tagLabels = { io: '.io', solo: 'Single player', '3d': '3D', pvp: 'PvP', 'co-op': 'Co-op' };
const tagLabel = (tag) => tagLabels[tag] || tag[0].toUpperCase() + tag.slice(1);
const tagSlug = (tag) => (tag === 'solo' ? 'single-player' : tag.replace(/\s+/g, '-'));
const categories = (() => {
  const counts = {};
  for (const game of Object.values(games)) for (const tag of game.tags) counts[tag] = (counts[tag] || 0) + 1;
  return Object.keys(counts).filter((tag) => counts[tag] >= 2).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
})();
const categoryOf = (game) => game.tags.find((tag) => categories.includes(tag));
const inCategory = (tag) => Object.entries(games).filter(([, game]) => game.tags.includes(tag));

const ICONS = {
  new: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.6 6.2 20.1l1.6-6.5L2.7 9.2l6.7-.5z"/></svg>',
  multi: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 19c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6z"/><path d="M14.2 19c0-1.9-.6-3.5-1.7-4.7.9-.6 2.2-1 3.6-1 2.8 0 5.3 2 5.3 5.7z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

const wordmark = '<a class="wordmark" href="/">SLOP<span>GAMES</span></a>';

function head({ title, description, url, image, imageAlt, kind, slug, preload = '', noindex = false, data = null }) {
  const img = image ? origin + asset(image) : '';
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0d0e1b">`
    + `<title>${escape(title)}</title><meta name="description" content="${escape(description)}">`
    + `<link rel="canonical" href="${escape(url)}">`
    + `<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">`
    + `<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml">`
    + `<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${siteName}"><meta property="og:locale" content="en_US">`
    + `<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}">`
    + (img ? `<meta property="og:image" content="${escape(img)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="${image.startsWith('/assets/og/') ? 630 : 675}"><meta property="og:image:alt" content="${escape(imageAlt || title)}">` : '')
    + `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">`
    + (img ? `<meta name="twitter:image" content="${escape(img)}"><meta name="twitter:image:alt" content="${escape(imageAlt || title)}">` : '')
    + `<link rel="preload" href="${asset('/assets/fonts/nunito-800.woff2')}" as="font" type="font/woff2" crossorigin>`
    + preload
    + `<link rel="stylesheet" href="${asset('/assets/site.css')}">`
    + (data ? `<script type="application/ld+json">${json(data)}</script>` : '')
    + (hook('head', { kind, slug, url }) || '');
}

function header(active = '') {
  return `<header class="site-header"><div class="bar">${wordmark}
<form class="search" action="/" method="get" role="search">${ICONS.search}
<input id="search" name="q" type="search" placeholder="Search games" aria-label="Search games" autocomplete="off"></form></div>
<nav class="cats bar" aria-label="Categories"><a class="chip" href="/"${active === '' ? ' aria-current="page"' : ''}>All</a>${categories.map((tag) => `<a class="chip" href="/category/${tagSlug(tag)}"${active === tag ? ' aria-current="page"' : ''}>${escape(tagLabel(tag))}</a>`).join('')}</nav></header>`;
}

function footer(page) {
  const links = hook('slot', 'footer', page) || '';
  return `${slot('bottom', page)}<footer class="site-footer"><div class="bar">
<div class="foot-top">${wordmark}<nav aria-label="Games">${Object.entries(games).map(([slug, game]) => `<a href="/games/${slug}">${escape(game.name)}</a>`).join('')}</nav></div>
<div class="foot-bottom"><nav aria-label="Categories">${categories.map((tag) => `<a href="/category/${tagSlug(tag)}">${escape(tagLabel(tag))} games</a>`).join('')}</nav>
${links ? `<nav class="foot-site" aria-label="Site">${links}</nav>` : ''}<p>© ${new Date().getFullYear()} ${siteName}</p></div>
</div></footer>`;
}

/** One game tile. `size` is 'big', 'small', 'mini' or 'grid', and picks the image width. */
const tileSizes = {
  big: '(max-width: 720px) 100vw, 34vw',
  small: '(max-width: 720px) 50vw, 17vw',
  strip: '(max-width: 720px) 62vw, (max-width: 1100px) 25vw, 17vw',
  mini: '132px',
  grid: '(max-width: 720px) 100vw, 25vw',
};
function tile(slug, game, size = 'strip', eager = false) {
  const multi = game.tags.includes('multiplayer');
  const badge = game.fresh ? `<span class="tile-badge new" title="New">${ICONS.new}</span>`
    : multi ? `<span class="tile-badge multi" title="Multiplayer">${ICONS.multi}</span>` : '';
  return `<a class="tile ${size === 'strip' || size === 'grid' ? '' : size}" href="/games/${slug}" data-launch="${slug}" data-slug="${slug}" data-name="${escape(game.name)}" data-tags="${escape(game.tags.join(','))}">`
    + `<img src="${asset(game.art)}"${srcsetAttrs(game.art, tileSizes[size])} width="1200" height="675" alt="${escape(`${game.name}: ${game.headline}`)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`
    + badge
    + `<span class="tile-live" hidden><i></i><b></b></span>`
    + `<span class="tile-name">${escape(game.name)}</span></a>`;
}

function layout({ title, description, path: pagePath, body, kind = 'page', slug, image, imageAlt, preload, noindex, data, active }) {
  const page = { kind, slug, path: pagePath };
  return `<!doctype html><html lang="en"><head>${head({ title, description, url: origin + pagePath, image, imageAlt, kind, slug, preload, noindex, data })}</head><body class="${kind}">
${header(active)}
${slot('top', page)}
<main class="bar">${body}</main>
${footer(page)}
<script src="${asset('/assets/site.js')}" defer></script></body></html>`;
}

const organization = { '@type': 'Organization', '@id': `${origin}/#org`, name: siteName, url: `${origin}/`, logo: { '@type': 'ImageObject', url: `${origin}/icon-512.png`, width: 512, height: 512 } };
const website = { '@type': 'WebSite', '@id': `${origin}/#website`, name: siteName, alternateName: 'Slopgames arcade', url: `${origin}/`, inLanguage: 'en', publisher: { '@id': `${origin}/#org` } };
const crumbs = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: origin + url })),
});

function homePage() {
  const entries = Object.entries(games);
  const names = entries.map(([, game]) => game.name);
  const description = `Free browser games with no download: drifting, .io, battle royale, co-op and tower defence. ${names.slice(0, 3).join(', ')} and more.`;
  const picks = entries.slice(0, 6);
  const together = entries.filter(([, game]) => game.tags.includes('multiplayer'));
  const first = picks[0][1];
  return layout({
    title: `${siteName}: Free Browser Games, No Download`,
    description,
    path: '/',
    kind: 'home',
    image: ogImage('home', first.art),
    imageAlt: `${siteName}: ${names.join(', ')}`,
    preload: preloadArt(first.art, tileSizes.big),
    data: {
      '@context': 'https://schema.org',
      '@graph': [
        organization, website,
        { '@type': 'CollectionPage', '@id': `${origin}/#page`, url: `${origin}/`, name: `${siteName}: Free Browser Games`, description, isPartOf: { '@id': `${origin}/#website` },
          mainEntity: { '@type': 'ItemList', itemListElement: entries.map(([slug, game], i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/games/${slug}`, name: game.name })) } },
      ],
    },
    body: `<h1 class="sr-only">${siteName}: free browser games</h1>
<section class="row" id="continue" hidden><h2>Continue playing ${ICONS.chevron}</h2><div class="strip minis"></div></section>
<section class="row" id="picks"><h2>Top picks for you</h2><div class="picks">${picks.map(([slug, game], i) => tile(slug, game, i === 0 || i === picks.length - 1 ? 'big' : 'small', i < 3)).join('')}</div></section>
<section class="row" id="featured"><h2>Featured games</h2><div class="strip">${entries.map(([slug, game]) => tile(slug, game)).join('')}</div></section>
${together.length ? `<section class="row" id="together"><h2>Play with friends</h2><div class="strip">${together.map(([slug, game]) => tile(slug, game)).join('')}</div></section>` : ''}
<section class="row" id="results" hidden><h2 id="results-title">Results</h2><div class="grid">${entries.map(([slug, game]) => tile(slug, game, 'grid')).join('')}</div><p class="empty" id="no-results" hidden>Nothing matches that.</p></section>
${launcher()}`,
  });
}

function launcher() {
  return `<div class="launcher" id="launcher" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="launch-title">
<div class="launcher-box"><button class="close" aria-label="Close game">×</button>
<h2 id="launch-title">Loading…</h2><p id="launch-text"></p>
<div class="progress"><i></i></div>
<div class="embed-actions"><button id="full-screen">Fullscreen</button><button class="close">Back</button></div>
<iframe id="game-frame" title="Game" allow="fullscreen; autoplay; gamepad; pointer-lock" allowfullscreen></iframe></div></div>`;
}

const dateLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function gamePage(slug) {
  const game = games[slug];
  const url = `/games/${slug}`;
  const category = categoryOf(game);
  const title = `${game.name}: ${game.headline}, Play Free Online | ${siteName}`;
  const others = Object.entries(games).filter(([other]) => other !== slug);
  const side = slot('game-side', { kind: 'game', slug, path: url });
  const modes = game.modes?.length ? `<h2>${escape(game.modesTitle || 'How to play')}</h2><dl class="modes">${game.modes.map(([name, text]) => `<div><dt>${escape(name)}</dt><dd>${escape(text)}</dd></div>`).join('')}</dl>` : '';
  const tips = game.tips?.length ? `<h2>Tips</h2><ul class="tips">${game.tips.map((tip) => `<li>${escape(tip)}</li>`).join('')}</ul>` : '';
  const trail = [['Home', '/'], ...(category ? [[`${tagLabel(category)} games`, `/category/${tagSlug(category)}`]] : []), [game.name, url]];
  return layout({
    title: title.length > 62 ? `${game.name}: ${game.headline} | ${siteName}` : title,
    description: game.description,
    path: url,
    kind: 'game',
    slug,
    image: ogImage(slug, game.art),
    imageAlt: `${game.name}: ${game.headline}`,
    preload: preloadArt(game.art, '(max-width: 1100px) 100vw, 1100px'),
    data: {
      '@context': 'https://schema.org',
      '@graph': [
        organization, website,
        { '@type': 'WebPage', '@id': `${origin}${url}#page`, url: origin + url, name: title, description: game.description,
          isPartOf: { '@id': `${origin}/#website` }, primaryImageOfPage: origin + asset(game.art), breadcrumb: { '@id': `${origin}${url}#crumbs` }, mainEntity: { '@id': `${origin}${url}#game` } },
        { '@id': `${origin}${url}#crumbs`, ...crumbs(trail) },
        {
          '@type': 'VideoGame', '@id': `${origin}${url}#game`, name: game.name, alternateName: `${game.name}: ${game.headline}`,
          url: origin + url, description: game.description, image: origin + asset(game.art),
          genre: game.genre, keywords: game.tags.join(', '), playMode: `https://schema.org/${game.playMode}`,
          gamePlatform: ['Web browser', 'PC', ...(/touch|phone/i.test(game.devices) ? ['Mobile'] : [])],
          applicationCategory: 'GameApplication', operatingSystem: 'Any (web browser)', inLanguage: 'en',
          isAccessibleForFree: true, offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
          datePublished: game.published, dateModified: game.updated, publisher: { '@id': `${origin}/#org` }, author: { '@id': `${origin}/#org` },
        },
      ],
    },
    active: category,
    body: `<nav class="crumbs" aria-label="Breadcrumb">${trail.map(([name, href], i) => (i < trail.length - 1 ? `<a href="${href}">${escape(name)}</a><span aria-hidden="true">›</span>` : `<span aria-current="page">${escape(name)}</span>`)).join('')}</nav>
<div class="stage-wrap${side ? ' with-side' : ''}"><section class="player" aria-label="${escape(game.name)}">
<div class="stage" id="stage" data-slug="${slug}" data-name="${escape(game.name)}">
<img class="stage-art" src="${asset(game.art)}"${srcsetAttrs(game.art, '(max-width: 1100px) 100vw, 1100px')} width="1200" height="675" alt="${escape(`${game.name} gameplay`)}" fetchpriority="high">
<div class="stage-cover"><button class="play" data-launch="${slug}" aria-label="Play ${escape(game.name)}">${ICONS.play}<span>Play</span></button><p class="stage-status" aria-live="polite"></p></div>
<iframe class="stage-frame" title="${escape(game.name)}" allow="fullscreen; autoplay; gamepad; pointer-lock" allowfullscreen hidden></iframe>
</div>
<div class="stage-bar"><h1>${escape(game.name)} <span>${escape(game.headline)}</span></h1>
<span class="stage-live" hidden><i></i><b></b></span>
<button class="stage-full" type="button" data-fullscreen hidden>${ICONS.expand}<span>Fullscreen</span></button></div>
</section>${side}</div>
${slot('game-below', { kind: 'game', slug, path: url })}
<div class="about"><article class="about-main">
<h2>About ${escape(game.name)}</h2>${game.about.map((p) => `<p>${escape(p)}</p>`).join('')}
${modes}
<h2>Controls</h2><table class="controls"><tbody>${game.controls.map(([keys, action]) => `<tr><th scope="row">${escape(keys)}</th><td>${escape(action)}</td></tr>`).join('')}</tbody></table>
${tips}
</article>
<aside class="facts" aria-label="Details"><dl>
<div><dt>Players</dt><dd>${escape(game.players)}</dd></div>
<div><dt>Plays with</dt><dd>${escape(game.devices)}</dd></div>
<div><dt>Genre</dt><dd>${escape(game.genre.join(', '))}</dd></div>
<div><dt>Added</dt><dd><time datetime="${game.published}">${dateLabel(game.published)}</time></dd></div>
<div><dt>Updated</dt><dd><time datetime="${game.updated}">${dateLabel(game.updated)}</time></dd></div>
<div><dt>Price</dt><dd>Free, in your browser</dd></div>
</dl><div class="facts-tags">${game.tags.map((tag) => (categories.includes(tag) ? `<a class="chip" href="/category/${tagSlug(tag)}">${escape(tagLabel(tag))}</a>` : `<span class="chip">${escape(tagLabel(tag))}</span>`)).join('')}</div></aside></div>
<section class="row" id="more"><h2>More games</h2><div class="strip">${others.map(([other, g]) => tile(other, g)).join('')}</div></section>`,
  });
}

function categoryPage(tag) {
  const list = inCategory(tag);
  const label = tagLabel(tag);
  const url = `/category/${tagSlug(tag)}`;
  const description = `${list.length} free ${label.toLowerCase()} games to play in your browser, no download: ${list.map(([, game]) => game.name).join(', ')}.`;
  return layout({
    title: `${label} Games: Play Free Online | ${siteName}`,
    description,
    path: url,
    kind: 'category',
    image: ogImage(list[0][0], list[0][1].art),
    imageAlt: `${label} games on ${siteName}`,
    active: tag,
    data: {
      '@context': 'https://schema.org',
      '@graph': [
        organization, website,
        { '@type': 'CollectionPage', '@id': `${origin}${url}#page`, url: origin + url, name: `${label} games`, description, isPartOf: { '@id': `${origin}/#website` },
          breadcrumb: crumbs([['Home', '/'], [`${label} games`, url]]),
          mainEntity: { '@type': 'ItemList', itemListElement: list.map(([slug, game], i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/games/${slug}`, name: game.name })) } },
      ],
    },
    body: `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><span aria-current="page">${escape(label)} games</span></nav>
<section class="row"><h1 class="page-title">${escape(label)} games</h1><div class="grid">${list.map(([slug, game], i) => tile(slug, game, 'grid', i < 2)).join('')}</div></section>
<section class="row"><h2>More games</h2><div class="strip">${Object.entries(games).filter(([, game]) => !game.tags.includes(tag)).map(([slug, game]) => tile(slug, game)).join('')}</div></section>
${launcher()}`,
  });
}

function notFoundPage(pathname) {
  return layout({
    title: `Page not found | ${siteName}`,
    description: 'That page is not here. Pick a game instead.',
    path: pathname,
    kind: 'missing',
    noindex: true,
    body: `<section class="row"><h1 class="page-title">That page is not here</h1><p class="lead">Pick a game instead.</p>
<div class="grid">${Object.entries(games).map(([slug, game]) => tile(slug, game, 'grid')).join('')}</div></section>${launcher()}`,
  });
}

function sitemap() {
  const newest = Object.values(games).map((game) => game.updated).sort().at(-1);
  const urls = [
    { loc: '/', lastmod: newest, priority: '1.0' },
    ...Object.entries(games).map(([slug, game]) => ({ loc: `/games/${slug}`, lastmod: game.updated, priority: '0.9', image: game.art, title: game.name })),
    ...categories.map((tag) => ({ loc: `/category/${tagSlug(tag)}`, lastmod: inCategory(tag).map(([, game]) => game.updated).sort().at(-1), priority: '0.7' })),
    ...(hook('sitemap') || []).map((entry) => ({ loc: entry.path, priority: entry.priority || '0.3', lastmod: entry.lastmod })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`
    + urls.map((u) => `<url><loc>${escape(origin + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority>`
      + (u.image ? `<image:image><image:loc>${escape(origin + u.image)}</image:loc></image:image>` : '') + '</url>').join('\n')
    + '\n</urlset>\n';
}

function manifest() {
  return {
    name: siteName, short_name: siteName, description: 'Free browser games, no download.',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#0d0e1b', theme_color: '#0d0e1b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/* --------------------------------------------------------- static assets */
const mime = {
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
async function staticFile(res, relative, cache) {
  const file = path.resolve(publicDir, relative.replace(/^\/+/, ''));
  if (!file.startsWith(publicDir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    send(res, 200, await readFile(file), mime[path.extname(file)] || 'application/octet-stream', { 'cache-control': cache });
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}
const rootFiles = { '/favicon.ico': 'icons/favicon.ico', '/favicon.svg': 'icons/favicon.svg', '/apple-touch-icon.png': 'icons/apple-touch-icon.png', '/icon-192.png': 'icons/icon-192.png', '/icon-512.png': 'icons/icon-512.png', '/icon-maskable.png': 'icons/icon-maskable.png' };

/* ---------------------------------------------------------------- routes */
function pageView(req, pathname, kind, slug) { hook('event', 'page_view', { path: pathname, kind, game: slug }, req); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  // Crawlers and uptime checks send HEAD; Node drops the body for those itself,
  // so every GET route can answer them unchanged.
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const { pathname } = url;

  if (method === 'GET' && pathname.startsWith('/assets/')) {
    // Versioned URLs never change; the rest is cached for an hour.
    return staticFile(res, pathname.slice(8), url.searchParams.has('v') || pathname.startsWith('/assets/fonts/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  }
  if (method === 'GET' && rootFiles[pathname]) return staticFile(res, rootFiles[pathname], 'public, max-age=86400');
  if (method === 'GET' && pathname === '/site.webmanifest') return send(res, 200, manifest(), 'application/manifest+json; charset=utf-8', { 'cache-control': 'public, max-age=86400' });

  if (extension.handle) {
    try { if (await extension.handle(req, res, url)) return; } catch (error) { console.error('Extension handle() failed:', error.message); }
  }

  if (method === 'GET' && pathname === '/robots.txt') {
    return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /__game-offline/\n\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
  }
  if (method === 'GET' && pathname === '/sitemap.xml') return send(res, 200, sitemap(), 'application/xml; charset=utf-8', { 'cache-control': 'public, max-age=3600' });

  // A game whose server is asleep: Nginx hands the request here. Its page has
  // the Play button that wakes it.
  if (method === 'GET' && pathname.startsWith('/__game-offline/')) {
    const slug = pathname.split('/').pop();
    if (!games[slug]) return html(res, 404, notFoundPage(pathname));
    return send(res, 302, '', 'text/plain; charset=utf-8', { location: `/games/${slug}` });
  }
  if (method === 'GET' && (pathname === '/games' || pathname === '/games/')) return send(res, 301, '', 'text/plain; charset=utf-8', { location: '/' });
  const pageMatch = pathname.match(/^\/games\/([a-z0-9-]+)(\/?)$/);
  if (method === 'GET' && pageMatch && games[pageMatch[1]]) {
    if (pageMatch[2]) return send(res, 301, '', 'text/plain; charset=utf-8', { location: `/games/${pageMatch[1]}${url.search}` });
    pageView(req, pathname, 'game', pageMatch[1]);
    return html(res, 200, gamePage(pageMatch[1]));
  }
  const categoryMatch = pathname.match(/^\/category\/([a-z0-9-]+)\/?$/);
  const category = categoryMatch && categories.find((tag) => tagSlug(tag) === categoryMatch[1]);
  if (method === 'GET' && category) {
    pageView(req, pathname, 'category');
    return html(res, 200, categoryPage(category));
  }

  if (method === 'GET' && pathname === '/api/games') {
    return send(res, 200, { games: Object.entries(games).map(([slug, game]) => ({ slug, name: game.name, state: game.state, players: game.sessions.size })) });
  }
  const match = pathname.match(/^\/api\/games\/([a-z-]+)\/(launch|heartbeat)$/);
  if (method === 'POST' && match) {
    const game = games[match[1]]; if (!game) return send(res, 404, { error: 'Game not found' });
    if (match[2] === 'launch') {
      if (!allowLaunch(req)) return send(res, 429, { error: 'Please wait a moment before launching again.' });
      const token = randomBytes(24).toString('base64url');
      const session = { startedAt: Date.now(), lastSeen: Date.now() };
      game.sessions.set(token, session); game.lastActivity = Date.now();
      try {
        await startGame(game);
        session.launch = hook('event', 'game_launch', { game: match[1] }, req);
        return send(res, 200, { ok: true, token, url: `/${match[1]}/` }, undefined, { 'set-cookie': sessionCookie(req, match[1], token) });
      } catch { game.sessions.delete(token); return send(res, 503, { error: 'The game server could not start. Please try again shortly.' }); }
    }
    const token = req.headers['x-game-session'] || cookie(req, `sg_${match[1]}`);
    if (typeof token === 'string' && game.sessions.has(token)) { game.sessions.get(token).lastSeen = Date.now(); game.lastActivity = Date.now(); return send(res, 204, '', undefined, { 'set-cookie': sessionCookie(req, match[1], token) }); }
    return send(res, 401, { error: 'Session expired' });
  }
  if (method === 'GET' && pathname === '/') { pageView(req, '/', 'home'); return html(res, 200, homePage()); }
  if (method === 'GET') return html(res, 404, notFoundPage(pathname));
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

hook('init', { games, origin, layout, escape, asset });
server.listen(port, '127.0.0.1', () => console.log(`Slopgames portal listening on 127.0.0.1:${port}${extension.handle || extension.event ? ' (with extension)' : ''}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const game of Object.values(games)) stopGame(game); server.close(() => process.exit(0)); });

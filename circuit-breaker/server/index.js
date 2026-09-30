// Circuit Breaker's server. The game itself runs entirely in the browser, so
// there is very little for this to do: hand over the client and the shared
// modules, answer the portal's health check, and keep a small high-score board.
//
// It deliberately has no dependencies — there is nothing to npm install before
// this game will run, which is one less thing to go wrong on deploy.

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WAVES } from '../shared/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PORT || 3300);
const dataDir = path.join(root, 'data');
const scoresFile = path.join(dataDir, 'scores.json');
const MAX_SCORES = 50;

// The portal stops a game server once nobody is playing, so it needs a number
// to look at. A browser pings /api/ping while a run is open and anything seen in
// the last two minutes counts as present.
const seen = new Map();
const PRESENCE_MS = 120_000;
function online() {
  const cutoff = Date.now() - PRESENCE_MS;
  for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
  return seen.size;
}

let scores = [];
async function loadScores() {
  try {
    scores = JSON.parse(await readFile(scoresFile, 'utf8'));
    if (!Array.isArray(scores)) scores = [];
  } catch {
    scores = []; // First run: nobody has finished a game yet.
  }
}
async function saveScores() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(scoresFile, JSON.stringify(scores), 'utf8');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** Serve a file from `base`, refusing anything that climbs out of it. */
async function sendFile(res, base, relative) {
  const file = path.resolve(base, relative.replace(/^\/+/, ''));
  if (file !== base && !file.startsWith(base + path.sep)) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const clean = (value, max) => String(value ?? '').replace(/[^\w \-]/g, '').trim().slice(0, max);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = url.pathname;

  if (method === 'GET' && route === '/health') {
    return send(res, 200, { ok: true, online: online(), waves: WAVES.length });
  }

  if (method === 'POST' && route === '/api/ping') {
    const id = clean(url.searchParams.get('id'), 40) || req.socket.remoteAddress || 'anon';
    seen.set(id, Date.now());
    return send(res, 204, '');
  }

  if (method === 'GET' && route === '/api/scores') {
    return send(res, 200, { scores: scores.slice(0, 20) });
  }

  if (method === 'POST' && route === '/api/scores') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'Bad request.' });
    }
    const name = clean(payload.name, 14) || 'anon';
    // The simulation runs on the player's machine, so this board is a local
    // scoreboard rather than an authority. Values are clamped to what a real
    // run could produce so a stray or silly number cannot wreck the display.
    const wave = Math.max(0, Math.min(WAVES.length, Math.floor(Number(payload.wave) || 0)));
    const score = Math.max(0, Math.min(1_000_000, Math.floor(Number(payload.score) || 0)));
    const entry = { name, score, wave, at: Date.now() };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, MAX_SCORES);
    saveScores().catch((error) => console.error('Could not save scores:', error.message));
    return send(res, 200, { ok: true, rank: scores.indexOf(entry) + 1, scores: scores.slice(0, 20) });
  }

  // Shared modules are imported by the client with the #shared/ specifier, which
  // the import map in index.html points here.
  if (method === 'GET' && route.startsWith('/shared/')) {
    return sendFile(res, path.join(root, 'shared'), route.slice('/shared/'.length));
  }

  if (method === 'GET') {
    const relative = route === '/' ? 'index.html' : route;
    return sendFile(res, path.join(root, 'client'), relative);
  }

  send(res, 404, { error: 'Not found' });
});

await loadScores();
server.listen(port, () => console.log(`Circuit Breaker listening on http://localhost:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

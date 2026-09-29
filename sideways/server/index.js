// Sideways' server. The game runs entirely in the browser, so this hands over
// the client, the shared simulation and three.js, answers the portal's health
// check, and keeps three small high-score boards (streets, takeover, circuit).

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PORT || 3207);
const dataDir = path.join(root, 'data');
const scoresFile = path.join(dataDir, 'scores.json');
const BOARDS = { street: 5_000_000, takeover: 5_000_000, track: 100 };
const KEEP = 50;

// The portal stops the server once nobody is playing; a browser pings while a
// session is open and anything seen in the last two minutes counts as present.
const seen = new Map();
const PRESENCE_MS = 120_000;
function online() {
  const cutoff = Date.now() - PRESENCE_MS;
  for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
  return seen.size;
}

let scores = { street: [], takeover: [], track: [] };
async function loadScores() {
  try {
    const saved = JSON.parse(await readFile(scoresFile, 'utf8'));
    for (const board of Object.keys(BOARDS)) if (Array.isArray(saved[board])) scores[board] = saved[board];
  } catch {
    // First run: no boards yet.
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
async function sendFile(res, base, relative, cache = 'no-store') {
  const file = path.resolve(base, relative.replace(/^\/+/, ''));
  if (file !== base && !file.startsWith(base + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream', { 'cache-control': cache });
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

function readBody(req, limit = 2048) {
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
const three = path.join(root, 'node_modules', 'three');

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = url.pathname;

  if (method === 'GET' && route === '/health') return send(res, 200, { ok: true, online: online() });

  if (method === 'POST' && route === '/api/ping') {
    const id = clean(url.searchParams.get('id'), 40) || req.socket.remoteAddress || 'anon';
    seen.set(id, Date.now());
    return send(res, 204, '');
  }

  if (method === 'GET' && route === '/api/scores') {
    const out = {};
    for (const board of Object.keys(BOARDS)) out[board] = scores[board].slice(0, 10);
    return send(res, 200, out);
  }

  if (method === 'POST' && route === '/api/scores') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Bad request.' }); }
    const board = Object.hasOwn(BOARDS, payload.board) ? payload.board : null;
    if (!board) return send(res, 400, { error: 'Unknown board.' });
    // The simulation runs on the player's machine, so this is a friendly
    // scoreboard, not an authority: values are clamped to what a run could make.
    const name = clean(payload.name, 14) || 'anon';
    const score = Math.max(0, Math.min(BOARDS[board], Math.floor(Number(payload.score) || 0)));
    const car = clean(payload.car, 10);
    const entry = { name, score, car, at: Date.now() };
    scores[board].push(entry);
    scores[board].sort((a, b) => b.score - a.score);
    scores[board] = scores[board].slice(0, KEEP);
    saveScores().catch((error) => console.error('Could not save scores:', error.message));
    return send(res, 200, { ok: true, rank: scores[board].indexOf(entry) + 1, scores: scores[board].slice(0, 10) });
  }

  if (method === 'GET' && route.startsWith('/shared/')) return sendFile(res, path.join(root, 'shared'), route.slice(8));
  // three.js straight from its package: the build, and the add-ons it ships.
  if (method === 'GET' && route.startsWith('/vendor/')) return sendFile(res, path.join(three, 'build'), route.slice(8), 'public, max-age=86400');
  if (method === 'GET' && route.startsWith('/addons/')) return sendFile(res, path.join(three, 'examples', 'jsm'), route.slice(8), 'public, max-age=86400');

  if (method === 'GET') return sendFile(res, path.join(root, 'client'), route === '/' ? 'index.html' : route);

  send(res, 404, { error: 'Not found' });
});

await loadScores();
server.listen(port, () => console.log(`Sideways listening on http://localhost:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));

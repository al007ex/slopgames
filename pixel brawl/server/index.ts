import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import { WebSocketServer, WebSocket } from 'ws';

import { BRAWLERS, STARTER_BRAWLER } from '../shared/brawlers.js';
import { GameMode, MODES, MODE_LIST } from '../shared/constants.js';
import type { InputCmd, MatchResultRow } from '../shared/types.js';
import { Room, type RoomMember } from './room.js';
import { loadDb, markDirty, store, type Account } from './store.js';
import {
  applyMatchResult,
  botName,
  buy,
  claimRoad,
  ensureBrawlers,
  FREE_BOX_COOLDOWN,
  highestTrophies,
  SHOP,
  totalTrophies,
  TROPHY_ROAD,
  upgrade,
} from './progression.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const PROD = process.env.NODE_ENV === 'production';

loadDb();

/* --------------------------------- auth ---------------------------------- */

function sign(id: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const body = `${id}.${exp}`;
  const sig = crypto.createHmac('sha256', store.secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string | undefined): Account | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expect = crypto.createHmac('sha256', store.secret()).update(`${id}.${exp}`).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (Number(exp) < Date.now()) return null;
  const acc = store.get(id);
  if (acc) ensureBrawlers(acc);
  return acc ?? null;
}

function profileOf(acc: Account) {
  ensureBrawlers(acc);
  const now = Date.now();
  return {
    id: acc.id,
    name: acc.name,
    coins: acc.coins,
    gems: acc.gems,
    tokens: acc.tokens,
    exp: acc.exp,
    selected: acc.selected,
    brawlers: acc.brawlers,
    trophies: totalTrophies(acc),
    highest: highestTrophies(acc),
    roadClaimed: acc.roadClaimed,
    stats: acc.stats,
    freeBoxIn: Math.max(0, acc.lastFreeBox + FREE_BOX_COOLDOWN - now),
  };
}

/* --------------------------------- http ---------------------------------- */

const app = express();
app.use(express.json({ limit: '64kb' }));

function auth(req: express.Request): Account | null {
  const h = req.headers.authorization;
  return verify(h?.startsWith('Bearer ') ? h.slice(7) : undefined);
}

const NAME_RE = /^[A-Za-z0-9_.-]{3,14}$/;

app.post('/api/register', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!NAME_RE.test(name)) return res.status(400).json({ error: '3-14 letters, numbers, _ . - only' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (store.byName(name)) return res.status(409).json({ error: 'That name is taken' });

  const acc: Account = {
    id: crypto.randomUUID(),
    name,
    lower: name.toLowerCase(),
    hash: bcrypt.hashSync(password, 10),
    created: Date.now(),
    lastSeen: Date.now(),
    coins: 120,
    gems: 25,
    tokens: 60,
    exp: 0,
    selected: STARTER_BRAWLER,
    brawlers: {},
    roadClaimed: 0,
    stats: { games: 0, wins: 0, kills: 0 },
    lastFreeBox: 0,
  };
  ensureBrawlers(acc);
  store.create(acc);
  res.json({ token: sign(acc.id), profile: profileOf(acc) });
});

app.post('/api/login', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  const acc = store.byName(name);
  if (!acc || !bcrypt.compareSync(password, acc.hash)) return res.status(401).json({ error: 'Wrong name or password' });
  acc.lastSeen = Date.now();
  markDirty();
  res.json({ token: sign(acc.id), profile: profileOf(acc) });
});

app.get('/api/profile', (req, res) => {
  const acc = auth(req);
  if (!acc) return res.status(401).json({ error: 'Not signed in' });
  res.json({ profile: profileOf(acc) });
});

app.post('/api/select', (req, res) => {
  const acc = auth(req);
  if (!acc) return res.status(401).json({ error: 'Not signed in' });
  const id = String(req.body?.brawler ?? '');
  if (!acc.brawlers[id]?.unlocked) return res.status(400).json({ error: 'Brawler not unlocked' });
  acc.selected = id;
  markDirty();
  res.json({ profile: profileOf(acc) });
});

app.post('/api/upgrade', (req, res) => {
  const acc = auth(req);
  if (!acc) return res.status(401).json({ error: 'Not signed in' });
  const r = upgrade(acc, String(req.body?.brawler ?? ''));
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ profile: profileOf(acc) });
});

app.post('/api/shop/buy', (req, res) => {
  const acc = auth(req);
  if (!acc) return res.status(401).json({ error: 'Not signed in' });
  const r = buy(acc, String(req.body?.item ?? ''));
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ rewards: r.rewards, profile: profileOf(acc) });
});

app.get('/api/shop', (req, res) => {
  res.json({ items: SHOP });
});

app.post('/api/road/claim', (req, res) => {
  const acc = auth(req);
  if (!acc) return res.status(401).json({ error: 'Not signed in' });
  const rewards = claimRoad(acc);
  res.json({ rewards, profile: profileOf(acc) });
});

app.get('/api/road', (req, res) => {
  res.json({ stops: TROPHY_ROAD });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = store
    .all()
    .map((a) => ({ name: a.name, trophies: totalTrophies(a), wins: a.stats.wins, games: a.stats.games }))
    .sort((a, b) => b.trophies - a.trophies)
    .slice(0, 50);
  res.json({ rows, online: conns.size });
});

app.get('/api/status', (req, res) => {
  res.json({
    online: conns.size,
    inQueue: [...conns.values()].filter((c) => c.queue).length,
    matches: rooms.size,
    accounts: store.count(),
  });
});

if (PROD) {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);

/* ------------------------------- websocket -------------------------------- */

interface Party {
  code: string;
  members: Conn[];
  leaderId: string;
}

interface Conn {
  id: string;
  ws: WebSocket;
  acc: Account | null;
  room: Room | null;
  slot: number;
  queue: { mode: GameMode; vsBots: boolean; since: number } | null;
  party: Party | null;
  alive: boolean;
}

const conns = new Map<string, Conn>();
const rooms = new Map<string, Room>();
const parties = new Map<string, Party>();

const wss = new WebSocketServer({ server, path: '/ws' });

function send(c: Conn, msg: unknown) {
  if (c.ws.readyState === WebSocket.OPEN) {
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {
      /* socket died mid-write */
    }
  }
}

function partyPayload(p: Party) {
  return {
    t: 'party',
    code: p.code,
    leader: p.leaderId,
    members: p.members.map((m) => ({
      id: m.id,
      name: m.acc?.name ?? '???',
      brawler: m.acc?.selected ?? STARTER_BRAWLER,
      trophies: m.acc ? totalTrophies(m.acc) : 0,
    })),
  };
}

function broadcastParty(p: Party) {
  for (const m of p.members) send(m, partyPayload(p));
}

function leaveParty(c: Conn) {
  const p = c.party;
  if (!p) return;
  p.members = p.members.filter((m) => m !== c);
  c.party = null;
  send(c, { t: 'party', code: null, members: [] });
  if (!p.members.length) parties.delete(p.code);
  else {
    if (p.leaderId === c.id) p.leaderId = p.members[0].id;
    broadcastParty(p);
  }
}

wss.on('connection', (ws) => {
  const c: Conn = {
    id: crypto.randomUUID(),
    ws,
    acc: null,
    room: null,
    slot: -1,
    queue: null,
    party: null,
    alive: true,
  };
  conns.set(c.id, c);

  ws.on('pong', () => (c.alive = true));

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    handle(c, msg);
  });

  ws.on('close', () => {
    if (c.room) c.room.disconnect(c.acc?.id ?? c.id);
    leaveParty(c);
    conns.delete(c.id);
  });
});

setInterval(() => {
  for (const c of conns.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    try {
      c.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 20000).unref?.();

function handle(c: Conn, msg: any) {
  switch (msg?.t) {
    case 'auth': {
      const acc = verify(msg.token);
      if (!acc) return send(c, { t: 'auth_fail' });
      // one live connection per account
      for (const other of conns.values()) {
        if (other !== c && other.acc?.id === acc.id) {
          send(other, { t: 'kicked' });
          other.ws.close();
        }
      }
      c.acc = acc;
      send(c, { t: 'auth_ok', profile: profileOf(acc) });
      break;
    }

    case 'queue': {
      if (!c.acc || c.room) return;
      const mode = String(msg.mode) as GameMode;
      if (!MODES[mode]) return;
      const vsBots = !!msg.vsBots;
      const party = c.party;
      if (party && party.leaderId !== c.id) return send(c, { t: 'error', msg: 'Only the party leader can start' });
      const group = party ? party.members : [c];
      for (const m of group) {
        if (!m.acc || m.room) continue;
        m.queue = { mode, vsBots, since: Date.now() };
        send(m, { t: 'queue_start', mode, vsBots });
      }
      break;
    }

    case 'cancel': {
      const group = c.party && c.party.leaderId === c.id ? c.party.members : [c];
      for (const m of group) {
        m.queue = null;
        send(m, { t: 'queue_cancel' });
      }
      break;
    }

    case 'input': {
      if (!c.room || c.slot < 0) return;
      const cmd: InputCmd = {
        seq: msg.q | 0,
        mx: clamp1(msg.mx),
        my: clamp1(msg.my),
        ax: clamp1(msg.ax),
        ay: clamp1(msg.ay),
        ad: Math.max(0, Math.min(1, Number(msg.ad) || 0)),
        shoot: !!msg.f,
        useSuper: !!msg.s,
      };
      c.room.input(c.slot, cmd);
      break;
    }

    case 'leave': {
      if (c.room) {
        c.room.disconnect(c.acc?.id ?? c.id);
        c.room = null;
        c.slot = -1;
      }
      c.queue = null;
      break;
    }

    case 'select': {
      if (!c.acc) return;
      const id = String(msg.brawler ?? '');
      if (c.acc.brawlers[id]?.unlocked) {
        c.acc.selected = id;
        markDirty();
        if (c.party) broadcastParty(c.party);
      }
      break;
    }

    case 'refresh': {
      if (c.acc) send(c, { t: 'profile', profile: profileOf(c.acc) });
      break;
    }

    /* ------------------------------ parties ----------------------------- */

    case 'party_create': {
      if (!c.acc) return;
      leaveParty(c);
      let code = '';
      do {
        code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
      } while (parties.has(code));
      const p: Party = { code, members: [c], leaderId: c.id };
      parties.set(code, p);
      c.party = p;
      broadcastParty(p);
      break;
    }

    case 'party_join': {
      if (!c.acc) return;
      const code = String(msg.code ?? '').toUpperCase().trim();
      const p = parties.get(code);
      if (!p) return send(c, { t: 'error', msg: 'No party with that code' });
      if (p.members.length >= 4) return send(c, { t: 'error', msg: 'That party is full' });
      leaveParty(c);
      p.members.push(c);
      c.party = p;
      broadcastParty(p);
      break;
    }

    case 'party_leave': {
      leaveParty(c);
      break;
    }

    case 'ping':
      send(c, { t: 'pong', ts: msg.ts });
      break;
  }
}

function clamp1(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

/* ------------------------------ matchmaking ------------------------------- */

const HUMAN_WAIT_MS = 9000;

function pickBotBrawler(): string {
  return BRAWLERS[Math.floor(Math.random() * BRAWLERS.length)].id;
}

function makeBotMember(index: number, avgTrophies: number, avgLevel: number): RoomMember {
  return {
    uid: 'bot-' + index + '-' + Math.random().toString(36).slice(2, 7),
    name: botName(index),
    brawler: pickBotBrawler(),
    level: Math.max(1, Math.min(9, Math.round(avgLevel + (Math.random() < 0.5 ? 0 : 1)))),
    trophies: Math.max(0, Math.round(avgTrophies * (0.75 + Math.random() * 0.5))),
    send: null,
    connected: false,
  };
}

function memberFor(c: Conn): RoomMember {
  const acc = c.acc!;
  ensureBrawlers(acc);
  const st = acc.brawlers[acc.selected];
  return {
    uid: acc.id,
    name: acc.name,
    brawler: acc.selected,
    level: st?.level ?? 1,
    trophies: st?.trophies ?? 0,
    send: (m) => send(c, m),
    connected: true,
  };
}

/** Groups queued connections into party-sized blobs so friends land on one team. */
function queueGroups(mode: GameMode, vsBots: boolean): Conn[][] {
  const seen = new Set<string>();
  const groups: Conn[][] = [];
  const entries = [...conns.values()]
    .filter((c) => c.queue && c.queue.mode === mode && c.queue.vsBots === vsBots && c.acc && !c.room)
    .sort((a, b) => (a.queue!.since || 0) - (b.queue!.since || 0));

  for (const c of entries) {
    if (seen.has(c.id)) continue;
    if (c.party) {
      const mates = c.party.members.filter((m) => m.queue && m.queue.mode === mode && m.queue.vsBots === vsBots && !m.room);
      mates.forEach((m) => seen.add(m.id));
      if (mates.length) groups.push(mates);
    } else {
      seen.add(c.id);
      groups.push([c]);
    }
  }
  return groups;
}

function startMatch(mode: GameMode, humanGroups: Conn[][]) {
  const info = MODES[mode];
  const slots: { member: RoomMember; team: number; bot: boolean; difficulty: number; conn?: Conn }[] = [];

  const humans = humanGroups.flat();
  const avgTrophies = humans.length
    ? humans.reduce((s, c) => s + (c.acc!.brawlers[c.acc!.selected]?.trophies ?? 0), 0) / humans.length
    : 0;
  const avgLevel = humans.length
    ? humans.reduce((s, c) => s + (c.acc!.brawlers[c.acc!.selected]?.level ?? 1), 0) / humans.length
    : 1;
  const difficulty = Math.max(0.4, Math.min(0.95, 0.45 + avgTrophies / 900));

  if (info.teams === info.players) {
    // free-for-all: everyone gets their own team
    let team = 0;
    for (const g of humanGroups) for (const c of g) slots.push({ member: memberFor(c), team: team++, bot: false, difficulty, conn: c });
    let bi = 0;
    while (slots.length < info.players) slots.push({ member: makeBotMember(bi++, avgTrophies, avgLevel), team: team++, bot: true, difficulty });
  } else {
    const teamCounts = new Array(info.teams).fill(0);
    const place = (m: RoomMember, bot: boolean, conn?: Conn, preferred = -1) => {
      let team = preferred;
      if (team < 0 || teamCounts[team] >= info.teamSize) {
        team = teamCounts.indexOf(Math.min(...teamCounts));
      }
      teamCounts[team]++;
      slots.push({ member: m, team, bot, difficulty, conn });
    };
    // keep parties together
    for (const g of humanGroups) {
      const team = teamCounts.indexOf(Math.min(...teamCounts));
      for (const c of g) place(memberFor(c), false, c, teamCounts[team] < info.teamSize ? team : -1);
    }
    let bi = 0;
    while (slots.length < info.players) place(makeBotMember(bi++, avgTrophies, avgLevel), true);
  }

  const room = new Room({
    mode,
    seed: (Math.random() * 0xffffffff) >>> 0,
    members: slots.map((s) => ({ member: s.member, team: s.team, bot: s.bot, difficulty: s.difficulty })),
    onFinish: finishRoom,
  });

  slots.forEach((s, i) => {
    if (!s.conn) return;
    s.conn.room = room;
    s.conn.slot = i;
    s.conn.queue = null;
  });

  rooms.set(room.id, room);
  room.start();
  console.log(`[match] ${room.id} ${mode} — ${humans.length} human / ${slots.length - humans.length} bot`);
}

function finishRoom(room: Room, rows: MatchResultRow[]) {
  const info = MODES[room.mode];

  // Work out trophy changes first so everyone sees the same table. Per-player
  // payouts stay in a side map — they must not ride along in the shared rows.
  const payouts = new Map<number, { trophies: number; tokens: number; coins: number; exp: number }>();
  for (const row of rows) {
    const member = room.members[row.slot];
    const acc = member && !row.bot ? store.get(member.uid) : null;
    if (!acc) continue;
    const res = applyMatchResult(acc, member.brawler, room.mode, row.rank, rows.length, row.kills);
    row.trophyDelta = res.trophies;
    payouts.set(row.slot, res);
  }

  for (let slot = 0; slot < room.members.length; slot++) {
    const member = room.members[slot];
    if (!member.send) continue;
    const row = rows[slot];
    const acc = store.get(member.uid);
    const result =
      room.mode === GameMode.Showdown
        ? row.rank <= 3
          ? 'victory'
          : 'defeat'
        : row.rank === 1
          ? 'victory'
          : row.rank === 2
            ? 'draw'
            : 'defeat';
    const rewards = payouts.get(slot) ?? { trophies: 0, tokens: 0, coins: 0, exp: 0 };
    member.send({
      t: 'match_over',
      result,
      you: slot,
      rows,
      rewards,
      profile: acc ? profileOf(acc) : null,
    });
  }

  setTimeout(() => {
    room.stop();
    rooms.delete(room.id);
    for (const c of conns.values()) {
      if (c.room === room) {
        c.room = null;
        c.slot = -1;
      }
    }
  }, 6000);
}

setInterval(() => {
  for (const mode of MODE_LIST.map((m) => m.id)) {
    const info = MODES[mode];

    // AI matches start as soon as the queue tick comes round
    const botGroups = queueGroups(mode, true);
    if (botGroups.length) {
      let taken: Conn[][] = [];
      let count = 0;
      for (const g of botGroups) {
        if (count + g.length > info.players) break;
        taken.push(g);
        count += g.length;
        if (count >= info.players) break;
      }
      if (taken.length) startMatch(mode, taken);
    }

    // human queue: fill up, or top off with bots once people have waited
    let humanGroups = queueGroups(mode, false);
    while (humanGroups.length) {
      let taken: Conn[][] = [];
      let count = 0;
      for (const g of humanGroups) {
        if (count + g.length > info.players) continue;
        taken.push(g);
        count += g.length;
        if (count >= info.players) break;
      }
      if (!taken.length) break;
      const oldest = Math.min(...taken.flat().map((c) => c.queue!.since));
      const waited = Date.now() - oldest;
      if (count >= info.players || waited > HUMAN_WAIT_MS) {
        startMatch(mode, taken);
        humanGroups = queueGroups(mode, false);
      } else {
        // report progress and keep waiting
        for (const c of taken.flat()) {
          send(c, { t: 'queue_status', mode, have: count, need: info.players, waited: Math.round(waited / 1000) });
        }
        break;
      }
    }
  }
}, 500).unref?.();

server.listen(PORT, () => {
  console.log(`\n  ⚔  Pixel Brawl server on http://localhost:${PORT}`);
  console.log(`     mode: ${PROD ? 'production (serving ./dist)' : 'development (run `npm run dev:client` for the UI)'}\n`);
});

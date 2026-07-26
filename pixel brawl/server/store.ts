import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'accounts.json');

export interface BrawlerState {
  unlocked: boolean;
  level: number;
  pp: number;
  trophies: number;
  highest: number;
}

export interface Account {
  id: string;
  name: string;
  lower: string;
  hash: string;
  created: number;
  lastSeen: number;
  coins: number;
  gems: number;
  tokens: number;
  exp: number;
  selected: string;
  brawlers: Record<string, BrawlerState>;
  roadClaimed: number;
  stats: { games: number; wins: number; kills: number };
  lastFreeBox: number;
}

interface Db {
  secret: string;
  accounts: Record<string, Account>;
  byName: Record<string, string>;
}

function emptyDb(): Db {
  return { secret: crypto.randomBytes(32).toString('hex'), accounts: {}, byName: {} };
}

let db: Db = emptyDb();
let dirty = false;

export function loadDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...emptyDb(), ...raw };
      db.accounts ??= {};
      db.byName ??= {};
    } else {
      db = emptyDb();
      flush(true);
    }
  } catch (err) {
    console.error('[store] failed to load, starting fresh:', err);
    db = emptyDb();
  }
  console.log(`[store] ${Object.keys(db.accounts).length} account(s) loaded from ${DB_FILE}`);
}

export function flush(force = false) {
  if (!dirty && !force) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[store] write failed:', err);
  }
}

export function markDirty() {
  dirty = true;
}

setInterval(() => flush(), 4000).unref?.();
process.on('exit', () => flush(true));
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    flush(true);
    process.exit(0);
  });
}

export const store = {
  secret: () => db.secret,
  get(id: string): Account | undefined {
    return db.accounts[id];
  },
  byName(name: string): Account | undefined {
    const id = db.byName[name.toLowerCase()];
    return id ? db.accounts[id] : undefined;
  },
  create(acc: Account) {
    db.accounts[acc.id] = acc;
    db.byName[acc.lower] = acc.id;
    markDirty();
    flush(true);
  },
  all(): Account[] {
    return Object.values(db.accounts);
  },
  count() {
    return Object.keys(db.accounts).length;
  },
};

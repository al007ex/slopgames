// Accounts, stored in one JSON file. There are no passwords: a browser gets a
// random secret the first time it connects and keeps it; the server keeps only
// a hash of it. An account holds XP, level, coins (earned only by playing),
// owned and equipped cosmetics, lifetime stats and the day's challenges.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  levelFromXp, matchRewards, dailyChallenges, today, CHALLENGE_XP, CHALLENGE_COINS, CATALOG, isUnlocked,
} from '../shared/progression.js';

const SAVE_DELAY_MS = 3000;
const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
const cleanName = (n) => String(n || 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';

function freshStats() {
  return { matches: 0, wins: 0, top10: 0, kills: 0, deaths: 0, damage: 0, timePlayed: 0, byMode: {} };
}

export class AccountStore {
  constructor(file, { now = () => Date.now(), log = null } = {}) {
    this.file = file;
    this.now = now;
    this.log = log;
    this.accounts = new Map();
    this.dirty = false;
    this.timer = null;
    this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const a of data.accounts || []) this.accounts.set(a.id, a);
    } catch (error) {
      this.log?.(`accounts: could not read ${this.file}: ${error.message}`);
    }
  }

  /** Writes to a temporary file and renames it, so a crash never leaves half a file. */
  saveNow() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, accounts: [...this.accounts.values()] }), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  touch() {
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  /** Logs in with {id, token}, or makes a new account. Returns {account, token?}. */
  login(id, token, name) {
    const a = id && this.accounts.get(id);
    if (a && token) {
      const want = Buffer.from(a.tokenHash, 'hex'), got = Buffer.from(hashToken(token), 'hex');
      if (want.length === got.length && timingSafeEqual(want, got)) {
        if (name) a.name = cleanName(name);
        a.lastSeen = this.now();
        this.touch();
        return { account: a };
      }
    }
    const fresh = randomBytes(24).toString('hex');
    const account = {
      id: randomBytes(9).toString('base64url'), tokenHash: hashToken(fresh), name: cleanName(name),
      created: this.now(), lastSeen: this.now(), xp: 0, coins: 200,
      owned: { outfit: [0, 1], glider: [0], pickaxe: [0] }, equipped: { outfit: 0, glider: 0, pickaxe: 0 },
      stats: freshStats(), daily: null,
    };
    this.accounts.set(account.id, account);
    this.touch();
    return { account, token: fresh };
  }

  /** Today's challenges with this account's progress, rolled over at midnight UTC. */
  daily(a) {
    const date = today(this.now());
    if (!a.daily || a.daily.date !== date) {
      a.daily = { date, challenges: dailyChallenges(date).map((c) => ({ ...c, progress: 0, done: false })) };
      this.touch();
    }
    return a.daily;
  }

  /**
   * Records a finished match. `r` has placement, teams, kills, survived and the
   * per-match stats challenges count. Returns what was earned.
   */
  applyMatch(a, r) {
    const s = a.stats;
    const levelBefore = levelFromXp(a.xp).level;
    s.matches++;
    if (r.placement === 1) s.wins++;
    if (r.placement <= Math.max(1, Math.ceil(r.teams * 0.1))) s.top10++;
    s.kills += r.kills;
    if (r.placement !== 1) s.deaths++;
    s.damage += r.damage;
    s.timePlayed += r.survived;
    const m = (s.byMode[r.mode] ||= { matches: 0, wins: 0, kills: 0 });
    m.matches++; if (r.placement === 1) m.wins++; m.kills += r.kills;
    const reward = matchRewards({ placement: r.placement, teams: r.teams, kills: r.kills, survivedSeconds: r.survived });
    let xp = reward.xp, coins = reward.coins;
    const completed = [];
    for (const c of this.daily(a).challenges) {
      if (c.done) continue;
      c.progress = Math.min(c.goal, c.progress + (r.stats?.[c.stat] || 0));
      if (c.progress >= c.goal) { c.done = true; xp += CHALLENGE_XP; coins += CHALLENGE_COINS; completed.push(c.text); }
    }
    a.xp += xp;
    a.coins += coins;
    this.touch();
    const lv = levelFromXp(a.xp);
    return { xp, coins, level: lv.level, levelUp: lv.level > levelBefore, completed, breakdown: reward.breakdown };
  }

  buy(a, kind, id) {
    const item = CATALOG[kind]?.[id];
    if (!item) return 'no such item';
    if (isUnlocked(a, kind, id)) return 'already yours';
    if (item.price <= 0) return `reach level ${item.level} to unlock it`;
    if (a.coins < item.price) return 'not enough coins';
    a.coins -= item.price;
    (a.owned[kind] ||= []).push(id);
    this.touch();
    return null;
  }

  equip(a, kind, id) {
    if (!CATALOG[kind]?.[id]) return 'no such item';
    if (!isUnlocked(a, kind, id)) return 'locked';
    a.equipped[kind] = id;
    this.touch();
    return null;
  }

  profile(a) {
    const lv = levelFromXp(a.xp);
    const kd = a.stats.deaths ? a.stats.kills / a.stats.deaths : a.stats.kills;
    return {
      t: 'profile', id: a.id, name: a.name, xp: a.xp, level: lv.level, into: lv.into, need: lv.need, coins: a.coins,
      owned: a.owned, equipped: a.equipped, stats: { ...a.stats, kd: Math.round(kd * 100) / 100 }, daily: this.daily(a),
    };
  }

  /** The hook a match calls with each human's results: account updated, results annotated. */
  resultsHook() {
    return (p, res) => {
      if (!p.account) return;
      Object.assign(res, this.applyMatch(p.account, res));
      p.conn?.sendJson(this.profile(p.account));
    };
  }

  leaderboard(limit = 15) {
    const all = [...this.accounts.values()].filter((a) => a.stats.matches > 0);
    const row = (a) => ({ name: a.name, level: levelFromXp(a.xp).level, wins: a.stats.wins, kills: a.stats.kills, matches: a.stats.matches, kd: a.stats.deaths ? Math.round((a.stats.kills / a.stats.deaths) * 100) / 100 : a.stats.kills });
    return {
      t: 'leaderboard',
      wins: all.sort((x, y) => y.stats.wins - x.stats.wins || y.stats.kills - x.stats.kills).slice(0, limit).map(row),
      kills: [...all].sort((x, y) => y.stats.kills - x.stats.kills || y.stats.wins - x.stats.wins).slice(0, limit).map(row),
      level: [...all].sort((x, y) => y.xp - x.xp).slice(0, limit).map(row),
      players: this.accounts.size,
    };
  }
}

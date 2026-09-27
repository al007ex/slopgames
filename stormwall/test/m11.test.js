// M11 — the meta layer: accounts with XP and levels from placement and
// eliminations, daily challenges, cosmetics bought with earned coins or
// unlocked by level, persistent stats, K/D and leaderboards.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ok, eq, section, report } from './harness.js';
import { AccountStore } from '../server/accounts.js';
import { Lobby } from '../server/lobby.js';
import { getWorld } from '../shared/worldgen.js';
import { levelFromXp, matchRewards, dailyChallenges, CHALLENGE_XP, CATALOG, isUnlocked } from '../shared/progression.js';
import { OUTFITS } from '../shared/cosmetics.js';
import { MODE_DEAD } from '../shared/movement.js';

const dir = mkdtempSync(path.join(tmpdir(), 'stormwall-accounts-'));
const file = path.join(dir, 'accounts.json');
let clock = Date.parse('2026-09-27T12:00:00Z');
const store = () => new AccountStore(file, { now: () => clock });

section('Accounts without passwords');
{
  const s = store();
  const { account, token } = s.login('', '', 'Shovel');
  ok(account.id && token && token.length >= 40, 'a new browser gets an account and a long random secret');
  eq(s.login(account.id, token, 'Shovel').account, account, 'the same id and secret log back in');
  ok(s.login(account.id, 'wrong', 'Shovel').account !== account, 'a wrong secret gets a fresh account instead');
  s.saveNow();
  const raw = readFileSync(file, 'utf8');
  ok(!raw.includes(token) && raw.includes(account.tokenHash), 'only a hash of the secret is stored');
  account.xp = 1234; account.coins = 77;
  s.saveNow();
  const again = store().login(account.id, token, 'Shovel').account;
  ok(again.xp === 1234 && again.coins === 77, 'progress survives a restart');
}

section('XP and levels');
{
  const win = matchRewards({ placement: 1, teams: 100, kills: 0, survivedSeconds: 1200 });
  const top5 = matchRewards({ placement: 5, teams: 100, kills: 0, survivedSeconds: 1200 });
  const mid = matchRewards({ placement: 50, teams: 100, kills: 0, survivedSeconds: 1200 });
  ok(win.xp > top5.xp && top5.xp > mid.xp, `placement earns XP: win ${win.xp}, top 5 ${top5.xp}, 50th ${mid.xp}`);
  eq(matchRewards({ placement: 50, teams: 100, kills: 3, survivedSeconds: 1200 }).xp - mid.xp, 150, 'each elimination is worth 50 XP');
  eq(levelFromXp(0).level, 1, 'everyone starts at level 1');
  ok(levelFromXp(5000).level > levelFromXp(1000).level, 'more XP, higher level');
  ok(matchRewards({ placement: 1, teams: 25, kills: 2, survivedSeconds: 900 }).coins > matchRewards({ placement: 20, teams: 25, kills: 0, survivedSeconds: 60 }).coins, 'coins are earned by playing well');
}

section('Daily challenges');
{
  const a = dailyChallenges('2026-09-27'), b = dailyChallenges('2026-09-27'), c = dailyChallenges('2026-09-28');
  eq(a.length, 3, 'three challenges a day');
  eq(JSON.stringify(a), JSON.stringify(b), 'the same three for everyone that day');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'new ones the next day');
  const s = store();
  const { account } = s.login('', '', 'Daily');
  const ch = s.daily(account).challenges[0];
  const statsHalf = { [ch.stat]: Math.ceil(ch.goal / 2) };
  const r1 = s.applyMatch(account, { placement: 50, teams: 100, kills: 0, damage: 0, survived: 300, mode: 'solo', stats: statsHalf });
  ok(!s.daily(account).challenges[0].done && r1.completed.length === 0, `half of "${ch.text}" after one match`);
  const xpBefore = account.xp;
  const r2 = s.applyMatch(account, { placement: 50, teams: 100, kills: 0, damage: 0, survived: 300, mode: 'solo', stats: statsHalf });
  ok(s.daily(account).challenges[0].done && r2.completed.includes(ch.text), '…and done after the second');
  ok(account.xp - xpBefore >= CHALLENGE_XP, `completing it pays ${CHALLENGE_XP} XP on top`);
  const r3 = s.applyMatch(account, { placement: 50, teams: 100, kills: 0, damage: 0, survived: 300, mode: 'solo', stats: statsHalf });
  eq(r3.completed.length, 0, 'a challenge pays out only once');
  clock += 24 * 3600 * 1000;
  eq(s.daily(account).date, '2026-09-28', 'at midnight UTC the challenges roll over');
  ok(s.daily(account).challenges.every((c) => c.progress === 0), '…with fresh progress');
  clock -= 24 * 3600 * 1000;
}

section('Cosmetics: earned, never paid for');
{
  const s = store();
  const { account } = s.login('', '', 'Fashion');
  const priced = OUTFITS.find((o) => o.price > 0);
  const gated = OUTFITS.find((o) => o.price === 0 && o.level > 1);
  account.coins = priced.price - 1;
  eq(s.buy(account, 'outfit', priced.id), 'not enough coins', 'you cannot buy what you cannot afford');
  account.coins = priced.price + 5;
  eq(s.buy(account, 'outfit', priced.id), null, `${priced.name} bought for ${priced.price} earned coins`);
  eq(account.coins, 5, '…and the coins are gone');
  eq(s.equip(account, 'outfit', priced.id), null, 'and equipped');
  eq(s.equip(account, 'outfit', gated.id), 'locked', `${gated.name} is locked until level ${gated.level}`);
  account.xp = 1e6;
  ok(isUnlocked(account, 'outfit', gated.id), '…and unlocked by levelling up');
  eq(s.equip(account, 'outfit', gated.id), null, '…then wearable');
  eq(s.buy(account, 'outfit', gated.id), 'already yours', 'nothing is sold twice');
  ok(Object.values(CATALOG).every((list) => list.every((i) => Object.keys(i).every((k) => ['id', 'name', 'price', 'level'].includes(k) || typeof i[k] === 'number'))), 'cosmetics are only names, colours, prices and levels — purely visual');
}

section('Stats, K/D and leaderboards');
{
  const s = new AccountStore(null, { now: () => clock });
  const ace = s.login('', '', 'Ace').account, rook = s.login('', '', 'Rook').account;
  const play = (a, placement, kills) => s.applyMatch(a, { placement, teams: 100, kills, damage: kills * 120, survived: 600, mode: 'solo', stats: {} });
  play(ace, 1, 8); play(ace, 3, 4); play(ace, 1, 6);
  play(rook, 40, 1); play(rook, 12, 2);
  eq(ace.stats.wins, 2, 'wins are counted');
  eq(ace.stats.matches, 3, 'and matches');
  eq(s.profile(ace).stats.kd, 18, 'K/D is eliminations per death (18 kills, 1 death)');
  eq(s.profile(rook).stats.kd, 1.5, '…or 1.5 for 3 kills and 2 deaths');
  const lb = s.leaderboard();
  eq(lb.wins[0].name, 'Ace', 'the wins leaderboard is led by the winner');
  eq(lb.kills.map((r) => r.name).join(','), 'Ace,Rook', 'and so is the eliminations board');
}

section('A real match pays out');
{
  const s = store();
  const { account } = s.login('', '', 'Human');
  const inbox = [];
  const lobby = new Lobby({ base: getWorld(), pregameSeconds: 1, onMatchCreated: (m) => { m.onPlayerResults = s.resultsHook(); } });
  const conn = {
    name: 'Human', account, outfit: 0, glider: 0, pickaxe: 0, inbox, queued: null,
    sendJson(m) { inbox.push(m); }, send() {}, backlogged: () => false,
    attach(match, p) { p.conn = conn; conn.player = p; conn.match = match; match.conns.add(conn); conn.ready = true; },
    detach() {},
  };
  lobby.enqueue(conn, 'solo');
  const match = [...lobby.matches][0];
  const me = conn.player;
  for (let i = 0; i < 40 * 60 * 30 && !me.resultsSent; i++) match.step();
  const res = inbox.filter((m) => m.t === 'results').at(-1);
  ok(res, `the match ended for our human at #${res?.placement} (${me.move.mode === MODE_DEAD ? 'eliminated' : 'standing'})`);
  eq(account.stats.matches, 1, 'the account has one match on record');
  ok(res.xp > 0 && account.xp === res.xp, `and the XP it earned (${res.xp})`);
  ok(inbox.some((m) => m.t === 'profile'), 'the client gets its updated profile straight away');
}

rmSync(dir, { recursive: true, force: true });
report();

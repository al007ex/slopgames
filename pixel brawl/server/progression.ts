import { BRAWLERS, STARTER_BRAWLER } from '../shared/brawlers.js';
import { GameMode, MAX_POWER_LEVEL, RARITY_INFO, Rarity, UPGRADE_COINS, UPGRADE_POINTS } from '../shared/constants.js';
import { markDirty, type Account, type BrawlerState } from './store.js';

/* ------------------------------- brawlers ------------------------------- */

export function newBrawlerState(unlocked = false): BrawlerState {
  return { unlocked, level: 1, pp: 0, trophies: 0, highest: 0 };
}

export function ensureBrawlers(acc: Account) {
  acc.brawlers ??= {};
  for (const b of BRAWLERS) {
    if (!acc.brawlers[b.id]) acc.brawlers[b.id] = newBrawlerState(b.id === STARTER_BRAWLER);
  }
  if (!acc.brawlers[acc.selected]?.unlocked) {
    acc.selected = BRAWLERS.find((b) => acc.brawlers[b.id]?.unlocked)?.id ?? STARTER_BRAWLER;
    acc.brawlers[acc.selected].unlocked = true;
  }
}

export function totalTrophies(acc: Account): number {
  return Object.values(acc.brawlers).reduce((s, b) => s + (b.unlocked ? b.trophies : 0), 0);
}

export function highestTrophies(acc: Account): number {
  return Object.values(acc.brawlers).reduce((s, b) => s + (b.unlocked ? b.highest : 0), 0);
}

export function unlockedIds(acc: Account): string[] {
  return BRAWLERS.filter((b) => acc.brawlers[b.id]?.unlocked).map((b) => b.id);
}

export function ppNeeded(level: number): number {
  return UPGRADE_POINTS[Math.max(0, Math.min(UPGRADE_POINTS.length - 1, level - 1))];
}
export function coinsNeeded(level: number): number {
  return UPGRADE_COINS[Math.max(0, Math.min(UPGRADE_COINS.length - 1, level - 1))];
}

export function canUpgrade(acc: Account, id: string): boolean {
  const b = acc.brawlers[id];
  if (!b || !b.unlocked || b.level >= MAX_POWER_LEVEL) return false;
  return b.pp >= ppNeeded(b.level) && acc.coins >= coinsNeeded(b.level);
}

export function upgrade(acc: Account, id: string): { ok: boolean; error?: string } {
  const b = acc.brawlers[id];
  if (!b || !b.unlocked) return { ok: false, error: 'Brawler locked' };
  if (b.level >= MAX_POWER_LEVEL) return { ok: false, error: 'Already max power' };
  const pp = ppNeeded(b.level);
  const coins = coinsNeeded(b.level);
  if (b.pp < pp) return { ok: false, error: 'Not enough power points' };
  if (acc.coins < coins) return { ok: false, error: 'Not enough coins' };
  b.pp -= pp;
  acc.coins -= coins;
  b.level++;
  markDirty();
  return { ok: true };
}

/* --------------------------------- boxes -------------------------------- */

export type RewardKind = 'brawler' | 'pp' | 'coins' | 'gems' | 'tokens';

export interface Reward {
  kind: RewardKind;
  amount: number;
  brawler?: string;
  rarity?: string;
  /** true when the brawler card completed an unlock */
  isNew?: boolean;
}

let rngState = Date.now() >>> 0;
function rnd(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 4294967296;
}

function pickLockedBrawler(acc: Account): string | null {
  const locked = BRAWLERS.filter((b) => !acc.brawlers[b.id]?.unlocked);
  if (!locked.length) return null;
  const pool: { id: string; w: number }[] = locked.map((b) => ({ id: b.id, w: RARITY_INFO[b.rarity].weight || 1 }));
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = rnd() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return p.id;
  }
  return pool[pool.length - 1].id;
}

/** One Brawl Box worth of loot. `power` scales a Big Box (3) or Mega Box (10). */
export function openBox(acc: Account, power = 1): Reward[] {
  ensureBrawlers(acc);
  const rewards: Reward[] = [];
  const unlocked = unlockedIds(acc);

  // brawler unlock chance rises the more boxes you open without one
  const unlockChance = Math.min(0.55, 0.14 * power);
  if (rnd() < unlockChance) {
    const id = pickLockedBrawler(acc);
    if (id) {
      const st = acc.brawlers[id];
      st.unlocked = true;
      st.pp = 0;
      const def = BRAWLERS.find((b) => b.id === id)!;
      rewards.push({ kind: 'brawler', amount: 1, brawler: id, rarity: def.rarity, isNew: true });
      unlocked.push(id);
    }
  }

  // power points, spread over 1-3 brawlers
  const ppTotal = Math.round((14 + rnd() * 22) * power);
  const targets = Math.min(unlocked.length, 1 + Math.floor(rnd() * (power > 1 ? 3 : 2)));
  for (let i = 0; i < targets; i++) {
    const id = unlocked[Math.floor(rnd() * unlocked.length)];
    const st = acc.brawlers[id];
    if (st.level >= MAX_POWER_LEVEL) continue;
    const amt = Math.max(2, Math.round(ppTotal / targets));
    st.pp += amt;
    const def = BRAWLERS.find((b) => b.id === id)!;
    rewards.push({ kind: 'pp', amount: amt, brawler: id, rarity: def.rarity });
  }

  const coins = Math.round((18 + rnd() * 34) * power);
  acc.coins += coins;
  rewards.push({ kind: 'coins', amount: coins });

  if (rnd() < 0.24 * power) {
    const gems = Math.max(1, Math.round((1 + rnd() * 4) * Math.sqrt(power)));
    acc.gems += gems;
    rewards.push({ kind: 'gems', amount: gems });
  }

  markDirty();
  return rewards;
}

/* ------------------------------ trophy road ----------------------------- */

export interface RoadStop {
  trophies: number;
  reward: { kind: RewardKind | 'box' | 'bigbox'; amount: number; brawler?: string };
}

export const TROPHY_ROAD: RoadStop[] = [
  { trophies: 10, reward: { kind: 'coins', amount: 50 } },
  { trophies: 20, reward: { kind: 'box', amount: 1 } },
  { trophies: 30, reward: { kind: 'brawler', amount: 1, brawler: 'nita' } },
  { trophies: 50, reward: { kind: 'coins', amount: 100 } },
  { trophies: 75, reward: { kind: 'box', amount: 1 } },
  { trophies: 100, reward: { kind: 'gems', amount: 20 } },
  { trophies: 140, reward: { kind: 'brawler', amount: 1, brawler: 'colt' } },
  { trophies: 180, reward: { kind: 'bigbox', amount: 1 } },
  { trophies: 220, reward: { kind: 'coins', amount: 200 } },
  { trophies: 280, reward: { kind: 'brawler', amount: 1, brawler: 'bull' } },
  { trophies: 350, reward: { kind: 'gems', amount: 30 } },
  { trophies: 450, reward: { kind: 'bigbox', amount: 1 } },
  { trophies: 550, reward: { kind: 'brawler', amount: 1, brawler: 'jessie' } },
  { trophies: 700, reward: { kind: 'coins', amount: 400 } },
  { trophies: 850, reward: { kind: 'bigbox', amount: 1 } },
  { trophies: 1000, reward: { kind: 'brawler', amount: 1, brawler: 'dynamike' } },
  { trophies: 1200, reward: { kind: 'gems', amount: 50 } },
  { trophies: 1500, reward: { kind: 'bigbox', amount: 1 } },
  { trophies: 1800, reward: { kind: 'brawler', amount: 1, brawler: 'bo' } },
  { trophies: 2200, reward: { kind: 'coins', amount: 800 } },
  { trophies: 2600, reward: { kind: 'bigbox', amount: 1 } },
  { trophies: 3000, reward: { kind: 'brawler', amount: 1, brawler: 'piper' } },
];

export function claimRoad(acc: Account): Reward[] {
  const total = highestTrophies(acc);
  const out: Reward[] = [];
  while (acc.roadClaimed < TROPHY_ROAD.length && TROPHY_ROAD[acc.roadClaimed].trophies <= total) {
    const stop = TROPHY_ROAD[acc.roadClaimed];
    acc.roadClaimed++;
    const r = stop.reward;
    if (r.kind === 'box') out.push(...openBox(acc, 1));
    else if (r.kind === 'bigbox') out.push(...openBox(acc, 3));
    else if (r.kind === 'brawler' && r.brawler) {
      const st = acc.brawlers[r.brawler];
      if (st && !st.unlocked) {
        st.unlocked = true;
        const def = BRAWLERS.find((b) => b.id === r.brawler)!;
        out.push({ kind: 'brawler', amount: 1, brawler: r.brawler, rarity: def.rarity, isNew: true });
      } else {
        acc.coins += 100;
        out.push({ kind: 'coins', amount: 100 });
      }
    } else if (r.kind === 'coins') {
      acc.coins += r.amount;
      out.push({ kind: 'coins', amount: r.amount });
    } else if (r.kind === 'gems') {
      acc.gems += r.amount;
      out.push({ kind: 'gems', amount: r.amount });
    } else if (r.kind === 'tokens') {
      acc.tokens += r.amount;
      out.push({ kind: 'tokens', amount: r.amount });
    }
  }
  if (out.length) markDirty();
  return out;
}

/* -------------------------------- trophies ------------------------------ */

/** Higher trophy counts earn less and lose more, exactly like the beta ladder. */
function gainScale(t: number): number {
  if (t < 100) return 1.25;
  if (t < 200) return 1.1;
  if (t < 300) return 1.0;
  if (t < 400) return 0.85;
  if (t < 500) return 0.7;
  if (t < 700) return 0.55;
  return 0.4;
}
function lossScale(t: number): number {
  if (t < 50) return 0;
  if (t < 100) return 0.35;
  if (t < 200) return 0.6;
  if (t < 400) return 0.85;
  return 1;
}

export function trophyDelta(mode: GameMode, rank: number, playerCount: number, current: number): number {
  let base: number;
  if (mode === GameMode.Showdown) {
    const table = [9, 7, 5, 3, 0, -2, -3, -4];
    base = table[Math.max(0, Math.min(table.length - 1, rank - 1))];
  } else {
    base = rank === 1 ? 8 : rank === 2 ? 0 : -5;
  }
  if (base > 0) return Math.max(1, Math.round(base * gainScale(current)));
  if (base < 0) return -Math.round(-base * lossScale(current));
  return 0;
}

export function applyMatchResult(
  acc: Account,
  brawlerId: string,
  mode: GameMode,
  rank: number,
  playerCount: number,
  kills: number,
): { trophies: number; tokens: number; coins: number; exp: number } {
  ensureBrawlers(acc);
  const st = acc.brawlers[brawlerId] ?? acc.brawlers[acc.selected];
  const delta = trophyDelta(mode, rank, playerCount, st.trophies);
  st.trophies = Math.max(0, st.trophies + delta);
  st.highest = Math.max(st.highest, st.trophies);

  const won = mode === GameMode.Showdown ? rank <= 3 : rank === 1;
  const tokens = (won ? 24 : 12) + Math.min(10, kills * 2);
  const coins = won ? 12 : 6;
  const exp = (won ? 10 : 5) + kills;

  acc.tokens += tokens;
  acc.coins += coins;
  acc.exp += exp;
  acc.stats.games++;
  acc.stats.kills += kills;
  if (won) acc.stats.wins++;
  acc.lastSeen = Date.now();
  markDirty();

  return { trophies: delta, tokens, coins, exp };
}

/* ---------------------------------- shop -------------------------------- */

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  cost: number;
  currency: 'gems' | 'tokens' | 'coins' | 'free';
  kind: 'box' | 'bigbox' | 'coins' | 'free';
  amount: number;
}

export const SHOP: ShopItem[] = [
  { id: 'free', name: 'DAILY BOX', desc: 'One free Brawl Box every 24 hours.', cost: 0, currency: 'free', kind: 'free', amount: 1 },
  { id: 'tokenbox', name: 'BRAWL BOX', desc: 'Cards, coins and maybe a new Brawler.', cost: 100, currency: 'tokens', kind: 'box', amount: 1 },
  { id: 'gembox', name: 'BRAWL BOX', desc: 'Cards, coins and maybe a new Brawler.', cost: 30, currency: 'gems', kind: 'box', amount: 1 },
  { id: 'bigbox', name: 'BIG BOX', desc: 'Three times the loot of a Brawl Box.', cost: 80, currency: 'gems', kind: 'bigbox', amount: 3 },
  { id: 'megabox', name: 'MEGA BOX', desc: 'Ten Brawl Boxes in one giant crate.', cost: 240, currency: 'gems', kind: 'bigbox', amount: 10 },
  { id: 'coins1', name: 'COIN BAG', desc: '300 coins for upgrading Brawlers.', cost: 20, currency: 'gems', kind: 'coins', amount: 300 },
  { id: 'coins2', name: 'COIN VAULT', desc: '1200 coins for upgrading Brawlers.', cost: 70, currency: 'gems', kind: 'coins', amount: 1200 },
];

export const FREE_BOX_COOLDOWN = 20 * 60 * 60 * 1000;

export function buy(acc: Account, itemId: string): { ok: boolean; error?: string; rewards?: Reward[] } {
  const item = SHOP.find((s) => s.id === itemId);
  if (!item) return { ok: false, error: 'Unknown item' };

  if (item.currency === 'free') {
    const now = Date.now();
    if (now - acc.lastFreeBox < FREE_BOX_COOLDOWN) return { ok: false, error: 'Not ready yet' };
    acc.lastFreeBox = now;
    return { ok: true, rewards: openBox(acc, 1) };
  }

  const have = item.currency === 'gems' ? acc.gems : item.currency === 'tokens' ? acc.tokens : acc.coins;
  if (have < item.cost) return { ok: false, error: `Not enough ${item.currency}` };
  if (item.currency === 'gems') acc.gems -= item.cost;
  else if (item.currency === 'tokens') acc.tokens -= item.cost;
  else acc.coins -= item.cost;

  if (item.kind === 'coins') {
    acc.coins += item.amount;
    markDirty();
    return { ok: true, rewards: [{ kind: 'coins', amount: item.amount }] };
  }
  return { ok: true, rewards: openBox(acc, item.amount) };
}

/* --------------------------------- names -------------------------------- */

const BOT_NAMES = [
  'Rico', 'Nova', 'Jax', 'Kira', 'Bolt', 'Mango', 'Zed', 'Pip', 'Vex', 'Luna',
  'Turbo', 'Slick', 'Ozzy', 'Cinder', 'Blip', 'Frost', 'Gizmo', 'Havok', 'Juno', 'Kobe',
  'Miso', 'Nix', 'Onyx', 'Pixel', 'Quill', 'Ravi', 'Sable', 'Tonk', 'Umi', 'Volt',
  'Wisp', 'Yuki', 'Zappy', 'Dizzy', 'Echo', 'Fable', 'Grit', 'Hex', 'Iris', 'Jolt',
];

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? String(Math.floor(i / BOT_NAMES.length)) : '');
}

export function rarityColor(r: Rarity | string): string {
  return RARITY_INFO[r as Rarity]?.color ?? '#fff';
}

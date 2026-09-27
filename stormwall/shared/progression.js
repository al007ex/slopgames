// Account progression: XP and levels from how you place and how many you
// eliminate, coins earned by playing (the only currency — there is no real
// money anywhere), and three daily challenges that are the same for everyone.

import { OUTFITS, GLIDERS, PICKAXES } from './cosmetics.js';
import { Rng, hash32 } from './rng.js';

/** XP needed to go from level n to n+1. */
export const xpForLevel = (n) => 400 + 150 * Math.min(n, 30);

export function levelFromXp(xp) {
  let level = 1, left = xp;
  while (left >= xpForLevel(level) && level < 100) { left -= xpForLevel(level); level++; }
  return { level, into: left, need: xpForLevel(level) };
}

/**
 * XP and coins for one match. Placement is scored against how many teams
 * started, so a duo placing 2nd of 50 counts like a solo top 4.
 */
export function matchRewards({ placement, teams, kills, survivedSeconds }) {
  const frac = teams > 1 ? (placement - 1) / (teams - 1) : 0;
  let place = 20;
  if (placement === 1) place = 400;
  else if (frac <= 0.05) place = 180;
  else if (frac <= 0.1) place = 120;
  else if (frac <= 0.25) place = 60;
  const xp = place + kills * 50 + Math.min(150, Math.floor(survivedSeconds / 10));
  const coins = 10 + kills * 10 + (placement === 1 ? 100 : frac <= 0.1 ? 30 : 0);
  return { xp, coins, breakdown: { placement: place, eliminations: kills * 50, survival: Math.min(150, Math.floor(survivedSeconds / 10)) } };
}

// The pool daily challenges are drawn from. `stat` names a per-match stat the
// server reports; progress is the sum of that stat over the day's matches.
export const CHALLENGE_POOL = [
  { id: 'elims', text: 'Eliminate {n} opponents', stat: 'kills', n: 3 },
  { id: 'chests', text: 'Search {n} chests', stat: 'chests', n: 5 },
  { id: 'harvest', text: 'Harvest {n} materials', stat: 'harvested', n: 500 },
  { id: 'build', text: 'Place {n} build pieces', stat: 'built', n: 80 },
  { id: 'damage', text: 'Deal {n} damage to opponents', stat: 'damage', n: 600 },
  { id: 'ar', text: 'Deal {n} damage with rifles', stat: 'damageRifle', n: 300 },
  { id: 'shotgun', text: 'Deal {n} damage with shotguns', stat: 'damageShotgun', n: 250 },
  { id: 'top25', text: 'Place top 25 in {n} matches', stat: 'top25', n: 2 },
  { id: 'outlast', text: 'Outlast {n} opponents', stat: 'outlasted', n: 120 },
  { id: 'named', text: 'Land at a named place {n} times', stat: 'landedNamed', n: 3 },
  { id: 'revive', text: 'Revive {n} teammates', stat: 'revives', n: 2 },
  { id: 'heal', text: 'Use {n} healing items', stat: 'healed', n: 5 },
  { id: 'weak', text: 'Hit {n} weak points while harvesting', stat: 'weakHits', n: 30 },
  { id: 'edit', text: 'Edit {n} of your builds', stat: 'edits', n: 10 },
];
export const CHALLENGE_XP = 250;
export const CHALLENGE_COINS = 100;

/** The day's three challenges: the same for everyone, new each UTC day. */
export function dailyChallenges(date) {
  const day = String(date).slice(0, 10);
  let seed = 0;
  for (const ch of day) seed = hash32(seed, ch.charCodeAt(0));
  const rng = new Rng(seed);
  const pool = rng.shuffle(CHALLENGE_POOL.slice());
  return pool.slice(0, 3).map((c) => ({ id: c.id, text: c.text.replace('{n}', c.n), stat: c.stat, goal: c.n }));
}

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Every cosmetic, with how you get it: a price in coins, or a level. */
export const CATALOG = {
  outfit: OUTFITS,
  glider: GLIDERS,
  pickaxe: PICKAXES,
};

export function isUnlocked(account, kind, id) {
  const item = CATALOG[kind]?.[id];
  if (!item) return false;
  if (account.owned?.[kind]?.includes(id)) return true;
  return item.price === 0 && levelFromXp(account.xp || 0).level >= item.level;
}

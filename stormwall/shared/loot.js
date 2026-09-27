// Loot tables. Rarity is weighted hard towards common — a legendary should
// feel like an event — and named places (tier 2) roll better than the lone
// houses and gas stations in between (tier 1).

import { WEAPONS, HEALS, AMMO } from './items.js';

export const FLOOR_CHANCE = { 1: 0.62, 2: 0.78 };
export const CHEST_CHANCE = 0.6;          // each chest spot has a chest this often per match
export const AMMO_BOX_CHANCE = 0.7;

const FLOOR_CATEGORY = [['weapon', 42], ['heal', 20], ['ammo', 22], ['mats', 16]];

const WEAPON_WEIGHTS = [
  ['pistol', 14], ['smg', 12], ['ar', 17], ['burst', 8], ['pump', 11], ['tactical', 10],
  ['revolver', 8], ['sniper', 3], ['scoped', 3], ['rocket', 1.2], ['grenade', 2],
];

export const RARITY_WEIGHTS = {
  floor: { 1: [60, 28, 10, 1.8, 0.2], 2: [46, 32, 17, 4.2, 0.8] },
  chest: { 1: [38, 36, 19, 6, 1], 2: [24, 35, 26, 11.5, 3.5] },
};

const HEAL_WEIGHTS = [['bandage', 50], ['medkit', 18], ['shield', 32]];
const HEAL_COUNT = { bandage: 5, medkit: 1, shield: 1 };
const AMMO_WEIGHTS = [['light', 30], ['medium', 34], ['heavy', 22], ['rockets', 6]];

/** Nearest rarity the weapon actually comes in. */
function clampRarity(key, rarity) {
  const tiers = WEAPONS[key].tiers;
  if (tiers.includes(rarity)) return rarity;
  let best = tiers[0];
  for (const t of tiers) if (Math.abs(t - rarity) < Math.abs(best - rarity)) best = t;
  return best;
}

export function rollWeapon(rng, source, tier) {
  const key = rng.weighted(WEAPON_WEIGHTS);
  const weights = RARITY_WEIGHTS[source][tier] || RARITY_WEIGHTS[source][1];
  const rarity = clampRarity(key, rng.weighted(weights.map((w, i) => [i, w])));
  return { key, rarity, mag: WEAPONS[key].mag };
}

export function ammoFor(key, rng) {
  const type = WEAPONS[key].ammo;
  return { key: type, count: AMMO[type].box * (rng ? rng.int(1, 2) : 1) };
}

export function rollHeal(rng) {
  const key = rng.weighted(HEAL_WEIGHTS);
  return { key, count: HEAL_COUNT[key], rarity: HEALS[key].rarity };
}

export function rollAmmo(rng) {
  const key = rng.weighted(AMMO_WEIGHTS);
  return { key, count: AMMO[key].box * rng.int(1, 3) };
}

export function rollMats(rng, amount = 30) {
  return { key: rng.pick(['wood', 'stone', 'metal']), count: amount };
}

/** What lies on one floor-loot spot (weapons come with a pile of their ammo). */
export function rollFloor(rng, tier) {
  if (!rng.chance(FLOOR_CHANCE[tier] ?? FLOOR_CHANCE[1])) return [];
  switch (rng.weighted(FLOOR_CATEGORY)) {
    case 'weapon': { const w = rollWeapon(rng, 'floor', tier); return [w, ammoFor(w.key, rng)]; }
    case 'heal': return [rollHeal(rng)];
    case 'ammo': return [rollAmmo(rng)];
    default: return [rollMats(rng, 30)];
  }
}

/** A chest: always a weapon and its ammo, usually something to heal with, and materials. */
export function rollChest(rng, tier) {
  const w = rollWeapon(rng, 'chest', tier);
  const out = [w, ammoFor(w.key, rng)];
  if (rng.chance(0.75)) out.push(rollHeal(rng));
  out.push(rollMats(rng, 30));
  return out;
}

export function rollAmmoBox(rng) { return [rollAmmo(rng), rollAmmo(rng)]; }

// Everything that can go in an inventory slot or lie on the floor: weapons,
// healing, ammo and materials. Numbers follow the original season's arsenal —
// same weapon, about +10% damage per rarity tier.

export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export const RARITY_COLORS = [0xb4b4b4, 0x5fd35a, 0x3fa0ff, 0xc05cff, 0xff9b2f];
export const AMMO_TYPES = ['light', 'medium', 'heavy', 'rockets'];

// Damage multiplier with distance, as [metres, multiplier] points.
const FALLOFF = {
  pistol: [[0, 1], [25, 1], [50, 0.75], [80, 0.55]],
  revolver: [[0, 1], [40, 1], [80, 0.8]],
  smg: [[0, 1], [25, 1], [50, 0.7], [80, 0.5]],
  rifle: [[0, 1], [50, 1], [100, 0.8], [150, 0.65]],
  scoped: [[0, 1], [80, 1], [150, 0.85]],
  shotgun: [[0, 1], [5, 1], [12, 0.7], [20, 0.4], [35, 0.15], [45, 0]],
};

// Bloom in degrees (half-angle of the spread cone).
//   min: settled spread (0 = first shot goes exactly where you aim)
//   max: cap; shot: added per shot; move/air: added while moving / airborne;
//   recover: degrees per second the bloom shrinks back.
export const WEAPONS = {
  pistol: { name: 'Pistol', cls: 'pistol', ammo: 'light', tiers: [0, 1], damage: 23, head: 2, rate: 6.75, mag: 16, reload: 1.5, auto: false, falloff: FALLOFF.pistol, structure: 0.8, range: 250, bloom: { min: 0.5, max: 5, shot: 0.9, move: 1.6, air: 4, recover: 9 } },
  revolver: { name: 'Revolver', cls: 'revolver', ammo: 'medium', tiers: [0, 1, 2], damage: 54, head: 2, rate: 0.9, mag: 6, reload: 2.4, auto: false, falloff: FALLOFF.revolver, structure: 1, range: 300, bloom: { min: 0, max: 6, shot: 4, move: 2, air: 5, recover: 6 } },
  smg: { name: 'Tactical SMG', cls: 'smg', ammo: 'light', tiers: [0, 1, 2], damage: 16, head: 1.75, rate: 13, mag: 30, reload: 2.2, auto: true, falloff: FALLOFF.smg, structure: 0.8, range: 200, bloom: { min: 1.2, max: 6.5, shot: 0.45, move: 1.8, air: 4, recover: 8 } },
  ar: { name: 'Assault Rifle', cls: 'ar', ammo: 'medium', tiers: [0, 1, 2, 3, 4], damage: 30, head: 2, rate: 5.5, mag: 30, reload: 2.3, auto: true, falloff: FALLOFF.rifle, structure: 1, range: 300, bloom: { min: 0, max: 5, shot: 0.6, move: 2, air: 4.5, recover: 7 } },
  burst: { name: 'Burst Rifle', cls: 'burst', ammo: 'medium', tiers: [0, 1, 2, 3, 4], damage: 27, head: 2, rate: 1.75, burst: 3, burstGap: 3, mag: 30, reload: 2.7, auto: false, falloff: FALLOFF.rifle, structure: 1, range: 300, bloom: { min: 0, max: 5, shot: 0.5, move: 2, air: 4.5, recover: 7 } },
  scoped: { name: 'Scoped Rifle', cls: 'scoped', ammo: 'medium', tiers: [2, 3], damage: 23, head: 2, rate: 3.5, mag: 20, reload: 2.3, auto: true, falloff: FALLOFF.scoped, structure: 1, range: 400, scope: 30, bloom: { min: 0, max: 3, shot: 0.35, move: 2.5, air: 5, recover: 8 } },
  pump: { name: 'Pump Shotgun', cls: 'pump', ammo: 'heavy', tiers: [1, 2], damage: 80, pellets: 10, spread: 3.2, head: 2, rate: 0.7, mag: 5, reload: 4.5, auto: false, falloff: FALLOFF.shotgun, structure: 1, range: 60, bloom: { min: 0, max: 1, shot: 0, move: 0.6, air: 1.2, recover: 20 } },
  tactical: { name: 'Tactical Shotgun', cls: 'tactical', ammo: 'heavy', tiers: [0, 1, 2], damage: 67, pellets: 10, spread: 4, head: 2, rate: 1.5, mag: 8, reload: 5.5, auto: false, falloff: FALLOFF.shotgun, structure: 1, range: 60, bloom: { min: 0, max: 1, shot: 0, move: 0.6, air: 1.2, recover: 20 } },
  sniper: { name: 'Bolt-Action Sniper', cls: 'sniper', ammo: 'heavy', tiers: [2, 3, 4], damage: 105, head: 2.5, rate: 0.33, mag: 1, reload: 3, auto: false, falloff: null, structure: 1, range: 700, scope: 18, bloom: { min: 0, max: 8, shot: 8, move: 6, air: 10, recover: 5, hip: 4 } },
  rocket: { name: 'Rocket Launcher', cls: 'rocket', ammo: 'rockets', tiers: [3, 4], damage: 110, head: 1, rate: 0.75, mag: 1, reload: 3.5, auto: false, falloff: null, structure: 4, range: 500, projectile: { speed: 75, gravity: 0, radius: 4, fuse: 8, bounce: false }, bloom: { min: 0, max: 1, shot: 0, move: 0.5, air: 1, recover: 10 } },
  grenade: { name: 'Grenade Launcher', cls: 'grenade', ammo: 'rockets', tiers: [2, 3, 4], damage: 100, head: 1, rate: 1, mag: 6, reload: 3.5, auto: false, falloff: null, structure: 3.5, range: 300, projectile: { speed: 40, gravity: 20, radius: 3.5, fuse: 2.5, bounce: true }, bloom: { min: 0, max: 1, shot: 0, move: 0.5, air: 1, recover: 10 } },
};

// Healing. Bandages stop at 75 health; a med kit fills you up; a shield
// potion adds 50 shield, up to 100 over two.
export const HEALS = {
  bandage: { name: 'Bandages', stack: 15, use: 3.5, hp: 15, cap: 75, rarity: 0 },
  medkit: { name: 'Med Kit', stack: 3, use: 10, hp: 100, cap: 100, rarity: 1 },
  shield: { name: 'Shield Potion', stack: 2, use: 5, shield: 50, cap: 100, rarity: 2 },
};

export const AMMO = {
  light: { name: 'Light Bullets', box: 20, cap: 999 },
  medium: { name: 'Medium Bullets', box: 10, cap: 999 },
  heavy: { name: 'Shells', box: 4, cap: 999 },
  rockets: { name: 'Rockets', box: 2, cap: 999 },
};

// A single numbering for every item kind, used on the wire. 0 is the pickaxe.
export const ITEM_KEYS = [...Object.keys(WEAPONS), ...Object.keys(HEALS), ...Object.keys(AMMO), 'wood', 'stone', 'metal'];
export const itemId = (key) => ITEM_KEYS.indexOf(key) + 1;
export const itemKey = (id) => ITEM_KEYS[id - 1];
export const isWeapon = (key) => !!WEAPONS[key];
export const isHeal = (key) => !!HEALS[key];
export const isAmmo = (key) => !!AMMO[key];
export const isMaterial = (key) => key === 'wood' || key === 'stone' || key === 'metal';

/** Damage per shot (all pellets together for shotguns) at a rarity. */
export function weaponDamage(key, rarity) {
  const w = WEAPONS[key];
  const tiers = rarity - w.tiers[0];
  return w.damage * (1 + 0.1 * tiers);
}

/** Distance falloff multiplier. */
export function falloff(key, dist) {
  const f = WEAPONS[key].falloff;
  if (!f) return 1;
  if (dist <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) {
    if (dist <= f[i][0]) {
      const [d0, m0] = f[i - 1], [d1, m1] = f[i];
      return m0 + ((m1 - m0) * (dist - d0)) / (d1 - d0);
    }
  }
  return f[f.length - 1][1];
}

export const itemName = (item) => (WEAPONS[item.key] ? `${RARITIES[item.rarity]} ${WEAPONS[item.key].name}` : HEALS[item.key]?.name || AMMO[item.key]?.name || item.key);

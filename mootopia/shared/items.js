import { radiusOf } from './sprites.js';

// Weapons, placeable items and projectiles.
//
// Sprite boxes: a weapon is drawn in the holder's frame (x forward, y to the
// right) as a length × width box whose centre sits at
// (scale + xOff, yOff) — so the grip lands in the right hand. `sprite` is the
// file under img/weapons/; weapons with `drawn` have no sprite and are drawn
// in code instead.

export const PRIMARY = 0;
export const SECONDARY = 1;

// Projectiles. `layer` 1 flies over walls (turret shots).
export const PROJECTILES = [
  { id: 0, sprite: 'arrow_1', dmg: 25, speed: 1.6, scale: 103, range: 1000, layer: 0 },
  { id: 1, dmg: 25, scale: 20, speed: 1.5, range: 700, layer: 1 },             // turret shot
  { id: 2, sprite: 'arrow_1', dmg: 35, speed: 2.5, scale: 103, range: 1200, layer: 0 },
  { id: 3, sprite: 'arrow_1', dmg: 30, speed: 2, scale: 103, range: 1200, layer: 0 },
  { id: 4, dmg: 16, scale: 20, speed: 1.5, range: 700, layer: 1 },
  { id: 5, drawn: 'bullet', dmg: 50, speed: 3.6, scale: 160, range: 1400, layer: 0 },
];

export const WEAPONS = [
  { id: 0, type: PRIMARY, name: 'Tool Hammer', desc: 'Gathers every kind of resource.', sprite: 'hammer_1', variants: ['_g', '_d'],
    length: 140, width: 140, xOff: -3, yOff: 18, dmg: 25, range: 65, gather: 1, speed: 300 },
  { id: 1, type: PRIMARY, age: 2, name: 'Hand Axe', desc: 'Gathers resources at a higher rate.', sprite: 'axe_1', variants: ['_g', '_d'],
    length: 140, width: 140, xOff: 3, yOff: 24, dmg: 30, range: 70, gather: 2, speed: 400 },
  { id: 2, type: PRIMARY, age: 8, pre: 1, name: 'Great Axe', desc: 'More damage and even more resources.', sprite: 'great_axe_1', variants: ['_d'],
    length: 140, width: 140, xOff: -8, yOff: 25, dmg: 35, range: 75, gather: 4, speed: 400 },
  { id: 3, type: PRIMARY, age: 2, name: 'Short Sword', desc: 'Hits harder, but you move slower.', sprite: 'sword_1', variants: ['_g', '_d'], iconPad: 1.3,
    length: 130, width: 210, xOff: -8, yOff: 46, dmg: 35, spdMult: 0.85, range: 110, gather: 1, speed: 300 },
  { id: 4, type: PRIMARY, age: 8, pre: 3, name: 'Katana', desc: 'Greater range and damage.', sprite: 'samurai_1', variants: ['_g', '_d'], iconPad: 1.3,
    length: 130, width: 210, xOff: -8, yOff: 59, dmg: 40, spdMult: 0.8, range: 118, gather: 1, speed: 300 },
  { id: 5, type: PRIMARY, age: 2, name: 'Polearm', desc: 'A long-reaching, heavy-hitting spear.', sprite: 'spear_1', variants: ['_g', '_d'], iconPad: 1.3,
    length: 130, width: 210, xOff: -8, yOff: 53, dmg: 45, knock: 0.2, spdMult: 0.82, range: 142, gather: 1, speed: 700 },
  { id: 6, type: PRIMARY, age: 2, name: 'Bat', desc: 'Fast, long and it knocks people flying.', sprite: 'bat_1', variants: ['_g', '_d'], iconPad: 1.3,
    length: 110, width: 180, xOff: -8, yOff: 53, dmg: 20, knock: 0.7, range: 110, gather: 1, speed: 300 },
  { id: 7, type: PRIMARY, age: 2, name: 'Daggers', desc: 'Really fast, really short.', sprite: 'daggers_1_g', plain: true, variants: [], iconPad: 0.8,
    length: 110, width: 110, xOff: 18, yOff: 0, dmg: 20, knock: 0.1, range: 65, gather: 1, hitSlow: 0.1, spdMult: 1.13, speed: 100 },
  { id: 8, type: PRIMARY, age: 2, name: 'Stick', desc: 'Great for gathering, useless in a fight.', sprite: 'stick_1', variants: ['_g'],
    length: 140, width: 140, xOff: 3, yOff: 24, dmg: 1, range: 70, gather: 7, speed: 400 },
  { id: 9, type: SECONDARY, age: 6, name: 'Hunting Bow', desc: 'Ranged combat and hunting.', sprite: 'bow_1', variants: ['_g', '_d'], cost: { wood: 4 },
    length: 120, width: 120, xOff: -6, yOff: 0, projectile: 0, spdMult: 0.75, speed: 600 },
  { id: 10, type: SECONDARY, age: 6, name: 'Great Hammer', desc: 'Smashes structures to pieces.', sprite: 'great_hammer_1', variants: ['_g', '_d'],
    length: 140, width: 140, xOff: -9, yOff: 25, dmg: 10, spdMult: 0.88, range: 75, sDmg: 7.5, gather: 1, speed: 400 },
  { id: 11, type: SECONDARY, age: 6, name: 'Wooden Shield', desc: 'Blocks arrows and softens melee hits.', sprite: 'shield_1', variants: ['_g', '_d'],
    length: 120, width: 120, shield: 0.2, xOff: 6, yOff: 0, spdMult: 0.7 },
  { id: 12, type: SECONDARY, age: 8, pre: 9, name: 'Crossbow', desc: 'More damage and a longer range.', sprite: 'crossbow_1', variants: ['_g', '_d'], cost: { wood: 5 },
    aboveHand: true, armS: 0.75, length: 120, width: 120, xOff: -4, yOff: 0, projectile: 2, spdMult: 0.7, speed: 700 },
  { id: 13, type: SECONDARY, age: 9, pre: 12, name: 'Repeater Crossbow', desc: 'Fires fast, hits a little softer.', sprite: 'crossbow_1', drawn: 'repeater', variants: ['_g', '_d'], cost: { wood: 10 },
    aboveHand: true, armS: 0.75, length: 120, width: 120, xOff: -4, yOff: 0, projectile: 3, spdMult: 0.7, speed: 230 },
  { id: 14, type: SECONDARY, age: 6, name: 'McGrabby', desc: 'Steals gold from whoever it hits.', drawn: 'grabby', variants: [],
    length: 130, width: 210, xOff: -8, yOff: 53, dmg: 0, steal: 250, knock: 0.2, spdMult: 1.05, range: 125, gather: 0, speed: 700 },
  { id: 15, type: SECONDARY, age: 9, pre: 12, name: 'Musket', desc: 'Slow to fire, brutal when it lands.', drawn: 'musket', variants: [], cost: { stone: 10 },
    aboveHand: true, rec: 0.35, armS: 0.6, hndS: 0.3, hndD: 1.6, length: 205, width: 205, xOff: 25, yOff: 0, projectile: 5, hideProjectile: true, spdMult: 0.6, speed: 1500 },
];

// Item groups: how many of each you may have placed at once, and which layer
// they draw on (-1 under players, 0 with them, 1 over them).
export const GROUPS = [
  { id: 0, name: 'food', layer: 0 },
  { id: 1, name: 'walls', place: true, limit: 30, layer: 0 },
  { id: 2, name: 'spikes', place: true, limit: 15, layer: 0 },
  { id: 3, name: 'mill', place: true, limit: 7, layer: 1 },
  { id: 4, name: 'mine', place: true, limit: 1, layer: 0 },
  { id: 5, name: 'trap', place: true, limit: 6, layer: -1 },
  { id: 6, name: 'booster', place: true, limit: 12, layer: -1 },
  { id: 7, name: 'turret', place: true, limit: 2, layer: 1 },
  { id: 8, name: 'platform', place: true, limit: 12, layer: 1 },
  { id: 9, name: 'healing', place: true, limit: 4, layer: -1 },
  { id: 10, name: 'spawn', place: true, limit: 1, layer: -1 },
  { id: 11, name: 'sapling', place: true, limit: 2, layer: 0 },
  { id: 12, name: 'blocker', place: true, limit: 3, layer: -1 },
  { id: 13, name: 'teleporter', place: true, limit: 2, layer: -1 },
];

const g = (id) => GROUPS[id];

// `heal` foods restore health instantly; cheese also heals over time.
export const ITEMS = [
  { name: 'Apple', desc: 'Restores 20 health.', group: g(0), cost: { food: 10 }, heal: 20, sprite: 'apple', scale: 22, holdOffset: 15 },
  { age: 3, name: 'Cookie', desc: 'Restores 40 health.', group: g(0), cost: { food: 15 }, heal: 40, sprite: 'cookie_1', scale: 27, holdOffset: 15 },
  { age: 7, name: 'Cheese', desc: 'Restores 30 health, then 50 more over 5 seconds.', group: g(0), cost: { food: 25 }, heal: 30, healOverTime: 10, healTicks: 5, sprite: 'cheese', svg: true, scale: 27, holdOffset: 15 },
  { name: 'Wood Wall', desc: 'Protects your base.', group: g(1), cost: { wood: 10 }, projDmg: true, health: 380, sprite: 'wood_wall', scale: 50, holdOffset: 20, placeOffset: -5 },
  { age: 3, name: 'Stone Wall', desc: 'Sturdier protection.', group: g(1), cost: { stone: 25 }, health: 900, sprite: 'stone_wall', scale: 50, holdOffset: 20, placeOffset: -5 },
  { age: 7, pre: 1, name: 'Castle Wall', desc: 'The strongest wall there is.', group: g(1), cost: { stone: 35 }, health: 1500, sprite: 'stone_wall', tint: 'castle', scale: 52, holdOffset: 20, placeOffset: -5 },
  { name: 'Spikes', desc: 'Hurts anyone who touches it.', group: g(2), cost: { wood: 20, stone: 5 }, health: 400, dmg: 20, sprite: 'spikes', scale: 49, spritePadding: -23, holdOffset: 8, placeOffset: -5 },
  { age: 5, name: 'Greater Spikes', desc: 'Hurts even more.', group: g(2), cost: { wood: 30, stone: 10 }, health: 500, dmg: 35, sprite: 'greater_spikes', scale: 52, spritePadding: -23, holdOffset: 8, placeOffset: -5 },
  { age: 9, pre: 1, name: 'Poison Spikes', desc: 'Poisons anyone who touches it.', group: g(2), cost: { wood: 35, stone: 15 }, health: 600, dmg: 30, pDmg: 5, sprite: 'greater_spikes', tint: 'poison', scale: 52, spritePadding: -23, holdOffset: 8, placeOffset: -5 },
  { age: 9, pre: 2, name: 'Spinning Spikes', desc: 'Spins, and hurts a lot.', group: g(2), cost: { wood: 30, stone: 20 }, health: 500, dmg: 45, turnSpeed: 0.003, sprite: 'spinning_spikes', scale: 52, spritePadding: -23, holdOffset: 8, placeOffset: -5 },
  { name: 'Windmill', desc: 'Makes gold over time.', group: g(3), cost: { wood: 50, stone: 10 }, health: 400, pps: 1, turnSpeed: 0.0016, sprite: 'mill', scale: 45, spritePadding: 25, holdOffset: 20, placeOffset: 5 },
  { age: 5, pre: 1, name: 'Faster Windmill', desc: 'Makes more gold over time.', group: g(3), cost: { wood: 60, stone: 20 }, health: 500, pps: 1.5, turnSpeed: 0.0025, sprite: 'mill', scale: 47, spritePadding: 25, holdOffset: 20, placeOffset: 5 },
  { age: 8, pre: 1, name: 'Power Mill', desc: 'Makes the most gold over time.', group: g(3), cost: { wood: 100, stone: 50 }, health: 800, pps: 2, turnSpeed: 0.005, sprite: 'mill', tint: 'power', scale: 47, spritePadding: 25, holdOffset: 20, placeOffset: 5 },
  { age: 5, name: 'Mine', desc: 'A rock you can mine for stone forever.', group: g(4), type: 2, cost: { wood: 20, stone: 100 }, sprite: 'mine', scale: 65, holdOffset: 20, placeOffset: 0 },
  { age: 5, name: 'Sapling', desc: 'A tree you can farm for wood.', group: g(11), type: 0, cost: { wood: 150 }, sprite: 'sapling', scale: 110, holdOffset: 50, placeOffset: -15 },
  { age: 4, name: 'Pit Trap', desc: 'Traps anyone who walks over it.', group: g(5), cost: { wood: 30, stone: 30 }, trap: true, ignoreCollision: true, hideFromEnemy: true, health: 500, colDiv: 0.2, sprite: 'trap', scale: 50, holdOffset: 20, placeOffset: -5 },
  { age: 4, name: 'Boost Pad', desc: 'Launches you forwards.', group: g(6), cost: { stone: 20, wood: 5 }, ignoreCollision: true, boostSpeed: 1.5, health: 150, colDiv: 0.7, sprite: 'boost_pad', scale: 45, holdOffset: 20, placeOffset: -5 },
  { age: 7, name: 'Turret', desc: 'Shoots at enemies nearby.', group: g(7), cost: { wood: 200, stone: 150 }, health: 800, projectile: 1, shootRange: 700, shootRate: 2200, sprite: 'turret', drawn: 'turret', scale: 43, holdOffset: 20, placeOffset: -5 },
  { age: 7, name: 'Platform', desc: 'Stand on it to shoot over walls and cross water.', group: g(8), cost: { wood: 20 }, ignoreCollision: true, zIndex: 1, health: 300, sprite: 'platform', scale: 43, holdOffset: 20, placeOffset: -5 },
  { age: 7, name: 'Healing Pad', desc: 'Heals you while you stand on it.', group: g(9), cost: { wood: 30, food: 10 }, ignoreCollision: true, healCol: 15, health: 400, colDiv: 0.7, sprite: 'healing_pad', scale: 45, holdOffset: 20, placeOffset: -5 },
  { age: 9, name: 'Spawn Pad', desc: 'You respawn here once, then it vanishes.', group: g(10), cost: { wood: 100, stone: 100 }, health: 400, ignoreCollision: true, spawnPoint: true, sprite: 'spawn_pad', scale: 45, holdOffset: 20, placeOffset: -5 },
  { age: 7, name: 'Blocker', desc: 'Stops anyone building near it.', group: g(12), cost: { wood: 30, stone: 25 }, ignoreCollision: true, blocker: 300, health: 400, colDiv: 0.7, sprite: 'blocker', drawn: 'blocker', scale: 45, holdOffset: 20, placeOffset: -5 },
  { age: 7, name: 'Teleporter', desc: 'Sends you somewhere random.', group: g(13), cost: { wood: 60, stone: 60 }, ignoreCollision: true, teleport: true, health: 200, colDiv: 0.7, sprite: 'teleporter', scale: 45, holdOffset: 20, placeOffset: -5 },
];

/** The sprite an item is drawn with, keyed like shared/sprites.js. */
export const itemSpriteKey = (it) => (it.drawn ? `drawn/${it.drawn}` : `items/${it.sprite === 'mill' ? 'mill_1' : it.sprite}`);

ITEMS.forEach((it, i) => {
  it.id = i;
  // A placed item's hitbox is its drawn silhouette. Food is never placed.
  if (it.group.place) it.scale = radiusOf(itemSpriteKey(it));
});
// `pre` counts back from the item: "needs the item this many places earlier".
ITEMS.forEach((it) => { if (it.pre) it.pre = it.id - it.pre; });

export const START_ITEMS = [0, 3, 6, 10];  // apple, wood wall, spikes, windmill
export const START_WEAPONS = [0];          // tool hammer

/** The items and weapons a player may pick at `age`, given what they own. */
export function upgradeChoices(age, items, weapons) {
  const out = [];
  for (const w of WEAPONS) if (w.age === age && (w.pre === undefined || weapons.includes(w.pre))) out.push({ kind: 'weapon', id: w.id });
  for (const it of ITEMS) if (it.age === age && (it.pre === undefined || items.includes(it.pre))) out.push({ kind: 'item', id: it.id });
  return out;
}

export const costOf = (thing, mult = 1) => Object.entries(thing.cost || {}).map(([res, n]) => [res, Math.round(n * mult)]);

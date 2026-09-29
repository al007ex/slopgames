// Hats, bought with gold in the shop and worn one at a time. Every effect is a
// multiplier or a flat bonus the server applies; `scale` is the drawn size.

export const HATS = [
  { id: 1001, name: 'Booster Hat', desc: 'Move faster.', price: 6000, scale: 130,
    spdMult: 1.16 },
  { id: 1002, name: 'Knight Hat', desc: 'Take a quarter less damage, move a little slower.', price: 14000, scale: 130,
    spdMult: 0.92, dmgTaken: 0.75 },
  { id: 1003, name: 'Clown Hat', desc: 'Worn by anyone caught eating too fast after being hit.', price: 0, scale: 130,
    hidden: true },
  { id: 1004, name: 'Samurai Gear', desc: 'Swing a tenth faster; your hits land a little softer.', price: 17000, scale: 130,
    spdMult: 1.02, dmgDealt: 0.8, atkSpd: 0.9 },
  { id: 1005, name: 'Mutant Hat', desc: 'Hit a quarter harder, but it drains 5 health a second.', price: 18000, scale: 130,
    dmgDealt: 1.25, regen: -5 },
  { id: 1006, name: 'Tank Gear', desc: 'Double structure damage and tougher skin, at a crawl.', price: 20000, scale: 130,
    spdMult: 0.28, dmgTaken: 0.85, structDmg: 2 },
  { id: 1007, name: 'Tuff Hat', desc: 'A big pile of extra health.', price: 20000, scale: 140,
    extraHealth: 650 },
  { id: 1008, name: 'Shark Hat', desc: 'Swim through the current and hit harder in water.', price: 20000, scale: 130,
    waterImmune: true, currentMult: 0.05, waterDmg: 1.2 },
  { id: 1009, name: 'Spike Hat', desc: 'Returns a quarter of melee damage to whoever hit you.', price: 20000, scale: 130,
    reflect: 0.25 },
];

export const hatById = (id) => HATS.find((h) => h.id === id) || null;
export const SHOP_HATS = HATS.filter((h) => !h.hidden);

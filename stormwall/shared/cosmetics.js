// Cosmetics are purely visual: an outfit's colours, a glider's canopy, a
// pickaxe's head. Some are unlocked by level, the rest bought with coins that
// are only ever earned by playing. There is no real money anywhere.

export const OUTFITS = [
  { id: 0, name: 'Recruit', shirt: 0x5b7fa8, pants: 0x3a4250, skin: 0xe0b48f, hair: 0x3b2a1e, accent: 0x9cc4e8, price: 0, level: 1 },
  { id: 1, name: 'Recruit II', shirt: 0xb05a4a, pants: 0x2f3440, skin: 0x8d5a3b, hair: 0x1b1410, accent: 0xe8a090, price: 0, level: 1 },
  { id: 2, name: 'Scout', shirt: 0x5d8f4e, pants: 0x4d4234, skin: 0xf1c9a5, hair: 0xc98a3c, accent: 0xb5d98e, price: 0, level: 3 },
  { id: 3, name: 'Hazard', shirt: 0xe8b02c, pants: 0x2b2b2b, skin: 0xc68a5e, hair: 0x2a1c12, accent: 0x222222, price: 0, level: 6 },
  { id: 4, name: 'Nightshift', shirt: 0x26263a, pants: 0x18181f, skin: 0xd6a57f, hair: 0x0f0f14, accent: 0x7a6cff, price: 800, level: 1 },
  { id: 5, name: 'Lifeguard', shirt: 0xe23d3d, pants: 0xf2d9a0, skin: 0xe8b894, hair: 0xf0d27a, accent: 0xffffff, price: 800, level: 1 },
  { id: 6, name: 'Rancher', shirt: 0x8a5a36, pants: 0x3f5a78, skin: 0xd9a37c, hair: 0x5a3a22, accent: 0xd4b06a, price: 1200, level: 1 },
  { id: 7, name: 'Circuit', shirt: 0x1c2b3a, pants: 0x0f1a24, skin: 0xbfe3ff, hair: 0x00e0ff, accent: 0x00e0ff, price: 1500, level: 1 },
  { id: 8, name: 'Marsh Walker', shirt: 0x4f6a3a, pants: 0x3a3f2a, skin: 0xb88a64, hair: 0x2d2a1a, accent: 0x9aa84a, price: 0, level: 10 },
  { id: 9, name: 'Sunburst', shirt: 0xff8a2a, pants: 0x7a2a8a, skin: 0xf0c098, hair: 0xff4fa8, accent: 0xffe14f, price: 2000, level: 1 },
  { id: 10, name: 'Ironclad', shirt: 0x8a9098, pants: 0x4a5058, skin: 0xcaa07a, hair: 0x202020, accent: 0xd0d6de, price: 0, level: 15 },
  { id: 11, name: 'Stormchaser', shirt: 0x6a3cc8, pants: 0x241a3a, skin: 0xe6b48e, hair: 0xe6e6ff, accent: 0xc38bff, price: 0, level: 25 },
];

export const GLIDERS = [
  { id: 0, name: 'Standard Issue', a: 0x3f7ad8, b: 0xf2f2f2, price: 0, level: 1 },
  { id: 1, name: 'Sunset', a: 0xff7a3a, b: 0xffd45a, price: 500, level: 1 },
  { id: 2, name: 'Checker', a: 0x202020, b: 0xf6f6f6, price: 0, level: 5 },
  { id: 3, name: 'Kite', a: 0xe23d6a, b: 0x3de2c0, price: 700, level: 1 },
  { id: 4, name: 'Storm Wing', a: 0x6a3cc8, b: 0x2a1a4a, price: 0, level: 20 },
  { id: 5, name: 'Meadow', a: 0x5da83a, b: 0xf7e36a, price: 500, level: 1 },
];

export const PICKAXES = [
  { id: 0, name: 'Standard Pick', head: 0x8a9098, handle: 0x7a5230, price: 0, level: 1 },
  { id: 1, name: 'Red Axe', head: 0xc23a2a, handle: 0x3a2a1a, price: 400, level: 1 },
  { id: 2, name: 'Gold Digger', head: 0xe8c040, handle: 0x5a3a1a, price: 0, level: 8 },
  { id: 3, name: 'Neon Pick', head: 0x00e0ff, handle: 0x1a1a2a, price: 900, level: 1 },
  { id: 4, name: 'Frost Pick', head: 0xbfe8ff, handle: 0x3a4a6a, price: 0, level: 18 },
];

export const COSMETICS = { outfit: OUTFITS, glider: GLIDERS, pickaxe: PICKAXES };

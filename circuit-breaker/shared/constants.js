// Tuning for Circuit Breaker. The simulation, the tests and the renderer all
// import this one file, so a number changed here moves the game and its drawing
// together and the two can never drift apart.

// ---- Board -------------------------------------------------------------
// Packets enter on the left edge and walk to the core on the right. Everything
// in the simulation is measured in cells; only the renderer knows about pixels.
export const COLS = 20;
export const ROWS = 13;
export const ENTRY = { col: 0, row: 6 };
export const CORE = { col: COLS - 1, row: 6 };

// Fixed obstacles on the board. They exist to stop the opening from being an
// empty rectangle — you build your maze around them, which makes the first
// couple of placements a decision instead of a formality.
export const TRACES = [
  { col: 5, row: 2 }, { col: 5, row: 3 }, { col: 5, row: 4 },
  { col: 5, row: 8 }, { col: 5, row: 9 }, { col: 5, row: 10 },
  { col: 10, row: 0 }, { col: 10, row: 1 }, { col: 10, row: 2 },
  { col: 10, row: 10 }, { col: 10, row: 11 }, { col: 10, row: 12 },
  { col: 14, row: 5 }, { col: 14, row: 6 }, { col: 14, row: 7 },
];

// ---- Economy -----------------------------------------------------------
export const START_CREDITS = 260;
export const START_INTEGRITY = 20;
export const BUILD_SECONDS = 12;      // breather between waves
export const SELL_RATIO = 0.6;        // refund on the total invested in a tower
export const WAVE_CLEAR_BONUS = 40;   // paid per wave survived
export const RUSH_BONUS_PER_SECOND = 5; // paid for the build time you skip

// ---- Heat --------------------------------------------------------------
// Every tower runs hot. Firing adds heat, heat bleeds away on its own, and a
// tower that hits the ceiling shuts down until it has cooled back to RESET.
// This is what stops "place five lasers and walk away" from being a strategy.
export const HEAT_MAX = 100;
export const HEAT_RESET = 40;

// Overclock is the active half of that trade: a short, very large boost that
// almost always ends in a shutdown. Spending it well is the skill in the game.
export const OVERCLOCK = {
  seconds: 5,
  cooldown: 20,
  fireRateScale: 2.2,
  damageScale: 1.4,
  heatScale: 1.2,
};

// ---- Surge -------------------------------------------------------------
// One panic button, on a long cooldown, for when a wave gets away from you.
export const SURGE = {
  damage: 60,
  stunSeconds: 1.5,
  cooldown: 45,
};

// ---- Towers ------------------------------------------------------------
// `cost` buys level 1. Each later level costs cost * UPGRADE_COST_SCALE * level,
// so a fully upgraded tower is roughly 3.5x the price of a fresh one.
export const UPGRADE_COST_SCALE = 0.85;

export const TOWERS = {
  pulse: {
    name: 'Pulse Node',
    blurb: 'Cheap, quick, and never stops chattering.',
    cost: 55,
    kind: 'beam',
    heatPerShot: 9,
    coolRate: 22,
    accent: '#d9ff55',
    levels: [
      { damage: 9, fireRate: 0.45, range: 2.6 },
      { damage: 15, fireRate: 0.38, range: 2.9 },
      { damage: 24, fireRate: 0.32, range: 3.2 },
    ],
  },
  arc: {
    name: 'Arc Relay',
    blurb: 'Jumps between packets. Loves a crowd.',
    cost: 130,
    kind: 'chain',
    chainTargets: 3,
    chainFalloff: 0.7,
    heatPerShot: 16,
    coolRate: 19,
    accent: '#6ad7ff',
    levels: [
      { damage: 12, fireRate: 0.9, range: 2.8 },
      { damage: 19, fireRate: 0.8, range: 3.0 },
      { damage: 29, fireRate: 0.7, range: 3.3 },
    ],
  },
  cryo: {
    name: 'Cryo Vent',
    blurb: 'Barely scratches anything. Slows everything.',
    cost: 95,
    kind: 'slow',
    slowFactor: 0.55,
    slowSeconds: 1.5,
    splash: 1.4,
    heatPerShot: 11,
    coolRate: 26,
    accent: '#9db8ff',
    levels: [
      { damage: 4, fireRate: 0.7, range: 2.2 },
      { damage: 7, fireRate: 0.62, range: 2.5 },
      { damage: 11, fireRate: 0.55, range: 2.8 },
    ],
  },
  rail: {
    name: 'Rail Cannon',
    blurb: 'Slow, expensive, and removes armour from the argument.',
    cost: 175,
    kind: 'shell',
    shellSpeed: 9,
    splash: 1.1,
    heatPerShot: 55,
    coolRate: 18,
    accent: '#ff9d5c',
    levels: [
      { damage: 46, fireRate: 1.7, range: 3.6 },
      { damage: 72, fireRate: 1.55, range: 3.9 },
      { damage: 112, fireRate: 1.4, range: 4.2 },
    ],
  },
  laser: {
    name: 'Laser Grid',
    blurb: 'Burns hotter the longer it holds a target — and just plain hotter.',
    cost: 220,
    kind: 'laser',
    rampMax: 3,
    rampPerSecond: 0.9,
    heatPerShot: 4.2,
    coolRate: 17,
    accent: '#ff557d',
    levels: [
      { damage: 7, fireRate: 0.1, range: 3.0 },
      { damage: 11, fireRate: 0.1, range: 3.2 },
      { damage: 17, fireRate: 0.1, range: 3.5 },
    ],
  },
};

export const TOWER_ORDER = ['pulse', 'arc', 'cryo', 'rail', 'laser'];

// ---- Packets (the enemies) ---------------------------------------------
// `armor` is flat reduction taken off every hit, which is what makes Cryo and
// Pulse fall off late and gives Rail Cannon a reason to exist. A hit always
// does at least MIN_DAMAGE so nothing is ever fully immune.
export const MIN_DAMAGE = 1;

export const PACKETS = {
  bit: { name: 'Bit', hp: 28, speed: 2.4, armor: 0, bounty: 6, damage: 1, radius: 0.26, color: '#8be9fd' },
  worm: { name: 'Worm', hp: 18, speed: 4.2, armor: 0, bounty: 5, damage: 1, radius: 0.22, color: '#d9ff55' },
  byte: { name: 'Byte', hp: 90, speed: 1.7, armor: 4, bounty: 12, damage: 2, radius: 0.32, color: '#ffb86c' },
  ghost: { name: 'Ghost', hp: 70, speed: 2.8, armor: 2, bounty: 18, damage: 2, radius: 0.28, color: '#bd93f9', phase: { every: 3, seconds: 0.8 } },
  daemon: { name: 'Daemon', hp: 150, speed: 1.5, armor: 11, bounty: 22, damage: 3, radius: 0.36, color: '#ff6e6e' },
  root: { name: 'Root Kit', hp: 900, speed: 1.1, armor: 12, bounty: 150, damage: 6, radius: 0.5, color: '#ff557d', boss: true, splits: { type: 'bit', count: 6 } },
};

// ---- Waves -------------------------------------------------------------
// Handwritten rather than generated: the shape of a wave (one long trickle, or
// three tight packs) matters more than its raw numbers, and that does not come
// out of a formula. `hpScale` carries the late-game difficulty instead.
export const WAVES = [
  { hpScale: 1.00, groups: [{ type: 'bit', count: 8, gap: 0.85 }] },
  { hpScale: 1.00, groups: [{ type: 'bit', count: 12, gap: 0.7 }] },
  { hpScale: 1.05, groups: [{ type: 'worm', count: 10, gap: 0.35 }] },
  { hpScale: 1.05, groups: [{ type: 'bit', count: 10, gap: 0.6 }, { type: 'byte', count: 2, gap: 1.6, delay: 3 }] },
  { hpScale: 1.10, groups: [{ type: 'byte', count: 6, gap: 1.2 }] },
  { hpScale: 1.15, groups: [{ type: 'worm', count: 16, gap: 0.25 }, { type: 'bit', count: 8, gap: 0.6, delay: 5 }] },
  { hpScale: 1.20, groups: [{ type: 'ghost', count: 4, gap: 1.4 }, { type: 'bit', count: 10, gap: 0.5 }] },
  { hpScale: 1.25, groups: [{ type: 'byte', count: 8, gap: 0.9 }, { type: 'worm', count: 12, gap: 0.3, delay: 4 }] },
  { hpScale: 1.30, groups: [{ type: 'daemon', count: 3, gap: 2.0 }, { type: 'bit', count: 14, gap: 0.45 }] },
  { hpScale: 1.25, boss: true, groups: [{ type: 'root', count: 1, gap: 1 }, { type: 'worm', count: 14, gap: 0.4, delay: 2 }] },
  { hpScale: 1.50, groups: [{ type: 'ghost', count: 8, gap: 0.9 }] },
  { hpScale: 1.60, groups: [{ type: 'byte', count: 10, gap: 0.7 }, { type: 'daemon', count: 4, gap: 1.6, delay: 3 }] },
  { hpScale: 1.72, groups: [{ type: 'worm', count: 24, gap: 0.18 }] },
  { hpScale: 1.85, groups: [{ type: 'daemon', count: 7, gap: 1.2 }, { type: 'ghost', count: 6, gap: 1.0, delay: 4 }] },
  { hpScale: 2.02, groups: [{ type: 'byte', count: 14, gap: 0.55 }, { type: 'bit', count: 20, gap: 0.3, delay: 6 }] },
  { hpScale: 2.20, groups: [{ type: 'ghost', count: 10, gap: 0.7 }, { type: 'daemon', count: 6, gap: 1.3, delay: 5 }] },
  { hpScale: 2.38, groups: [{ type: 'worm', count: 30, gap: 0.15 }, { type: 'byte', count: 10, gap: 0.6, delay: 5 }] },
  { hpScale: 2.60, groups: [{ type: 'daemon', count: 10, gap: 1.0 }] },
  { hpScale: 2.82, groups: [{ type: 'ghost', count: 12, gap: 0.6 }, { type: 'daemon', count: 8, gap: 1.1, delay: 4 }] },
  { hpScale: 1.94, boss: true, groups: [{ type: 'root', count: 2, gap: 4 }, { type: 'byte', count: 14, gap: 0.5, delay: 3 }] },
  { hpScale: 3.43, groups: [{ type: 'worm', count: 36, gap: 0.13 }, { type: 'ghost', count: 10, gap: 0.7, delay: 4 }] },
  { hpScale: 3.78, groups: [{ type: 'daemon', count: 14, gap: 0.85 }] },
  { hpScale: 4.14, groups: [{ type: 'byte', count: 20, gap: 0.45 }, { type: 'ghost', count: 14, gap: 0.6, delay: 5 }] },
  { hpScale: 4.10, groups: [{ type: 'daemon', count: 16, gap: 0.75 }, { type: 'worm', count: 30, gap: 0.15, delay: 6 }] },
  { hpScale: 2.30, boss: true, final: true, groups: [{ type: 'root', count: 4, gap: 5 }, { type: 'daemon', count: 12, gap: 1.0, delay: 4 }, { type: 'ghost', count: 12, gap: 0.7, delay: 10 }] },
];

export const VICTORY_BONUS = 10_000;

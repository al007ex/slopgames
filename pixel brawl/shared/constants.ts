/**
 * Global tuning constants shared by client + server.
 * World units == art pixels. 1 tile = 16 world units.
 */

export const TILE = 16;
export const TICK_HZ = 20;
export const TICK_DT = 1 / TICK_HZ;
export const INPUT_HZ = 30;

export const PLAYER_RADIUS = 6.2;
export const PET_RADIUS = 6.0;

/** How long a player stays visible after attacking while hidden in a bush. */
export const BUSH_EXPOSE_TIME = 1.1;
/** Enemies inside a bush become visible within this distance. */
export const BUSH_REVEAL_DIST = 34;

export const RESPAWN_TIME = 3.0;
export const SPAWN_INVULN = 1.4;

export const AMMO_MAX = 3;

export enum GameMode {
  Showdown = 'showdown',
  Duel = 'duel',
  GemGrab = 'gemgrab',
  Bounty = 'bounty',
}

export interface ModeInfo {
  id: GameMode;
  name: string;
  short: string;
  players: number;
  teams: number;
  teamSize: number;
  duration: number;
  desc: string;
  color: string;
  icon: string;
}

export const MODES: Record<GameMode, ModeInfo> = {
  [GameMode.Duel]: {
    id: GameMode.Duel,
    name: 'DUEL',
    short: '1v1',
    players: 2,
    teams: 2,
    teamSize: 1,
    duration: 150,
    desc: 'One on one. Three lives each. Last brawler standing takes the win.',
    color: '#ff6b3d',
    icon: 'duel',
  },
  [GameMode.Showdown]: {
    id: GameMode.Showdown,
    name: 'SHOWDOWN',
    short: 'FFA',
    players: 8,
    teams: 8,
    teamSize: 1,
    duration: 180,
    desc: 'Eight brawlers enter, one leaves. Grab power cubes and dodge the poison.',
    color: '#8b5cf6',
    icon: 'skull',
  },
  [GameMode.GemGrab]: {
    id: GameMode.GemGrab,
    name: 'GEM GRAB',
    short: '3v3',
    players: 6,
    teams: 2,
    teamSize: 3,
    duration: 150,
    desc: 'Collect and hold 10 gems for the countdown. Dying drops your gems!',
    color: '#3ddc84',
    icon: 'gem',
  },
  [GameMode.Bounty]: {
    id: GameMode.Bounty,
    name: 'BOUNTY',
    short: '2v2',
    players: 4,
    teams: 2,
    teamSize: 2,
    duration: 120,
    desc: 'Team up with a friend. Take out the enemy to earn stars. Most stars wins.',
    color: '#ffd23f',
    icon: 'star',
  },
};

export const MODE_LIST: ModeInfo[] = [
  MODES[GameMode.GemGrab],
  MODES[GameMode.Showdown],
  MODES[GameMode.Bounty],
  MODES[GameMode.Duel],
];

/** Gem Grab */
export const GEM_WIN_COUNT = 10;
export const GEM_COUNTDOWN = 15;
export const GEM_SPAWN_INTERVAL = 2.4;

/** Bounty */
export const BOUNTY_MAX_STAR = 7;

/** Duel */
export const DUEL_LIVES = 3;

/** Showdown poison */
export const POISON_START = 45;
export const POISON_SHRINK_RATE = 11;
export const POISON_DPS_BASE = 500;
export const POISON_DPS_RAMP = 220;

/** Power cube stat bonus per cube (Showdown) */
export const CUBE_HP = 400;
export const CUBE_DMG_PCT = 0.12;

/** Progression */
export const MAX_POWER_LEVEL = 9;
/** Power points required to go from level N -> N+1 (index 0 = 1->2) */
export const UPGRADE_POINTS = [20, 30, 50, 80, 130, 210, 340, 550];
export const UPGRADE_COINS = [20, 35, 75, 140, 290, 480, 800, 1250];
/** Multiplicative stat scale per power level (index = level-1) */
export const POWER_SCALE = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4];

export const TOKENS_PER_BOX = 100;
export const TOKEN_DAILY_CAP = 200;

export enum Rarity {
  Starting = 'starting',
  Rare = 'rare',
  SuperRare = 'superrare',
  Epic = 'epic',
  Mythic = 'mythic',
  Legendary = 'legendary',
}

export const RARITY_INFO: Record<Rarity, { name: string; color: string; dark: string; cards: number; weight: number }> = {
  [Rarity.Starting]: { name: 'STARTING', color: '#c9d1d9', dark: '#5c6470', cards: 0, weight: 0 },
  [Rarity.Rare]: { name: 'RARE', color: '#4ade80', dark: '#1a7f42', cards: 20, weight: 46 },
  [Rarity.SuperRare]: { name: 'SUPER RARE', color: '#38bdf8', dark: '#0b5f8a', cards: 40, weight: 26 },
  [Rarity.Epic]: { name: 'EPIC', color: '#c084fc', dark: '#6b21a8', cards: 80, weight: 15 },
  [Rarity.Mythic]: { name: 'MYTHIC', color: '#f87171', dark: '#991b1b', cards: 140, weight: 9 },
  [Rarity.Legendary]: { name: 'LEGENDARY', color: '#fde047', dark: '#a16207', cards: 250, weight: 4 },
};

export const TEAM_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
export const TEAM_COLORS_DARK = ['#1d4ed8', '#b91c1c', '#15803d', '#a16207', '#7e22ce', '#be185d', '#0f766e', '#c2410c'];

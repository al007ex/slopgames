// Every number the game's feel depends on. These follow the classic
// top-down gathering-and-building .io formula: a square map, snow up top,
// desert along the bottom, a river through the middle and a 9 Hz server.

export const TICK_MS = 1000 / 9;           // the server steps nine times a second
export const MAP = 14400;                  // the map is MAP × MAP units
export const SNOW_TOP = 2400;              // y below this is snow
export const DESERT_TOP = MAP - 2400;      // y above this is desert
export const RIVER_WIDTH = 724;
export const RIVER_PADDING = 114;          // sandy bank either side of the water
export const RIVER_TOP = MAP / 2 - RIVER_WIDTH / 2;
export const RIVER_BOTTOM = MAP / 2 + RIVER_WIDTH / 2;
export const WATER_CURRENT = 0.0011;       // pushes everything in the river east
export const WAVE_SPEED = 0.0001;
export const WAVE_MAX = 1.3;

// The area a client sees. Everyone sees the same amount of world, scaled to
// fit their window, and the server only sends what falls inside it.
export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const SEE_X = VIEW_W / 2 * 1.3;
export const SEE_Y = VIEW_H / 2 * 1.3;

// Players.
export const PLAYER_SCALE = 35;
export const PLAYER_SPEED = 0.0016;        // acceleration per ms, per unit of input
export const DECEL = 0.993;                // velocity is multiplied by this every ms
export const SNOW_SPEED = 0.75;
export const WATER_SPEED = 0.33;
export const BUILD_SPEED = 0.5;            // holding an item to place slows you down
export const MAX_HEALTH = 100;
export const MAX_AGE = 100;
export const FIRST_XP = 300;               // XP needed for age 2; ×1.2 every age after
export const XP_GROWTH = 1.2;
export const MAX_NAME = 15;
export const MAX_PLAYERS = 40;

// Hitting.
export const GATHER_ANGLE = Math.PI / 2.6; // half-width of the cone a swing covers
export const HIT_ANGLE = Math.PI / 2;      // how far the arm swings when it connects
export const MISS_ANGLE = Math.PI;         // …and when it only cuts air
export const HIT_RETURN = 0.25;            // share of the swing spent going out
export const SHIELD_ANGLE = Math.PI / 3;
export const HIT_SLOW = 0.3;               // a swing costs this much of your speed…
export const SLOW_RECOVER = 0.0008;        // …which comes back at this rate per ms
export const PLAYER_KNOCK = 0.3;           // base knockback of a melee hit
export const SPIKE_KNOCK = 1.5;            // knockback of touching a spike
export const PLAYER_HIT_PAD = 1.8;         // players are hit out to scale × this
export const GATHER_WIGGLE = 10;           // how far a struck object jolts
export const RESOURCE_TYPES = ['wood', 'food', 'stone', 'gold'];

// Weapon XP ranks. Each rank shows a new finish on the weapon; the top two poison.
export const VARIANTS = [
  { id: 0, suffix: '', xp: 0, dmg: 1, name: '' },
  { id: 1, suffix: '_g', xp: 3000, dmg: 1.1, name: 'gold' },
  { id: 2, suffix: '_d', xp: 7000, dmg: 1.18, name: 'diamond' },
  { id: 3, suffix: '_r', xp: 12000, dmg: 1.18, poison: true, name: 'ruby' },
];
export const POISON = { dmg: 5, ticks: 5 };

// Nature.
export const TREE_SCALES = [150, 160, 165, 175];
export const BUSH_SCALES = [80, 85, 95];
export const ROCK_SCALES = [80, 85, 90];
export const TREES = 460;
export const BUSHES = 170;
export const ROCKS = 190;
export const GOLD_ORES = 44;
export const CACTUS_DMG = 35;

// Chat, clans and the rest of the social layer.
export const CHAT_COOLDOWN = 500;
export const CHAT_SHOW = 3000;
export const MAX_CHAT = 30;
export const CLAN_MAX = 8;
export const MAX_CLAN_NAME = 7;
export const MINIMAP_MS = 3000;
export const PING_MS = 2200;
export const DEATH_FADE = 3000;

// Eat too fast after being hit and the server makes you wear the clown hat.
export const SHAME_WINDOW = 120;
export const SHAME_LIMIT = 8;
export const SHAME_MS = 30000;
export const CLOWN_HAT = 1003;

// Colours a player can pick for their body.
export const SKIN_COLORS = ['#bf8f54', '#cbb091', '#896c4b', '#fadadc', '#ececec', '#c37373', '#4c4c4c', '#ecaff7', '#738cc3', '#8bc373'];

export const inRiver = (y) => y >= RIVER_TOP && y <= RIVER_BOTTOM;
export const biomeAt = (y) => (y < SNOW_TOP ? 'snow' : y > DESERT_TOP ? 'desert' : 'grass');

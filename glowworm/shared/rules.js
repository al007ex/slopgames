// Every number that shapes how Glowworm plays. The server simulates with these,
// the client draws with them and the tests hold them to account, so a change
// here moves all three together.

// ---- Clock -------------------------------------------------------------
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
export const TICK_MS = 1000 / SIM_HZ;
// Snapshots go out every other tick (15 Hz). The client interpolates between
// them, so this trades a little latency for half the bandwidth — which is what
// keeps the game comfortable on a phone connection.
export const SEND_EVERY = 2;

// ---- Arena -------------------------------------------------------------
export const ARENA_RADIUS = 2800;
// Positions travel as int16 at half-unit precision; ±2800 * 2 fits with room.
export const COORD_SCALE = 2;

// ---- Snakes ------------------------------------------------------------
export const START_MASS = 10;
export const MIN_BOOST_MASS = 14;
export const BASE_SPEED = 175;      // world units per second
export const BOOST_SPEED = 380;
export const BOOST_DROP_SECONDS = 0.14;
export const DEATH_DROP_RATIO = 0.75;
// Collisions use slightly shrunken circles. Exact circles feel unfair — you
// die to a pixel you could not see — so contact has to be convincing.
export const HIT_FORGIVENESS = 0.78;

/** Boosting burns mass faster the bigger you are, so it is never free. */
export const boostBurn = (mass) => 1.6 + mass * 0.012;

// Width, length and turning all grow sub-linearly. A huge snake is wide, long
// and slow to turn — which is exactly what makes it catchable.
export const widthOf = (mass) => Math.min(80, 16 + Math.sqrt(mass) * 0.62);
export const lengthOf = (mass) => 34 * Math.sqrt(mass) + 40;
// Body points sit at a fraction of the width, so the circles always overlap
// and the body reads as one tube however it bends.
export const spacingOf = (mass) => widthOf(mass) * 0.42;
export const segmentsOf = (mass) => Math.max(6, Math.round(lengthOf(mass) / spacingOf(mass)));
export const turnRateOf = (mass) => Math.max(1.9, 5.0 - Math.sqrt(mass) * 0.03);

/** World units across the screen diagonal — the camera pulls back as you grow. */
export const viewDiagonalOf = (mass) => Math.min(3600, 1500 + Math.sqrt(mass) * 14);

// ---- Food --------------------------------------------------------------
export const FOOD_TARGET = 2600;        // natural pellets kept on the board
export const FOOD_MAX = 5200;           // hard ceiling, including death drops
export const FOOD_SPAWN_PER_TICK = 5;
export const FOOD_DECAY_SECONDS = 75;   // dropped food only; natural food stays
export const EAT_REACH = 14;            // the "magnet" beyond the head's edge
export const foodRadius = (value) => 3.2 + Math.sqrt(value) * 2.4;

// ---- Population --------------------------------------------------------
// Bots keep the arena alive when few people are playing and quietly make room
// as people arrive.
export const SNAKE_TARGET = 30;
export const MIN_BOTS = 14;
export const MAX_PLAYERS = 60;
export const NAME_MAX = 16;

// ---- Look --------------------------------------------------------------
// Pellet colours. Dropped food takes the dead snake's colour, so a kill leaves
// a trail you can recognise from across the map.
export const PALETTE = [
  '#d9ff55', '#ff557d', '#6ad7ff', '#bd93f9', '#ffb86c', '#50fa9b',
  '#ffe066', '#ff79c6', '#8be9fd', '#ff6e6e', '#a3ffdc', '#ffd1f0',
];

export const SKINS = [
  { name: 'Lime', body: '#c8f542', stripe: '#7fb81a', glow: '#d9ff55', food: 0 },
  { name: 'Hot pink', body: '#ff4f7b', stripe: '#b8204d', glow: '#ff557d', food: 1 },
  { name: 'Cyan', body: '#4cc9ff', stripe: '#1f7fcf', glow: '#6ad7ff', food: 2 },
  { name: 'Violet', body: '#b48cff', stripe: '#6f45d6', glow: '#bd93f9', food: 3 },
  { name: 'Tangerine', body: '#ffa94d', stripe: '#d9661f', glow: '#ffb86c', food: 4 },
  { name: 'Mint', body: '#48f0a0', stripe: '#16a868', glow: '#50fa9b', food: 5 },
  { name: 'Gold', body: '#ffd84a', stripe: '#c79a12', glow: '#ffe066', food: 6 },
  { name: 'Candy', body: '#ff7fcf', stripe: '#fff0fa', glow: '#ff79c6', food: 7 },
  { name: 'Tiger', body: '#ff9a2e', stripe: '#1b1410', glow: '#ffb86c', food: 4 },
  { name: 'Zebra', body: '#f4f4f6', stripe: '#16161c', glow: '#e6ecff', food: 11 },
  { name: 'Ocean', body: '#35d0c9', stripe: '#1d5fd1', glow: '#8be9fd', food: 8 },
  { name: 'Ember', body: '#ff5b3a', stripe: '#ffd23d', glow: '#ff6e6e', food: 9 },
];

// Deliberately stupid. Bots should be fun to eat, and a leaderboard topped by
// "extension cord" and "i paused my game" is half the charm.
export const BOT_NAMES = [
  'noodle', 'Sir Wiggles', 'danger noodle', 'spaghetti', 'the long one',
  'ssssteve', 'hiss', 'glowstick', 'lil worm', 'big worm', 'slurp',
  'zigzag', 'sneko', 'mr slithers', 'coil', 'lasso', 'cable guy',
  'boa', 'wiggle', 'nope rope', 'linguine', 'pasta', 'extension cord',
  'licorice', 'glowworm', 'mamba', 'kaa', 'sidewinder', 'hose',
  'ribbon', 'udon', 'shoelace',
  'wet noodle', 'long boi', 'longer boi', 'smol boi', 'snek', 'snek snek',
  'danger spaghet', 'spaghetto', 'pool noodle', 'jump rope', 'garden hose',
  'phone charger', 'tangled earbuds', 'hdmi cable', 'usb-c', 'string cheese',
  'gummy worm', 'hot dog', 'sausage', 'baguette', 'breadstick', 'churro',
  'fettuccine', 'ramen', 'i am not a bot', 'totally human', 'real person',
  'beep boop', 'no thoughts', 'brain empty', 'just vibing', 'pls no eat',
  'free food', 'not food', 'definitely food', 'snacc', 'chonk', 'thicc worm',
  'lag', 'wifi pls', 'afk', 'brb', 'gg ez', 'noob', 'pro gamer', 'tryhard',
  'i paused my game', 'press f', 'yeet', 'bonk', 'no u', 'stonks', 'oops',
  'my bad', 'whoops', 'ctrl alt defeat', 'name not found', 'loading...',
  'unnamed worm 2', 'worm on a string', 'legally a snake', 'the intern',
  'grandma', 'the floor', 'one pixel', 'tiny terror', 'slow and sad',
  'xX_worm_Xx', 'dave', 'kevin', 'gary', 'potato', 'toaster', 'spoon',
  'sock', 'wormy mcworm', 'slither mcgee', 'noodle arms', 'boneless',
  'legs pending', 'confused tube', 'hungry tube', 'my own tail', 'dizzy',
  'going left', 'u-turn', 'free hugs', 'bitey', 'nom nom', 'chompy',
  'snaccident', 'wiggle wiggle', 'self-aware rope', 'long cat',
];

// Control characters, zero-width marks and bidi overrides. The last two let a
// name hide text or flip the leaderboard around, so they go too.
const INVISIBLE = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff],
];
const isInvisible = (cp) => INVISIBLE.some(([low, high]) => cp >= low && cp <= high);

/** Keep what players type printable, short and non-empty. */
export function cleanName(raw) {
  // Whitespace becomes a space first, so a tab or newline separates words
  // instead of gluing them together when control characters are stripped.
  const kept = [...String(raw ?? '').normalize('NFKC').replace(/\s/g, ' ')]
    .filter((ch) => !isInvisible(ch.codePointAt(0)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return [...kept].slice(0, NAME_MAX).join('').trim() || 'unnamed worm';
}

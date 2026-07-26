// Tuning shared by client (prediction/visuals) and server (authority).
// Both import this exact file, so numbers can never drift apart.

export const TICK_HZ = 20;               // server broadcast rate
export const TICK_MS = 1000 / TICK_HZ;
export const CLIENT_SEND_HZ = 20;        // player state upload rate

// ---- Player body -------------------------------------------------------
// A player position is the FEET position. The collider is an axis-aligned box
// from feet to feet+height, inset by RADIUS on X/Z.
export const PLAYER_RADIUS = 0.42;
export const HEIGHT_STAND = 1.85;
export const HEIGHT_CROUCH = 1.05;
export const HEIGHT_SLIDE = 0.85;
export const EYE_STAND = 1.65;
export const EYE_CROUCH = 0.9;
export const EYE_SLIDE = 0.7;
export const STEP_HEIGHT = 0.55;         // auto-climb ledges up to this

export const MAX_HP = 100;
export const RESPAWN_SECONDS = 5;        // downed players revive on their own

// ---- Movement ("sweaty" feel) -----------------------------------------
export const MOVE = {
  gravity: 26,
  walkSpeed: 6.6,
  sprintSpeed: 10.4,
  crouchSpeed: 3.4,
  airSpeed: 10.6,               // soft cap for air strafing
  groundAccel: 70,
  airAccel: 26,
  groundFriction: 11,
  airFriction: 0.2,
  jumpVel: 9.1,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  slideImpulse: 15.0,           // launch speed entering a slide
  // Friction is what decides how long a slide lasts. At 3.6 a slide died after
  // ~0.35s, too short to actually get under the gauntlet bars; 1.7 gives ~0.8s.
  slideFriction: 1.7,
  slideMinSpeed: 4.0,           // slide ends below this
  slideMaxTime: 1.15,
  slideCooldown: 0.5,
  // 4 x 1.49m of climb clears the gauntlet shaft's 5m with margin. At 8.4/3 the
  // best possible chain peaked 1cm below the ledge.
  wallJumpUp: 8.8,
  wallJumpOut: 8.0,
  wallJumpCooldown: 0.22,
  maxWallJumps: 4,              // resets on ground contact
  wallSlideGravity: 11,         // reduced gravity while hugging a wall
};

export const FOV = {
  base: 95,
  min: 70,
  max: 120,
  sprintAdd: 8,
  slideAdd: 13,
  adsMul: 0.72,
  lerp: 9,
};

// ---- Weapons -----------------------------------------------------------
// hitscan only; `rpm` -> seconds between shots; spread in radians.
export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'Rifle', kind: 'gun', auto: true,
    damage: 21, headMul: 2.0, rpm: 620, mag: 30, reserve: 180,
    reload: 1.9, spread: 0.021, adsSpread: 0.005, range: 140,
    pellets: 1, recoil: 0.9, shake: 0.09,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', kind: 'gun', auto: false,
    damage: 12, headMul: 1.5, rpm: 78, mag: 6, reserve: 48,
    reload: 2.7, spread: 0.085, adsSpread: 0.052, range: 34,
    pellets: 8, recoil: 3.4, shake: 0.26,
  },
  sword: {
    id: 'sword', name: 'Sword', kind: 'melee', auto: false,
    damage: 58, headMul: 1.0, rpm: 132, range: 3.2, arcDeg: 62,
    blockMul: 0.25, shake: 0.12,
  },
};
export const WEAPON_ORDER = ['rifle', 'shotgun', 'sword'];

// ---- Enemies -----------------------------------------------------------
// ONE ai script drives all of these. Only the stats below differ.
export const ENEMY_TYPES = {
  dummy:    { hp: 40,  speed: 0,   damage: 0,  range: 0,  cd: 99, color: 0xd8c46a, reward: 0,  ranged: false, scale: 1.0 },
  grunt:    { hp: 65,  speed: 3.3, damage: 7,  range: 24, cd: 1.4, color: 0xd0503c, reward: 12, ranged: true,  scale: 1.0 },
  brute:    { hp: 170, speed: 2.5, damage: 17, range: 2.8, cd: 1.2, color: 0x9243b5, reward: 28, ranged: false, scale: 1.35 },
  swordman: { hp: 85,  speed: 4.3, damage: 14, range: 3.0, cd: 1.0, color: 0x3f7fd0, reward: 16, ranged: false, scale: 1.0 },
  zombie:   { hp: 58,  speed: 3.5, damage: 11, range: 2.5, cd: 0.9, color: 0x5f9e4e, reward: 9,  ranged: false, scale: 1.0 },
  runner:   { hp: 34,  speed: 6.2, damage: 9,  range: 2.3, cd: 0.75, color: 0xc2d054, reward: 12, ranged: false, scale: 0.85 },
};

// ---- Economy (flat and boring on purpose) ------------------------------
export const REWARD_TASK = 40;
export const REWARD_LEVEL = 60;

export const COSMETICS = [
  { id: 'c_default', name: 'Standard Blue',  color: 0x4a90d9, cost: 0 },
  { id: 'c_ember',   name: 'Ember',          color: 0xe2603a, cost: 60 },
  { id: 'c_mint',    name: 'Mint',           color: 0x51c9a0, cost: 60 },
  { id: 'c_violet',  name: 'Violet',         color: 0x9b5de5, cost: 90 },
  { id: 'c_gold',    name: 'Gold Leaf',      color: 0xe8c04a, cost: 140 },
  { id: 'c_void',    name: 'Void Black',     color: 0x2b2b33, cost: 180 },
  { id: 'c_bubble',  name: 'Bubblegum',      color: 0xef79b8, cost: 180 },
  { id: 'c_signal',  name: 'Signal Orange',  color: 0xff8c1a, cost: 240 },
];

export const ANIM = { IDLE: 0, RUN: 1, JUMP: 2, SLIDE: 3, CROUCH: 4, DOWN: 5 };

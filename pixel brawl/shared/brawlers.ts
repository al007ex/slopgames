import { Rarity } from './constants.js';

export type AttackKind =
  | 'spread' // several projectiles in a cone
  | 'single' // one projectile
  | 'burst' // rapid sequence of projectiles from one trigger
  | 'lob' // arcs to a point, then explodes in an area
  | 'melee' // very short range hit, no projectile travel time
  | 'bounce' // projectile that reflects off walls
  | 'heal' // projectile damaging enemies + healing allies it passes
  | 'pierce'; // projectile passing through enemies

export type SuperKind =
  | 'spread'
  | 'single'
  | 'lob'
  | 'dash' // charge forward, damage on contact
  | 'leap' // jump to target point, damage on landing
  | 'summonBear'
  | 'summonTurret'
  | 'summonHealTurret'
  | 'heal'
  | 'mines'
  | 'barrage' // several lobs raining on a point
  | 'gravity' // pull enemies toward a point
  | 'bats' // spawn homing swarm
  | 'poisonLeap'
  | 'spikeField';

export interface AttackDef {
  name: string;
  kind: AttackKind;
  /** damage per projectile at power level 1 */
  damage: number;
  /** seconds to reload one ammo bar */
  reload: number;
  /** max travel distance in world units */
  range: number;
  /** world units per second */
  speed: number;
  /** projectiles per shot */
  count: number;
  /** total cone width in radians */
  spread: number;
  /** explosion / hit radius */
  radius: number;
  /** super charge gained per projectile that connects */
  charge: number;
  /** cooldown between shots */
  cd: number;
  /** visual key for the renderer */
  visual: string;
  /** extra behaviour */
  pierce?: boolean;
  bounces?: number;
  heal?: number;
  dotDamage?: number;
  dotTime?: number;
  burstDelay?: number;
  knockback?: number;
  breaksWalls?: boolean;
  slow?: number;
}

export interface SuperDef {
  name: string;
  kind: SuperKind;
  damage: number;
  range: number;
  speed: number;
  count: number;
  spread: number;
  radius: number;
  visual: string;
  desc: string;
  knockback?: number;
  breaksWalls?: boolean;
  heal?: number;
  duration?: number;
  petHp?: number;
  dotDamage?: number;
  dotTime?: number;
  bounces?: number;
  pierce?: boolean;
  slow?: number;
  invuln?: number;
}

export interface BrawlerSkin {
  /** sprite palette keyed by the letters used in the body template */
  skin: string;
  skinDark: string;
  hair: string;
  hairDark: string;
  cloth: string;
  clothDark: string;
  accent: string;
  gun: string;
  gunDark: string;
}

export interface BrawlerDef {
  id: string;
  name: string;
  rarity: Rarity;
  title: string;
  desc: string;
  hp: number;
  speed: number;
  build: 'small' | 'medium' | 'large';
  hat: 'none' | 'cap' | 'hair' | 'helmet' | 'hood' | 'mask' | 'bandana' | 'cowboy' | 'top' | 'horns' | 'beak';
  weapon: 'gun' | 'shotgun' | 'rifle' | 'fists' | 'bottle' | 'sticks' | 'axe' | 'blade' | 'none' | 'staff';
  colors: BrawlerSkin;
  attack: AttackDef;
  super: SuperDef;
  /** preferred engagement distance for the AI */
  aiRange: number;
}

const C = (
  skin: string,
  skinDark: string,
  hair: string,
  hairDark: string,
  cloth: string,
  clothDark: string,
  accent: string,
  gun = '#6b7280',
  gunDark = '#374151',
): BrawlerSkin => ({ skin, skinDark, hair, hairDark, cloth, clothDark, accent, gun, gunDark });

export const BRAWLERS: BrawlerDef[] = [
  {
    id: 'shelly',
    name: 'SHELLY',
    rarity: Rarity.Starting,
    title: 'The Shotgunner',
    desc: 'Shelly blasts a wide spread of buckshot. Her Super shreds cover and knocks enemies back.',
    hp: 3600,
    speed: 72,
    build: 'medium',
    hat: 'hair',
    weapon: 'shotgun',
    colors: C('#f0b98a', '#c08a5d', '#3a2a5a', '#241a3a', '#e0446a', '#a02348', '#ffd23f'),
    attack: {
      name: 'Buckshot', kind: 'spread', damage: 300, reload: 1.55, range: 118, speed: 320,
      count: 5, spread: 0.42, radius: 4, charge: 8.5, cd: 0.42, visual: 'pellet',
    },
    super: {
      name: 'Super Shell', kind: 'spread', damage: 320, range: 148, speed: 340, count: 9,
      spread: 0.62, radius: 5, visual: 'pellet_super', knockback: 82, breaksWalls: true,
      desc: 'A massive blast that destroys cover and pushes enemies away.',
    },
    aiRange: 78,
  },
  {
    id: 'nita',
    name: 'NITA',
    rarity: Rarity.Rare,
    title: 'Bear Wrangler',
    desc: 'Nita sends out a shockwave that hits everything in its path, then calls in a very good bear.',
    hp: 4000,
    speed: 72,
    build: 'small',
    hat: 'hood',
    weapon: 'none',
    colors: C('#e8a878', '#b57a4d', '#8b5a2b', '#5c3a1a', '#5eb9e8', '#2a7ba8', '#f4f4f4'),
    attack: {
      name: 'Rupture', kind: 'pierce', damage: 800, reload: 1.5, range: 100, speed: 260,
      count: 1, spread: 0, radius: 9, charge: 26, cd: 0.4, visual: 'shock', pierce: true,
    },
    super: {
      name: 'Overbearing', kind: 'summonBear', damage: 600, range: 46, speed: 0, count: 1,
      spread: 0, radius: 10, visual: 'bear', petHp: 3600, duration: 999,
      desc: 'Summons a big baby bear to maul nearby enemies.',
    },
    aiRange: 76,
  },
  {
    id: 'colt',
    name: 'COLT',
    rarity: Rarity.Rare,
    title: 'Sharpshooter',
    desc: 'Colt fires a long, accurate burst of bullets. His Super tears straight through walls.',
    hp: 2800,
    speed: 78,
    build: 'medium',
    hat: 'cap',
    weapon: 'gun',
    colors: C('#f2c193', '#c2905f', '#3b2f2f', '#241c1c', '#3b6fd4', '#23459a', '#ffd23f', '#b0b6c0', '#6b7280'),
    attack: {
      name: 'Six-Shooters', kind: 'burst', damage: 320, reload: 1.5, range: 152, speed: 420,
      count: 6, spread: 0.02, radius: 3, charge: 7, cd: 0.5, visual: 'bullet', burstDelay: 0.06,
    },
    super: {
      name: 'Bullet Storm', kind: 'single', damage: 340, range: 168, speed: 470, count: 12,
      spread: 0.02, radius: 4, visual: 'bullet_super', breaksWalls: true, pierce: true,
      desc: 'A stream of bullets that smashes through walls and everything behind them.',
    },
    aiRange: 112,
  },
  {
    id: 'bull',
    name: 'BULL',
    rarity: Rarity.Rare,
    title: 'The Bruiser',
    desc: 'Bull unloads a heavy double-barrel at close range and charges through anything in his way.',
    hp: 5200,
    speed: 78,
    build: 'large',
    hat: 'none',
    weapon: 'shotgun',
    colors: C('#e8a878', '#b57a4d', '#2b2b2b', '#161616', '#f0f0f0', '#b8bcc4', '#e0446a'),
    attack: {
      name: 'Double-Barrel', kind: 'spread', damage: 320, reload: 1.6, range: 84, speed: 300,
      count: 5, spread: 0.36, radius: 4, charge: 8.5, cd: 0.4, visual: 'pellet',
    },
    super: {
      name: 'Bulldozer', kind: 'dash', damage: 800, range: 128, speed: 300, count: 1,
      spread: 0, radius: 9, visual: 'dash', knockback: 40, breaksWalls: true,
      desc: 'Bull charges forward, flattening walls and everyone unlucky enough to be there.',
    },
    aiRange: 58,
  },
  {
    id: 'jessie',
    name: 'JESSIE',
    rarity: Rarity.SuperRare,
    title: 'Gadgeteer',
    desc: 'Jessie shoots energy orbs that ricochet to nearby foes and builds a scrappy gun turret.',
    hp: 3200,
    speed: 72,
    build: 'small',
    hat: 'hair',
    weapon: 'gun',
    colors: C('#f2c193', '#c2905f', '#f06a2a', '#b8410f', '#4ec97a', '#1f8a4c', '#ffd23f', '#9aa3ad', '#5b6470'),
    attack: {
      name: 'Shock Rifle', kind: 'bounce', damage: 620, reload: 1.5, range: 128, speed: 350,
      count: 1, spread: 0, radius: 5, charge: 22, cd: 0.45, visual: 'orb', bounces: 2,
    },
    super: {
      name: 'Scrappy!', kind: 'summonTurret', damage: 320, range: 110, speed: 340, count: 1,
      spread: 0, radius: 4, visual: 'turret', petHp: 2400, duration: 999,
      desc: 'Deploys an auto-targeting turret that peppers nearby enemies.',
    },
    aiRange: 96,
  },
  {
    id: 'brock',
    name: 'BROCK',
    rarity: Rarity.SuperRare,
    title: 'Rocket Man',
    desc: 'Brock launches long range rockets that explode on impact and rains a barrage from above.',
    hp: 2800,
    speed: 72,
    build: 'medium',
    hat: 'hair',
    weapon: 'rifle',
    colors: C('#7a4a2a', '#4f2d16', '#1c1c1c', '#0d0d0d', '#f0642a', '#b03a10', '#4ec97a', '#5b6470', '#333a44'),
    attack: {
      name: 'Rockin Rocket', kind: 'single', damage: 1120, reload: 1.9, range: 168, speed: 400,
      count: 1, spread: 0, radius: 12, charge: 34, cd: 0.55, visual: 'rocket',
    },
    super: {
      name: 'Rocket Rain', kind: 'barrage', damage: 800, range: 152, speed: 320, count: 9,
      spread: 0, radius: 16, visual: 'rocket_super', breaksWalls: true,
      desc: 'Calls down a storm of rockets that shatters walls in a wide area.',
    },
    aiRange: 128,
  },
  {
    id: 'dynamike',
    name: 'DYNAMIKE',
    rarity: Rarity.SuperRare,
    title: 'Demolition Expert',
    desc: 'Mike lobs two sticks of dynamite over cover, then drops a barrel that blows up everything.',
    hp: 2800,
    speed: 72,
    build: 'small',
    hat: 'none',
    weapon: 'sticks',
    colors: C('#e0b088', '#ad8058', '#e8e8e8', '#b4b4b4', '#4a7ac0', '#2a4f8a', '#e0446a'),
    attack: {
      name: 'Short Fuse', kind: 'lob', damage: 620, reload: 1.5, range: 132, speed: 175,
      count: 2, spread: 0.28, radius: 18, charge: 18, cd: 0.5, visual: 'dynamite', breaksWalls: true,
    },
    super: {
      name: 'Big Barrel O Boom', kind: 'lob', damage: 1200, range: 148, speed: 155, count: 1,
      spread: 0, radius: 30, visual: 'barrel', knockback: 55, breaksWalls: true,
      desc: 'A giant barrel bomb that launches enemies and levels the terrain.',
    },
    aiRange: 100,
  },
  {
    id: 'bo',
    name: 'BO',
    rarity: Rarity.Epic,
    title: 'The Ranger',
    desc: 'Bo fires three exploding arrows in a spread and buries hidden mines that launch intruders.',
    hp: 3600,
    speed: 78,
    build: 'medium',
    hat: 'beak',
    weapon: 'none',
    colors: C('#8a5a3a', '#5c3820', '#2b2b2b', '#161616', '#4ec97a', '#1f8a4c', '#f0a83a'),
    attack: {
      name: 'Eagle-Eyed', kind: 'spread', damage: 460, reload: 1.7, range: 142, speed: 340,
      count: 3, spread: 0.24, radius: 6, charge: 13, cd: 0.5, visual: 'arrow',
    },
    super: {
      name: 'Catch a Fox', kind: 'mines', damage: 1000, range: 96, speed: 0, count: 3,
      spread: 0.9, radius: 20, visual: 'mine', knockback: 60, duration: 60,
      desc: 'Plants three hidden mines that send enemies flying.',
    },
    aiRange: 116,
  },
  {
    id: 'elprimo',
    name: 'EL PRIMO',
    rarity: Rarity.Epic,
    title: 'The Champ',
    desc: 'El Primo throws a flurry of fists and leaps across the arena onto his opponents.',
    hp: 5600,
    speed: 84,
    build: 'large',
    hat: 'mask',
    weapon: 'fists',
    colors: C('#d99a68', '#a86c3e', '#f0d23a', '#b89a10', '#e02a2a', '#9a1414', '#ffd23f'),
    attack: {
      name: 'Fists of Fury', kind: 'melee', damage: 440, reload: 1.1, range: 44, speed: 900,
      count: 4, spread: 0.3, radius: 8, charge: 9, cd: 0.32, visual: 'fist',
    },
    super: {
      name: 'Flying Elbow Drop', kind: 'leap', damage: 1200, range: 128, speed: 190, count: 1,
      spread: 0, radius: 26, visual: 'leap', knockback: 30,
      desc: 'Launches into the air and crashes down, damaging everyone near the landing.',
    },
    aiRange: 34,
  },
  {
    id: 'barley',
    name: 'BARLEY',
    rarity: Rarity.Epic,
    title: 'The Bartender',
    desc: 'Barley tosses bottles that shatter into burning puddles, denying whole lanes at a time.',
    hp: 2600,
    speed: 72,
    build: 'medium',
    hat: 'top',
    weapon: 'bottle',
    colors: C('#c8d0d8', '#8b949e', '#2b2b2b', '#161616', '#3b3b4a', '#22222c', '#e8c04a'),
    attack: {
      name: 'Undiluted', kind: 'lob', damage: 340, reload: 1.4, range: 128, speed: 190,
      count: 1, spread: 0, radius: 20, charge: 20, cd: 0.45, visual: 'bottle',
      dotDamage: 340, dotTime: 2.2,
    },
    super: {
      name: 'Last Call', kind: 'barrage', damage: 340, range: 132, speed: 190, count: 5,
      spread: 0, radius: 22, visual: 'bottle_super', dotDamage: 340, dotTime: 3.0,
      desc: 'A round of drinks that soaks a huge area in burning liquid.',
    },
    aiRange: 104,
  },
  {
    id: 'poco',
    name: 'POCO',
    rarity: Rarity.Epic,
    title: 'The Entertainer',
    desc: 'Poco strums damaging sound waves that pass through enemies, and heals his whole team.',
    hp: 4200,
    speed: 72,
    build: 'medium',
    hat: 'top',
    weapon: 'staff',
    colors: C('#e8c9a0', '#b5936a', '#2b2b2b', '#161616', '#e04a8a', '#a0225a', '#ffd23f'),
    attack: {
      name: 'Power Chord', kind: 'pierce', damage: 700, reload: 1.6, range: 128, speed: 300,
      count: 1, spread: 0, radius: 16, charge: 24, cd: 0.5, visual: 'wave', pierce: true,
    },
    super: {
      name: 'Encore', kind: 'heal', damage: 0, range: 128, speed: 0, count: 1, spread: 0,
      radius: 96, visual: 'heal', heal: 2000,
      desc: 'A healing melody that restores health to Poco and all nearby teammates.',
    },
    aiRange: 92,
  },
  {
    id: 'ricochet',
    name: 'RICOCHET',
    rarity: Rarity.Mythic,
    title: 'Trick Shooter',
    desc: 'Ricochet bounces bullets off walls to hit targets that think they are safe.',
    hp: 2600,
    speed: 78,
    build: 'medium',
    hat: 'none',
    weapon: 'gun',
    colors: C('#b8c4d0', '#7a8694', '#d0d8e0', '#98a4b0', '#e8e8f0', '#a8b0bc', '#3ddcff', '#7a8694', '#4a5460'),
    attack: {
      name: 'Bouncy Bullets', kind: 'bounce', damage: 300, reload: 1.5, range: 190, speed: 400,
      count: 4, spread: 0.05, radius: 3, charge: 8, cd: 0.45, visual: 'ric', bounces: 4, burstDelay: 0.05,
    },
    super: {
      name: 'Trick Shot', kind: 'single', damage: 340, range: 240, speed: 440, count: 6,
      spread: 0.05, radius: 4, visual: 'ric_super', bounces: 6,
      desc: 'A long burst of bullets that keeps ricocheting around the map.',
    },
    aiRange: 118,
  },
  {
    id: 'piper',
    name: 'PIPER',
    rarity: Rarity.Mythic,
    title: 'The Sniper',
    desc: 'Piper deals more damage the further her shot travels, then escapes in a puff of grenades.',
    hp: 2400,
    speed: 72,
    build: 'medium',
    hat: 'hair',
    weapon: 'rifle',
    colors: C('#f5d0b0', '#c2a082', '#f0a8c0', '#c07090', '#f7e8ee', '#c8b0ba', '#e04a8a', '#c8a04a', '#8a6a20'),
    attack: {
      name: 'Gunbrella', kind: 'single', damage: 420, reload: 1.9, range: 220, speed: 480,
      count: 1, spread: 0, radius: 5, charge: 34, cd: 0.6, visual: 'snipe',
    },
    super: {
      name: 'Poppin', kind: 'leap', damage: 700, range: 132, speed: 200, count: 4, spread: 0,
      radius: 24, visual: 'grenade', knockback: 20,
      desc: 'Piper jumps away, dropping grenades where she took off.',
    },
    aiRange: 160,
  },
  {
    id: 'pam',
    name: 'PAM',
    rarity: Rarity.Mythic,
    title: 'The Scrapper',
    desc: 'Pam sprays a wide storm of scrap metal and sets down a station that heals her team.',
    hp: 4800,
    speed: 72,
    build: 'large',
    hat: 'hair',
    weapon: 'gun',
    colors: C('#e8b088', '#b58058', '#e05a2a', '#a03410', '#5eb9e8', '#2a7ba8', '#ffd23f', '#8a929c', '#4a525c'),
    attack: {
      name: 'Scrapstorm', kind: 'spread', damage: 260, reload: 1.4, range: 128, speed: 340,
      count: 9, spread: 0.5, radius: 3, charge: 5, cd: 0.5, visual: 'scrap',
    },
    super: {
      name: 'Mama’s Kiss', kind: 'summonHealTurret', damage: 0, range: 96, speed: 0, count: 1,
      spread: 0, radius: 56, visual: 'healturret', petHp: 2000, heal: 320, duration: 999,
      desc: 'Drops a healing turret that mends every nearby teammate.',
    },
    aiRange: 86,
  },
  {
    id: 'mortis',
    name: 'MORTIS',
    rarity: Rarity.Mythic,
    title: 'The Undertaker',
    desc: 'Mortis dashes forward with every swing of his shovel and unleashes a swarm of bats.',
    hp: 3600,
    speed: 84,
    build: 'medium',
    hat: 'top',
    weapon: 'axe',
    colors: C('#d8d8e8', '#a0a0b4', '#2b2b3a', '#16161f', '#3a2a4a', '#221830', '#e0446a', '#8a6a2a', '#5a4418'),
    attack: {
      name: 'Shovel Swing', kind: 'melee', damage: 900, reload: 1.9, range: 60, speed: 230,
      count: 1, spread: 0.5, radius: 11, charge: 32, cd: 0.85, visual: 'shovel',
    },
    super: {
      name: 'Life Blood', kind: 'bats', damage: 700, range: 160, speed: 220, count: 5,
      spread: 0.5, radius: 8, visual: 'bat', heal: 700,
      desc: 'Releases a swarm of bats that chase enemies and return health to Mortis.',
    },
    aiRange: 40,
  },
  {
    id: 'tara',
    name: 'TARA',
    rarity: Rarity.Legendary,
    title: 'The Mystic',
    desc: 'Tara throws a fan of tarot cards and warps space to drag enemies together.',
    hp: 3600,
    speed: 72,
    build: 'medium',
    hat: 'hood',
    weapon: 'none',
    colors: C('#c89060', '#98663a', '#2b1b3a', '#170f22', '#6a3ab0', '#41216f', '#ffd23f'),
    attack: {
      name: 'Triple Threat', kind: 'spread', damage: 460, reload: 1.6, range: 132, speed: 360,
      count: 3, spread: 0.16, radius: 5, charge: 13, cd: 0.5, visual: 'card', pierce: true,
    },
    super: {
      name: 'Gravity', kind: 'gravity', damage: 240, range: 132, speed: 240, count: 1,
      spread: 0, radius: 52, visual: 'gravity', duration: 2.4,
      desc: 'Opens a rift that pulls every nearby enemy into the middle.',
    },
    aiRange: 100,
  },
  {
    id: 'spike',
    name: 'SPIKE',
    rarity: Rarity.Legendary,
    title: 'The Cactus',
    desc: 'Spike throws a cactus grenade that bursts into needles, and grows a field that slows enemies.',
    hp: 2600,
    speed: 72,
    build: 'small',
    hat: 'none',
    weapon: 'none',
    colors: C('#4ec97a', '#1f8a4c', '#3aa860', '#1a6b3a', '#e8f0a0', '#b0bc60', '#f0642a'),
    attack: {
      name: 'Needle Grenade', kind: 'lob', damage: 320, reload: 1.7, range: 138, speed: 210,
      count: 1, spread: 0, radius: 10, charge: 12, cd: 0.5, visual: 'cactus',
    },
    super: {
      name: 'Stick Around!', kind: 'spikeField', damage: 240, range: 140, speed: 200, count: 1,
      spread: 0, radius: 46, visual: 'field', duration: 3.4, slow: 0.5,
      desc: 'Plants a field of thorns that slows and shreds anyone caught inside.',
    },
    aiRange: 108,
  },
  {
    id: 'crow',
    name: 'CROW',
    rarity: Rarity.Legendary,
    title: 'The Toxic',
    desc: 'Crow flings poisoned daggers and leaps through the air leaving a toxic cloud behind.',
    hp: 2800,
    speed: 84,
    build: 'medium',
    hat: 'beak',
    weapon: 'blade',
    colors: C('#2b2b3a', '#16161f', '#1a1a26', '#0d0d14', '#3a3a52', '#22222f', '#4ec97a'),
    attack: {
      name: 'Poisoned Daggers', kind: 'spread', damage: 320, reload: 1.4, range: 138, speed: 380,
      count: 3, spread: 0.2, radius: 4, charge: 13, cd: 0.4, visual: 'dagger',
      dotDamage: 160, dotTime: 2.4,
    },
    super: {
      name: 'Swoop In', kind: 'poisonLeap', damage: 640, range: 148, speed: 240, count: 1,
      spread: 0, radius: 28, visual: 'swoop', dotDamage: 320, dotTime: 3.0,
      desc: 'Crow jumps away, poisoning the ground at takeoff and landing.',
    },
    aiRange: 104,
  },
];

export const BRAWLER_MAP: Record<string, BrawlerDef> = Object.fromEntries(BRAWLERS.map((b) => [b.id, b]));

export function getBrawler(id: string): BrawlerDef {
  return BRAWLER_MAP[id] ?? BRAWLERS[0];
}

export const STARTER_BRAWLER = 'shelly';

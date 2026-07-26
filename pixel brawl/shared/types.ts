import type { GameMode } from './constants.js';

export interface InputCmd {
  seq: number;
  /** movement axis, -1..1 */
  mx: number;
  my: number;
  /** aim direction (unit vector). */
  ax: number;
  ay: number;
  /** aim distance as a fraction of the attack's range — used by lobbed shots and placed supers. */
  ad: number;
  shoot: boolean;
  useSuper: boolean;
}

export const EMPTY_INPUT: InputCmd = { seq: 0, mx: 0, my: 0, ax: 1, ay: 0, ad: 1, shoot: false, useSuper: false };

export interface MapData {
  w: number;
  h: number;
  /** length w*h, values from TileKind */
  tiles: Uint8Array;
  spawns: { x: number; y: number; team: number }[];
  gemSpawn?: { x: number; y: number };
  seed: number;
  theme: MapTheme;
}

export type MapTheme = 'grass' | 'desert' | 'snow' | 'mine';

export enum Tile {
  Grass = 0,
  Wall = 1,
  Bush = 2,
  Water = 3,
  Crate = 4,
  Fence = 5,
  Tree = 6,
  Rope = 7,
  Skull = 8,
}

/** Tiles that stop movement */
export const BLOCKS_MOVE = new Set([Tile.Wall, Tile.Water, Tile.Crate, Tile.Fence, Tile.Tree, Tile.Skull]);
/** Tiles that stop projectiles */
export const BLOCKS_SHOT = new Set([Tile.Wall, Tile.Crate, Tile.Tree, Tile.Skull]);

/* ---------------------------------- net ---------------------------------- */

export interface PlayerSnap {
  i: number; // slot index
  b: string; // brawler id
  n: string; // name
  t: number; // team
  x: number;
  y: number;
  a: number; // aim angle
  hp: number;
  mx: number; // max hp
  am: number; // ammo (0..3 float)
  sc: number; // super charge 0..100
  st: number; // status bitfield
  g: number; // gems / stars / lives depending on mode
  k: number; // kills
  bot: number;
  cu: number; // power cubes
  tr: number; // trophies
  lv: number; // power level
}

export interface ProjSnap {
  id: number;
  x: number;
  y: number;
  a: number;
  k: string; // visual kind
  t: number; // team
  s: number; // scale/size
}

export interface AreaSnap {
  id: number;
  x: number;
  y: number;
  r: number;
  k: string;
  t: number;
  l: number; // remaining life fraction 0..1
}

export interface PetSnap {
  id: number;
  x: number;
  y: number;
  a: number;
  k: string;
  t: number;
  hp: number;
  mx: number;
}

export interface PickupSnap {
  id: number;
  x: number;
  y: number;
  k: string;
  b: number; // bounce/pop animation phase
}

export interface FxEvent {
  k: string;
  x: number;
  y: number;
  a?: number;
  v?: number;
  s?: string;
}

export interface Snapshot {
  tick: number;
  phase: 'countdown' | 'live' | 'over';
  time: number; // seconds remaining in current phase
  players: PlayerSnap[];
  projs: ProjSnap[];
  areas: AreaSnap[];
  pets: PetSnap[];
  pickups: PickupSnap[];
  /** destroyed crate tile indices since map start */
  broken: number[];
  scores: number[];
  /** gem-grab countdown owner team, -1 if none */
  cdTeam: number;
  cdTime: number;
  poison: number; // shrink inset in world units, -1 if inactive
  fx: FxEvent[];
  winner: number;
}

export interface MatchInitMsg {
  type: 'match_init';
  mode: GameMode;
  map: { w: number; h: number; tiles: number[]; theme: string; seed: number };
  you: number;
  players: { i: number; b: string; n: string; t: number; bot: boolean; tr: number; lv: number }[];
  duration: number;
}

export interface MatchResultRow {
  slot: number;
  name: string;
  brawler: string;
  team: number;
  rank: number;
  kills: number;
  score: number;
  trophyDelta: number;
  bot: boolean;
}

export interface MatchOverMsg {
  type: 'match_over';
  result: 'victory' | 'defeat' | 'draw';
  rows: MatchResultRow[];
  rewards: { trophies: number; tokens: number; coins: number; exp: number };
  you: number;
}

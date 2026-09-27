// Building templates. Every building on the island is made of the same wall,
// floor, ramp and cone pieces players build with, sitting on the same global
// grid — so every one of them can be shot through, pickaxed for materials, and
// brought down by knocking out what holds it up.

import { CELL, WALL_H, WOOD, STONE, METAL } from './constants.js';
import { WALL, FLOOR, RAMP, CONE, WALL_DOOR, WALL_WINDOW, pieceSlotKey } from './pieces.js';
import { PROP } from './props.js';

// A wall kept only at its two outer columns: posts, for stilts and canopies.
export const WALL_POSTS = (1 << 1) | (1 << 4) | (1 << 7);
// A wall with a wide gap at the bottom: a garage or barn opening.
export const WALL_GARAGE = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
export const WALL_WIDE_WINDOW = (1 << 3) | (1 << 4) | (1 << 5);

const FURNITURE = {
  home: ['sofa', 'bed', 'table', 'chair', 'shelf', 'fridge', 'stove', 'washer', 'toilet', 'fireplace', 'table', 'chair'],
  shop: ['shelf', 'shelf', 'shelf', 'table', 'fridge', 'crate'],
  barn: ['haybale', 'haybale', 'crate', 'pallet', 'haybale', 'tractor'],
  warehouse: ['shelf', 'crate', 'pallet', 'barrel', 'crate', 'pallet', 'shelf'],
  cabin: ['bed', 'table', 'chair', 'fireplace', 'shelf', 'stove'],
};

/** Collects pieces, props and spawn points, refusing to fill any slot twice. */
export class Builder {
  constructor(out) {
    this.out = out;
    this.slots = new Set();
    this.occupied = new Set();   // cells covered by buildings, kept clear of trees
    this.tier = 1;
    this.poi = -1;
  }

  piece(type, cx, lv, cz, { rot = 0, mat = WOOD, edit = 0 } = {}) {
    const p = { id: 0, type, rot, cx, lv, cz, mat, edit, start: -1, damage: 0, team: 0 };
    const key = pieceSlotKey(p);
    if (this.slots.has(key)) return null;
    this.slots.add(key);
    p.id = this.out.pieces.length + 1;
    this.out.pieces.push(p);
    return p;
  }

  prop(name, x, y, z, yaw = 0, s = 1) {
    const p = { id: this.out.props.length + 1, kind: PROP[name], x, y, z, yaw, s };
    this.out.props.push(p);
    return p;
  }

  loot(x, y, z) { this.out.lootSpots.push({ x, y, z, tier: this.tier, poi: this.poi }); }
  chest(x, y, z, yaw = 0) { this.out.chestSpots.push({ x, y, z, yaw, tier: this.tier, poi: this.poi }); }
  ammo(x, y, z) { this.out.ammoSpots.push({ x, y, z, tier: this.tier, poi: this.poi }); }

  claim(cx0, cz0, w, d, margin = 1) {
    for (let j = cz0 - margin; j < cz0 + d + margin; j++) for (let i = cx0 - margin; i < cx0 + w + margin; i++) this.occupied.add(j * 1024 + i);
  }
  isFree(cx0, cz0, w, d, margin = 1) {
    for (let j = cz0 - margin; j < cz0 + d + margin; j++) for (let i = cx0 - margin; i < cx0 + w + margin; i++) if (this.occupied.has(j * 1024 + i)) return false;
    return true;
  }
}

const cellCenter = (c) => (c + 0.5) * CELL;

/**
 * A building of w×d cells and `floors` storeys, its ground floor at level lv.
 * `front` is the side with the door: 'n' (−z), 's' (+z), 'w' (−x) or 'e' (+x).
 */
export function building(b, rng, o) {
  const { cx, cz, lv, w, d } = o;
  const floors = o.floors || 1;
  const front = o.front || 's';
  const groundMat = o.groundMat ?? o.wallMat ?? WOOD;
  const upperMat = o.upperMat ?? o.wallMat ?? WOOD;
  const floorMat = o.floorMat ?? WOOD;
  const roofMat = o.roofMat ?? WOOD;
  const windows = o.windows ?? 0.45;
  const kind = o.furniture || 'home';
  b.claim(cx, cz, w, d, o.margin ?? 1);
  const record = { cx, cz, w, d, lv, floors: 1, kind, poi: b.poi, tier: b.tier };
  b.out.buildings.push(record);

  // Stairs: a ramp in one cell climbing +x into the cell beside it, with a
  // hole in the floor above so you can walk up through it.
  // Consecutive flights go in different rows, so one never sits over the other.
  const stairs = [];
  for (let s = 0; s < floors - 1; s++) {
    if (w < 2) break;
    const prev = stairs[s - 1];
    const rows = [];
    for (let j = 0; j < d; j++) if (!prev || cz + j !== prev.z) rows.push(cz + j);
    if (!rows.length) break;
    stairs.push({ x: cx + rng.int(0, w - 2), z: rng.pick(rows) });
  }
  const storeys = Math.min(floors, stairs.length + 1);
  record.floors = storeys;
  // Every flight climbs +x: from just west of its cell to just inside the next.
  record.stairs = stairs.slice(0, storeys - 1).map((st, s) => ({
    lv: lv + s, x0: st.x * CELL - 0.8, z: (st.z + 0.5) * CELL, x1: (st.x + 1) * CELL + 1.2,
  }));

  for (let s = 0; s < storeys; s++) {
    const L = lv + s;
    const wallMat = s === 0 ? groundMat : upperMat;
    const below = s > 0 ? stairs[s - 1] : null;
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        if (below && below.x === cx + i && below.z === cz + j) continue;
        b.piece(FLOOR, cx + i, L, cz + j, { mat: floorMat });
      }
    }
    // Exterior walls, with a door on the front of the ground floor.
    const doorAt = { n: rng.int(0, w - 1), s: rng.int(0, w - 1), w: rng.int(0, d - 1), e: rng.int(0, d - 1) };
    if (s === 0) record.door = doorPoints(cx, cz, w, d, front, doorAt[front], lv);
    const editFor = (side, k) => {
      if (s === 0 && side === front && k === doorAt[side]) return o.garage ? WALL_GARAGE : WALL_DOOR;
      if (s === 0 && o.backDoor && side === opposite(front) && k === doorAt[side]) return WALL_DOOR;
      return rng.chance(windows) ? (o.wideWindows && rng.chance(0.4) ? WALL_WIDE_WINDOW : WALL_WINDOW) : 0;
    };
    for (let i = 0; i < w; i++) {
      b.piece(WALL, cx + i, L, cz, { rot: 1, mat: wallMat, edit: editFor('n', i) });
      b.piece(WALL, cx + i, L, cz + d, { rot: 1, mat: wallMat, edit: editFor('s', i) });
    }
    for (let j = 0; j < d; j++) {
      b.piece(WALL, cx, L, cz + j, { rot: 0, mat: wallMat, edit: editFor('w', j) });
      b.piece(WALL, cx + w, L, cz + j, { rot: 0, mat: wallMat, edit: editFor('e', j) });
    }
    // One interior partition with a doorway in bigger buildings.
    if (o.partition !== false && w >= 3 && d >= 2) {
      const px = cx + rng.int(1, w - 1);
      const door = rng.int(0, d - 1);
      for (let j = 0; j < d; j++) {
        if (stairs[s] && (stairs[s].x === px || stairs[s].x + 1 === px) && stairs[s].z === cz + j) continue;
        if (below && (below.x === px || below.x + 1 === px) && below.z === cz + j) continue;
        b.piece(WALL, px, L, cz + j, { rot: 0, mat: WOOD, edit: j === door ? WALL_DOOR : 0 });
      }
    }
    if (stairs[s]) b.piece(RAMP, stairs[s].x, L, stairs[s].z, { rot: 0, mat: floorMat });

    // Furniture, loot and a chest.
    const y = L * WALL_H + 0.1;
    const cells = [];
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const onStairs = (stairs[s] && stairs[s].x === cx + i && stairs[s].z === cz + j) || (below && below.x === cx + i && below.z === cz + j);
      if (!onStairs) cells.push([cx + i, cz + j]);
    }
    rng.shuffle(cells);
    const items = FURNITURE[kind];
    const nFurniture = Math.min(cells.length, Math.max(1, Math.round(cells.length * (o.furnish ?? 0.8))));
    for (let k = 0; k < nFurniture; k++) {
      const [i, j] = cells[k];
      const name = rng.pick(items);
      const yaw = rng.int(0, 3) * (Math.PI / 2);
      const x = i * CELL + rng.range(1.2, CELL - 1.2), z = j * CELL + rng.range(1.2, CELL - 1.2);
      if (name === 'tractor' && s > 0) continue;
      b.prop(name, x, y, z, yaw);
    }
    // Named places are stocked denser than lone houses.
    const lootCells = cells.slice(0, Math.max(1, Math.round(cells.length * (b.tier >= 2 ? 0.65 : 0.4))));
    for (const [i, j] of lootCells) b.loot(cellCenter(i) + rng.range(-1, 1), y, cellCenter(j) + rng.range(-1, 1));
    if (s === storeys - 1 && o.chest !== false && cells.length) {
      const [i, j] = cells[cells.length - 1];
      b.chest(cellCenter(i), y, cellCenter(j), rng.int(0, 3) * (Math.PI / 2));
    }
    if (s === 0 && rng.chance(0.35) && cells.length > 1) {
      const [i, j] = cells[1];
      b.ammo(cellCenter(i) + 1, y, cellCenter(j) - 1);
    }
  }

  // Roof: cones for houses, a flat deck for sheds and warehouses.
  const top = lv + storeys;
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < w; i++) {
      if (o.roof === 'flat') b.piece(FLOOR, cx + i, top, cz + j, { mat: roofMat });
      else b.piece(CONE, cx + i, top, cz + j, { mat: roofMat });
    }
  }
}

const opposite = (side) => ({ n: 's', s: 'n', w: 'e', e: 'w' }[side]);

/** Where to stand just outside and just inside a building's front door. */
function doorPoints(cx, cz, w, d, side, k, lv) {
  const y = lv * WALL_H + 0.1;
  switch (side) {
    case 'n': return { x: (cx + k + 0.5) * CELL, z: cz * CELL - 2, ix: (cx + k + 0.5) * CELL, iz: cz * CELL + 2, y };
    case 's': return { x: (cx + k + 0.5) * CELL, z: (cz + d) * CELL + 2, ix: (cx + k + 0.5) * CELL, iz: (cz + d) * CELL - 2, y };
    case 'w': return { x: cx * CELL - 2, z: (cz + k + 0.5) * CELL, ix: cx * CELL + 2, iz: (cz + k + 0.5) * CELL, y };
    default: return { x: (cx + w) * CELL + 2, z: (cz + k + 0.5) * CELL, ix: (cx + w) * CELL - 2, iz: (cz + k + 0.5) * CELL, y };
  }
}

/** A house on stilts: posts at ground level, the building a level up, and a ramp to the door. */
export function stiltHouse(b, rng, o) {
  const { cx, cz, lv, w, d } = o;
  for (let i = 0; i <= w; i++) for (let j = 0; j <= d; j++) {
    if (i < w) { b.piece(WALL, cx + i, lv, cz, { rot: 1, mat: WOOD, edit: WALL_POSTS }); b.piece(WALL, cx + i, lv, cz + d, { rot: 1, mat: WOOD, edit: WALL_POSTS }); }
    if (j < d) { b.piece(WALL, cx, lv, cz + j, { rot: 0, mat: WOOD, edit: WALL_POSTS }); b.piece(WALL, cx + w, lv, cz + j, { rot: 0, mat: WOOD, edit: WALL_POSTS }); }
  }
  b.piece(RAMP, cx - 1, lv, cz, { rot: 0, mat: WOOD });
  building(b, rng, { ...o, lv: lv + 1, front: 'w', floors: 1, wallMat: WOOD, furniture: 'cabin' });
}

/** A gas station: a canopy on posts over pumps, and a small shop. */
export function gasStation(b, rng, { cx, cz, lv }) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) b.piece(FLOOR, cx + i, lv + 1, cz + j, { mat: METAL });
  for (const [i, j] of [[0, 0], [3, 0], [0, 2], [3, 2]]) {
    b.piece(WALL, cx + i, lv, cz + (j ? j - 1 : j), { rot: 0, mat: METAL, edit: WALL_POSTS });
  }
  for (let i = 0; i < 3; i++) b.prop('pump', (cx + i + 0.5) * CELL, lv * WALL_H, (cz + 1) * CELL, 0);
  b.claim(cx, cz, 3, 2);
  building(b, rng, { cx: cx + 4, cz, lv, w: 2, d: 2, floors: 1, wallMat: STONE, front: 'w', roof: 'flat', roofMat: STONE, furniture: 'shop', windows: 0.7, wideWindows: true });
  b.prop('car', (cx + 1.5) * CELL, lv * WALL_H, (cz + 2.6) * CELL, 0);
}

/**
 * A tall look-out: a 3×3 shaft with a stair spiral. One flight per level on
 * the middle cell of each side in turn, so each flight starts on the corner
 * landing where the last one ended, and there is a full four levels of
 * head-room between a flight and the next one stacked over it.
 */
const SPIRAL = [[1, 0, 0], [2, 1, 1], [1, 2, 2], [0, 1, 3]];   // cell x, cell z, climb direction

export function tower(b, rng, { cx, cz, lv, levels, mat = WOOD }) {
  b.claim(cx, cz, 3, 3);
  b.out.buildings.push({ cx, cz, w: 3, d: 3, lv, floors: levels, kind: 'tower', poi: b.poi, tier: b.tier });
  let hole = null;
  for (let s = 0; s <= levels; s++) {
    const L = lv + s;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      if (hole && hole[0] === i && hole[1] === j) continue;
      b.piece(FLOOR, cx + i, L, cz + j, { mat });
    }
    if (s === levels) break;
    const [fx, fz, rot] = SPIRAL[s % 4];
    b.piece(RAMP, cx + fx, L, cz + fz, { rot, mat });
    hole = [fx, fz];
    for (let i = 0; i < 3; i++) {
      b.piece(WALL, cx + i, L, cz, { rot: 1, mat, edit: rng.chance(0.3) ? WALL_WINDOW : 0 });
      b.piece(WALL, cx + i, L, cz + 3, { rot: 1, mat, edit: s === 0 && i === 0 ? WALL_DOOR : rng.chance(0.3) ? WALL_WINDOW : 0 });
      b.piece(WALL, cx, L, cz + i, { rot: 0, mat, edit: rng.chance(0.3) ? WALL_WINDOW : 0 });
      b.piece(WALL, cx + 3, L, cz + i, { rot: 0, mat, edit: rng.chance(0.3) ? WALL_WINDOW : 0 });
    }
    if (s > 0 && s % 2 === 0) b.loot((cx + 1.5) * CELL, L * WALL_H + 0.1, (cz + 1.5) * CELL);
  }
  const y = (lv + levels) * WALL_H + 0.1;
  b.chest((cx + 1.5) * CELL, y, (cz + 1.5) * CELL);
  b.loot((cx + 0.5) * CELL, y, (cz + 2.5) * CELL);
}

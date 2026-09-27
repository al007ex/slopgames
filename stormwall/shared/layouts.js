// How each kind of named place is laid out, plus the unnamed filler that fills
// the gaps. Named places are dense and well stocked (loot tier 2); filler
// houses and gas stations are sparser (tier 1).

import { CELL, WALL_H, WOOD, STONE, METAL } from './constants.js';
import { FLOOR } from './pieces.js';
import { building, stiltHouse, gasStation, tower } from './structures.js';
import { dsin, dcos } from './rng.js';

const toCell = (v) => Math.floor(v / CELL);

/** Houses on a lattice of lots with streets between them. */
function layoutTown(b, rng, poi, dense) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  const R = poi.r / CELL - 4;
  const spacing = dense ? 7 : 8;
  for (let gz = -4; gz <= 4; gz++) {
    for (let gx = -4; gx <= 4; gx++) {
      const lx = c0x + gx * spacing, lz = c0z + gz * spacing;
      if (Math.sqrt(gx * spacing * gx * spacing + gz * spacing * gz * spacing) > R) continue;
      if (rng.chance(dense ? 0.08 : 0.15)) continue;
      const front = gz <= 0 ? 's' : 'n';
      if (gx === 0 && gz === 0 && dense) {
        building(b, rng, { cx: lx - 2, cz: lz - 1, lv: poi.level, w: 4, d: 3, floors: 1, wallMat: STONE, roof: 'flat', roofMat: STONE, furniture: 'shop', front, windows: 0.7, wideWindows: true, backDoor: true });
        continue;
      }
      const w = dense ? 3 : rng.int(2, 3);
      const d = dense ? rng.int(2, 3) : 2;
      const floors = dense ? rng.int(2, 3) : rng.int(1, 2);
      const brick = rng.chance(dense ? 0.7 : 0.45);
      building(b, rng, {
        cx: lx - 1, cz: lz - 1, lv: poi.level, w, d, floors, front,
        groundMat: brick ? STONE : WOOD, upperMat: WOOD, roofMat: rng.chance(0.3) ? STONE : WOOD,
        roof: dense && rng.chance(0.35) ? 'flat' : 'cone', furniture: 'home',
      });
      // A car in the street out front, and sometimes a second one.
      const sz = front === 's' ? lz + d + 1.4 : lz - 2.4;
      if (rng.chance(0.55)) b.prop('car', (lx + 0.5) * CELL + rng.range(-2, 2), poi.baseY, sz * CELL, rng.chance(0.5) ? 0 : Math.PI);
      if (rng.chance(0.2)) b.prop('truck', (lx + 2.5) * CELL, poi.baseY, sz * CELL, 0);
    }
  }
  for (let i = 0; i < 6; i++) b.prop('lamp', poi.x + rng.range(-poi.r * 0.6, poi.r * 0.6), poi.baseY, poi.z + rng.range(-poi.r * 0.6, poi.r * 0.6));
}

function layoutFarm(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  const lv = poi.level;
  building(b, rng, { cx: c0x - 6, cz: c0z - 3, lv, w: 4, d: 3, floors: 2, wallMat: WOOD, roofMat: WOOD, garage: true, front: 's', furniture: 'barn', partition: false, windows: 0.2 });
  building(b, rng, { cx: c0x + 3, cz: c0z - 4, lv, w: 3, d: 2, floors: 2, groundMat: STONE, upperMat: WOOD, front: 's', furniture: 'home' });
  building(b, rng, { cx: c0x - 3, cz: c0z + 5, lv, w: 3, d: 3, floors: 1, wallMat: WOOD, garage: true, front: 'n', furniture: 'barn', roof: 'flat', partition: false });
  building(b, rng, { cx: c0x + 5, cz: c0z + 4, lv, w: 2, d: 2, floors: 1, wallMat: WOOD, front: 'w', furniture: 'barn' });
  b.prop('silo', (c0x - 9) * CELL, poi.baseY, (c0z - 5) * CELL);
  b.prop('silo', (c0x - 9) * CELL, poi.baseY, (c0z + 1) * CELL);
  b.prop('tractor', (c0x + 1) * CELL, poi.baseY, (c0z + 2) * CELL, rng.range(0, 3));
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(40, poi.r * 0.95);
    b.prop('haybale', poi.x + dcos(a) * r, poi.baseY, poi.z + dsin(a) * r, rng.range(0, 3));
  }
  for (let i = 0; i < 16; i++) b.prop('fence', poi.x - 60 + i * 2.6, poi.baseY, poi.z + poi.r * 0.7, 0);
  for (let i = 0; i < 12; i++) b.prop('fence', poi.x + poi.r * 0.72, poi.baseY, poi.z - 40 + i * 2.6, Math.PI / 2);
}

function layoutCabins(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  tower(b, rng, { cx: c0x - 1, cz: c0z - 1, lv: poi.level, levels: 5, mat: WOOD });
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = rng.range(8, 14);
    const cx = c0x + Math.round(dcos(a) * r), cz = c0z + Math.round(dsin(a) * r);
    if (!b.isFree(cx, cz, 2, 2)) continue;
    building(b, rng, { cx, cz, lv: poi.level, w: 2, d: 2, floors: rng.int(1, 2), wallMat: WOOD, front: rng.pick(['n', 's', 'e', 'w']), furniture: 'cabin' });
  }
}

function layoutLodge(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  building(b, rng, { cx: c0x - 3, cz: c0z - 2, lv: poi.level, w: 5, d: 3, floors: 2, groundMat: STONE, upperMat: WOOD, front: 's', furniture: 'cabin', backDoor: true });
  tower(b, rng, { cx: c0x + 5, cz: c0z - 6, lv: poi.level, levels: 7, mat: WOOD });
  for (const [dx, dz] of [[-9, 5], [4, 6], [-10, -6]]) {
    if (b.isFree(c0x + dx, c0z + dz, 2, 2)) building(b, rng, { cx: c0x + dx, cz: c0z + dz, lv: poi.level, w: 2, d: 2, floors: 1, wallMat: WOOD, front: 'n', furniture: 'cabin' });
  }
}

function layoutQuarry(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  for (const [dx, dz] of [[-20, -8], [-20, 2], [-12, 14]]) {
    building(b, rng, { cx: c0x + dx, cz: c0z + dz, lv: poi.level, w: 3, d: 2, floors: 1, wallMat: METAL, roof: 'flat', roofMat: METAL, front: 'e', furniture: 'warehouse', garage: rng.chance(0.5) });
  }
  for (let i = 0; i < 8; i++) b.prop('container', poi.x - 90 + rng.range(-10, 10), poi.baseY, poi.z - 60 + i * 7, Math.PI / 2);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(78, poi.r);
    b.prop(rng.chance(0.4) ? 'boulder' : 'rock', poi.x + 40 + dcos(a) * r, poi.baseY, poi.z - 20 + dsin(a) * r, rng.range(0, 3), rng.range(0.8, 1.4));
  }
  b.prop('truck', poi.x - 70, poi.baseY, poi.z + 40, 0.4);
  b.prop('tractor', poi.x - 60, poi.baseY, poi.z + 55, 1.2);
}

function layoutSwamp(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const r = rng.range(6, 20);
    const cx = c0x + Math.round(dcos(a) * r), cz = c0z + Math.round(dsin(a) * r);
    if (!b.isFree(cx - 1, cz, 3, 2)) continue;
    stiltHouse(b, rng, { cx, cz, lv: poi.level, w: 2, d: 2 });
  }
  for (let i = 0; i < 5; i++) b.prop('boat', poi.x + rng.range(-100, 100), poi.baseY, poi.z + rng.range(-100, 100), rng.range(0, 3));
  for (let i = 0; i < 18; i++) b.prop('deadtree', poi.x + rng.range(-poi.r, poi.r), poi.baseY, poi.z + rng.range(-poi.r, poi.r), 0, rng.range(0.8, 1.3));
}

function layoutDocks(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  for (const [dx, dz] of [[-12, -8], [-4, -8], [4, -8]]) {
    building(b, rng, { cx: c0x + dx, cz: c0z + dz, lv: poi.level, w: 4, d: 3, floors: 1, wallMat: METAL, roof: 'flat', roofMat: METAL, front: 's', garage: true, furniture: 'warehouse', partition: false, windows: 0.15 });
  }
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 7; i++) b.prop('container', poi.x - 50 + i * 7, poi.baseY, poi.z + 18 + row * 3.2, Math.PI / 2);
  }
  // A timber pier out over the water.
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) b.piece(FLOOR, c0x + 8 + j, poi.level, c0z + 4 + i, { mat: WOOD });
  for (let i = 0; i < 3; i++) b.prop('boat', (c0x + 11) * CELL, poi.baseY - 1, (c0z + 6 + i * 3) * CELL, Math.PI / 2);
  for (let i = 0; i < 10; i++) b.prop(rng.pick(['crate', 'pallet', 'barrel']), poi.x + rng.range(-60, 60), poi.baseY, poi.z + rng.range(-10, 40), rng.range(0, 3));
}

function layoutIndustrial(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  for (const [dx, dz] of [[-14, -12], [2, -12], [-14, 3], [3, 4]]) {
    building(b, rng, { cx: c0x + dx, cz: c0z + dz, lv: poi.level, w: 5, d: 4, floors: rng.int(1, 2), wallMat: METAL, upperMat: METAL, roof: 'flat', roofMat: METAL, front: 's', garage: true, furniture: 'warehouse', windows: 0.2 });
  }
  for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) b.prop('container', poi.x - 30 + i * 7, poi.baseY, poi.z - 20 + row * 3.2, Math.PI / 2);
  for (let i = 0; i < 6; i++) b.prop('pipe', poi.x + 60, poi.baseY, poi.z - 40 + i * 14, 0);
  for (let i = 0; i < 12; i++) b.prop('barrel', poi.x + rng.range(-80, 80), poi.baseY, poi.z + rng.range(-80, 80));
  b.prop('truck', poi.x - 70, poi.baseY, poi.z + 55, 0);
}

function layoutFactory(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  building(b, rng, { cx: c0x - 5, cz: c0z - 4, lv: poi.level, w: 7, d: 5, floors: 2, groundMat: STONE, upperMat: METAL, roof: 'flat', roofMat: METAL, front: 's', garage: true, furniture: 'warehouse', backDoor: true, windows: 0.35, wideWindows: true });
  tower(b, rng, { cx: c0x + 4, cz: c0z - 10, lv: poi.level, levels: 6, mat: STONE });
  building(b, rng, { cx: c0x - 14, cz: c0z + 4, lv: poi.level, w: 4, d: 3, floors: 1, wallMat: METAL, roof: 'flat', roofMat: METAL, front: 'e', garage: true, furniture: 'warehouse' });
  building(b, rng, { cx: c0x + 5, cz: c0z + 5, lv: poi.level, w: 3, d: 3, floors: 2, groundMat: STONE, upperMat: STONE, roof: 'flat', roofMat: STONE, front: 'n', furniture: 'shop' });
  for (let i = 0; i < 8; i++) b.prop('pipe', poi.x - 70 + i * 8, poi.baseY, poi.z - 70, Math.PI / 2);
  for (let i = 0; i < 10; i++) b.prop('barrel', poi.x + rng.range(-90, 90), poi.baseY, poi.z + rng.range(-90, 90));
}

function layoutDepot(b, rng, poi) {
  const c0x = toCell(poi.x), c0z = toCell(poi.z);
  gasStation(b, rng, { cx: c0x - 4, cz: c0z - 2, lv: poi.level });
  building(b, rng, { cx: c0x - 12, cz: c0z + 6, lv: poi.level, w: 5, d: 4, floors: 1, wallMat: METAL, roof: 'flat', roofMat: METAL, front: 'n', garage: true, furniture: 'warehouse' });
  building(b, rng, { cx: c0x + 5, cz: c0z + 6, lv: poi.level, w: 4, d: 3, floors: 2, groundMat: STONE, upperMat: METAL, roof: 'flat', roofMat: METAL, front: 'n', furniture: 'warehouse' });
  for (let i = 0; i < 6; i++) b.prop('container', poi.x + 40, poi.baseY, poi.z - 40 + i * 7, 0);
  for (let i = 0; i < 3; i++) b.prop('truck', poi.x - 40 + i * 12, poi.baseY, poi.z - 45, Math.PI / 2);
}

export const LAYOUTS = {
  town: (b, rng, poi) => layoutTown(b, rng, poi, true),
  suburb: (b, rng, poi) => layoutTown(b, rng, poi, false),
  farm: layoutFarm,
  cabins: layoutCabins,
  lodge: layoutLodge,
  quarry: layoutQuarry,
  swamp: layoutSwamp,
  docks: layoutDocks,
  industrial: layoutIndustrial,
  factory: layoutFactory,
  depot: layoutDepot,
};

/** One unnamed building on its own: a house, a cabin, a barn or a gas station. */
export function filler(b, rng, cx, cz, lv) {
  const roll = rng.next();
  if (roll < 0.55) {
    building(b, rng, { cx, cz, lv, w: rng.int(2, 3), d: 2, floors: rng.int(1, 2), groundMat: rng.chance(0.4) ? STONE : WOOD, upperMat: WOOD, front: rng.pick(['n', 's', 'e', 'w']), furniture: 'home' });
    if (rng.chance(0.5)) b.prop('car', (cx - 1.2) * CELL, lv * WALL_H, (cz + 1) * CELL, Math.PI / 2);
  } else if (roll < 0.75) {
    building(b, rng, { cx, cz, lv, w: 2, d: 2, floors: 1, wallMat: WOOD, front: rng.pick(['n', 's', 'e', 'w']), furniture: 'cabin' });
  } else if (roll < 0.88) {
    building(b, rng, { cx, cz, lv, w: 3, d: 3, floors: 1, wallMat: WOOD, garage: true, front: 's', furniture: 'barn', partition: false, roof: 'flat' });
  } else {
    gasStation(b, rng, { cx, cz, lv });
  }
}

export const FILLER_FOOTPRINT = 7;   // cells kept clear around a filler's origin

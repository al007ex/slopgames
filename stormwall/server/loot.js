// Loot in a match: what spawns on the floor, in chests and in ammo boxes,
// picking it up, and dropping it again. Ammo and materials are picked up by
// walking over them; weapons and healing need the interact key, and swap with
// what you are holding when your five slots are full.

import { rollFloor, rollChest, rollAmmoBox, CHEST_CHANCE, AMMO_BOX_CHANCE } from '../shared/loot.js';
import { WEAPONS, HEALS, AMMO, isWeapon, isHeal, isAmmo, isMaterial, itemId, itemName } from '../shared/items.js';
import { MAT_CAP, INVENTORY_SLOTS } from '../shared/constants.js';
import { EV_CHEST, EV_PICKUP } from '../shared/events.js';
import { MODE_WALK } from '../shared/movement.js';
import { B_ITEMS, B_CHESTS } from '../shared/protocol.js';

export const INTERACT_REACH = 3.2;
export const AUTO_PICKUP = 1.5;
const GRID = 16;
const MATS = { wood: 0, stone: 1, metal: 2 };

export const DROP_MAT_CAP = 300;          // materials dropped on death, per kind

export const INTERACT_ITEM = 1;
export const INTERACT_CHEST = 2;
export const INTERACT_REVIVE = 3;

export const lootMethods = {
  initLoot() {
    this.items = new Map();
    this.chests = new Map();
    this.itemGrid = new Map();
    this.nextItemId = 1;
    this.nextChestId = 1;
  },

  /** Rolls this match's floor loot, chests and ammo boxes. */
  spawnLoot() {
    const rng = this.rng;
    for (const spot of this.base.lootSpots) {
      const roll = rollFloor(rng, spot.tier);
      roll.forEach((item, i) => this.dropItem(item, spot.x + i * 0.7, spot.y, spot.z + i * 0.3));
    }
    for (const spot of this.base.chestSpots) if (rng.chance(CHEST_CHANCE)) this.addChest(spot, false);
    for (const spot of this.base.ammoSpots) if (rng.chance(AMMO_BOX_CHANCE)) this.addChest(spot, true);
  },

  addChest(spot, box) {
    const chest = { id: this.nextChestId++, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw || 0, tier: spot.tier || 1, poi: spot.poi ?? -1, box, open: false, alive: true };
    this.chests.set(chest.id, chest);
    this.touch('chest', chest);
    return chest;
  },

  dropItem(item, x, y, z) {
    const it = { id: this.nextItemId++, key: item.key, rarity: item.rarity || 0, count: item.count ?? 1, mag: item.mag ?? 0, x, y, z, alive: true };
    this.items.set(it.id, it);
    const k = Math.floor(x / GRID) * 4096 + Math.floor(z / GRID);
    it.gk = k;
    let set = this.itemGrid.get(k);
    if (!set) { set = new Set(); this.itemGrid.set(k, set); }
    set.add(it);
    this.touch('item', it);
    return it;
  },

  removeItem(it) {
    if (!it.alive) return;
    it.alive = false;
    this.items.delete(it.id);
    this.itemGrid.get(it.gk)?.delete(it);
    this.touch('item', it);
  },

  itemsNear(x, z, r, out = []) {
    out.length = 0;
    const i0 = Math.floor((x - r) / GRID), i1 = Math.floor((x + r) / GRID);
    const j0 = Math.floor((z - r) / GRID), j1 = Math.floor((z + r) / GRID);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const set = this.itemGrid.get(i * 4096 + j);
      if (set) for (const it of set) if ((it.x - x) ** 2 + (it.z - z) ** 2 <= r * r) out.push(it);
    }
    return out;
  },

  /* ------------------------------------------------------- interacting */

  tryInteract(p, a) {
    if (!p.alive || p.dbno || p.move.mode !== MODE_WALK) return false;
    const m = p.move;
    const near = (o) => (o.x - m.x) ** 2 + (o.z - m.z) ** 2 <= INTERACT_REACH * INTERACT_REACH && Math.abs(o.y - (m.y + 0.8)) < 2.8;
    if (a.kind === INTERACT_ITEM) {
      const it = this.items.get(a.id);
      if (it && it.alive && near(it)) return this.pickUp(p, it);
    } else if (a.kind === INTERACT_CHEST) {
      const c = this.chests.get(a.id);
      if (c && c.alive && !c.open && near(c)) return this.openChest(p, c);
    } else if (a.kind === INTERACT_REVIVE) return this.startRevive?.(p, a.id);
    return false;
  },

  pickUp(p, it) {
    if (isAmmo(it.key) || isMaterial(it.key)) return this.takeStack(p, it);
    let taken = false;
    if (isHeal(it.key)) {
      const before = it.count;
      const item = { key: it.key, count: it.count };
      const slot = this.giveItem(p, item);
      if (slot >= 0 || item.count < before) {
        if (item.count <= 0 || slot >= 0) this.removeItem(it);
        else { it.count = item.count; this.touch('item', it); }
        taken = true;
      }
    } else if (this.giveItem(p, { key: it.key, rarity: it.rarity, mag: it.mag }) >= 0) {
      this.removeItem(it);
      taken = true;
    }
    if (!taken) {
      // Full: swap with whatever is in your hands.
      if (p.held === 0) { p.conn?.sendJson({ t: 'note', text: 'Inventory full — select a slot to swap' }); return false; }
      const old = p.inv[p.held - 1];
      p.inv[p.held - 1] = null;
      if (old) this.dropItem({ ...old }, p.move.x, p.move.y + 0.1, p.move.z);
      if (isWeapon(it.key)) p.inv[p.held - 1] = { key: it.key, rarity: it.rarity, mag: it.mag };
      else p.inv[p.held - 1] = { key: it.key, count: it.count, rarity: HEALS[it.key]?.rarity ?? 0 };
      p.equipUntil = this.tick + 6;
      p.invDirty = true;
      this.removeItem(it);
    }
    p.pickups = (p.pickups || 0) + 1;
    this.event(EV_PICKUP, it.x, it.y, it.z, p.id);
    this.onPickup?.(p, it);
    return true;
  },

  takeStack(p, it) {
    let taken = 0;
    if (isAmmo(it.key)) taken = this.giveAmmo(p, it.key, it.count);
    else {
      const i = MATS[it.key];
      const before = p.mats[i];
      p.mats[i] = Math.min(MAT_CAP, before + it.count);
      taken = p.mats[i] - before;
      if (taken) p.invDirty = true;
    }
    if (taken <= 0) return false;
    if (taken >= it.count) this.removeItem(it);
    else { it.count -= taken; this.touch('item', it); }
    this.event(EV_PICKUP, it.x, it.y, it.z, p.id);
    return true;
  },

  /** Ammo and materials are picked up just by walking over them. */
  autoPickup(p) {
    if (!p.alive || p.dbno) return;
    const m = p.move;
    for (const it of this.itemsNear(m.x, m.z, AUTO_PICKUP, this.pickScratch || (this.pickScratch = []))) {
      if ((isAmmo(it.key) || isMaterial(it.key)) && Math.abs(it.y - m.y) < 1.6) this.takeStack(p, it);
    }
  },

  openChest(p, c) {
    c.open = true;
    this.touch('chest', c);
    const contents = c.box ? rollAmmoBox(this.rng) : rollChest(this.rng, c.tier);
    // Spill the contents out in front of the chest.
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    contents.forEach((item, i) => {
      const side = (i - (contents.length - 1) / 2) * 0.8;
      this.dropItem(item, c.x + fx * 1.2 + fz * side, c.y + 0.05, c.z + fz * 1.2 - fx * side);
    });
    this.event(EV_CHEST, c.x, c.y, c.z, c.id, c.box ? 1 : 0);
    if (!c.box) p.chests = (p.chests || 0) + 1;
    this.onChestOpened?.(p, c);
    return true;
  },

  /**
   * Everything an eliminated player carried, in a pile where they fell: every
   * weapon and consumable, all their ammo, and their materials up to a cap.
   */
  dropLootPile(p) {
    const drops = [];
    for (let i = 0; i < p.inv.length; i++) if (p.inv[i]) { drops.push({ ...p.inv[i] }); p.inv[i] = null; }
    for (const [type, n] of Object.entries(p.ammo)) if (n > 0) { drops.push({ key: type, count: n }); p.ammo[type] = 0; }
    ['wood', 'stone', 'metal'].forEach((key, i) => {
      const n = Math.min(DROP_MAT_CAP, p.mats[i]);
      if (n > 0) drops.push({ key, count: n });
      p.mats[i] = 0;
    });
    const { x, y, z } = p.move;
    drops.forEach((item, i) => {
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2, r = drops.length > 1 ? 0.9 + (i % 2) * 0.5 : 0;
      this.dropItem(item, x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r);
    });
    p.invDirty = true;
    return drops.length;
  },

  dropSlot(p, slot) {
    if (!p.alive || slot < 1 || slot > INVENTORY_SLOTS) return;
    const item = p.inv[slot - 1];
    if (!item) return;
    p.inv[slot - 1] = null;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    this.dropItem({ ...item }, p.move.x + fx * 1.4, p.move.y + 0.1, p.move.z + fz * 1.4);
    p.invDirty = true;
  },

  /* ------------------------------------------------------ replication */

  writeItems(w, list) {
    w.u8(B_ITEMS).u16(list.length);
    for (const it of list) {
      w.u32(it.id).u8(it.alive ? 1 : 0);
      if (it.alive) w.u8(itemId(it.key)).u8(it.rarity).u16(isWeapon(it.key) ? it.mag : it.count).f32(it.x).f32(it.y).f32(it.z);
    }
  },

  writeChests(w, list) {
    w.u8(B_CHESTS).u16(list.length);
    for (const c of list) w.u32(c.id).u8((c.alive ? 1 : 0) | (c.open ? 2 : 0) | (c.box ? 4 : 0)).f32(c.x).f32(c.y).f32(c.z).u8(Math.round(c.yaw / (Math.PI / 2)) & 3);
  },
};

export { WEAPONS, AMMO, itemName };

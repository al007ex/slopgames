// M5 — loot and inventory: five slots plus the pickaxe, separate counters for
// materials and ammo, stacking consumables, floor loot / chests / ammo boxes
// with weighted rarity and tiers by place. Done when a player can land, loot a
// house and leave with a kit in under a minute.
import { ok, eq, near, section, report } from './harness.js';
import { flatBase, standIn } from './util.js';
import { Match } from '../server/match.js';
import { Rng } from '../shared/rng.js';
import { rollFloor, rollChest, rollAmmoBox, RARITY_WEIGHTS, CHEST_CHANCE } from '../shared/loot.js';
import { WEAPONS, HEALS, isWeapon, isHeal, isAmmo } from '../shared/items.js';
import { A_INTERACT, A_DROP, A_SLOT } from '../shared/protocol.js';
import { INTERACT_ITEM, INTERACT_CHEST } from '../server/loot.js';
import { INVENTORY_SLOTS, TICK_HZ, CELL, WALL_H } from '../shared/constants.js';
import { SPRINT_SPEED } from '../shared/movement.js';

const newMatch = (loot = false) => new Match({ base: flatBase(), mode: 'test', loot });

section('Inventory');
{
  eq(INVENTORY_SLOTS, 5, 'five slots, plus the pickaxe');
  const m = newMatch();
  const p = standIn(m, 100, 100);
  for (let i = 0; i < 5; i++) ok(m.giveItem(p, { key: 'ar', rarity: 0 }) === i, `slot ${i + 1} takes a weapon`);
  eq(m.giveItem(p, { key: 'pump', rarity: 1 }), -1, 'a sixth weapon does not fit');
  const q = standIn(m, 101, 100);
  m.giveItem(q, { key: 'bandage', count: 5 });
  m.giveItem(q, { key: 'bandage', count: 5 });
  m.giveItem(q, { key: 'bandage', count: 5 });
  eq(q.inv.filter(Boolean).length, 1, 'bandages stack in one slot');
  eq(q.inv[0].count, 15, '…up to fifteen');
  m.giveItem(q, { key: 'bandage', count: 3 });
  eq(q.inv[1]?.count, 3, 'the sixteenth starts a new stack');
  m.giveAmmo(q, 'medium', 60);
  q.mats[0] = 200;
  eq(q.inv.filter(Boolean).length, 2, 'ammo and materials live in their own counters, not in slots');
}

section('Loot tables');
{
  const rng = new Rng(42);
  let spots = 0, filled = 0;
  for (let i = 0; i < 4000; i++) { spots++; if (rollFloor(rng, 1).length) filled++; }
  ok(filled / spots > 0.55 && filled / spots < 0.7, `floor spots have a spawn chance (${(100 * filled / spots).toFixed(0)}% filled in lone houses)`);
  const rarity = (tier, source) => {
    const n = [0, 0, 0, 0, 0];
    const r = new Rng(tier * 100 + (source === 'chest' ? 1 : 0));
    for (let i = 0; i < 20000; i++) {
      const items = source === 'chest' ? rollChest(r, tier) : rollFloor(r, tier);
      for (const it of items) if (isWeapon(it.key)) n[it.rarity]++;
    }
    const total = n.reduce((a, b) => a + b, 0);
    return n.map((x) => x / total);
  };
  const f1 = rarity(1, 'floor'), f2 = rarity(2, 'floor'), c2 = rarity(2, 'chest');
  ok(f1[0] + f1[1] > 0.75, `floor loot is mostly grey and green (${(100 * (f1[0] + f1[1])).toFixed(0)}%)`);
  ok(f1[4] < 0.005, `a legendary on the floor is an event (${(100 * f1[4]).toFixed(2)}% of floor weapons)`);
  const avg = (d) => d.reduce((s, x, i) => s + x * i, 0);
  ok(avg(f2) > avg(f1), `named places roll better than lone houses (average rarity ${avg(f2).toFixed(2)} vs ${avg(f1).toFixed(2)})`);
  ok(avg(c2) > avg(f2), `chests roll better than the floor (${avg(c2).toFixed(2)})`);
  const chestRng = new Rng(7);
  let allGood = true, heals = 0;
  for (let i = 0; i < 500; i++) {
    const c = rollChest(chestRng, 1);
    const w = c.find((x) => isWeapon(x.key));
    if (!w || !c.find((x) => x.key === WEAPONS[w.key].ammo)) allGood = false;
    if (c.some((x) => isHeal(x.key))) heals++;
  }
  ok(allGood, 'every chest has a weapon and ammo for it');
  ok(heals / 500 > 0.65 && heals / 500 < 0.85, `…and usually something to heal with (${(heals / 5).toFixed(0)}%)`);
  const boxRng = new Rng(9);
  let onlyAmmo = true;
  for (let i = 0; i < 200; i++) if (!rollAmmoBox(boxRng).every((x) => isAmmo(x.key))) onlyAmmo = false;
  ok(onlyAmmo, 'ammo boxes hold only ammo');
  eq(RARITY_WEIGHTS.floor[1].length, 5, 'weights for all five rarities');
}

section('A real match');
{
  const m = new Match({ mode: 'test' });
  const chests = [...m.chests.values()].filter((c) => !c.box);
  const share = chests.length / m.base.chestSpots.length;
  ok(share > 0.5 && share < 0.7, `${chests.length} of ${m.base.chestSpots.length} chest spots have a chest this match (${(100 * share).toFixed(0)}%)`);
  near(CHEST_CHANCE, 0.6, 0.1, 'about 50–70% of chests exist in any one match');
  const m2 = new Match({ mode: 'test', rngSeed: 999 });
  const same = [...m2.chests.values()].filter((c) => !c.box).map((c) => `${c.x},${c.z}`);
  const differ = chests.filter((c) => !same.includes(`${c.x},${c.z}`)).length;
  ok(differ > 20, 'different matches put chests in different places');
  ok(m.items.size > 1500, `the floor is covered in loot (${m.items.size} items)`);
  const named = m.base.buildings.filter((b) => b.poi >= 0 && b.kind !== 'tower');
  const withChest = named.filter((b) => m.base.chestSpots.some((c) => c.x >= b.cx * CELL && c.x <= (b.cx + b.w) * CELL && c.z >= b.cz * CELL && c.z <= (b.cz + b.d) * CELL));
  ok(withChest.length / named.length > 0.95, `every notable building has a chest spot (${withChest.length}/${named.length})`);
}

section('Picking up and dropping');
{
  const m = newMatch();
  const p = standIn(m, 200, 200);
  const it = m.dropItem({ key: 'ar', rarity: 3, mag: 30 }, p.move.x + 1, p.move.y, p.move.z);
  const ammo = m.dropItem({ key: 'medium', count: 30 }, p.move.x + 4, p.move.y, p.move.z);
  const wood = m.dropItem({ key: 'wood', count: 30 }, p.move.x + 4.5, p.move.y, p.move.z);
  m.onAction(p, { type: A_INTERACT, kind: INTERACT_ITEM, id: it.id });
  eq(p.inv[0]?.key, 'ar', 'the interact key picks up a weapon');
  eq(p.inv[0].rarity, 3, '…with its rarity');
  ok(!it.alive, '…and it is gone from the floor');
  p.move.x += 4;
  m.step();
  eq(p.ammo.medium, 30, 'ammo is picked up just by walking over it');
  eq(p.mats[0], 30, 'so are materials');
  const far = m.dropItem({ key: 'pump', rarity: 1, mag: 5 }, p.move.x + 10, p.move.y, p.move.z);
  m.onAction(p, { type: A_INTERACT, kind: INTERACT_ITEM, id: far.id });
  ok(far.alive, 'nothing can be picked up from 10 m away');
  // Full inventory: swap with the held slot.
  for (let i = 0; i < 4; i++) m.giveItem(p, { key: 'smg', rarity: 0 });
  m.onAction(p, { type: A_SLOT, slot: 3 });
  const pump = m.dropItem({ key: 'pump', rarity: 2, mag: 5 }, p.move.x + 1, p.move.y, p.move.z);
  m.onAction(p, { type: A_INTERACT, kind: INTERACT_ITEM, id: pump.id });
  eq(p.inv[2].key, 'pump', 'with all five slots full, a pickup swaps with what you hold');
  ok([...m.items.values()].some((x) => x.key === 'smg' && x.alive), '…and drops that on the floor');
  m.onAction(p, { type: A_DROP, slot: 1 });
  eq(p.inv[0], null, 'you can drop an item');
  ok([...m.items.values()].some((x) => x.key === 'ar' && x.rarity === 3), '…and it lands in front of you');
  // Chests.
  const chest = m.addChest({ x: p.move.x + 2, y: p.move.y, z: p.move.z, tier: 2 }, false);
  const before = m.items.size;
  m.onAction(p, { type: A_INTERACT, kind: INTERACT_CHEST, id: chest.id });
  ok(chest.open, 'the interact key opens a chest');
  ok(m.items.size - before >= 3, `…which spills out its loot (${m.items.size - before} items)`);
}

section('Done when: land, loot a house, leave with a kit in under 60 seconds');
{
  const m = new Match({ mode: 'test', rngSeed: 2024 });
  // Named-place houses whose chest spawned this match.
  const houses = m.base.buildings.filter((b) => b.poi >= 0 && b.kind === 'home');
  const inside = (b, o, pad = 0) => o.x >= b.cx * CELL - pad && o.x <= (b.cx + b.w) * CELL + pad && o.z >= b.cz * CELL - pad && o.z <= (b.cz + b.d) * CELL + pad && o.y >= b.lv * WALL_H - 0.5 && o.y <= (b.lv + b.floors) * WALL_H + 1;
  let tried = 0, kitted = 0, times = [];
  for (const house of houses.slice(0, 40)) {
    const p = m.addPlayer({ name: `looter${tried}`, bot: true });
    p.botInput = null;
    // Land at the front door and start running.
    const pos = { x: (house.cx + house.w / 2) * CELL, y: house.lv * WALL_H + 0.1, z: (house.cz + house.d + 1) * CELL };
    let t = 0;
    const visit = (o) => {
      const d = Math.hypot(o.x - pos.x, o.z - pos.z) + Math.abs(o.y - pos.y) * 1.5;   // stairs are slower
      t += d / SPRINT_SPEED + 0.3;   // run there, press the key
      pos.x = o.x; pos.y = o.y; pos.z = o.z;
      p.move.x = o.x; p.move.y = o.y; p.move.z = o.z;
    };
    const chest = [...m.chests.values()].find((c) => !c.open && inside(house, c));
    if (chest) { visit(chest); m.onAction(p, { type: A_INTERACT, kind: INTERACT_CHEST, id: chest.id }); }
    // Then everything on the floors, nearest first.
    for (;;) {
      const left = [...m.items.values()].filter((it) => it.alive && inside(house, it, 1.5));
      if (!left.length || t > 60) break;
      left.sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) + Math.abs(a.y - pos.y) - Math.hypot(b.x - pos.x, b.z - pos.z) - Math.abs(b.y - pos.y));
      const it = left[0];
      visit(it);
      m.onAction(p, { type: A_INTERACT, kind: INTERACT_ITEM, id: it.id });
      m.autoPickup(p);
      if (it.alive) m.removeItem(it);    // could not carry it — leave it
    }
    t += Math.hypot(pos.x - (house.cx + house.w / 2) * CELL, pos.z - (house.cz + house.d + 1) * CELL) / SPRINT_SPEED;   // back out the door
    const weapons = p.inv.filter((s) => s && isWeapon(s.key));
    const armed = weapons.some((w) => (p.ammo[WEAPONS[w.key].ammo] || 0) + w.mag > 0);
    const extra = weapons.length >= 2 || p.inv.some((s) => s && isHeal(s.key));
    tried++;
    if (armed && extra && t <= 60) { kitted++; times.push(t); }
    m.removePlayer(p);
  }
  times.sort((a, b) => a - b);
  ok(kitted / tried >= 0.7, `${kitted} of ${tried} houses in named places give a kit (a loaded weapon plus a second weapon or healing)`);
  ok(times.length && times[Math.floor(times.length / 2)] < 60, `…in ${times.length ? times[Math.floor(times.length / 2)].toFixed(0) : '—'} s on the median house, well under a minute`);
  void HEALS; void TICK_HZ;
}

report();

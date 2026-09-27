// M10 — the map: twenty named places plus plenty of unnamed filler, a quiet
// middle, multi-storey interiors, loot tiers by place, a chest in every
// notable building, all three materials everywhere, a different landscape in
// each quarter, roads between places — and nothing you cannot break or harvest.
import { ok, eq, section, report } from './harness.js';
import { getWorld, POIS } from '../shared/worldgen.js';
import { World } from '../shared/world.js';
import { biomeWeights } from '../shared/terrain.js';
import { PROP_KINDS, propMaxHp } from '../shared/props.js';
import { MAT_STATS, hpAt } from '../shared/pieces.js';
import { OWNER_PIECE, OWNER_PROP } from '../shared/collision.js';
import { CELL, WALL_H, WORLD_CENTER, WOOD, STONE, METAL } from '../shared/constants.js';
import { DEEP_WATER } from '../shared/movement.js';

const w = getWorld();
const inPoi = (poi, x, z) => Math.hypot(x - poi.x, z - poi.z) < poi.r + 10;

section('Named places');
{
  eq(w.pois.length, 20, 'twenty named places');
  eq(new Set(w.pois.map((p) => p.name)).size, 20, 'with twenty different names');
  const perPoi = w.pois.map((p) => w.buildings.filter((b) => inPoi(p, (b.cx + b.w / 2) * CELL, (b.cz + b.d / 2) * CELL)).length);
  ok(perPoi.every((n) => n >= 3), `every named place has at least three buildings (fewest ${Math.min(...perPoi)})`);
  const multi = w.pois.filter((p) => w.buildings.some((b) => b.floors >= 2 && inPoi(p, (b.cx + b.w / 2) * CELL, (b.cz + b.d / 2) * CELL)));
  eq(multi.length, 20, 'every named place has multi-storey buildings for vertical fights');
  const fillers = w.buildings.filter((b) => b.poi < 0);
  ok(fillers.length >= 70, `${fillers.length} unnamed filler buildings between them`);
  ok(fillers.some((b) => b.kind === 'shop') && fillers.some((b) => b.kind === 'barn') && fillers.some((b) => b.kind === 'cabin'), 'filler includes gas stations, barns and cabins');
}

section('A quiet middle');
{
  const nearest = Math.min(...w.pois.map((p) => Math.hypot(p.x - WORLD_CENTER, p.z - WORLD_CENTER) - p.r));
  ok(nearest > 500, `no named place within ${Math.round(nearest)} m of the centre`);
  const centre = w.buildings.filter((b) => Math.hypot((b.cx + b.w / 2) * CELL - WORLD_CENTER, (b.cz + b.d / 2) * CELL - WORLD_CENTER) < 600).length;
  const ring = w.buildings.filter((b) => { const d = Math.hypot((b.cx + b.w / 2) * CELL - WORLD_CENTER, (b.cz + b.d / 2) * CELL - WORLD_CENTER); return d > 1200 && d < 2200; }).length;
  const centreArea = Math.PI * 600 * 600, ringArea = Math.PI * (2200 * 2200 - 1200 * 1200);
  ok(centre / centreArea < (ring / ringArea) / 3, `buildings are several times sparser in the middle (${centre} within 600 m vs ${ring} in the outer ring)`);
}

section('A different landscape in each quarter');
{
  const kindsIn = (quarter) => w.pois.filter((p) => { const b = biomeWeights(p.x, p.z); return b[quarter] > 0.4; }).map((p) => p.kind);
  ok(kindsIn('farm').includes('farm'), `north-west is farmland (${kindsIn('farm').join(', ')})`);
  ok(kindsIn('mountain').some((k) => ['lodge', 'cabins', 'quarry'].includes(k)), `north-east is mountains (${kindsIn('mountain').join(', ')})`);
  ok(kindsIn('swamp').includes('swamp'), `south-east is swamp (${kindsIn('swamp').join(', ')})`);
  ok(kindsIn('industrial').some((k) => ['industrial', 'factory', 'docks', 'depot'].includes(k)), `south-west is industrial (${kindsIn('industrial').join(', ')})`);
  const peak = Math.max(...w.pois.filter((p) => biomeWeights(p.x, p.z).mountain > 0.4).map((p) => p.baseY));
  ok(peak > 100, `mountain places sit high up (up to ${Math.round(peak)} m)`);
  let wading = 0, deep = 0;
  for (let x = 3300; x < 4500; x += 8) for (let z = 2900; z < 4100; z += 8) { const h = w.terrain.heightAt(x, z); if (h < 0 && h > DEEP_WATER) wading++; if (h <= DEEP_WATER && biomeWeights(x, z).swamp > 0.8 && Math.hypot(x - 2560, z - 2560) < 2000) deep++; }
  ok(wading > 500 && deep === 0, `the swamp has ponds you can wade through (${wading} samples), none too deep`);
}

section('Loot tiers and chests');
{
  const perBuilding = (tier) => {
    const bs = w.buildings.filter((b) => b.tier === tier);
    const spots = w.lootSpots.filter((s) => s.tier === tier).length;
    const area = bs.reduce((a, b) => a + b.w * b.d * b.floors, 0);
    return spots / area;
  };
  ok(w.lootSpots.every((s) => s.tier === 1 || s.tier === 2), 'every loot spot has a tier');
  ok(w.lootSpots.filter((s) => s.tier === 2).length > w.lootSpots.filter((s) => s.tier === 1).length * 3, 'most loot is in the named places');
  ok(perBuilding(2) > perBuilding(1) * 1.2, `named places are stocked denser per room than filler (${perBuilding(2).toFixed(2)} vs ${perBuilding(1).toFixed(2)} spots per room)`);
  const notable = w.buildings.filter((b) => b.w * b.d >= 4 && b.kind !== 'tower');
  const withChest = notable.filter((b) => w.chestSpots.some((c) => c.x >= b.cx * CELL && c.x <= (b.cx + b.w) * CELL && c.z >= b.cz * CELL && c.z <= (b.cz + b.d) * CELL));
  eq(withChest.length, notable.length, `every notable building has a chest spot (${notable.length})`);
}

section('All three materials, everywhere');
{
  const world = new World(w);
  let short = [];
  for (const p of w.pois) {
    const mats = new Set();
    for (const piece of world.pieces.values()) if (inPoi(p, (piece.cx + 0.5) * CELL, (piece.cz + 0.5) * CELL)) mats.add(piece.mat);
    for (const q of w.props) if (q && inPoi(p, q.x, q.z)) mats.add(PROP_KINDS[q.kind].mat);
    if (mats.size < 3) short.push(`${p.name} (${[...mats].join(',')})`);
  }
  eq(short.join('; '), '', 'every named place has wood, brick/stone and metal to harvest');
  ok(w.props.some((q) => PROP_KINDS[q.kind].mat === WOOD) && w.props.some((q) => PROP_KINDS[q.kind].mat === STONE) && w.props.some((q) => PROP_KINDS[q.kind].mat === METAL), 'and so does the open country');
}

section('Nothing you cannot break or harvest');
{
  const world = new World(w);
  let unbreakable = 0;
  for (const piece of world.pieces.values()) if (!(hpAt(piece, 0) > 0 && MAT_STATS[piece.mat])) unbreakable++;
  for (const q of w.props) if (!(propMaxHp(q) > 0)) unbreakable++;
  eq(unbreakable, 0, `all ${world.pieces.size} pieces and ${w.props.length} props have health`);
  // Every collider in the world belongs to something breakable: only the ground itself is permanent.
  let orphans = 0;
  for (const list of world.grid.buckets.values()) for (const c of list) if (c.kind !== OWNER_PIECE && c.kind !== OWNER_PROP) orphans++;
  eq(orphans, 0, 'there are no invisible or permanent obstacles');
}

section('Roads');
{
  ok(w.roads.length >= w.pois.length - 1, `${w.roads.length} roads`);
  const reach = new Set([0]);
  let grew = true;
  while (grew) { grew = false; for (const r of w.roads) { if (reach.has(r.a) && !reach.has(r.b)) { reach.add(r.b); grew = true; } if (reach.has(r.b) && !reach.has(r.a)) { reach.add(r.a); grew = true; } } }
  eq(reach.size, 20, 'every named place is on the road network');
  void POIS; void WALL_H;
}

report();

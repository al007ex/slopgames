// Things that happen in a tick that nearby clients should see or hear: a
// pickaxe hit, a wall breaking, a shot, an explosion. Each is one small fixed
// record in the snapshot's events block.

export const EV_HARVEST = 1;    // a: player, b: material, c: 1 on a weak point
export const EV_BREAK = 2;      // b: material, c: 0 prop / 1 piece
export const EV_SWING = 3;      // a: player
export const EV_BUILD = 4;      // a: player, b: material
export const EV_SHOT = 5;       // a: shooter, b: weapon kind, c: 1 if it hit a player; xyz: where it ended
export const EV_IMPACT = 6;     // b: surface material (0 wood, 1 stone, 2 metal, 3 ground, 4 flesh)
export const EV_EXPLOSION = 7;  // b: radius in metres
export const EV_EDIT = 8;       // a: player
export const EV_CHEST = 9;      // a: chest id
export const EV_PICKUP = 10;    // a: player
export const EV_HEAL = 11;      // a: player, b: kind
export const EV_RELOAD = 12;    // a: player

export function writeEvents(w, events) {
  w.u16(events.length);
  for (const e of events) w.u8(e.type).u16(e.a || 0).f32(e.x).f32(e.y).f32(e.z).u8(e.b || 0).u8(e.c || 0);
}

export function readEvents(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) out.push({ type: r.u8(), a: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), b: r.u8(), c: r.u8() });
  return out;
}

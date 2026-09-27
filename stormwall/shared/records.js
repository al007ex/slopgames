// Decoders for the replicated-object blocks of a snapshot (see server/replication.js).

export function readPieces(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    const alive = r.u8();
    if (!alive) { out.push({ id, alive: false }); continue; }
    out.push({ id, alive: true, type: r.u8(), rot: r.u8(), cx: r.u16(), lv: r.i8(), cz: r.u16(), mat: r.u8(), edit: r.u16(), start: r.i32(), damage: r.f32(), team: r.u16() });
  }
  return out;
}

export function readProps(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: r.u32(), alive: r.u8() === 1, hp: r.u16() });
  return out;
}

export function readItems(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = r.u32();
    if (!r.u8()) { out.push({ id, alive: false }); continue; }
    out.push({ id, alive: true, kind: r.u8(), rarity: r.u8(), count: r.u16(), x: r.f32(), y: r.f32(), z: r.f32() });
  }
  return out;
}

export function readChests(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = r.u32(), f = r.u8();
    out.push({ id, alive: !!(f & 1), open: !!(f & 2), box: !!(f & 4), x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.u8() * (Math.PI / 2) });
  }
  return out;
}

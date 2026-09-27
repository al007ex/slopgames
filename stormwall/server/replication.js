// Structure and loot replication. The map itself is never sent — every client
// generated the same one — so only what changed goes out: a damaged or broken
// wall, a harvested tree, a new build, loot on the floor. Changes are filed by
// replication cell with a revision number, and each client remembers the last
// revision it has seen per cell. A client walking into an area receives every
// change there it has not seen yet, and nothing from the other side of the island.

import { REP_CELL, REP_N, NEAR_RADIUS } from '../shared/constants.js';
import { pieceCenter } from '../shared/pieces.js';
import { B_PIECES, B_PROPS, B_ITEMS, B_CHESTS, B_HITS } from '../shared/protocol.js';
import { writeEvents } from '../shared/events.js';

const MAX_RECORDS = 1500;           // per snapshot; the rest follows next tick
const center = {};

export const replicationMethods = {
  initReplication() {
    this.rev = 0;
    this.cellRev = new Uint32Array(REP_N * REP_N);
    this.cellChanges = Array.from({ length: REP_N * REP_N }, () => []);
    this.events = [];
  },

  /** Marks an object as changed so clients near it hear about it. */
  touch(kind, obj) {
    obj.rev = ++this.rev;
    if (obj.repCell === undefined) {
      let x, z;
      if (kind === 'piece') { pieceCenter(obj, center); x = center.x; z = center.z; } else { x = obj.x; z = obj.z; }
      const i = Math.min(REP_N - 1, Math.max(0, Math.floor(x / REP_CELL)));
      const j = Math.min(REP_N - 1, Math.max(0, Math.floor(z / REP_CELL)));
      obj.repCell = j * REP_N + i;
    }
    if (!obj.listed) { obj.listed = true; this.cellChanges[obj.repCell].push({ kind, obj }); }
    this.cellRev[obj.repCell] = this.rev;
  },

  event(type, x, y, z, a = 0, b = 0, c = 0) {
    this.events.push({ type, x, y, z, a, b, c });
  },

  writeBlocks(w, conn, focus) {
    if (!focus) return;
    if (!conn.known) conn.known = new Uint32Array(REP_N * REP_N);
    const pieces = [], props = [], items = [], chests = [];
    const span = Math.ceil(NEAR_RADIUS / REP_CELL);
    const ci = Math.floor(focus.x / REP_CELL), cj = Math.floor(focus.z / REP_CELL);
    let records = 0;
    // Nearest cells first, so a crowded area never starves the ground underfoot.
    for (let ring = 0; ring <= span && records < MAX_RECORDS; ring++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          if (i < 0 || j < 0 || i >= REP_N || j >= REP_N) continue;
          const c = j * REP_N + i;
          const known = conn.known[c];
          if (this.cellRev[c] <= known || records >= MAX_RECORDS) continue;
          for (const { kind, obj } of this.cellChanges[c]) {
            if (obj.rev <= known) continue;
            if (kind === 'piece') pieces.push(obj);
            else if (kind === 'prop') props.push(obj);
            else if (kind === 'item') items.push(obj);
            else if (kind === 'chest') chests.push(obj);
            records++;
          }
          conn.known[c] = this.cellRev[c];
        }
      }
    }
    if (pieces.length) {
      w.u8(B_PIECES).u16(pieces.length);
      for (const p of pieces) {
        w.u32(p.id).u8(p.alive ? 1 : 0);
        if (p.alive) w.u8(p.type).u8(p.rot).u16(p.cx).i8(p.lv).u16(p.cz).u8(p.mat).u16(p.edit).i32(p.start).f32(p.damage).u16(p.team);
      }
    }
    if (props.length) {
      w.u8(B_PROPS).u16(props.length);
      for (const p of props) w.u32(p.id).u8(p.alive ? 1 : 0).u16(Math.max(0, Math.ceil(p.hp)));
    }
    if (items.length) this.writeItems?.(w, items, B_ITEMS);
    if (chests.length) this.writeChests?.(w, chests, B_CHESTS);
    // Events near the focus: hits, breaks, shots, explosions.
    if (this.events.length) {
      const near = [];
      const r2 = NEAR_RADIUS * NEAR_RADIUS;
      for (const e of this.events) {
        const dx = e.x - focus.x, dz = e.z - focus.z;
        if (dx * dx + dz * dz <= r2) near.push(e);
      }
      if (near.length) { w.u8(B_HITS); writeEvents(w, near); }
    }
  },
};

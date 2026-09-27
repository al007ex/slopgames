// Building and editing, server side. The client says what it wants to place
// (the slot it previewed); the server checks everything again — materials,
// the slot, support, reach, where the player is actually looking, whether
// anyone would end up inside it, and that nobody places faster than clicking
// allows — and only then puts the piece into the world.

import {
  WALL, RAMP, BUILD_COST, editIsValid, rampDirFromSelection, pieceColliders, pieceSockets, pieceCenter,
} from '../shared/pieces.js';
import {
  buildTarget, placementProblem, pieceAt, liftFor, BUILD_REACH, PLACE_INTERVAL_TICKS,
} from '../shared/build.js';
import { MODE_WALK, MODE_DEAD, MODE_BUS } from '../shared/movement.js';
import { EV_BUILD, EV_EDIT } from '../shared/events.js';

const c = {};

export const buildingMethods = {
  /** Everyone who counts as being "in the way" of a new piece. */
  obstacles() {
    const out = [];
    for (const q of this.players.values()) if (q.alive && q.move.mode !== MODE_DEAD && q.move.mode !== MODE_BUS) out.push(q.move);
    return out;
  },

  stageBuild() {
    this.mark('build');
    for (const p of this.players.values()) {
      if (p.pendingBuild.length) {
        for (const a of p.pendingBuild) this.tryPlace(p, a);
        p.pendingBuild.length = 0;
      }
      if (p.pendingEdits.length) {
        for (const a of p.pendingEdits) this.tryEdit(p, a);
        p.pendingEdits.length = 0;
      }
    }
  },

  denyBuild(p, a, reason) {
    p.conn?.sendJson({ t: 'build-denied', reason, piece: a.piece, cx: a.cx, lv: a.lv, cz: a.cz });
    return false;
  },

  tryPlace(p, a) {
    if (!p.alive || p.move.mode !== MODE_WALK) return this.denyBuild(p, a, 'cannot build now');
    if (this.tick - (p.lastPlace ?? -1e9) < PLACE_INTERVAL_TICKS) return this.denyBuild(p, a, 'too fast');
    if (!(a.piece >= 0 && a.piece <= 3)) return this.denyBuild(p, a, 'bad piece');
    const rot = a.piece === WALL ? a.rot & 1 : a.piece === RAMP ? a.rot & 3 : 0;
    const target = { type: a.piece, rot, cx: a.cx, lv: a.lv, cz: a.cz };
    // It has to be about where this player is actually looking.
    const expect = buildTarget(a.piece, p.move, p.yaw, p.pitch, this.world, {});
    if (Math.abs(expect.cx - target.cx) > 1 || Math.abs(expect.cz - target.cz) > 1 || Math.abs(expect.lv - target.lv) > 1) {
      return this.denyBuild(p, a, 'not where you are looking');
    }
    const mat = p.buildMat | 0;
    const problem = placementProblem(this.world, target, { mats: p.mats, mat, players: this.obstacles(), builder: p.move });
    if (problem) return this.denyBuild(p, a, problem);

    const piece = { id: this.world.nextPieceId++, ...pieceAt(target, mat, p.team, this.tick), owner: p.id };
    this.world.addPiece(piece);
    p.mats[mat] -= BUILD_COST;
    p.invDirty = true;
    p.lastPlace = this.tick;
    p.built = (p.built || 0) + 1;
    this.touch('piece', piece);
    pieceCenter(piece, c);
    this.event(EV_BUILD, c.x, c.y, c.z, p.id, mat);
    this.liftOutOf(piece);
    return true;
  },

  /** Anyone a new floor, ramp or cone was put under gets stood on top of it. */
  liftOutOf(piece) {
    if (piece.type === WALL) return;
    const cols = piece.cols || pieceColliders(piece);
    for (const q of this.players.values()) {
      if (!q.alive || q.move.mode === MODE_DEAD || q.move.mode === MODE_BUS) continue;
      const dy = liftFor(this.world, q.move, cols);
      if (dy > 0) { q.move.y += dy; q.move.vy = Math.max(0, q.move.vy); q.move.ground = 1; q.move.peakY = q.move.y; }
    }
  },

  tryEdit(p, a) {
    const piece = this.world.pieces.get(a.id);
    if (!piece || !piece.alive || !p.alive) return false;
    // Only your own team's builds; the map and enemy walls cannot be edited.
    if (piece.team === 0 || piece.team !== p.team) return false;
    pieceCenter(piece, c);
    const dx = c.x - p.move.x, dy = c.y - p.move.y - 1, dz = c.z - p.move.z;
    if (dx * dx + dy * dy + dz * dz > BUILD_REACH * BUILD_REACH) return false;
    let edit = piece.edit, rot = piece.rot;
    if (piece.type === RAMP) {
      const dir = rampDirFromSelection(a.value);
      if (dir < 0) return false;
      rot = dir;
    } else {
      if (!editIsValid(piece.type, a.value)) return false;
      edit = a.value;
    }
    if (edit === piece.edit && rot === piece.rot) return false;
    const oldSockets = piece.sockets || pieceSockets(piece);
    this.world.reshapePiece(piece, { edit, rot });
    this.touch('piece', piece);
    this.event(EV_EDIT, c.x, c.y, c.z, p.id);
    p.edits = (p.edits || 0) + 1;
    if (piece.type === RAMP) {
      // A re-aimed ramp attaches differently: anything that only hung on its
      // old edges falls, and so does the ramp if nothing holds it now.
      this.liftOutOf(piece);
      const falling = this.world.unsupportedAfter([{ sockets: oldSockets }, { sockets: piece.sockets }]);
      for (const f of falling) this.destroyStructure(f, 'piece');
    }
    return true;
  },
};

// The live world a match plays in (and the copy each client keeps): terrain,
// collision, every build piece and prop, and the bookkeeping that lets a
// structure fall down when the piece holding it up is destroyed.

import { CollisionGrid, OWNER_PIECE, OWNER_PROP } from './collision.js';
import { pieceColliders, pieceSlotKey, pieceSockets, isGrounded } from './pieces.js';
import { propColliders } from './props.js';

const MAX_SUPPORT_SEARCH = 6000;

export class World {
  /** `base` is a generated world (see worldgen.js); pieces and props are copied. */
  constructor(base, { withProps = true } = {}) {
    this.base = base;
    this.seed = base.seed;
    this.terrain = base.terrain;
    this.grid = new CollisionGrid(this.terrain);
    this.pieces = new Map();
    this.slots = new Map();
    this.sockets = new Map();
    this.props = [];
    this.nextPieceId = base.pieces.length + 1;
    for (const p of base.pieces) this.addPiece({ ...p });
    if (withProps) for (const p of base.props) this.addProp({ ...p });
  }

  /* -------------------------------------------------------------- pieces */

  addPiece(p) {
    p.alive = true;
    if (p.damage === undefined) p.damage = 0;
    this.pieces.set(p.id, p);
    this.slots.set(pieceSlotKey(p), p);
    this.linkSockets(p);
    p.grounded = isGrounded(p, this.terrain);
    p.cols = pieceColliders(p);
    for (const c of p.cols) this.grid.add(c);
    return p;
  }

  removePiece(p) {
    if (!p.alive) return;
    p.alive = false;
    this.pieces.delete(p.id);
    if (this.slots.get(pieceSlotKey(p)) === p) this.slots.delete(pieceSlotKey(p));
    this.unlinkSockets(p);
    for (const c of p.cols) this.grid.remove(c);
    p.cols = [];
  }

  /** Re-shapes a piece after an edit (a wall's tiles, or a ramp's direction). */
  reshapePiece(p, { edit = p.edit, rot = p.rot } = {}) {
    for (const c of p.cols) this.grid.remove(c);
    this.unlinkSockets(p);
    if (this.slots.get(pieceSlotKey(p)) === p) this.slots.delete(pieceSlotKey(p));
    p.edit = edit;
    p.rot = rot;
    this.slots.set(pieceSlotKey(p), p);
    this.linkSockets(p);
    p.grounded = isGrounded(p, this.terrain);
    p.cols = pieceColliders(p);
    for (const c of p.cols) this.grid.add(c);
  }

  linkSockets(p) {
    p.sockets = pieceSockets(p);
    for (const key of p.sockets) {
      let list = this.sockets.get(key);
      if (!list) { list = []; this.sockets.set(key, list); }
      list.push(p);
    }
  }

  unlinkSockets(p) {
    for (const key of p.sockets || []) {
      const list = this.sockets.get(key);
      if (!list) continue;
      const at = list.indexOf(p);
      if (at >= 0) { list[at] = list[list.length - 1]; list.pop(); }
      if (!list.length) this.sockets.delete(key);
    }
  }

  neighbours(p, out = []) {
    out.length = 0;
    for (const key of p.sockets) {
      const list = this.sockets.get(key);
      if (!list) continue;
      for (const q of list) if (q !== p && q.alive && !out.includes(q)) out.push(q);
    }
    return out;
  }

  /** Would a piece placed here be held up by the ground or an existing piece? */
  wouldBeSupported(p) {
    if (isGrounded(p, this.terrain)) return true;
    for (const key of pieceSockets(p)) {
      const list = this.sockets.get(key);
      if (list) for (const q of list) if (q.alive) return true;
    }
    return false;
  }

  /**
   * Pieces that lost their connection to the ground after `removed` went away.
   * Every neighbour's connected component is searched once; a component with no
   * grounded piece in it comes down. Returns the pieces to collapse.
   */
  unsupportedAfter(removed) {
    const supported = new Set();
    const falling = new Set();
    const starts = [];
    for (const p of removed) {
      for (const key of p.sockets || pieceSockets(p)) {
        const list = this.sockets.get(key);
        if (list) for (const q of list) if (q.alive && !starts.includes(q)) starts.push(q);
      }
    }
    const nb = [];
    for (const start of starts) {
      if (supported.has(start) || falling.has(start)) continue;
      // Search the start's component until something grounded — or already
      // known to be supported — turns up. A component that runs out without
      // finding one is entirely unsupported and comes down together.
      const visited = new Set([start]);
      const queue = [start];
      let grounded = false;
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i];
        if (q.grounded || supported.has(q) || queue.length > MAX_SUPPORT_SEARCH) { grounded = true; break; }
        for (const n of this.neighbours(q, nb)) {
          if (!visited.has(n)) { visited.add(n); queue.push(n); }
        }
      }
      for (const q of queue) (grounded ? supported : falling).add(q);
    }
    return [...falling];
  }

  /* --------------------------------------------------------------- props */

  addProp(p) {
    p.alive = true;
    this.props[p.id] = p;
    p.cols = propColliders(p);
    for (const c of p.cols) { c.kind = OWNER_PROP; c.ref = p.id; this.grid.add(c); }
    return p;
  }

  removeProp(p) {
    if (!p.alive) return;
    p.alive = false;
    for (const c of p.cols) this.grid.remove(c);
    p.cols = [];
  }

  ownerOf(collider) {
    if (!collider) return null;
    if (collider.kind === OWNER_PIECE) return this.pieces.get(collider.ref) || null;
    if (collider.kind === OWNER_PROP) return this.props[collider.ref] || null;
    return null;
  }
}

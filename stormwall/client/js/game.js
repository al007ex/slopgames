// The client's view of a match. Its own player is predicted: every input is
// simulated locally the moment it is made, sent to the server, and kept until
// the server acknowledges it. Each snapshot resets to the server's answer and
// replays whatever it has not seen yet, and any resulting jump is eased out on
// screen instead of snapping. Everyone else is drawn 100 ms in the past,
// interpolated between the snapshots on either side of that moment.

import { World } from '#shared/world.js';
import { stepMovement, createMoveState, copyMoveState, MODE_WALK } from '#shared/movement.js';
import { decodeSnapshot } from '#shared/protocol.js';
import { TICK_MS } from '#shared/constants.js';

export const INTERP_TICKS = 3;

export class ClientGame {
  constructor(base) {
    this.base = base;
    this.world = new World(base);
    this.worldMatch = null;
    this.reset();
    this.blockReaders = {};
    this.blockHandlers = {};
  }

  reset() {
    this.me = null;
    this.seq = 0;
    this.pending = [];
    this.players = new Map();
    this.roster = new Map();
    this.offsets = [];
    this.renderTick = 0;
    this.lastSnapTick = 0;
    this.correction = { x: 0, y: 0, z: 0 };
    this.prevMove = createMoveState();
  }

  /** Registers a decoder and a handler for one kind of snapshot block. */
  onBlock(tag, read, handle) { this.blockReaders[tag] = read; this.blockHandlers[tag] = handle; }

  /** A fresh copy of the island for a new match; returns true if it was replaced. */
  freshWorld(matchId) {
    if (this.worldMatch === matchId) return false;
    if (this.worldMatch !== null) this.world = new World(this.base);
    this.worldMatch = matchId;
    return true;
  }

  /** Applies replicated piece records; `hooks` updates whatever draws them. */
  applyPieces(list, hooks) {
    const world = this.world;
    for (const rec of list) {
      const existing = world.pieces.get(rec.id);
      if (!rec.alive) {
        if (existing) { world.removePiece(existing); hooks.removed(existing); }
        continue;
      }
      if (existing) {
        if (existing.edit !== rec.edit || existing.rot !== rec.rot) world.reshapePiece(existing, { edit: rec.edit, rot: rec.rot });
        existing.damage = rec.damage; existing.start = rec.start; existing.team = rec.team;
        hooks.changed(existing);
      } else {
        const p = world.addPiece({ ...rec });
        hooks.added(p);
      }
    }
  }

  applyProps(list, hooks) {
    for (const rec of list) {
      const p = this.world.props[rec.id];
      if (!p) continue;
      if (!rec.alive) { if (p.alive) { this.world.removeProp(p); hooks.removed(p); } continue; }
      p.hp = rec.hp;
      hooks.changed(p);
    }
  }

  start(msg) {
    this.reset();
    this.matchId = msg.id;
    this.mode = msg.mode;
    this.me = { id: msg.you, team: msg.team, move: createMoveState(), hp: 100, shield: 0 };
    for (const p of msg.roster) this.roster.set(p.id, p);
    this.renderTick = msg.tick - INTERP_TICKS;
    this.started = false;
  }

  /* ---------------------------------------------------------- clock */

  noteTick(tick, now) {
    // Server tick ≈ now / TICK_MS + offset. Late packets give smaller offsets,
    // so the best recent one is the truest.
    const offset = tick - now / TICK_MS;
    this.offsets.push({ offset, at: now });
    while (this.offsets.length && now - this.offsets[0].at > 2000) this.offsets.shift();
    let best = -Infinity;
    for (const o of this.offsets) if (o.offset > best) best = o.offset;
    this.clockOffset = best;
  }

  serverTickNow(now) { return now / TICK_MS + (this.clockOffset ?? 0); }

  /** Advances the render clock at real speed, eased gently towards its target. */
  advanceRender(now, dt) {
    const target = this.serverTickNow(now) - INTERP_TICKS;
    let next = this.renderTick + dt / TICK_MS;
    const error = target - next;
    if (Math.abs(error) > 10) next = target;
    else next += Math.max(-0.08, Math.min(0.08, error * 0.1)) * (dt / TICK_MS);
    this.renderTick = next;
  }

  /* ----------------------------------------------------- prediction */

  /** Runs one local tick of the player's own movement and returns the input to send. */
  predict(input) {
    input.seq = ++this.seq;
    input.viewTick = this.renderTick;
    copyMoveState(this.me.move, this.prevMove);
    this.pending.push({ seq: input.seq, mx: input.mx, mz: input.mz, yaw: input.yaw, pitch: input.pitch, buttons: input.buttons });
    if (this.pending.length > 120) this.pending.shift();
    stepMovement(this.me.move, input, this.world);
    return input;
  }

  onSnapshot(data, now) {
    const snap = decodeSnapshot(data, this.blockReaders);
    if (!snap) return null;
    this.noteTick(snap.tick, now);
    this.lastSnapTick = snap.tick;
    if (snap.self && this.me) this.reconcile(snap);
    for (const p of snap.players) {
      let rp = this.players.get(p.id);
      if (!rp) { rp = { id: p.id, samples: [] }; this.players.set(p.id, rp); }
      p.tick = snap.tick;
      rp.samples.push(p);
      if (rp.samples.length > 40) rp.samples.shift();
      rp.last = snap.tick;
    }
    for (const [tag, block] of Object.entries(snap.blocks)) this.blockHandlers[tag]?.(block, snap);
    this.started = true;
    return snap;
  }

  reconcile(snap) {
    const me = this.me;
    const s = snap.self;
    me.hp = s.hp; me.shield = s.shield;
    while (this.pending.length && this.pending[0].seq <= snap.ack) this.pending.shift();
    const before = { x: me.move.x, y: me.move.y, z: me.move.z };
    const m = me.move;
    m.x = s.x; m.y = s.y; m.z = s.z; m.vx = s.vx; m.vy = s.vy; m.vz = s.vz;
    m.mode = s.mode; m.ground = s.ground; m.crouch = s.crouch; m.peakY = s.peakY;
    m.jumpLatch = s.jumpLatch; m.crouchLatch = s.crouchLatch;
    for (const input of this.pending) stepMovement(m, input, this.world);
    const dx = m.x - before.x, dy = m.y - before.y, dz = m.z - before.z;
    if (dx * dx + dy * dy + dz * dz > 9 || m.mode !== MODE_WALK) {
      // Big jumps (a respawn, the blimp) snap; small ones are eased out.
      this.correction.x = this.correction.y = this.correction.z = 0;
      copyMoveState(m, this.prevMove);
    } else {
      this.prevMove.x += dx; this.prevMove.y += dy; this.prevMove.z += dz;
      this.correction.x -= dx; this.correction.y -= dy; this.correction.z -= dz;
    }
    this.lastCorrection = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** The local player's position to draw: between the last two predicted ticks, plus easing. */
  localRenderPos(alpha, dt, out = {}) {
    const a = this.prevMove, b = this.me.move;
    const k = Math.exp(-dt * 14);
    this.correction.x *= k; this.correction.y *= k; this.correction.z *= k;
    out.x = a.x + (b.x - a.x) * alpha + this.correction.x;
    out.y = a.y + (b.y - a.y) * alpha + this.correction.y;
    out.z = a.z + (b.z - a.z) * alpha + this.correction.z;
    return out;
  }

  /* --------------------------------------------------- interpolation */

  /** Everyone else, at the render tick. Drops players who left our area. */
  remoteStates(out = []) {
    out.length = 0;
    const t = this.renderTick;
    for (const [id, rp] of this.players) {
      if (this.lastSnapTick - rp.last > 45) { this.players.delete(id); continue; }
      const s = rp.samples;
      if (!s.length) continue;
      let a = s[0], b = null;
      for (let i = 0; i < s.length; i++) {
        if (s[i].tick <= t) a = s[i];
        else { b = s[i]; break; }
      }
      if (!b || a.tick > t) { out.push(rp.state = { ...a, id }); continue; }
      const f = (t - a.tick) / (b.tick - a.tick);
      let dyaw = b.yaw - a.yaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      rp.state = {
        ...b, id,
        x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f,
        yaw: a.yaw + dyaw * f, pitch: a.pitch + (b.pitch - a.pitch) * f,
        speed: Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2) / ((b.tick - a.tick) * TICK_MS / 1000),
      };
      out.push(rp.state);
    }
    return out;
  }
}

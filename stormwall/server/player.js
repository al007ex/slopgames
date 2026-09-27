// A player in a match — human or bot. Movement state is the shared controller's;
// everything else (health, inventory, what they are doing) is server-side.

import { createMoveState } from '../shared/movement.js';
import { MAX_HP } from '../shared/constants.js';

const HISTORY = 32;   // ticks of position history kept for lag compensation (~1 s)

export function createPlayer({ id, name, team = id, bot = false, outfit = 0, glider = 0, pickaxe = 0, account = null }) {
  return {
    id, name, team, bot, outfit, glider, pickaxe, account,
    conn: null,
    move: createMoveState(),
    yaw: 0, pitch: 0, buttons: 0, mx: 0, mz: 0, viewTick: 0,
    inputs: [], lastSeq: 0, lastInputTick: 0, inputBudget: 0,
    hp: MAX_HP, shield: 0, alive: true, dbno: false, dbnoHp: 0,
    flags: 0, heldKind: 0, heldRarity: 0,
    pendingBuild: [], pendingEdits: [],
    placement: 0, kills: 0, damageDealt: 0, eliminatedBy: 0,
    history: new Float32Array(HISTORY * 4),   // tick, x, y, z per slot
    bus: false,
  };
}

/** Records where a player was at the end of a tick. */
export function recordHistory(p, tick) {
  const h = p.history;
  const i = (tick % HISTORY) * 4;
  h[i] = tick; h[i + 1] = p.move.x; h[i + 2] = p.move.y; h[i + 3] = p.move.z;
}

/** Where the player was at a (fractional) past tick, interpolated from history. */
export function positionAt(p, tick, out) {
  const h = p.history;
  const t0 = Math.floor(tick);
  const a = (t0 % HISTORY) * 4;
  const b = ((t0 + 1) % HISTORY) * 4;
  if (h[a] !== t0 || h[b] !== t0 + 1) {
    out.x = p.move.x; out.y = p.move.y; out.z = p.move.z;
    return false;
  }
  const f = tick - t0;
  out.x = h[a + 1] + (h[b + 1] - h[a + 1]) * f;
  out.y = h[a + 2] + (h[b + 2] - h[a + 2]) * f;
  out.z = h[a + 3] + (h[b + 3] - h[a + 3]) * f;
  return true;
}

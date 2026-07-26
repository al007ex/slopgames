import { GameMode, TILE } from './constants.js';
import { BLOCKS_MOVE, Tile, type InputCmd } from './types.js';
import { dist2, type Ent, type Sim } from './sim.js';

export interface BotBrain {
  slot: number;
  target: number;
  retargetT: number;
  path: number[]; // tile indices, reversed (next waypoint last)
  pathT: number;
  goalTile: number;
  strafe: number;
  strafeT: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  jitterA: number;
  jitterT: number;
  fireT: number;
  /** seconds since we last had a visible target */
  blindT: number;
  seq: number;
}

export function makeBrain(slot: number): BotBrain {
  return {
    slot,
    target: -1,
    retargetT: 0,
    path: [],
    pathT: 0,
    goalTile: -1,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeT: 0,
    stuckT: 0,
    lastX: 0,
    lastY: 0,
    jitterA: 0,
    jitterT: 0,
    fireT: 0,
    blindT: 0,
    seq: 0,
  };
}

const WALKABLE = (t: Tile) => !BLOCKS_MOVE.has(t);

/** Breadth-first path over the tile grid. Returns tile indices from goal back to start. */
function bfsPath(sim: Sim, sx: number, sy: number, gx: number, gy: number): number[] {
  const w = sim.map.w;
  const h = sim.map.h;
  if (gx < 0 || gy < 0 || gx >= w || gy >= h) return [];
  const start = sy * w + sx;
  const goal = gy * w + gx;
  if (start === goal) return [];
  if (!WALKABLE(sim.map.tiles[goal] as Tile)) {
    // walk outward to the nearest open tile near the goal
    let found = -1;
    for (let r = 1; r <= 4 && found < 0; r++) {
      for (let dy = -r; dy <= r && found < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (WALKABLE(sim.map.tiles[ny * w + nx] as Tile)) {
            found = ny * w + nx;
            break;
          }
        }
      }
    }
    if (found < 0) return [];
    return bfsPath(sim, sx, sy, found % w, (found / w) | 0);
  }

  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  queue[qt++] = start;
  seen[start] = 1;
  let reached = false;

  while (qh < qt) {
    const cur = queue[qh++];
    if (cur === goal) {
      reached = true;
      break;
    }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !WALKABLE(sim.map.tiles[ni] as Tile)) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue[qt++] = ni;
    }
  }
  if (!reached) return [];

  const path: number[] = [];
  let cur = goal;
  while (cur !== start && cur >= 0) {
    path.push(cur);
    cur = prev[cur];
  }
  return path;
}

function tileIdx(sim: Sim, wx: number, wy: number) {
  const tx = Math.max(0, Math.min(sim.map.w - 1, Math.floor(wx / TILE)));
  const ty = Math.max(0, Math.min(sim.map.h - 1, Math.floor(wy / TILE)));
  return ty * sim.map.w + tx;
}

/** Steer around walls when we do not have a path (or the next waypoint is blocked). */
function avoid(sim: Sim, p: Ent, wantA: number): number {
  let bestA = wantA;
  let bestScore = -1e9;
  for (let i = 0; i < 12; i++) {
    const a = wantA + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.35;
    let free = 0;
    for (let d = 6; d <= 30; d += 6) {
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (BLOCKS_MOVE.has(sim.tileAt(x, y))) break;
      free = d;
    }
    const align = Math.cos(a - wantA);
    const score = free * 0.7 + align * 22;
    if (score > bestScore) {
      bestScore = score;
      bestA = a;
    }
  }
  return bestA;
}

/** Where the poison-safe zone pushes us in Showdown. */
function safeZonePull(sim: Sim, p: Ent): { x: number; y: number } | null {
  if (sim.mode !== GameMode.Showdown || sim.poison < 0) return null;
  const w = sim.map.w * TILE;
  const h = sim.map.h * TILE;
  const pad = sim.poison + 26;
  if (p.x > pad && p.y > pad && p.x < w - pad && p.y < h - pad) return null;
  return { x: Math.max(pad, Math.min(w - pad, p.x)), y: Math.max(pad, Math.min(h - pad, p.y)) };
}

export function botThink(sim: Sim, p: Ent, b: BotBrain, dt: number): InputCmd {
  const diff = p.difficulty;
  const cmd: InputCmd = { seq: ++b.seq, mx: 0, my: 0, ax: Math.cos(p.aim), ay: Math.sin(p.aim), ad: 1, shoot: false, useSuper: false };
  if (!p.alive || sim.phase !== 'live') return cmd;

  /* ------------------------------ targeting ----------------------------- */
  b.retargetT -= dt;
  if (b.retargetT <= 0 || b.target < 0 || !sim.players[b.target]?.alive) {
    b.retargetT = 0.25 + (1 - diff) * 0.45;
    let best = -1;
    let bestScore = -1e9;
    for (const q of sim.players) {
      if (!q.alive || q.team === p.team || q.slot === p.slot) continue;
      if (q.invulnT > 0) continue; // don't waste shots on spawn protection
      const d = Math.sqrt(dist2(q.x, q.y, p.x, p.y));
      const hiddenInBush = q.inBush && q.exposeT <= 0 && d > 40;
      if (hiddenInBush) continue;
      if (d > 300) continue;
      const los = sim.lineOfSight(p.x, p.y, q.x, q.y);
      let score = 260 - d;
      if (los) score += 90;
      if (q.hp < q.maxHp * 0.4) score += 60;
      if (sim.mode === GameMode.GemGrab && q.gems > 0) score += 30 + q.gems * 10;
      if (score > bestScore) {
        bestScore = score;
        best = q.slot;
      }
    }
    b.target = best;
  }

  const target = b.target >= 0 ? sim.players[b.target] : null;
  const tDist = target ? Math.sqrt(dist2(target.x, target.y, p.x, p.y)) : Infinity;
  const tLos = target ? sim.lineOfSight(p.x, p.y, target.x, target.y) : false;

  /* ------------------------------ objective ----------------------------- */
  let goal: { x: number; y: number } | null = null;
  let engaging = false;
  const lowHp = p.hp < p.maxHp * 0.4;
  const isLobber = p.def.attack.kind === 'lob';
  /** set when the current objective is a crate we should shoot open */
  let crateGoal: { x: number; y: number } | null = null;

  const zone = safeZonePull(sim, p);
  if (zone) {
    goal = zone;
  } else if (sim.mode === GameMode.GemGrab) {
    const myTeamGems = sim.players.filter((q) => q.team === p.team).reduce((s, q) => s + q.gems, 0);
    let gem: { x: number; y: number } | null = null;
    let gd = 1e9;
    for (const pk of sim.pickups) {
      if (pk.kind !== 'gem') continue;
      const d = dist2(pk.x, pk.y, p.x, p.y);
      if (d < gd) {
        gd = d;
        gem = pk;
      }
    }
    const holdingLots = p.gems >= 4;
    if (holdingLots && (lowHp || myTeamGems >= 10)) {
      // fall back toward our own half and stall out the countdown
      const own = sim.map.spawns.find((s) => s.team === p.team)!;
      goal = { x: own.x * TILE + TILE / 2, y: own.y * TILE + TILE / 2 };
    } else if (gem && Math.sqrt(gd) < 220) {
      goal = gem;
    } else if (sim.map.gemSpawn) {
      goal = { x: sim.map.gemSpawn.x * TILE + TILE / 2, y: sim.map.gemSpawn.y * TILE + TILE / 2 };
    }
    if (target && tDist < p.def.aiRange * 1.5) engaging = true;
  } else if (sim.mode === GameMode.Showdown) {
    if (lowHp && target && tDist < 120) {
      goal = { x: p.x - (target.x - p.x), y: p.y - (target.y - p.y) };
    } else if (target && tDist < p.def.aiRange * 2) {
      engaging = true;
    } else {
      // hunt power cubes, then crates to break
      let cube: { x: number; y: number } | null = null;
      let cd = 1e9;
      for (const pk of sim.pickups) {
        if (pk.kind !== 'cube') continue;
        const d = dist2(pk.x, pk.y, p.x, p.y);
        if (d < cd) {
          cd = d;
          cube = pk;
        }
      }
      if (cube && Math.sqrt(cd) < 190) {
        goal = cube;
      } else {
        crateGoal = nearestCrate(sim, p);
        goal = crateGoal ?? { x: (sim.map.w * TILE) / 2, y: (sim.map.h * TILE) / 2 };
      }
    }
  } else {
    engaging = !!target;
    if (!target) goal = { x: (sim.map.w * TILE) / 2, y: (sim.map.h * TILE) / 2 };
    if (lowHp && target && tDist < 90) {
      goal = { x: p.x - (target.x - p.x), y: p.y - (target.y - p.y) };
      engaging = false;
    }
  }

  // Anti-stalemate: after a long spell with nobody in sight, push toward the
  // nearest living enemy instead of milling around the middle of the map.
  b.blindT = target ? 0 : b.blindT + dt;
  if (!target && b.blindT > 4) {
    let hunt: Ent | null = null;
    let hd = 1e9;
    for (const q of sim.players) {
      if (!q.alive || q.team === p.team || q.slot === p.slot) continue;
      const d = dist2(q.x, q.y, p.x, p.y);
      if (d < hd) {
        hd = d;
        hunt = q;
      }
    }
    if (hunt && (sim.mode !== GameMode.GemGrab || b.blindT > 9)) goal = { x: hunt.x, y: hunt.y };
  }

  /* ------------------------------- combat ------------------------------- */
  let moveA: number | null = null;

  // Only steer freehand when we can actually reach the target with a shot.
  // Otherwise fall through to pathfinding, or we orbit walls forever.
  const canReach = !!target && (tLos || isLobber || tDist < 40);
  if (engaging && target && !canReach) {
    goal = { x: target.x, y: target.y };
    engaging = false;
  }

  if (engaging && target) {
    const want = p.def.aiRange;
    const toT = Math.atan2(target.y - p.y, target.x - p.x);
    b.strafeT -= dt;
    if (b.strafeT <= 0) {
      b.strafeT = 0.7 + Math.random() * 1.1;
      if (Math.random() < 0.45) b.strafe *= -1;
    }
    if (tDist > want * 1.15 || (!tLos && !isLobber)) {
      moveA = toT + b.strafe * 0.25;
    } else if (tDist < want * 0.62) {
      moveA = toT + Math.PI + b.strafe * 0.3;
    } else {
      moveA = toT + (Math.PI / 2) * b.strafe;
    }
  } else if (goal) {
    // path along the tile grid toward the objective
    const gi = tileIdx(sim, goal.x, goal.y);
    b.pathT -= dt;
    if (b.pathT <= 0 || gi !== b.goalTile || b.path.length === 0) {
      b.pathT = 0.45;
      b.goalTile = gi;
      b.path = bfsPath(sim, Math.floor(p.x / TILE), Math.floor(p.y / TILE), gi % sim.map.w, (gi / sim.map.w) | 0);
    }
    while (b.path.length) {
      const nt = b.path[b.path.length - 1];
      const nx = (nt % sim.map.w) * TILE + TILE / 2;
      const ny = (((nt / sim.map.w) | 0) as number) * TILE + TILE / 2;
      if (dist2(nx, ny, p.x, p.y) < 100) b.path.pop();
      else {
        moveA = Math.atan2(ny - p.y, nx - p.x);
        break;
      }
    }
    if (moveA === null) moveA = Math.atan2(goal.y - p.y, goal.x - p.x);
  }

  /* -------------------------------- dodge ------------------------------- */
  if (diff > 0.4) {
    for (const pr of sim.projs) {
      if (pr.team === p.team) continue;
      const d = Math.sqrt(dist2(pr.x, pr.y, p.x, p.y));
      if (d > 58) continue;
      const toMe = Math.atan2(p.y - pr.y, p.x - pr.x);
      const dirA = Math.atan2(pr.vy, pr.vx);
      let diffA = Math.abs(((toMe - dirA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diffA < 0.34) {
        moveA = dirA + (Math.PI / 2) * b.strafe;
        break;
      }
    }
  }

  /* -------------------------------- stuck ------------------------------- */
  const movedSq = dist2(p.x, p.y, b.lastX, b.lastY);
  b.lastX = p.x;
  b.lastY = p.y;
  if (movedSq < 0.6 && moveA !== null) {
    b.stuckT += dt;
    if (b.stuckT > 0.45) {
      b.jitterA = Math.random() * Math.PI * 2;
      b.jitterT = 0.55;
      b.stuckT = 0;
      b.path = [];
    }
  } else {
    b.stuckT = 0;
  }
  if (b.jitterT > 0) {
    b.jitterT -= dt;
    moveA = b.jitterA;
  }

  if (moveA !== null) {
    const a = avoid(sim, p, moveA);
    cmd.mx = Math.cos(a);
    cmd.my = Math.sin(a);
  }

  /* --------------------------------- aim -------------------------------- */
  if (target) {
    const atk = p.def.attack;
    const travel = atk.speed > 0 ? Math.min(tDist / atk.speed, 0.9) : 0;
    const lead = 0.35 + diff * 0.75;
    const px = target.x + target.vx * travel * lead;
    const py = target.y + target.vy * travel * lead;
    const err = (1 - diff) * 0.34 * (Math.random() - 0.5) * 2;
    const a = Math.atan2(py - p.y, px - p.x) + err;
    cmd.ax = Math.cos(a);
    cmd.ay = Math.sin(a);
    cmd.ad = Math.max(0.15, Math.min(1, tDist / Math.max(1, atk.range)));

    const canHit = isLobber || tLos;
    const inRange = tDist < atk.range * 0.92;
    b.fireT -= dt;
    if (canHit && inRange && p.ammo >= 1 && b.fireT <= 0) {
      cmd.shoot = true;
      b.fireT = (1 - diff) * 0.22;
    }

    // supers
    if (p.superCharge >= 100) {
      const s = p.def.super;
      const superRange = s.range * 0.9;
      let use = false;
      if (s.kind === 'heal') {
        const hurt = sim.players.filter((q) => q.alive && q.team === p.team && q.hp < q.maxHp * 0.65).length;
        use = hurt > 0 && (p.hp < p.maxHp * 0.7 || hurt > 1);
      } else if (s.kind === 'summonBear' || s.kind === 'summonTurret' || s.kind === 'summonHealTurret') {
        use = tDist < 200;
      } else if (s.kind === 'dash' || s.kind === 'leap' || s.kind === 'poisonLeap') {
        use = tDist < superRange && (tDist > 30 || lowHp);
        if (lowHp && (s.kind === 'leap' || s.kind === 'poisonLeap')) {
          // escape in the opposite direction
          const away = Math.atan2(p.y - target.y, p.x - target.x);
          cmd.ax = Math.cos(away);
          cmd.ay = Math.sin(away);
          cmd.ad = 1;
        }
      } else if (s.kind === 'mines' || s.kind === 'spikeField' || s.kind === 'gravity') {
        use = tDist < superRange;
      } else {
        use = tDist < superRange && (isLobber || tLos);
      }
      if (use && Math.random() < 0.06 + diff * 0.2) cmd.useSuper = true;
    }
  } else if (moveA !== null) {
    cmd.ax = cmd.mx;
    cmd.ay = cmd.my;
    // farm power cubes: once a crate is in reach, turn and shoot it open
    if (crateGoal && p.ammo >= 1) {
      const cd = Math.sqrt(dist2(crateGoal.x, crateGoal.y, p.x, p.y));
      if (cd < p.def.attack.range * 0.8) {
        const a = Math.atan2(crateGoal.y - p.y, crateGoal.x - p.x);
        cmd.ax = Math.cos(a);
        cmd.ay = Math.sin(a);
        cmd.ad = Math.max(0.15, Math.min(1, cd / Math.max(1, p.def.attack.range)));
        cmd.shoot = true;
      }
    } else if (p.ammo >= 2) {
      const fx = p.x + cmd.mx * 20;
      const fy = p.y + cmd.my * 20;
      if (sim.tileAt(fx, fy) === Tile.Crate) cmd.shoot = true;
    }
  }

  return cmd;
}

function nearestCrate(sim: Sim, p: Ent): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = 1e9;
  const w = sim.map.w;
  for (let i = 0; i < sim.map.tiles.length; i++) {
    if (sim.map.tiles[i] !== Tile.Crate) continue;
    const x = (i % w) * TILE + TILE / 2;
    const y = ((i / w) | 0) * TILE + TILE / 2;
    const d = dist2(x, y, p.x, p.y);
    if (d < bd) {
      bd = d;
      best = { x, y };
    }
  }
  return best;
}

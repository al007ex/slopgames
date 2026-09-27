// A match from start to finish:
//
//   pregame  everyone waits on a small island off the coast for a minute:
//            harvest, build, pick up throwaway guns — nothing does damage,
//            and it all vanishes at launch
//   bus      the Drop Blimp crosses the island on a random straight line at a
//            fixed height and speed; jump whenever you like, or be dropped at
//            the far end
//   playing  land, loot, fight, outrun the storm
//   ended    one team left: the big screen, then everyone back to the lobby

import { MAX_PLAYERS, TICK_HZ, WORLD_CENTER, MAT_CAP } from '../shared/constants.js';
import { MODE_BUS, MODE_SKYDIVE, MODE_WALK, MODE_DEAD, BTN_JUMP } from '../shared/movement.js';
import { WEAPONS } from '../shared/items.js';
import { PREGAME } from '../shared/worldgen.js';

export const PREGAME_SECONDS = 60;
export const BUS_ALTITUDE = 720;
export const BUS_SPEED = 72;
export const BUS_DOORS_SECONDS = 2;
export const BUS_RADIUS = 2750;
export const RESULTS_SECONDS = 15;
export const TEAM_SIZES = { solo: 1, duos: 2, squads: 4 };

const PREGAME_GUNS = [['ar', 0], ['ar', 1], ['pump', 1], ['smg', 0], ['pistol', 0], ['tactical', 0], ['burst', 1], ['sniper', 2], ['rocket', 3]];

export const flowMethods = {
  initFlow({ pregameSeconds = PREGAME_SECONDS, fillTo = MAX_PLAYERS } = {}) {
    this.teamSize = TEAM_SIZES[this.mode] || 1;
    this.fillTo = fillTo;
    this.phase = 'pregame';
    this.phaseTick = this.tick;
    this.pregameTicks = Math.round(pregameSeconds * TICK_HZ);
    this.noDamage = true;
    this.joinOrder = 0;
    this.placements = [];
    this.teamsOut = new Set();
    this.pregameItems = new Set();
    this.spawnPregameLoot();
  },

  spawnPregameLoot() {
    for (const spot of this.base.pregameSpots) {
      const [key, rarity] = this.rng.pick(PREGAME_GUNS);
      this.pregameItems.add(this.dropItem({ key, rarity, mag: WEAPONS[key].mag }, spot.x, spot.y, spot.z));
      this.pregameItems.add(this.dropItem({ key: WEAPONS[key].ammo, count: 60 }, spot.x + 0.8, spot.y, spot.z));
    }
  },

  /** Next team number for a joining player, filling teams in order. */
  nextTeam() {
    const slot = this.joinOrder++;
    return Math.floor(slot / this.teamSize) + 1;
  },

  /** A human (or test bot) joining during the pre-game: onto the island. */
  joinPregame(p) {
    const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(8, PREGAME.r - 25);
    this.placeOnGround(p, PREGAME.x + Math.cos(a) * r, PREGAME.z + Math.sin(a) * r);
    p.yaw = this.rng.range(-Math.PI, Math.PI);
  },

  secondsLeft() {
    if (this.phase === 'pregame') return Math.max(0, (this.pregameTicks - (this.tick - this.phaseTick)) / TICK_HZ);
    return 0;
  },

  stageFlow() {
    switch (this.phase) {
      case 'pregame':
        if (this.tick - this.phaseTick >= this.pregameTicks) this.launch();
        break;
      case 'bus': this.stepBus(); break;
      case 'playing': this.checkVictory(); break;
      case 'ended':
        if (this.tick - this.phaseTick >= RESULTS_SECONDS * TICK_HZ) this.finished = true;
        break;
      default:
    }
  },

  /** Out of the pre-game and onto the blimp. */
  launch() {
    // Top up to a full lobby with bots, in teams.
    while (this.players.size < this.fillTo) this.addBot?.();
    // Everything from the pre-game island vanishes.
    for (const it of [...this.items.values()]) {
      if (this.pregameItems.has(it) || Math.hypot(it.x - PREGAME.x, it.z - PREGAME.z) < PREGAME.r + 40) this.removeItem(it);
    }
    for (const piece of [...this.world.pieces.values()]) {
      if (piece.team !== 0 && Math.hypot((piece.cx + 0.5) * 5.12 - PREGAME.x, (piece.cz + 0.5) * 5.12 - PREGAME.z) < PREGAME.r + 60) {
        this.world.removePiece(piece);
        this.touch('piece', piece);
      }
    }
    this.projectiles.length = 0;
    for (const p of this.players.values()) {
      p.inv = [null, null, null, null, null];
      p.ammo = { light: 0, medium: 0, heavy: 0, rockets: 0 };
      p.mats = [0, 0, 0];
      p.held = 0; p.buildMode = false; p.using = null; p.reloadEnd = 0;
      p.hp = 100; p.shield = 0; p.alive = true;
      p.move.mode = MODE_BUS; p.move.vx = p.move.vy = p.move.vz = 0;
      p.invDirty = true;
    }
    this.noDamage = false;
    this.planRoute();
    this.phase = 'bus';
    this.phaseTick = this.tick;
    this.startStorm(this.tick);
    this.teamsAliveAtStart = this.aliveTeams().size;
    this.broadcastRoster();
    this.broadcastPhase();
  },

  planRoute() {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(-800, 800);
    const ux = Math.cos(a), uz = Math.sin(a);
    const cx = WORLD_CENTER - uz * d, cz = WORLD_CENTER + ux * d;
    const half = Math.sqrt(BUS_RADIUS * BUS_RADIUS - d * d);
    this.route = {
      x0: cx - ux * half, z0: cz - uz * half, x1: cx + ux * half, z1: cz + uz * half,
      y: BUS_ALTITUDE, speed: BUS_SPEED, start: this.tick, length: half * 2,
    };
  },

  busPosition(tick = this.tick, out = {}) {
    const r = this.route;
    const t = Math.min(1, ((tick - r.start) / TICK_HZ) * r.speed / r.length);
    out.x = r.x0 + (r.x1 - r.x0) * t; out.z = r.z0 + (r.z1 - r.z0) * t; out.y = r.y;
    out.t = t;
    return out;
  },

  stepBus() {
    const bus = this.busPosition();
    const doorsOpen = this.tick - this.phaseTick >= BUS_DOORS_SECONDS * TICK_HZ;
    let riding = 0;
    for (const p of this.players.values()) {
      if (p.move.mode !== MODE_BUS) continue;
      const wants = p.wantsJump || (p.buttons & BTN_JUMP);
      if ((doorsOpen && wants) || bus.t >= 1) { this.dropFromBus(p, bus); continue; }
      p.move.x = bus.x; p.move.y = bus.y; p.move.z = bus.z;
      riding++;
    }
    if (riding === 0 && bus.t > 0) {
      this.phase = 'playing';
      this.phaseTick = this.tick;
      this.broadcastPhase();
    }
  },

  dropFromBus(p, bus) {
    const r = this.route;
    const ux = (r.x1 - r.x0) / r.length, uz = (r.z1 - r.z0) / r.length;
    const m = p.move;
    m.mode = MODE_SKYDIVE;
    m.x = bus.x + this.rng.range(-2, 2); m.y = bus.y - 5; m.z = bus.z + this.rng.range(-2, 2);
    m.vx = ux * r.speed * 0.3; m.vz = uz * r.speed * 0.3; m.vy = -6;
    m.peakY = m.y;
    p.wantsJump = false;
    p.jumpedAt = this.tick;
    p.conn?.sendJson({ t: 'jumped' });
  },

  /* -------------------------------------------------------- winning */

  aliveTeams() {
    const teams = new Set();
    for (const p of this.players.values()) if (p.alive && !this.teamsOut.has(p.team)) teams.add(p.team);
    return teams;
  },

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  },

  /** A team with nobody left standing is out, and gets its placement. */
  teamCheck(team) {
    if (this.phase === 'pregame' || this.teamsOut.has(team)) return;
    for (const q of this.players.values()) if (q.team === team && q.alive && !q.dbno) return;
    // Anyone still knocked on a wiped team is finished off.
    for (const q of this.players.values()) if (q.team === team && q.alive) this.eliminate(q, { kind: 'bleed', source: q.knockedBy || null, finishing: true });
    const place = this.aliveTeams().size + 1;
    this.teamsOut.add(team);
    for (const q of this.players.values()) if (q.team === team && !q.placement) q.placement = place;
    this.placements.push({ team, place, tick: this.tick });
    this.onTeamOut?.(team, place);
  },

  checkVictory() {
    const teams = this.aliveTeams();
    if (teams.size > 1) return;
    const winner = teams.size ? [...teams][0] : this.placements.length ? this.placements[this.placements.length - 1].team : 0;
    for (const q of this.players.values()) if (q.team === winner) q.placement = 1;
    this.winner = winner;
    this.phase = 'ended';
    this.phaseTick = this.tick;
    this.endTick = this.tick;
    this.onMatchEnd?.();
    this.broadcastPhase();
  },

  /** Results for one player: where they placed and what they did. */
  resultsFor(p) {
    return {
      t: 'results', placement: p.placement, of: this.teamsAliveAtStart || this.aliveTeams().size, victory: p.placement === 1,
      kills: p.kills, damage: Math.round(p.damageDealt || 0), team: p.team, mode: this.mode,
      survived: Math.round(((p.diedAt || this.tick) - (this.route?.start || this.tick)) / TICK_HZ),
      killer: p.eliminatedBy ? this.players.get(p.eliminatedBy)?.name || '' : '',
    };
  },

  onTeamOut(team) {
    for (const q of this.players.values()) if (q.team === team && q.conn) q.conn.sendJson(this.resultsFor(q));
    this.aliveDirty = true;
  },

  onMatchEnd() {
    for (const q of this.players.values()) if (q.placement === 1 && q.conn) q.conn.sendJson(this.resultsFor(q));
  },

  phaseMessage() {
    return {
      t: 'phase', phase: this.phase, tick: this.tick, pregameEnds: this.phase === 'pregame' ? this.phaseTick + this.pregameTicks : 0,
      route: this.route || null, alive: this.aliveCount(), teams: this.aliveTeams().size, winner: this.winner || 0,
    };
  },

  broadcastPhase() {
    const msg = this.phaseMessage();
    for (const conn of this.conns) conn.sendJson(msg);
  },
};

export { MODE_WALK, MODE_DEAD, MAT_CAP };

// Duos and squads. Friendly fire is off. Taking lethal damage while a teammate
// is still up knocks you down instead of out: you crawl, you cannot shoot or
// build, and your 100 knocked health bleeds away over forty seconds. A
// teammate holding interact beside you for ten seconds brings you back at 30
// health. If everyone on a team is down, the last knock finishes them all.

import { MODE_WALK, MODE_DBNO, MODE_DEAD, MODE_BUS, BTN_USE } from '../shared/movement.js';
import { TICK_HZ, DT } from '../shared/constants.js';
import { EV_HEAL } from '../shared/events.js';

export const DBNO_HP = 100;
export const BLEED_SECONDS = 40;
export const REVIVE_SECONDS = 10;
export const REVIVE_HP = 30;
export const REVIVE_REACH = 2.8;
const TEAM_STATUS_EVERY = 15;
const PING_LIFETIME = 12;

export const teamMethods = {
  /** Would lethal damage knock this player rather than eliminate them? */
  canKnock(p) {
    if ((this.teamSize || 1) < 2 || this.mode === 'sandbox') return false;
    for (const q of this.players.values()) if (q !== p && q.team === p.team && q.alive && !q.dbno) return true;
    return false;
  },

  knock(p, d) {
    const killer = d.source && d.source !== p ? d.source : null;
    p.dbno = true;
    p.dbnoHp = DBNO_HP;
    p.hp = 0;
    p.shield = 0;
    p.move.mode = MODE_DBNO;
    p.move.crouch = 0;
    p.knockedBy = killer;
    p.buildMode = false; p.using = null; p.reloadEnd = 0; p.reviving = null; p.burstLeft = 0;
    p.knockedTimes = (p.knockedTimes || 0) + 1;
    if (killer) killer.knocks = (killer.knocks || 0) + 1;
    this.broadcastFeed({ killer: killer?.id || 0, victim: p.id, cause: d.kind || 'unknown', weapon: d.weapon || '', head: !!d.head, knocked: true });
    p.conn?.sendJson({ t: 'knocked', by: killer?.id || 0 });
    this.aliveDirty = true;
    this.teamCheck(p.team);
  },

  /** Knocked players bleed out; revives tick along while the reviver holds interact. */
  stageTeams() {
    for (const p of this.players.values()) {
      if (p.dbno && p.alive) {
        p.dbnoHp -= (DBNO_HP / BLEED_SECONDS) * DT;
        if (p.dbnoHp <= 0) this.eliminate(p, { kind: 'bleed', source: p.knockedBy || null });
      }
      if (p.reviving) this.progressRevive(p);
    }
    if (this.teamSize > 1 && this.tick % TEAM_STATUS_EVERY === 0) this.sendTeamStatus();
  },

  startRevive(p, targetId) {
    const t = this.players.get(targetId);
    if (!t || t === p || t.team !== p.team || !t.dbno || !t.alive || !p.alive || p.dbno) return false;
    if (Math.hypot(t.move.x - p.move.x, t.move.z - p.move.z) > REVIVE_REACH || Math.abs(t.move.y - p.move.y) > 2) return false;
    if ([...this.players.values()].some((q) => q.reviving?.target === t)) return false;
    p.reviving = { target: t, start: this.tick, end: this.tick + REVIVE_SECONDS * TICK_HZ };
    p.buildMode = false; p.using = null;
    t.conn?.sendJson({ t: 'reviving', by: p.id, end: p.reviving.end });
    p.conn?.sendJson({ t: 'reviving', target: t.id, end: p.reviving.end, start: this.tick });
    return true;
  },

  progressRevive(p) {
    const r = p.reviving;
    const t = r.target;
    const ok = p.alive && !p.dbno && t.alive && t.dbno && (p.buttons & BTN_USE)
      && Math.hypot(t.move.x - p.move.x, t.move.z - p.move.z) <= REVIVE_REACH + 0.5;
    if (!ok) {
      p.reviving = null;
      p.conn?.sendJson({ t: 'reviving', cancelled: true });
      t.conn?.sendJson({ t: 'reviving', cancelled: true });
      return;
    }
    if (this.tick < r.end) return;
    t.dbno = false;
    t.dbnoHp = 0;
    t.hp = REVIVE_HP;
    t.move.mode = MODE_WALK;
    t.move.ground = 0;
    t.knockedBy = null;
    p.reviving = null;
    p.revives = (p.revives || 0) + 1;
    this.event(EV_HEAL, t.move.x, t.move.y + 1, t.move.z, t.id, 2);
    t.conn?.sendJson({ t: 'revived', by: p.id });
    p.conn?.sendJson({ t: 'reviving', done: true });
    this.aliveDirty = true;
  },

  /** Where your teammates are and how they are doing — even across the map or on the blimp. */
  sendTeamStatus() {
    const byTeam = new Map();
    for (const q of this.players.values()) {
      let list = byTeam.get(q.team);
      if (!list) { list = []; byTeam.set(q.team, list); }
      list.push(q);
    }
    for (const conn of this.conns) {
      const me = conn.player;
      if (!me) continue;
      const mates = byTeam.get(me.team) || [];
      conn.sendJson({
        t: 'team',
        members: mates.map((q) => ({
          id: q.id, hp: Math.ceil(Math.max(0, q.hp)), shield: Math.ceil(q.shield), dbno: q.dbno ? Math.ceil(q.dbnoHp) : 0,
          alive: q.alive, bus: q.move.mode === MODE_BUS, x: Math.round(q.move.x), z: Math.round(q.move.z),
        })),
      });
    }
  },

  ping(p, a) {
    if (!p.alive || !Number.isFinite(a.x) || !Number.isFinite(a.z)) return;
    if (this.tick - (p.lastPing || -1e9) < TICK_HZ / 2) return;
    p.lastPing = this.tick;
    const msg = { t: 'ping', from: p.id, x: a.x, y: a.y, z: a.z, until: this.tick + PING_LIFETIME * TICK_HZ };
    for (const conn of this.conns) if (conn.player && conn.player.team === p.team) conn.sendJson(msg);
  },
};

export { MODE_DEAD };

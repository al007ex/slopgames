// Matchmaking. Each mode (solo, duos, squads) has at most one match forming at
// a time: people who queue join its pre-game island, and when the countdown
// runs out it launches with bots filling every empty seat. The server runs a
// few matches at once at most — it is one small machine — and anyone queued
// beyond that waits for a slot.

import { Match } from './match.js';
import { TICK_HZ } from '../shared/constants.js';

export const MODES = ['solo', 'duos', 'squads'];
export const MAX_MATCHES = 3;
const JOIN_CUTOFF_SECONDS = 6;     // do not drop people in with seconds to go
const EMPTY_GRACE_TICKS = 20 * TICK_HZ;

export class Lobby {
  constructor({ base, log, maxMatches = MAX_MATCHES, pregameSeconds, onMatchCreated } = {}) {
    this.base = base;
    this.log = log;
    this.maxMatches = maxMatches;
    this.pregameSeconds = pregameSeconds;
    this.matches = new Set();
    this.forming = new Map();          // mode → match in pre-game
    this.waiting = [];                 // conns queued while every slot is busy
    this.nextId = 1;
    this.onMatchCreated = onMatchCreated;
  }

  get busy() { let n = 0; for (const m of this.matches) if (m.mode !== 'sandbox') n++; return n; }

  enqueue(conn, mode) {
    if (!MODES.includes(mode)) return;
    this.cancel(conn);
    conn.queued = mode;
    const match = this.formingMatch(mode);
    if (match) { this.join(conn, match); return; }
    this.waiting.push(conn);
    conn.sendJson({ t: 'queue', mode, position: this.waiting.length });
  }

  cancel(conn) {
    const at = this.waiting.indexOf(conn);
    if (at >= 0) this.waiting.splice(at, 1);
    conn.queued = null;
  }

  /** The open pre-game for a mode, creating one if there is room. */
  formingMatch(mode) {
    let m = this.forming.get(mode);
    if (m && (m.phase !== 'pregame' || m.secondsLeft() < JOIN_CUTOFF_SECONDS || m.players.size >= m.fillTo || !this.matches.has(m))) {
      this.forming.delete(mode);
      m = null;
    }
    if (m) return m;
    if (this.busy >= this.maxMatches) return null;
    m = new Match({ id: this.nextId++, mode, log: this.log, flow: { pregameSeconds: this.pregameSeconds } });
    this.matches.add(m);
    this.forming.set(mode, m);
    this.onMatchCreated?.(m);
    this.log?.(`[match ${m.id}] ${mode} created`);
    return m;
  }

  join(conn, match) {
    conn.queued = null;
    const p = match.addPlayer({ name: conn.name, team: match.nextTeam(), outfit: conn.outfit ?? 0, glider: conn.glider ?? 0, pickaxe: conn.pickaxe ?? 0, account: conn.account || null });
    p.account = conn.account || null;
    match.joinPregame(p);
    conn.attach(match, p);
    for (const other of match.conns) if (other !== conn) other.sendJson({ t: 'joined', player: match.rosterEntry(p) });
  }

  /** Called every tick after the matches have stepped. */
  tick() {
    for (const m of [...this.matches]) {
      if (m.mode === 'sandbox') continue;
      // No humans left: nobody is watching, so the match ends early.
      if (!m.conns.size) m.emptyTicks = (m.emptyTicks || 0) + 1; else m.emptyTicks = 0;
      if (m.emptyTicks > EMPTY_GRACE_TICKS && m.phase !== 'pregame') m.finished = true;
      if (m.emptyTicks > EMPTY_GRACE_TICKS * 3) m.finished = true;
      if (m.finished) {
        for (const conn of [...m.conns]) { conn.detach(); conn.sendJson({ t: 'lobby', reason: 'match over' }); }
        this.matches.delete(m);
        if (this.forming.get(m.mode) === m) this.forming.delete(m.mode);
        this.log?.(`[match ${m.id}] finished`);
      }
    }
    // Anyone waiting gets a match as soon as there is a slot.
    for (const conn of [...this.waiting]) {
      const match = this.formingMatch(conn.queued);
      if (!match) break;
      this.waiting.splice(this.waiting.indexOf(conn), 1);
      this.join(conn, match);
    }
  }
}

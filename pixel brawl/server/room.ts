import { GameMode, MODES, TICK_DT, TICK_HZ } from '../shared/constants.js';
import { Sim, type SimPlayerCfg } from '../shared/sim.js';
import { botThink, makeBrain, type BotBrain } from '../shared/ai.js';
import type { InputCmd, MatchResultRow } from '../shared/types.js';

export interface RoomMember {
  uid: string;
  name: string;
  brawler: string;
  level: number;
  trophies: number;
  /** null for bots */
  send: ((msg: unknown) => void) | null;
  connected: boolean;
}

export interface RoomOptions {
  mode: GameMode;
  seed: number;
  members: { member: RoomMember; team: number; bot: boolean; difficulty: number }[];
  onFinish: (room: Room, rows: MatchResultRow[]) => void;
}

let roomCounter = 1;

export class Room {
  id = 'r' + roomCounter++;
  mode: GameMode;
  sim: Sim;
  members: RoomMember[] = [];
  bots = new Map<number, BotBrain>();
  private timer: NodeJS.Timeout | null = null;
  private onFinish: RoomOptions['onFinish'];
  private finished = false;
  private lastTime = 0;

  constructor(opts: RoomOptions) {
    this.mode = opts.mode;
    this.onFinish = opts.onFinish;

    const cfg: SimPlayerCfg[] = opts.members.map((m, i) => {
      this.members.push(m.member);
      if (m.bot) this.bots.set(i, makeBrain(i));
      return {
        uid: m.member.uid,
        name: m.member.name,
        brawler: m.member.brawler,
        bot: m.bot,
        level: m.member.level,
        trophies: m.member.trophies,
        team: m.team,
        difficulty: m.difficulty,
      };
    });

    this.sim = new Sim({ mode: opts.mode, seed: opts.seed, players: cfg });
  }

  start() {
    // tell every human what they're looking at
    this.members.forEach((m, slot) => {
      if (!m.send) return;
      m.send({
        t: 'match_init',
        mode: this.mode,
        you: slot,
        duration: MODES[this.mode].duration,
        map: {
          w: this.sim.map.w,
          h: this.sim.map.h,
          tiles: Array.from(this.sim.map.tiles),
          theme: this.sim.map.theme,
          seed: this.sim.map.seed,
        },
        players: this.sim.players.map((p) => ({
          i: p.slot,
          b: p.def.id,
          n: p.name,
          t: p.team,
          bot: p.bot,
          tr: p.trophies,
          lv: p.level,
        })),
      });
    });

    this.lastTime = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  input(slot: number, cmd: InputCmd) {
    if (this.bots.has(slot)) return;
    this.sim.setInput(slot, cmd);
  }

  /** A human left — hand their brawler to the AI so the match stays balanced. */
  disconnect(uid: string) {
    const slot = this.members.findIndex((m) => m.uid === uid);
    if (slot < 0) return;
    this.members[slot].connected = false;
    this.members[slot].send = null;
    if (!this.bots.has(slot)) {
      this.bots.set(slot, makeBrain(slot));
      this.sim.players[slot].bot = true;
      this.sim.players[slot].difficulty = 0.6;
    }
  }

  get humanCount() {
    return this.members.filter((m) => m.connected && m.send).length;
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTime) / 1000) || TICK_DT;
    this.lastTime = now;

    for (const [slot, brain] of this.bots) {
      const p = this.sim.players[slot];
      if (!p) continue;
      this.sim.setInput(slot, botThink(this.sim, p, brain, dt));
    }

    this.sim.step(dt);

    for (let slot = 0; slot < this.members.length; slot++) {
      const m = this.members[slot];
      if (!m.send) continue;
      m.send({ t: 'snap', s: this.sim.snapshot(slot) });
    }

    if (this.sim.phase === 'over' && !this.finished) {
      this.finished = true;
      const rows: MatchResultRow[] = this.sim.results().map((r) => ({
        slot: r.slot,
        name: r.name,
        brawler: r.brawler,
        team: r.team,
        rank: r.rank,
        kills: r.kills,
        score: r.score,
        trophyDelta: 0,
        bot: r.bot,
      }));
      this.onFinish(this, rows);
    }

    // linger a moment on the end screen, then shut the room down
    if (this.sim.phase === 'over' && this.sim.phaseTime <= 0) {
      this.stop();
    }
  }
}

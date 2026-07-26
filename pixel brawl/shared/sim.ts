import {
  AMMO_MAX,
  BOUNTY_MAX_STAR,
  BUSH_EXPOSE_TIME,
  BUSH_REVEAL_DIST,
  CUBE_DMG_PCT,
  CUBE_HP,
  DUEL_LIVES,
  GEM_COUNTDOWN,
  GEM_SPAWN_INTERVAL,
  GEM_WIN_COUNT,
  GameMode,
  MODES,
  PET_RADIUS,
  PLAYER_RADIUS,
  POISON_DPS_BASE,
  POISON_DPS_RAMP,
  POISON_SHRINK_RATE,
  POISON_START,
  POWER_SCALE,
  RESPAWN_TIME,
  SPAWN_INVULN,
  TILE,
} from './constants.js';
import { getBrawler, type AttackDef, type BrawlerDef, type SuperDef } from './brawlers.js';
import { generateMap, Rng } from './maps.js';
import {
  BLOCKS_MOVE,
  BLOCKS_SHOT,
  EMPTY_INPUT,
  Tile,
  type AreaSnap,
  type FxEvent,
  type InputCmd,
  type MapData,
  type PetSnap,
  type PickupSnap,
  type PlayerSnap,
  type ProjSnap,
  type Snapshot,
} from './types.js';

/* --------------------------------- config -------------------------------- */

export interface SimPlayerCfg {
  uid: string;
  name: string;
  brawler: string;
  bot: boolean;
  level: number;
  trophies: number;
  team: number;
  difficulty?: number;
}

export interface SimCfg {
  mode: GameMode;
  seed: number;
  players: SimPlayerCfg[];
}

/* -------------------------------- entities ------------------------------- */

export interface Ent {
  slot: number;
  uid: string;
  name: string;
  bot: boolean;
  difficulty: number;
  def: BrawlerDef;
  team: number;
  level: number;
  trophies: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  moveAngle: number;

  hp: number;
  maxHp: number;
  dmgMul: number;

  ammo: number;
  attackCd: number;
  superCharge: number;

  alive: boolean;
  respawnT: number;
  invulnT: number;
  exposeT: number;
  inBush: boolean;

  slowT: number;
  slowAmt: number;
  dotDps: number;
  dotT: number;
  dotOwner: number;

  dash: null | { vx: number; vy: number; t: number; dmg: number; radius: number; breaks: boolean; hit: Set<number> };
  leap: null | { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; sup: SuperDef };
  burst: null | { def: AttackDef | SuperDef; sup: boolean; angle: number; left: number; delay: number; t: number; dist: number };

  input: InputCmd;
  lastSeq: number;

  // scoring
  kills: number;
  deaths: number;
  gems: number;
  stars: number;
  lives: number;
  cubes: number;
  rank: number;
  damageDone: number;
}

interface Proj {
  id: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  dmg: number;
  traveled: number;
  range: number;
  kind: string;
  pierce: boolean;
  hit: Set<number>;
  bounces: number;
  breaks: boolean;
  knockback: number;
  heal: number;
  dotDmg: number;
  dotTime: number;
  slow: number;
  lob: boolean;
  lobDist: number;
  lobRadius: number;
  homing: number;
  target: number;
  scale: number;
  life: number;
}

interface Area {
  id: number;
  x: number;
  y: number;
  r: number;
  team: number;
  owner: number;
  kind: string;
  life: number;
  maxLife: number;
  dps: number;
  tickT: number;
  pull: number;
  slow: number;
  dotDmg: number;
  dotTime: number;
  heal: number;
  armT: number;
  trigger: boolean;
  triggerDmg: number;
  knockback: number;
}

interface Pet {
  id: number;
  owner: number;
  team: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  aim: number;
  cd: number;
  life: number;
  dmg: number;
  range: number;
  heal: number;
}

interface Pickup {
  id: number;
  x: number;
  y: number;
  kind: 'gem' | 'cube';
  life: number;
  pop: number;
  vx: number;
  vy: number;
}

/* -------------------------------- helpers -------------------------------- */

function circleRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/* ---------------------------------- sim ---------------------------------- */

export class Sim {
  mode: GameMode;
  map: MapData;
  rng: Rng;
  tick = 0;
  time = 0;
  phase: 'countdown' | 'live' | 'over' = 'countdown';
  phaseTime = 3;
  duration: number;

  players: Ent[] = [];
  projs: Proj[] = [];
  areas: Area[] = [];
  pets: Pet[] = [];
  pickups: Pickup[] = [];
  fx: FxEvent[] = [];
  broken: number[] = [];

  scores = [0, 0, 0, 0, 0, 0, 0, 0];
  cdTeam = -1;
  cdTime = 0;
  poison = -1;
  winner = -1;

  private nextId = 1;
  private gemTimer = 1.5;
  private gemsOnField = 0;
  private deathOrder: number[] = [];

  constructor(cfg: SimCfg) {
    this.mode = cfg.mode;
    this.rng = new Rng(cfg.seed ^ 0x9e3779b9);
    this.map = generateMap(cfg.mode, cfg.seed);
    this.duration = MODES[cfg.mode].duration;

    const perTeamCount: Record<number, number> = {};
    cfg.players.forEach((p, i) => {
      const def = getBrawler(p.brawler);
      const scale = POWER_SCALE[Math.max(0, Math.min(POWER_SCALE.length - 1, p.level - 1))];
      const maxHp = Math.round(def.hp * scale);
      const idxInTeam = (perTeamCount[p.team] = (perTeamCount[p.team] ?? 0) + 1) - 1;
      const spawn = this.spawnPointFor(p.team, idxInTeam, i);
      this.players.push({
        slot: i,
        uid: p.uid,
        name: p.name,
        bot: p.bot,
        difficulty: p.difficulty ?? 0.65,
        def,
        team: p.team,
        level: p.level,
        trophies: p.trophies,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        aim: 0,
        moveAngle: 0,
        hp: maxHp,
        maxHp,
        dmgMul: scale,
        ammo: AMMO_MAX,
        attackCd: 0,
        superCharge: 0,
        alive: true,
        respawnT: 0,
        invulnT: SPAWN_INVULN,
        exposeT: 0,
        inBush: false,
        slowT: 0,
        slowAmt: 0,
        dotDps: 0,
        dotT: 0,
        dotOwner: -1,
        dash: null,
        leap: null,
        burst: null,
        input: { ...EMPTY_INPUT },
        lastSeq: 0,
        kills: 0,
        deaths: 0,
        gems: 0,
        stars: 0,
        lives: DUEL_LIVES,
        cubes: 0,
        rank: 0,
        damageDone: 0,
      });
    });
  }

  /* ------------------------------ spawning ------------------------------ */

  private spawnPointFor(team: number, idxInTeam: number, slot: number) {
    const list = this.map.spawns.filter((s) => s.team === team);
    const sp = list.length ? list[idxInTeam % list.length] : this.map.spawns[slot % this.map.spawns.length];
    return { x: sp.x * TILE + TILE / 2, y: sp.y * TILE + TILE / 2 };
  }

  private respawnPlayer(p: Ent) {
    const idxInTeam = this.players.filter((q) => q.team === p.team).indexOf(p);
    const sp = this.spawnPointFor(p.team, idxInTeam, p.slot);
    p.x = sp.x + this.rng.range(-6, 6);
    p.y = sp.y + this.rng.range(-6, 6);
    p.hp = p.maxHp;
    p.alive = true;
    p.invulnT = SPAWN_INVULN;
    p.ammo = AMMO_MAX;
    p.vx = p.vy = 0;
    p.dotT = 0;
    p.slowT = 0;
    p.dash = null;
    p.leap = null;
    p.burst = null;
  }

  /* -------------------------------- input ------------------------------- */

  setInput(slot: number, cmd: InputCmd) {
    const p = this.players[slot];
    if (!p) return;
    if (cmd.seq < p.lastSeq) return;
    p.lastSeq = cmd.seq;
    p.input = cmd;
  }

  /* --------------------------------- map -------------------------------- */

  tileAt(wx: number, wy: number): Tile {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return Tile.Wall;
    return this.map.tiles[ty * this.map.w + tx] as Tile;
  }

  private blockedMove(x: number, y: number, r: number): boolean {
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return true;
        const t = this.map.tiles[ty * this.map.w + tx] as Tile;
        if (BLOCKS_MOVE.has(t) && circleRect(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
      }
    }
    return false;
  }

  /** Slide-along-walls movement. */
  private moveCircle(o: { x: number; y: number }, dx: number, dy: number, r: number) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (r * 0.7)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.blockedMove(o.x + sx, o.y, r)) o.x += sx;
      if (!this.blockedMove(o.x, o.y + sy, r)) o.y += sy;
    }
  }

  private breakTile(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return;
    const i = ty * this.map.w + tx;
    if (this.map.tiles[i] !== Tile.Crate) return;
    this.map.tiles[i] = Tile.Grass;
    this.broken.push(i);
    this.fx.push({ k: 'break', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
    if (this.mode === GameMode.Showdown) {
      this.spawnPickup(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 'cube');
    }
  }

  private breakAround(x: number, y: number, r: number) {
    const t0x = Math.floor((x - r) / TILE);
    const t1x = Math.floor((x + r) / TILE);
    const t0y = Math.floor((y - r) / TILE);
    const t1y = Math.floor((y + r) / TILE);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        if (circleRect(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) this.breakTile(tx, ty);
      }
    }
  }

  /* ------------------------------- pickups ------------------------------ */

  private spawnPickup(x: number, y: number, kind: 'gem' | 'cube') {
    const a = this.rng.range(0, Math.PI * 2);
    this.pickups.push({
      id: this.nextId++,
      x,
      y,
      kind,
      life: kind === 'gem' ? 999 : 999,
      pop: 0.45,
      vx: Math.cos(a) * this.rng.range(10, 34),
      vy: Math.sin(a) * this.rng.range(10, 34),
    });
    if (kind === 'gem') this.gemsOnField++;
  }

  /* -------------------------------- combat ------------------------------ */

  private angleOf(p: Ent) {
    return Math.atan2(p.input.ay, p.input.ax);
  }

  private spawnProj(
    o: Ent | Pet,
    team: number,
    owner: number,
    angle: number,
    d: AttackDef | SuperDef,
    isSuper: boolean,
    dmgMul: number,
    lobDist = 0,
  ) {
    const speed = d.speed;
    const anyD = d as AttackDef & SuperDef;
    const isLob = (d as AttackDef).kind === 'lob' || (d as SuperDef).kind === 'lob';
    const p: Proj = {
      id: this.nextId++,
      owner,
      team,
      x: o.x + Math.cos(angle) * 7,
      y: o.y + Math.sin(angle) * 7,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: d.radius,
      dmg: Math.round(d.damage * dmgMul),
      traveled: 0,
      range: d.range,
      kind: d.visual,
      pierce: !!anyD.pierce,
      hit: new Set(),
      bounces: anyD.bounces ?? 0,
      breaks: !!anyD.breaksWalls,
      knockback: anyD.knockback ?? 0,
      heal: anyD.heal ?? 0,
      dotDmg: (anyD.dotDamage ?? 0) * dmgMul,
      dotTime: anyD.dotTime ?? 0,
      slow: anyD.slow ?? 0,
      lob: isLob,
      lobDist: isLob ? Math.max(24, Math.min(d.range, lobDist)) : 0,
      lobRadius: d.radius,
      homing: 0,
      target: -1,
      scale: isSuper ? 1.3 : 1,
      life: 6,
    };
    if (isLob) {
      p.radius = 3;
    }
    this.projs.push(p);
    return p;
  }

  private fire(p: Ent, isSuper: boolean) {
    const d: AttackDef | SuperDef = isSuper ? p.def.super : p.def.attack;
    const angle = this.angleOf(p);
    const aimDist = Math.max(0.12, Math.min(1, p.input.ad ?? 1)) * d.range;
    p.aim = angle;
    p.exposeT = BUSH_EXPOSE_TIME;
    this.fx.push({ k: isSuper ? 'super' : 'shoot', x: p.x, y: p.y, a: angle, s: p.def.id });

    const kind = isSuper ? (p.def.super.kind as string) : (p.def.attack.kind as string);

    switch (kind) {
      case 'spread': {
        const n = d.count;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : i / (n - 1) - 0.5;
          this.spawnProj(p, p.team, p.slot, angle + t * d.spread, d, isSuper, p.dmgMul);
        }
        break;
      }
      case 'burst': {
        p.burst = { def: d, sup: isSuper, angle, left: d.count, delay: (d as AttackDef).burstDelay ?? 0.07, t: 0, dist: aimDist };
        break;
      }
      case 'single':
      case 'pierce':
      case 'bounce':
      case 'heal': {
        if (kind === 'heal' && isSuper) break; // handled by super switch below
        if (d.count > 1) {
          p.burst = { def: d, sup: isSuper, angle, left: d.count, delay: (d as AttackDef).burstDelay ?? 0.07, t: 0, dist: aimDist };
        } else {
          this.spawnProj(p, p.team, p.slot, angle, d, isSuper, p.dmgMul, aimDist);
        }
        break;
      }
      case 'lob': {
        const n = d.count;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : i / (n - 1) - 0.5;
          this.spawnProj(p, p.team, p.slot, angle + t * d.spread, d, isSuper, p.dmgMul, aimDist + t * 26);
        }
        break;
      }
      case 'melee': {
        if (p.def.id === 'mortis') {
          // Mortis lunges with every swing
          p.dash = {
            vx: Math.cos(angle) * 230,
            vy: Math.sin(angle) * 230,
            t: 0.26,
            dmg: Math.round(d.damage * p.dmgMul),
            radius: d.radius,
            breaks: false,
            hit: new Set(),
          };
        } else {
          const n = d.count;
          for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : i / (n - 1) - 0.5;
            this.spawnProj(p, p.team, p.slot, angle + t * d.spread, d, isSuper, p.dmgMul);
          }
        }
        break;
      }
    }
  }

  private fireSuper(p: Ent) {
    const s = p.def.super;
    const angle = this.angleOf(p);
    const aimDist = Math.max(0.12, Math.min(1, p.input.ad ?? 1)) * s.range;
    p.aim = angle;
    p.exposeT = BUSH_EXPOSE_TIME;
    this.fx.push({ k: 'super', x: p.x, y: p.y, a: angle, s: p.def.id });

    switch (s.kind) {
      case 'spread':
      case 'single':
      case 'lob':
        this.fire(p, true);
        break;

      case 'dash': {
        p.dash = {
          vx: Math.cos(angle) * s.speed,
          vy: Math.sin(angle) * s.speed,
          t: s.range / s.speed,
          dmg: Math.round(s.damage * p.dmgMul),
          radius: s.radius,
          breaks: !!s.breaksWalls,
          hit: new Set(),
        };
        break;
      }

      case 'leap':
      case 'poisonLeap': {
        const tx = p.x + Math.cos(angle) * aimDist;
        const ty = p.y + Math.sin(angle) * aimDist;
        const dest = this.findLanding(tx, ty);
        p.leap = { x0: p.x, y0: p.y, x1: dest.x, y1: dest.y, t: 0, dur: Math.max(0.45, aimDist / s.speed), sup: s };
        if (s.kind === 'poisonLeap' || p.def.id === 'piper') {
          this.spawnArea({
            x: p.x,
            y: p.y,
            r: s.radius,
            team: p.team,
            owner: p.slot,
            kind: p.def.id === 'piper' ? 'grenade' : 'poison',
            life: 0.9,
            dps: 0,
            dotDmg: s.dotDamage ? s.dotDamage * p.dmgMul : 0,
            dotTime: s.dotTime ?? 0,
          });
          if (p.def.id === 'piper') {
            this.explode(p.x, p.y, s.radius, Math.round(s.damage * p.dmgMul * 0.6), p.team, p.slot, 'grenade', 0);
          }
        }
        break;
      }

      case 'summonBear':
      case 'summonTurret':
      case 'summonHealTurret': {
        const kindName = s.kind === 'summonBear' ? 'bear' : s.kind === 'summonTurret' ? 'turret' : 'healturret';
        // remove previous pet of the same owner
        this.pets = this.pets.filter((pt) => pt.owner !== p.slot);
        const px = p.x + Math.cos(angle) * 16;
        const py = p.y + Math.sin(angle) * 16;
        const ok = !this.blockedMove(px, py, PET_RADIUS);
        this.pets.push({
          id: this.nextId++,
          owner: p.slot,
          team: p.team,
          kind: kindName,
          x: ok ? px : p.x,
          y: ok ? py : p.y,
          hp: Math.round((s.petHp ?? 2000) * p.dmgMul),
          maxHp: Math.round((s.petHp ?? 2000) * p.dmgMul),
          aim: angle,
          cd: 0.5,
          life: s.duration ?? 999,
          dmg: Math.round(s.damage * p.dmgMul),
          range: s.range,
          heal: Math.round((s.heal ?? 0) * p.dmgMul),
        });
        break;
      }

      case 'heal': {
        const healAmt = Math.round((s.heal ?? 0) * p.dmgMul);
        for (const q of this.players) {
          if (!q.alive || q.team !== p.team) continue;
          if (dist2(q.x, q.y, p.x, p.y) > s.radius * s.radius) continue;
          q.hp = Math.min(q.maxHp, q.hp + healAmt);
          this.fx.push({ k: 'heal', x: q.x, y: q.y, v: healAmt });
        }
        this.spawnArea({ x: p.x, y: p.y, r: s.radius, team: p.team, owner: p.slot, kind: 'heal', life: 0.6, dps: 0 });
        break;
      }

      case 'mines': {
        const n = s.count;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : i / (n - 1) - 0.5;
          const a = angle + t * s.spread;
          const d = aimDist;
          const mx = p.x + Math.cos(a) * d;
          const my = p.y + Math.sin(a) * d;
          this.spawnArea({
            x: mx,
            y: my,
            r: s.radius,
            team: p.team,
            owner: p.slot,
            kind: 'mine',
            life: s.duration ?? 60,
            dps: 0,
            armT: 0.7,
            trigger: true,
            triggerDmg: Math.round(s.damage * p.dmgMul),
            knockback: s.knockback ?? 0,
          });
        }
        break;
      }

      case 'barrage': {
        const n = s.count;
        for (let i = 0; i < n; i++) {
          const spreadA = angle + this.rng.range(-0.34, 0.34);
          const dd = aimDist + this.rng.range(-26, 26);
          const pr = this.spawnProj(p, p.team, p.slot, spreadA, s, true, p.dmgMul, dd);
          pr.lob = true;
          pr.lobDist = Math.max(20, dd);
          pr.radius = 3;
          pr.traveled = -i * 12; // stagger the rain
        }
        break;
      }

      case 'gravity': {
        const gx = p.x + Math.cos(angle) * aimDist;
        const gy = p.y + Math.sin(angle) * aimDist;
        this.spawnArea({
          x: gx,
          y: gy,
          r: s.radius,
          team: p.team,
          owner: p.slot,
          kind: 'gravity',
          life: s.duration ?? 2.4,
          dps: s.damage * p.dmgMul,
          pull: 74,
        });
        break;
      }

      case 'spikeField': {
        const fx = p.x + Math.cos(angle) * aimDist;
        const fy = p.y + Math.sin(angle) * aimDist;
        this.spawnArea({
          x: fx,
          y: fy,
          r: s.radius,
          team: p.team,
          owner: p.slot,
          kind: 'field',
          life: s.duration ?? 3.4,
          dps: s.damage * p.dmgMul,
          slow: s.slow ?? 0.5,
        });
        break;
      }

      case 'bats': {
        for (let i = 0; i < s.count; i++) {
          const a = angle + (i / Math.max(1, s.count - 1) - 0.5) * s.spread;
          const pr = this.spawnProj(p, p.team, p.slot, a, s, true, p.dmgMul);
          pr.homing = 2.4;
          pr.heal = Math.round((s.heal ?? 0) * p.dmgMul);
          pr.life = 3.2;
        }
        break;
      }
    }
  }

  private findLanding(x: number, y: number) {
    if (!this.blockedMove(x, y, PLAYER_RADIUS)) return { x, y };
    for (let r = 8; r <= 64; r += 8) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const ny = y + Math.sin(a) * r;
        if (!this.blockedMove(nx, ny, PLAYER_RADIUS)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  private spawnArea(o: Partial<Area> & { x: number; y: number; r: number; team: number; owner: number; kind: string; life: number }) {
    this.areas.push({
      id: this.nextId++,
      x: o.x,
      y: o.y,
      r: o.r,
      team: o.team,
      owner: o.owner,
      kind: o.kind,
      life: o.life,
      maxLife: o.life,
      dps: o.dps ?? 0,
      tickT: 0,
      pull: o.pull ?? 0,
      slow: o.slow ?? 0,
      dotDmg: o.dotDmg ?? 0,
      dotTime: o.dotTime ?? 0,
      heal: o.heal ?? 0,
      armT: o.armT ?? 0,
      trigger: o.trigger ?? false,
      triggerDmg: o.triggerDmg ?? 0,
      knockback: o.knockback ?? 0,
    });
  }

  private explode(
    x: number,
    y: number,
    r: number,
    dmg: number,
    team: number,
    owner: number,
    visual: string,
    knockback: number,
    opts?: { breaks?: boolean; dotDmg?: number; dotTime?: number; slow?: number },
  ) {
    this.fx.push({ k: 'explode', x, y, v: r, s: visual });
    this.spawnArea({ x, y, r, team, owner, kind: visual + '_fx', life: 0.3, dps: 0 });
    if (opts?.breaks) this.breakAround(x, y, r);
    const r2 = r * r;
    for (const q of this.players) {
      if (!q.alive || q.team === team) continue;
      if (dist2(q.x, q.y, x, y) > r2) continue;
      this.damage(q, dmg, owner, { knockback, kx: q.x - x, ky: q.y - y, dotDmg: opts?.dotDmg, dotTime: opts?.dotTime, slow: opts?.slow });
    }
    for (const pt of this.pets) {
      if (pt.team === team) continue;
      if (dist2(pt.x, pt.y, x, y) > r2) continue;
      this.damagePet(pt, dmg, owner);
    }
  }

  private damage(
    t: Ent,
    dmg: number,
    ownerSlot: number,
    opts?: { knockback?: number; kx?: number; ky?: number; dotDmg?: number; dotTime?: number; slow?: number; charge?: number },
  ) {
    if (!t.alive || t.invulnT > 0 || t.leap) return;
    const owner = this.players[ownerSlot];
    t.hp -= dmg;
    t.exposeT = Math.max(t.exposeT, 0.7);
    this.fx.push({ k: 'hit', x: t.x, y: t.y, v: dmg });
    if (owner) {
      owner.damageDone += dmg;
      owner.superCharge = Math.min(100, owner.superCharge + (opts?.charge ?? 0));
    }
    if (opts?.knockback && (opts.kx !== undefined || opts.ky !== undefined)) {
      const len = Math.hypot(opts.kx ?? 0, opts.ky ?? 0) || 1;
      this.moveCircle(t, ((opts.kx ?? 0) / len) * opts.knockback * 0.35, ((opts.ky ?? 0) / len) * opts.knockback * 0.35, PLAYER_RADIUS);
    }
    if (opts?.dotDmg && opts.dotTime) {
      t.dotDps = opts.dotDmg / opts.dotTime;
      t.dotT = opts.dotTime;
      t.dotOwner = ownerSlot;
    }
    if (opts?.slow) {
      t.slowT = Math.max(t.slowT, 1.2);
      t.slowAmt = opts.slow;
    }
    if (t.hp <= 0) this.kill(t, ownerSlot);
  }

  private damagePet(pt: Pet, dmg: number, ownerSlot: number) {
    pt.hp -= dmg;
    this.fx.push({ k: 'hit', x: pt.x, y: pt.y, v: dmg });
    const owner = this.players[ownerSlot];
    if (owner) owner.damageDone += dmg;
    if (pt.hp <= 0) {
      this.fx.push({ k: 'petdie', x: pt.x, y: pt.y, s: pt.kind });
      this.pets = this.pets.filter((q) => q !== pt);
    }
  }

  private kill(t: Ent, killerSlot: number) {
    if (!t.alive) return;
    t.alive = false;
    t.deaths++;
    t.hp = 0;
    t.dash = null;
    t.leap = null;
    t.burst = null;
    this.fx.push({ k: 'kill', x: t.x, y: t.y, s: t.def.id });
    this.pets = this.pets.filter((p) => p.owner !== t.slot);

    const killer = this.players[killerSlot];
    if (killer && killer !== t && killer.team !== t.team) {
      killer.kills++;
      killer.superCharge = Math.min(100, killer.superCharge + 22);
    }

    // drop what you were carrying
    if (this.mode === GameMode.GemGrab && t.gems > 0) {
      const n = t.gems;
      t.gems = 0;
      for (let i = 0; i < n; i++) this.spawnPickup(t.x, t.y, 'gem');
    }
    if (this.mode === GameMode.Showdown) {
      const drop = Math.floor(t.cubes / 2) + 1;
      for (let i = 0; i < drop; i++) this.spawnPickup(t.x, t.y, 'cube');
      t.rank = this.players.filter((p) => p.alive).length + 1;
      this.deathOrder.push(t.slot);
    }
    if (this.mode === GameMode.Bounty && killer && killer.team !== t.team) {
      const worth = Math.min(BOUNTY_MAX_STAR, 1 + t.stars);
      this.scores[killer.team] += worth;
      killer.stars = Math.min(BOUNTY_MAX_STAR, killer.stars + 1);
      t.stars = 0;
      this.fx.push({ k: 'star', x: t.x, y: t.y, v: worth });
    }
    if (this.mode === GameMode.Duel) {
      t.lives--;
    }

    if (this.mode !== GameMode.Showdown) {
      t.respawnT = RESPAWN_TIME;
    }
  }

  /* --------------------------------- step ------------------------------- */

  step(dt: number) {
    this.fx.length = 0;
    this.tick++;
    this.time += dt;

    if (this.phase === 'countdown') {
      this.phaseTime -= dt;
      this.stepPickups(dt);
      if (this.phaseTime <= 0) {
        this.phase = 'live';
        this.phaseTime = this.duration;
      }
      return;
    }
    if (this.phase === 'over') {
      this.phaseTime -= dt;
      return;
    }

    this.phaseTime -= dt;

    this.stepPlayers(dt);
    this.stepBursts(dt);
    this.stepProjectiles(dt);
    this.stepAreas(dt);
    this.stepPets(dt);
    this.stepPickups(dt);
    this.stepMode(dt);
    this.checkEnd();
  }

  private stepPlayers(dt: number) {
    for (const p of this.players) {
      if (!p.alive) {
        if (this.mode !== GameMode.Showdown) {
          p.respawnT -= dt;
          const canRespawn = this.mode !== GameMode.Duel || p.lives > 0;
          if (p.respawnT <= 0 && canRespawn) this.respawnPlayer(p);
        }
        continue;
      }

      if (p.invulnT > 0) p.invulnT -= dt;
      if (p.exposeT > 0) p.exposeT -= dt;
      if (p.slowT > 0) {
        p.slowT -= dt;
        if (p.slowT <= 0) p.slowAmt = 0;
      }
      if (p.dotT > 0) {
        p.dotT -= dt;
        const d = p.dotDps * dt;
        p.hp -= d;
        if (p.hp <= 0) this.kill(p, p.dotOwner);
        if (p.dotT <= 0) p.dotDps = 0;
        if (!p.alive) continue;
      }

      // ammo regen
      if (p.ammo < AMMO_MAX) p.ammo = Math.min(AMMO_MAX, p.ammo + dt / p.def.attack.reload);
      if (p.attackCd > 0) p.attackCd -= dt;

      // leap overrides everything
      if (p.leap) {
        p.leap.t += dt;
        const k = Math.min(1, p.leap.t / p.leap.dur);
        p.x = p.leap.x0 + (p.leap.x1 - p.leap.x0) * k;
        p.y = p.leap.y0 + (p.leap.y1 - p.leap.y0) * k;
        if (k >= 1) {
          const s = p.leap.sup;
          this.explode(p.x, p.y, s.radius, Math.round(s.damage * p.dmgMul), p.team, p.slot, s.visual, s.knockback ?? 0, {
            dotDmg: s.dotDamage ? s.dotDamage * p.dmgMul : 0,
            dotTime: s.dotTime,
          });
          if (s.kind === 'poisonLeap') {
            this.spawnArea({
              x: p.x,
              y: p.y,
              r: s.radius,
              team: p.team,
              owner: p.slot,
              kind: 'poison',
              life: 1.2,
              dps: 0,
              dotDmg: (s.dotDamage ?? 0) * p.dmgMul,
              dotTime: s.dotTime ?? 0,
            });
          }
          p.leap = null;
        }
        continue;
      }

      // dash
      if (p.dash) {
        p.dash.t -= dt;
        const before = { x: p.x, y: p.y };
        if (p.dash.breaks) this.breakAround(p.x, p.y, p.dash.radius);
        this.moveCircle(p, p.dash.vx * dt, p.dash.vy * dt, PLAYER_RADIUS);
        const moved = Math.hypot(p.x - before.x, p.y - before.y);
        for (const q of this.players) {
          if (!q.alive || q.team === p.team || p.dash.hit.has(q.slot)) continue;
          if (dist2(q.x, q.y, p.x, p.y) < (p.dash.radius + PLAYER_RADIUS) ** 2) {
            p.dash.hit.add(q.slot);
            this.damage(q, p.dash.dmg, p.slot, { knockback: 34, kx: q.x - p.x, ky: q.y - p.y, charge: 24 });
          }
        }
        for (const pt of this.pets) {
          if (pt.team === p.team || p.dash.hit.has(-pt.id)) continue;
          if (dist2(pt.x, pt.y, p.x, p.y) < (p.dash.radius + PET_RADIUS) ** 2) {
            p.dash.hit.add(-pt.id);
            this.damagePet(pt, p.dash.dmg, p.slot);
          }
        }
        if (p.dash.t <= 0 || (moved < 0.4 && !p.dash.breaks)) p.dash = null;
        p.moveAngle = Math.atan2(p.vy, p.vx);
        continue;
      }

      // movement
      const inp = p.input;
      let mlen = Math.hypot(inp.mx, inp.my);
      let speed = p.def.speed * (1 - p.slowAmt);
      if (mlen > 1) {
        inp.mx /= mlen;
        inp.my /= mlen;
        mlen = 1;
      }
      if (mlen > 0.05) {
        p.vx = inp.mx * speed;
        p.vy = inp.my * speed;
        p.moveAngle = Math.atan2(p.vy, p.vx);
      } else {
        p.vx = 0;
        p.vy = 0;
      }
      this.moveCircle(p, p.vx * dt, p.vy * dt, PLAYER_RADIUS);

      // aim
      if (Math.hypot(inp.ax, inp.ay) > 0.01) p.aim = Math.atan2(inp.ay, inp.ax);
      else if (mlen > 0.05) p.aim = p.moveAngle;

      // bush state
      p.inBush = this.tileAt(p.x, p.y) === Tile.Bush;

      // firing
      if (inp.useSuper && p.superCharge >= 100) {
        p.superCharge = 0;
        this.fireSuper(p);
        p.attackCd = 0.3;
      } else if (inp.shoot && p.ammo >= 1 && p.attackCd <= 0 && !p.burst) {
        p.ammo -= 1;
        p.attackCd = p.def.attack.cd;
        this.fire(p, false);
      }
    }

    // soft body separation
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.alive || a.leap) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (!b.alive || b.leap) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = PLAYER_RADIUS * 2 - 1;
        if (d > 0.0001 && d < min) {
          const push = (min - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          this.moveCircle(a, -nx * push, -ny * push, PLAYER_RADIUS);
          this.moveCircle(b, nx * push, ny * push, PLAYER_RADIUS);
        }
      }
    }
  }

  private stepBursts(dt: number) {
    for (const p of this.players) {
      if (!p.burst) continue;
      if (!p.alive) {
        p.burst = null;
        continue;
      }
      p.burst.t -= dt;
      while (p.burst && p.burst.t <= 0 && p.burst.left > 0) {
        const b = p.burst;
        this.spawnProj(p, p.team, p.slot, b.angle + this.rng.range(-b.def.spread, b.def.spread) * 0.5, b.def, b.sup, p.dmgMul, b.dist);
        b.left--;
        b.t += b.delay;
        if (b.left <= 0) p.burst = null;
      }
    }
  }

  private stepProjectiles(dt: number) {
    const keep: Proj[] = [];
    for (const pr of this.projs) {
      pr.life -= dt;
      if (pr.life <= 0) continue;

      if (pr.traveled < 0) {
        // staggered barrage projectile waiting to launch
        pr.traveled += Math.hypot(pr.vx, pr.vy) * dt;
        keep.push(pr);
        continue;
      }

      if (pr.homing > 0) {
        pr.homing -= dt;
        let best = -1;
        let bd = 1e9;
        for (const q of this.players) {
          if (!q.alive || q.team === pr.team) continue;
          const d = dist2(q.x, q.y, pr.x, pr.y);
          if (d < bd) {
            bd = d;
            best = q.slot;
          }
        }
        if (best >= 0) {
          const t = this.players[best];
          const want = Math.atan2(t.y - pr.y, t.x - pr.x);
          const cur = Math.atan2(pr.vy, pr.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const na = cur + Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(na) * sp;
          pr.vy = Math.sin(na) * sp;
        }
      }

      const speed = Math.hypot(pr.vx, pr.vy);
      const stepDist = speed * dt;
      const sub = Math.max(1, Math.ceil(stepDist / 5));
      let dead = false;

      for (let s = 0; s < sub && !dead; s++) {
        const nx = pr.x + (pr.vx * dt) / sub;
        const ny = pr.y + (pr.vy * dt) / sub;
        pr.traveled += stepDist / sub;

        if (pr.lob) {
          pr.x = nx;
          pr.y = ny;
          if (pr.traveled >= pr.lobDist) {
            this.explode(pr.x, pr.y, pr.lobRadius, pr.dmg, pr.team, pr.owner, pr.kind, pr.knockback, {
              breaks: pr.breaks,
              dotDmg: pr.dotDmg,
              dotTime: pr.dotTime,
            });
            if (pr.dotDmg > 0 && pr.dotTime > 0) {
              this.spawnArea({
                x: pr.x,
                y: pr.y,
                r: pr.lobRadius,
                team: pr.team,
                owner: pr.owner,
                kind: pr.kind === 'cactus' ? 'spikes' : 'puddle',
                life: pr.dotTime,
                dps: pr.dotDmg / pr.dotTime,
              });
            }
            const owner = this.players[pr.owner];
            if (owner) owner.superCharge = Math.min(100, owner.superCharge + (owner.def.attack.charge ?? 0));
            dead = true;
            break;
          }
          continue;
        }

        // wall collision
        const tx = Math.floor(nx / TILE);
        const ty = Math.floor(ny / TILE);
        const t = this.tileAt(nx, ny);
        if (BLOCKS_SHOT.has(t)) {
          if (t === Tile.Crate) {
            this.breakTile(tx, ty);
            if (!pr.breaks) {
              dead = true;
              break;
            }
          } else if (pr.breaks) {
            // super shots stop at permanent rock but shatter crates around
            this.breakAround(nx, ny, pr.radius + 8);
            dead = true;
            break;
          } else if (pr.bounces > 0) {
            // reflect off the surface we hit
            const px = Math.floor(pr.x / TILE);
            const py = Math.floor(pr.y / TILE);
            if (px !== tx) pr.vx = -pr.vx;
            if (py !== ty) pr.vy = -pr.vy;
            if (px === tx && py === ty) {
              pr.vx = -pr.vx;
              pr.vy = -pr.vy;
            }
            pr.bounces--;
            this.fx.push({ k: 'bounce', x: pr.x, y: pr.y });
            break;
          } else {
            this.fx.push({ k: 'wallhit', x: nx, y: ny });
            dead = true;
            break;
          }
        }

        pr.x = nx;
        pr.y = ny;

        // entity collision
        for (const q of this.players) {
          if (!q.alive || q.leap) continue;
          if (pr.heal > 0 && q.team === pr.team) {
            if (pr.hit.has(q.slot)) continue;
            if (dist2(q.x, q.y, pr.x, pr.y) > (pr.radius + PLAYER_RADIUS) ** 2) continue;
            pr.hit.add(q.slot);
            q.hp = Math.min(q.maxHp, q.hp + pr.heal);
            this.fx.push({ k: 'heal', x: q.x, y: q.y, v: pr.heal });
            continue;
          }
          if (q.team === pr.team || pr.hit.has(q.slot) || q.invulnT > 0) continue;
          if (dist2(q.x, q.y, pr.x, pr.y) > (pr.radius + PLAYER_RADIUS) ** 2) continue;
          pr.hit.add(q.slot);
          const owner = this.players[pr.owner];
          const charge = owner ? (owner.def.attack.charge ?? 8) : 8;
          this.damage(q, pr.dmg, pr.owner, {
            knockback: pr.knockback,
            kx: pr.vx,
            ky: pr.vy,
            dotDmg: pr.dotDmg,
            dotTime: pr.dotTime,
            slow: pr.slow,
            charge,
          });
          if (pr.heal > 0 && owner) {
            owner.hp = Math.min(owner.maxHp, owner.hp + pr.heal);
            this.fx.push({ k: 'heal', x: owner.x, y: owner.y, v: pr.heal });
          }
          if (!pr.pierce) {
            dead = true;
            break;
          }
        }
        if (dead) break;

        for (const pt of this.pets) {
          if (pt.team === pr.team || pr.hit.has(-pt.id)) continue;
          if (dist2(pt.x, pt.y, pr.x, pr.y) > (pr.radius + PET_RADIUS) ** 2) continue;
          pr.hit.add(-pt.id);
          this.damagePet(pt, pr.dmg, pr.owner);
          if (!pr.pierce) {
            dead = true;
            break;
          }
        }
      }

      if (!dead && pr.traveled < pr.range) keep.push(pr);
      else if (!dead) {
        // reached max range
        if (pr.kind === 'rocket' || pr.kind === 'rocket_super' || pr.kind === 'snipe') {
          this.fx.push({ k: 'puff', x: pr.x, y: pr.y });
        }
      }
    }
    this.projs = keep;
  }

  private stepAreas(dt: number) {
    const keep: Area[] = [];
    for (const a of this.areas) {
      a.life -= dt;
      if (a.armT > 0) a.armT -= dt;

      if (a.trigger && a.armT <= 0) {
        let boom = false;
        for (const q of this.players) {
          if (!q.alive || q.team === a.team) continue;
          if (dist2(q.x, q.y, a.x, a.y) < (a.r * 0.55) ** 2) {
            boom = true;
            break;
          }
        }
        if (boom) {
          this.explode(a.x, a.y, a.r, a.triggerDmg, a.team, a.owner, 'mine', a.knockback, { breaks: true });
          continue;
        }
      }

      if (a.dps > 0 || a.pull > 0 || a.slow > 0 || a.heal > 0) {
        a.tickT -= dt;
        const r2 = a.r * a.r;
        if (a.tickT <= 0) {
          a.tickT = 0.25;
          for (const q of this.players) {
            if (!q.alive) continue;
            const inside = dist2(q.x, q.y, a.x, a.y) < r2;
            if (!inside) continue;
            if (a.heal > 0 && q.team === a.team) {
              q.hp = Math.min(q.maxHp, q.hp + a.heal * 0.25);
              this.fx.push({ k: 'heal', x: q.x, y: q.y, v: a.heal * 0.25 });
            }
            if (q.team === a.team) continue;
            if (a.dps > 0) this.damage(q, a.dps * 0.25, a.owner, { charge: 3 });
            if (a.slow > 0 && q.alive) {
              q.slowT = 0.4;
              q.slowAmt = a.slow;
            }
          }
        }
        if (a.pull > 0) {
          for (const q of this.players) {
            if (!q.alive || q.team === a.team || q.leap) continue;
            const dx = a.x - q.x;
            const dy = a.y - q.y;
            const d = Math.hypot(dx, dy);
            if (d > a.r || d < 1) continue;
            this.moveCircle(q, (dx / d) * a.pull * dt, (dy / d) * a.pull * dt, PLAYER_RADIUS);
          }
        }
      }

      if (a.life > 0) keep.push(a);
      else if (a.kind === 'gravity') {
        this.explode(a.x, a.y, a.r * 0.7, a.dps, a.team, a.owner, 'gravity', 20);
      }
    }
    this.areas = keep;
  }

  private stepPets(dt: number) {
    for (const pt of this.pets) {
      pt.life -= dt;
      pt.cd -= dt;
      const owner = this.players[pt.owner];
      if (!owner || !owner.alive) {
        // pets stay a short while after their owner dies
      }
      let best: Ent | null = null;
      let bd = 1e9;
      for (const q of this.players) {
        if (!q.alive || q.team === pt.team) continue;
        const d = dist2(q.x, q.y, pt.x, pt.y);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }

      if (pt.kind === 'healturret') {
        if (pt.cd <= 0) {
          pt.cd = 1;
          for (const q of this.players) {
            if (!q.alive || q.team !== pt.team) continue;
            if (dist2(q.x, q.y, pt.x, pt.y) > pt.range * pt.range) continue;
            q.hp = Math.min(q.maxHp, q.hp + pt.heal);
            this.fx.push({ k: 'heal', x: q.x, y: q.y, v: pt.heal });
          }
        }
        continue;
      }

      if (pt.kind === 'bear') {
        if (best && bd < 150 * 150) {
          const a = Math.atan2(best.y - pt.y, best.x - pt.x);
          pt.aim = a;
          if (bd > 13 * 13) this.moveCircle(pt, Math.cos(a) * 74 * dt, Math.sin(a) * 74 * dt, PET_RADIUS);
          else if (pt.cd <= 0) {
            pt.cd = 0.6;
            this.damage(best, pt.dmg, pt.owner, { charge: 0 });
            this.fx.push({ k: 'maul', x: best.x, y: best.y });
          }
        } else if (owner && owner.alive) {
          const d = Math.hypot(owner.x - pt.x, owner.y - pt.y);
          if (d > 30) {
            const a = Math.atan2(owner.y - pt.y, owner.x - pt.x);
            pt.aim = a;
            this.moveCircle(pt, Math.cos(a) * 66 * dt, Math.sin(a) * 66 * dt, PET_RADIUS);
          }
        }
        continue;
      }

      if (pt.kind === 'turret') {
        if (best && bd < pt.range * pt.range && this.lineOfSight(pt.x, pt.y, best.x, best.y)) {
          const a = Math.atan2(best.y - pt.y, best.x - pt.x);
          pt.aim = a;
          if (pt.cd <= 0) {
            pt.cd = 0.45;
            const fakeDef: AttackDef = {
              name: 'turret',
              kind: 'single',
              damage: pt.dmg,
              reload: 1,
              range: pt.range,
              speed: 340,
              count: 1,
              spread: 0,
              radius: 4,
              charge: 0,
              cd: 0.45,
              visual: 'orb',
            };
            this.spawnProj(pt, pt.team, pt.owner, a, fakeDef, false, 1);
          }
        }
      }
    }
    this.pets = this.pets.filter((p) => p.life > 0 && p.hp > 0);
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const x = x0 + (dx * i) / steps;
      const y = y0 + (dy * i) / steps;
      if (BLOCKS_SHOT.has(this.tileAt(x, y))) return false;
    }
    return true;
  }

  private stepPickups(dt: number) {
    const keep: Pickup[] = [];
    for (const pk of this.pickups) {
      if (pk.pop > 0) {
        pk.pop -= dt;
        this.moveCircle(pk, pk.vx * dt, pk.vy * dt, 3);
        pk.vx *= 0.86;
        pk.vy *= 0.86;
      }
      let taken = false;
      if (pk.pop <= 0.25) {
        for (const q of this.players) {
          if (!q.alive) continue;
          if (dist2(q.x, q.y, pk.x, pk.y) > 13 * 13) continue;
          if (pk.kind === 'gem') {
            q.gems++;
            this.gemsOnField--;
          } else {
            q.cubes++;
            q.maxHp += CUBE_HP;
            q.hp = Math.min(q.maxHp, q.hp + CUBE_HP);
            q.dmgMul += CUBE_DMG_PCT;
          }
          this.fx.push({ k: 'pickup', x: pk.x, y: pk.y, s: pk.kind });
          taken = true;
          break;
        }
      }
      if (!taken) keep.push(pk);
    }
    this.pickups = keep;
  }

  /* ------------------------------ mode rules ---------------------------- */

  private stepMode(dt: number) {
    if (this.mode === GameMode.GemGrab) {
      this.gemTimer -= dt;
      if (this.gemTimer <= 0 && this.gemsOnField < 24) {
        this.gemTimer = GEM_SPAWN_INTERVAL;
        const g = this.map.gemSpawn!;
        this.spawnPickup(g.x * TILE + TILE / 2, g.y * TILE + TILE / 2, 'gem');
      }
      const teamGems = [0, 0];
      for (const p of this.players) if (p.alive || p.gems) teamGems[p.team] += p.gems;
      this.scores[0] = teamGems[0];
      this.scores[1] = teamGems[1];

      const leader = teamGems[0] >= GEM_WIN_COUNT ? 0 : teamGems[1] >= GEM_WIN_COUNT ? 1 : -1;
      if (leader !== this.cdTeam) {
        this.cdTeam = leader;
        this.cdTime = leader >= 0 ? GEM_COUNTDOWN : 0;
      } else if (leader >= 0) {
        this.cdTime -= dt;
        if (this.cdTime <= 0) this.finish(leader);
      }
    }

    if (this.mode === GameMode.Showdown) {
      const t = this.duration - this.phaseTime;
      if (t > POISON_START) {
        this.poison = (t - POISON_START) * POISON_SHRINK_RATE * 0.5;
        const w = this.map.w * TILE;
        const h = this.map.h * TILE;
        const dps = POISON_DPS_BASE + Math.floor((t - POISON_START) / 12) * POISON_DPS_RAMP;
        for (const p of this.players) {
          if (!p.alive) continue;
          const inSafe = p.x > this.poison && p.y > this.poison && p.x < w - this.poison && p.y < h - this.poison;
          if (!inSafe) {
            p.hp -= dps * dt;
            if (p.hp <= 0) this.kill(p, p.slot);
          }
        }
      }
    }
  }

  private checkEnd() {
    if (this.phase !== 'live') return;

    if (this.mode === GameMode.Showdown) {
      const alive = this.players.filter((p) => p.alive);
      if (alive.length <= 1) {
        if (alive[0]) alive[0].rank = 1;
        this.finish(alive[0] ? alive[0].team : -1);
      }
    } else if (this.mode === GameMode.Duel) {
      const a = this.players.filter((p) => p.team === 0).some((p) => p.lives > 0);
      const b = this.players.filter((p) => p.team === 1).some((p) => p.lives > 0);
      this.scores[0] = this.players.filter((p) => p.team === 0).reduce((s, p) => s + Math.max(0, p.lives), 0);
      this.scores[1] = this.players.filter((p) => p.team === 1).reduce((s, p) => s + Math.max(0, p.lives), 0);
      if (!a || !b) this.finish(!a && !b ? -1 : a ? 0 : 1);
    }

    if (this.phaseTime <= 0) {
      let w = -1;
      if (this.mode === GameMode.Showdown) {
        let best = -1;
        let bestHp = -1;
        for (const p of this.players) {
          if (p.alive && p.hp > bestHp) {
            bestHp = p.hp;
            best = p.team;
          }
        }
        w = best;
      } else {
        w = this.scores[0] > this.scores[1] ? 0 : this.scores[1] > this.scores[0] ? 1 : -1;
      }
      this.finish(w);
    }
  }

  private finish(winner: number) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = winner;
    this.phaseTime = 4;

    if (this.mode === GameMode.Showdown) {
      // survivors ranked by health, then everyone who died in reverse order
      const alive = this.players.filter((p) => p.alive).sort((a, b) => b.hp - a.hp);
      alive.forEach((p, i) => (p.rank = i + 1));
      let r = alive.length + 1;
      for (let i = this.deathOrder.length - 1; i >= 0; i--) {
        const p = this.players[this.deathOrder[i]];
        p.rank = r++;
      }
      for (const p of this.players) if (!p.rank) p.rank = this.players.length;
    } else {
      for (const p of this.players) p.rank = winner < 0 ? 2 : p.team === winner ? 1 : 3;
    }
  }

  /* ------------------------------- snapshot ----------------------------- */

  private playerSnap(p: Ent): PlayerSnap {
    let st = 0;
    if (p.alive) st |= 1;
    if (p.inBush && p.exposeT <= 0 && !p.dash) st |= 2;
    if (p.invulnT > 0) st |= 4;
    if (p.slowT > 0) st |= 8;
    if (p.dotT > 0) st |= 16;
    if (p.leap) st |= 32;
    if (p.superCharge >= 100) st |= 64;
    if (p.dash) st |= 128;
    return {
      i: p.slot,
      b: p.def.id,
      n: p.name,
      t: p.team,
      x: Math.round(p.x * 4) / 4,
      y: Math.round(p.y * 4) / 4,
      a: Math.round(p.aim * 100) / 100,
      hp: Math.max(0, Math.round(p.hp)),
      mx: p.maxHp,
      am: Math.round(p.ammo * 100) / 100,
      sc: Math.round(p.superCharge),
      st,
      g: this.mode === GameMode.GemGrab ? p.gems : this.mode === GameMode.Bounty ? p.stars : this.mode === GameMode.Duel ? p.lives : p.cubes,
      k: p.kills,
      bot: p.bot ? 1 : 0,
      cu: p.cubes,
      tr: p.trophies,
      lv: p.level,
    };
  }

  /**
   * Builds the state visible to one slot. Players hidden in bushes are stripped
   * server-side so a modified client cannot see them.
   */
  snapshot(forSlot: number): Snapshot {
    const viewer = this.players[forSlot];
    const spectating = !viewer || (!viewer.alive && this.mode === GameMode.Showdown);

    const players: PlayerSnap[] = [];
    for (const p of this.players) {
      if (!spectating && viewer && p.slot !== viewer.slot && p.team !== viewer.team) {
        const hidden = p.inBush && p.exposeT <= 0 && !p.dash;
        if (hidden && dist2(p.x, p.y, viewer.x, viewer.y) > BUSH_REVEAL_DIST * BUSH_REVEAL_DIST) continue;
      }
      players.push(this.playerSnap(p));
    }

    const projs: ProjSnap[] = this.projs
      .filter((p) => p.traveled >= 0)
      .map((p) => ({
        id: p.id,
        x: Math.round(p.x * 2) / 2,
        y: Math.round(p.y * 2) / 2,
        a: Math.round(Math.atan2(p.vy, p.vx) * 100) / 100,
        k: p.kind,
        t: p.team,
        s: p.scale,
      }));

    const areas: AreaSnap[] = this.areas.map((a) => ({
      id: a.id,
      x: Math.round(a.x),
      y: Math.round(a.y),
      r: Math.round(a.r),
      k: a.kind,
      t: a.team,
      l: Math.max(0, Math.min(1, a.life / a.maxLife)),
    }));

    const pets: PetSnap[] = this.pets.map((p) => ({
      id: p.id,
      x: Math.round(p.x * 2) / 2,
      y: Math.round(p.y * 2) / 2,
      a: Math.round(p.aim * 100) / 100,
      k: p.kind,
      t: p.team,
      hp: Math.max(0, Math.round(p.hp)),
      mx: p.maxHp,
    }));

    const pickups: PickupSnap[] = this.pickups.map((p) => ({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      k: p.kind,
      b: Math.max(0, Math.round(p.pop * 100) / 100),
    }));

    return {
      tick: this.tick,
      phase: this.phase,
      time: Math.max(0, this.phaseTime),
      players,
      projs,
      areas,
      pets,
      pickups,
      broken: this.broken,
      scores: this.scores.slice(0, 2),
      cdTeam: this.cdTeam,
      cdTime: Math.max(0, this.cdTime),
      poison: this.poison,
      fx: this.fx,
      winner: this.winner,
    };
  }

  results() {
    return this.players.map((p) => ({
      slot: p.slot,
      uid: p.uid,
      name: p.name,
      brawler: p.def.id,
      team: p.team,
      rank: p.rank,
      kills: p.kills,
      bot: p.bot,
      score:
        this.mode === GameMode.GemGrab
          ? p.gems
          : this.mode === GameMode.Bounty
            ? p.stars
            : this.mode === GameMode.Duel
              ? Math.max(0, p.lives)
              : p.cubes,
      damage: p.damageDone,
    }));
  }
}

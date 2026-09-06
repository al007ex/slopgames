// The whole game, with no idea that a screen exists. The client draws whatever
// it finds on a Game instance and calls step() once a frame; the tests build the
// same object and step it thousands of times with no browser in sight.

import {
  COLS, ROWS, ENTRY, CORE, START_CREDITS, START_INTEGRITY, BUILD_SECONDS,
  SELL_RATIO, WAVE_CLEAR_BONUS, RUSH_BONUS_PER_SECOND, HEAT_MAX, HEAT_RESET,
  OVERCLOCK, SURGE, TOWERS, UPGRADE_COST_SCALE, PACKETS, MIN_DAMAGE, WAVES,
  VICTORY_BONUS,
} from '#shared/constants.js';
import { createBoard, findPath, canPlace, centreOf, idx, colOf, rowOf, TOWER, EMPTY } from '#shared/grid.js';
import { makeRng } from '#shared/rng.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export const upgradeCost = (type, level) => Math.round(TOWERS[type].cost * UPGRADE_COST_SCALE * level);

export class Game {
  constructor({ seed = 1 } = {}) {
    this.rng = makeRng(seed);
    this.cells = createBoard();
    this.towers = new Map();      // cell index -> tower
    this.packets = [];
    this.shells = [];
    this.effects = [];

    this.credits = START_CREDITS;
    this.integrity = START_INTEGRITY;
    this.creditsEarned = 0;
    this.leaked = 0;
    this.kills = 0;

    this.wave = 0;                // index of the wave about to run
    this.phase = 'build';         // build | wave | over | won
    this.buildTimer = BUILD_SECONDS;
    this.waveTime = 0;
    this.spawnQueue = [];

    this.surgeCooldown = 0;
    this.time = 0;
    this.nextId = 1;
    this.log = [];                // short player-facing messages
  }

  // ---- queries ---------------------------------------------------------

  get waveNumber() { return Math.min(this.wave + 1, WAVES.length); }
  get running() { return this.phase === 'build' || this.phase === 'wave'; }

  /** Cells packets are standing on, so placement cannot strand one. */
  occupiedCells() {
    const set = new Set();
    for (const packet of this.packets) {
      set.add(idx(clamp(Math.floor(packet.x), 0, COLS - 1), clamp(Math.floor(packet.y), 0, ROWS - 1)));
    }
    return set;
  }

  /** The route packets are currently taking, for the board preview. */
  currentPath() { return findPath(this.cells) || []; }

  score() {
    const cleared = this.phase === 'won' ? WAVES.length : this.wave;
    // The core bonus only counts once a wave has actually been held, so a run
    // that has not started yet reads zero instead of a free five figures.
    const intact = cleared > 0 ? Math.max(0, this.integrity) * 300 : 0;
    return Math.round(
      cleared * 1000 + this.creditsEarned + intact
      + (this.phase === 'won' ? VICTORY_BONUS : 0),
    );
  }

  note(text) {
    this.log.push({ text, at: this.time });
    if (this.log.length > 6) this.log.shift();
  }

  // ---- building --------------------------------------------------------

  placementCheck(col, row) { return canPlace(this.cells, col, row, this.occupiedCells()); }

  place(col, row, type) {
    const spec = TOWERS[type];
    if (!spec) return { ok: false, reason: 'Unknown tower.' };
    if (this.credits < spec.cost) return { ok: false, reason: 'Not enough credits.' };
    const check = this.placementCheck(col, row);
    if (!check.ok) return check;

    const cell = idx(col, row);
    this.cells[cell] = TOWER;
    this.towers.set(cell, {
      cell, col, row, type, level: 1,
      heat: 0, overheated: false, cooldown: 0,
      overclockLeft: 0, overclockCooldown: 0,
      invested: spec.cost, ramp: 0, targetId: null, angle: 0,
    });
    this.credits -= spec.cost;
    this.repathAll();
    return { ok: true };
  }

  sell(cell) {
    const tower = this.towers.get(cell);
    if (!tower) return { ok: false, reason: 'Nothing there.' };
    this.towers.delete(cell);
    this.cells[cell] = EMPTY;
    this.credits += Math.round(tower.invested * SELL_RATIO);
    this.repathAll();
    return { ok: true };
  }

  upgrade(cell) {
    const tower = this.towers.get(cell);
    if (!tower) return { ok: false, reason: 'Nothing there.' };
    const spec = TOWERS[tower.type];
    if (tower.level >= spec.levels.length) return { ok: false, reason: 'Already at maximum.' };
    const cost = upgradeCost(tower.type, tower.level);
    if (this.credits < cost) return { ok: false, reason: 'Not enough credits.' };
    this.credits -= cost;
    tower.invested += cost;
    tower.level += 1;
    return { ok: true };
  }

  overclock(cell) {
    const tower = this.towers.get(cell);
    if (!tower) return { ok: false, reason: 'Nothing there.' };
    if (tower.overclockCooldown > 0) return { ok: false, reason: 'Still recharging.' };
    tower.overclockLeft = OVERCLOCK.seconds;
    tower.overclockCooldown = OVERCLOCK.cooldown;
    // Overclocking a shut-down tower is exactly when you need it most, so it
    // force-restarts rather than refusing.
    tower.overheated = false;
    tower.heat = Math.min(tower.heat, HEAT_RESET);
    return { ok: true };
  }

  surge() {
    if (this.surgeCooldown > 0) return { ok: false, reason: 'Surge is recharging.' };
    this.surgeCooldown = SURGE.cooldown;
    this.effects.push({ kind: 'surge', life: 0.6, ttl: 0.6 });
    for (const packet of this.packets) {
      this.damage(packet, SURGE.damage, { ignorePhase: true });
      packet.stunUntil = this.time + SURGE.stunSeconds;
    }
    this.reap();
    return { ok: true };
  }

  /** Skip the rest of the build phase and get paid for the time saved. */
  rush() {
    if (this.phase !== 'build') return { ok: false, reason: 'A wave is already running.' };
    const bonus = Math.round(Math.max(0, this.buildTimer) * RUSH_BONUS_PER_SECOND);
    this.credits += bonus;
    this.creditsEarned += bonus;
    this.buildTimer = 0;
    this.startWave();
    if (bonus > 0) this.note(`Rush bonus +${bonus}₡`);
    return { ok: true, bonus };
  }

  // ---- waves -----------------------------------------------------------

  startWave() {
    const def = WAVES[this.wave];
    if (!def) return;
    this.spawnQueue = [];
    for (const group of def.groups) {
      const delay = group.delay || 0;
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({ at: delay + i * group.gap, type: group.type, hpScale: def.hpScale });
      }
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.waveTime = 0;
    this.phase = 'wave';
  }

  spawn(type, hpScale, atCell = null) {
    const spec = PACKETS[type];
    const cell = atCell ?? idx(ENTRY.col, ENTRY.row);
    const path = findPath(this.cells, colOf(cell), rowOf(cell));
    if (!path) return null;
    const start = centreOf(cell);
    const packet = {
      id: this.nextId++,
      type,
      x: start.x,
      y: start.y,
      hp: spec.hp * hpScale,
      maxHp: spec.hp * hpScale,
      speed: spec.speed,
      armor: spec.armor,
      bounty: spec.bounty,
      damage: spec.damage,
      radius: spec.radius,
      boss: Boolean(spec.boss),
      path,
      step: path.length > 1 ? 1 : 0,
      slowUntil: 0,
      slowFactor: 1,
      stunUntil: 0,
      age: 0,
      phaseOffset: this.rng() * 3,
      phasing: false,
      hpScale,
      alive: true,
    };
    this.packets.push(packet);
    return packet;
  }

  // ---- movement --------------------------------------------------------

  repathAll() {
    for (const packet of this.packets) this.repath(packet);
  }

  repath(packet) {
    const cell = idx(
      clamp(Math.floor(packet.x), 0, COLS - 1),
      clamp(Math.floor(packet.y), 0, ROWS - 1),
    );
    const path = findPath(this.cells, colOf(cell), rowOf(cell));
    if (!path) return false;
    packet.path = path;
    packet.step = path.length > 1 ? 1 : 0;
    return true;
  }

  speedOf(packet) {
    if (packet.stunUntil > this.time) return 0;
    return packet.speed * (packet.slowUntil > this.time ? packet.slowFactor : 1);
  }

  // ---- damage ----------------------------------------------------------

  /** Returns the damage actually dealt, after armour and phasing. */
  damage(packet, amount, { ignorePhase = false } = {}) {
    if (!packet.alive) return 0;
    if (packet.phasing && !ignorePhase) return 0;
    const dealt = Math.max(MIN_DAMAGE, amount - packet.armor);
    packet.hp -= dealt;
    if (packet.hp <= 0) packet.alive = false;
    return dealt;
  }

  /** Pay out and split anything that died this tick. */
  reap() {
    if (!this.packets.some((packet) => !packet.alive)) return;
    const spawned = [];
    for (const packet of this.packets) {
      if (packet.alive) continue;
      this.credits += packet.bounty;
      this.creditsEarned += packet.bounty;
      this.kills += 1;
      this.effects.push({ kind: 'pop', x: packet.x, y: packet.y, life: 0.35, ttl: 0.35, boss: packet.boss });
      const splits = PACKETS[packet.type].splits;
      if (splits) {
        const cell = idx(
          clamp(Math.floor(packet.x), 0, COLS - 1),
          clamp(Math.floor(packet.y), 0, ROWS - 1),
        );
        for (let i = 0; i < splits.count; i++) spawned.push({ type: splits.type, cell, hpScale: packet.hpScale });
      }
    }
    this.packets = this.packets.filter((packet) => packet.alive);
    for (const child of spawned) this.spawn(child.type, child.hpScale, child.cell);
  }

  // ---- towers ----------------------------------------------------------

  /**
   * Whichever packet in range is closest to the core. Targeting the leader is
   * what makes a maze worth building — the long way round is only useful if the
   * towers keep shooting at whatever is about to get out.
   */
  pickTarget(tower, range) {
    let best = null;
    let bestRemaining = Infinity;
    for (const packet of this.packets) {
      if (!packet.alive || packet.phasing) continue;
      if (dist(tower.col + 0.5, tower.row + 0.5, packet.x, packet.y) > range) continue;
      const remaining = packet.path.length - packet.step;
      if (remaining < bestRemaining || (remaining === bestRemaining && packet.id < (best?.id ?? Infinity))) {
        best = packet;
        bestRemaining = remaining;
      }
    }
    return best;
  }

  fire(tower, spec, level, target) {
    const boosted = tower.overclockLeft > 0;
    const damageScale = boosted ? OVERCLOCK.damageScale : 1;
    const heat = spec.heatPerShot * (boosted ? OVERCLOCK.heatScale : 1);
    const ox = tower.col + 0.5;
    const oy = tower.row + 0.5;
    tower.angle = Math.atan2(target.y - oy, target.x - ox);

    switch (spec.kind) {
      case 'beam': {
        this.damage(target, level.damage * damageScale);
        this.effects.push({ kind: 'beam', x1: ox, y1: oy, x2: target.x, y2: target.y, colour: spec.accent, life: 0.09, ttl: 0.09 });
        break;
      }
      case 'chain': {
        const hit = [target];
        let current = target;
        let power = level.damage * damageScale;
        this.damage(current, power);
        for (let jump = 1; jump < spec.chainTargets; jump++) {
          let next = null;
          let nearest = Infinity;
          for (const packet of this.packets) {
            if (!packet.alive || packet.phasing || hit.includes(packet)) continue;
            const d = dist(current.x, current.y, packet.x, packet.y);
            if (d < nearest && d <= 2.4) { nearest = d; next = packet; }
          }
          if (!next) break;
          power *= spec.chainFalloff;
          this.damage(next, power);
          hit.push(next);
          current = next;
        }
        this.effects.push({
          kind: 'chain',
          points: [{ x: ox, y: oy }, ...hit.map((packet) => ({ x: packet.x, y: packet.y }))],
          colour: spec.accent, life: 0.13, ttl: 0.13,
        });
        break;
      }
      case 'slow': {
        for (const packet of this.packets) {
          if (!packet.alive || dist(target.x, target.y, packet.x, packet.y) > spec.splash) continue;
          this.damage(packet, level.damage * damageScale);
          packet.slowUntil = this.time + spec.slowSeconds;
          packet.slowFactor = spec.slowFactor;
        }
        this.effects.push({ kind: 'ring', x: target.x, y: target.y, r: spec.splash, colour: spec.accent, life: 0.3, ttl: 0.3 });
        break;
      }
      case 'shell': {
        this.shells.push({
          x: ox, y: oy, tx: target.x, ty: target.y,
          speed: spec.shellSpeed, splash: spec.splash,
          damage: level.damage * damageScale, colour: spec.accent,
        });
        break;
      }
      case 'laser': {
        // The ramp is the point of this tower: it is weak on a fresh target and
        // frightening on one it has been holding.
        const multiplier = Math.min(spec.rampMax, 1 + tower.ramp);
        this.damage(target, level.damage * multiplier * damageScale);
        this.effects.push({ kind: 'laser', x1: ox, y1: oy, x2: target.x, y2: target.y, colour: spec.accent, width: multiplier, life: 0.08, ttl: 0.08 });
        break;
      }
      default: break;
    }

    tower.heat = Math.min(HEAT_MAX, tower.heat + heat);
    // An overclocked tower is deliberately allowed past the redline: it keeps
    // firing for the whole window and the shutdown lands the moment the boost
    // ends. Paying afterwards is what makes the button worth pressing.
    if (tower.heat >= HEAT_MAX && tower.overclockLeft <= 0) {
      tower.overheated = true;
      tower.ramp = 0;
      this.effects.push({ kind: 'overheat', x: ox, y: oy, life: 0.5, ttl: 0.5 });
    }
  }

  updateTower(tower, dt) {
    const spec = TOWERS[tower.type];
    const level = spec.levels[tower.level - 1];

    const wasBoosted = tower.overclockLeft > 0;
    if (tower.overclockLeft > 0) tower.overclockLeft = Math.max(0, tower.overclockLeft - dt);
    if (tower.overclockCooldown > 0) tower.overclockCooldown = Math.max(0, tower.overclockCooldown - dt);
    if (wasBoosted && tower.overclockLeft === 0 && tower.heat >= HEAT_MAX) {
      tower.overheated = true;
      tower.ramp = 0;
      this.effects.push({ kind: 'overheat', x: tower.col + 0.5, y: tower.row + 0.5, life: 0.5, ttl: 0.5 });
    }

    tower.heat = Math.max(0, tower.heat - spec.coolRate * dt);
    if (tower.overheated) {
      if (tower.heat <= HEAT_RESET) tower.overheated = false;
      tower.targetId = null;
      return;
    }

    const target = this.pickTarget(tower, level.range);
    if (!target) {
      tower.targetId = null;
      tower.ramp = 0;
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      return;
    }

    if (spec.kind === 'laser') {
      if (tower.targetId === target.id) tower.ramp = Math.min(spec.rampMax - 1, tower.ramp + spec.rampPerSecond * dt);
      else tower.ramp = 0;
    }
    tower.targetId = target.id;

    tower.cooldown -= dt;
    const interval = level.fireRate / (tower.overclockLeft > 0 ? OVERCLOCK.fireRateScale : 1);
    // A generous frame (or a tab that was in the background) must not let a
    // tower bank a dozen shots, so at most one shot resolves per step.
    if (tower.cooldown <= 0) {
      this.fire(tower, spec, level, target);
      tower.cooldown = interval;
    }
  }

  // ---- the loop --------------------------------------------------------

  step(dt) {
    if (!this.running) return;
    // Clamped so a stalled tab resumes instead of teleporting a whole wave into
    // the core on the first frame back.
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (this.surgeCooldown > 0) this.surgeCooldown = Math.max(0, this.surgeCooldown - dt);

    if (this.phase === 'build') {
      this.buildTimer -= dt;
      if (this.buildTimer <= 0) this.startWave();
    }

    if (this.phase === 'wave') {
      this.waveTime += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveTime) {
        const next = this.spawnQueue.shift();
        this.spawn(next.type, next.hpScale);
      }
    }

    // Packets
    const goal = idx(CORE.col, CORE.row);
    for (const packet of this.packets) {
      packet.age += dt;
      const phase = PACKETS[packet.type].phase;
      if (phase) {
        const cycle = (packet.age + packet.phaseOffset) % phase.every;
        packet.phasing = cycle < phase.seconds;
      }
      let budget = this.speedOf(packet) * dt;
      while (budget > 0 && packet.step < packet.path.length) {
        const target = centreOf(packet.path[packet.step]);
        const dx = target.x - packet.x;
        const dy = target.y - packet.y;
        const d = Math.hypot(dx, dy);
        if (d <= budget) {
          packet.x = target.x;
          packet.y = target.y;
          packet.step += 1;
          budget -= d;
        } else {
          packet.x += (dx / d) * budget;
          packet.y += (dy / d) * budget;
          budget = 0;
        }
      }
      if (packet.step >= packet.path.length && packet.path[packet.path.length - 1] === goal) {
        packet.alive = false;
        packet.leaked = true;
      }
    }

    // Leaks cost integrity and pay no bounty, so they are pulled out before reap.
    const leakers = this.packets.filter((packet) => packet.leaked);
    if (leakers.length) {
      for (const packet of leakers) {
        this.integrity -= packet.damage;
        this.leaked += 1;
        this.effects.push({ kind: 'breach', x: CORE.col + 0.5, y: CORE.row + 0.5, life: 0.45, ttl: 0.45 });
      }
      this.packets = this.packets.filter((packet) => !packet.leaked);
    }

    for (const tower of this.towers.values()) this.updateTower(tower, dt);

    // Shells
    for (const shell of this.shells) {
      const dx = shell.tx - shell.x;
      const dy = shell.ty - shell.y;
      const d = Math.hypot(dx, dy);
      const travel = shell.speed * dt;
      if (d <= travel) {
        for (const packet of this.packets) {
          if (!packet.alive) continue;
          if (dist(shell.tx, shell.ty, packet.x, packet.y) > shell.splash) continue;
          this.damage(packet, shell.damage);
        }
        this.effects.push({ kind: 'blast', x: shell.tx, y: shell.ty, r: shell.splash, colour: shell.colour, life: 0.32, ttl: 0.32 });
        shell.done = true;
      } else {
        shell.x += (dx / d) * travel;
        shell.y += (dy / d) * travel;
      }
    }
    this.shells = this.shells.filter((shell) => !shell.done);

    this.reap();

    for (const effect of this.effects) effect.ttl -= dt;
    this.effects = this.effects.filter((effect) => effect.ttl > 0);

    if (this.integrity <= 0) {
      this.integrity = 0;
      this.phase = 'over';
      return;
    }

    if (this.phase === 'wave' && !this.spawnQueue.length && !this.packets.length) {
      this.credits += WAVE_CLEAR_BONUS;
      this.creditsEarned += WAVE_CLEAR_BONUS;
      this.wave += 1;
      if (this.wave >= WAVES.length) {
        this.phase = 'won';
      } else {
        this.phase = 'build';
        this.buildTimer = BUILD_SECONDS;
        this.note(`Wave ${this.wave} held. +${WAVE_CLEAR_BONUS}₡`);
      }
    }
  }
}

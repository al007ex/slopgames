// The authority.
//
// Everything that two clients could disagree about is decided here and only
// here: enemy positions, who got hit, how much damage, whether a task is done,
// and when the level advances. Clients send intent; the server sends truth.

import {
  MAX_HP, RESPAWN_SECONDS, WEAPONS, ENEMY_TYPES,
  REWARD_TASK, REWARD_LEVEL, COSMETICS,
} from '../shared/constants.js';
import { CAMPAIGN, LEVELS, QUEST_TEXT, TUTORIAL_STEPS } from '../shared/levels.js';
import {
  buildWorld, setGate, collideMove, raycastWorld, rayAABB,
  hasLineOfSight, dist3D, normalize,
} from '../shared/collision.js';

const ENEMY_R = 0.45;
const ENEMY_H = 1.8;

function finiteVec(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.phase = 'lobby';           // lobby | playing | ended
    this.paused = false;
    this.pauseReason = '';

    this.stage = -1;
    this.level = null;
    this.world = null;

    this.enemies = new Map();
    this.nextEid = 1;

    this.waveIndex = -1;
    this.waveState = 'idle';        // idle | active | done
    this.waveTimer = 0;

    this.tasks = new Map();
    this.completedTasks = new Set(); // `${levelId}:${taskId}` — survives hub revisits
    this.openGates = new Set();
    this.levelComplete = false;
    this.tutorialStep = 0;
    this.hintCooldownUntil = 0;

    // Simulation clock in ms, advanced only by tick(dt). Every gameplay timer
    // (attack cooldowns, respawns, the synced-switch window) reads this rather
    // than Date.now(), so the sim is deterministic and testable.
    this.clock = 0;

    this.stats = { kills: 0, deaths: 0, tasks: 0, startedAt: 0 };
  }

  // ------------------------------------------------------------- membership

  get slotsUsed() {
    return this.players.size;
  }

  addPlayer(socket, name) {
    if (this.players.size >= 2) return null;
    const taken = new Set([...this.players.values()].map((p) => p.slot));
    const slot = taken.has(0) ? 1 : 0;
    const p = {
      id: socket.id,
      name: (name || `Player ${slot + 1}`).slice(0, 14),
      slot,
      ready: false,
      pos: [0, 0, 0], yaw: 0, pitch: 0, anim: 0,
      hp: MAX_HP, alive: true, downUntil: 0,
      weapon: 'rifle',
      currency: 0, owned: ['c_default'], color: COSMETICS[0].color,
      kills: 0, deaths: 0,
      lastShotAt: -1e6,   // never rate-limit the first shot of a run
      interacting: false, blocking: false,
      carrying: null,
      checkpoint: 0,
      tutorial: {},
    };
    this.players.set(socket.id, p);
    socket.join(this.code);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    // drop anything they were carrying
    for (const rt of this.tasks.values()) {
      if (rt.kind === 'fetch' && rt.carrier === id) {
        rt.carrier = null;
        rt.itemPos = [...rt.def.item.p];
      }
    }
    if (this.phase === 'playing') {
      this.paused = true;
      this.pauseReason = `${p.name} disconnected`;
    }
  }

  rejoinable() {
    return this.phase === 'playing' && this.players.size < 2;
  }

  // ------------------------------------------------------------- lobby/flow

  setReady(id, ready) {
    const p = this.players.get(id);
    if (p) p.ready = !!ready;
  }

  canStart() {
    return this.phase === 'lobby' && this.players.size === 2 &&
      [...this.players.values()].every((p) => p.ready);
  }

  start() {
    if (!this.canStart()) return false;
    this.phase = 'playing';
    this.stats = { kills: 0, deaths: 0, tasks: 0, startedAt: Date.now() };
    this.completedTasks.clear();
    this.loadStage(0);
    return true;
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.paused = false;
    this.stage = -1;
    this.level = null;
    this.world = null;
    this.enemies.clear();
    this.tasks.clear();
    this.completedTasks.clear();
    this.openGates.clear();
    this.levelComplete = false;
    for (const p of this.players.values()) {
      p.ready = false;
      p.hp = MAX_HP; p.alive = true;
      p.currency = 0; p.owned = ['c_default']; p.color = COSMETICS[0].color;
      p.kills = 0; p.deaths = 0; p.carrying = null; p.tutorial = {};
    }
    this.emitLobby();
  }

  loadStage(stage) {
    this.stage = stage;
    const id = CAMPAIGN[stage];
    this.level = LEVELS[id];
    this.world = buildWorld(this.level);
    this.enemies.clear();
    this.openGates.clear();
    this.levelComplete = false;
    this.tutorialStep = 0;
    this.waveIndex = -1;
    this.waveState = this.level.waves ? 'idle' : 'done';
    this.waveTimer = this.level.waves ? this.level.waves[0].delay : 0;

    this.initTasks();

    for (const e of this.level.enemies || []) this.spawnEnemy(e.type, e.p);

    for (const p of this.players.values()) {
      p.checkpoint = 0;
      p.alive = true;
      p.hp = MAX_HP;
      p.carrying = null;
      p.tutorial = {};
      p.pos = [...(this.level.spawns[p.slot] || this.level.spawns[0])];
    }

    // A level with nothing to do (e.g. a revisited hub) opens immediately.
    this.checkLevelState();

    this.io.to(this.code).emit('level', {
      stage,
      levelId: id,
      total: CAMPAIGN.length,
      spawns: [...this.players.values()].map((p) => ({ id: p.id, pos: p.pos })),
      questText: QUEST_TEXT[stage + 1] || null,
    });
  }

  advanceStage() {
    if (this.level.id !== 'hub') {
      for (const p of this.players.values()) p.currency += REWARD_LEVEL;
    }
    const next = this.stage + 1;
    if (next >= CAMPAIGN.length) return this.endGame();
    this.loadStage(next);
  }

  endGame() {
    this.phase = 'ended';
    const seconds = Math.round((Date.now() - this.stats.startedAt) / 1000);
    this.io.to(this.code).emit('gameover', {
      seconds,
      kills: this.stats.kills,
      deaths: this.stats.deaths,
      tasks: this.stats.tasks,
      players: [...this.players.values()].map((p) => ({
        name: p.name, kills: p.kills, deaths: p.deaths,
        currency: p.currency, cosmetics: p.owned.length,
      })),
    });
  }

  // ------------------------------------------------------------------ tasks

  initTasks() {
    this.tasks.clear();
    for (const def of this.level.tasks || []) {
      const done = this.completedTasks.has(`${this.level.id}:${def.id}`);
      const rt = { id: def.id, kind: def.kind, def, done };
      if (def.kind === 'hold') { rt.progress = 0; rt.holders = []; }
      if (def.kind === 'synced') rt.flips = {};
      if (def.kind === 'fetch') { rt.carrier = null; rt.itemPos = [...def.item.p]; }
      if (def.kind === 'defend') rt.holder = null;
      if (def.kind === 'pattern') {
        rt.seq = Array.from({ length: def.length },
          () => def.buttons[Math.floor(Math.random() * def.buttons.length)].id);
        rt.input = [];
        rt.showing = false;
        rt.showAt = 0;
        rt.nextShow = 0;
      }
      this.tasks.set(def.id, rt);
    }
  }

  taskActive(rt) {
    const from = rt.def.activeFromWave;
    if (from && this.waveIndex + 1 < from) return false;
    return true;
  }

  updateTasks(dt) {
    const now = this.clock;
    for (const rt of this.tasks.values()) {
      if (rt.done || !this.taskActive(rt)) continue;
      const def = rt.def;

      if (rt.kind === 'hold') {
        const holders = [...this.players.values()]
          .filter((p) => p.alive && p.interacting && this.nearPoint(p, def.p, def.r));
        rt.holders = holders.map((p) => p.id);
        rt.progress = holders.length
          ? Math.min(def.seconds, rt.progress + dt * holders.length)
          : 0;
        if (rt.progress >= def.seconds) this.completeTask(rt);

      } else if (rt.kind === 'synced') {
        for (const k of Object.keys(rt.flips)) {
          if (now - rt.flips[k] > def.windowMs) delete rt.flips[k];
        }
        const ids = def.pads.map((x) => x.id);
        if (ids.every((id) => rt.flips[id])) {
          const times = ids.map((id) => rt.flips[id]);
          if (Math.max(...times) - Math.min(...times) <= def.windowMs) this.completeTask(rt);
        }

      } else if (rt.kind === 'fetch') {
        const carrier = rt.carrier ? this.players.get(rt.carrier) : null;
        if (carrier && carrier.alive) {
          rt.itemPos = [carrier.pos[0], carrier.pos[1] + 1.3, carrier.pos[2]];
          if (carrier.interacting && this.nearPoint(carrier, def.console.p, def.console.r)) {
            carrier.carrying = null;
            this.completeTask(rt);
          }
        } else if (rt.carrier) {
          rt.carrier = null;
          rt.itemPos = [...def.item.p];
          this.event({ type: 'toast', text: 'The core was dropped — it is back at the shaft.' });
        }

      } else if (rt.kind === 'defend') {
        const holder = [...this.players.values()]
          .find((p) => p.alive && p.interacting && this.nearPoint(p, def.hold.p, def.hold.r));
        rt.holder = holder ? holder.id : null;

      } else if (rt.kind === 'pattern') {
        const near = [...this.players.values()]
          .some((p) => p.alive && this.nearPoint(p, def.p, def.r, 4));
        if (near && !rt.showing && rt.input.length === 0 && now >= rt.nextShow) {
          rt.showing = true;
          rt.showAt = now + def.length * 650 + 800;
          rt.nextShow = rt.showAt + 500;
          this.event({ type: 'pattern', id: rt.id, seq: rt.seq });
        }
        if (rt.showing && now >= rt.showAt) rt.showing = false;
      }
    }
  }

  completeTask(rt) {
    if (rt.done) return;
    rt.done = true;
    this.completedTasks.add(`${this.level.id}:${rt.id}`);
    this.stats.tasks++;
    for (const p of this.players.values()) p.currency += REWARD_TASK;
    this.event({ type: 'task', id: rt.id, label: rt.def.label, reward: REWARD_TASK });
  }

  // -- intent handlers (all validated against server-side positions) --------

  onFlip(p, taskId, padId) {
    const rt = this.tasks.get(taskId);
    if (!rt || rt.done || rt.kind !== 'synced' || !p.alive) return;
    const pad = rt.def.pads.find((x) => x.id === padId);
    if (!pad || !this.nearPoint(p, pad.p, pad.r)) return;
    rt.flips[padId] = this.clock;
    this.event({ type: 'flip', id: taskId, pad: padId, by: p.id, name: p.name });
  }

  onPickup(p, taskId) {
    const rt = this.tasks.get(taskId);
    if (!rt || rt.done || rt.kind !== 'fetch' || !p.alive) return;
    if (rt.carrier) return;
    if (!this.nearPoint(p, rt.itemPos, 2.6)) return;
    rt.carrier = p.id;
    p.carrying = taskId;
    this.event({ type: 'pickup', id: taskId, by: p.id, name: p.name });
  }

  onGoal(p, taskId) {
    const rt = this.tasks.get(taskId);
    if (!rt || rt.done || rt.kind !== 'defend' || !p.alive) return;
    if (!this.nearPoint(p, rt.def.goal.p, rt.def.goal.r)) return;
    if (!rt.holder) {
      this.eventTo(p.id, { type: 'toast', text: 'Nobody is holding it — your partner has to be on the pad.' });
      return;
    }
    if (rt.holder === p.id) {
      this.eventTo(p.id, { type: 'toast', text: 'You cannot hold it and throw it. This one needs both of you.' });
      return;
    }
    this.completeTask(rt);
  }

  onPress(p, taskId, buttonId) {
    const rt = this.tasks.get(taskId);
    if (!rt || rt.done || rt.kind !== 'pattern' || !p.alive || rt.showing) return;
    const btn = rt.def.buttons.find((b) => b.id === buttonId);
    if (!btn || !this.nearPoint(p, btn.p, 2.0)) return;
    if (rt.seq[rt.input.length] === buttonId) {
      rt.input.push(buttonId);
      this.event({ type: 'press', id: taskId, pad: buttonId, ok: true });
      if (rt.input.length === rt.seq.length) this.completeTask(rt);
    } else {
      rt.input = [];
      rt.nextShow = this.clock + 800;
      this.event({ type: 'press', id: taskId, pad: buttonId, ok: false });
    }
  }

  // ----------------------------------------------------------------- combat

  spawnEnemy(type, pos) {
    const st = ENEMY_TYPES[type];
    if (!st) return null;
    const e = {
      id: this.nextEid++,
      type,
      pos: [pos[0], pos[1], pos[2]],
      yaw: 0,
      hp: st.hp,
      maxHp: st.hp,
      nextAttack: this.clock + 600,
      strafe: 0,
      strafeUntil: 0,
    };
    this.enemies.set(e.id, e);
    return e;
  }

  enemyBox(e) {
    const s = ENEMY_TYPES[e.type].scale;
    return {
      min: [e.pos[0] - ENEMY_R * s, e.pos[1], e.pos[2] - ENEMY_R * s],
      max: [e.pos[0] + ENEMY_R * s, e.pos[1] + ENEMY_H * s, e.pos[2] + ENEMY_R * s],
    };
  }

  onFire(p, msg) {
    if (this.phase !== 'playing' || this.paused || !p.alive) return;
    if (this.level.noCombat) return;
    const w = WEAPONS[msg.weapon];
    if (!w || w.kind !== 'gun') return;
    if (!finiteVec(msg.origin) || !Array.isArray(msg.dirs) || msg.dirs.length !== w.pellets) return;

    const now = this.clock;
    if (now - p.lastShotAt < (60000 / w.rpm) * 0.85) return;
    p.lastShotAt = now;

    const results = [];
    for (const raw of msg.dirs) {
      if (!finiteVec(raw)) continue;
      const d = normalize(raw);
      const geo = raycastWorld(this.world, msg.origin, d, w.range);
      let bestT = geo.hit ? geo.dist : w.range;
      let hit = null;
      for (const e of this.enemies.values()) {
        const box = this.enemyBox(e);
        const t = rayAABB(msg.origin, d, box.min, box.max);
        if (t >= 0 && t < bestT) { bestT = t; hit = e; }
      }
      const point = [
        msg.origin[0] + d[0] * bestT,
        msg.origin[1] + d[1] * bestT,
        msg.origin[2] + d[2] * bestT,
      ];
      if (hit) {
        const s = ENEMY_TYPES[hit.type].scale;
        const head = point[1] > hit.pos[1] + 1.42 * s;
        const dmg = w.damage * (head ? w.headMul : 1) * (this.level.gunDamageMul ?? 1);
        results.push({ point, enemy: hit.id, head });
        this.hurtEnemy(hit, dmg, p, point, head);
      } else {
        results.push({ point, normal: geo.normal || [0, 1, 0] });
      }
    }
    this.event({ type: 'shot', by: p.id, weapon: w.id, origin: msg.origin, results });
  }

  onMelee(p, msg) {
    if (this.phase !== 'playing' || this.paused || !p.alive) return;
    if (this.level.noCombat) return;
    if (!finiteVec(msg.origin) || !finiteVec(msg.dir)) return;
    const w = WEAPONS.sword;
    const now = this.clock;
    if (now - p.lastShotAt < (60000 / w.rpm) * 0.85) return;
    p.lastShotAt = now;

    this.event({ type: 'swing', by: p.id });

    const dir = normalize(msg.dir);
    const cosArc = Math.cos((w.arcDeg * Math.PI) / 180);
    let best = null;
    let bestD = Infinity;
    for (const e of this.enemies.values()) {
      const mid = [e.pos[0], e.pos[1] + 0.9, e.pos[2]];
      const d = dist3D(msg.origin, mid);
      if (d > w.range) continue;
      const to = normalize([mid[0] - msg.origin[0], mid[1] - msg.origin[1], mid[2] - msg.origin[2]]);
      if (to[0] * dir[0] + to[1] * dir[1] + to[2] * dir[2] < cosArc) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      const point = [best.pos[0], best.pos[1] + 1.0, best.pos[2]];
      this.hurtEnemy(best, w.damage, p, point, false);
    }
  }

  hurtEnemy(e, dmg, by, point, head) {
    e.hp -= dmg;
    const killed = e.hp <= 0;
    this.event({
      type: 'ehit', id: e.id, dmg: Math.round(dmg), head, point, killed, by: by.id,
    });
    if (!killed) return;
    this.enemies.delete(e.id);
    by.kills++;
    this.stats.kills++;
    const reward = ENEMY_TYPES[e.type].reward;
    if (reward) by.currency += reward;
    if (this.level.tutorial && e.type === 'dummy') this.markTutorial(by, 'shoot');
  }

  damagePlayer(p, amount, from) {
    if (!p.alive || this.level.noCombat) return;
    const dmg = p.blocking ? amount * WEAPONS.sword.blockMul : amount;
    p.hp -= dmg;
    this.event({
      type: 'hurt', id: p.id, hp: Math.max(0, Math.round(p.hp)),
      amount: Math.round(dmg), from: from ? from.pos : null, blocked: p.blocking,
    });
    if (p.hp > 0) return;
    p.hp = 0;
    p.alive = false;
    p.downUntil = this.clock + RESPAWN_SECONDS * 1000;
    p.deaths++;
    this.stats.deaths++;
    this.event({ type: 'down', id: p.id, name: p.name });
  }

  // ------------------------------------------------------------------ waves

  updateWaves(dt) {
    const lv = this.level;
    if (!lv.waves || this.waveState === 'done') return;

    if (this.waveState === 'idle') {
      this.waveTimer -= dt;
      if (this.waveTimer > 0) return;
      this.waveIndex++;
      if (this.waveIndex >= lv.waves.length) { this.waveState = 'done'; return; }
      this.spawnWave(lv.waves[this.waveIndex]);
      this.waveState = 'active';
      this.event({ type: 'wave', index: this.waveIndex + 1, total: lv.waves.length });
      return;
    }

    if (this.waveState === 'active' && this.enemies.size === 0) {
      if (this.waveIndex + 1 >= lv.waves.length) {
        this.waveState = 'done';
        this.event({ type: 'waveclear', last: true });
      } else {
        this.waveState = 'idle';
        this.waveTimer = lv.waves[this.waveIndex + 1].delay;
        this.event({ type: 'waveclear', last: false, next: this.waveIndex + 2 });
      }
    }
  }

  spawnWave(wave) {
    const pts = this.level.spawnPoints || this.level.spawns;
    let i = Math.floor(Math.random() * pts.length);
    for (const [type, count] of wave.enemies) {
      for (let n = 0; n < count; n++) {
        const base = pts[i % pts.length];
        i++;
        const pos = [
          base[0] + (Math.random() - 0.5) * 4,
          base[1],
          base[2] + (Math.random() - 0.5) * 4,
        ];
        this.spawnEnemy(type, pos);
      }
    }
  }

  // ---------------------------------------------------------------- enemy AI
  // ONE script. Zombies, gunmen and brutes differ only by the stats block.

  updateEnemies(dt) {
    const now = this.clock;
    for (const e of this.enemies.values()) {
      const st = ENEMY_TYPES[e.type];
      const target = this.nearestAlivePlayer(e.pos);
      if (!target) continue;

      const d = dist3D(e.pos, target.pos);
      e.yaw = Math.atan2(target.pos[0] - e.pos[0], target.pos[2] - e.pos[2]);

      const stopAt = st.ranged ? Math.max(7, st.range * 0.55) : st.range * 0.75;
      const disp = [0, -0.45, 0];
      if (st.speed > 0 && d > stopAt) {
        let dx = target.pos[0] - e.pos[0];
        let dz = target.pos[2] - e.pos[2];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        if (now < e.strafeUntil) {
          const t = dx;
          dx = -dz * e.strafe;
          dz = t * e.strafe;
        }
        const step = st.speed * dt;
        disp[0] = dx * step;
        disp[2] = dz * step;

        const beforeX = e.pos[0];
        const beforeZ = e.pos[2];
        collideMove(this.world, e.pos, ENEMY_R * st.scale, ENEMY_H * st.scale, disp);
        const moved = Math.hypot(e.pos[0] - beforeX, e.pos[2] - beforeZ);
        // blocked? pick a side and slide along the obstacle for a moment
        if (moved < step * 0.35 && now >= e.strafeUntil) {
          e.strafe = Math.random() < 0.5 ? -1 : 1;
          e.strafeUntil = now + 800;
        }
      } else {
        collideMove(this.world, e.pos, ENEMY_R * st.scale, ENEMY_H * st.scale, disp);
      }

      if (e.pos[1] < this.world.killY) { this.enemies.delete(e.id); continue; }

      if (st.damage > 0 && now >= e.nextAttack && d <= st.range) {
        const eye = [e.pos[0], e.pos[1] + 1.3 * st.scale, e.pos[2]];
        const teye = [target.pos[0], target.pos[1] + 1.2, target.pos[2]];
        if (st.ranged && !hasLineOfSight(this.world, eye, teye)) continue;
        e.nextAttack = now + st.cd * 1000;
        this.damagePlayer(target, st.damage, e);
        this.event({ type: 'eatk', id: e.id, ranged: !!st.ranged, from: eye, to: teye });
      }
    }
  }

  nearestAlivePlayer(pos) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist3D(pos, p.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------- tutorial

  markTutorial(p, stepId) {
    if (!this.level?.tutorial) return;
    const cur = TUTORIAL_STEPS[this.tutorialStep];
    if (!cur || cur.id !== stepId) return;
    if (p.tutorial[stepId]) return;
    p.tutorial[stepId] = true;
    const all = [...this.players.values()];
    if (all.length === 2 && all.every((x) => x.tutorial[stepId])) {
      this.tutorialStep++;
      this.event({ type: 'trainstep', step: this.tutorialStep });
    } else {
      this.event({ type: 'trainpartial', step: this.tutorialStep, by: p.id, name: p.name });
    }
  }

  // ------------------------------------------------------------ level state

  nearPoint(p, point, r, vert = 2.6) {
    const dx = p.pos[0] - point[0];
    const dz = p.pos[2] - point[2];
    if (Math.hypot(dx, dz) > r) return false;
    return Math.abs(p.pos[1] - point[1]) <= vert;
  }

  inZone(pos, zone) {
    const [cx, by, cz] = zone.p;
    const [w, h, d] = zone.s;
    return pos[0] >= cx - w / 2 && pos[0] <= cx + w / 2 &&
      pos[2] >= cz - d / 2 && pos[2] <= cz + d / 2 &&
      pos[1] >= by - 1.5 && pos[1] <= by + h;
  }

  checkLevelState() {
    if (this.levelComplete) return;
    const lv = this.level;
    const tasksDone = [...this.tasks.values()].every((t) => t.done);
    const wavesDone = !lv.waves || this.waveState === 'done';
    const tutDone = !lv.tutorial || this.tutorialStep >= TUTORIAL_STEPS.length;
    if (!(tasksDone && wavesDone && tutDone)) return;

    this.levelComplete = true;
    if (lv.exitGate) {
      this.openGates.add(lv.exitGate);
      setGate(this.world, lv.exitGate, true);
    }
    this.event({ type: 'gate', id: lv.exitGate, label: lv.exit.label });
  }

  checkExit() {
    if (!this.levelComplete || this.players.size !== 2) return;
    const all = [...this.players.values()];
    if (all.every((p) => p.alive && this.inZone(p.pos, this.level.exit))) this.advanceStage();
  }

  checkFalls() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.pos[1] > this.world.killY) continue;
      if (this.level.noCombat) {
        // gauntlet: no damage, just a reset to the last checkpoint reached
        p.pos = [...this.level.checkpoints[p.checkpoint]];
        this.event({ type: 'teleport', id: p.id, pos: p.pos, reason: 'fell' });
      } else {
        this.damagePlayer(p, MAX_HP * 2, null);
      }
    }
  }

  updateCheckpoints() {
    const cps = this.level.checkpoints;
    if (!cps) return;
    for (const p of this.players.values()) {
      for (let i = cps.length - 1; i > p.checkpoint; i--) {
        if (dist3D(p.pos, cps[i]) < 7) { p.checkpoint = i; break; }
      }
    }
  }

  updateRespawns() {
    const now = this.clock;
    for (const p of this.players.values()) {
      if (p.alive || now < p.downUntil) continue;
      p.alive = true;
      p.hp = MAX_HP;
      p.pos = this.level.checkpoints
        ? [...this.level.checkpoints[p.checkpoint]]
        : [...(this.level.spawns[p.slot] || this.level.spawns[0])];
      this.event({ type: 'teleport', id: p.id, pos: p.pos, reason: 'respawn' });
    }
  }

  // -------------------------------------------------------------- shop/NPCs

  onBuy(p, itemId) {
    const item = COSMETICS.find((c) => c.id === itemId);
    if (!item) return;
    if (p.owned.includes(itemId)) { this.onEquip(p, itemId); return; }
    if (p.currency < item.cost) {
      this.eventTo(p.id, { type: 'toast', text: `Not enough coin — ${item.name} costs ${item.cost}.` });
      return;
    }
    p.currency -= item.cost;
    p.owned.push(itemId);
    p.color = item.color;
    this.event({ type: 'buy', id: p.id, name: p.name, item: item.name });
  }

  onEquip(p, itemId) {
    if (!p.owned.includes(itemId)) return;
    const item = COSMETICS.find((c) => c.id === itemId);
    if (item) p.color = item.color;
  }

  onHint(p) {
    const now = this.clock;
    if (now < this.hintCooldownUntil) {
      const wait = Math.ceil((this.hintCooldownUntil - now) / 1000);
      this.eventTo(p.id, { type: 'toast', text: `Old Wick is thinking. Ask again in ${wait}s.` });
      return;
    }
    this.hintCooldownUntil = now + 25000;
    this.event({ type: 'hint', text: this.currentHint() });
  }

  currentHint() {
    if (this.level.id === 'hub') {
      const nextId = CAMPAIGN[this.stage + 1];
      const next = nextId && LEVELS[nextId];
      if (next && next.id !== 'hub') return next.hint;
    }
    for (const rt of this.tasks.values()) {
      if (!rt.done && this.taskActive(rt) && rt.def.hint) return rt.def.hint;
    }
    return this.level.hint;
  }

  // ------------------------------------------------------------------- tick

  tick(dt) {
    if (this.phase !== 'playing' || this.paused || !this.level) return;
    this.clock += dt * 1000;
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateTasks(dt);
    this.updateCheckpoints();
    this.checkFalls();
    this.updateRespawns();
    this.checkLevelState();
    this.checkExit();
    this.broadcast();
  }

  onState(p, msg) {
    if (!finiteVec(msg.p)) return;
    p.pos = msg.p;
    p.yaw = Number.isFinite(msg.y) ? msg.y : 0;
    p.pitch = Number.isFinite(msg.pi) ? msg.pi : 0;
    p.anim = msg.a | 0;
    p.interacting = !!msg.int;
    p.blocking = !!msg.blk;
    if (typeof msg.w === 'string' && WEAPONS[msg.w]) p.weapon = msg.w;
    if (this.level?.tutorial && typeof msg.tr === 'string') this.markTutorial(p, msg.tr);
  }

  taskState(rt) {
    const base = {
      id: rt.id, kind: rt.kind, done: rt.done,
      label: rt.def.label, active: this.taskActive(rt),
    };
    if (rt.kind === 'hold') {
      return { ...base, progress: +rt.progress.toFixed(2), total: rt.def.seconds, holders: rt.holders, p: rt.def.p };
    }
    if (rt.kind === 'synced') return { ...base, flips: rt.flips, window: rt.def.windowMs };
    if (rt.kind === 'fetch') return { ...base, carrier: rt.carrier, itemPos: rt.itemPos };
    if (rt.kind === 'defend') return { ...base, holder: rt.holder };
    if (rt.kind === 'pattern') {
      return { ...base, input: rt.input.length, len: rt.def.length, showing: rt.showing };
    }
    return base;
  }

  broadcast() {
    const now = Date.now();
    const sim = this.clock;
    const snap = {
      t: now,
      ps: [...this.players.values()].map((p) => ({
        i: p.id, s: p.slot, n: p.name, p: p.pos, y: p.yaw, a: p.anim,
        hp: Math.round(p.hp), al: p.alive, w: p.weapon, c: p.currency,
        k: p.kills, col: p.color, car: p.carrying,
        dn: p.alive ? 0 : Math.max(0, Math.ceil((p.downUntil - sim) / 1000)),
        own: p.owned,
      })),
      es: [...this.enemies.values()].map((e) => ({
        i: e.id, t: e.type, p: e.pos, y: e.yaw, hp: Math.round(e.hp), m: e.maxHp,
      })),
      ts: [...this.tasks.values()].map((rt) => this.taskState(rt)),
      g: [...this.openGates],
      wv: this.level.waves
        ? { i: Math.max(0, this.waveIndex + 1), n: this.level.waves.length, st: this.waveState, alive: this.enemies.size }
        : null,
      lc: this.levelComplete,
      tut: this.level.tutorial
        ? {
            step: this.tutorialStep,
            done: [...this.players.values()].map((p) => ({
              id: p.id, name: p.name,
              ok: !!p.tutorial[TUTORIAL_STEPS[this.tutorialStep]?.id],
            })),
          }
        : null,
    };
    this.io.to(this.code).emit('snap', snap);
  }

  // -------------------------------------------------------------- messaging

  event(ev) {
    this.io.to(this.code).emit('ev', ev);
  }

  eventTo(socketId, ev) {
    this.io.to(socketId).emit('ev', ev);
  }

  lobbyPayload() {
    return {
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      pauseReason: this.pauseReason,
      players: [...this.players.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({ id: p.id, name: p.name, slot: p.slot, ready: p.ready })),
      canStart: this.canStart(),
    };
  }

  emitLobby() {
    this.io.to(this.code).emit('lobby', this.lobbyPayload());
  }
}

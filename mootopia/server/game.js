// One world: the tick loop, who sees what, kills, clans, chat and the shop.

import * as C from '#shared/config.js';
import { ITEMS, costOf } from '#shared/items.js';
import { ANIMALS } from '#shared/animals.js';
import { hatById } from '#shared/hats.js';
import { generateWorld } from '#shared/world.js';
import { dist } from '#shared/util.js';
import { ObjectManager } from './objects.js';
import { Player } from './player.js';
import { Animal } from './animal.js';
import { Projectile } from './projectile.js';
import { cleanChat, cleanName } from './filter.js';
import { SERVER_TABLE, Writer, encode } from '#shared/protocol.js';

const wire = new Writer(16384);

const LEADER_MS = 1000;

export class Game {
  constructor({ seed = 20160101, animals = true, log = () => {} } = {}) {
    this.seed = seed;
    this.log = log;
    this.time = 0;
    this.tickCount = 0;
    this.objects = new ObjectManager();
    this.players = new Map();        // sid → Player
    this.animals = [];
    this.projectiles = [];
    this.clans = new Map();          // name → { id, name, owner, members: Set }
    this.clansById = new Map();
    this.nextClanId = 1;
    this.nextSid = 1;
    this.nextAnimalSid = 1;
    this.nextProjSid = 1;
    this.leaderTimer = 0;
    this.minimapTimer = 0;
    this.lastLeaders = '';
    this.world = generateWorld(seed);
    for (const r of this.world) this.objects.add({ x: r.x, y: r.y, scale: r.scale, type: r.type });
    if (animals) for (const data of ANIMALS) for (let i = 0; i < data.count; i++) this.animals.push(new Animal(this, this.nextAnimalSid++, data));
  }

  // ── players coming and going ──────────────────────────────────────────────
  join(opts = {}) {
    const p = new Player(this, this.nextSid++, opts);
    this.players.set(p.sid, p);
    p.send('welcome', p.sid, C.MAP, this.seed);
    p.send('clans', this.clanList());
    return p;
  }

  leave(p) {
    if (!this.players.has(p.sid)) return;
    this.leaveClan(p);
    for (const o of this.objects.ownedBy(p)) this.removeObject(o);
    this.players.delete(p.sid);
    this.broadcast('left', p.sid);
  }

  spawn(p, { name, skin } = {}) {
    if (p.alive) return;
    if (name !== undefined) p.name = cleanName(name);
    if (Number.isInteger(skin) && skin >= 0 && skin < C.SKIN_COLORS.length) p.skin = skin;
    const pad = this.objects.list.find((o) => o.owner === p && o.item?.spawnPoint);
    let at;
    if (pad) { at = { x: pad.x, y: pad.y }; this.removeObject(pad); p.changeItemCount(pad.item.group.id, -1); }
    else at = this.freeSpot(C.PLAYER_SCALE);
    p.spawn(at);
    p.inputs = [];
    p.seen = new Set();
    p.send('spawned', p.sid, p.items, p.weapons, [...p.hatsOwned], p.hatId);
    p.send('xp', 0, C.FIRST_XP, 1);
    for (let i = 0; i < 4; i++) p.send('res', i, 0);
    for (const [g, n] of Object.entries(p.itemCounts)) p.send('count', Number(g), n);
    this.broadcastInfo(p);
  }

  freeSpot(r) {
    for (let i = 0; i < 400; i++) {
      const x = 300 + Math.random() * (C.MAP - 600);
      const y = C.SNOW_TOP + 200 + Math.random() * (C.DESERT_TOP - C.SNOW_TOP - 400);
      if (C.inRiver(y) || Math.abs(y - C.MAP / 2) < C.RIVER_WIDTH) continue;
      if (this.objects.near(x, y, r + 200).every((o) => dist(x, y, o.x, o.y) > r + o.getScale() + 10)) return { x, y };
    }
    return { x: C.MAP / 2, y: C.MAP / 3 };
  }

  animalSpot(data) {
    if (data.fixedSpawn) return { x: data.fixedSpawn[0], y: data.fixedSpawn[1] };
    const band = { snow: [80, C.SNOW_TOP - 80], grass: [C.SNOW_TOP + 80, C.DESERT_TOP - 80], desert: [C.DESERT_TOP + 80, C.MAP - 80] };
    for (let i = 0; i < 200; i++) {
      const [y0, y1] = band[data.biomes[Math.floor(Math.random() * data.biomes.length)]];
      const x = 100 + Math.random() * (C.MAP - 200); const y = y0 + Math.random() * (y1 - y0);
      if (C.inRiver(y)) continue;
      if (this.objects.near(x, y, data.scale + 200).every((o) => dist(x, y, o.x, o.y) > data.scale + o.getScale())) return { x, y };
    }
    return { x: C.MAP / 2, y: C.MAP / 3 };
  }

  // ── the tick ──────────────────────────────────────────────────────────────
  tick(delta = C.TICK_MS) {
    this.time += delta;
    this.tickCount++;
    const alive = this.alivePlayers();
    for (const p of alive) p.takeInput();
    for (const p of alive) p.update(delta);
    // Push overlapping players apart, half each.
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        if (!b.alive) continue;
        const dx = a.x - b.x; const dy = a.y - b.y; const reach = a.scale + b.scale;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const d = Math.hypot(dx, dy);
        if (d >= reach) continue;
        const push = (reach - d) / 2; const dir = Math.atan2(dy, dx);
        a.x += push * Math.cos(dir); a.y += push * Math.sin(dir);
        b.x -= push * Math.cos(dir); b.y -= push * Math.sin(dir);
      }
    }
    for (const p of alive) p.finish(delta);
    for (const pr of this.projectiles) pr.update(delta);
    this.projectiles = this.projectiles.filter((pr) => pr.active);
    for (const o of this.objects.spinning) o.dir += o.turnSpeed * delta;
    this.updateTurrets(delta);
    for (const a of this.animals) a.update(delta);

    this.leaderTimer -= delta;
    if (this.leaderTimer <= 0) { this.leaderTimer = LEADER_MS; this.sendLeaders(); }
    this.minimapTimer -= delta;
    if (this.minimapTimer <= 0) { this.minimapTimer = C.MINIMAP_MS; this.sendMinimap(); }
    this.sendSnapshots();
  }

  updateTurrets(delta) {
    for (const t of this.objects.turrets) {
      t.shootCount -= delta;
      if (t.shootCount > 0) continue;
      const range = t.item.shootRange;
      let best = null; let bestD = range;
      for (const e of this.targets()) {
        if (!e.alive || e === t.owner || (e.isPlayer && t.owner?.clan && e.clan === t.owner.clan)) continue;
        if (e.isAI && !e.data.hostile) continue;
        const d = dist(t.x, t.y, e.x, e.y);
        if (d < bestD) { best = e; bestD = d; }
      }
      if (!best) continue;
      t.dir = Math.atan2(best.y - t.y, best.x - t.x);
      this.addProjectile(t.x + 50 * Math.cos(t.dir), t.y + 50 * Math.sin(t.dir), t.dir, range, 1.5, 1, t.owner, 1, t);
      t.shootCount = t.item.shootRate;
    }
  }

  alivePlayers() { const out = []; for (const p of this.players.values()) if (p.alive) out.push(p); return out; }
  targets() { return [...this.alivePlayers(), ...this.animals.filter((a) => a.alive)]; }

  addProjectile(x, y, dir, range, speed, index, owner, layer, ignore) {
    const pr = new Projectile(this, this.nextProjSid++, { x, y, dir, range, speed, index, owner, layer });
    pr.ignore = ignore;
    this.projectiles.push(pr);
    for (const p of this.players.values()) {
      if (p.alive && p.canSee(pr)) p.send('proj', x, y, dir, range, index, layer, pr.sid);
    }
    return pr;
  }

  projectileGone(pr) {
    for (const p of this.players.values()) if (p.alive && p.canSee(pr)) p.send('prm', pr.sid);
  }

  // ── objects ───────────────────────────────────────────────────────────────
  addObject(data) { return this.objects.add(data); }

  removeObject(o) {
    this.objects.remove(o);
    for (const p of this.players.values()) if (o.sentTo.has(p.sid)) p.send('rm', o.sid);
  }

  objectHit(o, dir) {
    for (const p of this.players.values()) if (o.sentTo.has(p.sid) && p.canSee(o)) p.send('wiggle', o.sid, dir);
  }

  /** Hurt a building. Whoever destroys it gets what it cost. */
  damageObject(o, amount, doer, dir) {
    if (!o.active || !o.health) return;
    o.health -= amount;
    if (o.health > 0) { this.objectHit(o, dir); return; }
    if (doer?.isPlayer) for (const [res, n] of costOf(o.item)) doer.addResource(C.RESOURCE_TYPES.indexOf(res), n);
    if (o.owner) {
      if (o.item.group.limit) o.owner.changeItemCount(o.item.group.id, -1);
      if (o.item.pps) o.owner.pps -= o.item.pps;
    }
    this.removeObject(o);
  }

  // ── health, damage and death ──────────────────────────────────────────────
  healthChanged(p) {
    for (const q of this.players.values()) if (q.seen?.has(p.sid) || q === p) q.send('hp', p.sid, Math.max(0, Math.round(p.health)), p.maxHealth);
  }

  animalHealth(a) {
    for (const q of this.players.values()) if (q.alive && q.canSee(a)) q.send('ahp', a.sid, Math.max(0, Math.round(a.health)));
  }

  damageText(doer, x, y, amount) {
    if (doer.isPlayer && doer.canSee({ x, y, scale: 0 })) doer.send('txt', Math.round(x), Math.round(y), Math.round(amount));
  }

  swingSeen(p, hit, weaponId) {
    for (const q of this.players.values()) if (q.alive && (q === p || (q.seen?.has(p.sid) && q.canSee(p)))) q.send('swing', p.sid, hit ? 1 : 0, weaponId);
  }

  bossSlam(a) { for (const q of this.players.values()) if (q.alive && q.canSee(a)) q.send('slam', a.sid); }

  killPlayer(p, doer) {
    if (!p.alive) return;
    p.alive = false;
    p.health = 0;
    if (doer?.isPlayer && doer.alive && doer !== p) {
      doer.kills++;
      doer.send('kills', doer.kills);
      const reward = Math.round(p.age * 100);
      doer.addResource(3, reward, true);
      doer.earnXP(reward);
    }
    p.send('died');
    this.broadcast('dead', p.sid);
  }

  killAnimal(a, doer) {
    a.alive = false;
    a.spawnCounter = a.data.respawn || 30000;
    if (doer?.isPlayer && doer.alive) {
      if (a.data.drop) doer.addResource(1, a.data.drop, true);
      doer.addResource(3, a.data.score, true);
      doer.earnXP(a.data.score);
    }
    for (const q of this.players.values()) if (q.alive && q.canSee(a)) q.send('adead', a.sid);
  }

  // ── what each client sees ─────────────────────────────────────────────────
  broadcast(...msg) { for (const p of this.players.values()) p.send(...msg); }

  broadcastInfo(p) {
    const info = this.infoOf(p);
    for (const q of this.players.values()) if (q.seen?.has(p.sid) || q === p) q.send('info', ...info);
  }

  infoOf(p) { return [p.sid, p.name, p.skin, Math.max(0, Math.round(p.health)), p.maxHealth, p.bot ? 1 : 0]; }

  sendSnapshots() {
    const near = [];
    for (const p of this.players.values()) {
      if (p.bot || !p.alive) { if (!p.bot) this.flush(p); continue; }
      const ps = [];
      for (const q of this.players.values()) {
        if (!q.alive || (q !== p && !p.canSee(q))) continue;
        if (!p.seen.has(q.sid)) { p.seen.add(q.sid); p.send('info', ...this.infoOf(q)); }
        const v = q.variantOf().id;
        ps.push(q.sid, q.x, q.y, q.dir, q.buildIndex, q.weaponIndex, v, q.clan ? q.clan.id : 0, q.shownHat || 0, q.zIndex, q.clan && q.clan.owner === q ? 1 : 0);
      }
      const as = [];
      for (const a of this.animals) {
        if (!a.alive || !p.canSee(a)) continue;
        as.push(a.sid, a.type, a.x, a.y, a.dir, Math.max(0, a.health));
      }
      const fresh = [];
      for (const o of this.objects.near(p.x, p.y, Math.max(C.SEE_X, C.SEE_Y) + 200, near)) {
        if (o.sentTo.has(p.sid) || !p.canSee(o) || !o.visibleTo(p)) continue;
        o.sentTo.add(p.sid);
        fresh.push(o.sid, o.x, o.y, o.dir, o.scale, o.type ?? -1, o.item ? o.item.id : -1, o.owner ? o.owner.sid : 0);
      }
      if (fresh.length) p.send('objs', fresh);
      p.send('tick', this.tickCount, ps, as);
      p.send('me', p.lastSeq, p.x, p.y, p.xVel, p.yVel, p.slowMult, p.zIndex, p.lockMove ? 1 : 0, p.inputs.length);
      this.flush(p);
    }
  }

  flush(p) {
    // Players without a socket are only ever test doubles; let their mail pile up.
    if (!p.outbox.length || (!p.socket && !p.onFlush)) return;
    if (p.socket?.readyState === 1) p.socket.send(encode(SERVER_TABLE, p.outbox, wire));
    if (p.onFlush) p.onFlush(p.outbox);
    p.outbox = [];
  }

  sendLeaders() {
    const top = this.alivePlayers().sort((a, b) => b.gold - a.gold).slice(0, 10);
    const list = top.flatMap((p) => [p.sid, p.name, Math.floor(p.gold)]);
    const key = JSON.stringify(list);
    if (key === this.lastLeaders) return;
    this.lastLeaders = key;
    this.broadcast('leaders', list);
  }

  sendMinimap() {
    for (const p of this.players.values()) {
      if (!p.alive || !p.clan) continue;
      const mates = [...p.clan.members].filter((m) => m !== p && m.alive).flatMap((m) => [Math.round(m.x), Math.round(m.y)]);
      p.send('mm', mates);
    }
  }

  // ── chat, pings and the shop ──────────────────────────────────────────────
  chat(p, text) {
    if (!p.alive || this.time - p.chatAt < C.CHAT_COOLDOWN) return;
    const clean = cleanChat(String(text).slice(0, C.MAX_CHAT));
    if (!clean) return;
    p.chatAt = this.time;
    for (const q of this.players.values()) if (q === p || (q.alive && q.canSee(p))) q.send('chat', p.sid, clean);
  }

  mapPing(p) {
    if (!p.alive || !p.clan || this.time - (p.pingAt || -1e9) < 1000) return;
    p.pingAt = this.time;
    for (const m of p.clan.members) m.send('ping', Math.round(p.x), Math.round(p.y));
  }

  buyHat(p, id) {
    const hat = hatById(id);
    if (!hat || hat.hidden || p.hatsOwned.has(id) || p.gold < hat.price) return false;
    p.addResource(3, -hat.price, true);
    p.hatsOwned.add(id);
    p.send('hats', [...p.hatsOwned], p.hatId);
    return true;
  }

  equipHat(p, id) {
    if (id !== 0 && !p.hatsOwned.has(id)) return false;
    p.hatId = id;
    p.applyHat();
    p.send('hats', [...p.hatsOwned], p.hatId);
    return true;
  }

  // ── clans ─────────────────────────────────────────────────────────────────
  clanList() { return [...this.clans.values()].flatMap((c) => [c.id, c.name, c.owner.sid]); }
  sendClans() { this.broadcast('clans', this.clanList()); }

  sendMembers(clan) {
    const list = [...clan.members].flatMap((m) => [m.sid, m.name]);
    for (const m of clan.members) m.send('members', clan.id, clan.name, clan.owner === m ? 1 : 0, list);
  }

  createClan(p, rawName) {
    const name = cleanName(String(rawName || '')).slice(0, C.MAX_CLAN_NAME);
    if (!p.alive || p.clan || !name || name === 'unknown' || this.clans.has(name)) return false;
    const clan = { id: this.nextClanId++, name, owner: p, members: new Set([p]), requests: new Set() };
    this.clans.set(name, clan);
    this.clansById.set(clan.id, clan);
    p.clan = clan;
    this.sendClans();
    this.sendMembers(clan);
    return true;
  }

  requestClan(p, id) {
    const clan = this.clansById.get(id);
    if (!clan || p.clan || clan.requests.has(p) || !p.alive) return false;
    clan.requests.add(p);
    clan.owner.send('request', p.sid, p.name);
    return true;
  }

  answerClan(owner, sid, accept) {
    const clan = owner.clan;
    const p = this.players.get(sid);
    if (!clan || clan.owner !== owner || !p || !clan.requests.has(p)) return false;
    clan.requests.delete(p);
    if (!accept || p.clan || clan.members.size >= C.CLAN_MAX) return false;
    clan.members.add(p);
    p.clan = clan;
    this.sendMembers(clan);
    return true;
  }

  kickFromClan(owner, sid) {
    const clan = owner.clan;
    const p = this.players.get(sid);
    if (!clan || clan.owner !== owner || !p || p === owner || p.clan !== clan) return false;
    clan.members.delete(p);
    p.clan = null;
    p.send('members', 0, '', 0, []);
    this.sendMembers(clan);
    return true;
  }

  leaveClan(p) {
    const clan = p.clan;
    if (!clan) return false;
    if (clan.owner === p) {
      for (const m of clan.members) { m.clan = null; m.send('members', 0, '', 0, []); }
      for (const r of clan.requests) r.send('declined', clan.name);
      this.clans.delete(clan.name);
      this.clansById.delete(clan.id);
      this.sendClans();
    } else {
      clan.members.delete(p);
      p.clan = null;
      p.send('members', 0, '', 0, []);
      this.sendMembers(clan);
    }
    return true;
  }
}

export { ITEMS };

// The HTML parts of the screen: hotbar, resources, age, upgrades, leaderboard,
// minimap, shop, clans, chat and the join-request popup.

import * as C from '#shared/config.js';
import { WEAPONS, ITEMS, costOf } from '#shared/items.js';
import { SHOP_HATS } from '#shared/hats.js';
import * as A from './assets.js';
import { itemDrawSize } from './render.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RES_NAMES = ['wood', 'food', 'stone', 'gold'];

export class UI {
  constructor(app) {
    this.app = app;
    this.pendingIcons = [];
    $('shop-btn').onclick = () => this.toggle('shop');
    $('clan-btn').onclick = () => this.toggle('clans');
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => { $(b.dataset.close).hidden = true; };
    $('clan-make').onclick = () => { const n = $('clan-name').value.trim(); if (n) { app.send('clanCreate', n); $('clan-name').value = ''; } };
    $('clan-name').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('clan-make').click(); });
    setInterval(() => this.redrawPendingIcons(), 250);
  }

  toggle(id) {
    const el = $(id);
    const open = el.hidden;
    for (const w of ['shop', 'clans']) $(w).hidden = true;
    el.hidden = !open;
    if (open && id === 'shop') this.renderShop();
    if (open && id === 'clans') this.renderClans();
  }

  closeWindows() { $('shop').hidden = true; $('clans').hidden = true; }

  // ── icons ─────────────────────────────────────────────────────────────
  icon(kind, id, size = 116) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const draw = () => this.drawIcon(c, kind, id);
    if (!draw()) this.pendingIcons.push(draw);
    return c;
  }

  redrawPendingIcons() {
    if (!this.pendingIcons.length) return;
    this.pendingIcons = this.pendingIcons.filter((draw) => !draw());
  }

  /** Paint one icon; false if its art is still loading. */
  drawIcon(c, kind, id) {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.save();
    g.translate(c.width / 2, c.height / 2);
    let ok = true;
    if (kind === 'weapon') {
      const w = WEAPONS[id];
      const img = A.weaponSprite(w, 0);
      if (!img) ok = false;
      else {
        const k = c.width / Math.max(w.length, w.width) * 0.95 * (w.iconPad || 1);
        g.rotate(Math.PI / 4 + (w.aboveHand || w.projectile !== undefined ? -Math.PI / 2 : 0));
        g.drawImage(img, -w.length * k / 2, -w.width * k / 2, w.length * k, w.width * k);
      }
    } else {
      const it = ITEMS[id];
      const base = A.itemSprite(it);
      if (!base) ok = false;
      else {
        const size = itemDrawSize(it);
        const blades = it.sprite === 'mill' ? A.millBlades(it) : null;
        const span = blades ? it.scale * 2.35 : size;
        const k = c.width / span * 0.9;
        g.drawImage(base, -size * k / 2, -size * k / 2, size * k, size * k);
        if (it.sprite === 'mill') { if (blades) { const b = it.scale * 2.35 * k; g.drawImage(blades, -b / 2, -b / 2, b, b); } else ok = false; }
        if (it.drawn === 'turret') g.drawImage(A.turretTop(), -size * k / 2, -size * k / 2, size * k, size * k);
      }
    }
    g.restore();
    return ok;
  }

  // ── hotbar ────────────────────────────────────────────────────────────
  hotbarSlots() {
    const me = this.app.me;
    return [...me.weapons.map((id) => ({ kind: 'weapon', id })), ...me.items.map((id) => ({ kind: 'item', id }))];
  }

  renderHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.pendingIcons = [];
    this.hotbarSlots().forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.kind = s.kind; el.dataset.id = s.id;
      el.appendChild(this.icon(s.kind, s.id));
      el.insertAdjacentHTML('beforeend', `<span class="key">${i + 1}</span>`);
      if (s.kind === 'item' && ITEMS[s.id].group.limit) el.insertAdjacentHTML('beforeend', '<span class="count"></span>');
      el.onclick = () => this.app.choose(s.kind, s.id);
      el.onmouseenter = () => this.showInfo(el, s.kind, s.id);
      el.onmouseleave = () => { $('item-info').hidden = true; };
      bar.appendChild(el);
    });
    this.refreshHotbar();
  }

  refreshHotbar() {
    const me = this.app.me;
    for (const el of $('hotbar').children) {
      const id = Number(el.dataset.id);
      const on = el.dataset.kind === 'weapon' ? me.build < 0 && me.weapon === id : me.build === id;
      el.classList.toggle('on', on);
      if (el.dataset.kind === 'item') {
        const it = ITEMS[id];
        const cant = costOf(it).some(([res, n]) => me.res[RES_NAMES.indexOf(res)] < n);
        el.classList.toggle('poor', cant);
        const count = el.querySelector('.count');
        if (count) count.textContent = `${me.counts[it.group.id] || 0}/${it.group.limit}`;
      }
    }
  }

  showInfo(el, kind, id) {
    const thing = kind === 'weapon' ? WEAPONS[id] : ITEMS[id];
    const cost = costOf(thing).map(([res, n]) => `${n} ${res}`).join(', ');
    const box = $('item-info');
    box.innerHTML = `<b>${esc(thing.name)}</b>${esc(thing.desc)}${cost ? `<div class="cost">${kind === 'weapon' ? 'Each shot: ' : 'Costs '}${esc(cost)}</div>` : ''}`;
    box.hidden = false;
    const r = el.getBoundingClientRect();
    box.style.left = `${Math.min(window.innerWidth - 300, Math.max(10, r.left + r.width / 2 - 140))}px`;
    box.style.top = '';
    box.style.bottom = `${window.innerHeight - r.top + 10}px`;
  }

  // ── resources, age, kills ─────────────────────────────────────────────
  setResource(type, value) {
    const el = document.querySelector(`.res[data-res="${type}"] span`);
    if (el) el.textContent = formatNum(value);
    this.refreshHotbar();
  }

  setAge(xp, max, age) { $('age-fill').style.width = `${Math.min(100, xp / max * 100)}%`; $('age-text').textContent = `AGE ${age}`; }
  setKills(n) { document.querySelector('#kills span').textContent = n; }

  // ── upgrades ──────────────────────────────────────────────────────────
  setUpgrades(points, age, choices) {
    const box = $('upgrades');
    const list = $('upgrade-list');
    list.innerHTML = '';
    if (!points || !choices.length) { box.hidden = true; return; }
    $('upgrade-label').textContent = points > 1 ? `Select an upgrade (${points} left)` : 'Select an upgrade';
    for (let i = 0; i < choices.length; i += 2) {
      const kind = choices[i] === 0 ? 'weapon' : 'item'; const id = choices[i + 1];
      const el = document.createElement('div');
      el.className = 'slot';
      el.appendChild(this.icon(kind, id, 132));
      el.onclick = () => { this.app.send('upgrade', choices[i], id); $('item-info').hidden = true; };
      el.onmouseenter = () => this.showInfoBelow(el, kind, id);
      el.onmouseleave = () => { $('item-info').hidden = true; };
      list.appendChild(el);
    }
    box.hidden = false;
  }

  showInfoBelow(el, kind, id) {
    this.showInfo(el, kind, id);
    const r = el.getBoundingClientRect();
    const box = $('item-info');
    box.style.bottom = '';
    box.style.top = `${r.bottom + 10}px`;
    box.style.left = `${Math.max(10, r.left)}px`;
  }

  // ── leaderboard ───────────────────────────────────────────────────────
  setLeaders(flat) {
    const ol = $('leaders');
    ol.innerHTML = '';
    for (let i = 0; i < flat.length; i += 3) {
      const li = document.createElement('li');
      if (flat[i] === this.app.state.me) li.className = 'me';
      li.innerHTML = `<span class="n">${i / 3 + 1}. ${esc(flat[i + 1])}</span><span>${formatNum(flat[i + 2])}</span>`;
      ol.appendChild(li);
    }
  }

  // ── minimap ───────────────────────────────────────────────────────────
  drawMinimap(me, mates, pings, now) {
    const c = $('minimap'); const g = c.getContext('2d');
    const k = c.width / C.MAP;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, c.width, C.SNOW_TOP * k);
    g.fillStyle = 'rgba(219,198,102,0.35)'; g.fillRect(0, C.DESERT_TOP * k, c.width, c.height - C.DESERT_TOP * k);
    g.fillStyle = 'rgba(145,178,219,0.55)'; g.fillRect(0, C.RIVER_TOP * k, c.width, C.RIVER_WIDTH * k);
    g.fillStyle = '#8ecc51';
    for (let i = 0; i < mates.length; i += 2) { g.beginPath(); g.arc(mates[i] * k, mates[i + 1] * k, 6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    for (const p of pings) {
      const t = (now - p.at) / C.PING_MS;
      if (t >= 1) continue;
      g.globalAlpha = 1 - t;
      g.beginPath(); g.arc(p.x * k, p.y * k, 8 + t * 28, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
    if (me) { g.fillStyle = '#fff'; g.beginPath(); g.arc(me.x * k, me.y * k, 7, 0, Math.PI * 2); g.fill(); }
  }

  // ── shop ──────────────────────────────────────────────────────────────
  renderShop() {
    const me = this.app.me;
    const list = $('shop-list');
    list.innerHTML = '';
    const none = document.createElement('div');
    none.className = 'shop-row';
    none.innerHTML = `<div class="text"><b>No hat</b><small>Just your head.</small></div>`;
    const bare = document.createElement('button');
    bare.className = 'small-btn grey'; bare.textContent = me.hat ? 'Wear' : 'Wearing'; bare.disabled = !me.hat;
    bare.onclick = () => this.app.send('wear', 0);
    none.appendChild(bare);
    list.appendChild(none);
    for (const hat of SHOP_HATS) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `<img src="img/hats/hat_${hat.id}.png" alt="" /><div class="text"><b>${esc(hat.name)}</b><small>${esc(hat.desc)}</small></div>`;
      const btn = document.createElement('button');
      btn.className = 'small-btn';
      if (me.hats.has(hat.id)) {
        const wearing = me.hat === hat.id;
        btn.textContent = wearing ? 'Take off' : 'Wear';
        if (wearing) btn.classList.add('grey');
        btn.onclick = () => this.app.send('wear', wearing ? 0 : hat.id);
      } else {
        btn.textContent = `Buy ${formatNum(hat.price)}`;
        btn.disabled = me.res[3] < hat.price;
        btn.onclick = () => this.app.send('buy', hat.id);
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  // ── clans ─────────────────────────────────────────────────────────────
  renderClans() {
    const app = this.app; const me = app.me;
    const list = $('clan-list');
    list.innerHTML = '';
    $('clan-create').hidden = !!me.clan;
    $('clan-title').textContent = me.clan ? `[${me.clanName}]` : 'Clans';
    if (me.clan) {
      for (let i = 0; i < me.members.length; i += 2) {
        const sid = me.members[i];
        const row = document.createElement('div');
        row.className = 'clan-row';
        row.innerHTML = `<span>${esc(me.members[i + 1])}${sid === me.clanOwnerSid ? ' ★' : ''}</span>`;
        if (me.clanOwner && sid !== app.state.me) {
          const kick = document.createElement('button');
          kick.className = 'small-btn red'; kick.textContent = 'Kick';
          kick.onclick = () => app.send('clanKick', sid);
          row.appendChild(kick);
        }
        list.appendChild(row);
      }
      const leave = document.createElement('button');
      leave.className = 'small-btn grey'; leave.style.marginTop = '10px';
      leave.textContent = me.clanOwner ? 'Disband clan' : 'Leave clan';
      leave.onclick = () => app.send('clanLeave');
      list.appendChild(leave);
      return;
    }
    const clans = app.state.clans;
    if (!clans.length) list.innerHTML = '<div class="clan-empty">No clans yet. Start one!</div>';
    for (let i = 0; i < clans.length; i += 3) {
      const id = clans[i];
      const row = document.createElement('div');
      row.className = 'clan-row';
      row.innerHTML = `<span>${esc(clans[i + 1])}</span>`;
      const join = document.createElement('button');
      join.className = 'small-btn';
      join.textContent = me.asked.has(id) ? 'Asked' : 'Join';
      join.disabled = me.asked.has(id);
      join.onclick = () => { app.send('clanJoin', id); me.asked.add(id); this.renderClans(); };
      row.appendChild(join);
      list.appendChild(row);
    }
  }

  showRequest(sid, name) {
    const box = $('request');
    box.innerHTML = `<span>${esc(name)} wants to join</span>`;
    const yes = document.createElement('button'); yes.className = 'small-btn'; yes.textContent = '✓';
    const no = document.createElement('button'); no.className = 'small-btn red'; no.textContent = '✕';
    const next = () => { this.app.requests.shift(); this.nextRequest(); };
    yes.onclick = () => { this.app.send('clanAccept', sid); next(); };
    no.onclick = () => { this.app.send('clanDecline', sid); next(); };
    box.append(yes, no);
    box.hidden = false;
  }

  nextRequest() {
    const r = this.app.requests[0];
    if (r) this.showRequest(r.sid, r.name); else $('request').hidden = true;
  }
}

export function formatNum(n) {
  n = Math.floor(n);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

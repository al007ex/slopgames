// The DOM around the canvas: menu, HUD, minimap, kill feed and death screen.
// It only presents — every decision about the game is made in main.js.

import { SKINS, NAME_MAX, ARENA_RADIUS } from '#shared/rules.js';
import { drawSnake } from './render.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: just not remembered */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

export class UI {
  constructor({ onPlay, onMenu }) {
    this.onPlay = onPlay;
    this.onMenu = onMenu;
    this.skin = Math.min(SKINS.length - 1, Math.max(0, Number(recall('glowworm.skin')) || 0));
    this.el = {
      menu: $('menu'), name: $('name'), skins: $('skins'), preview: $('preview'), play: $('play'),
      online: $('online'), hud: $('hud'), board: $('board'), length: $('length'), rank: $('rank'),
      minimap: $('minimap'), feed: $('feed'), toast: $('toast'), death: $('death'),
      deathKicker: $('death-kicker'), deathBy: $('death-by'), deathLength: $('death-length'),
      deathRank: $('death-rank'), deathTime: $('death-time'), deathKills: $('death-kills'),
      again: $('again'), toMenu: $('to-menu'), status: $('status'), statusText: $('status-text'),
      reload: $('reload'), ping: $('ping'),
    };

    this.el.name.maxLength = NAME_MAX;
    this.el.name.value = recall('glowworm.name') || '';
    this.buildSkins();

    const play = () => {
      const name = this.el.name.value.trim();
      remember('glowworm.name', name);
      this.onPlay(name, this.skin);
    };
    this.el.play.addEventListener('click', play);
    this.el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
    this.el.again.addEventListener('click', play);
    this.el.toMenu.addEventListener('click', () => this.onMenu());
    this.el.reload.addEventListener('click', () => location.reload());
    window.addEventListener('keydown', (e) => {
      if (!this.el.death.hidden && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); play(); }
    });

    this.feedItems = [];
    this.toastTimer = 0;
    this.previewTime = 0;
    this.minimapCtx = this.el.minimap.getContext('2d');
    this.previewCtx = this.el.preview.getContext('2d');
  }

  buildSkins() {
    SKINS.forEach((skin, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.title = skin.name;
      button.setAttribute('aria-label', `${skin.name} skin`);
      button.style.background = `repeating-linear-gradient(135deg, ${skin.body} 0 9px, ${skin.stripe} 9px 14px)`;
      button.style.setProperty('--glow', skin.glow);
      button.addEventListener('click', () => this.pickSkin(index));
      this.el.skins.append(button);
    });
    this.pickSkin(this.skin);
  }

  pickSkin(index) {
    this.skin = index;
    remember('glowworm.skin', String(index));
    [...this.el.skins.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }

  // ---- screens ---------------------------------------------------------

  get overlayOpen() { return !this.el.menu.hidden || !this.el.death.hidden; }

  showMenu() {
    this.el.menu.hidden = false;
    this.el.death.hidden = true;
    this.el.hud.classList.add('idle');
    document.body.classList.add('overlay-open');
    setTimeout(() => { if (!matchMedia('(pointer: coarse)').matches) this.el.name.focus(); }, 50);
  }

  hideMenu() {
    this.el.menu.hidden = true;
    this.el.death.hidden = true;
    this.el.hud.classList.remove('idle');
    document.body.classList.remove('overlay-open');
  }

  showDeath({ killerName, killer, score, aliveMs, kills, bestRank }) {
    this.el.deathKicker.textContent = killer ? 'EATEN BY' : 'YOU HIT THE EDGE';
    this.el.deathBy.textContent = killer ? killerName || 'another worm' : 'Mind the red line';
    this.el.deathLength.textContent = fmt(score);
    this.el.deathRank.textContent = bestRank ? `#${bestRank}` : '—';
    const seconds = Math.round(aliveMs / 1000);
    this.el.deathTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.el.deathKills.textContent = kills;
    this.el.death.hidden = false;
    this.el.hud.classList.add('idle');
    document.body.classList.add('overlay-open');
    setTimeout(() => this.el.again.focus(), 50);
  }

  status(kind) {
    const text = {
      connecting: 'Connecting to the arena…',
      reconnecting: 'Connection lost — reconnecting…',
      asleep: 'The arena went to sleep.',
    }[kind];
    this.el.status.hidden = !text;
    this.el.statusText.textContent = text || '';
    this.el.reload.hidden = kind !== 'asleep';
    this.el.status.classList.toggle('spin', kind !== 'asleep');
  }

  // ---- HUD -------------------------------------------------------------

  frame(frame, state, now) {
    const you = frame.youSnake;
    if (you) this.el.length.textContent = fmt(you.mass);
    if (state.board) {
      const { rank, total, humans } = state.board;
      this.el.rank.textContent = you && rank ? `Rank ${rank} of ${total}` : `${total} worms`;
      this.el.online.textContent = `${humans} playing · ${total} worms in the arena`;
    }
    if (state.rtt) this.el.ping.textContent = `${Math.round(state.rtt)} ms`;
    this.drawMinimap(state, you);
    if (!this.el.menu.hidden) this.drawPreview(now);
    this.tickFeed(now);
  }

  updateBoard(state) {
    const { board, info } = state;
    if (!board) return;
    const you = state.you;
    const rows = board.top.map((row, i) => {
      const name = info.get(row.id)?.name || '…';
      return `<li class="${row.id === you ? 'you' : ''}"><span>${i + 1}</span><b>${escapeHtml(name)}</b><em>${fmt(row.score)}</em></li>`;
    });
    if (you && board.rank > board.top.length) {
      rows.push(`<li class="you gap"><span>${board.rank}</span><b>${escapeHtml(info.get(you)?.name || 'you')}</b><em>${fmt(board.score)}</em></li>`);
    }
    this.el.board.innerHTML = rows.join('');
  }

  drawMinimap(state, you) {
    const canvas = this.el.minimap;
    const size = canvas.clientWidth;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size * dpr)) { canvas.width = canvas.height = Math.round(size * dpr); }
    const g = this.minimapCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const r = size / 2;
    g.fillStyle = 'rgba(8, 11, 24, 0.72)';
    g.beginPath(); g.arc(r, r, r - 1, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255, 85, 125, 0.55)';
    g.lineWidth = 1.5;
    g.stroke();
    const dots = state.board?.dots || [];
    for (const dot of dots) {
      if (dot.flags & 1) continue;
      const x = (dot.x / 255) * size;
      const y = (dot.y / 255) * size;
      const leader = dot.flags & 2;
      g.fillStyle = leader ? '#ffe066' : 'rgba(210, 222, 255, 0.55)';
      g.beginPath();
      g.arc(x, y, Math.max(1.4, Math.min(4.5, dot.size / 9)) + (leader ? 1 : 0), 0, TAU);
      g.fill();
    }
    if (you) {
      const x = (you.points[0] / ARENA_RADIUS + 1) * r;
      const y = (you.points[1] / ARENA_RADIUS + 1) * r;
      const pulse = 3.4 + Math.sin(performance.now() / 180) * 0.8;
      g.fillStyle = 'rgba(217, 255, 85, 0.25)';
      g.beginPath(); g.arc(x, y, pulse + 3, 0, TAU); g.fill();
      g.fillStyle = '#d9ff55';
      g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fill();
    }
  }

  drawPreview(now) {
    const canvas = this.el.preview;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const g = this.previewCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    // A worm swimming in place: points along a travelling sine wave.
    const t = now / 1000;
    const w = 22;
    const count = 34;
    const points = new Float32Array(count * 2);
    const headX = width * 0.74;
    for (let i = 0; i < count; i++) {
      const x = headX - i * 8.2;
      const y = height / 2 + Math.sin(i * 0.36 - t * 4.2) * 12 * Math.min(1, i / 6 + 0.25);
      points[i * 2] = x;
      points[i * 2 + 1] = y;
    }
    const angle = Math.atan2(points[1] - points[3], points[0] - points[2]);
    drawSnake(g, points, count, w, SKINS[this.skin], { angle, boosting: false, time: t });
  }

  // ---- notices ---------------------------------------------------------

  feed(html) {
    const item = document.createElement('li');
    item.innerHTML = html;
    this.el.feed.prepend(item);
    this.feedItems.unshift({ item, at: performance.now() });
    while (this.feedItems.length > 4) this.feedItems.pop().item.remove();
  }

  tickFeed(now) {
    for (const entry of this.feedItems) {
      const age = now - entry.at;
      entry.item.style.opacity = String(Math.max(0, Math.min(1, (6000 - age) / 800)));
    }
    while (this.feedItems.length && now - this.feedItems[this.feedItems.length - 1].at > 6000) {
      this.feedItems.pop().item.remove();
    }
  }

  toast(html) {
    const el = this.el.toast;
    el.innerHTML = html;
    el.classList.remove('show');
    void el.offsetWidth;   // restart the animation
    el.classList.add('show');
  }

  death(event, you) {
    const victim = escapeHtml(event.victimInfo?.name || 'a worm');
    if (event.killer === you && you) {
      this.toast(`You ate <b>${victim}</b> <em>+${fmt(event.score * 0.75)}</em>`);
      return;
    }
    if (event.victim === you) return;
    if (event.killer === 0xffff) return;
    // Only notable deaths make the feed; with bots in the arena, every crumb
    // being announced would drown out the ones worth seeing.
    if (event.score < 250) return;
    if (!event.killer) {
      this.feed(`<b>${victim}</b> hit the edge <em>${fmt(event.score)}</em>`);
      return;
    }
    const killer = escapeHtml(event.killerInfo?.name || 'a worm');
    this.feed(`<b>${killer}</b> ate <b>${victim}</b> <em>${fmt(event.score)}</em>`);
  }
}

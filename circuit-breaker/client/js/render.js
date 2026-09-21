// Everything the player sees. The renderer only reads a Game — it never changes
// one — so the simulation stays testable without a canvas and the drawing stays
// free to be as decorative as it likes.

import { COLS, ROWS, ENTRY, CORE, TOWERS, PACKETS, HEAT_MAX } from '#shared/constants.js';
import { idx, colOf, rowOf, TRACE, TOWER } from '#shared/grid.js';

const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cell = 40;
    this.originX = 0;
    this.originY = 0;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    // Whole pixels per cell keeps the 1px circuit lines from shimmering.
    this.cell = Math.max(12, Math.floor(Math.min(width / COLS, height / ROWS)));
    const boardW = this.cell * COLS;
    const boardH = this.cell * ROWS;
    this.canvas.width = Math.round(boardW * dpr);
    this.canvas.height = Math.round(boardH * dpr);
    this.canvas.style.width = `${boardW}px`;
    this.canvas.style.height = `${boardH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Canvas pixel -> board cell, or null when the click missed the board. */
  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * COLS);
    const row = Math.floor(((clientY - rect.top) / rect.height) * ROWS);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row };
  }

  px(x) { return x * this.cell; }

  draw(game, view = {}) {
    const { ctx, cell } = this;
    const w = cell * COLS;
    const h = cell * ROWS;
    ctx.clearRect(0, 0, w, h);

    this.drawBoard(game, w, h);
    this.drawRoute(game);
    this.drawEndpoints(game);
    this.drawHover(game, view);
    this.drawTowers(game, view);
    this.drawShells(game);
    this.drawPackets(game);
    this.drawEffects(game, w, h);
  }

  // ---- board -----------------------------------------------------------

  drawBoard(game, w, h) {
    const { ctx, cell } = this;
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(120, 170, 230, .08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(c * cell + .5, 0); ctx.lineTo(c * cell + .5, h); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(0, r * cell + .5); ctx.lineTo(w, r * cell + .5); }
    ctx.stroke();

    // Fixed traces read as soldered-down copper you have to build around.
    for (let i = 0; i < game.cells.length; i++) {
      if (game.cells[i] !== TRACE) continue;
      const x = colOf(i) * cell;
      const y = rowOf(i) * cell;
      ctx.fillStyle = '#16233d';
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      ctx.strokeStyle = 'rgba(106, 215, 255, .30)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2.5, y + 2.5, cell - 5, cell - 5);
      ctx.fillStyle = 'rgba(106, 215, 255, .30)';
      ctx.fillRect(x + cell / 2 - 1, y + cell / 2 - 1, 2, 2);
    }
  }

  /** The route packets are taking right now — the thing the maze is bending. */
  drawRoute(game) {
    const path = game.currentPath();
    if (path.length < 2) return;
    const { ctx, cell } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(217, 255, 85, .22)';
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([cell * 0.22, cell * 0.3]);
    ctx.lineDashOffset = -(game.time * cell * 1.4) % 1000;
    ctx.beginPath();
    path.forEach((c, i) => {
      const x = (colOf(c) + 0.5) * cell;
      const y = (rowOf(c) + 0.5) * cell;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  drawEndpoints(game) {
    const { ctx, cell } = this;
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 3);

    // Entry
    const ex = (ENTRY.col + 0.5) * cell;
    const ey = (ENTRY.row + 0.5) * cell;
    ctx.save();
    ctx.strokeStyle = `rgba(106, 215, 255, ${0.35 + pulse * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey, cell * 0.34, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Core — the thing being defended, so it gets the most ink.
    const cx = (CORE.col + 0.5) * cell;
    const cy = (CORE.row + 0.5) * cell;
    const hurt = 1 - game.integrity / 20;
    ctx.save();
    ctx.shadowBlur = 18 + pulse * 10;
    ctx.shadowColor = hurt > 0.6 ? '#ff557d' : '#d9ff55';
    ctx.strokeStyle = hurt > 0.6 ? '#ff557d' : '#d9ff55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const r = cell * (0.36 + pulse * 0.03);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = hurt > 0.6 ? 'rgba(255,85,125,.18)' : 'rgba(217,255,85,.14)';
    ctx.fill();
    ctx.restore();
  }

  drawHover(game, view) {
    if (!view.placing || !view.hover) return;
    const { ctx, cell } = this;
    const { col, row } = view.hover;
    const spec = TOWERS[view.placing];
    const good = view.valid;
    const x = col * cell;
    const y = row * cell;

    if (good) {
      ctx.save();
      ctx.fillStyle = 'rgba(217, 255, 85, .06)';
      ctx.strokeStyle = 'rgba(217, 255, 85, .5)';
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, spec.levels[0].range * cell, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = good ? '#d9ff55' : '#ff557d';
    ctx.fillStyle = good ? 'rgba(217,255,85,.16)' : 'rgba(255,85,125,.16)';
    ctx.lineWidth = 2;
    ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
    ctx.strokeRect(x + 2.5, y + 2.5, cell - 5, cell - 5);
    ctx.restore();
  }

  // ---- towers ----------------------------------------------------------

  drawTowers(game, view) {
    const { ctx, cell } = this;
    for (const tower of game.towers.values()) {
      const spec = TOWERS[tower.type];
      const level = spec.levels[tower.level - 1];
      const x = (tower.col + 0.5) * cell;
      const y = (tower.row + 0.5) * cell;
      const selected = view.selected === tower.cell;
      const boosted = tower.overclockLeft > 0;

      if (selected) {
        ctx.save();
        ctx.strokeStyle = 'rgba(217, 255, 85, .45)';
        ctx.fillStyle = 'rgba(217, 255, 85, .05)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, level.range * cell, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Base plate
      ctx.save();
      ctx.fillStyle = tower.overheated ? '#2a1622' : '#141a2c';
      ctx.strokeStyle = tower.overheated ? 'rgba(255,85,125,.65)' : 'rgba(180,220,255,.22)';
      ctx.lineWidth = 1.5;
      const pad = cell * 0.13;
      ctx.beginPath();
      ctx.roundRect(x - cell / 2 + pad, y - cell / 2 + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Turret, pointed at whatever it last shot
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tower.angle || 0);
      ctx.shadowBlur = boosted ? 16 : 8;
      ctx.shadowColor = spec.accent;
      ctx.fillStyle = tower.overheated ? '#7a4055' : spec.accent;
      const s = cell * 0.19;
      ctx.beginPath();
      switch (spec.kind) {
        case 'chain':
          ctx.moveTo(-s, -s); ctx.lineTo(s, -s * 0.3); ctx.lineTo(-s * 0.2, 0);
          ctx.lineTo(s, s * 0.3); ctx.lineTo(-s, s); ctx.lineTo(s * 0.2, 0);
          break;
        case 'slow':
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            const px = Math.cos(a) * s;
            const py = Math.sin(a) * s;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          break;
        case 'shell':
          ctx.rect(-s * 0.6, -s * 0.5, s * 1.9, s);
          break;
        case 'laser':
          ctx.arc(0, 0, s * 0.85, 0, TAU);
          break;
        default:
          ctx.moveTo(s, 0); ctx.lineTo(0, -s * 0.8); ctx.lineTo(-s * 0.7, 0); ctx.lineTo(0, s * 0.8);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Level pips
      ctx.save();
      ctx.fillStyle = spec.accent;
      for (let i = 0; i < tower.level; i++) {
        ctx.fillRect(x - cell * 0.3 + i * (cell * 0.11), y + cell * 0.28, cell * 0.07, 2);
      }
      ctx.restore();

      // Heat ring — the number the player is really managing.
      if (tower.heat > 1) {
        ctx.save();
        ctx.strokeStyle = tower.heat > HEAT_MAX * 0.75 ? '#ff9d5c' : 'rgba(106,215,255,.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.42, -Math.PI / 2, -Math.PI / 2 + (tower.heat / HEAT_MAX) * TAU);
        ctx.stroke();
        ctx.restore();
      }

      if (boosted) {
        ctx.save();
        ctx.strokeStyle = `rgba(217,255,85,${0.4 + 0.35 * Math.sin(game.time * 14)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.48, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      if (tower.overheated) {
        ctx.save();
        ctx.fillStyle = '#ff557d';
        ctx.font = `600 ${Math.round(cell * 0.3)}px 'DM Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', x, y - cell * 0.02);
        ctx.restore();
      }
    }
  }

  drawShells(game) {
    const { ctx, cell } = this;
    for (const shell of game.shells) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = shell.colour;
      ctx.fillStyle = shell.colour;
      ctx.beginPath();
      ctx.arc(shell.x * cell, shell.y * cell, cell * 0.09, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- packets ---------------------------------------------------------

  drawPackets(game) {
    const { ctx, cell } = this;
    for (const packet of game.packets) {
      const spec = PACKETS[packet.type];
      const x = packet.x * cell;
      const y = packet.y * cell;
      const r = packet.radius * cell;
      const slowed = packet.slowUntil > game.time;
      const stunned = packet.stunUntil > game.time;

      ctx.save();
      ctx.globalAlpha = packet.phasing ? 0.28 : 1;
      ctx.shadowBlur = packet.boss ? 20 : 8;
      ctx.shadowColor = spec.color;
      ctx.fillStyle = slowed ? '#9db8ff' : spec.color;

      ctx.beginPath();
      if (packet.boss) {
        // Bosses are drawn as a rotating diamond so they read instantly.
        const a = game.time * 1.4;
        for (let i = 0; i < 4; i++) {
          const t = a + (i / 4) * TAU;
          const px = x + Math.cos(t) * r;
          const py = y + Math.sin(t) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();

      if (packet.armor > 0) {
        ctx.globalAlpha = packet.phasing ? 0.3 : 0.85;
        ctx.strokeStyle = '#e6ecff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (stunned) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#6ad7ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      // Health bar, only once something has actually hurt it.
      if (packet.hp < packet.maxHp) {
        const width = r * 2.2;
        const ratio = Math.max(0, packet.hp / packet.maxHp);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(x - width / 2, y - r - 7, width, 3);
        ctx.fillStyle = ratio > 0.5 ? '#d9ff55' : ratio > 0.25 ? '#ff9d5c' : '#ff557d';
        ctx.fillRect(x - width / 2, y - r - 7, width * ratio, 3);
        ctx.restore();
      }
    }
  }

  // ---- effects ---------------------------------------------------------

  drawEffects(game, w, h) {
    const { ctx, cell } = this;
    for (const effect of game.effects) {
      const fade = Math.max(0, effect.ttl / effect.life);
      ctx.save();
      ctx.globalAlpha = fade;

      switch (effect.kind) {
        case 'beam':
        case 'laser': {
          ctx.strokeStyle = effect.colour;
          ctx.shadowBlur = 12;
          ctx.shadowColor = effect.colour;
          ctx.lineWidth = (effect.kind === 'laser' ? 2 + (effect.width || 1) * 1.6 : 2.2);
          ctx.beginPath();
          ctx.moveTo(effect.x1 * cell, effect.y1 * cell);
          ctx.lineTo(effect.x2 * cell, effect.y2 * cell);
          ctx.stroke();
          break;
        }
        case 'chain': {
          ctx.strokeStyle = effect.colour;
          ctx.shadowBlur = 14;
          ctx.shadowColor = effect.colour;
          ctx.lineWidth = 2;
          ctx.beginPath();
          effect.points.forEach((point, i) => {
            const x = point.x * cell;
            const y = point.y * cell;
            if (i === 0) ctx.moveTo(x, y);
            else {
              // A slight kink per segment sells it as electricity rather than wire.
              const prev = effect.points[i - 1];
              const mx = ((prev.x + point.x) / 2) * cell + (i % 2 ? 5 : -5);
              const my = ((prev.y + point.y) / 2) * cell + (i % 2 ? -5 : 5);
              ctx.lineTo(mx, my);
              ctx.lineTo(x, y);
            }
          });
          ctx.stroke();
          break;
        }
        case 'ring':
        case 'blast': {
          const grow = effect.kind === 'blast' ? 1 + (1 - fade) * 0.5 : 1;
          ctx.strokeStyle = effect.colour;
          ctx.fillStyle = effect.colour;
          ctx.globalAlpha = fade * 0.22;
          ctx.beginPath();
          ctx.arc(effect.x * cell, effect.y * cell, effect.r * cell * grow, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = fade;
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
        case 'pop': {
          ctx.strokeStyle = effect.boss ? '#ff557d' : '#eaf2ff';
          ctx.lineWidth = 2;
          const r = (1 - fade) * cell * (effect.boss ? 1.4 : 0.6);
          ctx.beginPath();
          ctx.arc(effect.x * cell, effect.y * cell, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'overheat': {
          ctx.fillStyle = '#ff9d5c';
          ctx.font = `600 ${Math.round(cell * 0.26)}px 'DM Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('OVERHEAT', effect.x * cell, effect.y * cell - cell * (1 - fade) - 8);
          break;
        }
        case 'breach': {
          ctx.strokeStyle = '#ff557d';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(effect.x * cell, effect.y * cell, (1 - fade) * cell * 1.6, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'surge': {
          ctx.fillStyle = 'rgba(106, 215, 255, .30)';
          ctx.fillRect(0, 0, w, h);
          break;
        }
        default: break;
      }
      ctx.restore();
    }
  }
}

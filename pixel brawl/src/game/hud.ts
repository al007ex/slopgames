import { GameMode, MODES, TEAM_COLORS } from '@shared/constants';
import type { Snapshot } from '@shared/types';
import { getBrawler } from '@shared/brawlers';
import { drawText, textWidth } from '../art/font';
import { item, upscale } from '../art/sprites';
import type { Controls, HudLayout } from './input';

export interface HudState {
  snap: Snapshot;
  you: number;
  mode: GameMode;
  controls: Controls;
  cssW: number;
  cssH: number;
  dpr: number;
  ping: number;
  events: { text: string; color: string; life: number }[];
}

const iconCache = new Map<string, HTMLCanvasElement>();
function icon(name: 'gem' | 'star' | 'trophy' | 'cube' | 'coin', scale: number) {
  const key = name + scale;
  let c = iconCache.get(key);
  if (!c) {
    c = upscale(item(name === 'cube' ? 'cube' : name), scale);
    iconCache.set(key, c);
  }
  return c;
}

export function layoutHud(cssW: number, cssH: number, touch: boolean): HudLayout {
  const s = Math.max(0.75, Math.min(2.1, Math.min(cssW, cssH) / 430));
  const margin = 78 * s;
  const attack = { x: cssW - margin, y: cssH - margin, r: 46 * s };
  const narrow = cssW < 560;
  const sup = narrow
    ? { x: cssW - margin, y: cssH - margin - 106 * s, r: 34 * s }
    : { x: cssW - margin - 104 * s, y: cssH - margin + 12 * s, r: 34 * s };
  return {
    attack,
    super: sup,
    moveZone: { x: 0, y: cssH * 0.18, w: cssW * 0.5, h: cssH * 0.82 },
    scale: s,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawHud(ctx: CanvasRenderingContext2D, st: HudState) {
  const { snap, you, cssW, cssH, dpr, controls } = st;
  const layout = controls.layout;
  const s = layout.scale;
  const me = snap.players.find((p) => p.i === you);
  const info = MODES[st.mode];

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  /* ------------------------------- top bar ------------------------------ */
  const barH = 34 * s;
  ctx.fillStyle = 'rgba(10, 8, 18, 0.9)';
  ctx.fillRect(0, 0, cssW, barH);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, barH - 2 * s, cssW, 2 * s);

  // timer
  const secs = Math.max(0, Math.ceil(snap.time));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const timeStr = `${mm}:${ss < 10 ? '0' : ''}${ss}`;
  const urgent = snap.phase === 'live' && secs <= 15;
  drawText(ctx, timeStr, cssW / 2, 8 * s, {
    scale: Math.max(2, Math.round(2.4 * s)),
    color: urgent ? '#ff6b6b' : '#ffffff',
    align: 'center',
    shadow: '#000',
  });

  // mode label
  drawText(ctx, info.name, cssW / 2, barH + 6 * s, {
    scale: Math.max(1, Math.round(1.2 * s)),
    color: info.color,
    align: 'center',
    shadow: '#000',
  });

  /* ------------------------------- scores ------------------------------- */
  if (st.mode === GameMode.GemGrab) {
    drawTeamScore(ctx, snap, s, cssW, barH, 'gem', 10);
  } else if (st.mode === GameMode.Bounty) {
    drawTeamScore(ctx, snap, s, cssW, barH, 'star', 0);
  } else if (st.mode === GameMode.Duel) {
    drawTeamScore(ctx, snap, s, cssW, barH, 'heart', 0);
  } else {
    const alive = snap.players.filter((p) => p.st & 1).length;
    const ic = icon('trophy', Math.max(1, Math.round(s * 1.6)));
    ctx.drawImage(ic, 12 * s, 8 * s);
    drawText(ctx, `${alive} LEFT`, 12 * s + ic.width + 6 * s, 10 * s, {
      scale: Math.max(1, Math.round(1.6 * s)),
      color: '#ffd23f',
      shadow: '#000',
    });
  }

  /* --------------------------- gem grab countdown ----------------------- */
  if (st.mode === GameMode.GemGrab && snap.cdTeam >= 0) {
    const col = TEAM_COLORS[snap.cdTeam % TEAM_COLORS.length];
    const mine = me && snap.cdTeam === me.t;
    const y = barH + 26 * s;
    drawText(ctx, mine ? 'HOLD THEM!' : 'THEY HAVE 10 GEMS', cssW / 2, y, {
      scale: Math.max(1, Math.round(1.6 * s)),
      color: col,
      align: 'center',
      shadow: '#000',
    });
    drawText(ctx, String(Math.ceil(snap.cdTime)), cssW / 2, y + 16 * s, {
      scale: Math.max(2, Math.round(3 * s)),
      color: col,
      align: 'center',
      shadow: '#000',
    });
  }

  /* ------------------------------ countdown ----------------------------- */
  if (snap.phase === 'countdown') {
    const n = Math.ceil(snap.time);
    const txt = n <= 0 ? 'GO!' : String(n);
    drawText(ctx, txt, cssW / 2, cssH * 0.36, {
      scale: Math.max(4, Math.round(7 * s)),
      color: '#ffd23f',
      align: 'center',
      shadow: '#000',
    });
    drawText(ctx, 'GET READY', cssW / 2, cssH * 0.36 - 24 * s, {
      scale: Math.max(1, Math.round(1.8 * s)),
      color: '#ffffff',
      align: 'center',
      shadow: '#000',
    });
  }

  /* ---------------------------- respawn / dead -------------------------- */
  if (me && !(me.st & 1) && snap.phase === 'live') {
    const dead = st.mode === GameMode.Showdown;
    ctx.fillStyle = 'rgba(8, 6, 14, 0.55)';
    ctx.fillRect(0, 0, cssW, cssH);
    drawText(ctx, dead ? 'ELIMINATED' : 'RESPAWNING', cssW / 2, cssH * 0.42, {
      scale: Math.max(2, Math.round(3.2 * s)),
      color: '#ff6b6b',
      align: 'center',
      shadow: '#000',
    });
    if (dead) {
      drawText(ctx, 'SPECTATING', cssW / 2, cssH * 0.42 + 30 * s, {
        scale: Math.max(1, Math.round(1.4 * s)),
        color: '#c8cdd6',
        align: 'center',
        shadow: '#000',
      });
    }
  }

  /* ----------------------------- event feed ----------------------------- */
  let ey = barH + 44 * s;
  for (const e of st.events) {
    const a = Math.min(1, e.life * 2);
    ctx.globalAlpha = a;
    drawText(ctx, e.text, cssW / 2, ey, {
      scale: Math.max(1, Math.round(1.3 * s)),
      color: e.color,
      align: 'center',
      shadow: '#000',
    });
    ctx.globalAlpha = 1;
    ey += 14 * s;
  }

  /* ------------------------------- controls ----------------------------- */
  if (controls.touchMode) {
    // move stick
    if (controls.moveStick.active) {
      const m = controls.moveStick;
      const len = Math.hypot(m.x, m.y);
      const k = Math.min(1, len / 62);
      const nx = len > 0 ? (m.x / len) * k * 44 * s : 0;
      const ny = len > 0 ? (m.y / len) * k * 44 * s : 0;
      ring(ctx, m.ox, m.oy, 46 * s, 'rgba(255,255,255,0.22)', 4 * s);
      circle(ctx, m.ox + nx, m.oy + ny, 22 * s, 'rgba(255,255,255,0.5)');
    } else {
      ring(ctx, layout.moveZone.x + 90 * s, cssH - 90 * s, 46 * s, 'rgba(255,255,255,0.12)', 3 * s);
      circle(ctx, layout.moveZone.x + 90 * s, cssH - 90 * s, 20 * s, 'rgba(255,255,255,0.16)');
    }

    drawActionButton(ctx, layout.attack, me ? me.am : 0, 3, '#ffd23f', 'ATTACK', s, controls.atkStick, false, me ? me.b : '');
    drawActionButton(ctx, layout.super, me ? me.sc / 100 : 0, 1, '#8b5cf6', 'SUPER', s, controls.supStick, true, me ? me.b : '');
  } else {
    // PC: compact indicators bottom-right
    drawActionButton(ctx, layout.attack, me ? me.am : 0, 3, '#ffd23f', 'LMB', s * 0.85, controls.atkStick, false, me ? me.b : '');
    drawActionButton(ctx, layout.super, me ? me.sc / 100 : 0, 1, '#8b5cf6', 'RMB', s * 0.85, controls.supStick, true, me ? me.b : '');
    drawText(ctx, 'WASD MOVE   MOUSE AIM   RMB SUPER', 12 * s, cssH - 32 * s, {
      scale: Math.max(1, Math.round(s)),
      color: 'rgba(255,255,255,0.45)',
      shadow: '#000',
    });
  }

  /* --------------------------- local health chip ------------------------ */
  if (me && me.st & 1) {
    const chipW = 108 * s;
    const chipH = 26 * s;
    const cx = 12 * s;
    const cy = cssH - chipH - 44 * s;
    ctx.fillStyle = 'rgba(10,8,18,0.7)';
    roundRect(ctx, cx, cy, chipW, chipH, 5 * s);
    ctx.fill();
    const frac = Math.max(0, me.hp / Math.max(1, me.mx));
    ctx.fillStyle = '#1c2a1c';
    ctx.fillRect(cx + 5 * s, cy + 13 * s, chipW - 10 * s, 8 * s);
    ctx.fillStyle = frac > 0.35 ? '#4ade80' : '#ff6b6b';
    ctx.fillRect(cx + 5 * s, cy + 13 * s, (chipW - 10 * s) * frac, 8 * s);
    drawText(ctx, `${me.hp}`, cx + 6 * s, cy + 3 * s, { scale: Math.max(1, Math.round(1.3 * s)), color: '#ffffff', shadow: '#000' });
    const def = getBrawler(me.b);
    drawText(ctx, def.name, cx + chipW - 4 * s, cy + 3 * s, {
      scale: Math.max(1, Math.round(1.1 * s)),
      color: '#ffd23f',
      align: 'right',
      shadow: '#000',
    });
  }

  /* ------------------------------ ping chip ----------------------------- */
  drawText(ctx, `${Math.round(st.ping)}MS`, cssW - 8 * s, 48 * s, {
    scale: Math.max(1, Math.round(1 * s)),
    color: st.ping < 90 ? 'rgba(120,255,160,0.6)' : 'rgba(255,180,120,0.7)',
    align: 'right',
  });

  ctx.restore();
}

function drawTeamScore(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  s: number,
  cssW: number,
  barH: number,
  kind: 'gem' | 'star' | 'heart',
  target: number,
) {
  const cy = 8 * s;
  const boxW = 62 * s;
  for (let t = 0; t < 2; t++) {
    const col = TEAM_COLORS[t];
    const x = t === 0 ? cssW / 2 - boxW - 44 * s : cssW / 2 + 44 * s;
    ctx.fillStyle = col;
    roundRect(ctx, x, cy - 3 * s, boxW, 22 * s, 4 * s);
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    const val = snap.scores[t] ?? 0;
    const label = target ? `${val}/${target}` : String(val);
    const ic = kind === 'star' ? icon('star', Math.max(1, Math.round(s * 1.4))) : kind === 'gem' ? icon('gem', Math.max(1, Math.round(s * 1.4))) : null;
    let tx = x + 6 * s;
    if (ic) {
      ctx.drawImage(ic, tx, cy + 1 * s);
      tx += ic.width + 4 * s;
    }
    drawText(ctx, label, tx, cy + 2 * s, { scale: Math.max(1, Math.round(1.6 * s)), color: '#ffffff', shadow: 'rgba(0,0,0,0.5)' });
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string, w: number) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawActionButton(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number; r: number },
  value: number,
  segments: number,
  color: string,
  label: string,
  s: number,
  stick: { active: boolean; x: number; y: number },
  isSuper: boolean,
  brawlerId: string,
) {
  const { x, y, r } = pos;
  const ready = isSuper ? value >= 1 : value >= 1;

  // base
  circle(ctx, x, y, r, 'rgba(12, 10, 20, 0.66)');
  ring(ctx, x, y, r, ready ? color : 'rgba(255,255,255,0.18)', 3 * s);

  // charge / ammo indicator
  ctx.lineWidth = 5 * s;
  ctx.lineCap = 'butt';
  if (segments > 1) {
    const gap = 0.16;
    for (let i = 0; i < segments; i++) {
      const a0 = -Math.PI / 2 + (i / segments) * Math.PI * 2 + gap / 2;
      const a1 = -Math.PI / 2 + ((i + 1) / segments) * Math.PI * 2 - gap / 2;
      const filled = value >= i + 1;
      const partial = !filled && value > i ? value - i : 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.arc(x, y, r - 6 * s, a0, a1);
      ctx.stroke();
      if (filled || partial > 0) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r - 6 * s, a0, a0 + (a1 - a0) * (filled ? 1 : partial));
        ctx.stroke();
      }
    }
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(x, y, r - 6 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r - 6 * s, -Math.PI / 2, -Math.PI / 2 + Math.min(1, value) * Math.PI * 2);
    ctx.stroke();
  }

  if (ready && isSuper) {
    ctx.globalAlpha = 0.25 + Math.sin(performance.now() / 180) * 0.15;
    circle(ctx, x, y, r - 8 * s, color);
    ctx.globalAlpha = 1;
  }

  drawText(ctx, label, x, y - 4 * s, {
    scale: Math.max(1, Math.round(1.1 * s)),
    color: ready ? '#ffffff' : 'rgba(255,255,255,0.5)',
    align: 'center',
    shadow: '#000',
  });

  // aim guide while dragging
  if (stick.active) {
    const len = Math.hypot(stick.x, stick.y);
    if (len > 8) {
      const k = Math.min(1, len / 62);
      const nx = (stick.x / len) * k * r;
      const ny = (stick.y / len) * k * r;
      circle(ctx, x + nx, y + ny, 16 * s, 'rgba(255,255,255,0.55)');
    }
  }
  void brawlerId;
  void textWidth;
}

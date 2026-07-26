export interface StickState {
  active: boolean;
  pointer: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  moved: boolean;
}

export interface HudLayout {
  attack: { x: number; y: number; r: number };
  super: { x: number; y: number; r: number };
  moveZone: { x: number; y: number; w: number; h: number };
  scale: number;
}

function newStick(): StickState {
  return { active: false, pointer: -1, ox: 0, oy: 0, x: 0, y: 0, moved: false };
}

const MAX_DRAG = 62;

export class Controls {
  move = { x: 0, y: 0 };
  aim = { x: 1, y: 0 };
  aimDist = 1;
  shoot = false;
  useSuper = false;
  /** true while the player is dragging an attack/super stick — used to draw the aim guide */
  aiming: 'none' | 'attack' | 'super' = 'none';

  moveStick = newStick();
  atkStick = newStick();
  supStick = newStick();

  touchMode = false;
  layout: HudLayout = {
    attack: { x: 0, y: 0, r: 50 },
    super: { x: 0, y: 0, r: 40 },
    moveZone: { x: 0, y: 0, w: 0, h: 0 },
    scale: 1,
  };

  /** Set by the game every frame: direction to the closest enemy, for tap-to-fire. */
  autoAim = { x: 1, y: 0, dist: 1, found: false };
  /** Canvas-space cursor, used for mouse aiming. */
  private mouse = { x: 0, y: 0, inside: false };
  private keys = new Set<string>();
  private canvas: HTMLCanvasElement | null = null;
  private playerScreen = { x: 0, y: 0 };
  private fireQueued = false;
  private superQueued = false;
  private detachers: (() => void)[] = [];

  attach(canvas: HTMLCanvasElement) {
    this.detach();
    this.canvas = canvas;

    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window | Document,
      type: K | string,
      fn: (e: any) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type as string, fn as EventListener, opts);
      this.detachers.push(() => el.removeEventListener(type as string, fn as EventListener));
    };

    on(canvas, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    on(window, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(window, 'pointerup', (e: PointerEvent) => this.onUp(e));
    on(window, 'pointercancel', (e: PointerEvent) => this.onUp(e));
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'shift') e.preventDefault();
      if (k === 'q' || k === 'e' || k === 'f' || k === 'shift') this.superQueued = true;
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => {
      this.keys.clear();
      this.moveStick = newStick();
      this.atkStick = newStick();
      this.supStick = newStick();
    });
  }

  detach() {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.keys.clear();
  }

  setPlayerScreen(x: number, y: number) {
    this.playerScreen.x = x;
    this.playerScreen.y = y;
  }

  private local(e: PointerEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hit(p: { x: number; y: number }, c: { x: number; y: number; r: number }) {
    return Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.25;
  }

  private onDown(e: PointerEvent) {
    if (!this.canvas) return;
    const p = this.local(e);
    if (e.pointerType === 'touch') this.touchMode = true;

    if (e.pointerType === 'mouse') {
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = true;
      if (e.button === 0) this.shoot = true;
      if (e.button === 2) this.superQueued = true;
      return;
    }

    if (this.hit(p, this.layout.super)) {
      this.supStick = { active: true, pointer: e.pointerId, ox: this.layout.super.x, oy: this.layout.super.y, x: 0, y: 0, moved: false };
      this.aiming = 'super';
      return;
    }
    if (this.hit(p, this.layout.attack)) {
      this.atkStick = { active: true, pointer: e.pointerId, ox: this.layout.attack.x, oy: this.layout.attack.y, x: 0, y: 0, moved: false };
      this.aiming = 'attack';
      return;
    }
    const z = this.layout.moveZone;
    if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
      this.moveStick = { active: true, pointer: e.pointerId, ox: p.x, oy: p.y, x: 0, y: 0, moved: false };
    }
  }

  private onMove(e: PointerEvent) {
    if (!this.canvas) return;
    const p = this.local(e);
    if (e.pointerType === 'mouse') {
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = true;
      return;
    }
    for (const s of [this.moveStick, this.atkStick, this.supStick]) {
      if (!s.active || s.pointer !== e.pointerId) continue;
      s.x = p.x - s.ox;
      s.y = p.y - s.oy;
      if (Math.hypot(s.x, s.y) > 6) s.moved = true;
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.shoot = false;
      return;
    }
    if (this.moveStick.active && this.moveStick.pointer === e.pointerId) this.moveStick = newStick();
    if (this.atkStick.active && this.atkStick.pointer === e.pointerId) {
      this.releaseStick(this.atkStick, false);
      this.atkStick = newStick();
      this.aiming = 'none';
    }
    if (this.supStick.active && this.supStick.pointer === e.pointerId) {
      this.releaseStick(this.supStick, true);
      this.supStick = newStick();
      this.aiming = 'none';
    }
  }

  private releaseStick(s: StickState, isSuper: boolean) {
    const len = Math.hypot(s.x, s.y);
    if (s.moved && len > 8) {
      this.aim.x = s.x / len;
      this.aim.y = s.y / len;
      this.aimDist = Math.max(0.15, Math.min(1, len / MAX_DRAG));
    } else if (this.autoAim.found) {
      this.aim.x = this.autoAim.x;
      this.aim.y = this.autoAim.y;
      this.aimDist = this.autoAim.dist;
    }
    if (isSuper) this.superQueued = true;
    else this.fireQueued = true;
  }

  /** Called once per frame by the game loop to fold raw input into a command. */
  sample(maxRange: number): { mx: number; my: number; ax: number; ay: number; ad: number; shoot: boolean; useSuper: boolean } {
    // movement
    let mx = 0;
    let my = 0;
    if (this.moveStick.active) {
      const len = Math.hypot(this.moveStick.x, this.moveStick.y);
      if (len > 6) {
        const k = Math.min(1, len / MAX_DRAG);
        mx = (this.moveStick.x / len) * k;
        my = (this.moveStick.y / len) * k;
      }
    } else {
      if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
      if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
      const l = Math.hypot(mx, my);
      if (l > 1) {
        mx /= l;
        my /= l;
      }
    }
    this.move.x = mx;
    this.move.y = my;

    // aiming
    let ax = this.aim.x;
    let ay = this.aim.y;
    let ad = this.aimDist;
    const live = this.atkStick.active ? this.atkStick : this.supStick.active ? this.supStick : null;
    if (live) {
      const len = Math.hypot(live.x, live.y);
      if (len > 8) {
        ax = live.x / len;
        ay = live.y / len;
        ad = Math.max(0.15, Math.min(1, len / MAX_DRAG));
      }
    } else if (!this.touchMode && this.mouse.inside) {
      const dx = this.mouse.x - this.playerScreen.x;
      const dy = this.mouse.y - this.playerScreen.y;
      const len = Math.hypot(dx, dy) || 1;
      ax = dx / len;
      ay = dy / len;
      ad = Math.max(0.12, Math.min(1, len / (maxRange || 1)));
    }
    this.aim.x = ax;
    this.aim.y = ay;
    this.aimDist = ad;

    const shoot = this.shoot || this.keys.has(' ') || this.fireQueued;
    const useSuper = this.superQueued;
    this.fireQueued = false;
    this.superQueued = false;

    return { mx, my, ax, ay, ad, shoot, useSuper };
  }
}

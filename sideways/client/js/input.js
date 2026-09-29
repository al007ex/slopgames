// Keyboard, gamepad and touch, merged into the one set of keys the pilot reads.

import { blankInput } from '#shared/pilot.js';

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  clutch: ['ShiftLeft', 'ShiftRight'],
  twoStep: ['KeyF'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.edges = [];
    this.touch = new Set();
    this.raw = blankInput();
    this.usingPad = false;
    this.padWas = {};
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.edges.push(e.code);
      this.down.add(e.code);
      this.usingPad = false;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());

    for (const b of document.querySelectorAll('#touch button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); this.touch.add(k); b.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch.delete(k); b.classList.remove('down'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
  }

  held(name) { return KEYS[name].some((c) => this.down.has(c)); }

  /** Key presses since the last call (by code), for one-shot actions. */
  takeEdges() {
    const e = this.edges;
    this.edges = [];
    return e;
  }

  poll() {
    const r = this.raw;
    const left = this.held('left') || this.touch.has('left');
    const right = this.held('right') || this.touch.has('right');
    r.steer = (left ? 1 : 0) - (right ? 1 : 0);
    r.throttle = this.held('throttle') || this.touch.has('gas') ? 1 : 0;
    r.brake = this.held('brake') || this.touch.has('brake') ? 1 : 0;
    r.handbrake = this.held('handbrake') || this.touch.has('handbrake') ? 1 : 0;
    r.clutch = this.held('clutch') || this.touch.has('clutch') ? 1 : 0;
    r.twoStep = this.held('twoStep') ? 1 : 0;
    r.analog = false;
    r.shiftUp = false;
    r.shiftDown = false;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const b = (i) => pad.buttons[i]?.value || 0;
      const stick = pad.axes[0] || 0;
      const active = Math.abs(stick) > 0.15 || b(7) > 0.05 || b(6) > 0.05 || pad.buttons.some((x) => x.pressed);
      if (active) this.usingPad = true;
      if (this.usingPad) {
        const dz = (v) => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9);
        r.steer = -Math.sign(dz(stick)) * Math.pow(Math.abs(dz(stick)), 1.4);
        r.throttle = b(7);
        r.brake = b(6);
        r.handbrake = b(0) > 0.5 ? 1 : 0;
        r.clutch = b(1) > 0.5 ? 1 : 0;
        r.twoStep = b(2) > 0.5 ? 1 : 0;
        r.analog = true;
        const edge = (i, name) => { const now = b(i) > 0.5; const was = this.padWas[i]; this.padWas[i] = now; if (now && !was) this.edges.push(name); };
        edge(5, 'KeyE'); edge(4, 'KeyQ'); edge(3, 'KeyC'); edge(9, 'Escape'); edge(8, 'KeyR'); edge(11, 'KeyH');
      }
    }
    if (!this.enabled) Object.assign(r, blankInput());
    return r;
  }
}

// Keyboard and mouse. Mouse look needs pointer lock; everything else is a set
// of held keys plus a queue of presses the game consumes once per tick.

export const BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'],
  reload: ['KeyR'], interact: ['KeyE'], map: ['KeyM'],
  wall: ['KeyQ'], floor: ['KeyF'], ramp: ['KeyZ'], cone: ['KeyX'], edit: ['KeyG'], buildToggle: ['KeyB'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], slot6: ['Digit6'],
  ping: ['KeyT'], drop: ['KeyV'], scoreboard: ['Tab'],
};

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.pressed = [];
    this.mouse = { left: false, right: false, dx: 0, dy: 0, wheel: 0 };
    this.clicks = [];          // 'left' / 'right' presses since last consumed
    this.locked = false;
    this.sensitivity = Number(localStorage.getItem('sw.sens')) || 0.0022;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.clicks.push('left'); }
      if (e.button === 2) { this.mouse.right = true; this.clicks.push('right'); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; }
    });
  }

  lock() {
    if (this.locked) return;
    try { this.target.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  held(action) { return BINDS[action].some((code) => this.keys.has(code)); }

  /** Presses since the last call, as action names. */
  takePresses() {
    const out = [];
    for (const code of this.pressed) {
      for (const [action, codes] of Object.entries(BINDS)) if (codes.includes(code)) out.push(action);
    }
    this.pressed.length = 0;
    return out;
  }

  takeClicks() { const c = this.clicks.slice(); this.clicks.length = 0; return c; }

  takeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    return m;
  }
}

// Keyboard, mouse and pointer lock. Edge-triggered presses are cleared once per
// frame by consume(), so a system can ask "was jump pressed this frame?".

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.fire = false;
    this.firePressed = false;
    this.aim = false;
    this.wheel = 0;
    this.locked = false;
    this.sens = 1;
    this.invertY = false;
    this.enabled = true;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => { this.held.clear(); this.fire = false; this.aim = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.fire = true; this.firePressed = true; }
      if (e.button === 2) this.aim = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.dx += e.movementX || 0;
      this.dy += (e.movementY || 0) * (this.invertY ? -1 : 1);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
      if (!this.locked) { this.held.clear(); this.fire = false; this.aim = false; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  unlock() {
    if (this.locked) document.exitPointerLock?.();
  }

  down(code) { return this.enabled && this.held.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }

  /** -1..1 on each axis, from WASD. */
  get moveX() { return (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0); }
  get moveZ() { return (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0); }

  get sprint() { return this.down('ShiftLeft') || this.down('ShiftRight'); }
  get crouch() { return this.down('KeyC'); }
  get slideHeld() { return this.down('ControlLeft') || this.down('ControlRight'); }
  get slidePressed() { return this.hit('ControlLeft') || this.hit('ControlRight'); }
  get jumpPressed() { return this.hit('Space'); }
  get interactHeld() { return this.down('KeyE'); }
  get interactPressed() { return this.hit('KeyE'); }
  get reloadPressed() { return this.hit('KeyR'); }

  consume() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.firePressed = false;
  }
}

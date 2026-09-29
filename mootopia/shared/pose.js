// Poses: where a weapon sits in its holder's hand, and the swing animation.
// Shared so the tests can hold them to the classic formulas.

import * as C from './config.js';
import { spriteInfo } from './sprites.js';

/** Where a weapon's sprite goes in its holder's frame (see Renderer.drawTool). */
export function weaponBox(w, sc, handAngle = Math.PI / 4 * (w.armS || 1)) {
  const key = w.drawn === 'musket' || w.drawn === 'grabby' ? `drawn/${w.drawn}` : `weapons/${w.sprite}`;
  const { w: width, h: height } = spriteInfo(key);
  const hx = sc * Math.cos(handAngle); const hy = sc * Math.sin(handAngle);
  const cx = hx + (sc + w.xOff - hx) * (width / w.length);
  const cy = hy + (w.yOff - hy) * (height / w.width);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The swing: a quarter of the time swinging out to the target angle, three
 * quarters swinging back. A swing that hits something goes a quarter turn; one
 * that only cuts air goes a half turn.
 */
export function animate(e, delta) {
  if (!(e.animTime > 0)) return;
  e.animTime -= delta;
  if (e.animTime <= 0) { e.animTime = 0; e.dirPlus = 0; e.ratio = 0; e.phase = 0; return; }
  if (e.phase === 0) {
    e.ratio += delta / (e.animSpeed * C.HIT_RETURN);
    e.dirPlus = e.targetAngle * Math.min(1, e.ratio);
    if (e.ratio >= 1) { e.ratio = 1; e.phase = 1; }
  } else {
    e.ratio -= delta / (e.animSpeed * (1 - C.HIT_RETURN));
    e.dirPlus = e.targetAngle * Math.max(0, e.ratio);
  }
}

export function startSwing(e, hit, speed) {
  e.animTime = e.animSpeed = speed;
  e.targetAngle = hit ? -C.HIT_ANGLE : -C.MISS_ANGLE;
  e.ratio = 0; e.phase = 0;
}

// The storm in a match: started when the blimp launches, ticking damage once
// a second to everyone outside the eye, and announcing each phase to clients
// (who draw the wall and the next circle from the same plan).

import { planStorm, stormAt, outsideStorm } from '../shared/storm.js';
import { TICK_HZ } from '../shared/constants.js';
import { MODE_DEAD, MODE_BUS } from '../shared/movement.js';

export const stormMethods = {
  startStorm(tick = this.tick, phases) {
    const terrain = this.world.terrain;
    this.stormPlan = planStorm(this.rngSeed ^ 0x5eed, (x, z) => terrain.heightAt(x, z) > 2, phases);
    this.stormStart = tick;
    this.stormPhase = 0;
    this.stormState = null;
    this.announceStorm();
  },

  stormNow() {
    if (!this.stormPlan) return null;
    return stormAt(this.stormPlan, (this.tick - this.stormStart) / TICK_HZ);
  },

  stageStorm() {
    this.mark('storm');
    const s = this.stormNow();
    if (!s) return;
    if (s.phase !== this.stormPhase || s.state !== this.stormState) {
      this.stormPhase = s.phase;
      this.stormState = s.state;
      this.announceStorm();
    }
    if ((this.tick - this.stormStart) % TICK_HZ !== 0 || this.tick === this.stormStart) return;
    for (const p of this.players.values()) {
      if (!p.alive || p.move.mode === MODE_DEAD || p.move.mode === MODE_BUS) continue;
      if (outsideStorm(s, p.move.x, p.move.z)) {
        p.stormTicks = (p.stormTicks || 0) + 1;
        this.damage(p, s.dps, { kind: 'storm' });
      }
    }
  },

  /** What clients need to draw the storm: the plan up to the next circle only. */
  stormMessage() {
    const s = this.stormNow();
    if (!s) return null;
    const known = this.stormPlan.circles.slice(0, Math.min(this.stormPlan.circles.length, s.phase + 1));
    return { t: 'storm', start: this.stormStart, phase: s.phase, state: s.state, circles: known, phases: this.stormPlan.phases.slice(0, s.phase) };
  },

  announceStorm() {
    const msg = this.stormMessage();
    if (!msg) return;
    for (const conn of this.conns) conn.sendJson(msg);
  },
};

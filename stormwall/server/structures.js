// Damage to things that are not players: build pieces and props. A piece that
// runs out of health comes down and takes with it everything it was holding up.
// Pickaxing the map (anything placed by world generation) yields materials;
// breaking what players built does not.

import { hpAt, pieceCenter, MAT_STATS } from '../shared/pieces.js';
import { PROP_KINDS, propMaxHp, propCenter, YIELD_PER_DAMAGE } from '../shared/props.js';
import { MAT_CAP } from '../shared/constants.js';
import { EV_BREAK } from '../shared/events.js';

const MAX_BREAK_EVENTS = 40;
const c = {};

export const structureMethods = {
  /** Queues damage to a piece or prop; applied in the damage stage. */
  damageStructure(obj, kind, amount, info = {}) {
    if (amount > 0 && obj && obj.alive) this.damageQueue.push({ structure: true, obj, kind, amount, ...info });
  },

  structureHp(obj, kind) {
    if (kind === 'piece') return hpAt(obj, this.tick);
    if (obj.hp === undefined) obj.hp = propMaxHp(obj);
    return obj.hp;
  },

  materialOf(obj, kind) { return kind === 'piece' ? obj.mat : PROP_KINDS[obj.kind].mat; },

  /** Map objects yield materials when harvested; player builds never do. */
  harvestable(obj, kind) { return kind === 'prop' || (kind === 'piece' && obj.team === 0 && obj.start < 0); },

  applyStructureDamage(d) {
    const { obj, kind } = d;
    if (!obj.alive) return 0;
    const hp = this.structureHp(obj, kind);
    const dealt = Math.min(d.amount, hp);
    if (kind === 'piece') obj.damage += dealt;
    else obj.hp = hp - dealt;
    const src = d.source;
    if (d.harvest && src && this.harvestable(obj, kind)) {
      const mat = this.materialOf(obj, kind);
      const gained = Math.max(1, Math.round(dealt * YIELD_PER_DAMAGE * (0.8 + 0.4 * this.rng.next())));
      const before = src.mats[mat];
      src.mats[mat] = Math.min(MAT_CAP, before + gained);
      if (src.mats[mat] !== before) { src.invDirty = true; src.harvested = (src.harvested || 0) + (src.mats[mat] - before); }
    }
    if (hp - dealt <= 0.0001) this.destroyStructure(obj, kind, d);
    else this.touch(kind, obj);
    return dealt;
  },

  destroyStructure(obj, kind, d = {}) {
    if (!obj.alive) return;
    if (kind === 'prop') {
      propCenter(obj, c);
      this.world.removeProp(obj);
      this.touch('prop', obj);
      this.event(EV_BREAK, c.x, c.y, c.z, 0, PROP_KINDS[obj.kind].mat, 0);
      this.onStructureDestroyed?.(obj, kind, d);
      return;
    }
    this.world.removePiece(obj);
    this.touch('piece', obj);
    pieceCenter(obj, c);
    this.event(EV_BREAK, c.x, c.y, c.z, 0, obj.mat, 1);
    this.onStructureDestroyed?.(obj, kind, d);
    // Everything that was only standing because of this piece falls with it.
    const falling = this.world.unsupportedAfter([obj]);
    let shown = 0;
    for (const f of falling) {
      this.world.removePiece(f);
      this.touch('piece', f);
      if (shown++ < MAX_BREAK_EVENTS) { pieceCenter(f, c); this.event(EV_BREAK, c.x, c.y, c.z, 0, f.mat, 1); }
    }
    this.collapsed = (this.collapsed || 0) + falling.length;
  },
};

export { MAT_STATS };

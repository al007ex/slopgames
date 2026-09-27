// Build and edit modes on the client. Build mode shows a ghost of the piece
// where it would go (red when it can't), and each click places exactly one —
// shown and made solid straight away, then confirmed or taken back by the
// server. Edit mode lays a tile grid over one of your own pieces; click tiles
// to cut them out (or, on a ramp, pick the side it should climb to) and press
// edit again to confirm.

import * as THREE from 'three';
import { CELL, WALL_H } from '#shared/constants.js';
import {
  WALL, FLOOR, RAMP, CONE, CONE_H, DIRS, EDIT_GRID, editIsValid, rampDirFromSelection, slotKey, slotKindOf, pieceCenter,
} from '#shared/pieces.js';
import { buildTarget, placementProblem, pieceAt, BUILD_REACH } from '#shared/build.js';
import { aimFrame } from '#shared/aim.js';
import { A_BUILD, A_MAT, A_PLACE, A_EDIT, A_SLOT } from '#shared/protocol.js';

const PIECE_KEYS = { wall: WALL, floor: FLOOR, ramp: RAMP, cone: CONE };

export class BuildController {
  constructor(app) {
    this.app = app;
    this.mode = 'weapon';          // 'weapon' | 'build' | 'edit'
    this.piece = WALL;
    this.mat = 0;
    this.predicted = [];
    this.nextPredictedId = -1;
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.38, depthWrite: false });
    const badMat = new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.3, depthWrite: false });
    this.ghostMats = { good: ghostMat, bad: badMat };
    this.ghost = new THREE.Mesh(undefined, ghostMat);
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    app.gfx.scene.add(this.ghost);
    this.edges = new THREE.LineSegments(undefined, new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.8 }));
    this.edges.visible = false;
    app.gfx.scene.add(this.edges);
    this.edgeCache = new Map();
    this.tiles = new THREE.Group();
    this.tiles.visible = false;
    app.gfx.scene.add(this.tiles);
    this.edit = null;
    this.target = null;
  }

  /* ------------------------------------------------------------ keys */

  onPress(action) {
    if (PIECE_KEYS[action] !== undefined) {
      if (this.mode === 'edit') this.cancelEdit();
      this.enterBuild(PIECE_KEYS[action]);
      return true;
    }
    if (action === 'buildToggle') {
      if (this.mode === 'build') this.leaveBuild();
      else { if (this.mode === 'edit') this.cancelEdit(); this.enterBuild(this.piece); }
      return true;
    }
    if (action === 'edit') {
      if (this.mode === 'edit') this.confirmEdit();
      else this.startEdit();
      return true;
    }
    if (/^slot\d$/.test(action) && this.mode !== 'weapon') {
      if (this.mode === 'edit') this.cancelEdit();
      this.mode = 'weapon';
      this.app.queueAction({ type: A_SLOT, slot: Number(action.slice(4)) - 1 });
      this.app.onBuildMode?.();
      return false;          // the slot key still selects the slot
    }
    return false;
  }

  enterBuild(piece) {
    this.mode = 'build';
    this.piece = piece;
    this.app.queueAction({ type: A_BUILD, piece });
    this.app.onBuildMode?.();
  }

  leaveBuild() {
    this.mode = 'weapon';
    this.app.queueAction({ type: A_BUILD, piece: 255 });
    this.app.onBuildMode?.();
  }

  onClick(button) {
    if (this.mode === 'build') {
      if (button === 'left') this.place();
      else { this.mat = (this.mat + 1) % 3; this.app.queueAction({ type: A_MAT, mat: this.mat }); this.app.onBuildMode?.(); }
      return true;
    }
    if (this.mode === 'edit') {
      if (button === 'left') this.toggleHovered(true);
      else this.resetEdit();
      return true;
    }
    return false;
  }

  /* ----------------------------------------------------------- build */

  currentTarget() {
    const game = this.app.game;
    const me = game.me;
    return buildTarget(this.piece, me.move, this.app.yawQ(), this.app.pitchQ(), game.world, {});
  }

  problemFor(target) {
    const game = this.app.game;
    const players = [game.me.move];
    return placementProblem(game.world, target, { mats: this.app.mats, mat: this.mat, players, builder: game.me.move });
  }

  place() {
    const target = this.currentTarget();
    if (!target) return;
    const problem = this.problemFor(target);
    if (problem) { this.app.hudNote?.(problem); return; }
    const game = this.app.game;
    this.app.queueAction({ type: A_PLACE, piece: target.type, rot: target.rot, cx: target.cx, lv: target.lv, cz: target.cz });
    // Predict it: solid and drawn now, confirmed or removed by the server.
    const piece = { id: this.nextPredictedId--, ...pieceAt(target, this.mat, game.me.team, Math.round(game.serverTickNow(performance.now()))), predicted: true };
    game.world.addPiece(piece);
    this.app.pieceR.add(piece);
    this.predicted.push({ piece, key: slotKey(slotKindOf(piece.type, piece.rot), piece.cx, piece.lv, piece.cz), at: performance.now() });
    this.app.mats[this.mat] = Math.max(0, this.app.mats[this.mat] - 10);
    this.app.updateMats?.();
    this.app.audio.tone({ x: piece.cx * CELL, y: piece.lv * WALL_H, z: piece.cz * CELL }, { freq: 520, to: 780, gain: 0.12, dur: 0.08, type: 'square' });
  }

  dropPredicted(entry) {
    const game = this.app.game;
    if (entry.piece.alive) { game.world.removePiece(entry.piece); this.app.pieceR.remove(entry.piece); }
    this.predicted = this.predicted.filter((e) => e !== entry);
  }

  /** The server's version of a piece arrived: our prediction for that slot is done. */
  confirmSlot(p) {
    const key = slotKey(slotKindOf(p.type, p.rot), p.cx, p.lv, p.cz);
    for (const e of this.predicted) if (e.key === key) this.dropPredicted(e);
  }

  denied(msg) {
    const e = this.predicted.find((x) => x.piece.type === msg.piece && x.piece.cx === msg.cx && x.piece.lv === msg.lv && x.piece.cz === msg.cz);
    if (e) this.dropPredicted(e);
  }

  /* ------------------------------------------------------------ edit */

  /** The piece under the crosshair, if it is ours and in reach. */
  aimedPiece() {
    const game = this.app.game;
    const f = aimFrame(game.me.move, this.app.yawQ(), this.app.pitchQ(), false, {});
    const hit = {};
    const t = game.world.grid.raycast(f.ox, f.oy, f.oz, f.dir.x, f.dir.y, f.dir.z, BUILD_REACH, hit, (c) => c.ref < 0);
    if (t === Infinity || !hit.collider) return null;
    const p = game.world.ownerOf(hit.collider);
    if (!p || p.type === undefined || p.team === 0 || p.team !== game.me.team) return null;
    return p;
  }

  startEdit() {
    const p = this.aimedPiece();
    if (!p) { this.app.hudNote?.('aim at one of your builds to edit it'); return; }
    this.mode = 'edit';
    this.edit = { piece: p, mask: p.type === RAMP ? 0 : p.edit, painting: null };
    this.buildTiles();
    this.app.onBuildMode?.();
  }

  cancelEdit() {
    this.mode = 'weapon';
    this.edit = null;
    this.tiles.visible = false;
    this.app.onBuildMode?.();
  }

  resetEdit() { if (this.edit) { this.edit.mask = this.edit.piece.type === RAMP ? 0 : 0; this.paintTiles(); } }

  confirmEdit() {
    const e = this.edit;
    if (e && e.piece.alive) {
      const valid = e.piece.type === RAMP ? rampDirFromSelection(e.mask) >= 0 : editIsValid(e.piece.type, e.mask);
      if (valid) {
        this.app.queueAction({ type: A_EDIT, id: e.piece.id, value: e.mask });
        // Apply it locally right away; the server's copy follows.
        const game = this.app.game;
        if (e.piece.type === RAMP) game.world.reshapePiece(e.piece, { rot: rampDirFromSelection(e.mask) });
        else game.world.reshapePiece(e.piece, { edit: e.mask });
        this.app.pieceR.update(e.piece);
        this.app.audio.tone(null, { freq: 640, to: 900, gain: 0.1, dur: 0.1, type: 'triangle' });
      }
    }
    this.cancelEdit();
  }

  /** Tile quads over the piece being edited, in world space. */
  buildTiles() {
    this.tiles.clear();
    const p = this.edit.piece;
    const { cols, rows } = EDIT_GRID[p.type];
    const x0 = p.cx * CELL, z0 = p.cz * CELL, y0 = p.lv * WALL_H;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false }));
        mesh.renderOrder = 6;
        const tw = CELL / cols;
        if (p.type === WALL) {
          const th = WALL_H / rows;
          mesh.scale.set(tw * 0.94, th * 0.94, 1);
          if (p.rot === 0) { mesh.position.set(x0, y0 + (r + 0.5) * th, z0 + (c + 0.5) * tw); mesh.rotation.y = Math.PI / 2; }
          else mesh.position.set(x0 + (c + 0.5) * tw, y0 + (r + 0.5) * th, z0);
        } else {
          const y = p.type === FLOOR ? y0 + 0.13 : p.type === CONE ? y0 + CONE_H * 0.55 : y0 + 0.13 + WALL_H * 0.5;
          mesh.scale.set(tw * 0.94, tw * 0.94, 1);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(x0 + (c + 0.5) * tw, y, z0 + (r + 0.5) * tw);
          if (p.type === RAMP) {
            const [dx, dz] = DIRS[p.rot];
            const along = dx ? (dx > 0 ? c + 0.5 : 1.5 - c) / 2 : (dz > 0 ? r + 0.5 : 1.5 - r) / 2;
            mesh.position.y = y0 + 0.13 + along * WALL_H;
          }
        }
        mesh.userData = { index: r * cols + c };
        this.tiles.add(mesh);
      }
    }
    this.tiles.visible = true;
    this.paintTiles();
  }

  paintTiles() {
    const e = this.edit;
    if (!e) return;
    for (const m of this.tiles.children) {
      const on = (e.mask >> m.userData.index) & 1;
      const hover = m.userData.index === e.hover;
      m.material.color.set(e.piece.type === RAMP ? (on ? 0xffd24a : 0x5fc8ff) : on ? 0xff5a5a : 0x5fc8ff);
      m.material.opacity = (on ? 0.55 : 0.28) + (hover ? 0.2 : 0);
    }
  }

  /** Which tile the crosshair is over (by intersecting the view ray with the tiles). */
  hoveredTile() {
    const cam = this.app.gfx.camera;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    const hits = ray.intersectObjects(this.tiles.children, false);
    return hits.length ? hits[0].object.userData.index : -1;
  }

  toggleHovered(start) {
    const e = this.edit;
    const i = this.hoveredTile();
    if (i < 0) return;
    if (start) e.painting = ((e.mask >> i) & 1) ? 0 : 1;
    if (e.painting === 1) e.mask |= 1 << i; else e.mask &= ~(1 << i);
    this.paintTiles();
    this.app.audio.tone(null, { freq: 900, gain: 0.06, dur: 0.04, type: 'square' });
  }

  /* ----------------------------------------------------------- frame */

  frame(mouseHeld) {
    const now = performance.now();
    for (const e of [...this.predicted]) if (now - e.at > 900) this.dropPredicted(e);   // never confirmed
    if (this.mode === 'build') {
      const target = this.currentTarget();
      const problem = target ? this.problemFor(target) : 'nowhere';
      const occupied = problem === 'occupied';
      const { geo } = this.app.pieceR.geometryFor({ type: target.type, rot: target.rot, edit: 0 });
      this.ghost.geometry = geo;
      this.ghost.material = problem ? this.ghostMats.bad : this.ghostMats.good;
      this.ghost.position.set(target.cx * CELL, target.lv * WALL_H, target.cz * CELL);
      this.ghost.visible = !occupied;
      let edges = this.edgeCache.get(geo.uuid);
      if (!edges) { edges = new THREE.EdgesGeometry(geo, 30); this.edgeCache.set(geo.uuid, edges); }
      this.edges.geometry = edges;
      this.edges.position.copy(this.ghost.position);
      this.edges.visible = !occupied;
      this.target = target;
    } else {
      this.ghost.visible = false;
      this.edges.visible = false;
    }
    if (this.mode === 'edit') {
      const e = this.edit;
      if (!e.piece.alive) { this.cancelEdit(); return; }
      const c = pieceCenter(e.piece, {});
      const m = this.app.game.me.move;
      if ((c.x - m.x) ** 2 + (c.z - m.z) ** 2 > (BUILD_REACH + 3) ** 2) { this.cancelEdit(); return; }
      const hover = this.hoveredTile();
      if (hover !== e.hover) { e.hover = hover; this.paintTiles(); }
      if (mouseHeld && e.painting !== null) this.toggleHovered(false);
      if (!mouseHeld) e.painting = null;
    }
  }
}

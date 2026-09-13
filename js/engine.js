/* Melon Mayhem — garden-artillery vs. zombie-horde defense game.
 *
 * Copyright (C) 2026 Nixon Cheaz
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/* ============================================================
   MELON MAYHEM — engine.js
   Core helpers: math, input, camera shake, time, projection.
   ============================================================ */
'use strict';
window.G = window.G || {};

const M = {
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  // frame-rate independent smoothing
  damp: (a, b, k, dt) => M.lerp(a, b, 1 - Math.exp(-k * dt)),
};
G.M = M;

/* ---------------- Input ---------------- */
class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mx = 640; this.my = 360;
    this.lmb = false; this.rmb = false;
    this.lmbPressed = false; this.lmbReleased = false;
    this.rmbPressed = false;
    this.keys = {};
    this.keyPressed = {};
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mx = (e.clientX - r.left) * (canvas.width / r.width);
      this.my = (e.clientY - r.top) * (canvas.height / r.height);
      // RAW canvas coords, never remapped — 3D mode re-encodes `mx` below, so
      // any screen-space UI (buttons, hover) must read these instead.
      this.rawMx = this.mx; this.rawMy = this.my;
      // 3D mode: the aim reads board-u through the real camera — unproject
      // the pointer ray onto the ground plane, then re-encode as the screen x
      // the pult's lane would show it at (row-independent with a yaw-free cam)
      if (G.IS3D && G.R3 && G.R3.ready) {
        const u = G.R3.pointerToU(this.mx, this.my);
        if (u != null && G.game) this.mx = G.Board.colX(G.game.pult.row, u);
      }
    });
    canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      G.Audio.unlock();
      const r = canvas.getBoundingClientRect();
      this.rawMx = (e.clientX - r.left) * (canvas.width / r.width);
      this.rawMy = (e.clientY - r.top) * (canvas.height / r.height);
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) { if (this.lmb) this.lmbReleased = true; this.lmb = false; }
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      G.Audio.unlock();
      const k = e.key.toLowerCase();
      if (!this.keys[k]) this.keyPressed[k] = true;
      this.keys[k] = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.lmb = false; this.rmb = false; });
  }
  postUpdate() {
    this.lmbPressed = false; this.lmbReleased = false; this.rmbPressed = false;
    this.keyPressed = {};
  }
}
G.Input = Input;

/* ---------------- Camera (screenshake) ---------------- */
class Camera {
  constructor() { this.shake = 0; this.x = 0; this.y = 0; this.flash = 0; this.flashColor = '#fff'; }
  kick(amount) { this.shake = Math.min(22, this.shake + amount); }
  hitFlash(a, color) { this.flash = a; this.flashColor = color; }
  update(dt) {
    this.shake = M.damp(this.shake, 0, 8, dt);
    const s = this.shake;
    this.x = M.rand(-s, s); this.y = M.rand(-s, s);
    this.flash = Math.max(0, this.flash - dt * 3.5);
  }
  apply(ctx) { ctx.translate(Math.round(this.x), Math.round(this.y)); }
}
G.Camera = Camera;

/* ---------------- Board projection (near-side view) ----------------
   4 rows x 10 cols (grid unchanged). The FIELD is zoomed in: lane gaps
   84→120 px and colW 88→100 px, so the lawn fills the frame — slim dusk-sky
   strip on top (horizon ≈ y150), field from y≈204 down to y≈648, slim
   foreground below. Margins stay readable, never black voids.              */
const Board = {
  ROWS: 4, COLS: 10,
  centerX: 668,
  // 4x10 board viewed nearly side-on: lane gaps are uniform (120 px) and
  // scale is uniform across rows, so lane lines are PARALLEL and column
  // divisions NON-CONVERGING — the lawn reads as four stacked side-view
  // corridors (PvZ-style), never a floor plane seen from above.
  laneY: [246, 366, 486, 606],
  rowScale: [1.0, 1.0, 1.0, 1.0],
  colW: 100,
  pultU: 0.0,                   // pult sits ON the leftmost square of its lane
  pxPerHeight: 38,              // pixels per height-unit at scale 1
  gravity: 19,                  // world units / s^2
  // Visual reference ceiling in height units (blob-shrink math, aim rail).
  // REAL trajectories are no longer clamped — see shotCalc.
  maxApexH: 14,

  scale(r) { return this.rowScale[r]; },
  // world u (col units, can be fractional) -> screen x for row r.
  // With uniform rowScale this is row-independent: vertical column lines.
  colX(r, u) { return this.centerX + (u - 4.5) * this.colW * this.scale(r); },
  // screen x -> world u for row r
  toU(r, sx) { return (sx - this.centerX) / (this.colW * this.scale(r)) + 4.5; },
  // height h (world units) -> pixel offset above lane line for row r
  heightPx(r, h) { return h * this.pxPerHeight * this.scale(r); },
};
G.Board = Board;

/* ---------------- Ballistic shot calculator ----------------
   Two decoupled skill inputs, realistic projectile motion:
     · AIM  — mouse X across the board maps to launch angle 10°..80°.
     · POWER — held input ramps launch speed vMin→vMax (see G.POWER).
   Flight is a true parabola under Board.gravity from launch height 2.0:
     apex above ground  H = 2 + (v·sinθ)² / 2g
     time to apex       tApex = v·sinθ / g
   No clamp: angle + power alone decide the arc.                       */
G.ANGLE_MIN = 10;
G.ANGLE_MAX = 80;
G.POWER = {
  vMin: 5,       // launch speed at charge 0 (wu/s)
  vMax: 16,      // launch speed at charge 1 (wu/s)
  rampT: 1.1,    // seconds 0→1
  dwellT: 0.5,   // seconds held at max before resetting to 0
};
/* ---------------- Catapult arm angles ----------------
   One convention, shared by all three places that need to agree: the 2D
   sprite painter, the 3D rig, and the point the melon actually leaves from.

     a = 0        arm horizontal, pointing at the field
     a > 0        tip raised FORWARD and UP
     a < 0        tip swung BACK and DOWN

   Canvas rotate() is inverted relative to this (canvas +y points down), so
   the 2D painter is handed -a. Getting this wrong is what made the arm swing
   backwards on one render path and the melon leave from the wrong point.

   Cycle: idle/charging winds REST → COCK (smooth, charge-driven), the release
   whips COCK → LAUNCH in `stroke` seconds, then eases LAUNCH → REST. */
G.PULT_ARM = {
  rest: 0.95,     // ready pose: scoop up-forward, melon loaded high
  cock: -2.50,    // wound back and LOW
  launch: 1.30,   // forward and HIGH — the melon leaves the scoop here
  stroke: 0.07,   // s, power stroke (fast enough to read as a whip)
  settle: 0.50,   // s, return to the ready pose
};

G.shotCalc = function (thetaDeg, speed) {
  const B = G.Board;
  const th = M.clamp(thetaDeg, G.ANGLE_MIN, G.ANGLE_MAX) * Math.PI / 180;
  const vu = speed * Math.cos(th);
  const vh = speed * Math.sin(th);
  const tApex = vh / B.gravity;
  const H = 2 + vh * vh / (2 * B.gravity); // apex above GROUND (launch h=2)
  return { vu, vh, H, tApex, deg: M.clamp(thetaDeg, G.ANGLE_MIN, G.ANGLE_MAX) };
};
// Time until a projectile launched at height h0 with vertical speed vh
// returns to the ground (h=0). Single source of truth for landing rings,
// the aim preview and the heavy-shot range solver.
G.landTime = function (vh, g, h0) {
  return (vh + Math.sqrt(vh * vh + 2 * g * h0)) / g;
};

/* ---------------- Misc canvas helpers ---------------- */
function outlinedText(ctx, txt, x, y, size, fill, align = 'center', outline = '#1a1208', ow = null) {
  ctx.font = `900 ${size}px 'Trebuchet MS', sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = ow || Math.max(3, size * 0.18);
  ctx.strokeText(txt, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(txt, x, y);
}
G.outlinedText = outlinedText;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
G.roundRectPath = roundRectPath;

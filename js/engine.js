/* ============================================================
   MELON MAYHEM — engine.js
   Core helpers: math, input, camera shake, time, projection.
   ============================================================ */
'use strict';
window.G = {};

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
    });
    canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      G.Audio.unlock();
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

/* ---------------- Board projection (3/4 perspective) ----------------
   6 rows x 10 cols. Row 0 = far (small), row 5 = near (large).      */
const Board = {
  ROWS: 6, COLS: 10,
  centerX: 640,
  // 6x10 board, 3/4 perspective: lane gaps compress toward the horizon.
  // Narrow width fan so the silhouette reads as parallel corridors, not stairs.
  laneY: [159, 234, 314, 398, 486, 578],
  rowScale: [0.80, 0.85, 0.90, 0.95, 1.00, 1.06],
  colW: 88,
  pultU: 0.0,                   // pult sits ON the leftmost square of its lane
  pxPerHeight: 38,              // pixels per height-unit at scale 1
  gravity: 19,                  // world units / s^2

  scale(r) { return this.rowScale[r]; },
  // world u (col units, can be fractional) -> screen x for row r
  colX(r, u) { return this.centerX + (u - 4.5) * this.colW * this.scale(r); },
  // screen x -> world u for row r
  toU(r, sx) { return (sx - this.centerX) / (this.colW * this.scale(r)) + 4.5; },
  // height h (world units) -> pixel offset above lane line for row r
  heightPx(r, h) { return h * this.pxPerHeight * this.scale(r); },
};
G.Board = Board;

/* ---------------- Ballistic shot calculator ----------------
   Launch angle is the skill lever: force maps to 30°..75° elevation.
   Apex height derives from angle + distance: H = ½·d·tanθ.            */
G.shotCalc = function (d, force, heavy) {
  const B = G.Board;
  d = Math.max(0.8, d);
  const deg = heavy ? 48 : 30 + force * 45; // launch angle, clamped at 75°
  const theta = deg * Math.PI / 180;
  const H = Math.min(6.5, Math.max(0.8, 0.5 * d * Math.tan(theta)));
  const tApex = Math.sqrt(2 * H / B.gravity);
  return { H, tApex, vu: d / tApex, vh: Math.sqrt(2 * B.gravity * H), deg };
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

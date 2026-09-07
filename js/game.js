/* ============================================================
   MELON MAYHEM — game.js
   Game state, physics, zombies, armor economy, glory kills,
   waves/stages/obstacles, FX, HUD, win/lose.
   ============================================================ */
'use strict';
(function () {
  const { clamp, lerp, rand, randi, pick, damp } = M;

  // Fixed vertical rail for the pult at the left edge of the field.
  // Hopping lanes (W/S) changes ONLY y/scale — the drawn x must never move.
  // 222 ≈ colX(3,0) = 220.2 (near-row leftmost square center), tucked in the
  // gap between the house's right edge (x=172) and the leftmost column
  // (colX(r,0) ranges 323..220 across rows 0..3, so 222 hugs the field edge).
  const PULT_RAIL_X = 222;

  // Pult-only depth cue: mild extra scale response by lane, stacked on top of
  // Board.scale() for the pult sprite, its shadow and rail dust FX ONLY.
  // 0.92 (far row 0) → 1.08 (near row 3). Board.rowScale/laneY untouched.
  function pultLaneScale(r) {
    return 0.92 + 0.16 * clamp(r / (G.Board.ROWS - 1), 0, 1);
  }

  // Weight-of-hop squash channel driven purely by jumpT (0→1 over ~0.26s).
  // + = squash (wide/short), − = stretch (tall/thin). Amplitudes are tuned to
  // PERCEPTUAL thresholds at ±12–14%/1.0 scale: 1.0 → ±12–14% body deformation.
  //   takeoff compress       t 0.00→0.20  peak +1.00 at t=0.10
  //   airborne stretch       t 0.20→0.75  peak −0.75 at t≈0.475
  //   landing anticipation   t 0.75→1.00  peak +1.10 at t≈0.875
  function hopSquash(t) {
    const takeoff = Math.sin(clamp(t / 0.20, 0, 1) * Math.PI) * 1.0;
    const air = -Math.sin(clamp((t - 0.20) / 0.55, 0, 1) * Math.PI) * 0.75;
    const land = Math.sin(clamp((t - 0.75) / 0.25, 0, 1) * Math.PI) * 1.1;
    return takeoff + air + land;
  }

  /* ================= Particles ================= */
  class Particle {
    constructor(o) { Object.assign(this, { vx: 0, vy: 0, g: 0, drag: 0, life: 0.6, t: 0, size: 3, color: '#fff', type: 'dot', rot: 0, vr: 0 }, o); }
    update(dt) {
      this.t += dt;
      this.vy += this.g * dt;
      if (this.drag) { this.vx *= 1 - this.drag * dt; this.vy *= 1 - this.drag * dt; }
      this.x += this.vx * dt; this.y += this.vy * dt; this.rot += this.vr * dt;
      return this.t < this.life;
    }
    draw(ctx) {
      const k = 1 - this.t / this.life;
      ctx.save();
      ctx.globalAlpha = k;
      if (this.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = this.color; ctx.lineWidth = this.size * k;
        ctx.beginPath(); ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx * 0.03, this.y - this.vy * 0.03); ctx.stroke();
      } else if (this.type === 'dust') {
        ctx.globalAlpha = k * 0.5;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size * (1 + this.t * 3), 0, Math.PI * 2); ctx.fill();
      } else if (this.type === 'chunk') {
        ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size, -this.size * 0.7, this.size * 2, this.size * 1.4);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(-this.size, -this.size * 0.7, this.size * 2, this.size * 1.4);
      } else if (this.type === 'star') {
        G.Sprites.drawStar(ctx, this.x, this.y, this.size * (0.5 + k * 0.5), this.color);
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size * (0.4 + k * 0.6), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* ================= Floating popup text ================= */
  class Popup {
    constructor(txt, x, y, color, size = 22) {
      Object.assign(this, { txt, x, y, color, size, t: 0, life: 0.95, vy: -55 });
    }
    update(dt) { this.t += dt; this.y += this.vy * dt; this.vy *= 1 - 2.2 * dt; return this.t < this.life; }
    draw(ctx) {
      const k = this.t / this.life;
      const pop = this.t < 0.12 ? 0.5 + (this.t / 0.12) * 0.7 : 1.2 - Math.min(0.2, (this.t - 0.12) * 0.5);
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(this.x, this.y);
      ctx.scale(pop, pop);
      G.outlinedText(ctx, this.txt, 0, 0, this.size, this.color, 'center', '#1a1208');
      ctx.restore();
    }
  }

  /* ================= Projectile ================= */
  class Projectile {
    constructor(row, u0, opts) {
      // opts: { apexU, force, heavy }
      const B = G.Board;
      this.row = row;
      this.u = u0; this.h = 2.0;
      const sc = G.shotCalc(opts.apexU - u0, opts.force, opts.heavy);
      this.vu = sc.vu;
      this.vh = sc.vh;
      this.launchDeg = sc.deg;
      this.plunge = !opts.heavy && opts.force > 0.607; // ≥ ~57° plunges
      this.heavy = !!opts.heavy;
      this.hitsDone = 0;
      this.spin = 0;
      this.dead = false;
      this.trail = [];
      this.launchT = 0;
      // Visual launch continuity: the pult rides a fixed rail x that sits LEFT
      // of colX(row,0) on far lanes. The melon spawns at the drawn ARM TIP
      // (scoop melon position) and rides a short quadratic bezier — control
      // point = armTip + throwDir·30px, where throwDir continues the arm's
      // up-right release direction (launchDeg) — that marries the projected
      // path in ~0.14s. World (row,u) physics are untouched.
      this.launchSx = (opts.launchSx != null) ? opts.launchSx : null;
      this.launchSy = (opts.launchSy != null) ? opts.launchSy : null;
      this.launchDur = 0.14;
      if (this.launchSx != null) {
        const rad = -this.launchDeg * Math.PI / 180; // up-right on screen
        const tipS = B.scale(this.row);
        this.launchCx = this.launchSx + Math.cos(rad) * 30 * tipS;
        this.launchCy = this.launchSy + Math.sin(rad) * 30 * tipS;
      }
    }
    projK() {
      return 1 - Math.pow(1 - clamp(this.launchT / this.launchDur, 0, 1), 3); // ease-out cubic
    }
    // Quadratic bezier through (armTip → armTip+throwDir·30 → path point),
    // parameterised by the eased k. k=1 lands EXACTLY on the projected path.
    projSx() {
      const sx = G.Board.colX(this.row, this.u);
      if (this.launchSx == null) return sx;
      const k = this.projK(), i = 1 - k;
      return i * i * this.launchSx + 2 * i * k * this.launchCx + k * k * sx;
    }
    projSy() {
      const sy = G.Board.laneY[this.row] - G.Board.heightPx(this.row, this.h);
      if (this.launchSy == null) return sy;
      const k = this.projK(), i = 1 - k;
      return i * i * this.launchSy + 2 * i * k * this.launchCy + k * k * sy;
    }
    update(dt, game) {
      this.launchT += dt;
      this.vh -= G.Board.gravity * dt;
      this.u += this.vu * dt;
      this.h += this.vh * dt;
      this.spin += this.vu * dt * 2.4;
      const sx = this.projSx();
      const sy = this.projSy();
      // TRAIL FROM FRAME ONE — no launchDur gate: the streak traces the launch
      // bezier too, so it visibly bridges arm → flight path with no gap.
      // During the 0.14s ease the eased point sprints (ease-out cubic covers
      // ~⅓ of the bezier within the first frames), so early pushes are
      // length-capped: a point is kept only while it stays within EARLY_R of
      // the spawn tip — the first visible trail is a short, dense stub
      // hugging the arm; the aging 12-point buffer does the rest.
      const EARLY_R = 20;
      if (this.launchT < this.launchDur && this.launchSx != null) {
        const dx = sx - this.launchSx, dy = sy - this.launchSy;
        if (dx * dx + dy * dy <= EARLY_R * EARLY_R) this.trail.push({ x: sx, y: sy, t: 0 });
      } else {
        this.trail.push({ x: sx, y: sy, t: 0 });
      }
      if (this.trail.length > 12) this.trail.shift();
      this.trail.forEach(p => p.t += dt);

      if (this.vh < 0) { // descending — check impacts
        // tombstones block low arcs
        for (const ob of game.obstacles) {
          if (ob.row === this.row && Math.abs(ob.u - this.u) < 0.45 && this.h < 1.75) {
            game.hitObstacle(this, ob); return;
          }
        }
        for (const z of game.zombies) {
          if (z.row !== this.row || z.dead) continue;
          if (z.state === 'die' || z.state === 'glorydie') continue; // corpses don't collide
          const zone = this.hitsDone === 0 ? 2.3 : 1.1; // splash hits low
          const radius = this.hitsDone === 0 ? 0.58 : 0.72;
          if (this.h < zone && Math.abs(z.u - this.u) < radius) {
            game.resolveImpact(this, z);
            if (this.hitsDone >= 2 || (!this.plunge && !this.heavy && this.hitsDone >= 1)) {
              // regular shot: done after first direct contact (splash handled on ground)
              if (!this.heavy) { game.groundSplash(this); this.dead = true; }
            }
            return;
          }
        }
      }
      if (this.h <= 0.05 && this.vh < 0) {
        game.groundImpact(this);
        this.dead = true;
      }
      if (this.u > 12 || this.u < -3) {
        // sailed off the field — still owes the player a MISS read
        if (this.hitsDone === 0 && !this.heavy && this.vh < 0) {
          const B2 = G.Board;
          const ex = B2.colX(this.row, clamp(this.u, -1, 11.6));
          G.Audio.missPoof();
          game.addPopup(ex, B2.laneY[this.row] - 46, 'MISS', '#f0f0f0', 26);
          game.combo = 0;
        }
        this.dead = true;
      }
    }
    draw(ctx) {
      const B = G.Board;
      const s = B.scale(this.row);
      const sx = this.projSx();
      const groundY = B.laneY[this.row];
      const sy = Math.max(12, this.projSy());
      // melon grows 0.9× → 1× while marrying the path (starts at the arm,
      // closer to camera feel)
      const m = lerp(0.9, 1, this.projK());
      // shadow
      const sk = clamp(1 - this.h / 8, 0.15, 1);
      ctx.save();
      ctx.globalAlpha = 0.3 * sk;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, groundY + 4 * s, 16 * s * sk, 5.5 * s * sk, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // trail
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.trail.forEach((p, i) => {
        ctx.globalAlpha = (i / this.trail.length) * 0.5;
        ctx.fillStyle = this.heavy ? '#ff9c40' : '#eaffb0';
        ctx.beginPath(); ctx.arc(p.x, p.y, 7 * s * (i / this.trail.length), 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(s * m, s * m);
      G.Sprites.drawMelon(ctx, this.heavy ? 17 : 15, this.plunge ? 0.5 + 0.3 * Math.sin(this.launchT * 20) : 0, this.heavy, this.spin);
      ctx.restore();
    }
  }

  /* ================= Zombie ================= */
  let ZID = 0;
  class Zombie {
    constructor(row, type, stage) {
      this.id = ++ZID;
      this.row = row;
      this.u = 9.4 + rand(0, 0.3);
      this.type = type; // shambler | bucket | shieldy | runner | brute
      this.seed = Math.random() * 10;
      this.maxHp = type === 'brute' ? 9 : (type === 'runner' ? 4 : 5);
      this.hp = this.maxHp;
      this.shield = type === 'shieldy';
      this.shieldHits = 5;
      this.helmet = type === 'bucket';
      this.dents = 0;
      this.bodyJostle = 0;
      this.state = 'spawn'; // spawn | hold | walk | kneel | die | glorydie
      this.t = 0;                 // state timer
      this.holdDur = type === 'runner' ? 1.6 : 3.2;
      this.walkPhase = rand(0, 6);
      this.hitFlash = 0;
      this.dieT = 0;
      this.kneelTimer = 0;
      this.spawnT = 0;
      this.dead = false;
      this.lean = 0;
      this.helmetWobble = 0;
      this.shieldWobble = 0;
      this.gloryReady = false;
    }
    get speed() { return this.type === 'runner' ? 0.68 : 0.45; } // seconds per column
    update(dt, game) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
      this.helmetWobble *= 1 - 6 * dt;
      this.shieldWobble *= 1 - 6 * dt;
      switch (this.state) {
        case 'spawn':
          this.spawnT += dt;
          if (this.spawnT >= 0.55) { this.state = 'hold'; this.t = 0; }
          break;
        case 'hold':
          this.t += dt;
          if (this.t >= this.holdDur) { this.state = 'walk'; this.t = 0; }
          break;
        case 'walk': {
          this.t += dt;
          this.walkPhase += dt * 9;
          this.u -= dt / this.speed;
          // arrive at next integer square
          if (this.t >= this.speed) {
            this.u = Math.round(this.u);
            this.state = 'hold'; this.t = 0;
          }
          if (this.u <= -0.35) { game.brainEaten(this); }
          else if (this.row === game.pult.row && this.u <= G.Board.pultU + 1.25) { game.pultDestroyed(this); }
          break;
        }
        case 'kneel':
          this.kneelTimer -= dt;
          if (this.kneelTimer <= 0) { this.state = 'hold'; this.t = 0; this.gloryReady = false; }
          break;
        case 'die':
        case 'glorydie':
          this.dieT += dt;
          if (this.dieT > 1.6) this.dead = true;
          break;
      }
    }
    pose() {
      return this.state === 'kneel' ? 'kneel' :
             this.state === 'die' ? 'die' :
             this.state === 'glorydie' ? 'glorydie' :
             this.state === 'walk' ? 'walk' : 'hold';
    }
    draw(ctx, time) {
      const B = G.Board;
      const s = B.scale(this.row);
      let sx = B.colX(this.row, this.u);
      let sy = B.laneY[this.row];
      ctx.save();
      if (this.state === 'spawn') {
        const k = clamp(this.spawnT / 0.55, 0, 1);
        ctx.globalAlpha = k;
        sy += (1 - k) * 60 * s;
      }
      // shadow
      ctx.globalAlpha *= 1;
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 3 * s, 26 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.translate(sx, sy);
      ctx.scale(s * (this.type === 'brute' ? 1.28 : 1), s * (this.type === 'brute' ? 1.28 : 1));
      if (this.type === 'runner') { ctx.scale(0.94, 0.94); }
      G.Sprites.drawZombie(ctx, {
        pose: this.pose(),
        walkPhase: this.walkPhase,
        seed: this.seed,
        hitFlash: this.hitFlash,
        shield: this.shield,
        shieldHits: this.shieldHits,
        shieldWobble: this.shieldWobble,
        helmet: this.helmet,
        dents: this.dents,
        helmetWobble: this.helmetWobble,
        dieT: this.dieT,
        kneelTimer: Math.max(0, this.kneelTimer),
        type: this.type,
        lean: this.lean || 0,
      }, time);

      // health bar (only when damaged)
      if (this.hp < this.maxHp && this.state !== 'die' && this.state !== 'glorydie') {
        const bw = 40, bh = 6, by = this.state === 'kneel' ? -78 : -104;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-bw / 2 - 1, by - 1, bw + 2, bh + 2);
        const frac = clamp(this.hp / this.maxHp, 0, 1);
        ctx.fillStyle = frac > 0.5 ? '#6fe86f' : frac > 0.25 ? '#ffd23f' : '#ff5555';
        ctx.fillRect(-bw / 2, by, bw * frac, bh);
      }
      // glory-ready indicator
      if (this.state === 'kneel') {
        const pulse = 0.75 + Math.sin(time * 9) * 0.25;
        ctx.save();
        ctx.globalAlpha = pulse;
        G.Sprites.drawStar(ctx, 0, -118, 9, '#b9ff2e');
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#b9ff2e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -104, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.kneelTimer / 3, 0, 1));
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }
  /* ================= Pult ================= */
  class Pult {
    constructor() {
      this.row = 2; // lower-middle of 4 lanes
      this.jumpT = 1; this.jumpFrom = 2; this.jumpTo = 2;
      this.charge = 0; this.charging = false;
      this.chargeUp = true;
      this.recoil = 0;
      this.armSwing = 0;
      this.lastQ = -1;
      this.chargePhase = 0;  // 0→1 per half-cycle of the charge oscillation
      this.chargeTopGlow = 0; // brief fade cue when the bar turns around at max
      this.blinkT = rand(2, 4);
      this.blink = 0;
      this.hopY = 0;
      this.shadowK = 0;    // damped follower of the hop arc — shadow lag
      this.landSquash = 0; // post-touchdown impact squash (decays ~0.17s)
      this.holding = true;
      this.dead = false;
      this.deathT = 0;
    }
    get jumpK() { return this.jumpT < 1 ? this.jumpT : 1; }
    update(dt, game) {
      this.screenX = PULT_RAIL_X; // drawn x — exposed for probes, constant on the rail
      if (this.dead) { this.deathT += dt; return; }
      // lane jump
      if (this.jumpT < 1) {
        this.jumpT += dt / 0.26;
        this.hopY = Math.sin(clamp(this.jumpT, 0, 1) * Math.PI) * 46;
        // shadow follows the arc through an exp damper (k=10/s) → its shrink
        // bottoms out just after the true apex and recovers after touchdown
        this.shadowK = damp(this.shadowK, this.hopY / 46, 10, dt);
        if (this.jumpT >= 1) {
          this.row = this.jumpTo;
          this.hopY = 0;
          this.landSquash = 1; // impact squash on touchdown (+0.9, ~0.15s decay)
          const B = G.Board;
          game.dustBurst(PULT_RAIL_X, B.laneY[this.row], B.scale(this.row) * pultLaneScale(this.row), 11, 2.2);
          G.Audio.jumpWhoosh();
        }
      } else {
        this.shadowK = damp(this.shadowK, 0, 10, dt);
        if (game.state === 'play') {
          if (game.input.keyPressed['w'] && this.row > 0) this.startJump(this.row - 1, game);
          if (game.input.keyPressed['s'] && this.row < G.Board.ROWS - 1) this.startJump(this.row + 1, game);
        }
      }
      // blink
      this.blinkT -= dt;
      this.chargeTopGlow = Math.max(0, this.chargeTopGlow - dt / 0.3); // turnaround-cue fade
      if (this.blinkT <= 0) { this.blink = 0.12; this.blinkT = rand(2.2, 4.5); }
      this.blink = Math.max(0, this.blink - dt);
      // recoil / arm
      this.recoil = Math.max(0, this.recoil - dt * 4);
      this.armSwing = Math.max(0, this.armSwing - dt * 7);
      this.landSquash = Math.max(0, this.landSquash - dt * 6.7); // ~0.15s decay
      // charge — one smooth cosine oscillation while held: up…down…up, forever.
      // Each half-cycle is a cosine ease, so charge sweeps out of 0, eases into
      // 1.0, touches it for an instant only, and immediately descends — zero
      // dwell at max, no stall, no wrap. Pace unchanged: 0.85s up, 0.85s down.
      if (this.charging) {
        this.chargePhase += dt / 0.85;
        if (this.chargePhase >= 1) {
          this.chargePhase -= 1;
          if (this.chargeUp) { this.chargeUp = false; this.chargeTopGlow = 1; G.Audio.chargeTop(); } // peaked — turn around
          else this.chargeUp = true; // bottomed out — rise again
        }
        const ph = Math.min(this.chargePhase, 1);
        const c = (1 - Math.cos(ph * Math.PI)) / 2;
        this.charge = this.chargeUp ? c : 1 - c;
        // charge ticks
        const q = Math.floor(this.charge * 10);
        if (q !== this.lastQ) { this.lastQ = q; G.Audio.chargeTick(this.charge); }
      }
    }
    startJump(to, game) {
      if (to < 0 || to > G.Board.ROWS - 1 || to === this.row) return;
      this.jumpFrom = this.row;
      this.jumpTo = to;
      this.jumpT = 0;
      this.charging = false; this.charge = 0;
      this.chargePhase = 0; this.chargeUp = true; this.chargeTopGlow = 0;
      // takeoff: dust poof + loose soil/leaf chunks kicked off the pot
      const B = G.Board;
      const s = B.scale(this.row) * pultLaneScale(this.row);
      game.dustBurst(PULT_RAIL_X, B.laneY[this.row], s, 9, 1.6);
      for (let i = 0; i < 4; i++) {
        game.particles.push(new Particle({
          x: PULT_RAIL_X + rand(-34, 34) * s, y: B.laneY[this.row] - rand(2, 10) * s,
          vx: rand(-140, 140), vy: rand(-230, -110), g: 640, vr: rand(-9, 9),
          life: rand(0.35, 0.55), size: rand(1.8, 3.2) * s, type: 'chunk',
          color: i >= 2 ? pick(['#3f9c46', '#48b04f']) : pick(['#6e4a26', '#7c5026']),
        }));
      }
      G.Audio.jumpWhoosh();
    }
    draw(ctx, time, game) {
      const B = G.Board;
      // Fixed vertical rail: sx never changes, hops are pure vertical travel.
      const sx = PULT_RAIL_X;
      const k = clamp(this.jumpT, 0, 1);
      // Mid-hop, ease the lane line and perspective scale from→to lane.
      // pultLaneScale adds a pult-only near-lane boost on top of the board
      // projection — deepens near lanes without touching the board math.
      const s = lerp(B.rowScale[this.jumpFrom] * pultLaneScale(this.jumpFrom),
                     B.rowScale[this.jumpTo] * pultLaneScale(this.jumpTo), k);
      const groundY = lerp(B.laneY[this.jumpFrom], B.laneY[this.jumpTo], k);
      const sy = groundY - this.hopY;
      // shadow: stays VISIBLE at apex — 48% of parked size, ~0.144 alpha
      // (was 42% / 0.105 = invisible). LAGS the arc via the damped shadowK
      // follower (k=10/s ≈ 0.1s). A faint detached ground-marker ellipse keeps
      // the ground plane readable while the pult separates from the ground.
      const shK = this.shadowK;
      const shSize = 1 - 0.52 * shK;
      ctx.save();
      ctx.globalAlpha = 0.30 * (1 - 0.52 * shK);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, groundY + 3 * s, 34 * s * shSize, 8 * s * shSize, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (shK > 0.02) {
        const markerFade = clamp(shK / 0.35, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.10 * markerFade;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.ellipse(sx, groundY + 3 * s, 40 * s, 9.5 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(s, s);
      if (this.dead) {
        ctx.rotate(Math.min(1.4, this.deathT * 3));
        ctx.globalAlpha = 1;
      }
      const breath = Math.sin(time * 2.2) * 0.03;
      const chargingSquash = this.charging ? -this.charge * 0.5 : 0;
      // landing wobble: one small damped overshoot (~0.10 rad) as the impact
      // squash decays — sin((1−ls)·π) rises once then settles to 0
      const dir = this.jumpTo > this.jumpFrom ? 1 : -1;
      const ls = this.landSquash;
      const landWobble = ls > 0 ? Math.sin((1 - ls) * Math.PI) * 0.10 * Math.pow(ls, 0.6) * dir : 0;
      G.Sprites.drawPult(ctx, {
        // breath/charge/recoil only — the hop has its own, much stronger channel
        squash: breath + chargingSquash - this.recoil * 0.6,
        // hop deformation + post-touchdown impact squash, both on the
        // whole-body hopSquash channel (see drawPult)
        hopSquash: hopSquash(k) + this.landSquash * 0.9,
        armAng: -0.55 - this.charge * 1.9 + this.armSwing * 2.4,
        charge: this.charge,
        recoil: this.recoil,
        hopY: 0,
        blink: this.blink > 0,
        glow: this.charging ? this.charge : 0,
        heavy: game.heavySelected && game.ammo > 0,
        holding: this.holding && !this.dead,
        lean: this.jumpT < 1 ? Math.sin(this.jumpT * Math.PI) * 0.30 * dir : landWobble,
      });
      ctx.restore();
    }
  }

  /* ================= GAME ================= */
  class Game {
    constructor(canvas, input) {
      this.canvas = canvas;
      this.input = input;
      this.camera = new G.Camera();
      this.bg = G.Sprites.bakeBackground();
      this.highScore = parseInt(localStorage.getItem('mm_high') || '0', 10);
      this.reset();
      this.state = 'menu';
      this.menuT = 0;
    }
    reset() {
      this.pult = new Pult();
      this.zombies = [];
      this.projectiles = [];
      this.particles = [];
      this.popups = [];
      this.obstacles = [];
      this.craters = [];
      this.score = 0;
      this.scorePop = 0;
      this.combo = 0;
      this.comboT = 0;
      this.ammo = 1;
      this.stage = 1;
      this.wave = 0;
      this.waveState = 'idle'; // idle | spawning | clearing
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.toSpawn = 0;
      this.banner = null;
      this.bannerT = 0;
      this.hitstop = 0;
      this.slowmo = 0;
      this.timeScale = 1;
      this.laneJumpFlash = 0;
      this.heavySelected = false;
      this.warning = 0;
      this.paused = false;
      this.loseCause = null;
      this.lastDirectZombie = null;
      this.stageStats = { kills: 0, glory: 0 };
      this.tips = [
        'Steep arcs plunge over shields — apex height is your skill lever.',
        'A kneed zombie is a glory kill. Heavy ammo comes from glory.',
        'Body splash drops shields instantly. Aim past the door.',
        'Tombstones eat low shots. Arc higher or go through with iron.',
      ];
    }

    /* ---------- flow ---------- */
    start(stage = 1) {
      this.reset();
      this.stage = stage;
      this.state = 'play';
      this.startWave(1);
      G.Audio.waveHorn();
    }
    startWave(n) {
      this.wave = n;
      const S = this.stage;
      this.toSpawn = 3 + S + n * 2;
      this.spawnTimer = 0.8;
      this.waveState = 'spawning';
      this.showBanner(`STAGE ${S} — WAVE ${n}`);
      G.Audio.waveHorn();
      if (n === 1 && S >= 2) this.placeObstacles();
    }
    placeObstacles() {
      this.obstacles = [];
      const n = 1 + Math.floor(this.stage / 2);
      for (let i = 0; i < n; i++) {
        this.obstacles.push({
          row: randi(0, G.Board.ROWS - 1),
          u: rand(2.5, 8),
          hp: 2,
          shake: 0,
        });
      }
    }
    showBanner(txt) { this.banner = txt; this.bannerT = 0; }

    /* ---------- spawning ---------- */
    updateSpawns(dt) {
      if (this.waveState === 'spawning') {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.toSpawn > 0) {
          this.toSpawn--;
          this.spawnTimer = Math.max(0.7, 2.4 - this.stage * 0.15 - this.wave * 0.1);
          this.spawnZombie();
        }
        if (this.toSpawn <= 0) this.waveState = 'clearing';
      } else if (this.waveState === 'clearing') {
        if (this.zombies.every(z => z.dead || z.state === 'die' || z.state === 'glorydie')) {
          if (this.wave >= 4) { this.stageClear(); }
          else { this.score += 250; this.addPopupScreen(640, 300, `WAVE CLEAR +250`, '#b9ff2e', 30); this.startWave(this.wave + 1); }
        }
      }
    }
    spawnZombie() {
      // type weights by stage
      const w = [
        ['shambler', 10],
        ['bucket', this.stage >= 1 ? 3 + this.stage : 0],
        ['shieldy', this.stage >= 1 ? 3 + this.stage : 0],
        ['runner', this.stage >= 2 ? 2 + this.stage : 0],
        ['brute', this.stage >= 3 ? this.stage - 1 : 0],
      ];
      let total = w.reduce((a, b) => a + b[1], 0);
      let r = Math.random() * total;
      let type = 'shambler';
      for (const [t, weight] of w) { r -= weight; if (r <= 0) { type = t; break; } }
      let row = randi(0, G.Board.ROWS - 1);
      // slight bias toward pult's row for pressure
      if (Math.random() < 0.3) row = this.pult.row;
      this.zombies.push(new Zombie(row, type, this.stage));
    }
    stageClear() {
      this.state = 'stageClear';
      const bonus = 500 + this.stage * 250;
      this.score += bonus;
      this.stageBonus = bonus;
      G.Audio.winJingle();
      if (this.score > this.highScore) { this.highScore = this.score; localStorage.setItem('mm_high', String(this.highScore)); }
    }

    /* ---------- lose ---------- */
    brainEaten(z) {
      if (this.state !== 'play') return;
      this.loseCause = 'brain';
      this.lose(z);
    }
    pultDestroyed(z) {
      if (this.state !== 'play') return;
      this.loseCause = 'pult';
      this.pult.dead = true;
      this.camera.kick(20);
      this.shakeBits(this.pult.screenX, G.Board.laneY[this.pult.row], '#b0713a', 14);
      this.lose(z);
    }
    lose(z) {
      this.state = 'gameover';
      this.slowmo = 1.2;
      G.Audio.loseSting();
      if (this.score > this.highScore) { this.highScore = this.score; localStorage.setItem('mm_high', String(this.highScore)); }
    }

    /* ---------- shooting ---------- */
    updateShooting(dt) {
      const p = this.pult;
      if (this.state !== 'play' || p.dead) return;
      const inp = this.input;
      const canAct = p.jumpT >= 1;
      if (canAct && inp.lmb && !p.charging) {
        p.charging = true; p.charge = 0; p.chargeUp = true; p.chargePhase = 0; p.chargeTopGlow = 0; p.lastQ = -1;
      }
      if (p.charging) {
        if (!inp.lmb) {
          // release → fire
          p.charging = false;
          this.fire(p.charge, false);
          p.charge = 0;
        }
      }
      if (canAct && inp.rmbPressed) {
        if (this.ammo > 0) {
          this.ammo--;
          p.charging = false; p.charge = 0; // heavy shot cancels charge
          p.chargePhase = 0; p.chargeUp = true; p.chargeTopGlow = 0;
          this.fire(this.aimForceSuggestion(), true);
          p.recoil = 1.4; p.armSwing = 1;
        } else {
          this.addPopupScreen(this.input.mx, this.input.my - 20, 'NO IRON!', '#ff8080', 18);
          G.Audio.uiClick();
        }
      }
    }
    aimForceSuggestion() {
      // sensible default arc for heavy: apex at mouse
      return 0.45;
    }
    apexUFromMouse() {
      const B = G.Board;
      const r = this.pult.row;
      return clamp(B.toU(r, this.input.mx), B.pultU + 1.2, 11);
    }
    plungeThresholdF() { return 0.607; } // launch angle ≥ ~57° plunges over shields
    // Screen-space position of the melon exactly as G.Sprites.drawPult paints
    // the held/scoop melon for a given pose. Mirrors the sprite transform
    // chain: arm-local melon (58,−6) → arm rotate a=armAng−recoil·0.55 →
    // arm pivot (0,−74) → lean → squash scale (1+squash·0.12, 1−squash·0.14)
    // → pult scale → rail origin. lean=0 at release (fire only when landed).
    // ORDER-SAFE: charge/armSwing/recoil are passed as arguments — fire()
    // computes the tip with (0, 1, 1), the SAME values it then assigns, so
    // call order inside fire() cannot desync the pose. landSquash is read
    // live because firing within ~0.15s of touchdown still squashes the body.
    pultMelonScreen(p, charge, armSwing, recoil) {
      const B = G.Board;
      const squash = -recoil * 0.6 + p.landSquash * 0.9; // matches Pult.draw weights
      const a = -0.55 - charge * 1.9 + armSwing * 2.4 - recoil * 0.55;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = 58 * ca + 6 * sa;   // rotate scoop melon (58,−6) by a
      const ry = 58 * sa - 6 * ca;
      const px = rx, py = ry - 74;   // arm pivot sits above the head box
      const sqx = 1 + squash * 0.12, sqy = 1 - squash * 0.14;
      const s = B.scale(p.row) * pultLaneScale(p.row);
      return {
        x: PULT_RAIL_X + s * (px * sqx),
        y: B.laneY[p.row] - p.hopY + s * (py * sqy),
      };
    }
    fire(force, heavy) {
      const B = G.Board;
      const p = this.pult;
      const apexU = this.apexUFromMouse();
      const d = Math.max(0.8, apexU - B.pultU);
      // Spawn at the drawn arm tip using the pose the pult renders on THIS
      // frame (post-release: charge 0, armSwing 1, recoil 1) → the melon's
      // first frame continues visually from the scoop. Args are passed
      // explicitly, so assigning p.recoil/p.armSwing below is order-safe.
      const tip = this.pultMelonScreen(p, 0, 1, 1);
      this.projectiles.push(new Projectile(p.row, B.pultU, { apexU, force, heavy, launchSx: tip.x, launchSy: tip.y }));
      p.recoil = 1; p.armSwing = 1; p.holding = false;
      setTimeout(() => { p.holding = true; }, 420);
      heavy ? G.Audio.heavyShoot() : G.Audio.shoot(force);
      this.camera.kick(heavy ? 9 : 3.5 + force * 3);
      // muzzle leaves — anchored to the fixed rail, pult-lane scale
      const sc = B.scale(p.row) * pultLaneScale(p.row);
      const sx = PULT_RAIL_X + 40 * sc;
      const sy = B.laneY[p.row] - 78 * sc;
      for (let i = 0; i < 6; i++) {
        this.particles.push(new Particle({
          x: sx, y: sy, vx: rand(40, 160), vy: rand(-90, -20), g: 300, life: 0.4,
          size: rand(2, 4), color: '#dfe8c8', type: 'dot',
        }));
      }
    }

    /* ---------- impacts & damage ---------- */
    resolveImpact(pr, z) {
      pr.hitsDone++;
      this.lastDirectZombie = z;
      // a kneeling zombie dies to ANY hit — glory kill
      if (z.state === 'kneel' && !pr.heavy) {
        this.killZombie(z, 'glory');
        if (!pr.plunge || pr.hitsDone >= 2) { this.groundSplash(pr); pr.dead = true; }
        return;
      }
      const B = G.Board;
      const sx = B.colX(pr.row, z.u);
      const syTop = B.laneY[pr.row] - B.heightPx(pr.row, pr.h);
      if (pr.heavy) {
        // iron shell detonates: one-hit kill on contact + small blast radius
        this.craters.push({ x: sx, y: B.laneY[pr.row], row: pr.row, t: 0, heavy: true });
        if (this.craters.length > 12) this.evictOldestCrater();
        this.killZombie(z, 'heavy');
        for (const other of this.zombies) {
          if (other === z || other.row !== pr.row || other.dead ||
              other.state === 'die' || other.state === 'glorydie') continue;
          if (Math.abs(other.u - z.u) < 0.9) this.killZombie(other, 'heavy');
        }
        this.camera.kick(12);
        this.camera.hitFlash(0.25, '#fff');
        this.hitstop = 0.06;
        this.addPopup(sx, syTop - 30, 'SMASHED!', '#ff9c40', 26);
        this.sparks(sx, syTop, 14);
        this.debris(sx, syTop, '#3d434d', 10);
        this.dustBurst(sx, B.laneY[pr.row], B.scale(pr.row), 10);
        pr.dead = true;
        return;
      }
      if (pr.hitsDone === 1 && pr.plunge) {
        // PLUNGE: over the shield, straight down on the head — armor piece #1 evaded
        if (z.shield) { z.shield = false; this.shieldBreakFX(z, true); }
        this.headHit(z, sx, true);
        // bounce into splash second hit
        pr.h = Math.max(pr.h, 0.9);
        pr.vh = 2.2; pr.vu = pr.vu * 0.45;
        this.sparks(sx, syTop, 10);
        return;
      }
      if (z.shield) {
        // frontal against shield
        z.shieldHits--;
        z.shieldWobble = 0.25;
        z.hitFlash = 0.5;
        G.Audio.shieldClink();
        this.sparks(sx - 14, syTop, 12);
        this.camera.kick(2);
        if (z.shieldHits <= 0) { this.shieldBreakFX(z, false); }
        this.addPopup(sx, syTop - 18, `SHIELD ${Math.max(0, z.shieldHits)}/5`, '#ffd23f', 17);
      } else {
        const label = (pr.plunge && pr.hitsDone >= 2) ? '-1 x2' : '-1';
        this.bodyHit(z, sx, syTop, label);
      }
      this.groundSplash(pr);
      pr.dead = true;
    }
    headHit(z, sx, plunging) {
      const B = G.Board;
      const hy = B.laneY[z.row] - B.heightPx(z.row, 2.4) * 1;
      if (z.helmet) {
        z.helmet = false;
        z.dents++;
        z.hitFlash = 0.5;
        z.helmetWobble = 0.4;
        G.Audio.helmetClank();
        this.sparks(sx, hy - 30, 8);
        this.debris(sx, hy - 30, '#9aa3ad', 7);
        this.addPopup(sx, hy - 44, 'HELMET OFF -1', '#ff9e3d', 20);
        this.camera.kick(3);
        this.hitstop = 0.04;
      } else {
        z.hp--;
        z.state = 'kneel';
        z.kneelTimer = 3;
        z.gloryReady = true;
        z.hitFlash = 0.6;
        G.Audio.headBonk();
        G.Audio.knockdown();
        this.bloodBurst(sx, hy, 10);
        this.addPopup(sx, hy - 40, '-1 HEAD', '#ff9e3d', 20);
        this.addPopup(sx + 4, hy - 66, 'GLORY!', '#b9ff2e', 22);
        this.camera.kick(5);
        this.hitstop = 0.05;
      }
      this.registerHit();
    }
    bodyHit(z, sx, sy, label = '-1') {
      if (z.shield) { // splash/body hit drops the shield outright
        this.shieldBreakFX(z, true);
      }
      if (z.helmet) {
        z.bodyJostle++;
        z.helmetWobble = 0.3;
        if (z.bodyJostle >= 2) {
          z.helmet = false;
          G.Audio.helmetClank();
          this.debris(sx, sy - 24, '#9aa3ad', 6);
          this.addPopup(sx, sy - 40, 'HELMET OFF', '#ffd23f', 16);
        }
      }
      z.hp--;
      z.hitFlash = 0.55;
      G.Audio.splat();
      this.bloodBurst(sx, sy - 6, 12);
      this.addPopup(sx, sy - 34, label, '#ff5555', 20);
      this.camera.kick(2.5);
      this.registerHit();
      if (z.hp <= 0) this.killZombie(z, 'normal');
    }
    shieldBreakFX(z, silentSplash) {
      z.shield = false;
      z.shieldHits = 0;
      const B = G.Board;
      const sx = B.colX(z.row, z.u) - 20 * B.scale(z.row);
      const sy = B.laneY[z.row] - 40 * B.scale(z.row);
      G.Audio.shieldBreak();
      this.debris(sx, sy, '#8a6a3c', 10);
      this.sparks(sx, sy, 6);
      this.addPopup(sx, sy - 24, 'SHIELD DOWN', '#ffd23f', 18);
      this.camera.kick(3);
    }
    killZombie(z, how) {
      if (z.state === 'die' || z.state === 'glorydie') return;
      const B = G.Board;
      const sx = B.colX(z.row, z.u);
      const sy = B.laneY[z.row] - 50 * B.scale(z.row);
      if (how === 'glory') {
        z.state = 'glorydie';
        z.dieT = 0;
        this.stageStats.glory++;
        this.ammo = Math.min(5, this.ammo + 1);
        this.score += Math.floor(500 * this.multiplier());
        this.slowmo = 0.5;
        this.hitstop = 0.09;
        this.camera.kick(10);
        this.camera.hitFlash(0.2, '#eaffb0');
        G.Audio.glorySting();
        G.Audio.deathGroan();
        this.addPopup(sx, sy - 50, 'GLORY KILL!', '#b9ff2e', 34);
        this.addPopup(sx, sy - 20, '+1 IRON', '#86b1ff', 22);
        // ammo icon flies to HUD
        this.particles.push(new Particle({
          x: sx, y: sy, vx: 0, vy: -260, g: 0, life: 0.8, size: 12, color: '#3d434d', type: 'chunk', vr: 9,
        }));
        this.bloodBurst(sx, sy, 22);
        this.stageStats.kills++;
      } else {
        z.state = 'die';
        z.dieT = 0;
        this.score += Math.floor(100 * this.multiplier());
        G.Audio.deathGroan();
        this.bloodBurst(sx, sy, 14);
        this.addPopup(sx, sy - 40, 'DOWN', '#e8e8e8', 18);
        this.stageStats.kills++;
        this.registerHit();
      }
      this.scorePop = 1;
    }
    hitObstacle(pr, ob) {
      pr.hitsDone++;
      ob.hp--;
      ob.shake = 1;
      if (pr.heavy || ob.hp <= 0) {
        this.obstacles.splice(this.obstacles.indexOf(ob), 1);
        this.score += 50;
        G.Audio.stoneCrack();
        const B = G.Board;
        this.debris(B.colX(ob.row, ob.u), B.laneY[ob.row] - 30, '#9aa396', 14);
        this.dustBurst(B.colX(ob.row, ob.u), B.laneY[ob.row], B.scale(ob.row), 10);
        this.addPopup(B.colX(ob.row, ob.u), B.laneY[ob.row] - 70, 'CRUMBLED +50', '#e8e8e8', 18);
        this.camera.kick(5);
      } else {
        G.Audio.stoneCrack();
        const B = G.Board;
        this.sparks(B.colX(ob.row, ob.u), B.laneY[ob.row] - 40, 8);
        this.addPopup(B.colX(ob.row, ob.u), B.laneY[ob.row] - 74, 'BLOCKED', '#cfcfcf', 16);
      }
      pr.dead = true;
    }
    groundSplash(pr) {
      // splash damage: nearby zombies take a body hit
      const B = G.Board;
      let any = false;
      for (const z of this.zombies) {
        if (z.row !== pr.row || z.dead || z.state === 'die' || z.state === 'glorydie') continue;
        if (Math.abs(z.u - pr.u) < 0.85 && z !== this.lastDirectZombie) {
          any = true;
          if (z.state === 'kneel') { this.killZombie(z, 'glory'); }
          else {
            const sx = B.colX(z.row, z.u);
            const sy = B.laneY[z.row] - 40 * B.scale(z.row);
            this.bodyHit(z, sx, sy);
          }
        }
      }
      return any;
    }
    groundImpact(pr) {
      const B = G.Board;
      const sx = B.colX(pr.row, pr.u);
      const sy = B.laneY[pr.row];
      // scorch decal lingers as evidence of the shot
      this.craters.push({ x: sx, y: sy, row: pr.row, t: 0, heavy: false });
      if (this.craters.length > 12) this.evictOldestCrater();
      this.dustBurst(sx, sy - 6, B.scale(pr.row), 6);
      // melon shatters
      this.debris(sx, sy - 8, '#2f8f3e', 8);
      this.debris(sx, sy - 8, '#ff6b6b', 6);
      this.dustBurst(sx, sy, B.scale(pr.row), 8);
      if (pr.hitsDone === 0) {
        // clear miss
        G.Audio.missPoof();
        this.addPopup(sx, sy - 50, 'MISS', '#f0f0f0', 26);
        this.combo = 0;
      }
    }
    registerHit() {
      this.combo++;
      this.comboT = 4;
    }
    multiplier() { return 1 + Math.floor(this.combo / 3); }
    evictOldestCrater() {
      // oldest fades out quickly instead of popping out of existence
      let oldest = 0;
      for (let i = 1; i < this.craters.length; i++) if (this.craters[i].t > this.craters[oldest].t) oldest = i;
      const cr = this.craters.splice(oldest, 1)[0];
      cr.dieAt = cr.t + 0.5;
      this.craters.push(cr);
    }

    /* ---------- FX helpers ---------- */
    addPopup(wx, wy, txt, color, size) { this.popups.push(new Popup(txt, wx, wy, color, size)); }
    addPopupScreen(x, y, txt, color, size) { this.popups.push(new Popup(txt, x, y, color, size)); }
    sparks(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI, 0);
        const sp = rand(120, 420);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 500, drag: 1.2,
          life: rand(0.2, 0.45), size: rand(1.5, 3), color: pick(['#fff6c0', '#ffd23f', '#ffb040']), type: 'spark',
        }));
      }
    }
    bloodBurst(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI, 0.2);
        const sp = rand(60, 320);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 700, drag: 0.4,
          life: rand(0.35, 0.8), size: rand(1.8, 4.2), color: pick(['#c81e1e', '#a01010', '#e04040']), type: 'dot',
        }));
      }
    }
    debris(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI - 0.4, 0.4);
        const sp = rand(80, 300);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 800, drag: 0.2,
          life: rand(0.4, 0.9), size: rand(3, 6), color, type: 'chunk', vr: rand(-10, 10),
        }));
      }
    }
    dustBurst(x, y, s, n, spread = 1) {
      for (let i = 0; i < n; i++) {
        this.particles.push(new Particle({
          x: x + rand(-14, 14) * s * spread, y: y + rand(-4, 2),
          vx: rand(-70, 70) * spread, vy: rand(-60, -10) * (0.6 + 0.4 * spread), g: -30,
          life: rand(0.3, 0.6) * (1 + 0.25 * (spread - 1)), size: rand(3, 6) * s, color: '#c9c0a8', type: 'dust',
        }));
      }
    }
    shakeBits(x, y, color, n) { this.debris(x, y, color, n); }

    /* ---------- main update ---------- */
    update(rawDt) {
      const time = performance.now() / 1000;
      // global keys (checked even while paused)
      if (this.input.keyPressed['p'] || this.input.keyPressed['escape']) {
        if (this.state === 'play') { this.paused = !this.paused; G.Audio.uiClick(); }
      }
      if (this.input.keyPressed['m']) G.Audio.toggleMute();
      if (this.input.keyPressed['r'] && this.state === 'play') this.start(this.stage);
      if (this.paused && this.state === 'play') return;
      // slow-mo & hitstop
      let dt = rawDt;
      if (this.hitstop > 0) { this.hitstop -= rawDt; dt = 0; }
      if (this.slowmo > 0) {
        this.slowmo -= rawDt;
        this.timeScale = damp(this.timeScale, this.slowmo > 0 ? 0.3 : 1, 8, rawDt);
      } else this.timeScale = damp(this.timeScale, 1, 8, rawDt);
      dt *= this.timeScale;
      if (dt > 0.05) dt = 0.05;

      this.camera.update(rawDt);
      this.scorePop = Math.max(0, this.scorePop - rawDt * 4);
      if (this.comboT > 0) { this.comboT -= rawDt; if (this.comboT <= 0) this.combo = 0; }
      this.warning = this.zombies.some(z => !z.dead && z.u < 2.2 && z.state !== 'die' && z.state !== 'glorydie')
        ? this.warning + rawDt : 0;
      this.bannerT += rawDt;

      if (this.state === 'menu') { this.menuT += rawDt; this.updateEntities(dt); return; }
      if (this.state === 'gameover' || this.state === 'stageClear') {
        this.updateEntities(dt);
        this.handleMetaInput();
        return;
      }

      // play
      this.updateShooting(dt);
      this.updateSpawns(dt);
      this.updateEntities(dt); // pult updates inside updateEntities (single-step)
      G.Audio.ambience(rawDt,
        this.zombies.filter(z => z.state === 'walk').length,
        this.zombies.filter(z => !z.dead && z.state !== 'die' && z.state !== 'glorydie').length);
    }
    updateEntities(dt) {
      this.zombies.forEach(z => z.update(dt, this));
      this.zombies = this.zombies.filter(z => !z.dead);
      this.projectiles.forEach(p => p.update(dt, this));
      this.projectiles = this.projectiles.filter(p => !p.dead);
      this.particles = this.particles.filter(p => p.update(dt));
      this.popups = this.popups.filter(p => p.update(dt));
      this.craters.forEach(cr => cr.t += dt);
      this.craters = this.craters.filter(cr => cr.t < (cr.dieAt || 10));
      this.obstacles.forEach(o => o.shake = Math.max(0, o.shake - dt * 4));
      if (this.state !== 'menu' && !this.pult.dead) this.pult.update(dt, this);
    }
    handleMetaInput() {
      if (this.input.keyPressed['enter']) {
        if (this.state === 'stageClear') { this.stage++; this.start(this.stage); }
        else this.start(1);
      }
      if (this.input.keyPressed['r']) this.start(this.state === 'gameover' ? 1 : this.stage);
      if (this.input.keyPressed['m']) G.Audio.toggleMute();
    }

    /* ================= DRAW ================= */
    draw(ctx) {
      const time = performance.now() / 1000;
      ctx.clearRect(0, 0, 1280, 720);
      ctx.save();
      this.camera.apply(ctx);

      ctx.drawImage(this.bg, 0, 0);

      // scorch craters under everything else (far lanes keep a legible minimum size)
      for (const cr of this.craters) {
        const s = Math.max(0.9, G.Board.scale(cr.row)) * (cr.heavy ? 1.6 : 1);
        const ttl = cr.dieAt || (cr.heavy ? 20 : 10);
        const fade = clamp(1 - cr.t / ttl, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.8 * fade;
        ctx.fillStyle = '#3d3226';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.9 * fade;
        ctx.strokeStyle = '#2a221a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.55 * fade;
        ctx.fillStyle = '#241d16';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 17 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        if (cr.heavy) {
          // raised dirt rim + embedded shrapnel — the field remembers iron
          ctx.globalAlpha = 0.7 * fade;
          ctx.strokeStyle = '#6a5638'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 38 * s, 14 * s, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#3d434d';
          for (const [ox, oy, rr] of [[-20, -3, 4], [14, 4, 3.4], [2, 8, 2.6]]) {
            ctx.beginPath(); ctx.arc(cr.x + ox * s, cr.y + oy * s, rr, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }

      // obstacles
      for (const ob of this.obstacles) {
        const B = G.Board;
        const s = B.scale(ob.row);
        const sx = B.colX(ob.row, ob.u) + (ob.shake > 0 ? rand(-3, 3) * ob.shake : 0);
        const sy = B.laneY[ob.row] + 4 * s;
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(sx, sy + 2 * s, 30 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(sx, sy); ctx.scale(s, s);
        G.Sprites.drawTombstone(ctx, 2 - ob.hp);
        ctx.restore();
      }

      // entities sorted by row (far first)
      const actors = [];
      for (const z of this.zombies) actors.push({ row: z.row, draw: () => z.draw(ctx, time) });
      for (const p of this.projectiles) actors.push({ row: p.row, draw: () => p.draw(ctx) });
      if (this.state !== 'menu') actors.push({ row: this.pult.row, draw: () => this.pult.draw(ctx, time, this) });
      actors.sort((a, b) => a.row - b.row);
      for (const a of actors) a.draw();

      // particles & popups on top
      for (const p of this.particles) p.draw(ctx);
      for (const p of this.popups) p.draw(ctx);

      // aiming UI
      if (this.state === 'play') this.drawAimUI(ctx);
      // HUD
      if (this.state !== 'menu') this.drawHUD(ctx);

      ctx.restore();

      // overlays (not shaken)
      if (this.banner && this.bannerT < 2.4 && this.state === 'play') this.drawBanner(ctx);
      if (this.state === 'menu') this.drawMenu(ctx);
      if (this.state === 'stageClear') this.drawStageClear(ctx);
      if (this.state === 'gameover') this.drawGameOver(ctx);
      if (this.paused && this.state === 'play') this.drawPause(ctx);

      // flash
      if (this.camera.flash > 0) {
        ctx.save();
        ctx.globalAlpha = this.camera.flash;
        ctx.fillStyle = this.camera.flashColor;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.restore();
      }
      // vignette when danger
      if (this.warning > 0.15 && this.state === 'play') {
        const a = 0.16 + Math.sin(time * 8) * 0.08;
        const vg = ctx.createRadialGradient(640, 360, 300, 640, 360, 760);
        vg.addColorStop(0, 'rgba(255,0,0,0)');
        vg.addColorStop(1, `rgba(255,30,30,${a})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, 1280, 720);
        if (Math.sin(time * 8) > 0) G.outlinedText(ctx, '!', 90, 400, 60, '#ff4040');
      }
    }

    drawAimUI(ctx) {
      const B = G.Board;
      const p = this.pult;
      if (p.charging && p.jumpT >= 1) {
        const apexU = this.apexUFromMouse();
        const d = Math.max(0.8, apexU - B.pultU);
        const sc = G.shotCalc(d, p.charge, false);
        const tApex = sc.tApex, vu = sc.vu, vh = sc.vh;
        const plunge = p.charge > 0.607;
        ctx.save();
        ctx.strokeStyle = plunge ? 'rgba(185,255,46,0.85)' : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 9]);
        ctx.beginPath();
        // preview rises to the APEX only — judging the descent is the skill
        for (let t = 0; t <= tApex; t += 0.035) {
          const u = B.pultU + vu * t;
          const h = vh * t - 0.5 * B.gravity * t * t;
          const sx = B.colX(p.row, u);
          const sy = B.laneY[p.row] - B.heightPx(p.row, Math.max(0, h));
          t === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // apex marker — aims the arc's crest, never the answer (landing)
        const apexX = B.colX(p.row, clamp(apexU, B.pultU, 11.2));
        const apexY = B.laneY[p.row] - B.heightPx(p.row, sc.H) - 14 * B.scale(p.row);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = plunge ? '#b9ff2e' : '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(apexX, apexY - 7); ctx.lineTo(apexX + 7, apexY);
        ctx.lineTo(apexX, apexY + 7); ctx.lineTo(apexX - 7, apexY);
        ctx.closePath(); ctx.stroke();
        ctx.restore();
        ctx.restore();
        if (plunge) {
          // smooth pulse, no strobe
          ctx.save();
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(performance.now() / 130);
          G.outlinedText(ctx, 'PLUNGE x2', apexX, apexY - 22, 16, '#b9ff2e');
          ctx.restore();
        }
      } else if (p.jumpT >= 1) {
        // no idle reticle — the mouse X reads through the charge UI alone
      }
    }

    drawHUD(ctx) {
      const p = this.pult;
      // score
      const spop = 1 + this.scorePop * 0.25;
      ctx.save();
      ctx.translate(140, 46);
      ctx.scale(spop, spop);
      G.outlinedText(ctx, String(this.score), 0, 0, 40, '#ffffff');
      ctx.restore();
      G.outlinedText(ctx, 'SCORE', 140, 74, 14, '#cfe8c2');
      G.outlinedText(ctx, `HI ${this.highScore}`, 140, 96, 15, '#ffd23f');
      // stage / wave
      G.outlinedText(ctx, `STAGE ${this.stage}`, 1130, 40, 22, '#ffffff', 'center');
      G.outlinedText(ctx, `WAVE ${this.wave}/4`, 1130, 64, 16, '#cfe8c2', 'center');
      // combo
      if (this.combo >= 2) {
        const mult = this.multiplier();
        const a = clamp(this.comboT / 4, 0, 1);
        G.outlinedText(ctx, `STREAK x${mult}`, 640, 40, 26, mult >= 2 ? '#ffd23f' : '#e8e8e8');
        ctx.fillStyle = `rgba(255,210,63,${a})`;
        ctx.fillRect(640 - 60 * a, 58, 120 * a, 4);
      }
      // ammo icons (bottom-left) with count
      for (let i = 0; i < 5; i++) {
        const x = 46 + i * 44, y = 662;
        ctx.save();
        ctx.globalAlpha = i < this.ammo ? 1 : 0.22;
        ctx.translate(x, y);
        G.Sprites.drawMelon(ctx, 15, 0, true, 0);
        ctx.restore();
      }
      G.outlinedText(ctx, 'IRON', 46, 622, 15, '#cfe8c2', 'left');
      G.outlinedText(ctx, `×${this.ammo}`, 46 + 5 * 44 - 6, 662, 22, '#ffe9a0', 'left');
      // force bar while charging
      if (p.charging) {
        const B = G.Board;
        const bx = PULT_RAIL_X + 64 * B.scale(p.row);
        const by = B.laneY[p.row] - 130 * B.scale(p.row);
        const bw = 20, bh = 120 * B.scale(p.row);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRectPath(ctx, bx - 3, by - 3, bw + 6, bh + 6, 6); ctx.fill();
        const fh = bh * p.charge;
        const grad = ctx.createLinearGradient(0, by + bh, 0, by);
        grad.addColorStop(0, '#7ddc5f'); grad.addColorStop(0.6, '#ffd23f'); grad.addColorStop(1, '#ff5030');
        ctx.fillStyle = grad;
        roundRectPath(ctx, bx, by + bh - fh, bw, fh, 4); ctx.fill();
        // turnaround cue: a 2px highlight rides the crest as the bar peaks and turns
        if (p.chargeTopGlow > 0) {
          ctx.globalAlpha = p.chargeTopGlow;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx, by + bh - fh, bw, 2);
          ctx.globalAlpha = 1;
        }
        // current launch angle readout — brightens toward white for a beat at the peak
        const tg = p.chargeTopGlow;
        const degCol = tg > 0
          ? `rgb(255,${Math.round(233 + 22 * tg)},${Math.round(160 + 95 * tg)})`
          : '#ffe9a0';
        G.outlinedText(ctx, `${Math.round(30 + p.charge * 45)}°`, bx + bw / 2, by + bh + 16, 15, degCol);
        // plunge threshold marker
        const fNeeded = this.plungeThresholdF();
        if (fNeeded > 0 && fNeeded < 1) {
          const myy = by + bh - bh * fNeeded;
          ctx.strokeStyle = '#b9ff2e'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(bx - 8, myy); ctx.lineTo(bx + bw + 8, myy); ctx.stroke();
          G.outlinedText(ctx, 'PLUNGE', bx + bw + 12, myy, 12, '#b9ff2e', 'left');
        }
        ctx.restore();
      }
      // tip line (first stage)
      if (this.stage === 1 && this.wave === 1) {
        ctx.save();
        ctx.globalAlpha = clamp(12 - this.bannerT * 0.5, 0, 1) * 0.85;
        G.outlinedText(ctx, 'Hold LMB to charge — release to lob · angles 30°–75° · steep arc = PLUNGE x2', 640, 142, 18, '#ffffff');
        ctx.restore();
      }
    }
    drawBanner(ctx) {
      const k = this.bannerT;
      let a = 1, off = 0;
      if (k < 0.25) { a = k / 0.25; off = (1 - a) * -60; }
      else if (k > 1.9) { a = clamp((2.4 - k) / 0.5, 0, 1); off = (1 - a) * 60; }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(640 + off, 200);
      ctx.fillStyle = 'rgba(20,30,16,0.75)';
      roundRectPath(ctx, -280, -36, 560, 72, 14); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      roundRectPath(ctx, -280, -36, 560, 72, 14); ctx.stroke();
      G.outlinedText(ctx, this.banner, 0, 0, 36, '#ffe9a0');
      ctx.restore();
    }
    drawMenu(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.55)';
      ctx.fillRect(0, 0, 1280, 720);
      const bob = Math.sin(this.menuT * 2) * 8;
      G.outlinedText(ctx, 'MELON MAYHEM', 640, 150 + bob, 84, '#8ee05c', 'center', '#1a2a10', 14);
      G.outlinedText(ctx, 'GARDEN ARTILLERY DEFENSE', 640, 215 + bob * 0.5, 26, '#ffe9a0');
      // preview: idle pult + zombie
      ctx.save();
      ctx.translate(500, 560);
      ctx.scale(1.4, 1.4);
      G.Sprites.drawPult(ctx, { squash: Math.sin(this.menuT * 2.2) * 0.04, armAng: -0.55, holding: true, charge: 0 });
      ctx.restore();
      ctx.save();
      ctx.translate(760, 560);
      ctx.scale(1.4, 1.4);
      G.Sprites.drawZombie(ctx, { pose: 'hold', walkPhase: 0, seed: 3, hitFlash: 0, shield: false, helmet: true, dents: 0, dieT: 0, type: 'shambler', kneelTimer: 0 }, this.menuT);
      ctx.restore();
      const pulse = 0.75 + Math.sin(this.menuT * 4) * 0.25;
      ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'CLICK TO DEFEND YOUR BRAIN', 640, 320, 30, '#ffffff');
      ctx.globalAlpha = 1;
      G.outlinedText(ctx, 'Hold LMB: charge & lob · Mouse X: arc midpoint · Steep arc = PLUNGE x2', 640, 380, 17, '#cfe8c2');
      G.outlinedText(ctx, 'RMB: heavy iron shell · W/S: jump lanes · Glory kills forge iron', 640, 406, 17, '#cfe8c2');
      G.outlinedText(ctx, 'P pause · M mute · R restart', 640, 432, 15, '#9fd6a8');
      ctx.restore();
    }
    drawStageClear(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.6)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, `STAGE ${this.stage} CLEAR!`, 640, 220, 64, '#b9ff2e', 'center', '#1a2a10', 12);
      G.outlinedText(ctx, `BONUS +${this.stageBonus}`, 640, 290, 30, '#ffe9a0');
      G.outlinedText(ctx, `SCORE ${this.score}   ·   HI ${this.highScore}`, 640, 340, 24, '#ffffff');
      G.outlinedText(ctx, 'Next stage: more zombies, tombstones ahead…', 640, 400, 18, '#cfe8c2');
      const pulse = 0.7 + Math.sin(performance.now() / 250) * 0.3;
      ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'PRESS ENTER', 640, 470, 28, '#ffd23f');
      ctx.restore();
    }
    drawGameOver(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(24,6,6,0.65)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, this.loseCause === 'brain' ? 'YOUR BRAIN HAS BEEN EATEN' : 'THE PULT IS GONE', 640, 200, 52, '#ff5555', 'center', '#200808', 12);
      G.outlinedText(ctx, `SCORE ${this.score}`, 640, 280, 34, '#ffffff');
      G.outlinedText(ctx, `HIGH ${this.highScore}`, 640, 325, 24, '#ffd23f');
      G.outlinedText(ctx, `Kills ${this.stageStats.kills} · Glory kills ${this.stageStats.glory} · Stage ${this.stage}`, 640, 370, 18, '#cfe8c2');
      const pulse = 0.7 + Math.sin(performance.now() / 250) * 0.3;
      ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'PRESS R TO RETRY', 640, 440, 26, '#ffe9a0');
      ctx.restore();
    }
    drawPause(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.55)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, 'PAUSED', 640, 330, 60, '#ffffff');
      G.outlinedText(ctx, 'P to resume · M mute · R restart', 640, 390, 20, '#cfe8c2');
      ctx.restore();
    }
  }

  G.Game = Game;
  G.Particle = Particle;
})();

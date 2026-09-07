/* ============================================================
   MELON MAYHEM — sprites.js
   100% original, procedurally drawn vector art. Chunky outlines,
   saturated palette, exaggerated squash & stretch. No external assets.
   All drawings are local-space with the entity's feet at (0,0).
   ============================================================ */
'use strict';
(function () {
  const OUT = '#20241c'; // universal chunky outline
  const clamp = M.clamp;
  const lerp = M.lerp;

  function poly(ctx, pts, fill, stroke = OUT, lw = 3.5) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function ell(ctx, x, y, rx, ry, fill, stroke = OUT, lw = 3.5, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  /* ================= MELON (regular) ================= */
  function drawMelon(ctx, r, glow, heavy, spin) {
    ctx.save();
    if (spin) ctx.rotate(spin);
    if (heavy) {
      // iron shell melon: dark ball with rivets + glowing fuse
      ell(ctx, 0, 0, r, r * 0.92, '#3d434d', OUT, 4);
      ell(ctx, -r * 0.3, -r * 0.35, r * 0.28, r * 0.2, '#6b7480', null, 0, -0.5);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        ell(ctx, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.55, r * 0.1, r * 0.1, '#20242b', OUT, 2);
      }
      // spikes
      for (let i = 0; i < 5; i++) {
        const a = -0.6 + i * 0.5;
        poly(ctx, [[Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.9],
                   [Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.2 - r * 0.05],
                   [Math.cos(a + 0.18) * r * 0.9, Math.sin(a + 0.18) * r * 0.85]], '#2c313a', OUT, 3);
      }
      if (glow > 0) {
        ctx.globalAlpha = glow;
        ell(ctx, 0, 0, r * 1.5, r * 1.4, 'rgba(255,140,40,0.35)', null, 0);
        ctx.globalAlpha = 1;
      }
    } else {
      // watermelon: dark & light green stripes
      ell(ctx, 0, 0, r, r * 0.9, '#2f8f3e', OUT, 4);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#54c25e';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(i * r * 0.42, 0, r * 0.13, r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0, 0, Math.PI * 2);
      ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.stroke();
      if (glow > 0) {
        ctx.globalAlpha = glow;
        ell(ctx, 0, 0, r * 1.45, r * 1.35, 'rgba(255,230,90,0.4)', null, 0);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /* ================= MELON-PULT =================
     opts: { squash, armAng, charge, recoil, hopY, blink, glow, heavy, lean } */
  function drawPult(ctx, opts) {
    const { squash = 0, armAng = -0.5, charge = 0, recoil = 0, hopY = 0,
            blink = false, glow = 0, heavy = false, lean = 0 } = opts;
    ctx.save();
    ctx.translate(0, -hopY);
    ctx.scale(1 + squash * 0.12, 1 - squash * 0.14);
    ctx.rotate(lean);

    // shadow (drawn by caller before translate? draw here, under)
    // -- pot base --
    poly(ctx, [[-46, -6], [46, -6], [38, -26], [-38, -26]], '#b0713a');
    ell(ctx, -30, -4, 12, 6, '#6e4a26'); // dirt
    ell(ctx, 22, -3, 14, 6, '#6e4a26');
    // leaves at base
    poly(ctx, [[-44, -20], [-70, -34], [-46, -40], [-58, -52], [-34, -44]], '#3f9c46', OUT, 3);
    poly(ctx, [[44, -20], [66, -40], [44, -38], [56, -56], [32, -44]], '#48b04f', OUT, 3);
    // stem
    poly(ctx, [[-8, -26], [8, -26], [6, -44], [-6, -44]], '#7c5026');

    // -- head / face box --
    const headY = -58;
    ell(ctx, 0, headY, 26, 22, '#e8b64c');
    // eyes
    const eyeH = blink ? 1 : 7;
    ell(ctx, -9, headY - 4, 5.5, eyeH, '#fff', OUT, 2.5);
    ell(ctx, 9, headY - 4, 5.5, eyeH, '#fff', OUT, 2.5);
    if (!blink) {
      const look = clamp(charge * 2, 0, 1);
      ell(ctx, -9 + look * 2, headY - 3, 2.4, 3.2, OUT, null, 0);
      ell(ctx, 9 + look * 2, headY - 3, 2.4, 3.2, OUT, null, 0);
    }
    // brow (angrier while charging)
    ctx.strokeStyle = OUT; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-15, headY - 13 - charge * 2); ctx.lineTo(-4, headY - 10 - charge * 5);
    ctx.moveTo(15, headY - 13 - charge * 2); ctx.lineTo(4, headY - 10 - charge * 5);
    ctx.stroke();
    // mouth: effort grimace while charging
    if (charge > 0.05) {
      ell(ctx, 0, headY + 9, 7, 3 + charge * 3, '#7a3020', OUT, 2.5);
    } else {
      ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, headY + 5, 6, 0.25, Math.PI - 0.25); ctx.stroke();
    }

    // -- throwing arm: pivot on top of head box --
    const pivotX = 0, pivotY = headY - 16;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    // recoil offsets arm back after firing
    ctx.rotate(armAng - recoil * 0.55);
    // arm plank
    poly(ctx, [[-7, 4], [52, -10], [56, 2], [-5, 14]], '#8a5a2c', OUT, 3.5);
    // scoop at end
    poly(ctx, [[46, -16], [74, -10], [70, 10], [44, 8]], '#4f9c46', OUT, 3.5);
    // melon in scoop while holding
    if (opts.holding) {
      ctx.save();
      ctx.translate(58, -6);
      const gr = 13 + charge * 3 + Math.sin(performance.now() / 90) * charge;
      drawMelon(ctx, gr, glow, heavy, 0);
      ctx.restore();
    }
    // tension spring visual while charging
    if (charge > 0.03) {
      ctx.strokeStyle = `rgba(255,210,70,${0.35 + charge * 0.5})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const px = -6 - i * (2 + charge * 2.4);
        const py = 8 + Math.sin(i * 2.2 + performance.now() / 40) * 2;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore(); // arm

    ctx.restore(); // pult
  }

  /* ================= ZOMBIE =================
     z fields used: pose('hold'|'walk'|'kneel'|'die'|'glorydie'), walkPhase,
     breath t, lean, hitFlash, shield, shieldHits, helmet, dents, dieT, type, dizzy */
  function drawZombie(ctx, z, time) {
    const breath = Math.sin(time * 2.4 + z.seed * 7) * 0.03;
    const walk = z.pose === 'walk' ? Math.sin(z.walkPhase) : 0;
    const walk2 = z.pose === 'walk' ? Math.sin(z.walkPhase + Math.PI) : 0;
    const bob = z.pose === 'walk' ? Math.abs(Math.sin(z.walkPhase)) * -3 : 0;
    const flash = z.hitFlash > 0;

    ctx.save();
    if (z.pose === 'die') {
      // tip over backward & sink
      const t = clamp(z.dieT / 0.9, 0, 1);
      ctx.rotate(t * 1.5);
      ctx.globalAlpha = 1 - clamp((z.dieT - 0.9) / 0.6, 0, 1);
      ctx.translate(t * 8, t * 26);
    }
    if (z.pose === 'glorydie') {
      const t = z.dieT;
      ctx.rotate(Math.sin(t * 20) * 0.12 * clamp(1.4 - t, 0, 1));
      if (t > 0.5) { ctx.globalAlpha = clamp(1 - (t - 0.5) / 0.7, 0, 1); ctx.translate(0, -(t - 0.5) * 30); }
    }
    ctx.translate(0, bob);
    ctx.scale(1 + breath, 1 - breath);
    ctx.rotate(z.lean || 0);

    const skin = flash ? '#e06060' : '#93a877';
    const skinDark = flash ? '#c04040' : '#7a8f60';
    const shirt = z.type === 'brute' ? '#6b5a4a' : '#7d7a6a';
    const pants = '#4a5568';

    if (z.pose === 'kneel') { drawKneelBody(ctx, z, skin, skinDark, shirt, pants, time); }
    else { drawStandingBody(ctx, z, skin, skinDark, shirt, pants, walk, walk2, time); }

    ctx.restore();

    // dizzy stars while kneeling (world-space, above head)
    if (z.pose === 'kneel') {
      for (let i = 0; i < 3; i++) {
        const a = time * 3 + i * 2.09;
        const sx = Math.cos(a) * 14, sy = -86 + Math.sin(a) * 5;
        drawStar(ctx, sx, sy, 4.5, '#ffd23f');
      }
    }
  }

  function drawStar(ctx, x, y, r, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(performance.now() / 300);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = i / 10 * Math.PI * 2 - Math.PI / 2;
      i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function drawStandingBody(ctx, z, skin, skinDark, shirt, pants, walk, walk2, time) {
    const brute = z.type === 'brute';
    const bw = brute ? 1.25 : 1;
    // -- legs --
    poly(ctx, [[-8 * bw, -34], [-2 * bw, -34], [-4 + walk * 9, -2], [-14 + walk * 9, -2]], pants);
    poly(ctx, [[4 * bw, -34], [10 * bw, -34], [12 + walk2 * 9, -2], [2 + walk2 * 9, -2]], pants);
    // shoes
    ell(ctx, -10 + walk * 9, -3, 9, 5, '#2c2c34');
    ell(ctx, 8 + walk2 * 9, -3, 9, 5, '#2c2c34');
    // -- torso --
    const ty = -34, th = 30;
    poly(ctx, [[-14 * bw, ty], [14 * bw, ty], [12 * bw, ty - th], [-12 * bw, ty - th]], shirt);
    // torn hem
    poly(ctx, [[-14 * bw, ty - 4], [-7 * bw, ty - 1], [-1 * bw, ty - 5], [6 * bw, ty - 2], [12 * bw, ty - 5]], shirt, null, 0);
    // patch
    ctx.fillStyle = '#5d6b52';
    ctx.fillRect(-6 * bw, ty - 18, 7, 6);
    // -- arms: dangle & swing --
    const armSw = z.pose === 'walk' ? Math.sin(z.walkPhase + Math.PI) * 6 : Math.sin(time * 2.1 + z.seed * 5) * 2;
    // back arm (reaching forward/left toward pult)
    ctx.save();
    ctx.translate(-10 * bw, ty - th + 4);
    ctx.rotate(0.5 + armSw * 0.02);
    poly(ctx, [[-4, 0], [4, 0], [3, 22], [-4, 22]], skinDark);
    ell(ctx, 0, 24, 5, 5, skinDark);
    ctx.restore();
    // front arm
    ctx.save();
    ctx.translate(9 * bw, ty - th + 4);
    ctx.rotate(-0.35 - armSw * 0.02);
    poly(ctx, [[-4, 0], [4, 0], [4, 23], [-3, 23]], skin);
    ell(ctx, 0, 25, 5.5, 5.5, skin);
    ctx.restore();

    // -- head --
    const hy = ty - th - 13;
    ell(ctx, 0, hy, 13.5 * bw, 14 * bw, skin);
    // jaw
    ell(ctx, -3, hy + 10, 8, 5.5, skin);
    // eyes: one wide, one squint (goofy menace)
    ell(ctx, -5, hy - 3, 3.6, 4.4, '#e8e4d0', OUT, 1.8);
    ell(ctx, 4.5, hy - 2, 3.0, 2.0, '#e8e4d0', OUT, 1.8);
    ell(ctx, -5.6, hy - 2.6, 1.4, 1.8, OUT, null, 0);
    ell(ctx, 4.2, hy - 1.8, 1.1, 1.1, OUT, null, 0);
    // brow
    ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8.5, hy - 8); ctx.lineTo(-2, hy - 7); ctx.stroke();
    // mouth: open groan
    const groan = (Math.sin(time * 2.4 + z.seed * 9) + 1) / 2;
    ell(ctx, -2, hy + 7, 4 + groan * 1.6, 2.2 + groan * 2.2, '#4a2020', OUT, 1.8);
    // stubble
    ctx.fillStyle = 'rgba(40,50,30,0.5)';
    ctx.fillRect(-8, hy + 4, 1.4, 1.4); ctx.fillRect(-4, hy + 3, 1.4, 1.4);

    // -- helmet (dented metal dome) --
    if (z.helmet) {
      ctx.save();
      ctx.translate(0, hy - 4);
      ctx.rotate(z.helmetWobble || 0);
      ctx.beginPath();
      ctx.arc(0, 0, 15.5 * bw, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fillStyle = '#9aa3ad'; ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 15.5 * bw, Math.PI * 1.2, Math.PI * 1.35);
      ctx.strokeStyle = '#c8d0d8'; ctx.lineWidth = 3; ctx.stroke();
      // dents grow with hits
      for (let i = 0; i < (z.dents || 0); i++) {
        ell(ctx, -8 + i * 9, -8 + (i % 2) * 4, 3, 2.2, '#6e767f', OUT, 1.5);
      }
      ctx.restore();
    }

    // -- shield: wooden barricade plank held forward (left side) --
    if (z.shield) {
      ctx.save();
      ctx.translate(-20 * bw, ty - 12);
      ctx.rotate(-0.06 + (z.shieldWobble || 0));
      roundRect(ctx, -7, -26, 14, 52, 4, '#8a6a3c', OUT, 3.5);
      // planks
      ctx.strokeStyle = '#6e522c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.moveTo(-7, 8); ctx.lineTo(7, 8); ctx.stroke();
      // metal band
      ctx.fillStyle = '#5d6570';
      ctx.fillRect(-8, -4, 16, 7);
      ctx.strokeStyle = OUT; ctx.lineWidth = 2;
      ctx.strokeRect(-8, -4, 16, 7);
      // cracks per hit taken
      const hits = 5 - (z.shieldHits || 0);
      ctx.strokeStyle = '#3a2c16'; ctx.lineWidth = 1.8;
      for (let i = 0; i < hits; i++) {
        const cy = -20 + i * 9;
        ctx.beginPath();
        ctx.moveTo(-5, cy); ctx.lineTo(0, cy + 3); ctx.lineTo(-2, cy + 6); ctx.lineTo(4, cy + 8);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawKneelBody(ctx, z, skin, skinDark, shirt, pants, time) {
    const kneel = clamp(z.kneelTimer / 3, 0, 1);
    // folded legs
    poly(ctx, [[-14, -16], [10, -16], [14, 0], [-2, 0]], pants);
    poly(ctx, [[-20, -14], [-4, -14], [-2, 0], [-16, 0]], '#3d4757');
    ell(ctx, -12, -3, 9, 5, '#2c2c34');
    // torso leaning forward
    ctx.save();
    ctx.rotate(0.35);
    poly(ctx, [[-13, -40], [13, -40], [11, -12], [-11, -12]], shirt);
    // arms: one propping on ground
    poly(ctx, [[8, -36], [16, -36], [22, -4], [14, -2]], skinDark);
    ell(ctx, 18, -3, 5, 4, skinDark);
    poly(ctx, [[-10, -36], [-3, -36], [-2, -18], [-9, -18]], skin);
    // head hanging
    const hy = -48;
    ell(ctx, 2, hy, 13.5, 14, skin);
    ell(ctx, -1, hy + 10, 8, 5.5, skin);
    // X eyes / swirl
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-7, hy - 5); ctx.lineTo(-2, hy - 1); ctx.moveTo(-2, hy - 5); ctx.lineTo(-7, hy - 1);
    ctx.moveTo(4, hy - 4); ctx.lineTo(9, hy); ctx.moveTo(9, hy - 4); ctx.lineTo(4, hy);
    ctx.stroke();
    ell(ctx, 1, hy + 7, 3.5, 2.4, '#4a2020', OUT, 1.8);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }

  /* ================= TOMBSTONE ================= */
  function drawTombstone(ctx, dmg) {
    poly(ctx, [[-26, 0], [26, 0], [22, -8], [-22, -8]], '#7a8272');
    ctx.beginPath();
    ctx.moveTo(-24, -6);
    ctx.lineTo(-24, -52);
    ctx.arc(0, -52, 24, Math.PI, 0);
    ctx.lineTo(24, -6);
    ctx.closePath();
    ctx.fillStyle = '#9aa396'; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.stroke();
    // epitaph
    ctx.fillStyle = '#6e776b';
    roundRect(ctx, -10, -56, 20, 4, 2, '#6e776b', null, 0);
    roundRect(ctx, -12, -46, 24, 4, 2, '#6e776b', null, 0);
    roundRect(ctx, -8, -36, 16, 4, 2, '#6e776b', null, 0);
    // cracks per damage
    ctx.strokeStyle = '#4a5148'; ctx.lineWidth = 2;
    for (let i = 0; i < dmg; i++) {
      ctx.beginPath();
      ctx.moveTo(-14 + i * 12, -14);
      ctx.lineTo(-8 + i * 12, -28);
      ctx.lineTo(-13 + i * 12, -40);
      ctx.stroke();
    }
    // grass tufts
    poly(ctx, [[-30, 0], [-26, -10], [-22, 0]], '#4f9c46', OUT, 2);
    poly(ctx, [[24, 0], [29, -12], [33, 0]], '#4f9c46', OUT, 2);
  }

  /* ================= BACKGROUND (baked once) ================= */
  function bakeBackground() {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const x = c.getContext('2d');
    // base ground fill (prevents transparent holes)
    x.fillStyle = '#5f9440';
    x.fillRect(0, 0, 1280, 720);
    // sky band above the board
    const sky = x.createLinearGradient(0, 0, 0, 150);
    sky.addColorStop(0, '#8ecfe8'); sky.addColorStop(1, '#d8eecf');
    x.fillStyle = sky; x.fillRect(0, 0, 1280, 150);
    // sun + glow (kept above the fence line, clear of HUD)
    ell(x, 980, 34, 30, 30, '#ffe9a0', '#f5c542', 6);
    ell(x, 980, 34, 44, 44, 'rgba(255,240,180,0.35)', null, 0);
    // clouds
    const cloud = (cx, cy, s) => {
      x.save(); x.translate(cx, cy); x.scale(s, s);
      ell(x, 0, 0, 34, 20, '#ffffff', null, 0);
      ell(x, 26, 4, 26, 15, '#ffffff', null, 0);
      ell(x, -26, 5, 24, 14, '#ffffff', null, 0);
      ell(x, 6, -12, 22, 16, '#ffffff', null, 0);
      x.restore();
    };
    cloud(240, 62, 1.2); cloud(540, 96, 0.9); cloud(880, 52, 1.1);
    // distant hills peeking over the fence
    x.fillStyle = '#a8d18a';
    x.beginPath();
    x.moveTo(0, 130);
    x.quadraticCurveTo(220, 52, 460, 128);
    x.quadraticCurveTo(700, 44, 940, 130);
    x.quadraticCurveTo(1120, 70, 1280, 128);
    x.lineTo(1280, 140); x.lineTo(0, 140);
    x.closePath(); x.fill();
    // fence line just above the board (raised clear of lane-0 actors)
    x.fillStyle = '#8a6a44';
    for (let fx = 196; fx < 1140; fx += 34) x.fillRect(fx, 70, 9, 36);
    x.fillRect(190, 80, 956, 5);

    // ============ THE LAWN: one receding plane (fan), not stacked slabs ============
    const fanTop = Board.laneY[0] - 42 * Board.scale(0);
    const fanBot = Board.laneY[Board.ROWS - 1] + 42 * Board.scale(Board.ROWS - 1);
    const sAt = y => Board.scale(0) + (Board.scale(Board.ROWS - 1) - Board.scale(0)) * (y - fanTop) / (fanBot - fanTop);
    const edgeL = y => Board.centerX - 4.95 * Board.colW * sAt(y);
    const edgeR = y => Board.centerX + 5.05 * Board.colW * sAt(y);
    // single base trapezoid, single gradient (far = hazy light, near = deep)
    const g = x.createLinearGradient(0, fanTop, 0, fanBot);
    g.addColorStop(0, '#83c25e');
    g.addColorStop(1, '#5c9340');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(edgeL(fanTop), fanTop); x.lineTo(edgeR(fanTop), fanTop);
    x.lineTo(edgeR(fanBot), fanBot); x.lineTo(edgeL(fanBot), fanBot);
    x.closePath(); x.fill();
    // x on the plane at height y for column-unit u (matches Board.colX endpoints)
    const xAt = (y, u) => Board.centerX + (u - 4.5) * Board.colW * sAt(y);
    // 10 subtle alternating column strips (mowing-stripe look): makes each of the
    // 10 columns a discrete tile you can count, without adding visible noise.
    for (let c = 0; c < Board.COLS; c++) {
      x.fillStyle = c % 2 === 0 ? 'rgba(255,255,238,0.055)' : 'rgba(14,34,8,0.05)';
      x.beginPath();
      x.moveTo(xAt(fanTop, c - 0.5), fanTop);
      x.lineTo(xAt(fanTop, c + 0.5), fanTop);
      x.lineTo(xAt(fanBot, c + 0.5), fanBot);
      x.lineTo(xAt(fanBot, c - 0.5), fanBot);
      x.closePath(); x.fill();
    }
    // row band edges (y), shared by dividers and gutters
    const bandY = [fanTop];
    for (let r = 0; r < Board.ROWS - 1; r++) bandY.push((Board.laneY[r] + Board.laneY[r + 1]) / 2);
    bandY.push(fanBot);
    const taper = s => (s - Board.rowScale[0]) / (Board.rowScale[Board.ROWS - 1] - Board.rowScale[0]); // 0 far .. 1 near
    // converging column dividers — carved furrows (dark core + sun-side light lip),
    // drawn per row band so width/intensity taper with row scale. Same straight
    // fan geometry as before (xAt endpoints), just re-stroked legibly.
    for (let r = 0; r < Board.ROWS; r++) {
      const k = taper(Board.rowScale[r]);
      const w = 1.2 + 1.2 * k;    // 1.2px far .. 2.4px near
      const a = 0.62 + 0.22 * k;  // 0.62 far .. 0.84 near
      const y0 = bandY[r], y1 = bandY[r + 1];
      x.lineCap = 'butt';
      for (let c = 0; c <= Board.COLS; c++) {
        const rail = (c === 0 || c === Board.COLS); // outer rails frame the 10 tiles
        x.lineWidth = rail ? w * 1.3 : w;
        x.strokeStyle = `rgba(24,44,14,${(rail ? a + 0.06 : a).toFixed(3)})`;
        x.beginPath();
        x.moveTo(xAt(y0, c - 0.5), y0);
        x.lineTo(xAt(y1, c - 0.5), y1);
        x.stroke();
      }
      // light lip on the sun side of each interior furrow -> crisp edge vs grass
      x.lineWidth = Math.max(0.8, w * 0.5);
      x.strokeStyle = `rgba(228,242,200,${(0.18 + 0.14 * k).toFixed(3)})`;
      for (let c = 1; c < Board.COLS; c++) {
        const dx = w * 0.9;
        x.beginPath();
        x.moveTo(xAt(y0, c - 0.5) + dx, y0);
        x.lineTo(xAt(y1, c - 0.5) + dx, y1);
        x.stroke();
      }
    }
    // lane gutters — loudest lines on the plane: lanes stay primary over columns
    for (let i = 0; i < bandY.length; i++) {
      const by = bandY[i];
      const k = taper(sAt(by));
      const w = 3.0 + 1.0 * k;    // 3.0px far .. 4.0px near
      x.lineWidth = w;
      x.strokeStyle = `rgba(20,42,12,${(0.70 + 0.14 * k).toFixed(3)})`; // 0.70 .. 0.84
      x.beginPath();
      x.moveTo(edgeL(by), by); x.lineTo(edgeR(by), by);
      x.stroke();
      // lit lower lip of the furrow
      x.lineWidth = Math.max(1, w * 0.45);
      x.strokeStyle = `rgba(228,242,200,${(0.14 + 0.14 * k).toFixed(3)})`;
      x.beginPath();
      x.moveTo(edgeL(by), by + w * 0.8); x.lineTo(edgeR(by), by + w * 0.8);
      x.stroke();
    }
    // foreground strip under the board (kept slim — near lanes dominate)
    const fg = x.createLinearGradient(0, 623, 0, 720);
    fg.addColorStop(0, '#568c3c'); fg.addColorStop(1, '#3f6e2e');
    x.fillStyle = fg;
    x.fillRect(0, 623, 1280, 97);
    // grass tufts on the foreground
    for (let i = 0; i < 26; i++) {
      const tx = M.rand(0, 1280), ty = M.rand(632, 712);
      poly(x, [[tx - 4, ty], [tx, ty - 12], [tx + 4, ty]], '#4f9c46', null, 0);
    }
    // left: brain house (near-left corner)
    const hg = x.createLinearGradient(0, 0, 172, 0);
    hg.addColorStop(0, '#b98a54'); hg.addColorStop(1, '#a3743f');
    x.fillStyle = hg;
    x.beginPath();
    x.moveTo(0, 150); x.lineTo(172, 168); x.lineTo(172, 640); x.lineTo(0, 660);
    x.closePath(); x.fill();
    x.strokeStyle = '#7c5a30'; x.lineWidth = 4; x.stroke();
    // door
    x.fillStyle = '#6e4a26';
    x.beginPath();
    x.moveTo(36, 300); x.lineTo(114, 312); x.lineTo(114, 610); x.lineTo(36, 630);
    x.closePath(); x.fill(); x.stroke();
    ell(x, 96, 462, 6, 6, '#e8c85a', OUT, 2);
    // roof edge
    poly(x, [[0, 150], [182, 166], [172, 130], [0, 112]], '#8c4a3a', OUT, 4);
    // right: graveyard entrance
    const gg = x.createLinearGradient(1128, 0, 1280, 0);
    gg.addColorStop(0, '#6b7a5e'); gg.addColorStop(1, '#57644d');
    x.fillStyle = gg;
    x.beginPath();
    x.moveTo(1280, 140); x.lineTo(1128, 165); x.lineTo(1138, 660); x.lineTo(1280, 680);
    x.closePath(); x.fill();
    // fence pickets right
    x.fillStyle = '#4c4438';
    for (let fy = 180; fy < 645; fy += 46) x.fillRect(1138, fy, 30, 8);
    return c;
  }

  G.Sprites = { drawMelon, drawPult, drawZombie, drawTombstone, bakeBackground, drawStar };
})();

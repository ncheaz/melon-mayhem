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

  /* ================= PAINT HELPERS (KR-style hard-edged 3-tone) ================= */
  const TAU = Math.PI * 2;
  function pathPoly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  // ellipse painted as a soft lit volume: linear gradient along the light axis
  // (specular top-right → base → deep shadow bottom-left), thin outline
  function shadedEll(ctx, x, y, rx, ry, base, dark, light, stroke = OUT, lw = 2.4, rot = 0) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    const gsh = ctx.createLinearGradient(-rx * 0.9, ry, rx * 0.9, -ry);
    gsh.addColorStop(0, dark);
    gsh.addColorStop(0.52, base);
    gsh.addColorStop(1, light || base);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fillStyle = gsh; ctx.fill();
    if (light) {
      // specular kiss on the lit pole
      ctx.beginPath(); ctx.ellipse(rx * 0.40, -ry * 0.48, rx * 0.30, ry * 0.20, -0.5, 0, TAU);
      ctx.fillStyle = light; ctx.globalAlpha = 0.65; ctx.fill(); ctx.globalAlpha = 1;
    }
    if (stroke) {
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
    }
    ctx.restore();
  }
  // polygon painted as a soft lit volume: gradient from lit top edge to
  // shadowed bottom, following the global light (upper-right)
  function shadedPoly(ctx, pts, base, dark, light, stroke = OUT, lw = 2.8) {
    ctx.save();
    pathPoly(ctx, pts);
    const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const h = Math.max(1, maxY - minY);
    const gsh = ctx.createLinearGradient(0, minY, 0, maxY);
    gsh.addColorStop(0, light || base);
    gsh.addColorStop(0.42, base);
    gsh.addColorStop(1, dark || base);
    ctx.fillStyle = gsh; ctx.fill();
    // occlusion where the form meets whatever is below (soft dark base line)
    if (dark) {
      ctx.strokeStyle = dark; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1.5, h * 0.10);
      pathPoly(ctx, pts);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(minX - 6, maxY - h * 0.06);
      ctx.lineTo(maxX + 6, maxY - h * 0.06);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (stroke) { pathPoly(ctx, pts); ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  function nail(ctx, x, y, r = 1.8) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = '#4b5560'; ctx.fill();
    ctx.fillStyle = '#8f9aa5';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, TAU); ctx.fill();
  }
  // shared palettes — value steps are LARGE (KR-style): shadow ≈ 55-60% of lit
  // luminance so form shading reads at gameplay scale, shadows hue-shifted cool
  const PAL = {
    pot: { base: '#b0713a', dark: '#6b3f1c', light: '#d89f66' },
    wood: { base: '#a9743f', dark: '#5f3d1e', light: '#d4a468' },
    wood2: { base: '#8a5a2c', dark: '#4a2e14', light: '#b5824a' },
    leaf: { base: '#4f9c46', dark: '#28572a', light: '#8ad672' },
    melon: { base: '#3fa14c', dark: '#1f6427', light: '#7ed46e' },
    melonStripe: { base: '#2f8f3e', dark: '#175a24', light: '#54c25e' },
    iron: { base: '#4a525d', dark: '#272c34', light: '#848f9d' },
    skin: { base: '#9db07f', dark: '#5c6f4e', light: '#c9d9a6' },
    skinBrute: { base: '#a58a68', dark: '#6b563a', light: '#d0b58c' },
    cloth: { base: '#7d7a6a', dark: '#47453a', light: '#a8a58e' },
    clothBrute: { base: '#6b5a4a', dark: '#3d332a', light: '#94806a' },
    pants: { base: '#4a5568', dark: '#28303c', light: '#71829a' },
    bone: { base: '#e8e4d0', dark: '#b3ad92', light: '#fffdf0' },
  };

  /* ================= MELON (regular) ================= */
  function drawMelon(ctx, r, glow, heavy, spin) {
    ctx.save();
    if (spin) ctx.rotate(spin);
    if (heavy) {
      // iron shell melon: riveted dark ball + spikes + glowing fuse
      shadedEll(ctx, 0, 0, r, r * 0.92, PAL.iron.base, PAL.iron.dark, PAL.iron.light, OUT, 4);
      // rivet ring
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + 0.3;
        nail(ctx, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.55, r * 0.1);
      }
      // spikes (dark iron, lit tips)
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
      // watermelon: 3-tone ground, striped with lit stripe centers, specular
      shadedEll(ctx, 0, 0, r, r * 0.9, PAL.melon.base, PAL.melon.dark, null, OUT, 4);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0, 0, TAU); ctx.clip();
      for (let i = -2; i <= 2; i++) {
        ctx.fillStyle = PAL.melonStripe.base;
        ctx.beginPath();
        ctx.ellipse(i * r * 0.42, 0, r * 0.15, r * 0.95, 0, 0, TAU);
        ctx.fill();
        // lit core of each stripe (sun side bias)
        ctx.fillStyle = PAL.melonStripe.light;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.ellipse(i * r * 0.42 + r * 0.05, -r * 0.18, r * 0.055, r * 0.72, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // specular blob top-right
      ctx.fillStyle = 'rgba(240,255,220,0.8)';
      ctx.beginPath();
      ctx.ellipse(r * 0.38, -r * 0.42, r * 0.16, r * 0.10, -0.6, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0, 0, TAU);
      ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.stroke();
      // stem curl
      ctx.strokeStyle = '#5f3d1c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, -r * 0.88);
      ctx.quadraticCurveTo(r * 0.10, -r * 1.14, r * 0.30, -r * 1.02);
      ctx.stroke();
      if (glow > 0) {
        ctx.globalAlpha = glow;
        ell(ctx, 0, 0, r * 2.3, r * 2.05, 'rgba(255,204,40,0.42)', null, 0);
        // white-hot core over saturated yellow — a bloom that OWNS the melon
        if (glow > 0.45) {
          ell(ctx, 0, 0, r * 1.6, r * 1.45, 'rgba(255,232,92,0.6)', null, 0);
          ell(ctx, 0, 0, r * 1.18, r * 1.08, 'rgba(255,250,214,0.75)', null, 0);
          // radiating flare ticks — reads as ENERGY on the melon, not a lamp
          ctx.strokeStyle = 'rgba(255,244,180,0.9)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
          for (let a = 0; a < 6; a++) {
            const ang = a * Math.PI / 3 + performance.now() / 600;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * r * 1.45, Math.sin(ang) * r * 1.32);
            ctx.lineTo(Math.cos(ang) * r * 2.0, Math.sin(ang) * r * 1.8);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /* ================= MELON-PULT =================
     opts: { squash, hopSquash, armAng, charge, recoil, hopY, blink, glow, heavy, lean, holding }
     LOAD-BEARING GEOMETRY (mirrored by game.js pultMelonScreen for melon spawn):
       arm pivot (0,-74); scoop rest point (58,-6) in arm space; body deform
       weights 0.26/0.30 (hop), 0.12/0.14 (squash); rotate(lean + hopSquash*0.14). */
  function drawPult(ctx, opts) {
    const { squash = 0, hopSquash = 0, armAng = -0.5, charge = 0, recoil = 0, hopY = 0,
            blink = false, glow = 0, heavy = false, lean = 0 } = opts;
    ctx.save();
    ctx.translate(0, -hopY);
    ctx.scale(1 + hopSquash * 0.26, 1 - hopSquash * 0.30);
    ctx.scale(1 + squash * 0.12, 1 - squash * 0.14);
    ctx.rotate(lean + hopSquash * 0.14);

    // -- throwing arm painter: pivot (0,-74). LOAD-BEARING: scoop rest (58,-6).
    // armAng arrives already in canvas convention (world angle negated by the
    // caller): positive = tip swung BACK and low, negative = tip raised forward.
    // Painted BEHIND the body when swung back past the face (no impalement read). --
    const armRot = armAng;
    const paintArm = () => {
      ctx.save();
      ctx.translate(0, -74);
      ctx.rotate(armRot);
      // rope wrap at the pivot
      ctx.strokeStyle = '#d9c37e'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(-6, -6); ctx.stroke();
      ctx.strokeStyle = '#b09a58'; ctx.lineWidth = 2;
      for (let i = -4; i <= 4; i += 3) {
        ctx.beginPath(); ctx.moveTo(-8, i); ctx.lineTo(-4, i); ctx.stroke();
      }
      // arm plank: layered wood with grain + bolts
      shadedPoly(ctx, [[-7, 4], [52, -10], [56, 2], [-5, 14]], PAL.wood2.base, PAL.wood2.dark, PAL.wood2.light, OUT, 3.5);
      ctx.strokeStyle = 'rgba(99,64,30,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(50, -6); ctx.stroke();
      nail(ctx, 4, 5); nail(ctx, 48, -6);
      // scoop at the end: half-melon shell cradle (LOAD-BEARING: melon rests at (58,-6))
      shadedPoly(ctx, [[46, -16], [74, -10], [70, 10], [44, 8]], PAL.leaf.base, PAL.leaf.dark, PAL.leaf.light, OUT, 3.5);
      // scoop rim highlight
      ctx.strokeStyle = PAL.leaf.light; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(48, -13); ctx.lineTo(71, -8); ctx.stroke();
      // melon in scoop while holding (LOAD-BEARING rest point (58,-6))
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
      ctx.restore();
    };
    const armBehind = armRot > 1.4;
    if (armBehind) paintArm();

    // -- planter pot: banded wooden tub with soil mound --
    shadedPoly(ctx, [[-46, -6], [46, -6], [38, -26], [-38, -26]], PAL.pot.base, PAL.pot.dark, PAL.pot.light);
    // metal bands + nails
    ctx.strokeStyle = '#4b5560'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-44, -11); ctx.lineTo(44, -11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-40, -22); ctx.lineTo(40, -22); ctx.stroke();
    nail(ctx, -36, -11); nail(ctx, 36, -11); nail(ctx, -33, -22); nail(ctx, 33, -22);
    // soil mounds
    shadedEll(ctx, -26, -25, 14, 6, '#6e4a26', '#54371a', '#8a6238', OUT, 2.5);
    shadedEll(ctx, 20, -24, 16, 7, '#6e4a26', '#54371a', '#8a6238', OUT, 2.5);

    // -- leafy shoulders: big 3-tone leaves fanning out --
    const leaf = (fx, flip) => {
      ctx.save();
      ctx.translate(fx, -34); ctx.scale(flip, 1);
      shadedPoly(ctx, [[0, 0], [-20, -16], [-14, -30], [4, -24], [14, -34], [18, -16]], PAL.leaf.base, PAL.leaf.dark, PAL.leaf.light, OUT, 3);
      // midrib
      ctx.strokeStyle = PAL.leaf.dark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, -4); ctx.quadraticCurveTo(2, -16, 6, -28); ctx.stroke();
      ctx.restore();
    };
    leaf(-38, -1); leaf(38, 1);

    // -- stem neck: short trunk from pot to head --
    shadedPoly(ctx, [[-9, -26], [9, -26], [7, -48], [-7, -48]], PAL.wood2.base, PAL.wood2.dark, PAL.wood2.light);

    // -- head: round wooden face box --
    shadedEll(ctx, 0, -64, 27, 23, PAL.wood.base, PAL.wood.dark, PAL.wood.light, OUT, 4);
    // sun rim along the top-right edge (key light upper-right)
    ctx.strokeStyle = 'rgba(240,220,170,0.85)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -64, 23.5, Math.PI * 1.62, Math.PI * 1.94); ctx.stroke();
    // grain arcs
    ctx.strokeStyle = 'rgba(124,82,40,0.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(-6, -60, 17, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
    ctx.beginPath(); ctx.arc(2, -58, 20, Math.PI * 1.2, Math.PI * 1.6); ctx.stroke();
    // eyes: big whites + specular pupils, tracking the aim while charging
    const eyeH = blink ? 1.4 : 8;
    shadedEll(ctx, -10, -68, 6, eyeH, '#fff', '#d8d4c4', null, OUT, 2.4);
    shadedEll(ctx, 10, -68, 6, eyeH, '#fff', '#d8d4c4', null, OUT, 2.4);
    if (!blink) {
      const look = clamp(charge * 2, 0, 1);
      ell(ctx, -10 + look * 2, -67, 2.6, 3.4, OUT, null, 0);
      ell(ctx, 10 + look * 2, -67, 2.6, 3.4, OUT, null, 0);
      // speculars
      ell(ctx, -10.8 + look * 2, -68.2, 0.9, 0.9, '#fff', null, 0);
      ell(ctx, 9.2 + look * 2, -68.2, 0.9, 0.9, '#fff', null, 0);
    }
    // brow: angrier while charging
    ctx.strokeStyle = OUT; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-17, -78 - charge * 2); ctx.lineTo(-4, -74 - charge * 5);
    ctx.moveTo(17, -78 - charge * 2); ctx.lineTo(4, -74 - charge * 5);
    ctx.stroke();
    // mouth: effort grimace while charging, otherwise confident smirk
    if (charge > 0.05) {
      shadedEll(ctx, 0, -55, 7.5, 3 + charge * 3.2, '#7a3020', '#5a2015', null, OUT, 2.5);
      // gritted teeth
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-4, -55); ctx.lineTo(-4, -52 - charge * 2);
      ctx.moveTo(0, -55); ctx.lineTo(0, -52 - charge * 2);
      ctx.moveTo(4, -55); ctx.lineTo(4, -52 - charge * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = OUT; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(-1, -60, 7, 0.35, Math.PI - 0.55); ctx.stroke();
    }

    // -- throwing arm (front placement unless it was painted behind) --
    if (!armBehind) paintArm();

    // STRONG THROW read: when the arm is wound back past the body the melon
    // (and its glow halo) hides BEHIND the pot — exactly where the glow
    // window opens. Re-paint the melon itself on top so "the melon is
    // glowing" stays visible through the whole wind-up.
    if (armBehind && glow > 0 && opts.holding) {
      ctx.save();
      ctx.translate(0, -74);
      ctx.rotate(armRot);
      ctx.translate(58, -6);
      const gr = 13 + charge * 3 + Math.sin(performance.now() / 90) * charge;
      drawMelon(ctx, gr, glow, heavy, 0);
      ctx.restore();
    }

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

    const brute = z.type === 'brute';
    const skin = flash ? '#e06060' : (brute ? PAL.skinBrute.base : PAL.skin.base);
    const skinDark = flash ? '#c04040' : (brute ? PAL.skinBrute.dark : PAL.skin.dark);
    const skinLight = flash ? '#f09090' : (brute ? PAL.skinBrute.light : PAL.skin.light);
    const shirt = brute ? PAL.clothBrute : PAL.cloth;
    const pants = PAL.pants;

    if (z.pose === 'kneel') { drawKneelBody(ctx, z, skin, skinDark, skinLight, shirt, time); }
    else { drawStandingBody(ctx, z, skin, skinDark, skinLight, shirt, walk, walk2, time); }

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
      const a = i / 10 * TAU - Math.PI / 2;
      i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function drawStandingBody(ctx, z, skin, skinDark, skinLight, shirt, walk, walk2, time) {
    const brute = z.type === 'brute';
    const bucket = z.type === 'bucket';
    const shieldy = z.type === 'shieldy';
    const bw = brute ? 1.25 : 1;
    // -- legs: shaded pants w/ knee highlight, feet as lit shoes --
    shadedPoly(ctx, [[-8 * bw, -34], [-2 * bw, -34], [-4 + walk * 9, -2], [-14 + walk * 9, -2]], PAL.pants.base, PAL.pants.dark, PAL.pants.light, OUT, 3);
    shadedPoly(ctx, [[4 * bw, -34], [10 * bw, -34], [12 + walk2 * 9, -2], [2 + walk2 * 9, -2]], PAL.pants.base, PAL.pants.dark, PAL.pants.light, OUT, 3);
    shadedEll(ctx, -10 + walk * 9, -3, 9, 5, '#3a3a46', '#26262e', '#4e4e5c', OUT, 2.6);
    shadedEll(ctx, 8 + walk2 * 9, -3, 9, 5, '#3a3a46', '#26262e', '#4e4e5c', OUT, 2.6);
    // -- upper body group: hunched lurch (silhouette per type) --
    // bucket plods hunched heavy; shieldy leans back on its plank;
    // walkers shamble forward; brutes stay upright and wide.
    const hunch = bucket ? 0.16 : shieldy ? -0.07 : (brute ? 0.03 : 0.10);
    const sway = z.pose === 'walk' ? Math.sin(z.walkPhase) * 0.035 : Math.sin(time * 2.4 + z.seed * 7) * 0.02;
    ctx.save();
    ctx.translate(0, -34);
    ctx.rotate(hunch + sway);
    ctx.translate(0, 34);
    // -- torso: shaded shirt, torn hem, patch, seams --
    const ty = -34, th = 30;
    shadedPoly(ctx, [[-14 * bw, ty], [14 * bw, ty], [12 * bw, ty - th], [-12 * bw, ty - th]], shirt.base, shirt.dark, shirt.light, OUT, 2.8);
    // torn hem (darker inner zigzag)
    poly(ctx, [[-14 * bw, ty - 4], [-7 * bw, ty - 1], [-1 * bw, ty - 5], [6 * bw, ty - 2], [12 * bw, ty - 5]], shirt.dark, null, 0);
    // cloth fold seams
    ctx.strokeStyle = shirt.dark; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4 * bw, ty - 8); ctx.quadraticCurveTo(-6 * bw, ty - 12, -4 * bw, ty - 16);
    ctx.moveTo(6 * bw, ty - 6); ctx.quadraticCurveTo(8 * bw, ty - 10, 6 * bw, ty - 13);
    ctx.stroke();
    // patch with stitches
    ctx.fillStyle = brute ? '#826a52' : '#5d6b52';
    ctx.fillRect(-6 * bw, ty - 18, 7 * bw, 6);
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
    ctx.strokeRect(-6 * bw, ty - 18, 7 * bw, 6);
    ctx.beginPath();
    ctx.moveTo(-5 * bw, ty - 16); ctx.lineTo(-3 * bw, ty - 15);
    ctx.moveTo(-1 * bw, ty - 14); ctx.lineTo(0, ty - 13);
    ctx.stroke();
    // -- arms: per-type asymmetric reach (breaks the mannequin symmetry) --
    const armSw = z.pose === 'walk' ? Math.sin(z.walkPhase + Math.PI) * 6 : Math.sin(time * 2.1 + z.seed * 5) * 2;
    const aw = brute ? 1.45 : 1; // brutes get heavy arms
    const armBack = shieldy ? 1.38 : bucket ? 0.82 : brute ? 0.66 : 1.05;
    const armFront = shieldy ? 0.52 : bucket ? 0.38 : brute ? 1.02 : 0.72;
    // back arm (reaching forward/left toward pult)
    ctx.save();
    ctx.translate(-10 * bw, ty - th + 4);
    ctx.rotate(armBack + armSw * 0.03);
    shadedPoly(ctx, [[-4 * aw, 0], [4 * aw, 0], [3 * aw, 22], [-4 * aw, 22]], skinDark, skinDark, skin, OUT, 2.6);
    shadedEll(ctx, 0, 24, 5.6 * aw, 5.2 * aw, skin, skinDark, skinLight, OUT, 2.4);
    // knuckle nubs
    ell(ctx, -2.4 * aw, 27.5, 1.4, 1.4, skinDark, null, 0);
    ell(ctx, 1.2 * aw, 28, 1.4, 1.4, skinDark, null, 0);
    ctx.restore();
    // front arm
    ctx.save();
    ctx.translate(9 * bw, ty - th + 4);
    ctx.rotate(armFront - armSw * 0.03);
    shadedPoly(ctx, [[-4 * aw, 0], [4 * aw, 0], [4 * aw, 23], [-3 * aw, 23]], skin, skinDark, skinLight, OUT, 2.6);
    shadedEll(ctx, 0, 25, 6 * aw, 5.6 * aw, skin, skinDark, skinLight, OUT, 2.4);
    ell(ctx, -2.6 * aw, 28.6, 1.5, 1.5, skinDark, null, 0);
    ell(ctx, 1.4 * aw, 29, 1.5, 1.5, skinDark, null, 0);
    ctx.restore();

    // -- head: big KR-orc skull w/ jaw, underbite teeth, ear nubs --
    const hy = ty - th - 13;
    // ears first (behind head)
    shadedEll(ctx, -13 * bw, hy + 2, 3.4, 4.6, skin, skinDark, skinLight, OUT, 2);
    shadedEll(ctx, 13 * bw, hy + 2, 3.4, 4.6, skin, skinDark, skinLight, OUT, 2);
    shadedEll(ctx, 0, hy, 13.5 * bw, 14 * bw, skin, skinDark, skinLight, OUT, 2.6);
    // sun rim along the top-right of the skull (key light upper-right)
    ctx.strokeStyle = 'rgba(235,245,210,0.75)'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, hy, 11 * bw, Math.PI * 1.60, Math.PI * 1.95); ctx.stroke();
    // jaw + underbite teeth
    shadedEll(ctx, -3, hy + 10, 8.4, 5.8, skin, skinDark, skinLight, OUT, 2.4);
    ctx.fillStyle = PAL.bone.base;
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.4;
    for (const tx of [-6, -2.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(tx, hy + 6.5); ctx.lineTo(tx + 1.6, hy + 6.5); ctx.lineTo(tx + 0.8, hy + 9.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // eyes: one wide, one squint (goofy menace) + speculars
    shadedEll(ctx, -5, hy - 3, 3.8, 4.6, '#e8e4d0', '#c2bda6', null, OUT, 1.8);
    shadedEll(ctx, 4.5, hy - 2, 3.2, 2.1, '#e8e4d0', '#c2bda6', null, OUT, 1.8);
    ell(ctx, -5.6, hy - 2.6, 1.5, 1.9, OUT, null, 0);
    ell(ctx, 4.2, hy - 1.8, 1.2, 1.2, OUT, null, 0);
    ell(ctx, -6.1, hy - 3.3, 0.55, 0.55, '#fff', null, 0);
    ell(ctx, 3.9, hy - 2.2, 0.45, 0.45, '#fff', null, 0);
    // heavy brow
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-9, hy - 8); ctx.lineTo(-2.5, hy - 6.4); ctx.stroke();
    // mouth: open groan with throat
    const groan = (Math.sin(time * 2.4 + z.seed * 9) + 1) / 2;
    shadedEll(ctx, -2, hy + 7, 4 + groan * 1.6, 2.2 + groan * 2.2, '#4a2020', '#331414', null, OUT, 1.8);
    // stubble
    ctx.fillStyle = 'rgba(40,50,30,0.5)';
    ctx.fillRect(-8, hy + 4, 1.4, 1.4); ctx.fillRect(-4, hy + 3, 1.4, 1.4);
    // patchy hair strands
    ctx.strokeStyle = 'rgba(52,58,44,0.9)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, hy - 12); ctx.lineTo(-9, hy - 17);
    ctx.moveTo(-2, hy - 13.5); ctx.lineTo(-3, hy - 18);
    ctx.moveTo(4, hy - 13); ctx.lineTo(6, hy - 17);
    ctx.stroke();

    // -- helmet (dented metal dome) --
    if (z.helmet) {
      ctx.save();
      // multi-hit armour (the bucket) visibly TILTS as its hits drain — the
      // armour itself is the health bar, not just the pip strip
      const haHits = z.headArmorHits || 1;
      const dmg = haHits > 1 ? 1 - ((z.helmetHits == null ? haHits : z.helmetHits) / haHits) : 0;
      ctx.translate(0, hy - 4);
      ctx.rotate((z.helmetWobble || 0) + dmg * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, 15.5 * bw, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fillStyle = PAL.iron.base; ctx.fill();
      // shaded lower lip + specular band
      ctx.save(); ctx.clip();
      ctx.fillStyle = PAL.iron.dark;
      ctx.fillRect(-17 * bw, -4, 34 * bw, 8);
      ctx.strokeStyle = '#aeb8c2'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 2, 12 * bw, Math.PI * 1.18, Math.PI * 1.42); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = OUT; ctx.lineWidth = 3.5; ctx.stroke();
      // multi-hit armour beats in: a darkening wash over the whole dome
      if (dmg > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 15.5 * bw, Math.PI * 1.02, Math.PI * 1.98);
        ctx.closePath(); ctx.clip();
        ctx.fillStyle = `rgba(28,32,38,${0.45 * dmg})`;
        ctx.fillRect(-17 * bw, -18, 34 * bw, 22);
        ctx.restore();
      }
      // rim + handle nub
      ctx.strokeStyle = PAL.iron.light; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-14 * bw, 1.5); ctx.lineTo(14 * bw, 1.5); ctx.stroke();
      nail(ctx, 0, -14 * bw, 2);
      // dents grow with hits — BIG 2×2 pocks so the bucket itself narrates
      // the countdown; the last two hits SCORCH the metal
      const nd = Math.min(z.dents || 0, 4);
      for (let i = 0; i < nd; i++) {
        shadedEll(ctx, -9 + (i % 2) * 18, -11 + Math.floor(i / 2) * 9, 5.6, 4, '#3f464e', '#2e343a', '#5a626b', OUT, 2);
      }
      if (haHits > 1 && (z.helmetHits == null ? haHits : z.helmetHits) <= 2) {
        ctx.globalAlpha = 0.6;
        shadedEll(ctx, 4, -2, 10.5, 7, '#3c434b', '#2c3238', '#565e66', null, 0);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // -- shield: wooden barricade plank held forward (left side) --
    if (z.shield) {
      ctx.save();
      ctx.translate(-20 * bw, ty - 12);
      ctx.rotate(-0.06 + (z.shieldWobble || 0));
      shadedPoly(ctx, [[-7, -26], [7, -26], [7, 26], [-7, 26]], '#8a6a3c', '#6b5028', '#a5854f', OUT, 3.5);
      // plank seams + nails
      ctx.strokeStyle = '#5c4522'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.moveTo(-7, 8); ctx.lineTo(7, 8); ctx.stroke();
      nail(ctx, -4, -18); nail(ctx, 4, -18); nail(ctx, -4, 17); nail(ctx, 4, 17);
      // metal band
      shadedPoly(ctx, [[-8, -4], [8, -4], [8, 3], [-8, 3]], '#5d6570', '#464d56', '#7a828c', OUT, 2);
      // cracks per hit taken
      ctx.strokeStyle = '#3a2c16'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      const hits = 5 - (z.shieldHits || 0);
      for (let i = 0; i < hits; i++) {
        const cy = -20 + i * 9;
        ctx.beginPath();
        ctx.moveTo(-5, cy); ctx.lineTo(0, cy + 3); ctx.lineTo(-2, cy + 6); ctx.lineTo(4, cy + 8);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore(); // hunch upper-body group
  }

  function drawKneelBody(ctx, z, skin, skinDark, skinLight, shirt, time) {
    // folded legs
    shadedPoly(ctx, [[-14, -16], [10, -16], [14, 0], [-2, 0]], PAL.pants.base, PAL.pants.dark, PAL.pants.light, OUT, 3);
    shadedPoly(ctx, [[-20, -14], [-4, -14], [-2, 0], [-16, 0]], '#3d4757', '#2c333d', '#4d586b', OUT, 3);
    shadedEll(ctx, -12, -3, 9, 5, '#3a3a46', '#26262e', '#4e4e5c', OUT, 2.6);
    // torso leaning forward
    ctx.save();
    ctx.rotate(0.35);
    shadedPoly(ctx, [[-13, -40], [13, -40], [11, -12], [-11, -12]], shirt.base, shirt.dark, shirt.light, OUT, 2.8);
    // arms: one propping on ground
    shadedPoly(ctx, [[8, -36], [16, -36], [22, -4], [14, -2]], skinDark, skinDark, skin, OUT, 2.6);
    shadedEll(ctx, 18, -3, 5, 4, skin, skinDark, skinLight, OUT, 2.4);
    shadedPoly(ctx, [[-10, -36], [-3, -36], [-2, -18], [-9, -18]], skin, skinDark, skinLight, OUT, 2.6);
    // head hanging
    const hy = -48;
    shadedEll(ctx, 2, hy, 13.5, 14, skin, skinDark, skinLight, OUT, 2.6);
    shadedEll(ctx, -1, hy + 10, 8, 5.5, skin, skinDark, skinLight, OUT, 2.4);
    // X eyes / swirl + tongue out
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, hy - 5); ctx.lineTo(-2, hy - 1); ctx.moveTo(-2, hy - 5); ctx.lineTo(-7, hy - 1);
    ctx.moveTo(4, hy - 4); ctx.lineTo(9, hy); ctx.moveTo(9, hy - 4); ctx.lineTo(4, hy);
    ctx.stroke();
    shadedEll(ctx, 1, hy + 7, 3.5, 2.4, '#4a2020', '#331414', null, OUT, 1.8);
    // lolling tongue
    poly(ctx, [[0, hy + 9], [3, hy + 9], [1.5, hy + 14]], '#c06070', OUT, 1.6);
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
    // Proportional to the cast: authored ×1.4 so the stone stands ≈106px —
    // 0.54× a walker's 195px, the PvZ gravestone read (it used to be a 76px
    // pebble at 0.39×). STONE_BLOCK_H in game.js is this same height in
    // Board units, so the hitbox tracks the art.
    ctx.scale(1.4, 1.4);
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
    // ============ SKY / HILLS / FENCE — dusk horizon over a big field ============
    // Sunset strip (y 0..152): deep zenith → peach → gold at the horizon.
    // Below it the zoomed-in lawn fills the frame down to y≈648.
    const sky = x.createLinearGradient(0, 0, 0, 152);
    sky.addColorStop(0, '#3a3560');
    sky.addColorStop(0.35, '#8a4a6e');
    sky.addColorStop(0.65, '#d4695a');
    sky.addColorStop(0.87, '#f2954e');
    sky.addColorStop(1, '#ffd98a');
    x.fillStyle = sky; x.fillRect(0, 0, 1280, 152);
    // Setting sun, sitting ABOVE the far ridge rather than half-buried in it.
    // x 650 keeps it clear of the cloud at 560 and of the windmill at 1092,
    // and y 86 puts the whole disc above the ridge line (≈121 there).
    const sunX = 650, sunY = 86;
    const sg2 = x.createRadialGradient(sunX, sunY, 10, sunX, sunY, 92);
    sg2.addColorStop(0, 'rgba(255,226,158,0.9)');
    sg2.addColorStop(0.45, 'rgba(255,186,114,0.42)');
    sg2.addColorStop(1, 'rgba(255,178,110,0)');
    x.fillStyle = sg2;
    x.beginPath(); x.arc(sunX, sunY, 92, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(255,200,126,0.42)'; x.lineWidth = 2.6; x.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + 0.26;
      x.beginPath();
      x.moveTo(sunX + Math.cos(a) * 38, sunY + Math.sin(a) * 38);
      x.lineTo(sunX + Math.cos(a) * (48 + (i % 2) * 8), sunY + Math.sin(a) * (48 + (i % 2) * 8));
      x.stroke();
    }
    // disc: hot core, defined limb
    const dg2 = x.createRadialGradient(sunX, sunY - 8, 4, sunX, sunY, 30);
    dg2.addColorStop(0, '#fffdf2');
    dg2.addColorStop(0.55, '#fff0c0');
    dg2.addColorStop(0.86, '#ffd98a');
    dg2.addColorStop(1, '#ffb463');
    x.fillStyle = dg2;
    x.beginPath(); x.arc(sunX, sunY, 29, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(255,188,108,0.9)'; x.lineWidth = 2.2;
    x.beginPath(); x.arc(sunX, sunY, 29, 0, TAU); x.stroke();
    // clouds — painterly puffs tinted by the sunset, three depths
    const cloud = (cx, cy, s, shade) => {
      x.save(); x.translate(cx, cy); x.scale(s, s);
      const puff = (px, py, pr) => {
        const cg = x.createRadialGradient(px - pr * 0.3, py - pr * 0.5, pr * 0.2, px, py, pr);
        cg.addColorStop(0, '#ffe9d8');
        cg.addColorStop(1, shade);
        x.fillStyle = cg;
        x.beginPath(); x.arc(px, py, pr, 0, TAU); x.fill();
      };
      puff(-30, 6, 20); puff(30, 8, 18); puff(8, -10, 22); puff(-6, 4, 24);
      x.restore();
    };
    cloud(180, 36, 0.72, '#d8a0a8');   // far — small, catching pink light
    cloud(640, 28, 0.6, '#d8a0a8');
    cloud(1150, 58, 0.66, '#d8a0a8');
    cloud(360, 74, 1.0, '#c4849a');    // mid
    cloud(850, 98, 0.9, '#c4849a');
    cloud(110, 116, 1.15, '#a86890');  // near — larger, deeper dusk shade
    cloud(560, 124, 1.05, '#a86890');
    // far hills — hazy, warm-tinted (atmospheric perspective), ridge ≈118..146
    {
      const hg = x.createLinearGradient(0, 112, 0, 152);
      hg.addColorStop(0, '#b09078');
      hg.addColorStop(1, '#8fa068');
      x.fillStyle = hg;
    }
    x.beginPath();
    x.moveTo(0, 136);
    x.quadraticCurveTo(180, 112, 380, 130);
    x.quadraticCurveTo(560, 114, 760, 128);
    x.quadraticCurveTo(960, 116, 1140, 126);
    x.quadraticCurveTo(1220, 118, 1280, 124);
    x.lineTo(1280, 152); x.lineTo(0, 152);
    x.closePath(); x.fill();
    // sun-facing rim on the far ridge: the peaks catch the light spilling
    // over them, brightest directly under the sun
    {
      const rimG = x.createLinearGradient(sunX - 330, 0, sunX + 330, 0);
      rimG.addColorStop(0, 'rgba(255,198,124,0)');
      rimG.addColorStop(0.42, 'rgba(255,216,150,0.32)');
      rimG.addColorStop(0.5, 'rgba(255,236,182,0.9)');
      rimG.addColorStop(0.58, 'rgba(255,216,150,0.32)');
      rimG.addColorStop(1, 'rgba(255,198,124,0)');
      x.strokeStyle = rimG; x.lineWidth = 2.6; x.lineJoin = 'round';
      x.beginPath();
      x.moveTo(0, 136);
      x.quadraticCurveTo(180, 112, 380, 130);
      x.quadraticCurveTo(560, 114, 760, 128);
      x.quadraticCurveTo(960, 116, 1140, 126);
      x.quadraticCurveTo(1220, 118, 1280, 124);
      x.stroke();
    }
    // far treeline specks on the far ridge
    x.fillStyle = '#7d8f56';
    for (const [tx, ty] of [[90, 130], [150, 124], [430, 128], [520, 122], [820, 126], [890, 121], [1180, 124]]) {
      x.beginPath(); x.arc(tx, ty, 4.5, 0, TAU); x.fill();
    }
    // near hills — deeper, warmer, rolling straight into the lawn band
    {
      const hg = x.createLinearGradient(0, 144, 0, 204);
      hg.addColorStop(0, '#94a862');
      hg.addColorStop(1, '#6f9648');
      x.fillStyle = hg;
    }
    x.beginPath();
    x.moveTo(0, 172);
    x.quadraticCurveTo(240, 146, 480, 166);
    x.quadraticCurveTo(640, 178, 820, 160);
    x.quadraticCurveTo(1020, 144, 1280, 166);
    x.lineTo(1280, 204); x.lineTo(0, 204);
    x.closePath(); x.fill();
    // Trees live ONLY in the outside margins now — never over the board.
    // Corner clusters whose canopies rise into the sunset strip; the house
    // and graveyard walls (drawn later) swallow their trunks so they read as
    // deep background. The board's x-range (≈173..1173) stays 100% clear.
    const tree = (tx, ty, s) => {
      x.save(); x.translate(tx, ty); x.scale(s, s);
      // trunk hint
      x.fillStyle = '#5f4126';
      x.fillRect(-3, 6, 6, 18);
      // shaded dome canopy + two lobes
      shadedEll(x, 0, 0, 15, 17, '#4f8f3e', '#2f5f2a', '#c78d52', null, 0);
      shadedEll(x, -10, 5, 9, 10, '#4f8f3e', '#2f5f2a', '#7abf60', null, 0);
      shadedEll(x, 9, 6, 8, 9, '#4f8f3e', '#2f5f2a', '#7abf60', null, 0);
      x.restore();
    };
    tree(78, 118, 4.2);    // left corner — big canopy over the cottage roof
    tree(126, 134, 2.6);
    tree(1268, 120, 4.4);  // right corner — big canopy over the graveyard wall
    tree(1226, 132, 2.6);
    // low shrubs hug the fence line (bottoms ≤ y196 — never over the field)
    for (const [sx2, ss] of [[250, 0.8], [420, 0.6], [660, 0.75], [900, 0.6], [1080, 0.8]]) {
      shadedEll(x, sx2, 190, 12 * ss + 6, 8 * ss + 4, '#4f8f3e', '#2f5f2a', '#7abf60', null, 0);
    }
    // far windmill on the ridge — scaled so it reads as a landmark at the
    // horizon rather than a speck (it used to be ~36px, a quarter of a zombie)
    x.save();
    x.translate(1092, 170);
    x.scale(1.75, 1.75);
    poly(x, [[-7, 0], [7, 0], [4, -22], [-4, -22]], '#c9b48a', null, 0);
    poly(x, [[-4, -22], [4, -22], [0, -32]], '#8a6a44', null, 0);
    x.strokeStyle = '#6b4f2e'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -26); x.lineTo(10, -22); x.moveTo(0, -26); x.lineTo(8, -32); x.moveTo(0, -26); x.lineTo(-2, -36); x.moveTo(0, -26); x.lineTo(-9, -21); x.stroke();
    // door + cap so it reads as a building
    x.fillStyle = '#5a4026'; x.fillRect(-2.5, -6, 5, 6);
    x.strokeStyle = '#6b4f2e'; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(-5, -22); x.lineTo(0, -19); x.lineTo(5, -22); x.stroke();
    x.restore();
    // meadow band between hills and lawn (soft transition into the fence)
    const mg = x.createLinearGradient(0, 196, 0, 218);
    mg.addColorStop(0, '#6f9648');
    mg.addColorStop(1, '#8fbc66');
    x.fillStyle = mg; x.fillRect(0, 196, 1280, 22);
    // fence line just above the board (raised clear of lane-0 actors) —
    // shaded planks, twin rails, capped posts, hugging the horizon
    for (let fx = 180; fx < 1180; fx += 34) {
      const pg = x.createLinearGradient(fx, 0, fx + 9, 0);
      pg.addColorStop(0, '#b0885a');
      pg.addColorStop(0.55, '#966f42');
      pg.addColorStop(1, '#6f5230');
      x.fillStyle = pg;
      x.fillRect(fx, 152, 9, 38);
      // pointed top
      poly(x, [[fx, 152], [fx + 4.5, 146], [fx + 9, 152]], '#a37b4c', null, 0);
    }
    for (const ry of [162, 178]) {
      const rg = x.createLinearGradient(0, ry, 0, ry + 6);
      rg.addColorStop(0, '#a37b4c');
      rg.addColorStop(1, '#6f5230');
      x.fillStyle = rg;
      x.fillRect(176, ry, 1004, 6);
    }
    for (const px2 of [180, 520, 866, 1172]) {
      x.fillStyle = '#7c5a34';
      x.fillRect(px2, 148, 14, 44);
      x.fillStyle = '#4f3a20';
      x.fillRect(px2, 148, 14, 5);
      x.fillStyle = '#8f6a3e';
      x.fillRect(px2, 153, 3, 39);
    }

    // ============ THE LAWN: four stacked side-view corridor lanes ============
    // Uniform row scale (Board.rowScale all 1.0) makes every lane a parallel
    // horizontal band. Each lane gets its OWN ground tone (light far → deep
    // near) plus mowing-stripe columns and a grounded top edge, so the field
    // reads as four separate corridors — never a floor plane.
    const fanTop = Board.laneY[0] - 42 * Board.scale(0);
    const fanBot = Board.laneY[Board.ROWS - 1] + 42 * Board.scale(Board.ROWS - 1);
    const sAt = () => Board.scale(0);
    const edgeL = y => Board.centerX - 4.95 * Board.colW * sAt(y);
    const edgeR = y => Board.centerX + 5.05 * Board.colW * sAt(y);
    // halo behind the whole field (softens the rectangle edge against grass)
    const x0 = edgeL(fanTop), x1 = edgeR(fanTop);
    x.fillStyle = '#4f8038';
    x.fillRect(x0 - 6, fanTop - 6, (x1 - x0) + 12, (fanBot - fanTop) + 12);
    // per-lane base fills: unmistakably distinct corridor grounds, light→deep
    const laneTop = ['#aadb85', '#8ac25c', '#6ca442', '#528a2c'];
    const laneBot = ['#93c76c', '#76a94a', '#5b8c36', '#427426'];
    const xAt = (y, u) => Board.centerX + (u - 4.5) * Board.colW * sAt(y);
    // row band edges (y), shared by fills, stripes and shelves
    const bandY = [fanTop];
    for (let r = 0; r < Board.ROWS - 1; r++) bandY.push((Board.laneY[r] + Board.laneY[r + 1]) / 2);
    bandY.push(fanBot);
    for (let r = 0; r < Board.ROWS; r++) {
      const y0 = bandY[r], y1 = bandY[r + 1];
      // distinct per-lane ground
      const lg = x.createLinearGradient(0, y0, 0, y1);
      lg.addColorStop(0, laneTop[r]);
      lg.addColorStop(1, laneBot[r]);
      x.fillStyle = lg;
      x.fillRect(x0, y0, x1 - x0, y1 - y0);
      // mowing stripes: alternating tonal bands — countable columns, no strokes
      for (let c = 0; c < Board.COLS; c++) {
        if (c % 2 === 0) continue;
        x.fillStyle = 'rgba(12,32,6,0.10)';
        x.fillRect(xAt(y0, c - 0.5), y0, xAt(y0, c + 0.5) - xAt(y0, c - 0.5), y1 - y0);
      }
      // organic speckle: clover dots break the flat-fill read
      x.fillStyle = 'rgba(28,64,16,0.14)';
      for (let s = 0; s < 14; s++) {
        const sx = M.rand(x0 + 8, x1 - 8), sy = M.rand(y0 + 8, y1 - 6);
        x.beginPath(); x.ellipse(sx, sy, M.rand(2, 4.5), M.rand(1.2, 2.4), 0, 0, TAU); x.fill();
      }
      // grounded top edge: dark shelf lip + soft cast shadow into the lane
      x.fillStyle = 'rgba(22,44,12,0.42)';
      x.fillRect(x0, y0, x1 - x0, 3);
      const sg = x.createLinearGradient(0, y0 + 3, 0, y0 + 18);
      sg.addColorStop(0, 'rgba(16,36,10,0.28)');
      sg.addColorStop(1, 'rgba(16,36,10,0)');
      x.fillStyle = sg;
      x.fillRect(x0, y0 + 3, x1 - x0, 15);
    }
    // lane boundary lines — crisp shelf edges between corridors
    for (let i = 0; i < bandY.length; i++) {
      const by = bandY[i];
      x.lineWidth = 3.2;
      x.strokeStyle = 'rgba(20,42,12,0.58)';
      x.beginPath();
      x.moveTo(x0, by); x.lineTo(x1, by);
      x.stroke();
      x.lineWidth = 1.8;
      x.strokeStyle = 'rgba(228,242,200,0.30)';
      x.beginPath();
      x.moveTo(x0, by + 3); x.lineTo(x1, by + 3);
      x.stroke();
    }
    // foreground strip under the board (kept slim — the near lanes dominate)
    const fg = x.createLinearGradient(0, 648, 0, 720);
    fg.addColorStop(0, '#568c3c'); fg.addColorStop(1, '#35592a');
    x.fillStyle = fg;
    x.fillRect(0, 648, 1280, 72);
    // garden dressing: shaded grass tufts, pebbles, small flowers
    for (let i = 0; i < 34; i++) {
      const tx = M.rand(0, 1280), ty = M.rand(658, 712);
      poly(x, [[tx - 4, ty], [tx, ty - 12 - M.rand(0, 5)], [tx + 4, ty]], M.pick(['#4f9c46', '#468a3e', '#5aa850']), null, 0);
    }
    for (let i = 0; i < 12; i++) {
      const px4 = M.rand(0, 1280), py4 = M.rand(662, 706), pr = M.rand(3, 6);
      shadedEll(x, px4, py4, pr, pr * 0.7, '#9a9484', '#6b665a', '#c2bca8', null, 0);
    }
    for (let i = 0; i < 9; i++) {
      const fx3 = M.rand(20, 1260), fy3 = M.rand(660, 700), fc = M.pick(['#ffd23f', '#e86a7a', '#ff9c40', '#f0f0e0']);
      x.strokeStyle = '#3f7a34'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(fx3, fy3); x.lineTo(fx3, fy3 - 9); x.stroke();
      ell(x, fx3, fy3 - 11, 3.4, 3.4, fc, null, 0);
      ell(x, fx3 - 1, fy3 - 12, 1.1, 1.1, 'rgba(255,255,255,0.8)', null, 0);
    }
    // left: brain house — storybook cottage side wall (timber-frame, tiled
    // roof, glow window, plank door, stone foundation, ivy)
    {
      // wall: warm plaster, lit from the field side (upper-right sun)
      const hg = x.createLinearGradient(0, 0, 172, 0);
      hg.addColorStop(0, '#8a6b42');
      hg.addColorStop(0.45, '#c9a468');
      hg.addColorStop(1, '#e2c288');
      x.fillStyle = hg;
      x.beginPath();
      x.moveTo(0, 150); x.lineTo(172, 168); x.lineTo(172, 640); x.lineTo(0, 660);
      x.closePath(); x.fill();
      // plaster mottling
      x.fillStyle = 'rgba(120,90,50,0.14)';
      for (const [mx, my, mr] of [[24, 240, 7], [60, 420, 9], [40, 540, 6], [140, 260, 6], [150, 500, 8], [90, 560, 7], [130, 380, 5]]) {
        x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
      }
      // timber frame beams (follow the wall slope: top y +18 across, bottom -20)
      const topAt = tx => 150 + (tx / 172) * 18;
      const botAt = tx => 660 - (tx / 172) * 20;
      x.fillStyle = '#5f4126';
      for (const bx of [26, 88, 148]) {
        x.beginPath();
        x.moveTo(bx - 5, topAt(bx)); x.lineTo(bx + 5, topAt(bx) + 0.5);
        x.lineTo(bx + 5, botAt(bx) - 0.5); x.lineTo(bx - 5, botAt(bx));
        x.closePath(); x.fill();
      }
      // diagonal brace between beams 88 and 148 (mid-wall, reads as framing)
      poly(x, [[92, 386], [102, 384], [146, 300], [136, 298]], '#5f4126', null, 0);
      // stone foundation
      const fg = x.createLinearGradient(0, 560, 0, 660);
      fg.addColorStop(0, '#8f8a7a');
      fg.addColorStop(1, '#6b665a');
      x.fillStyle = fg;
      x.beginPath();
      x.moveTo(0, 566); x.lineTo(172, 546); x.lineTo(172, 640); x.lineTo(0, 660);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(60,56,48,0.5)'; x.lineWidth = 2;
      for (let row = 0; row < 3; row++) {
        const ry = 584 + row * 24 - row * (row * 1.5);
        x.beginPath(); x.moveTo(6, ry + row * 1.5); x.lineTo(168, ry - 20 + row * 1.5); x.stroke();
        for (let sx2 = 20 + (row % 2) * 16; sx2 < 160; sx2 += 34) {
          x.beginPath(); x.moveTo(sx2, ry - 8 + row * 1.5); x.lineTo(sx2, ry + 8 + row * 1.5); x.stroke();
        }
      }
      // tiled roof with eave shadow
      const rg2 = x.createLinearGradient(0, 112, 0, 166);
      rg2.addColorStop(0, '#a85a44');
      rg2.addColorStop(0.5, '#8c4a3a');
      rg2.addColorStop(1, '#64352a');
      x.fillStyle = rg2;
      poly(x, [[0, 150], [182, 166], [172, 130], [0, 112]], rg2, OUT, 4);
      x.strokeStyle = 'rgba(40,20,14,0.45)'; x.lineWidth = 1.6;
      for (let ty = 122; ty < 164; ty += 7) {
        x.beginPath(); x.moveTo(0, ty); x.lineTo(176, ty + 3); x.stroke();
      }
      // lit top edge of the roof
      x.strokeStyle = 'rgba(255,214,160,0.7)'; x.lineWidth = 2.4; x.lineCap = 'round';
      x.beginPath(); x.moveTo(4, 113.5); x.lineTo(170, 131.5); x.stroke();
      // window with warm glow + flower box
      x.fillStyle = '#5f4126';
      x.fillRect(92, 196, 54, 62);
      const wg = x.createLinearGradient(92, 196, 146, 258);
      wg.addColorStop(0, '#ffd98a');
      wg.addColorStop(0.6, '#f0b054');
      wg.addColorStop(1, '#c9862f');
      x.fillStyle = wg;
      x.fillRect(96, 200, 46, 54);
      x.strokeStyle = '#5f4126'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(119, 200); x.lineTo(119, 254); x.moveTo(96, 227); x.lineTo(142, 227); x.stroke();
      // flower box with blooms peeking over the rim
      const boxG = x.createLinearGradient(0, 254, 0, 272);
      boxG.addColorStop(0, '#966f42');
      boxG.addColorStop(1, '#5f4526');
      x.fillStyle = boxG;
      x.fillRect(88, 256, 62, 16);
      x.fillStyle = '#4f3a20';
      x.fillRect(88, 256, 62, 3);
      for (const [fx2, fc] of [[96, '#e86a7a'], [110, '#ffd23f'], [124, '#e86a7a'], [138, '#ff9c40']]) {
        x.strokeStyle = '#3f7a34'; x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(fx2, 256); x.lineTo(fx2, 249); x.stroke();
        ell(x, fx2, 247, 4, 4, fc, null, 0);
        ell(x, fx2 - 1.2, 245.8, 1.4, 1.4, 'rgba(255,255,255,0.75)', null, 0);
      }
      // door: plank wood, iron hinges, step
      const dg = x.createLinearGradient(36, 0, 114, 0);
      dg.addColorStop(0, '#6e4a26');
      dg.addColorStop(0.5, '#8a5f30');
      dg.addColorStop(1, '#5a3c1e');
      x.fillStyle = dg;
      x.beginPath();
      x.moveTo(36, 300); x.lineTo(114, 312); x.lineTo(114, 610); x.lineTo(36, 630);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(46,30,14,0.7)'; x.lineWidth = 2;
      for (let px3 = 50; px3 < 114; px3 += 16) {
        x.beginPath(); x.moveTo(px3, 303 + (px3 - 36) * 0.14); x.lineTo(px3, 610 + (px3 - 36) * 0.23); x.stroke();
      }
      // hinges
      x.fillStyle = '#3f4650';
      for (const hy2 of [380, 500]) {
        x.beginPath(); x.moveTo(40, hy2); x.lineTo(72, hy2 + 3); x.lineTo(72, hy2 + 9); x.lineTo(40, hy2 + 7);
        x.closePath(); x.fill();
      }
      ell(x, 96, 462, 6, 6, '#e8c85a', OUT, 2);
      // stone step
      x.fillStyle = '#9a9484';
      x.beginPath();
      x.moveTo(30, 626); x.lineTo(118, 606); x.lineTo(120, 618); x.lineTo(32, 638);
      x.closePath(); x.fill();
      // lantern beside the door
      x.strokeStyle = '#3f4650'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(128, 322); x.lineTo(128, 336); x.stroke();
      shadedEll(x, 128, 344, 7, 9, '#ffd98a', '#e8942f', '#fff4cf', '#3f4650', 2);
      ell(x, 128, 344, 3, 4, 'rgba(255,255,220,0.8)', null, 0);
      // ivy climbing the left edge
      x.strokeStyle = '#3f7a34'; x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(12, 620);
      x.bezierCurveTo(20, 520, 8, 420, 16, 330);
      x.bezierCurveTo(20, 270, 12, 220, 18, 180);
      x.stroke();
      for (const [vx, vy] of [[14, 560], [10, 470], [16, 390], [9, 300], [15, 240], [12, 190]]) {
        shadedEll(x, vx, vy, 7, 5, '#4f9c46', '#2f6b2c', '#7fd06c', null, 0, -0.4);
      }
      // ambient occlusion where the house meets the lawn
      const ao = x.createLinearGradient(172, 0, 216, 0);
      ao.addColorStop(0, 'rgba(20,40,12,0.30)');
      ao.addColorStop(1, 'rgba(20,40,12,0)');
      x.fillStyle = ao;
      x.fillRect(172, 168, 44, 472);
    }
    // right: graveyard entrance — stone wall with block courses, moss, and
    // an arched iron gate the zombies shamble in through
    {
      const gg = x.createLinearGradient(1128, 0, 1280, 0);
      gg.addColorStop(0, '#77876a');
      gg.addColorStop(0.55, '#5f6f52');
      gg.addColorStop(1, '#49563f');
      x.fillStyle = gg;
      x.beginPath();
      x.moveTo(1280, 140); x.lineTo(1128, 165); x.lineTo(1138, 660); x.lineTo(1280, 680);
      x.closePath(); x.fill();
      // stone block courses (perspective-skewed rows)
      x.strokeStyle = 'rgba(40,50,36,0.55)'; x.lineWidth = 2;
      for (let row = 0; row < 11; row++) {
        const yTop = 172 + row * 44 - row * 1.2;
        const xOff = (1138 - 1280) * 0 + 1130 + row * 0.6;
        x.beginPath(); x.moveTo(xOff, yTop); x.lineTo(1276, yTop - 22); x.stroke();
        for (let bx = 1160 + (row % 2) * 26; bx < 1270; bx += 52) {
          x.beginPath(); x.moveTo(bx, yTop - 24); x.lineTo(bx - 2, yTop + 16); x.stroke();
        }
      }
      // moss patches near the base
      x.fillStyle = 'rgba(90,130,60,0.5)';
      for (const [mx, my, mr] of [[1150, 610, 10], [1190, 632, 13], [1240, 650, 11], [1160, 560, 7], [1225, 590, 8]]) {
        x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
      }
      // arched gate: dark opening + iron bars + stone rim
      x.fillStyle = '#20261e';
      x.beginPath();
      x.moveTo(1168, 640); x.lineTo(1168, 300);
      x.quadraticCurveTo(1168, 246, 1214, 246);
      x.quadraticCurveTo(1258, 246, 1258, 300);
      x.lineTo(1258, 640);
      x.closePath(); x.fill();
      // stone rim around the arch
      x.strokeStyle = '#8a9480'; x.lineWidth = 8;
      x.beginPath();
      x.moveTo(1164, 640); x.lineTo(1164, 298);
      x.quadraticCurveTo(1164, 242, 1213, 242);
      x.quadraticCurveTo(1262, 242, 1262, 298);
      x.lineTo(1262, 640);
      x.stroke();
      x.strokeStyle = '#5d6657'; x.lineWidth = 2.5;
      x.beginPath();
      x.moveTo(1158, 640); x.lineTo(1158, 298);
      x.quadraticCurveTo(1158, 236, 1213, 236);
      x.quadraticCurveTo(1268, 236, 1268, 298);
      x.lineTo(1268, 640);
      x.stroke();
      // iron bars + crossbars
      x.strokeStyle = '#2c3238'; x.lineWidth = 4;
      for (const bx of [1192, 1213, 1234]) {
        x.beginPath(); x.moveTo(bx, 268); x.lineTo(bx, 636); x.stroke();
      }
      x.lineWidth = 3;
      for (const by of [330, 420, 510, 600]) {
        x.beginPath(); x.moveTo(1170, by); x.lineTo(1256, by - 6); x.stroke();
      }
      // iron arch band + finial
      x.lineWidth = 5;
      x.beginPath(); x.moveTo(1172, 268); x.quadraticCurveTo(1213, 246, 1254, 264); x.stroke();
      ell(x, 1213, 244, 5, 5, '#2c3238', null, 0);
    }
    return c;
  }

  G.Sprites = {
    drawMelon, drawPult, drawZombie, drawTombstone, bakeBackground, drawStar,
    // shared chunky-vector paint kit — used by zombie_art2d.js so both
    // files stay in one visual language
    _paint: { poly, ell, pathPoly, shadedEll, shadedPoly, nail, PAL, OUT },
  };
})();

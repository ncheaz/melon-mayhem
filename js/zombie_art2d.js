/* ============================================================
   MELON MAYHEM — zombie_art2d.js
   Roster-driven 2D zombie painter.

   Replaces the old single-body sprite with a small skeletal rig:
   every zombie is drawn as articulated limbs + a shared big-skull
   head, then dressed from its type row in zombie_types.js. The
   same row drives the 3D builder, so 2D and 3D stay in sync.

   Design rules (PopCap read):
     · head is ~1/3 of total height and as wide as the shoulders
     · huge blank sclera, tiny pupils, one eye always off-kilter
     · wide underbite grin with a dark interior and a few teeth
     · hunched lurch: shoulders forward of the hips, head thrust
     · the prop owns the silhouette — cone, bucket, door, paper,
       helmet, pole, pick, flag are drawn BIG
     · seeded per-zombie wardrobe + grime so a wave is a crowd
   ============================================================ */
'use strict';
(function () {
  const OUT = '#1d2118';
  const TAU = Math.PI * 2;
  const clamp = M.clamp;
  const lerp = M.lerp;

  /* ---- lifted paint kit ----
     The shared shadedEll/shadedPoly ramp puts the base tone at its
     midpoint (dark → 52% base → light). That is right for big props, but
     a small character loses most of its area to the shadow half: measured
     median skin luminance came out 124 against a 199 base tone, i.e. the
     whole cast read dark and muddy at gameplay scale.
     Re-wrapping the helpers keeps the same light direction and the same
     call signatures (so every call site benefits) but gives each form
     more of its base tone, then re-strokes the outline so the chunky
     PopCap edge survives the wash. */
  let _KIT = null;
  function P_() {
    if (_KIT) return _KIT;
    const p = G.Sprites._paint;
    const LIFT = 0.34;
    _KIT = Object.assign({}, p, {
      shadedEll(ctx, x, y, rx, ry, base, dark, light, stroke, lw, rot) {
        p.shadedEll(ctx, x, y, rx, ry, base, dark, light, stroke, lw, rot);
        ctx.save();
        ctx.globalAlpha = LIFT;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
        ctx.fillStyle = base; ctx.fill();
        ctx.restore();
        if (stroke) {
          ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
          ctx.strokeStyle = stroke; ctx.lineWidth = lw === undefined ? 3.5 : lw; ctx.stroke();
        }
      },
      shadedPoly(ctx, pts, base, dark, light, stroke, lw) {
        p.shadedPoly(ctx, pts, base, dark, light, stroke, lw);
        ctx.save();
        ctx.globalAlpha = LIFT;
        p.pathPoly(ctx, pts);
        ctx.fillStyle = base; ctx.fill();
        ctx.restore();
        if (stroke) {
          p.pathPoly(ctx, pts);
          ctx.strokeStyle = stroke; ctx.lineWidth = lw === undefined ? 2.8 : lw;
          ctx.lineJoin = 'round'; ctx.stroke();
        }
      },
    });
    return _KIT;
  }

  /* ---------------- gaits ----------------
     step  hip swing (rad)      lift  foot lift (px)
     bob   vertical bounce      sway  torso roll
     knee  knee bend amount     arm   arm swing
     lean  extra hunch          spd   cadence multiplier
     armBase / armBaseB        front / back shoulder rest angle
     PopCap's undead lurch forward from the pelvis with the head leading and
     the knees never locking, so `lean` here is deliberately steep and a knee
     bend is baked in even when standing still.                        */
  const GAITS = {
    shamble: { step: 0.60, lift: 4.0, bob: 3.0, sway: 0.055, knee: 0.55, arm: 0.55, lean: 0.26, spd: 1.00, armBase: 0.26, armBaseB: 0.50 },
    plod: { step: 0.44, lift: 2.6, bob: 4.2, sway: 0.035, knee: 0.40, arm: 0.34, lean: 0.34, spd: 0.85, armBase: 0.32, armBaseB: 0.58 },
    lurch: { step: 0.38, lift: 2.0, bob: 1.8, sway: 0.020, knee: 0.30, arm: 0.06, lean: 0.14, spd: 0.90, armBase: 0.40, armBaseB: 0.64 },
    trudge: { step: 0.46, lift: 2.8, bob: 3.0, sway: 0.030, knee: 0.45, arm: 0.10, lean: 0.22, spd: 0.95, armBase: 1.26, armBaseB: 0.68 },
    trot: { step: 0.78, lift: 6.0, bob: 4.6, sway: 0.045, knee: 0.95, arm: 0.85, lean: 0.13, spd: 1.45, armBase: 0.18, armBaseB: 0.68 },
    stomp: { step: 0.70, lift: 7.0, bob: 5.0, sway: 0.060, knee: 1.05, arm: 0.45, lean: 0.18, spd: 1.10, armBase: 0.28, armBaseB: 0.72 },
    march: { step: 0.66, lift: 5.0, bob: 3.6, sway: 0.038, knee: 0.72, arm: 0.50, lean: 0.20, spd: 1.15, armBase: 0.26, armBaseB: 0.66 },
  };

  /* ============================================================
     LIMB RIG
     Angles are radians; 0 = hanging straight down. Positive swings
     the limb toward -x (the direction zombies face).
     ============================================================ */
  function leg(ctx, x, y, hipA, kneeA, kneeOut, pal, shoe, w, sc, shade) {
    const sh = P_();
    const thighL = 26 * sc, shinL = 19 * sc, ankle = 11 * sc;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hipA);
    // thigh
    sh.shadedPoly(ctx, [[-w, 1], [w, 1], [w * 0.84, thighL], [-w * 0.84, thighL]],
      shade ? pal.dark : pal.base, pal.deep, shade ? pal.base : pal.light, OUT, 2.6);
    ctx.translate(0, thighL);
    ctx.rotate(-kneeOut);
    // knee cap knot
    sh.shadedEll(ctx, 0, 1, w * 0.78, w * 0.66, pal.base, pal.dark, pal.light, OUT, 2.2);
    ctx.rotate(kneeOut + kneeA);
    // shin
    sh.shadedPoly(ctx, [[-w * 0.84, 0], [w * 0.84, 0], [w * 0.66, shinL], [-w * 0.66, shinL]],
      shade ? pal.dark : pal.base, pal.deep, shade ? pal.base : pal.light, OUT, 2.6);
    // cuff
    ctx.save();
    ctx.translate(0, shinL);
    sh.shadedEll(ctx, 0, 0, w * 0.72, w * 0.40, pal.dark, pal.deep, pal.base, OUT, 2.0);
    ctx.restore();
    // shoe: long flat wedge toward the facing side + sole + laces
    ctx.save();
    ctx.translate(0, shinL + ankle * 0.72);
    sh.shadedPoly(ctx, [[-w * 0.8, -4], [w * 0.8, -4], [w * 0.9, 3], [w * 1.0, 7], [-w * 1.8, 7], [-w * 1.85, 1]],
      shoe.base, shoe.deep, shoe.light, OUT, 2.8);
    sh.poly(ctx, [[-w * 1.8, 7], [w * 1.0, 7], [w * 0.95, 10], [-w * 1.75, 10]], shoe.deep, OUT, 2.2);
    if (shoe.laces) {
      ctx.strokeStyle = shoe.laces; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w * 0.4, -2); ctx.lineTo(w * 0.5, -2);
      ctx.moveTo(-w * 0.5, 1.5); ctx.lineTo(w * 0.4, 1.5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  function arm(ctx, x, y, shA, elA, pal, w, sc, shade, handFn) {
    const sh = P_();
    /* Long slack arms. PopCap zombies let the arms hang almost straight down
       and FORWARD, with the elbows barely bent, so the hands dangle at or
       below the hips with the fingers loose. Short arms read as "tucked at
       the waist" and delete the shamble entirely. */
    const upL = 26 * sc, loL = 24 * sc;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shA);
    sh.shadedEll(ctx, 0, 0, w * 1.15, w * 1.05, pal.base, pal.dark, pal.light, OUT, 2.4);
    sh.shadedPoly(ctx, [[-w, 1], [w, 1], [w * 0.82, upL], [-w * 0.82, upL]],
      shade ? pal.dark : pal.base, pal.deep, shade ? pal.base : pal.light, OUT, 3.0);
    // rolled sleeve
    sh.shadedEll(ctx, 0, upL * 0.40, w * 1.06, w * 0.62, pal.dark, pal.deep, pal.base, OUT, 2.0);
    ctx.translate(0, upL);
    ctx.rotate(elA);
    sh.shadedEll(ctx, 0, 0, w * 0.82, w * 0.78, pal.base, pal.dark, pal.light, OUT, 2.2);
    sh.shadedPoly(ctx, [[-w * 0.82, 0], [w * 0.82, 0], [w * 0.7, loL], [-w * 0.7, loL]],
      shade ? pal.dark : pal.base, pal.deep, shade ? pal.base : pal.light, OUT, 3.0);
    // wrist crease
    sh.shadedEll(ctx, 0, loL * 0.94, w * 0.74, w * 0.30, pal.dark, pal.deep, pal.base, OUT, 1.8);
    ctx.translate(0, loL);
    if (handFn) handFn(ctx);
    else hand(ctx, w * 1.20);
    ctx.restore();
  }

  /* Long knuckled mitt. PopCap hands are bone-and-sausage: a flat palm with
     four dangling two-segment fingers plus a thumb, not a rounded nub. */
  function hand(ctx, hw, pal, spread = 1) {
    const sh = P_();
    sh.shadedEll(ctx, 0, 0, hw, hw * 0.80, pal.base, pal.dark, pal.light, OUT, 2.4);
    for (let i = 0; i < 4; i++) {
      const f = (i - 1.5) * hw * 0.46 * spread;
      const len = hw * (1.20 - Math.abs(i - 1.5) * 0.13);
      const rot = f * 0.020 + (i % 2 ? 0.05 : -0.04);
      ctx.save();
      ctx.translate(f * 0.46, hw * 0.48);
      ctx.rotate(rot);
      sh.shadedPoly(ctx, [[-hw * 0.21, 0], [hw * 0.21, 0], [hw * 0.18, len * 0.60], [-hw * 0.18, len * 0.60]],
        pal.base, pal.dark, pal.light, OUT, 2.0);
      ctx.translate(0, len * 0.60);
      ctx.rotate(-rot * 0.6 + 0.12);
      sh.shadedPoly(ctx, [[-hw * 0.18, 0], [hw * 0.18, 0], [hw * 0.13, len * 0.42], [-hw * 0.13, len * 0.42]],
        pal.base, pal.dark, pal.light, OUT, 2.0);
      ctx.restore();
    }
    // thumb hangs toward the facing side
    ctx.save();
    ctx.translate(-hw * 0.90, -hw * 0.04);
    ctx.rotate(-0.72);
    sh.shadedPoly(ctx, [[-hw * 0.20, 0], [hw * 0.20, 0], [hw * 0.16, hw * 0.90], [-hw * 0.16, hw * 0.90]],
      pal.base, pal.dark, pal.light, OUT, 2.0);
    ctx.restore();
  }

  /* ============================================================
     HEAD — the money shot. Big cranium, bug eyes, underbite grin.
     Local origin = head centre. Face points -x.
     ============================================================ */
  function head(ctx, L, z, time, open, tilt) {
    const sh = P_();
    const s = L.skin, b = L.build.headScale;
    const hw = 22 * b, hh = 21 * b;              // cranium half-size
    ctx.save();
    ctx.rotate(tilt);

    // ears (drawn behind the skull, big and low)
    sh.shadedEll(ctx, -hw * 0.92, hh * 0.18, 4.2 * b, 5.6 * b, s.base, s.dark, s.light, OUT, 2.2);
    sh.shadedEll(ctx, hw * 0.94, hh * 0.16, 4.6 * b, 6.0 * b, s.base, s.dark, s.light, OUT, 2.2);
    // ear holes
    sh.ell(ctx, hw * 0.98, hh * 0.18, 1.5 * b, 2.0 * b, s.deep, null, 0);

    // cranium
    sh.shadedEll(ctx, 0, 0, hw, hh, s.base, s.dark, s.light, OUT, 3.0);
    // brow shelf shadow
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, hw, hh, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = s.dark; ctx.globalAlpha = 0.20;
    ctx.beginPath(); ctx.ellipse(-1, -hh * 0.46, hw * 1.1, hh * 0.34, 0, 0, TAU); ctx.fill();
    // cheek hollow
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.ellipse(-hw * 0.35, hh * 0.55, hw * 0.42, hh * 0.3, 0.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // hair — sparse, seeded, three styles
    const hs = L.hairStyle;
    ctx.strokeStyle = L.hairCol; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6 * b;
    ctx.beginPath();
    if (hs === 0) {                     // bed-head wisps
      ctx.moveTo(-hw * 0.55, -hh * 0.72); ctx.lineTo(-hw * 0.75, -hh * 1.32);
      ctx.moveTo(-hw * 0.12, -hh * 0.92); ctx.lineTo(-hw * 0.16, -hh * 1.5);
      ctx.moveTo(hw * 0.36, -hh * 0.8); ctx.lineTo(hw * 0.55, -hh * 1.3);
      ctx.moveTo(hw * 0.72, -hh * 0.5); ctx.lineTo(hw * 0.98, -hh * 0.95);
    } else if (hs === 1) {              // comb-over
      ctx.moveTo(-hw * 0.8, -hh * 0.5);
      ctx.quadraticCurveTo(0, -hh * 1.25, hw * 0.9, -hh * 0.42);
      ctx.moveTo(-hw * 0.2, -hh * 0.95); ctx.lineTo(-hw * 0.1, -hh * 1.15);
    } else {                            // balding fringe
      ctx.moveTo(hw * 0.2, -hh * 0.86); ctx.lineTo(hw * 0.42, -hh * 1.15);
      ctx.moveTo(hw * 0.62, -hh * 0.62); ctx.lineTo(hw * 0.86, -hh * 0.9);
    }
    ctx.stroke();

    // ---- nose: big soft lump between the eyes
    sh.shadedEll(ctx, -hw * 0.52, hh * 0.06, 5.4 * b, 4.4 * b, s.base, s.dark, s.light, OUT, 2.2);

    // ---- jaw / muzzle: wide underbite slab
    sh.shadedEll(ctx, -hw * 0.10, hh * 0.74, hw * 0.86, hh * 0.52, s.base, s.dark, s.light, OUT, 2.8);

    // ---- mouth: dark cavity + teeth, opens wider as `open` grows
    const mw = hw * 0.62, mh = (3.4 + open * 5.6) * b;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(-hw * 0.16, hh * 0.62, mw, mh, -0.06, 0, TAU);
    ctx.fillStyle = '#3b1616'; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.4; ctx.stroke();
    // throat darkening
    ctx.beginPath();
    ctx.ellipse(-hw * 0.16, hh * 0.62 + mh * 0.35, mw * 0.7, mh * 0.5, 0, 0, TAU);
    ctx.fillStyle = '#250d0d'; ctx.fill();
    // upper teeth row (seeded gaps)
    for (let i = 0; i < 4; i++) {
      if (L.teethSkip === i) continue;
      const tx = -hw * 0.16 - mw * 0.62 + i * mw * 0.44;
      sh.poly(ctx, [[tx, hh * 0.62 - mh * 0.95], [tx + mw * 0.34, hh * 0.62 - mh * 0.95],
      [tx + mw * 0.30, hh * 0.62 - mh * 0.18], [tx + mw * 0.04, hh * 0.62 - mh * 0.18]],
        L.prop.bone.base, OUT, 1.5);
    }
    // two crooked lower teeth
    for (let i = 0; i < 2; i++) {
      const tx = -hw * 0.42 + i * mw * 0.72;
      sh.poly(ctx, [[tx, hh * 0.62 + mh * 0.9], [tx + mw * 0.32, hh * 0.62 + mh * 0.9],
      [tx + mw * 0.26, hh * 0.62 + mh * 0.2], [tx + mw * 0.05, hh * 0.62 + mh * 0.2]],
        L.prop.bone.base, OUT, 1.5);
    }
    ctx.restore();

    // ---- eyes: hooded, lopsided, sunk in a socket
    const blink = L.blinkPhase > 0.94 ? clamp((L.blinkPhase - 0.94) / 0.06, 0, 1) : 0;
    const eo = L.eyeOffset;   // seeded asymmetry
    eye(ctx, -hw * 0.34 + eo.x * b, -hh * 0.26 + eo.y * b, hw * 0.34, hh * 0.38 * (1 - blink * 0.85), L, blink, 1);
    eye(ctx, hw * 0.34, -hh * 0.23, hw * 0.29, hh * 0.33 * (1 - blink * 0.85), L, blink, 0.86);
    // bagged sockets ring the whole upper face
    ctx.strokeStyle = 'rgba(58,70,46,0.35)'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(-hw * 0.30 + eo.x * b, -hh * 0.14 + eo.y * b, hw * 0.42, hh * 0.44, -0.05, Math.PI * 0.02, Math.PI * 0.98);
    ctx.stroke();

    // ---- blood at the mouth once the body has taken hits
    if (z.blood) {
      ctx.fillStyle = L.prop.blood.dark; ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(-hw * 0.1, hh * 0.95);
      ctx.quadraticCurveTo(-hw * 0.05, hh * 1.5, -hw * 0.3, hh * 1.9);
      ctx.quadraticCurveTo(-hw * 0.2, hh * 1.4, -hw * 0.42, hh * 1.0);
      ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* PopCap eyes: NOT white circles with a centred dot. They are yellow-white
     blobs sunk in a shaded socket, hooded by a heavy dark upper lid, with the
     pupil riding high and off-centre, plus an under-eye bag. That hooded,
     lopsided stare is most of the character's identity. */
  function eye(ctx, x, y, rx, ry, L, blink, scl) {
    const sh = P_();
    if (ry < 0.7) return;
    // socket shadow: the eye sits IN the skull, not on top of it
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.beginPath(); ctx.ellipse(x + 0.6, y + 1.0, rx * 1.18, ry * 1.16, 0, 0, TAU);
    ctx.fillStyle = L.skin.dark; ctx.fill();
    ctx.restore();
    // sclera — warm bone, never pure white
    sh.shadedEll(ctx, x, y, rx, ry, '#e6dfbf', '#bdb595', '#f9f3e0', OUT, 2.6);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.clip();
    // heavy hooded upper lid
    ctx.fillStyle = L.skin.dark;
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.06, y - ry * 0.98, rx * 1.08, ry * 0.56, -0.12, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.06, y - ry * 0.82, rx * 1.04, ry * 0.48, -0.12, 0, TAU);
    ctx.stroke();
    // under-eye bag
    ctx.strokeStyle = 'rgba(58,70,46,0.55)'; ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.66, rx * 0.80, ry * 0.36, 0.08, Math.PI * 0.04, Math.PI * 0.96);
    ctx.stroke();
    // bloodshot when enraged
    if (L.rage) {
      ctx.strokeStyle = 'rgba(190,44,32,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - rx * 0.9, y + ry * 0.2); ctx.lineTo(x + rx * 0.5, y + ry * 0.05);
      ctx.moveTo(x - rx * 0.7, y + ry * 0.45); ctx.lineTo(x + rx * 0.2, y + ry * 0.3);
      ctx.stroke();
    }
    ctx.restore();
    // pupil: small, high, and OFF-CENTRE
    const px = x - rx * (0.16 + L.gaze.x * 0.40) * scl;
    const py = y + ry * (-0.06 + L.gaze.y * 0.32);
    sh.ell(ctx, px, py, rx * 0.33, ry * 0.35, '#171512', null, 0);
    sh.ell(ctx, px - rx * 0.11, py - ry * 0.13, rx * 0.10, ry * 0.12, 'rgba(255,255,255,0.85)', null, 0);
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.stroke();
  }

  /* ============================================================
     TORSO + clothing
     ============================================================ */
  function torso(ctx, L, z, dims) {
    const sh = P_();
    const { shoW, hipW, hipY, shoY, th } = dims;
    const c = L.suit;
    // jacket body: wide rounded shoulders tapering to the waist
    sh.shadedPoly(ctx, [
      [-shoW, shoY], [shoW, shoY], [shoW * 0.94, shoY + th * 0.42],
      [hipW * 1.06, hipY], [-hipW * 1.06, hipY], [-shoW * 0.96, shoY + th * 0.46],
    ], c.base, c.dark, c.light, OUT, 3.6);
    // cast shadow the head throws across the chest — cheap form, big read
    sh.poly(ctx, [[-shoW * 0.66, shoY - 1], [shoW * 0.66, shoY - 1],
    [shoW * 0.44, shoY + th * 0.30], [-shoW * 0.5, shoY + th * 0.30]], 'rgba(0,0,0,0.16)', null, 0);
    // collar
    sh.shadedPoly(ctx, [[-shoW * 0.52, shoY - 2], [shoW * 0.52, shoY - 2],
    [shoW * 0.30, shoY + th * 0.22], [-shoW * 0.34, shoY + th * 0.22]], c.dark, c.deep, c.base, OUT, 2.4);
    // open jacket front: shirt V + lapels
    sh.shadedPoly(ctx, [[-shoW * 0.30, shoY + th * 0.16], [shoW * 0.26, shoY + th * 0.16],
    [shoW * 0.10, hipY - 1], [-shoW * 0.16, hipY - 1]], L.shirt.base, L.shirt.dark, L.shirt.light, OUT, 2.6);
    sh.shadedPoly(ctx, [[-shoW * 0.34, shoY + th * 0.14], [-shoW * 0.72, shoY + th * 0.30],
    [-shoW * 0.34, hipY - 2], [-shoW * 0.05, hipY - 2]], c.light, c.base, c.light, OUT, 2.4);
    sh.shadedPoly(ctx, [[shoW * 0.30, shoY + th * 0.14], [shoW * 0.70, shoY + th * 0.30],
    [shoW * 0.32, hipY - 3], [shoW * 0.06, hipY - 3]], c.base, c.dark, c.base, OUT, 2.4);
    // torn hem
    sh.poly(ctx, [[-hipW * 1.06, hipY - 3], [-hipW * 0.5, hipY + 1], [0, hipY - 4],
    [hipW * 0.5, hipY + 1], [hipW * 1.06, hipY - 3]], c.deep, null, 0);
    // pockets + seam
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-shoW * 0.8, shoY + th * 0.52); ctx.lineTo(-shoW * 0.5, shoY + th * 0.56);
    ctx.moveTo(shoW * 0.8, shoY + th * 0.52); ctx.lineTo(shoW * 0.5, shoY + th * 0.56);
    ctx.stroke();

    // ---- type-specific garment over the jacket
    const g = L.type.id;
    if (g === 'digger') plaid(ctx, c, shoW, shoY, th, hipY);
    if (g === 'shambler' || g === 'conehead' || g === 'flag') tie(ctx, L, shoW, shoY, th);
    if (g === 'runner') jersey(ctx, L, shoW, shoY, th, '3');
    if (g === 'brute') jersey(ctx, L, shoW, shoY, th, '00');
    if (g === 'newspaper') suspenders(ctx, c, shoW, shoY, th, hipY);
    if (g === 'shieldy') apron(ctx, c, shoW, shoY, th, hipY);
  }

  function tie(ctx, L, shoW, shoY, th) {
    const sh = P_();
    const tw = shoW * 0.10;
    const y0 = shoY + th * 0.20;
    sh.shadedPoly(ctx, [[-tw, y0], [tw, y0], [tw * 1.5, y0 + th * 0.06], [0, y0 + th * 0.14],
    [-tw * 1.5, y0 + th * 0.06]], L.tie.base, L.tie.dark, L.tie.light, OUT, 2.0);
    const steps = 5, hgt = th * 0.62;
    for (let i = 0; i < steps; i++) {
      const yA = y0 + th * 0.14 + (hgt / steps) * i;
      const yB = yA + hgt / steps;
      const wA = tw * (1.15 + i * 0.14), wB = tw * (1.15 + (i + 1) * 0.14);
      sh.poly(ctx, [[-wA, yA], [wA, yA], [wB, yB], [-wB, yB]],
        i % 2 ? L.tie.stripe : L.tie.base, OUT, 1.6);
    }
  }

  function jersey(ctx, L, shoW, shoY, th, num) {
    const sh = P_();
    const c = L.suit;
    // white shoulder yoke + number plate
    sh.shadedPoly(ctx, [[-shoW * 0.98, shoY + th * 0.04], [shoW * 0.98, shoY + th * 0.04],
    [shoW * 0.86, shoY + th * 0.30], [-shoW * 0.88, shoY + th * 0.30]],
      L.prop.pad.base, L.prop.pad.dark, L.prop.pad.light, OUT, 2.4);
    // side stripe
    sh.poly(ctx, [[shoW * 0.55, shoY], [shoW * 0.78, shoY], [shoW * 0.62, shoY + th * 0.95],
    [shoW * 0.44, shoY + th * 0.95]], c.light, null, 0);
    // chest number
    ctx.save();
    ctx.translate(0, shoY + th * 0.55);
    ctx.rotate(-0.03);
    ctx.scale(1.15, 1.0);
    ctx.font = '900 ' + Math.round(shoW * 0.72) + "px 'Trebuchet MS', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.strokeStyle = OUT; ctx.lineWidth = 3.4;
    ctx.strokeText(num, 0, 0);
    ctx.fillStyle = '#fffdf3'; ctx.fillText(num, 0, 0);
    ctx.restore();
  }

  function plaid(ctx, c, shoW, shoY, th, hipY) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-shoW, shoY); ctx.lineTo(shoW, shoY); ctx.lineTo(hipY ? shoW * 0.94 : 0, hipY);
    ctx.lineTo(-shoW * 0.94, hipY); ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c.deep; ctx.lineWidth = 2.4;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 9, shoY - 6); ctx.lineTo(i * 9 - 4, hipY + 4); ctx.stroke();
    }
    ctx.strokeStyle = c.light; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      const y = shoY + i * 8;
      ctx.beginPath(); ctx.moveTo(-shoW, y); ctx.lineTo(shoW, y); ctx.stroke();
    }
    ctx.restore();
  }

  function suspenders(ctx, c, shoW, shoY, th, hipY) {
    const sh = P_();
    sh.poly(ctx, [[-shoW * 0.62, shoY], [-shoW * 0.40, shoY], [-shoW * 0.22, hipY], [-shoW * 0.44, hipY]], c.deep, OUT, 1.8);
    sh.poly(ctx, [[shoW * 0.40, shoY], [shoW * 0.62, shoY], [shoW * 0.44, hipY], [shoW * 0.22, hipY]], c.deep, OUT, 1.8);
  }

  function apron(ctx, c, shoW, shoY, th, hipY) {
    const sh = P_();
    sh.poly(ctx, [[-shoW * 0.7, shoY + th * 0.5], [shoW * 0.7, shoY + th * 0.5],
    [shoW * 0.8, hipY + 4], [-shoW * 0.8, hipY + 4]], 'rgba(120,132,110,0.5)', null, 0);
  }

  /* ============================================================
     PROPS — the silhouette. Each painter works in the zombie's
     local space (feet at 0,0) unless documented as head-local.
     ============================================================ */
  const PROPS = {};

  /* ---- traffic cone (head-local: origin = head centre) ---- */
  PROPS.cone = (ctx, L, z, time, dent) => {
    const sh = P_();
    const c = L.prop.cone, band = L.prop.coneBand;
    const yb = -20;                       // sits on the crown
    ctx.save();
    ctx.rotate(-0.05);
    /* Tall and narrow: a real traffic cone on a head, not a party hat —
       no brim ring, just the moulded base square and two thin bands. */
    sh.shadedPoly(ctx, [[-13, yb], [13, yb], [4.6, yb - 58], [-4.6, yb - 58]], c.base, c.deep, c.light, OUT, 3.2);
    // moulded base square
    sh.shadedPoly(ctx, [[-15.5, yb + 3], [15.5, yb + 3], [13, yb - 4], [-13, yb - 4]], c.dark, c.deep, c.base, OUT, 2.8);
    // one clean reflective band, plus a thinner one below
    sh.poly(ctx, [[-9.6, yb - 12], [9.6, yb - 12], [8.2, yb - 19], [-8.2, yb - 19]], band.base, OUT, 2.0);
    sh.poly(ctx, [[-6.2, yb - 36], [6.2, yb - 36], [5.2, yb - 42], [-5.2, yb - 42]], band.base, OUT, 1.8);
    // tip cap + scuffs
    sh.poly(ctx, [[-4.6, yb - 58], [4.6, yb - 58], [4.2, yb - 62], [-4.2, yb - 62]], c.dark, OUT, 2.0);
    if (dent) {
      ctx.strokeStyle = c.deep; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, yb - 32); ctx.lineTo(-2, yb - 26); ctx.lineTo(-7, yb - 20); ctx.stroke();
    }
    ctx.restore();
  };

  /* ---- steel bucket (head-local) ---- */
  PROPS.bucket = (ctx, L, z, time, dent) => {
    const sh = P_();
    const m = L.metal, d = L.prop.bucketDent || m;
    ctx.save();
    ctx.rotate(0.07 + (z.helmetWobble || 0) * 0.4);
    // bucket walls (slightly tapered, wider at the top)
    sh.shadedPoly(ctx, [[-18, -49], [18, -49], [15, 6], [-15, 6]], m.base, m.dark, m.light, OUT, 3.2);
    // vertical ribs
    ctx.strokeStyle = m.dark; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-10, -46); ctx.lineTo(-8, 3);
    ctx.moveTo(2, -48); ctx.lineTo(2, 4);
    ctx.moveTo(12, -46); ctx.lineTo(10, 3);
    ctx.stroke(); ctx.globalAlpha = 1;
    // top rim (open mouth: you see the dark inside)
    sh.shadedEll(ctx, 0, -49, 18, 5.4, m.light, m.dark, m.light, OUT, 3.0);
    sh.ell(ctx, 0, -49.5, 13.5, 3.4, '#3d434b', OUT, 2.2);
    // rim lip highlight
    ctx.strokeStyle = m.light; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(0, -49, 15.5, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    // handle bail
    ctx.strokeStyle = m.dark; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.arc(0, -50, 21, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    ctx.strokeStyle = m.base; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, -50, 21, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    // dents
    for (let i = 0; i < clamp(dent, 0, 4); i++) {
      const dy = -30 + i * 11;
      sh.shadedEll(ctx, (i % 2 ? -9 : 8), dy, 5, 3.4, d.dark, '#3f464d', d.base, OUT, 1.8);
    }
    ctx.restore();
  };

  /* ---- football helmet + face mask (head-local) ---- */
  PROPS.helmet = (ctx, L, z, time, dent) => {
    const sh = P_();
    const c = L.prop.helmet, m = L.metal, pad = L.prop.pad;
    ctx.save();
    ctx.rotate((z.helmetWobble || 0) * 0.5);
    // shell
    ctx.beginPath();
    ctx.ellipse(0, -4, 21, 19, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    const gsh = ctx.createLinearGradient(0, -22, 0, 4);
    gsh.addColorStop(0, c.light); gsh.addColorStop(0.45, c.base); gsh.addColorStop(1, c.dark);
    ctx.fillStyle = gsh; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 3.2; ctx.stroke();
    // crown stripe + skull decal
    sh.poly(ctx, [[-4, -21], [4, -21], [3, -2], [-3, -2]], pad.base, OUT, 1.8);
    ctx.save(); ctx.translate(9, -8); ctx.rotate(-0.12); ctx.scale(1.1, 1.1);
    sh.ell(ctx, 0, 0, 4.4, 4.0, pad.base, OUT, 1.6);
    sh.ell(ctx, -1.5, -0.6, 1.2, 1.3, c.deep, null, 0);
    sh.ell(ctx, 1.5, -0.6, 1.2, 1.3, c.deep, null, 0);
    sh.poly(ctx, [[-2.2, 2.0], [2.2, 2.0], [0, 4.0]], c.deep, null, 0);
    ctx.restore();
    // ear hole + jaw pad
    sh.shadedEll(ctx, -12, 4, 6.5, 6.0, pad.base, pad.dark, pad.light, OUT, 2.2);
    sh.shadedEll(ctx, 13, 4, 5.0, 5.0, pad.base, pad.dark, pad.light, OUT, 2.2);
    // face mask: grey cage bars over the face
    ctx.strokeStyle = m.light; ctx.lineWidth = 3.0; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-19, 6); ctx.quadraticCurveTo(-24, 13, -14, 19);
    ctx.moveTo(-19, 10); ctx.lineTo(-6, 18);
    ctx.stroke();
    ctx.strokeStyle = m.base; ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-19, 6); ctx.lineTo(-9, 8);
    ctx.moveTo(-18, 14); ctx.lineTo(-8, 15);
    ctx.moveTo(-14, 19); ctx.lineTo(-6, 12);
    ctx.stroke();
    // chin strap
    ctx.strokeStyle = pad.dark; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-14, 16); ctx.quadraticCurveTo(-4, 24, 8, 18); ctx.stroke();
    // dents
    for (let i = 0; i < clamp(dent, 0, 3); i++) {
      sh.shadedEll(ctx, 6 + i * 6, -14 + (i % 2) * 5, 4, 2.6, c.deep, '#4d110c', c.base, OUT, 1.6);
    }
    ctx.restore();
  };

  /* ---- hard hat + head lamp (head-local) ---- */
  PROPS.hardhat = (ctx, L, z, time, dent) => {
    const sh = P_();
    const c = { base: '#f0c33c', dark: '#a8801a', light: '#ffe07a', deep: '#7d5c10' };
    ctx.save();
    ctx.rotate((z.helmetWobble || 0) * 0.4);
    ctx.beginPath();
    ctx.ellipse(0, -4, 20, 17, 0, Math.PI * 1.04, Math.PI * 1.96);
    ctx.closePath();
    const gsh = ctx.createLinearGradient(-8, -20, 8, 0);
    gsh.addColorStop(0, c.light); gsh.addColorStop(0.5, c.base); gsh.addColorStop(1, c.dark);
    ctx.fillStyle = gsh; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 3.0; ctx.stroke();
    // ribs
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-7, -18); ctx.lineTo(-7, -1);
    ctx.moveTo(0, -20); ctx.lineTo(0, -1);
    ctx.moveTo(7, -18); ctx.lineTo(7, -1);
    ctx.stroke();
    // brim
    sh.shadedPoly(ctx, [[-24, -1], [20, -1], [18, -6], [-22, -6]], c.base, c.dark, c.light, OUT, 2.6);
    // head lamp
    sh.shadedEll(ctx, -18, -9, 5.4, 5.0, L.prop.lamp.base, L.prop.lamp.dark, L.prop.lamp.light, OUT, 2.4);
    ctx.save();
    ctx.globalAlpha = 0.30 + 0.10 * Math.sin(time * 5 + z.seed);
    ctx.beginPath();
    ctx.moveTo(-20, -11); ctx.lineTo(-74, -30); ctx.lineTo(-74, 10);
    ctx.closePath();
    ctx.fillStyle = '#fff3b0'; ctx.fill();
    ctx.restore();
    ctx.restore();
  };

  /* ---- headband (head-local) ---- */
  PROPS.headband = (ctx, L, z, time) => {
    const sh = P_();
    const c = { base: '#cf3b31', dark: '#8d1f18', light: '#f4746a', deep: '#66130d' };
    ctx.save();
    sh.shadedPoly(ctx, [[-22, -12], [22, -12], [22, -4], [-22, -4]], c.base, c.dark, c.light, OUT, 2.4);
    // trailing tails
    const w = Math.sin(time * 4 + z.seed) * 4;
    sh.poly(ctx, [[20, -11], [30 + w, -6], [28 + w, 2], [18, -4]], c.base, OUT, 2.0);
    sh.poly(ctx, [[20, -7], [32 + w * 1.3, 2], [28 + w * 1.3, 9], [17, 0]], c.dark, OUT, 2.0);
    ctx.restore();
  };

  /* ---- shoulder pads (torso-local, around shoY) ---- */
  PROPS.pads = (ctx, L, z, time) => {
    const sh = P_();
    const c = L.prop.pad;
    const w = 30 * L.build.shoulder * L.build.bulk;
    ctx.save();
    // over each shoulder
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * w * 0.72, -80);
      ctx.rotate(s * -0.16);
      sh.shadedPoly(ctx, [[-11, 3], [11, 3], [9, -12], [-9, -12]], c.base, c.dark, c.light, OUT, 3.0);
      // lace seam
      ctx.strokeStyle = c.dark; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-6, 1); ctx.lineTo(-4, -9);
      ctx.moveTo(0, 1); ctx.lineTo(0, -10);
      ctx.moveTo(6, 1); ctx.lineTo(4, -9);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---- screen door (held in front, world-local) ---- */
  PROPS.screen = (ctx, L, z, time, taken) => {
    const sh = P_();
    const c = L.prop.wood, m = L.prop.mesh;
    ctx.save();
    ctx.translate(-26, -60);
    ctx.rotate(-0.05 + (z.shieldWobble || 0) * 0.35);
    // frame
    sh.shadedPoly(ctx, [[-25, -46], [25, -46], [25, 46], [-25, 46]], c.base, c.dark, c.light, OUT, 3.4);
    // mesh window
    sh.shadedPoly(ctx, [[-18, -38], [18, -38], [18, 26], [-18, 26]], m.dark, m.deep, m.base, OUT, 2.4);
    ctx.save();
    ctx.beginPath(); ctx.rect(-18, -38, 36, 64); ctx.clip();
    ctx.strokeStyle = 'rgba(226,236,226,0.85)'; ctx.lineWidth = 1.0;
    for (let i = -20; i <= 20; i += 4) {
      ctx.beginPath(); ctx.moveTo(i, -40); ctx.lineTo(i + 3, 28); ctx.stroke();
    }
    for (let j = -40; j <= 28; j += 4) {
      ctx.beginPath(); ctx.moveTo(-20, j); ctx.lineTo(20, j + 1); ctx.stroke();
    }
    ctx.restore();
    // lower kick panel
    sh.shadedPoly(ctx, [[-20, 29], [20, 29], [20, 43], [-20, 43]], c.dark, c.deep, c.base, OUT, 2.6);
    sh.nail(ctx, -15, 36, 2.2); sh.nail(ctx, 15, 36, 2.2);
    // glass pane in the upper half
    sh.shadedPoly(ctx, [[-14, -34], [12, -34], [12, -12], [-14, -12]], 'rgba(200,232,226,0.55)', 'rgba(120,160,156,0.6)', 'rgba(255,255,255,0.6)', OUT, 2.2);
    // brass knob
    sh.shadedEll(ctx, 14, 34, 3.6, 4.2, '#e0b53c', '#8a6a10', '#ffe89a', OUT, 2.2);
    // damage: cracks + buckled frame grow with hits taken
    ctx.strokeStyle = '#2c2113'; ctx.lineCap = 'round';
    for (let i = 0; i < clamp(taken, 0, 5); i++) {
      const cy = -34 + i * 13;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-16, cy); ctx.lineTo(-6, cy + 4); ctx.lineTo(-10, cy + 9); ctx.lineTo(1, cy + 12);
      ctx.stroke();
    }
    if (taken >= 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-10, -30); ctx.lineTo(-2, -22); ctx.lineTo(-6, -14);
      ctx.moveTo(-2, -22); ctx.lineTo(6, -26);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ---- newspaper (held up in front of the face) ---- */
  PROPS.paper = (ctx, L, z, time, taken) => {
    const sh = P_();
    const c = L.prop.paper, ink = L.prop.ink;
    ctx.save();
    ctx.translate(-24, -78);
    ctx.rotate(-0.10 + Math.sin(time * 2.2 + z.seed) * 0.02);
    // two folded pages
    sh.shadedPoly(ctx, [[-26, -22], [24, -20], [26, 20], [-24, 22]], c.base, c.dark, c.light, OUT, 2.8);
    // masthead
    sh.poly(ctx, [[-20, -18], [16, -17], [16, -12], [-20, -13]], ink.base, null, 0);
    ctx.save(); ctx.globalAlpha = 0.55;
    ctx.font = "900 7px 'Trebuchet MS', sans-serif"; ctx.textAlign = 'center';
    ctx.fillStyle = c.light;
    ctx.fillText('BRAINS', -2, -13.4);
    ctx.restore();
    // columns of text
    ctx.strokeStyle = ink.base; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (let col = 0; col < 3; col++) {
      for (let r = 0; r < 7; r++) {
        const x = -19 + col * 13.5;
        const y = -8 + r * 4.1;
        ctx.moveTo(x, y); ctx.lineTo(x + 10.5, y);
      }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    // picture block
    sh.poly(ctx, [[-19, 10], [-8, 10], [-8, 18], [-19, 18]], ink.dark, null, 0);
    ctx.strokeStyle = ink.base; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let r = 0; r < 2; r++) { ctx.moveTo(-5, 12 + r * 4); ctx.lineTo(18, 12 + r * 4); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // torn/shredded as hits land
    const torn = clamp(taken, 0, 4);
    if (torn > 0) {
      sh.poly(ctx, [[24, 20], [26 - torn * 3, 20], [24, 20 - torn * 6]], 'rgba(0,0,0,0)', null, 0);
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(26, 22);
      for (let i = 0; i <= torn; i++) {
        ctx.lineTo(26 - i * 5, 22 - (i % 2 ? 9 : 3));
      }
      ctx.lineTo(26, -24); ctx.lineTo(30, -24); ctx.lineTo(30, 24); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---- vaulting pole (held across the chest, angled up) ---- */
  PROPS.pole = (ctx, L, z, time, taken) => {
    const sh = P_();
    const c = L.prop.pole;
    ctx.save();
    ctx.translate(-10, -70);
    ctx.rotate(-0.42);
    if (!z.__poleBroken) {
      sh.shadedPoly(ctx, [[-4, -52], [4, -52], [4, 74], [-4, 74]], c.base, c.dark, c.light, OUT, 2.6);
      // binding bands + tip
      sh.poly(ctx, [[-4.6, -40], [4.6, -40], [4.6, -34], [-4.6, -34]], '#c0392b', OUT, 1.6);
      sh.poly(ctx, [[-4.6, -14], [4.6, -14], [4.6, -8], [-4.6, -8]], '#c0392b', OUT, 1.6);
      sh.shadedEll(ctx, 0, -54, 4.4, 3.4, c.light, c.dark, '#ffffff', OUT, 2.0);
    } else {
      sh.shadedPoly(ctx, [[-4, -52], [4, -52], [4, -20], [-4, -20]], c.base, c.dark, c.light, OUT, 2.6);
      ctx.save(); ctx.rotate(0.5); ctx.translate(6, 10);
      sh.shadedPoly(ctx, [[-4, -20], [4, -20], [4, 40], [-4, 40]], c.base, c.dark, c.light, OUT, 2.6);
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---- pickaxe (carried low in front) ---- */
  PROPS.pick = (ctx, L, z, time) => {
    const sh = P_();
    const w = L.prop.wood, m = L.prop.pick;
    ctx.save();
    ctx.translate(-22, -62);
    ctx.rotate(0.5 + Math.sin(time * 1.6 + z.seed) * 0.03);
    // handle
    sh.shadedPoly(ctx, [[-3.4, -34], [3.4, -34], [3.4, 34], [-3.4, 34]], w.base, w.dark, w.light, OUT, 2.4);
    // steel head, both picks
    sh.shadedPoly(ctx, [[-34, -30], [-6, -34], [8, -30], [-6, -22], [-34, -20]], m.base, m.dark, m.light, OUT, 2.8);
    sh.shadedPoly(ctx, [[6, -33], [26, -40], [30, -34], [10, -26]], m.base, m.dark, m.light, OUT, 2.6);
    sh.nail(ctx, 0, -30, 2.2);
    ctx.restore();
  };

  /* ---- wave flag (raised in one hand) ---- */
  PROPS.flag = (ctx, L, z, time) => {
    const sh = P_();
    const c = L.prop.flag, p = L.prop.pole;
    ctx.save();
    ctx.translate(-8, -96);
    ctx.rotate(-0.16 + Math.sin(time * 2.0 + z.seed) * 0.04);
    // staff
    sh.shadedPoly(ctx, [[-3, -34], [3, -34], [3, 54], [-3, 54]], p.base, p.dark, p.light, OUT, 2.4);
    sh.shadedEll(ctx, 0, -36, 3.6, 3.2, p.light, p.dark, '#ffffff', OUT, 2.0);
    // banner
    const wave = Math.sin(time * 3 + z.seed) * 2.5;
    sh.shadedPoly(ctx, [[2, -32], [40, -28 + wave], [46, -6 + wave * 0.6], [40, 14 + wave], [2, 8]],
      c.base, c.dark, c.light, OUT, 2.8);
    // skull emblem
    ctx.save(); ctx.translate(23, -9 + wave * 0.7); ctx.scale(1.25, 1.25);
    sh.ell(ctx, 0, 0, 6.2, 5.6, L.prop.bone.base, OUT, 1.8);
    sh.ell(ctx, -2.2, -1.0, 1.7, 1.9, c.deep, null, 0);
    sh.ell(ctx, 2.2, -1.0, 1.7, 1.9, c.deep, null, 0);
    sh.poly(ctx, [[-3.2, 3.0], [3.2, 3.0], [0, 6.4]], c.deep, null, 0);
    sh.poly(ctx, [[-1.0, 5.6], [1.0, 5.6], [1.0, 8.4], [-1.0, 8.4]], L.prop.bone.base, null, 0);
    ctx.restore();
    // tattered edge
    ctx.restore();
  };

  /* ============================================================
     FIGURE
     ============================================================ */
  function drawFigure(ctx, L, z, time, A) {
    const sh = P_();
    const b = L.build;
    const bulk = b.bulk;
    const shoW = 21 * b.shoulder * bulk;
    const hipW = 13 * bulk;
    const legSc = b.legLen;
    const hipY = -56 * b.legLen;          // ankle lands on y=0 by construction
    const shoY = hipY - 32;
    const th = 32;                        // torso height (hip → shoulder)
    const armSc = 1.0;
    const legW = 7.4 * bulk;
    /* Figure scale. Zombies have to own their tile the way PopCap's do:
       a 100px column with a ~150px corpse in it, overlapping the lane.
       Everything below is authored in sprite px, so this is the single
       knob that sets how big a zombie reads on the board. */
    const FIG = 1.16;
    ctx.save();
    ctx.scale(FIG, FIG);

    // ---------- back arm ----------
    arm(ctx, -shoW * 0.52, shoY + 6, A.shB, A.elB, L.armBack, legW * 0.86, armSc, true,
      c => hand(c, legW * 0.95, L.armBack, 0.8));

    // ---------- back leg ----------
    leg(ctx, -hipW * 0.6, hipY, A.hipB, A.kneeB, A.kneeOutB, L.pants, L.shoeBack, legW, legSc, true);

    // ---------- torso + head (hinged at the pelvis) ----------
    ctx.save();
    /* The hunch pivots at MID-TORSO, not at the hips: that swings the head
       forward while the pelvis slides back, which is the PopCap lurch. A
       plain hip pivot just tilts the whole body like a plank. */
    const pivot = hipY - 16;
    ctx.translate(0, pivot);
    ctx.rotate(A.hunch + A.sway);
    ctx.translate(0, -pivot);
    torso(ctx, L, z, { shoW, hipW, hipY, shoY, th });
    // belt
    sh.poly(ctx, [[-hipW * 1.1, hipY - 5], [hipW * 1.1, hipY - 5], [hipW * 1.1, hipY + 1], [-hipW * 1.1, hipY + 1]],
      '#3a3128', OUT, 1.8);
    // neck
    sh.shadedPoly(ctx, [[-6.5, shoY + 2], [6.5, shoY + 2], [5, shoY - 11], [-5, shoY - 11]], L.skin.dark, L.skin.deep, L.skin.base, OUT, 2.2);

    // head group — headScale carries a global bump: the head has to read
    // as a third of the character, and outlines eat into it at this size
    const headY = shoY - 22;
    ctx.save();
    ctx.translate(0, headY);
    ctx.rotate(A.headTilt);
    const HS = b.headScale * 1.10;
    ctx.scale(HS, HS);
    head(ctx, L, z, time, A.jaw, 0);
    for (const pid of L.props) if (HEAD_PROPS[pid]) HEAD_PROPS[pid](ctx, L, z, time, A.dents || 0);
    ctx.restore();

    // shoulder pads ride on the torso
    if (L.props.includes('pads')) PROPS.pads(ctx, L, z, time);
    ctx.restore();

    // ---------- front leg ----------
    leg(ctx, hipW * 0.6, hipY, A.hipF, A.kneeF, A.kneeOutF, L.pants, L.shoeFront, legW, legSc, false);

    // ---------- front arm ----------
    arm(ctx, shoW * 0.52, shoY + 6, A.shF, A.elF, L.armFront, legW * 0.86, armSc, false,
      c => hand(c, legW * 0.95, L.armFront, 1.0));

    // ---------- held props (in front of everything) ----------
    const taken = A.taken || 0;
    for (const pid of L.props) if (BODY_PROPS[pid]) BODY_PROPS[pid](ctx, L, z, time, taken);
    ctx.restore();   // FIG
  }

  const HEAD_PROPS = { cone: PROPS.cone, bucket: PROPS.bucket, helmet: PROPS.helmet, hardhat: PROPS.hardhat, headband: PROPS.headband };
  const BODY_PROPS = { screen: PROPS.screen, paper: PROPS.paper, pole: PROPS.pole, pick: PROPS.pick, flag: PROPS.flag };

  /* ============================================================
     ANIMATION STATE
     ============================================================ */
  function animState(z, time, L) {
    const g = GAITS[L.gait] || GAITS.shamble;
    const b = L.build;
    const ph = z.walkPhase || 0;
    const pose = z.pose;
    /*
      Sign convention: in canvas, +y is DOWN, so rotating a limb that
      extends toward +y by a POSITIVE angle swings it toward -x — the
      direction zombies face. That makes positive arm/hip angles
      "forward" for free. The torso is the exception: its head sits at
      -y, so a forward hunch needs a NEGATIVE rotation. Hence -hunch.
    */
    const A = {
      hunch: -b.hunch - (g.lean || 0) * 0.5, sway: 0, hipF: -0.10, hipB: 0.13, kneeF: -0.22, kneeB: -0.14,
      kneeOutF: 0.06, kneeOutB: 0.05, shF: g.armBase, shB: g.armBaseB || g.armBase, elF: -0.34, elB: -0.20,
      headTilt: 0.04, jaw: 0.15, taken: 0,
    };
    const idle = Math.sin(time * 2.2 + z.seed * 5);

    if (pose === 'walk') {
      const k = g.spd;
      const s1 = Math.sin(ph * k), c1 = Math.cos(ph * k);
      A.hipF = s1 * g.step;
      A.hipB = -s1 * g.step;
      A.kneeF = -Math.max(0, -c1) * g.knee;
      A.kneeB = -Math.max(0, c1) * g.knee;
      A.kneeOutF = Math.max(0, s1) * 0.10;
      A.kneeOutB = Math.max(0, -s1) * 0.10;
      A.bob = -Math.abs(s1) * g.bob;
      A.sway = -(Math.sin(ph * k) * g.sway + idle * 0.012);
      A.shF = g.armBase + Math.sin(ph * k + Math.PI) * g.arm;
      A.shB = g.armBase + Math.sin(ph * k) * g.arm * 0.75;
      A.headTilt = Math.sin(ph * k * 2 + 0.6) * 0.055;
      A.jaw = 0.25 + Math.max(0, Math.sin(ph * k * 2)) * 0.45;
    } else if (pose === 'hold') {
      A.sway = -idle * 0.022;
      A.shF = g.armBase + Math.sin(time * 1.3 + z.seed) * 0.10;
      A.shB = g.armBase + Math.sin(time * 1.3 + z.seed + 1) * 0.09;
      A.headTilt = Math.sin(time * 0.9 + z.seed) * 0.06;
      A.jaw = 0.22 + Math.max(0, Math.sin(time * 1.7 + z.seed * 3)) * 0.4;
      A.bob = idle * 1.2;
    } else if (pose === 'kneel') {
      A.hunch = -(b.hunch + 0.42);
      A.hipF = 1.25; A.hipB = 1.45;
      A.kneeF = -1.5; A.kneeB = -1.6;
      A.kneeOutF = 0.5; A.kneeOutB = 0.55;
      A.shF = 0.35; A.shB = 0.55; A.elF = -0.9; A.elB = -0.7;
      A.headTilt = -0.34;
      A.jaw = 0.6;
      A.bob = 12;
    } else if (pose === 'die' || pose === 'glorydie') {
      A.shF = -0.5; A.shB = -0.3;
      A.jaw = 0.8;
    }
    return A;
  }

  /* ============================================================
     PUBLIC
     ============================================================ */
  function drawZombie(ctx, z, time) {
    const ZT = G.ZT;
    const L = ZT ? ZT.look(z.type, z.seed) : null;
    if (!L) return;

    // seeded personal detail (stable for the zombie's life)
    const h = n => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    L.hairStyle = Math.floor(h(z.seed + 1.1) * 3) % 3;
    L.hairCol = h(z.seed + 2.2) > 0.45 ? '#3b4030' : '#5d5240';
    L.teethSkip = h(z.seed + 3.3) > 0.62 ? Math.floor(h(z.seed + 4.4) * 4) : -1;
    L.eyeOffset = { x: (h(z.seed + 5.5) - 0.5) * 4, y: (h(z.seed + 6.6) - 0.5) * 5 };
    L.gaze = { x: (h(z.seed + 7.7) - 0.5) * 2, y: (h(z.seed + 8.8) - 0.5) * 2 };
    L.blinkPhase = (time * 0.37 + h(z.seed + 9.9)) % 1;
    L.rage = !!z.angry;

    // skin / wardrobe jitter so neighbours differ
    const tint = (col, f) => {
      const n = parseInt(col.slice(1), 16);
      let r = (n >> 16) & 255, g2 = (n >> 8) & 255, bb = n & 255;
      r = clamp(Math.round(r * f), 0, 255); g2 = clamp(Math.round(g2 * f), 0, 255); bb = clamp(Math.round(bb * f), 0, 255);
      return '#' + ((r << 16) | (g2 << 8) | bb).toString(16).padStart(6, '0');
    };
    const jf = L.grime;
    const jit = p => ({ base: tint(p.base, jf), dark: tint(p.dark, jf), light: tint(p.light, jf), deep: tint(p.deep, jf) });
    L.skin = jit(L.skin); L.suit = jit(L.suit); L.pants = jit(L.pants);
    L.armFront = { base: tint(L.suit.base, 1.08), dark: tint(L.suit.dark, 1.05), light: tint(L.suit.light, 1.06), deep: L.suit.deep };
    L.armBack = { base: tint(L.suit.base, 0.78), dark: tint(L.suit.dark, 0.72), light: tint(L.suit.light, 0.8), deep: L.suit.deep };
    // jacket sleeves vs bare arms — bare for the digger / runner
    const bare = (L.type.id === 'runner' || L.type.id === 'digger');
    if (bare) {
      L.armFront = { base: tint(L.skin.base, 1.06), dark: tint(L.skin.dark, 1.0), light: tint(L.skin.light, 1.04), deep: L.skin.deep };
      L.armBack = { base: tint(L.skin.base, 0.78), dark: tint(L.skin.dark, 0.74), light: tint(L.skin.light, 0.8), deep: L.skin.deep };
    }
    L.shirt = { base: '#cdc6ab', dark: '#8f8a73', light: '#efe9d4', deep: '#6d6a58' };
    if (L.type.id === 'runner' || L.type.id === 'brute') L.shirt = { base: '#f2efe0', dark: '#b0ac9a', light: '#ffffff', deep: '#8a8778' };
    L.tie = { base: '#8d3a34', dark: '#5c221e', light: '#b45a4e', deep: '#3d1614', stripe: '#d9d3bd' };
    L.shoeFront = { base: '#5a3d24', dark: '#33220f', light: '#7d5a37', deep: '#22160a', laces: '#c9b48c' };
    L.shoeBack = { base: '#422c19', dark: '#241708', light: '#5d4230', deep: '#180f06' };
    if (L.type.id === 'runner' || L.type.id === 'brute') {
      L.shoeFront = { base: '#e6e2d4', dark: '#9d9a8c', light: '#fffdf4', deep: '#6e6b5e', laces: '#c0392b' };
      L.shoeBack = { base: '#c8c4b6', dark: '#87847a', light: '#e9e6da', deep: '#5c5a51' };
    }
    L.prop = Object.assign({}, G.ZT.PROP, { bucketDent: G.ZT.METAL.dent });
    L.metal = G.ZT.METAL.bucket;
    L.build = Object.assign({}, L.build, { headScale: L.build.headScale });
    L.blood = (z.hp !== undefined && z.maxHp !== undefined && z.hp < z.maxHp) || z.state === 'kneel';

    const A = animState(z, time, L);
    A.dents = Math.min(z.dents || 0, 3);
    A.taken = clamp((L.type.frontArmor ? L.type.frontArmor.hits : 0) - (z.shieldHits || 0), 0, 5);

    ctx.save();

    /* ---- pose-level transform ---- */
    if (z.pose === 'die') {
      const t = clamp(z.dieT / 0.85, 0, 1);
      const e = t * t;
      ctx.translate(e * 16, e * 30);
      ctx.rotate(e * 1.35);
      ctx.globalAlpha = 1 - clamp((z.dieT - 0.95) / 0.55, 0, 1);
    } else if (z.pose === 'glorydie') {
      const t = z.dieT;
      ctx.rotate(Math.sin(t * 18) * 0.16 * clamp(1.3 - t, 0, 1));
      ctx.translate(0, -Math.sin(clamp(t / 0.5, 0, 1) * Math.PI) * 10);
      if (t > 0.45) { ctx.globalAlpha = clamp(1 - (t - 0.45) / 0.65, 0, 1); ctx.translate(0, -(t - 0.45) * 34); }
    }

    // breathing squash + gait bob
    const breath = Math.sin(time * 2.3 + z.seed * 7) * 0.026;
    ctx.translate(0, A.bob || 0);
    ctx.scale(1 + breath, 1 - breath);
    ctx.rotate(z.lean || 0);
    if (L.type.id === 'runner' && z.angry) ctx.rotate(0.06);

    if (L.isBoss && G.BossArt2D) {
      // The Don is a caricature, not a roster corpse: the shared rig would
      // flatten him into just another walker. He keeps every pose transform
      // this function already applied (walk bob, hunch, kneel, die) and only
      // swaps the body.
      G.BossArt2D.figure(ctx, L, z, time, A);
      ctx.restore();
      return;
    }

    drawFigure(ctx, L, z, time, A);
    ctx.restore();
  }

  G.ZArt2D = { drawZombie, GAITS, PROPS, animState };
  if (G.Sprites) G.Sprites.drawZombie = drawZombie;
})();

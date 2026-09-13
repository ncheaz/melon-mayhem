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
   MELON MAYHEM — boss_art2d.js
   The Don: a 2D caricature painter for the two boss types.

   Authored in the SAME space as zombie_art2d's drawFigure — feet at y=0,
   up is -y, sprite px — so the boss inherits every pose transform the
   zombie painter already applies (walk bob, hunch, kneel, die, glorydie).
   Only the BODY is different, and the body IS the joke:

     · no neck: the skull sits straight on the shoulders, jowls to the collar
     · a huge head (about a third of the figure) with a heavy-lidded squint,
       a small pursed mouth and one enormous golden swoop
     · barrel torso, a LONG bright red tie, tiny hands — caricature shorthand
     · headwear is PHASE STATE, not decoration: the cap and the rug are drawn
       only while they are attached, and an on-body marker points at whatever
       is currently vulnerable

   Nothing here decides anything. It reads z.magaOn / z.toupeeOn /
   z.toupeeHigh and draws what is true; every number lives in the roster.
   ============================================================ */
'use strict';
(function () {
  const TAU = Math.PI * 2;
  const OUT = '#2a1505';

  /* ---- paint kit ----
     Same trick as the zombie rig: the shared ramp puts the base tone at its
     midpoint, which is right for big props and wrong for a character whose
     area is mostly shadow at gameplay scale. Re-wrap, then re-stroke so the
     chunky outlined read survives the wash. `f` is a FLAT fill, for layers
     that must not be re-shaded (hair over hair, the tie, the cap). */
  let _K = null;
  function K() {
    if (_K) return _K;
    const p = G.Sprites._paint;
    const LIFT = 0.36;
    _K = Object.assign({}, p, {
      e(ctx, x, y, rx, ry, base, dark, light, stroke, lw, rot) {
        p.shadedEll(ctx, x, y, rx, ry, base, dark, light, stroke, lw, rot);
        ctx.save(); ctx.globalAlpha = LIFT;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
        ctx.fillStyle = base; ctx.fill(); ctx.restore();
        if (stroke) {
          ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
          ctx.strokeStyle = stroke; ctx.lineWidth = lw === undefined ? 3.5 : lw; ctx.stroke();
        }
      },
      p(ctx, pts, base, dark, light, stroke, lw) {
        p.shadedPoly(ctx, pts, base, dark, light, stroke, lw);
        ctx.save(); ctx.globalAlpha = LIFT;
        p.pathPoly(ctx, pts); ctx.fillStyle = base; ctx.fill(); ctx.restore();
        if (stroke) {
          p.pathPoly(ctx, pts);
          ctx.strokeStyle = stroke; ctx.lineWidth = lw === undefined ? 2.8 : lw;
          ctx.lineJoin = 'round'; ctx.stroke();
        }
      },
      f(ctx, pts, col, stroke, lw) {
        p.pathPoly(ctx, pts);
        ctx.fillStyle = col; ctx.fill();
        if (stroke) {
          p.pathPoly(ctx, pts);
          ctx.strokeStyle = stroke; ctx.lineWidth = lw === undefined ? 2.6 : lw;
          ctx.lineJoin = 'round'; ctx.stroke();
        }
      },
    });
    return _K;
  }

  /* ============================================================
     GEOMETRY — declared once, so the limbs and the body cannot drift
     apart. All values are sprite px in the authoring space.

     THE SAME TABLE THE 3D RIG USES (render3d buildBossModel), measured off
     the reference sticker: legs 27% of him, a belly 48% of his height ACROSS
     — wider than his shoulders — and a head about a quarter of him. Where the
     old build had the shoulders as the widest thing on the figure (shW 72 vs
     a 50-wide waist), the gut is now the silhouette and the shoulders sit
     INSIDE it.
     ============================================================ */
  const G0 = {
    hip: -64, sho: -166, neck: -168,
    headCX: -4, headCY: -26, headRX: 34, headRY: 32,   // head-local
    headS: 0.78,      // and the whole skull is drawn at this scale about its
                      // own centre: with the gut this wide, a full-size head
                      // made him read as a chunky man, not an egg with a head
                      // (reference: head+hair ≈ 45% of his widest)
    shW: 38,          // shoulder half-span — deliberately narrower than...
    bellyW: 66,       // ...the gut, which is the widest thing on him
    bellyY: -104,     // where the gut is at its widest
    bellyH: 47,       // and how tall that egg is
    armX: 42,         // the arms hang from INSIDE the gut's line...
    armSplay: 0.30,   // ...and mirror outward, so the ELBOWS are the widest point
    legW: 15,
  };

  /* ---------------- legs: short, thick, flared trousers, tiny shoes -------
     Two segments totalling 53px under a hip at -64, so the sole lands on 0
     with the figure's height untouched — the collision box (figCrown 240)
     still measures the same man from the feet up. ---------------- */
  function leg(ctx, k, x, y, hipA, kneeA, C, back) {
    const pal = C.pants;
    const B = back ? pal.dark : pal.base;
    const L = back ? pal.base : pal.light;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hipA);
    // trousers that FLARE into the hem: narrow at the seat, widest at the knee
    k.p(ctx, [[-G0.legW * 0.84, 3], [G0.legW * 0.84, 3], [G0.legW, 29], [-G0.legW, 29]], B, pal.deep, L, OUT, 3.2);
    ctx.translate(0, 29);
    ctx.rotate(kneeA);
    k.p(ctx, [[-G0.legW * 0.92, 0], [G0.legW * 0.92, 0], [G0.legW * 0.74, 24], [-G0.legW * 0.74, 24]], B, pal.deep, L, OUT, 3.2);
    ctx.strokeStyle = pal.deep; ctx.globalAlpha = 0.4; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(-5, 20); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.translate(0, 24);
    k.e(ctx, 0, 0, G0.legW * 0.78, G0.legW * 0.42, pal.dark, pal.deep, pal.base, OUT, 2.2);
    k.p(ctx, [[-11, -2], [10, -2], [12, 5], [10.5, 11], [-19, 11], [-20, 3]],
      C.shoes.base, C.shoes.deep, C.shoes.light, OUT, 3.2);
    k.f(ctx, [[-19.5, 8], [10.5, 8], [10, 12.5], [-19, 12.5]], C.shoes.deep, OUT, 1.6);
    ctx.restore();
  }

  /* ---------------- arms: all shoulder, then a hand too small ---------------- */
  function arm(ctx, k, x, y, shA, elA, C, w, back, z, time) {
    const B = back ? C.suit.dark : C.suit.base;
    const L = back ? C.suit.base : C.suit.light;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shA);
    k.e(ctx, 0, 0, w * 1.12, w * 1.06, B, C.suit.deep, L, OUT, 3);
    k.p(ctx, [[-w, 2], [w, 2], [w * 0.84, 34], [-w * 0.84, 34]], B, C.suit.deep, L, OUT, 3.2);
    ctx.translate(0, 34);
    ctx.rotate(elA);
    k.p(ctx, [[-w * 0.8, 0], [w * 0.8, 0], [w * 0.68, 30], [-w * 0.68, 30]],
      back ? C.suit.dark : C.suit.base, C.suit.deep, L, OUT, 3);
    k.e(ctx, 0, 30, w * 0.78, w * 0.42, C.shirt.base, C.shirt.dark, C.shirt.light, OUT, 2.2);
    ctx.translate(0, 32);
    const wob = Math.sin(time * 2.1 + z.seed + (back ? 1.4 : 0)) * 0.08;
    ctx.rotate((back ? 0.16 : -0.12) + wob);
    // the hand. It is small. That is the joke, and the silhouette.
    k.e(ctx, 0, 4, w * 0.62, w * 0.78, C.skin.base, C.skin.dark, C.skin.light, OUT, 2.6);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate((i - 1) * w * 0.36, w * 0.8);
      ctx.rotate((i - 1) * 0.2);
      k.p(ctx, [[-w * 0.16, 0], [w * 0.16, 0], [w * 0.13, w * 0.54], [-w * 0.13, w * 0.54]],
        C.skin.base, C.skin.dark, C.skin.light, OUT, 2.2);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ============================================================
     HEAD — local origin on the NECK LINE, face toward -x
     ============================================================ */
  function head(ctx, k, L, z, time) {
    const C = L.bossPal;
    const cx = G0.headCX, cy = G0.headCY;
    const RX = G0.headRX, RY = G0.headRY;
    /* Everything the skull wears is drawn at headS, about the head's own
       centre, so the head can be re-proportioned against the body WITHOUT
       re-authoring the face. The target marker below stays unscaled: it is a
       HUD hint and has to stay legible. */
    const hs = G0.headS === undefined ? 1 : G0.headS;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(hs, hs); ctx.translate(-cx, -cy);

    // ---- jaw + jowls: wide and heavy. First, so the cranium overlaps it
    //      and the jowl line stays the front edge of the face.
    k.p(ctx, [
      [cx - RX + 3, cy - 2],
      [cx - RX + 1, cy + RY - 6],
      [cx - 17, cy + RY + 9],
      [cx + 8, cy + RY + 8],
      [cx + RX - 4, cy + RY - 8],
      [cx + RX - 1, cy - 4],
    ], C.skin.base, C.skinD.dark, C.skin.light, OUT, 3.4);

    // ---- cranium
    k.p(ctx, [
      [cx - RX + 2, cy + 4],
      [cx - RX + 3, cy - RY + 12],
      [cx - 16, cy - RY],
      [cx + 12, cy - RY + 1],
      [cx + RX, cy - RY + 14],
      [cx + RX - 1, cy + 6],
      [cx + RX - 4, cy - 2],
      [cx - RX + 1, cy - 2],
    ], C.skin.base, C.skinD.dark, C.skin.light, OUT, 3.4);

    // far-side cheek shading
    ctx.save(); ctx.globalAlpha = 0.20;
    ctx.fillStyle = C.skinD.dark;
    ctx.beginPath(); ctx.ellipse(cx + 20, cy + 2, 13, 18, 0.3, 0, TAU); ctx.fill();
    ctx.restore();

    // ---- brow ridge: heavy, angled down toward the nose
    ctx.save();
    ctx.translate(cx - 14, cy - 15);
    ctx.rotate(-0.10);
    k.p(ctx, [[-18, 0], [20, 0], [19, -7], [-17, -6]], C.skinD.base, C.skinD.deep, C.skin.light, OUT, 2.6);
    ctx.restore();

    // ---- eyes: narrow and suspicious, but the WHITES have to read, so the
    //      outline is thin and the lid is a single dark line, not a second
    //      ellipse (a stack of outlined ellipses reads as one black bar).
    //      Each eye sits in a PALE PATCH — a panda mask, but cream on the
    //      orange — and in the dizzy state the eyes squeeze SHUT in one
    //      long, exaggerated blink every few seconds.
    const diz = (z.dizzy || 0);
    const shut = diz > 0.03 && G.DONDIZZY && G.DONDIZZY.blink(time) > 0.5;
    for (const [ex, ey, sc] of [[-22, -9, 1.0], [-1, -6.5, 0.88]]) {
      const px = cx + ex, py = cy + ey;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = '#f7ead2';
      ctx.beginPath(); ctx.ellipse(px + 0.5, py + 1.2, 13.5 * sc, 9.5 * sc, -0.08, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#c98a4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(px + 0.5, py + 1.2, 13.5 * sc, 9.5 * sc, -0.08, 0, TAU); ctx.stroke();
      ctx.restore();
      if (shut) {
        // THE DIZZY BLINK: a heavy shut-lid arc plus the squeeze crease
        // under it — the whole face briefly done with everything
        ctx.strokeStyle = OUT; ctx.lineWidth = 3.2 * sc; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px - 8.5 * sc, py - 1.5 * sc);
        ctx.quadraticCurveTo(px, py + 4.5 * sc, px + 8.5 * sc, py - 1 * sc);
        ctx.stroke();
        ctx.strokeStyle = '#8a4a1e'; ctx.lineWidth = 1.8 * sc; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(px, py + 3 * sc, 7 * sc, 0.35, 2.75); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      k.e(ctx, px, py, 9 * sc, 5.6 * sc, '#fbf8ee', '#cfc8b4', '#ffffff', OUT, 1.8);
      k.e(ctx, px - 2.4 * sc, py + 0.2, 3 * sc, 3.2 * sc, '#3d2c18', '#20150a', '#6a553a', OUT, 1.2);
      // a highlight in the eye — one dot, and the whole face gains a soul
      ctx.save();
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(px + 0.4 * sc, py - 1.6 * sc, 1.5 * sc, 0, TAU); ctx.fill();
      ctx.restore();
      // upper lid: one heavy line, tilted down toward the nose
      ctx.strokeStyle = OUT; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px - 9 * sc, py - 4.6 * sc);
      ctx.quadraticCurveTo(px, py - 6.6 * sc, px + 9 * sc, py - 4.2 * sc);
      ctx.stroke();
      // eye bag
      ctx.strokeStyle = C.skinD.dark; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(px, py + 1.4, 8.6 * sc, 0.55, 2.6); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- nose: a soft wedge on the front of the face. Drawn AFTER the eyes
    //      so its outline cuts the cheek and the face gets a front plane.
    k.p(ctx, [
      [cx - 32, cy + 3],
      [cx - 25, cy - 9],
      [cx - 17, cy - 6],
      [cx - 20, cy + 6],
      [cx - 28, cy + 11],
    ], C.skin.light, C.skinD.dark, '#ffe0b0', OUT, 2.6);

    // ---- mouth: small, pursed, unimpressed. Opens on death.
    const open = (z.state === 'die' || z.state === 'glorydie') ? 1 : 0.25;
    k.e(ctx, cx - 19, cy + 17, 9, 2.8 + open * 3.6, '#7c3a34', '#4c1c18', '#b06a5e', OUT, 2.4);
    // the upper lip line, dragged down at the corner
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 29, cy + 13.5);
    ctx.quadraticCurveTo(cx - 19, cy + 12, cx - 9, cy + 15);
    ctx.stroke();
    // jowl crease
    ctx.strokeStyle = C.skinD.dark; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy + 12);
    ctx.quadraticCurveTo(cx + 2, cy + 26, cx - 14, cy + 24);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // ear
    k.e(ctx, cx + RX - 4, cy + 2, 5.5, 8.5, C.skin.base, C.skinD.dark, C.skin.light, OUT, 2.4);

    /* ---------------- the rug (phase 2 weak point) ---------------- */
    if (z.toupeeOn) {
      const hot = !z.magaOn;
      if (hot) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 5.2);
        ctx.save();
        ctx.globalAlpha = 0.20 + 0.28 * pulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath(); ctx.ellipse(cx, cy - RY + 4, 40, 26, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // the mass: a swept dome sitting ON the skull, wider than the crown.
      // BASE gold for the mass and LIGHT for the swept layer — an earlier pass
      // had them the other way round and the rug read as an olive beret.
      k.f(ctx, [
        [cx - RX - 4, cy - 6],
        [cx - RX - 8, cy - RY - 2],
        [cx - 18, cy - RY - 12],
        [cx + 8, cy - RY - 13],
        [cx + RX + 3, cy - RY + 2],
        [cx + RX + 2, cy - 10],
        [cx + 18, cy - 16],
        [cx - 12, cy - 18],
        [cx - RX - 2, cy - 12],
      ], '#dcb84a', OUT, 3.2);
      k.f(ctx, [
        [cx - RX - 2, cy - 12],
        [cx - RX - 6, cy - RY - 1],
        [cx - 18, cy - RY - 10],
        [cx + 6, cy - RY - 10],
        [cx + 14, cy - RY + 2],
        [cx + 2, cy - 16],
        [cx - 16, cy - 19],
      ], C.hair.base, OUT, 2.8);
      // the swept shine along the top of the mass
      k.f(ctx, [
        [cx - RX + 2, cy - RY - 6],
        [cx - 20, cy - RY - 8],
        [cx - 2, cy - RY - 6],
        [cx + 10, cy - RY + 1],
        [cx + 6, cy - RY + 2],
      ], C.hair.light, '#c9a437', 1.6);
      // the POMPADOUR: the lift rises OFF the brow — a rounded quiff standing
      // proud of the mass, not a flat fringe. Trump's silhouette IS the height
      // of the hair above the forehead.
      k.f(ctx, [
        [cx - RX - 2, cy - 12],
        [cx - RX - 12, cy - RY - 14],
        [cx - 20, cy - RY - 30],
        [cx + 2, cy - RY - 27],
        [cx + 12, cy - RY - 12],
        [cx - RX + 4, cy - RY - 2],
      ], C.hair.base, OUT, 3);
      k.f(ctx, [
        [cx - RX - 9, cy - RY - 13],
        [cx - 17, cy - RY - 27],
        [cx - 2, cy - RY - 25],
        [cx + 3, cy - RY - 14],
      ], C.hair.light, '#c9a437', 2);
      // the HAIRLINE, not a strap. A single dark diagonal across the front of
      // the crown read as a bandana; what sells a comb-over is the edge where
      // the hair stops — an arc that dips at the temples — plus a short part
      // line at the back and strands that run WITH the swoop.
      ctx.strokeStyle = '#a8862a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - RX - 6, cy - 13);
      ctx.quadraticCurveTo(cx - 12, cy - 24, cx + RX - 2, cy - 17);
      ctx.stroke();
      // temple notch
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx - RX - 6, cy - 13); ctx.lineTo(cx - RX - 3, cy - 5);
      ctx.stroke();
      // part
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx + 14, cy - RY - 6); ctx.lineTo(cx + 2, cy - RY - 11);
      ctx.stroke();
      // comb strands
      ctx.strokeStyle = '#d8b64a'; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 14 + i * 4, cy - 18 - i * 1.6);
        ctx.quadraticCurveTo(cx + 10, cy - RY - 6 - i * 2.4, cx + RX - 2, cy - 16 - i * 1.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // hits already taken show as partings in the rug — spaced to fit the
      // rug for ANY roster depth (12 today), not marched off the skull
      const rugTotal = (z.spec && z.spec.boss) ? z.spec.boss.toupeeHigh : 3;
      const step = Math.min(20, 54 / Math.max(1, rugTotal - 1));
      for (let i = 0; i < (z.toupeeHigh || 0); i++) {
        const gx = cx - 24 + i * step;
        const dip = cy - 16 - (i % 2) * 3;
        ctx.strokeStyle = '#8c6a1c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(gx, cy - RY - 9); ctx.lineTo(gx + 6, dip); ctx.stroke();
      }
    } else {
      // bald: a shiny orange crown with three defiant wisps
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#fff3d0';
      ctx.beginPath(); ctx.ellipse(cx - 18, cy - RY + 9, 11, 6, -0.35, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = C.hair.base; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const [x0, dx2] of [[-16, 7], [-4, 9], [9, 6]]) {
        ctx.beginPath();
        ctx.moveTo(cx + x0, cy - RY + 6);
        ctx.quadraticCurveTo(cx + x0 + dx2 * 0.4, cy - RY - 4, cx + x0 + dx2, cy - RY - 1);
        ctx.stroke();
      }
    }

    /* ---------------- the cap (phase 1, final boss / stage 5 only) ---------------- */
    if (z.magaOn) {
      const topY = cy - RY - 13;      // sits on the rug's crest
      k.f(ctx, [
        [cx - RX - 2, cy - 14],
        [cx - RX - 4, topY + 4],
        [cx - 16, topY - 8],
        [cx + 10, topY - 8],
        [cx + RX + 1, topY + 8],
        [cx + RX + 1, cy - 16],
        [cx + 12, cy - 22],
        [cx - 14, cy - 22],
      ], C.hat.base, OUT, 3.2);
      k.f(ctx, [
        [cx + 12, cy - 22],
        [cx + RX + 1, cy - 16],
        [cx + RX + 1, topY + 8],
        [cx + 10, topY - 8],
      ], C.hat.dark, OUT, 2.4);
      ctx.strokeStyle = C.hat.deep; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.8;
      for (const dx2 of [-18, -2, 14]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx2, topY - 6);
        ctx.lineTo(cx + dx2 + 6, cy - 22);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // brim, jutting forward over the brow
      k.f(ctx, [
        [cx - RX - 2, cy - 16],
        [cx - RX - 22, cy - 14],
        [cx - RX - 23, cy - 7],
        [cx - RX + 1, cy - 9],
      ], C.hat.dark, OUT, 3);
      ctx.save();
      ctx.translate(cx - 2, topY + 2);
      ctx.rotate(-0.14);
      G.outlinedText(ctx, 'MAGA', 0, 0, 17, '#ffffff', 'center', C.hat.deep, 4);
      ctx.restore();
      k.e(ctx, cx + 2, topY - 8, 3, 2.6, C.hat.light, C.hat.base, '#ffffff', OUT, 1.8);
    }

    ctx.restore();          // head scale

    /* ---------------- on-body target marker ----------------
       The fight's "hit here" hint. It stands down for the eulogy — the
       don-fall ceremony passes noMarker, because nobody needs targetting
       advice about a man who is mid-ramble. */
    if (!z.noMarker) {
      const phase = z.magaOn ? 'CAP' : z.toupeeOn ? 'RUG' : 'BODY';
      const mcol = phase === 'CAP' ? '#ff8080' : phase === 'RUG' ? '#b9ff2e' : '#ff9e3d';
      const pulse2 = 0.62 + 0.38 * Math.sin(time * 4.4);
      const my = cy - RY - (z.magaOn ? 46 : 32);
      ctx.save();
      ctx.globalAlpha = pulse2;
      ctx.strokeStyle = mcol; ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx - 9, my - 13); ctx.lineTo(cx, my); ctx.lineTo(cx + 9, my - 13);
      ctx.stroke();
      G.outlinedText(ctx, phase === 'RUG' ? 'RUG · HIGH ARC' : phase, cx, my - 26, 15, mcol, 'center', OUT, 4);
      ctx.restore();
    }
  }

  /* ============================================================
     IDLE LIFE — accordion hands & the YMCA
     Driven by z.idleKind / z.idleT (set by the boss's life loop in
     game.js) and layered over whatever pose angles A the gait handed
     in — the boss only does these bits while parked, and a hit cancels
     them. Angle convention: 0 = arm hangs straight down, positive
     rotation swings the limb toward the face (-x), |angle| near π
     points it up.
     ============================================================ */
  function idleArms(A, z, time) {
    if (z.gripeK > 0.02) {
      // the HOWL: both arms flung up, hands splayed, head thrown back —
      // the loss of dignity is SHOWN by the body, not just said in a bubble
      const k = Math.min(1, z.gripeK * 1.6);
      const shake = Math.sin(time * 27) * 0.09 * k;
      A.shB = (2.62 + shake) * k + (1 - k) * A.shB;
      A.elB = 0.55 * k + (1 - k) * A.elB;
      A.shF = (-2.72 - shake) * k + (1 - k) * A.shF;
      A.elF = 0.5 * k + (1 - k) * A.elF;
      A.headTilt = (A.headTilt || 0) - 0.3 * k;
      A.sway = (A.sway || 0) + shake * 0.5;
      return A;
    }
    if (z.idleKind === 'accordion') {
      // hands clasped low in front, pumping apart and together like a
      // squeeze-box — big, read-it-from-the-back-row pumps, head nodding
      const pump = Math.sin(z.idleT * 8.5);
      A.shB = 1.18 + pump * 0.22; A.elB = 1.7 + pump * 0.85;
      A.shF = 1.7 - pump * 0.22; A.elF = 1.5 - pump * 0.8;
      A.sway = (A.sway || 0) + pump * 0.04;
      A.headTilt = (A.headTilt || 0) + pump * 0.09;
    } else if (z.idleKind === 'ymca') {
      // four WIDE letters on a beat: Y — high V · M — hands at the hat ·
      // C — both arms swept hard to one side · A — dome overhead
      const letter = Math.floor(z.idleT / 0.85) % 4;
      const bop = Math.sin(z.idleT * 10) * 0.09;
      if (letter === 0) { A.shB = 2.72 + bop; A.elB = 0.1; A.shF = -2.78 - bop; A.elF = 0.1; }
      else if (letter === 1) { A.shB = 3.0 + bop; A.elB = 1.5; A.shF = -3.0 - bop; A.elF = 1.5; }
      else if (letter === 2) { A.shB = 1.9; A.elB = 0.75 + bop; A.shF = 2.75; A.elF = 0.55; }
      else { A.shB = 3.05 + bop; A.elB = 0.3; A.shF = -3.05 - bop; A.elF = 0.3; }
      A.sway = (A.sway || 0) + bop * 0.7;
      A.headTilt = (A.headTilt || 0) + bop * 0.8;
    }
    return A;
  }

  /* ============================================================
     FIGURE
     ============================================================ */
  function figure(ctx, L, z, time, A) {
    const k = K();
    const C = L.bossPal;
    const sh = G0.shW;
    const hipY = G0.hip, shoY = G0.sho;
    const breath = Math.sin(time * 1.55 + z.seed) * 0.02;

    // the idle bits own the arms while he is parked; the gripe howl owns
    // them while he is melting down (a hit cancels the bit, never the howl)
    if ((z.idleKind || z.gripeK > 0.02) && z.state === 'hold') idleArms(A, z, time);
    else if (!z.jumpT || z.jumpT >= 1) {
      /* The Don does not shamble with one arm out: he is drawn FRONT-ON, so his
         arms simply MIRROR outward and the gut stays the silhouette. (The
         walkers' asymmetric reach — armBase 0.28 vs armBaseB 0.72 — is their
         own gag.) Only the base is remapped, so the gait's swing survives. */
      A.shF = 0 + (A.shF - 0.28);
      A.shB = 0 + (A.shB - 0.72);
    }
    // the lane jump: legs tucked, arms out for balance, torso tipped back —
    // a standing pose lifted 150px reads as standing; a TUCK reads as a leap
    if (z.jumpT < 1) {
      const k = Math.sin(Math.min(1, z.jumpT) * Math.PI);
      A.hipB = 0.85 * k; A.kneeB = 1.5 * k;
      A.hipF = 0.55 * k; A.kneeF = 1.2 * k;
      A.shB = -0.95 * k; A.shF = 0.95 * k;
      A.elB = 0.3; A.elF = 0.3;
      A.sway = (A.sway || 0) - 0.06 * k;
    }

    ctx.save();

    // ---- back arm / back leg. The arms hang OUTSIDE the gut so they read
    //      pressed against it, splayed a touch outward (see armSplay) so the
    //      elbow line is wider than the shoulder line, and the hand stops
    //      level with the shorts.
    arm(ctx, k, -G0.armX, shoY + 12, A.shB + 0.05 + G0.armSplay, A.elB * 0.5, C, 15, true, z, time);
    leg(ctx, k, -16, hipY, A.hipB, A.kneeB, C, true);

    // ---- torso, hinged at mid-belly so the mass swings instead of tilting
    ctx.save();
    const pivot = hipY - 26;
    ctx.translate(0, pivot);
    ctx.rotate(A.hunch + A.sway);
    ctx.translate(0, -pivot);
    ctx.save();
    ctx.scale(1 + breath, 1 - breath);

    /* THE GUT IS THE SILHOUETTE — built the way the 3D rig builds it: a
       shoulder yoke that stays INSIDE the belly's line, and one big egg
       underneath it that is the widest thing on him and hangs over the
       waistband. The yoke is drawn first and the gut over it, so the seam
       between them is swallowed instead of ruled across his middle. If the
       chest ever out-widens the gut the whole caricature collapses back into
       a slab-shaped generic boss (which is exactly what it did before). */
    const bw = G0.bellyW, by = G0.bellyY, bh = G0.bellyH;
    // hips, mostly hidden — the gut overhangs them completely
    k.f(ctx, [[-46, hipY - 14], [44, hipY - 14], [40, hipY + 10], [-42, hipY + 10]], C.suitD.base, OUT, 3);
    // shoulder yoke
    k.p(ctx, [
      [sh, shoY + 2],
      [sh + 16, shoY + 44],
      [-sh - 10, shoY + 44],
      [-sh + 2, shoY + 2],
    ], C.suit.base, C.suit.dark, C.suit.light, OUT, 3.6);
    // THE GUT
    k.e(ctx, -12, by, bw, bh, C.suit.base, C.suit.dark, C.suit.light, OUT, 3.8);
    // the jacket hem, riding up the slope of it
    k.f(ctx, [
      [-bw + 22, by + 26], [bw - 26, by + 26], [bw - 32, by + 44], [-bw + 16, by + 44],
    ], C.suitD.base, OUT, 3);

    // open jacket: a LONG shirt V, its lapels just outside it
    k.f(ctx, [
      [24, shoY + 6],
      [13, hipY + 2],
      [-15, hipY + 2],
      [-26, shoY + 6],
    ], C.shirt.base, OUT, 3);
    for (const s of [1, -1]) {
      k.f(ctx, [
        [s * 31, shoY + 2],
        [s * 22, shoY + 34],
        [s * 14, hipY + 2],
        [s * 28, shoY + 20],
      ], C.suitD.base, OUT, 2.6);
    }
    // collar
    k.f(ctx, [[-26, shoY + 4], [26, shoY + 4], [18, shoY - 8], [-18, shoY - 8]], C.shirt.base, OUT, 2.8);
    // THE TIE: long, wide and bright — the strongest accent on the figure
    k.f(ctx, [[-12, shoY - 4], [10, shoY - 4], [7, shoY + 12], [-9, shoY + 12]], C.tie.dark, OUT, 2.6);
    k.f(ctx, [[-9, shoY + 10], [7, shoY + 10], [4, hipY + 10], [-6, hipY + 16]], C.tie.base, OUT, 2.8);
    ctx.save(); ctx.globalAlpha = 0.35;
    ctx.fillStyle = C.tie.dark;
    ctx.beginPath(); ctx.ellipse(0, shoY + 18, 2.6, 16, 0.06, 0, TAU); ctx.fill();
    ctx.restore();

    // battle damage: one scratch per three clean hits taken
    const marks = Math.floor((z.bodyHits || 0) / 3);
    if (marks > 0) {
      ctx.strokeStyle = '#8e2b2b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < Math.min(4, marks); i++) {
        const mx = -14 + i * 10, my2 = shoY + 44 + (i % 2) * 14;
        ctx.beginPath();
        ctx.moveTo(mx - 7, my2 - 5); ctx.lineTo(mx + 7, my2 + 5);
        ctx.moveTo(mx + 5, my2 - 6); ctx.lineTo(mx - 5, my2 + 6);
        ctx.stroke();
      }
    }

    // ---- head: no neck. The skull is translated to the neck line and rotated
    //      a little with the body so the jowls never detach from the collar.
    //      In the dizzy state the head also shakes in ERRATIC GUSTS on top of
    //      whatever tilt the pose already handed in.
    ctx.save();
    ctx.translate(0, G0.neck);
    const dshake = (z.dizzy && G.DONDIZZY) ? G.DONDIZZY.head(time) * 0.26 * z.dizzy : 0;
    ctx.rotate(A.headTilt * 0.5 + dshake);
    head(ctx, k, L, z, time);
    ctx.restore();

    ctx.restore();          // breath
    ctx.restore();          // torso hinge

    // ---- front leg / front arm
    leg(ctx, k, 16, hipY, A.hipF, A.kneeF, C, false);
    arm(ctx, k, G0.armX, shoY + 12, A.shF - G0.armSplay, A.elF * 0.6, C, 15, false, z, time);

    ctx.restore();
  }

  G.BossArt2D = { figure, head };
})();

/* ============================================================
   MELON MAYHEM — zombie_types.js
   Single source of truth for the zombie roster: stats, palettes,
   proportions, props and gait. The 2D sprite painter (sprites.js)
   and the 3D mesh builder (render3d.js) BOTH read this table, so
   the two render paths stay identical in design, colour and
   silhouette. Adding a zombie = adding one row here.

   Art direction: PopCap's Plants vs. Zombies cast, rebuilt as
   polygon/vector art. Big soft cranium, oversized blank eyes,
   wide underbite grin, hunched shamble, prop that owns the
   silhouette (cone, bucket, screen door, newspaper, football
   helmet, flag, pickaxe).
   ============================================================ */
'use strict';
(function () {
  const C = (base, dark, light, deep) => ({ base, dark, light, deep: deep || dark });

  /* ---------------- skin: the sickly pea-green family ----------------
     Values are pitched BRIGHT: at gameplay scale the outline and the
     shadow band eat most of the apparent value, so the base tone has to
     carry the hue on its own. */
  const SKINS = {
    pea:    C('#bcd888', '#8ea662', '#e8fab6', '#5c6b3c'),
    sage:   C('#b0c79a', '#84976f', '#e0f4c8', '#546247'),
    olive:  C('#acc06f', '#7f8e4c', '#dfee9e', '#4e582c'),
    clay:   C('#cdc18f', '#9d9063', '#f6eaba', '#6b613c'),
    mint:   C('#b6d6ab', '#88a87c', '#e4f8da', '#587a51'),
    ash:    C('#b6c1b4', '#859084', '#e4eee2', '#556057'),
    brine:  C('#a2c4b5', '#789a8a', '#d4f0e3', '#4b6a5c'),
    straw:  C('#d3cd9c', '#a29a6d', '#faf4c6', '#706946'),
  };

  /* ---------------- clothing ---------------- */
  const CLOTH = {
    suit:    C('#7d5a3c', '#4a3122', '#a8814f', '#382416'),  // worn brown jacket
    suitB:   C('#5f5f56', '#35352f', '#87877c', '#26261f'),  // grey porter jacket
    jersey:  C('#c8453c', '#8a2622', '#ef7a63', '#63201c'),  // football red
    polo:    C('#3f7ea6', '#255070', '#79b3d4', '#1b3a52'),  // sports polo
    flannel: C('#b8402f', '#7a2418', '#dd7a5e', '#571a10'),  // digger plaid
    rags:    C('#6b6f5f', '#3d4036', '#959a86', '#2c2f27'),
    vest:    C('#33455e', '#1d2838', '#5b7191', '#141c28'),
    lab:     C('#d9d6c6', '#a29e8b', '#f6f4ea', '#7c7867'),
  };
  const PANTS = {
    denim: C('#3f4d68', '#222c40', '#6d80a0', '#18202f'),
    slate: C('#5a6272', '#333a46', '#8b94a6', '#242a34'),
    dark:  C('#3a3a44', '#20202a', '#5c5c6c', '#161620'),
    khaki: C('#6e6248', '#443c2a', '#9c8d6b', '#312b1e'),
    pad:   C('#d5d0bf', '#9c9683', '#f2eee1', '#787263'),
  };
  const METAL = {
    bucket: C('#b6bfc8', '#7c858e', '#e2e9ef', '#5a626a'),
    dent:   C('#98a1aa', '#666e76', '#c2cad2', '#4a5259'),
    steel:  C('#7e8792', '#4e555e', '#aab3bd', '#363c44'),
    chrome: C('#c9d2da', '#8d959d', '#f0f4f8', '#666d75'),
  };

  /* ---------------- boss palette ----------------
     ONE face, ONE suit, ONE hairpiece. The Don is a caricature, not a
     crowd: no seeded variants, no grime, no wardrobe roll. Orange skin,
     a swooping blonde rug, and (stage 5, the final boss only) a red cap. */
  const BOSS = {
    skin:  C('#e79a52', '#ad6a2c', '#ffc684', '#84491a'),
    skinD: C('#d2833d', '#9a5a24', '#f3ae6c', '#753f16'),
    hair:  C('#f0d071', '#c19f36', '#fff2ad', '#96791f'),
    suit:  C('#2b3a60', '#16233d', '#42588a', '#0e1730'),
    suitD: C('#1e2a49', '#101a2e', '#33456d', '#0a1122'),
    shirt: C('#f4f2e6', '#c6c3b3', '#ffffff', '#9e9c8e'),
    tie:   C('#c0272d', '#7e1216', '#e8565a', '#5c0b0e'),
    hat:   C('#c62828', '#8c1414', '#ea5a52', '#6b0d0d'),
    pants: C('#26314f', '#141c33', '#3f5177', '#0c1221'),
    shoes: C('#3a2a1c', '#1f150c', '#5c452e', '#120c06'),
  };

  /* ---------------- prop palette ---------------- */
  const PROP = {
    cone:     C('#e8752a', '#a94a12', '#ffa759', '#7d3409'),  // traffic cone
    coneBand: C('#f2f0e6', '#b8b4a4', '#ffffff', '#8e8a7c'),
    wood:     C('#a8763f', '#6a4622', '#d3a061', '#4c3117'),
    woodDark: C('#7d5629', '#4b3216', '#a8804b', '#331f0c'),
    mesh:     C('#8f978f', '#5e665e', '#c2cac2', '#434943'),
    paper:    C('#e8e4d3', '#b0aa96', '#fffdf2', '#8b8574'),
    ink:      C('#4a4741', '#2b2924', '#767268', '#1b1a16'),
    flag:     C('#c0392b', '#7f2018', '#e8654f', '#5c1410'),
    pole:     C('#c9cfd6', '#8b939b', '#f0f4f8', '#676e75'),
    helmet:   C('#cf3b31', '#8d1f18', '#f4746a', '#66130d'),
    pad:      C('#e2ddcd', '#a8a292', '#fbf8ef', '#827c6b'),
    pick:     C('#9aa3ac', '#666e76', '#ced6de', '#464c53'),
    lamp:     C('#f6e06a', '#bfa423', '#fff6b8', '#8f7a15'),
    blood:    C('#8e2b2b', '#5a1616', '#c05050', '#3d0e0e'),
    bone:     C('#ece8d6', '#b6b19c', '#fffdf4', '#8e8a78'),
    eye:      C('#f4f2e6', '#cdc9b8', '#ffffff', '#a8a496'),
    pupil:    C('#241f1a', '#141110', '#453d34', '#0c0a09'),
  };

  /* ============================================================
     THE ROSTER
     ── stats ──
       hp      body hits to kill (matches the damage table)
       speed   seconds per grid column at difficulty 1
     ── armour ──
       headArmor  { kind, label, hits }  knocked off by a head hit
       frontArmor { kind, label, hits }  absorbs frontal hits
       rage       behaviour once frontArmor breaks (newspaper)
     ── look ──
       skins/suits/pants  candidate palettes (seeded per zombie so a
                          wave is a crowd, not a clone army)
       props      ordered prop ids; both renderers have a painter
                  registry keyed by the same ids
       build      proportion overrides (hunch lean, head scale, limb
                  length, bulk) consumed by both render paths
       gait       named walk style (drives 2D & 3D animation)
     ============================================================ */
  const LIST = {
    /* ---------- 1. the baseline corpse ---------- */
    shambler: {
      id: 'shambler', label: 'Basic Zombie', tier: 1,
      hp: 5, speed: 0.45, scale: 1.0, weight: 10, fromStage: 0,
      skins: ['pea', 'sage', 'olive'], suits: ['suit', 'suitB'], pants: ['denim', 'slate'],
      props: ['tie'],
      build: { hunch: 0.11, headScale: 1.0, bulk: 1.0, legLen: 1.0, armReach: 1.0, shoulder: 1.0 },
      gait: 'shamble',
      blurb: 'Brown suit, striped tie, no plan.',
    },

    /* ---------- 2. cone: cheap head armour, reads instantly ---------- */
    conehead: {
      id: 'conehead', label: 'Conehead Zombie', tier: 1,
      hp: 5, speed: 0.45, scale: 1.0, weight: 8, fromStage: 1,
      skins: ['pea', 'mint', 'straw'], suits: ['suit'], pants: ['denim', 'dark'],
      props: ['tie', 'cone'],
      headArmor: { kind: 'cone', label: 'CONE', hits: 1 },
      build: { hunch: 0.13, headScale: 1.0, bulk: 1.0, legLen: 1.0, armReach: 1.0, shoulder: 1.0 },
      gait: 'shamble',
      blurb: 'Traffic cone hat. Knocks off in one head hit.',
    },

    /* ---------- 3. bucket: the classic tank head ---------- */
    bucket: {
      id: 'bucket', label: 'Buckethead Zombie', tier: 2,
      hp: 5, speed: 0.45, scale: 1.0, weight: 8, fromStage: 1,
      skins: ['sage', 'ash', 'brine'], suits: ['suit'], pants: ['denim', 'khaki'],
      props: ['bucket'],
      headArmor: { kind: 'bucket', label: 'BUCKET', hits: 5 },
      build: { hunch: 0.19, headScale: 1.02, bulk: 1.08, legLen: 0.98, armReach: 1.0, shoulder: 1.06 },
      gait: 'plod',
      blurb: 'Dented steel bucket. Five hits — or one glowing lob — to knock loose.',
    },

    /* ---------- 4. screen door: the walking barricade ---------- */
    shieldy: {
      id: 'shieldy', label: 'Screen Door Zombie', tier: 2,
      hp: 5, speed: 0.45, scale: 1.0, weight: 8, fromStage: 1,
      skins: ['olive', 'pea', 'sage'], suits: ['suit', 'rags'], pants: ['slate', 'khaki'],
      props: ['screen'],
      frontArmor: { kind: 'screen', label: 'DOOR', hits: 5 },
      build: { hunch: -0.06, headScale: 0.98, bulk: 1.02, legLen: 0.96, armReach: 0.92, shoulder: 1.0 },
      gait: 'lurch',
      blurb: 'Whole screen door on the arm. Five hits to tear down.',
    },

    /* ---------- 5. newspaper: breaks into a sprinter ---------- */
    newspaper: {
      id: 'newspaper', label: 'Newspaper Zombie', tier: 2,
      hp: 5, speed: 0.5, scale: 1.0, weight: 6, fromStage: 2,
      skins: ['ash', 'brine', 'sage'], suits: ['vest'], pants: ['dark', 'slate'],
      props: ['paper'],
      frontArmor: { kind: 'paper', label: 'PAPER', hits: 4 },
      rage: { speedMult: 0.42, label: 'ENRAGED!' },
      build: { hunch: 0.08, headScale: 1.0, bulk: 0.98, legLen: 1.0, armReach: 1.05, shoulder: 0.98 },
      gait: 'trudge',
      blurb: 'Reads the paper. Tear it and he sprints.',
    },

    /* ---------- 6. runner: vaults, then legwork ---------- */
    runner: {
      id: 'runner', label: 'Pole Vaulting Zombie', tier: 2,
      hp: 4, speed: 0.68, scale: 0.98, weight: 6, fromStage: 2,
      skins: ['mint', 'pea'], suits: ['polo'], pants: ['denim'],
      props: ['pole', 'headband'],
      frontArmor: { kind: 'pole', label: 'POLE', hits: 1 },
      build: { hunch: 0.04, headScale: 0.96, bulk: 0.94, legLen: 1.12, armReach: 1.1, shoulder: 0.94 },
      gait: 'trot',
      blurb: 'Athletic build, vaulting pole, and no patience.',
    },

    /* ---------- 7. brute: football tank ---------- */
    brute: {
      id: 'brute', label: 'Football Zombie', tier: 3,
      hp: 9, speed: 0.52, scale: 1.34, weight: 5, fromStage: 3,
      skins: ['pea', 'olive'], suits: ['jersey'], pants: ['pad'],
      props: ['pads', 'helmet'],
      headArmor: { kind: 'helmet', label: 'HELMET', hits: 1 },
      frontArmor: { kind: 'pads', label: 'PADS', hits: 2 },
      build: { hunch: 0.02, headScale: 1.06, bulk: 1.3, legLen: 1.02, armReach: 1.0, shoulder: 1.34 },
      gait: 'stomp',
      blurb: 'Nine hits of shoulder-charging bad news.',
    },

    /* ---------- 8. flag: leads the wave, moves the line ---------- */
    flag: {
      id: 'flag', label: 'Flag Zombie', tier: 2,
      hp: 5, speed: 0.40, scale: 1.06, weight: 0, fromStage: 0,
      skins: ['clay', 'straw'], suits: ['lab'], pants: ['dark'],
      props: ['flag'],
      build: { hunch: 0.07, headScale: 1.02, bulk: 1.04, legLen: 1.04, armReach: 1.0, shoulder: 1.04 },
      gait: 'march',
      blurb: 'Carries the banner. Showers of them follow.',
    },

    /* ---------- 9. digger: helmet lamp + pickaxe ---------- */
    digger: {
      id: 'digger', label: 'Digger Zombie', tier: 3,
      hp: 7, speed: 0.62, scale: 1.02, weight: 5, fromStage: 3,
      skins: ['straw', 'clay', 'ash'], suits: ['flannel'], pants: ['denim'],
      props: ['pick', 'hardhat'],
      headArmor: { kind: 'hardhat', label: 'HARD HAT', hits: 1 },
      build: { hunch: 0.16, headScale: 1.0, bulk: 1.12, legLen: 0.96, armReach: 1.02, shoulder: 1.12 },
      gait: 'plod',
      blurb: 'Headlamp, pickaxe, and seven hits of stubborn.',
    },

    /* ============================================================
       THE BOSSES
       Not part of the spawn table (weight 0) — the stage flow calls
       them out by name on the boss wave. `boss` carries the phase
       economy; every number the fight runs on lives here.

       scale 1.45 over a painter whose authored crown is 240px (a walker's is
       168) puts him at better than two walker-heights on screen — taller than
       the football zombie's 1.34 and wide enough that he owns nearly two
       columns without the frame clipping his cap. Because bosses only ever
       spawn in rows 2-3 that is always true. Width-wise `hitRadius` widens the
       projectile test to match the silhouette instead of leaving the player
       aiming at air he cannot hit.
       ============================================================ */
    /* ---------- 10. THE DON — stage 2 boss ---------- */
    boss5: {
      id: 'boss5', label: 'THE DON', tier: 4,
      hp: 1, speed: 3.2, scale: 1.45, weight: 0, fromStage: 2, hitRadius: 1.6,
      figCrown: 250,      // the painter's own authored crown, pompadour included
      skins: ['clay'], suits: ['lab'], pants: ['dark'],
      props: ['toupee'],
      boss: {
        level: 2, name: 'THE DON', maga: false,
        toupeeHigh: 12,       // high arcs to rip the rug off
        bodyHits: 40, bodyHigh: 12,  // bare-head economy
      },
      build: { hunch: 0.02, headScale: 1.06, bulk: 1.5, legLen: 1.0, armReach: 0.86, shoulder: 1.46 },
      gait: 'stomp',
      bootRows: [2, 3],       // the only lanes the frame can hold him in
      blurb: 'Gargantuan, orange, and very sure of himself. Twelve high arcs rip the rug off.',
    },

    /* ---------- 11. THE DON, stage 5 FINAL — cap on ---------- */
    boss10: {
      id: 'boss10', label: 'THE DON · FINAL', tier: 4,
      hp: 1, speed: 3.0, scale: 1.45, weight: 0, fromStage: 5, hitRadius: 1.6,
      figCrown: 250,
      skins: ['clay'], suits: ['lab'], pants: ['dark'],
      props: ['maga', 'toupee'],
      boss: {
        level: 5, name: 'THE DON · FINAL', maga: true,
        magaHits: 40, magaHigh: 12,  // cap: forty hits, or twelve high arcs
        toupeeHigh: 12,
        bodyHits: 40, bodyHigh: 12,
      },
      build: { hunch: 0.02, headScale: 1.06, bulk: 1.5, legLen: 1.0, armReach: 0.86, shoulder: 1.46 },
      gait: 'stomp',
      bootRows: [2, 3],
      blurb: 'Cap on. Then the rug. Then forty hits of pure grievance.',
    },
  };

  /* ---------------- seeded variant pick ----------------
     Same seed always yields the same corpse, so a zombie keeps its
     face and wardrobe for its whole life, while a wave varies. */
  function hash(n) {
    let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function picker(seed) {
    let i = 0;
    return arr => arr[Math.floor(hash(seed + (i++) * 7.13) * arr.length) % arr.length];
  }

  /* ============================================================
     VERTICAL METRICS — the shared hitbox.
     The projectile hit test used to accept anything below h 2.3 world
     height-units, which was fine for the old squat box-man but meant every
     shot that landed on the head, the cone or the bucket sailed straight
     through the zombie: the hat was literally outside the collision box.
     These bands are derived from the SAME figure the 2D painter draws
     (see zombie_art2d.js drawFigure: hip 56 + torso 32 + head 22, cranium
     radius 23, all × FIG 1.16) and from Board.pxPerHeight, so the box
     tracks the art instead of being hand-guessed next to it.
     ============================================================ */
  const FIG_PX = {
    crown: 168,     // crown + hair tufts, feet at 0, at type scale 1
    head: 96,       // below this the shot is a body hit
    legTop: 42,     // follow-up / splash hits only catch the legs
  };
  // extra height each piece of headwear adds above the crown, in px.
  // `toupee`/`maga` are the boss's two stackable pieces. They are deliberately
  // SMALL: the box top has to land on the hat, not in the air above it, and
  // the 2D painter already inflates the figure 16% (FIG) on top of the
  // authored crown — so a generous number here would put the ceiling above
  // anything the player can see and swallow clean misses.
  const HEADGEAR_PX = { cone: 66, bucket: 56, helmet: 14, hardhat: 12, headband: 4, toupee: 0, maga: 10 };

  const ZT = {
    LIST, SKINS, CLOTH, PANTS, METAL, PROP, BOSS, FIG_PX, HEADGEAR_PX,
    get(id) { return LIST[id] || LIST.shambler; },
    /* Hit bands for one zombie type, in Board height units.
       pxPerHeight comes from Board (38).
       Pass the live zombie for a BOSS: his headwear falls off in phases, and
       a box that stayed tall after the cap came off would let every shot
       above the bare head sail through empty air (the old cone/bucket bug). */
    hitBands(id, pxPerHeight, z) {
      const t = LIST[id] || LIST.shambler;
      const k = t.scale || 1;
      const pxh = pxPerHeight || 38;
      // a type may author its own crown height: the boss is a caricature with
      // proportions nothing else on the roster shares, so measuring him with
      // the walker's FIG_PX.crown would put his ceiling in the wrong place.
      const crown = t.figCrown || FIG_PX.crown;
      let gear = 0;
      if (t.boss) {
        if (!z || z.magaOn !== false) gear += HEADGEAR_PX.maga;
        if (!z || z.toupeeOn !== false) gear += HEADGEAR_PX.toupee;
      } else {
        for (const p of t.props) gear = Math.max(gear, HEADGEAR_PX[p] || 0);
      }
      return {
        top: ((crown + gear) * k) / pxh,            // full figure incl. headwear
        head: (FIG_PX.head * k) / pxh,              // above this = head hit
        legTop: (FIG_PX.legTop * k) / pxh,          // follow-up hits
      };
    },
    /* everything a renderer needs to draw one specific zombie */
    look(typeId, seed) {
      const t = LIST[typeId] || LIST.shambler;
      const p = picker(seed);
      const skin = SKINS[p(t.skins)];
      const suit = CLOTH[p(t.suits)];
      const pants = PANTS[p(t.pants)];
      // a shade of personal grime so no two neighbours are the same value
      const grime = 0.92 + hash(seed + 3.7) * 0.16;
      return {
        type: t, skin, suit, pants, grime, seed,
        metal: METAL.bucket, prop: PROP,
        build: t.build, props: t.props, gait: t.gait,
        skinKey: p(t.skins), suitKey: p(t.suits),
        isBoss: !!t.boss, bossPal: BOSS,
      };
    },
    /* gameplay helpers */
    headArmor(id) { const t = LIST[id]; return (t && t.headArmor) || null; },
    frontArmor(id) { const t = LIST[id]; return (t && t.frontArmor) || null; },
    spawnTable(stage) {
      const out = [];
      for (const k in LIST) {
        const t = LIST[k];
        if (!t.weight || stage < (t.fromStage || 0)) continue;
        out.push([k, t.weight + (stage - (t.fromStage || 0)) * 1.5]);
      }
      return out;
    },
  };
  G.ZT = ZT;
})();

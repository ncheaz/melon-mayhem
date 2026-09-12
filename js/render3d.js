/* ============================================================
   MELON MAYHEM — render3d.js
   Real 3D rendering layer (Three.js). The simulation in game.js
   is untouched: it still runs in board space (u = column units,
   row = lane, h = height units) with the same physics. This file
   mirrors that state into a perspective 3D scene:

     world x = (u - 4.5) * COL_W3D
     world z = (row - 1.5) * LANE_D3D      (row 0 far, row 3 near)
     world y = h * H3D

   and then re-derives Board.laneY / Board.rowScale from the live
   camera projection, so ALL existing 2D overlay math (popups, aim
   arc, force bar, FX anchors) keeps working — now projected from
   real 3D. With a yaw-free camera lanes project to horizontal
   screen lines and columns stay linear per row, which is exactly
   the shape the 2D code already assumes.
   ============================================================ */
'use strict';
(function () {
  const T = THREE;
  const K = 10 / 88;                    // world units per sprite px
  const COL_W3D = 10;                   // wu per column
  // Deep lane pitch for the wide-lens rig: ~190 sprite-px between lane
  // centrelines so the 4 lanes fan naturally under the ~30° camera.
  const LANE_D3D = 190 * K;             // wu between lane centrelines
  const H3D = 38 * K;                   // wu per height-unit h
  const TAU_ = Math.PI * 2;
  const PX = v => v * K;                // sprite px -> world units

  const worldPos = (u, row, h) => new T.Vector3((u - 4.5) * COL_W3D, h * H3D, (row - 1.5) * LANE_D3D);

  /* ---------------- the setting sun ----------------
     One world position, two textures that must agree on it. The backdrop
     plane is 1400 wide at z −136; the hill planes are only 620 wide at
     z −122/−128, so the same world x is a different u in each canvas.
     Sun world x = −14: inside the frame at that depth (frame spans ±120),
     left of centre, clear of the HUD and of the windmill. */
  const SUN_WX = -14;
  const SUN_U_BACKDROP = 0.5 + SUN_WX / 1400;   // 0.490
  const SUN_U_HILL = 0.5 + SUN_WX / 620;        // 0.477

  /* ---------------- toon gradient ---------------- */
  function makeGradientMap(steps) {
    const tex = new T.DataTexture(steps || new Uint8Array([90, 150, 210, 255]), (steps || [1, 2, 3, 4]).length, 1, T.RedFormat);
    tex.minFilter = T.NearestFilter; tex.magFilter = T.NearestFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    return tex;
  }

  /* ---------------- canvas texture helpers ---------------- */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  const R3 = {
    K, COL_W3D, LANE_D3D, H3D, worldPos,
    renderer: null, scene: null, camera: null, sun: null,
    ready: false,
    zombiePool: new Map(),   // zombie.id -> model
    projPool: new Map(),     // Projectile -> mesh
    obstPool: new Map(),     // obstacle ref -> mesh
    craterPool: new Map(),   // crater ref -> mesh
    menuZombie: null,
    windmill: null, clouds: [],
    camBase: null,
  };
  G.R3 = R3;

  /* ---------------- shared geometry ---------------- */
  const GEO = {};
  const GRAD = makeGradientMap();
  // zombies get their own harder toon ramp: deeper shadow bands make the
  // rounded forms read as volumes under the dusk key light
  const GRAD_Z = makeGradientMap(new Uint8Array([46, 120, 196, 255]));
  function toon(color, opts = {}) {
    return new T.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, opts));
  }
  function toonZ(color, opts = {}) {
    return new T.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD_Z }, opts));
  }

  function buildSharedGeo() {
    GEO.box = new T.BoxGeometry(1, 1, 1);
    GEO.sphere = new T.SphereGeometry(1, 14, 12);
    GEO.sphereHi = new T.SphereGeometry(1, 22, 16);   // cranium-grade
    GEO.sphereLo = new T.SphereGeometry(1, 10, 8);
    GEO.cyl = new T.CylinderGeometry(1, 1, 1, 14);
    GEO.cylHi = new T.CylinderGeometry(1, 1, 1, 20);
    GEO.cone = new T.ConeGeometry(1, 1, 14);
    GEO.coneHi = new T.ConeGeometry(1, 1, 22);
    GEO.capsule = new T.CapsuleGeometry(1, 1, 4, 14);
    GEO.taper = new T.CylinderGeometry(1, 0.72, 1, 18);   // rTop=1 (shoulders), rBottom=0.72 (waist)
    GEO.hemi = new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    GEO.melon = new T.SphereGeometry(1, 16, 14);
    GEO.iron = new T.IcosahedronGeometry(1, 1);
    GEO.circle = new T.CircleGeometry(1, 22);
    GEO.torus = new T.TorusGeometry(1, 0.18, 10, 18);
    GEO.torusHi = new T.TorusGeometry(1, 0.14, 8, 22);
    GEO.blobGeo = new T.CircleGeometry(1, 26);
    R3.blobMat = new T.MeshBasicMaterial({ color: 0x0c1608, transparent: true, opacity: 0.55, depthWrite: false });
  }

  function mesh(geo, mat, sx, sy, sz, x, y, z) {
    const m = new T.Mesh(geo, mat);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = false;
    return m;
  }

  /* ================= TERRAIN & BACKDROP ================= */
  function buildSky() {
    // dusk: indigo zenith → violet → burnt orange → gold at the horizon,
    // matching the 2D sunset strip so both render paths read as one world
    const tex = canvasTex(16, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#3a3560');
      g.addColorStop(0.35, '#8a4a6e');
      g.addColorStop(0.62, '#d4695a');
      g.addColorStop(0.85, '#f2954e');
      g.addColorStop(1, '#ffd98a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    R3.scene.background = tex;
    // telephoto rig: camera sits ~575 wu out — keep fog beyond the whole
    // scene or everything washes to a flat silhouette
    R3.scene.fog = new T.Fog(0xd88a6a, 900, 2200);
  }

  function buildLawn() {
    // 4 lanes x 10 cols checkerboard + mow stripes + blade noise
    const tex = canvasTex(1000, 392, (c, w, h) => {
      const cw = w / 10, ch = h / 4;
      for (let r = 0; r < 4; r++) for (let u = 0; u < 10; u++) {
        c.fillStyle = (r + u) % 2 ? '#68b04a' : '#74bc54';
        c.fillRect(u * cw, r * ch, cw, ch);
      }
      // mow stripes: every other column slightly lighter
      c.globalAlpha = 0.06;
      for (let u = 0; u < 10; u += 2) { c.fillStyle = '#ffffff'; c.fillRect(u * cw, 0, cw, h); }
      c.globalAlpha = 1;
      // worn patches + clover — quiet mid-field variation so the lawn never
      // reads as an empty checkerboard
      for (let i = 0; i < 9; i++) {
        const px = Math.random() * w, py = Math.random() * h, pr = 24 + Math.random() * 46;
        const wg = c.createRadialGradient(px, py, pr * 0.2, px, py, pr);
        wg.addColorStop(0, 'rgba(150,120,60,0.10)');
        wg.addColorStop(1, 'rgba(150,120,60,0)');
        c.fillStyle = wg;
        c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 0.5;
      for (let i = 0; i < 26; i++) {
        const px = Math.random() * w, py = Math.random() * h;
        c.fillStyle = Math.random() < 0.5 ? '#7cc95e' : '#8fd46a';
        for (let b = 0; b < 3; b++) {
          c.beginPath(); c.ellipse(px + (b - 1) * 4, py - b * 2, 3, 2, b * 0.6, 0, Math.PI * 2); c.fill();
        }
      }
      c.globalAlpha = 1;
      // grass blade noise
      for (let i = 0; i < 2600; i++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(40,90,30,0.25)' : 'rgba(200,255,170,0.18)';
        const x = Math.random() * w, y = Math.random() * h;
        c.fillRect(x, y, 2, 3);
      }
      // faint lane divider lines
      c.strokeStyle = 'rgba(30,70,25,0.20)'; c.lineWidth = 3;
      for (let r = 1; r < 4; r++) { c.beginPath(); c.moveTo(0, r * ch); c.lineTo(w, r * ch); c.stroke(); }
      // soil border
      c.strokeStyle = 'rgba(70,50,28,0.55)'; c.lineWidth = 14;
      c.strokeRect(0, 0, w, h);
    });
    const lawn = new T.Mesh(new T.PlaneGeometry(COL_W3D * 10, LANE_D3D * 4 + PX(10)), new T.MeshToonMaterial({ map: tex, gradientMap: GRAD }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(0, 0, 0);
    lawn.receiveShadow = true;
    R3.scene.add(lawn);

    // meadow around the board
    const mtex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#54953c'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 3200; i++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(40,90,30,0.22)' : 'rgba(190,240,150,0.15)';
        c.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
    });
    mtex.wrapS = mtex.wrapT = T.RepeatWrapping; mtex.repeat.set(5, 5);
    // meadow ends at z ≈ −111 so the HORIZON sits inside the frame — the
    // sunset backdrop and hills rise behind it
    const meadow = new T.Mesh(new T.PlaneGeometry(560, 230), new T.MeshToonMaterial({ map: mtex, gradientMap: GRAD }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(0, -0.4, 4);
    meadow.receiveShadow = true;
    R3.scene.add(meadow);

    // sunset backdrop — the plane spans y −30..30 but only an ≈11 wu slice
    // (v 0.34..0.52) sits in the visible band above the horizon, so the
    // sunset money-shot (gold → half-set sun → pink) is painted THERE
    const btex = canvasTex(1024, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.00, '#2e2a55');
      g.addColorStop(0.22, '#5e3768');
      g.addColorStop(0.30, '#93456e');
      g.addColorStop(0.36, '#e05a4e');
      g.addColorStop(0.42, '#ff8a3e');
      g.addColorStop(0.48, '#ffab4e');
      g.addColorStop(0.52, '#ffdd9a');
      g.addColorStop(1.00, '#ffdd9a');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // Setting sun. The disc has to sit INSIDE the visible slice: at this
      // depth the frame spans world x ±120 and the open sky above the ridge
      // is only ~70px tall, so the sun is placed at u 0.515 (≈ world x +21,
      // screen x 0.59) at v 0.402 — high enough to clear the hill tops and
      // low enough that its crown stays under the frame edge. It used to be
      // painted at u 0.66 (world x +224), which is more than twice the
      // half-width: off-screen, so nobody ever saw it.
      /* Disc radius is set by the sky band, not by taste. At that depth the
         frame top is 12° below horizontal and the hill ridge sits at ~14.9°,
         so the open sky is a ~70px strip on a 720 canvas. A 23px texture
         radius projects to ~29px radius (58px across) — big enough to read,
         small enough that the crown clears the frame edge and the base
         settles onto the ridge. */
      const sx = w * SUN_U_BACKDROP, sy = h * 0.428, sr = 23;
      // halo kept TIGHT: a wide glow just blows out the narrow sky band and
      // the disc stops reading as a disc
      const sg = c.createRadialGradient(sx, sy, sr, sx, sy, sr * 2.1);
      sg.addColorStop(0, 'rgba(255,230,164,0.62)');
      sg.addColorStop(0.45, 'rgba(255,196,116,0.30)');
      sg.addColorStop(1, 'rgba(255,176,96,0)');
      c.fillStyle = sg;
      c.beginPath(); c.arc(sx, sy, sr * 2.1, 0, Math.PI * 2); c.fill();
      // the disc itself: hot core, defined edge, warm limb
      const dg = c.createRadialGradient(sx, sy - sr * 0.25, sr * 0.12, sx, sy, sr);
      dg.addColorStop(0, '#fffdf0');
      dg.addColorStop(0.55, '#fff2c4');
      dg.addColorStop(0.86, '#ffd98a');
      dg.addColorStop(1, '#ffb463');
      c.fillStyle = dg;
      c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,190,110,0.85)'; c.lineWidth = 2.4;
      c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.stroke();
      // a few short rays, low alpha — accent, not fog
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = 'rgba(255,208,140,0.22)'; c.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + 0.19;
        c.lineWidth = i % 2 ? 4 : 2;
        c.beginPath();
        c.moveTo(sx + Math.cos(a) * (sr + 3), sy + Math.sin(a) * (sr + 3));
        c.lineTo(sx + Math.cos(a) * (sr + 16 + (i % 3) * 7), sy + Math.sin(a) * (sr + 16 + (i % 3) * 7));
        c.stroke();
      }
      c.restore();
      // banded haze + painterly clouds INSIDE the visible slice (v 0.34..0.52
      // ≈ y 87..133): two violet streaks up high, warm cloud puffs near the sun
      c.globalAlpha = 0.35;
      c.fillStyle = '#6a3f6e';
      for (const [by, bh] of [[0.345, 0.018], [0.375, 0.012]]) {
        c.beginPath(); c.ellipse(w * 0.3, h * by, w * 0.42, h * bh, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(w * 0.78, h * (by + 0.02), w * 0.3, h * bh * 0.8, 0, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
      const puff = (px, py, pr, col) => {
        const pg = c.createRadialGradient(px - pr * 0.25, py - pr * 0.35, pr * 0.15, px, py, pr);
        pg.addColorStop(0, col);
        pg.addColorStop(1, 'rgba(255,200,140,0)');
        c.fillStyle = pg;
        c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
      };
      puff(w * 0.14, h * 0.455, 34, 'rgba(255,214,170,0.85)');
      puff(w * 0.19, h * 0.47, 22, 'rgba(255,230,190,0.9)');
      puff(w * 0.44, h * 0.44, 26, 'rgba(255,220,180,0.7)');
      puff(w * 0.86, h * 0.46, 30, 'rgba(255,224,180,0.8)');
      puff(w * 0.9, h * 0.44, 18, 'rgba(255,240,205,0.9)');
    });
    const backdrop = new T.Mesh(new T.PlaneGeometry(1400, 60),
      new T.MeshBasicMaterial({ map: btex, fog: false }));
    backdrop.position.set(0, 0, -136);
    R3.scene.add(backdrop);
  }

  function buildFence() {
    const g = new T.Group();
    const wood = toon(0xe9e2cf), wood2 = toon(0xd8cdb2);
    const zBack = -1.5 * LANE_D3D - PX(30);
    const x0 = -COL_W3D * 5 - PX(16), x1 = COL_W3D * 5 + PX(70);
    for (let x = x0; x <= x1; x += PX(19)) {
      const p = mesh(GEO.box, wood, PX(7), PX(30), PX(2.4), x, PX(15), zBack);
      p.receiveShadow = true; g.add(p);
    }
    g.add(mesh(GEO.box, wood2, x1 - x0, PX(4), PX(2), (x0 + x1) / 2, PX(24), zBack));
    g.add(mesh(GEO.box, wood2, x1 - x0, PX(4), PX(2), (x0 + x1) / 2, PX(9), zBack));
    R3.scene.add(g);
  }

  /* ============================================================
     THE COTTAGE
     Sized against the zombies AND against the frame. A zombie stands
     ≈19 world units tall, so the front door is 16 wu (a zombie just
     clears it), the eaves 20.5 wu and the ridge 34 wu — about 1.8
     zombie heights, which is what a cottage looks like beside a
     person. The old box was 6.4 wu, a third of a zombie: a doll house.
     Height is also capped by the camera: at z −20 the ground line sits
     at y≈334 and one world unit is ~8.9px, so anything over ~37 wu
     would run off the top of the frame.
     ============================================================ */
  function buildCottage() {
    const g = new T.Group();
    const wall = toon(0xe3d3ae);
    const roof = toon(0x9c452f), roofD = toon(0x78331f);
    const timber = toon(0x66452a), timberD = toon(0x4d331e);
    const stone = toon(0x8f8a7e), stoneD = toon(0x736e63);
    const lit = new T.MeshBasicMaterial({ color: 0xffd98a });
    const dark = toon(0x2c2a24);
    const leaf = toon(0x4e8a3c);

    const W = 24, D = 19;            // width, depth
    const Y0 = 2.4, Y1 = 20.5;       // floor slab top, eaves
    const J1 = 27.5;                 // top of the jettied upper storey
    const RISE = 6.5, OVER = 1.8;    // roof rise and overhang
    const half = W / 2, zf = D / 2;
    const add = (geo, mat, sx, sy, sz, x, y, z) => { const m = mesh(geo, mat, sx, sy, sz, x, y, z); g.add(m); return m; };

    // ---- masonry base + walls
    add(GEO.box, stoneD, W + 1.6, Y0, D + 1.6, 0, Y0 / 2, 0);
    add(GEO.box, wall, W, Y1 - Y0, D, 0, (Y0 + Y1) / 2, 0);
    // ---- jettied upper storey, slightly wider than the base (storybook)
    add(GEO.box, wall, W + 3, J1 - Y1, D + 2.4, 0, (Y1 + J1) / 2, 0);
    add(GEO.box, timberD, W + 3.4, 1.0, D + 2.8, 0, Y1 + 0.4, 0);   // jetty beam

    // ---- pitched roof: two slabs + ridge cap + finial
    const span = (W + 3) / 2 + OVER;
    const slabLen = Math.hypot(span, RISE), ang = Math.atan2(RISE, span);
    for (const s of [-1, 1]) {
      const slab = add(GEO.box, roof, slabLen, 1.2, D + 4.4, s * span / 2, J1 + RISE / 2 - 0.5, 0);
      slab.rotation.z = -s * ang;
    }
    add(GEO.box, roofD, 1.8, 1.4, D + 4.6, 0, J1 + RISE - 0.3, 0);      // ridge cap
    add(GEO.cyl, timberD, 0.3, 3.4, 0.3, 0, J1 + RISE + 1.8, 0);        // finial post
    const vane = add(GEO.box, dark, 2.8, 0.45, 0.35, 1.4, J1 + RISE + 3.0, 0);
    vane.rotation.y = 0.4;                                             // weathervane
    add(GEO.cone, timberD, 1.2, 1.8, 1.2, 0, J1 + RISE + 4.0, 0);

    // ---- dormer window through the front roof slope
    const dz = zf + 1.6;
    add(GEO.box, wall, 7.2, 6.6, 4.6, -4.0, J1 + 1.6, dz);
    const droof = add(GEO.box, roof, 10.6, 1.0, 6.4, -4.0, J1 + 5.4, dz);
    droof.rotation.z = -0.42;
    add(GEO.box, dark, 4.6, 3.8, 0.6, -4.0, J1 + 1.8, dz + 2.4);
    add(GEO.box, lit, 3.4, 2.6, 0.5, -4.0, J1 + 1.8, dz + 2.7);

    // ---- chimney, back-left, with a cap
    add(GEO.box, stone, 4.6, 22, 4.6, -W / 2 + 2.6, 24, -D / 2 + 3);
    add(GEO.box, stoneD, 5.6, 1.2, 5.6, -W / 2 + 2.6, 35.6, -D / 2 + 3);
    add(GEO.cyl, dark, 2.0, 1.0, 2.0, -W / 2 + 2.6, 36.7, -D / 2 + 3);

    // ---- facade (+z, camera side): framing, windows, flower boxes
    const fz = zf + 0.3;
    for (const s of [-1, 1]) add(GEO.box, timber, 1.8, Y1 - Y0, 1.2, s * (half - 1.0), (Y0 + Y1) / 2, fz);
    add(GEO.box, timber, W, 1.4, 1.2, 0, Y0 + 2.0, fz);          // sill band
    add(GEO.box, timber, W, 1.4, 1.2, 0, Y1 - 0.7, fz);          // head band
    for (const s of [-1, 1]) {                                    // fachwerk braces
      const br = add(GEO.box, timber, 1.3, 8, 1.0, s * (half - 4.2), (Y0 + Y1) / 2, fz);
      br.rotation.z = s * 0.62;
    }
    // two ground-floor windows: frame, lit pane, mullion, shutters, flower box
    for (const wx of [-5.6, 5.4]) {
      add(GEO.box, dark, 6.0, 7.0, 0.7, wx, 13.0, fz);
      add(GEO.box, lit, 4.7, 5.7, 0.5, wx, 13.0, fz + 0.5);
      add(GEO.box, timber, 0.6, 5.7, 0.5, wx, 13.0, fz + 0.85);
      add(GEO.box, timber, 4.7, 0.6, 0.5, wx, 13.0, fz + 0.85);
      add(GEO.box, timber, 7.2, 1.0, 1.9, wx, 9.3, fz + 0.35);   // sill
      for (const s of [-1, 1]) add(GEO.box, roofD, 1.7, 7.6, 0.9, wx + s * 4.2, 13.0, fz + 1.0);
      add(GEO.box, timber, 6.0, 1.7, 2.1, wx, 8.3, fz + 0.8);    // window box
      for (let i = 0; i < 4; i++) {
        const fx2 = wx - 2.2 + i * 1.5;
        add(GEO.sphereLo, i % 2 ? toon(0xd8586a) : toon(0xe8b84a), 0.8, 0.8, 0.8, fx2, 9.6, fz + 1.3);
        add(GEO.box, leaf, 0.3, 1.1, 0.3, fx2, 9.0, fz + 1.1);
      }
    }
    // upper storey windows
    for (const wx of [-5.4, 5.4]) {
      add(GEO.box, dark, 4.2, 4.4, 0.7, wx, 24.0, fz + 0.6);
      add(GEO.box, lit, 3.2, 3.4, 0.5, wx, 24.0, fz + 1.1);
      add(GEO.box, timber, 4.9, 0.8, 1.4, wx, 21.6, fz + 0.8);
    }

    // ---- the door, on the +x side so it faces the garden
    const dx = half + 0.3;
    add(GEO.box, timberD, 0.8, 16.8, 8.4, dx, 10.8, -1.6);          // frame
    add(GEO.box, toon(0x5c3d22), 0.8, 15.6, 7.2, dx + 0.3, 10.6, -1.6);
    add(GEO.box, timber, 0.5, 0.8, 7.2, dx + 0.75, 14.0, -1.6);     // rail
    add(GEO.sphere, toon(0xd8b23c), 0.5, 0.5, 0.5, dx + 0.85, 10.2, 1.0);   // knob
    add(GEO.box, stone, 3.2, 1.4, 8.8, dx + 1.4, 0.7, -1.6);        // step
    // porch canopy on two posts
    add(GEO.box, roof, 5.8, 1.1, 9.6, dx + 2.4, 20.4, -1.6);
    for (const pz of [2.4, -5.6]) add(GEO.cyl, timber, 0.4, 19, 0.4, dx + 4.6, 10.5, pz);
    // lantern beside the door
    add(GEO.box, dark, 1.4, 2.0, 1.4, dx + 0.8, 17.8, 2.6);
    add(GEO.sphere, lit, 0.6, 0.8, 0.6, dx + 0.8, 17.8, 2.6);

    // x −64 keeps the whole footprint outside the lawn's −50 edge (so it never
    // stands on a play column) while staying inside the frame at that depth
    g.position.set(-64, 0, -20);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    R3.scene.add(g);
  }

  function buildGraveyard() {
    const g = new T.Group();
    const stone = toon(0x8d968f), stoneD = toon(0x767f79);
    const x = COL_W3D * 5 + PX(56);
    const z0 = -1.5 * LANE_D3D - PX(20), z1 = 1.5 * LANE_D3D + PX(26);
    // side wall with arch gap at lane center
    for (let z = z0; z <= z1; z += PX(22)) {
      if (Math.abs(z - PX(4)) < PX(30)) continue; // gate gap
      const seg = mesh(GEO.box, stone, PX(6), PX(26), PX(20), 0, PX(13), z);
      seg.receiveShadow = true; g.add(seg);
      // pointed cap — reads as graveyard wall, not a generic gray fence
      const cap = mesh(GEO.cone, stoneD, PX(4.5), PX(5), PX(14), 0, PX(28.5), z);
      cap.rotation.x = Math.PI / 2;
      cap.rotation.z = Math.PI / 2;
      g.add(cap);
    }
    // gate pillars + arch
    g.add(mesh(GEO.box, stoneD, PX(9), PX(38), PX(9), 0, PX(19), PX(4) - PX(22)));
    g.add(mesh(GEO.box, stoneD, PX(9), PX(38), PX(9), 0, PX(19), PX(4) + PX(22)));
    g.add(mesh(GEO.box, stoneD, PX(7), PX(8), PX(58), 0, PX(40), PX(4)));
    // arch sign rails
    g.add(mesh(GEO.box, toon(0x4a3a28), PX(40), PX(3), PX(3), PX(24), PX(33), PX(4)));
    // static dressing tombstones behind the wall
    for (const [dz, rot] of [[-PX(40), 0.3], [-PX(16), -0.2], [PX(34), 0.15]]) {
      const t = new T.Group();
      t.add(mesh(GEO.box, stone, PX(18), PX(24), PX(5), 0, PX(12), 0));
      const top = mesh(GEO.cyl, stone, PX(9), PX(5), PX(9), 0, PX(24), 0);
      top.rotation.x = Math.PI / 2;
      t.add(top);
      t.rotation.y = rot;
      t.position.set(x + PX(34), 0, PX(4) + dz);
      t.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(t);
    }
    g.position.set(x, 0, 0);
    R3.scene.add(g);
  }

  function buildHedge() {
    // Treeline right behind the fence. Kept LOW and pushed BACK so no canopy
    // leans over the board — shrubbery hugging the horizon, with only rare
    // modest accents for rhythm. The silhouette sits against the sunset.
    const g = new T.Group();
    const mH1 = toon(0x2e6630), mH2 = toon(0x3a7d38), mH3 = toon(0x265426);
    const zH = -1.5 * LANE_D3D - PX(96);
    let x = -COL_W3D * 5 - PX(140);
    let i = 0;
    while (x < COL_W3D * 5 + PX(190)) {
      // low canopy: h ≈ 8..11 wu — below the fence-top sightline
      const h = 8 + Math.sin(i * 1.7) * 1.6 + Math.random() * 1.4;
      const r = h * 0.5;
      const m = [mH1, mH2, mH3][i % 3];
      const bush = new T.Group();
      const n = 3;
      for (let b = 0; b < n; b++) {
        const bx = (Math.random() - 0.5) * r * 1.2;
        const by = h * 0.4 + Math.random() * h * 0.3;
        const bz = (Math.random() - 0.5) * 3;
        const br = r * (0.7 + Math.random() * 0.5);
        const s = mesh(GEO.sphere, m, br, br * 0.85, br, bx, by, bz);
        bush.add(s);
      }
      /* Accent tree. Doubling these is only safe OUTSIDE the lawn footprint:
         this treeline sits close to camera (z ≈ −43), so a 2x tree in the
         middle of the frame is ~250px tall, reaches the top of the frame and
         swallows the sunset horizon. Out past the fence line there is room,
         so the big ones grow at the ends and the centre stays low scrub. */
      const outside = Math.abs(x) > COL_W3D * 5;
      if (i % 9 === 4 || outside) {
        const th = h * (outside ? 3.0 : 1.5);
        bush.add(mesh(GEO.cyl, toon(0x6a4a2c), outside ? 2.0 : 1.2, th * 0.5, outside ? 2.0 : 1.2, 0, th * 0.25, 0));
        bush.add(mesh(GEO.cone, mH3, h * (outside ? 1.25 : 0.7), th * 0.8, h * (outside ? 1.25 : 0.7), 0, th * 0.75, 0));
        if (outside) bush.add(mesh(GEO.sphere, mH2, h * 0.9, h * 0.6, h * 0.9, 0, th * 0.55, 0));
      }
      bush.position.set(x, 0, zH);
      bush.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(bush);
      x += 14 + Math.random() * 8;
      i++;
    }
    R3.scene.add(g);
  }

  function buildNearFence() {
    // low picket framing the near edge — grounds the board like BTD6 map
    // borders, kept short so row 3 never occludes
    const g = new T.Group();
    const wood = toon(0xe4dcc6), wood2 = toon(0xd2c6aa);
    const zN = 1.5 * LANE_D3D + PX(52);
    const x0 = -COL_W3D * 5 - PX(30), x1 = COL_W3D * 5 + PX(90);
    for (let x = x0; x <= x1; x += PX(19)) {
      g.add(mesh(GEO.box, wood, PX(6), PX(20), PX(2.2), x, PX(10), 0));
    }
    g.add(mesh(GEO.box, wood2, x1 - x0, PX(3.4), PX(2), (x0 + x1) / 2, PX(16), 0));
    g.add(mesh(GEO.box, wood2, x1 - x0, PX(3.4), PX(2), (x0 + x1) / 2, PX(6), 0));
    g.position.set(0, 0, zN);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    R3.scene.add(g);
  }

  function buildDressing() {
    // scatter props across the meadow voids — bushes, flowers, rocks
    const rng = (a, b) => a + Math.random() * (b - a);
    const mBush = [toon(0x2f6e30), toon(0x3a8038), toon(0x275c28)];
    const mRock = toon(0x9a9c92), mRockD = toon(0x84867c);
    const mFlow = [toon(0xe86a8a), toon(0xf0c040), toon(0xffffff), toon(0xd66ae8)];
    const mStem = toon(0x3a7d38);
    function bush(x, z, s) {
      const g = new T.Group();
      for (let b = 0; b < 3; b++) {
        const r = rng(6, 10) * s;
        g.add(mesh(GEO.sphere, mBush[b % 3], r, r * 0.8, r, rng(-5, 5) * s, r * 0.55, rng(-4, 4) * s));
      }
      g.position.set(x, 0, z);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      R3.scene.add(g);
    }
    function flower(x, z) {
      const g = new T.Group();
      g.add(mesh(GEO.cyl, mStem, 0.35, 5, 0.35, 0, 2.5, 0));
      const c = mFlow[Math.floor(rng(0, 4))];
      for (let p = 0; p < 4; p++) {
        const a = p * Math.PI / 2;
        g.add(mesh(GEO.sphere, c, 1.6, 0.8, 1.6, Math.cos(a) * 1.7, 5.4, Math.sin(a) * 1.7));
      }
      g.add(mesh(GEO.sphere, toon(0xf0c040), 1.1, 1.1, 1.1, 0, 5.4, 0));
      g.position.set(x, 0, z);
      R3.scene.add(g);
    }
    function rock(x, z, s) {
      const g = new T.Group();
      g.add(mesh(GEO.sphere, mRock, 5 * s, 3.6 * s, 4.2 * s, 0, 1.8 * s, 0));
      g.add(mesh(GEO.sphere, mRockD, 2.6 * s, 1.8 * s, 2.2 * s, 3 * s, 1 * s, 1 * s));
      g.position.set(x, 0, z);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      R3.scene.add(g);
    }
    // right void (between graveyard and windmill)
    for (let i = 0; i < 7; i++) bush(rng(72, 130), rng(-70, 60), rng(0.9, 1.5));
    for (let i = 0; i < 5; i++) rock(rng(70, 140), rng(-80, 60), rng(0.8, 1.6));
    for (let i = 0; i < 10; i++) flower(rng(60, 150), rng(-80, 70));
    // left void (behind/left of cottage)
    for (let i = 0; i < 5; i++) bush(rng(-150, -85), rng(-60, 60), rng(0.9, 1.4));
    for (let i = 0; i < 8; i++) flower(rng(-160, -90), rng(-70, 70));
    // near-side flowers (below the board, sparse so gameplay reads)
    for (let i = 0; i < 8; i++) flower(rng(-80, 120), rng(75, 105));
    for (let i = 0; i < 3; i++) bush(rng(-60, 100), rng(80, 100), rng(0.7, 1.0));
  }

  function buildHills() {
    // silhouette hills on alpha planes, two depths — LOW ridges that top out
    // inside the ≈85px sky band (tops ≈ 8/4 wu above the horizon line), so
    // sunset glow stays visible above and between them
    function hill(color, z, hgt, seed, rim) {
      const tex = canvasTex(1024, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        // ridge points kept so the silhouette can be lit along its top edge
        const pts = [];
        for (let x = 0; x <= w; x += 16) {
          const y = h - (h * 0.35 + h * 0.3 * Math.abs(Math.sin(x * 0.006 * seed + 1.3)) + h * 0.22 * Math.sin(x * 0.0023 * seed));
          pts.push([x, y]);
        }
        c.fillStyle = color;
        c.beginPath(); c.moveTo(0, h);
        for (const [px, py] of pts) c.lineTo(px, py);
        c.lineTo(w, h); c.closePath(); c.fill();
        // sun-facing rim: the peaks catch the light that spills over them,
        // brightest directly beneath the sun (u 0.534) and falling off
        if (rim) {
          const rg = c.createLinearGradient(w * SUN_U_HILL - 340, 0, w * SUN_U_HILL + 340, 0);
          rg.addColorStop(0, 'rgba(255,196,120,0)');
          rg.addColorStop(0.42, 'rgba(255,214,146,0.30)');
          rg.addColorStop(0.5, 'rgba(255,232,176,0.85)');
          rg.addColorStop(0.58, 'rgba(255,214,146,0.30)');
          rg.addColorStop(1, 'rgba(255,196,120,0)');
          c.strokeStyle = rg; c.lineWidth = 2.6; c.lineJoin = 'round';
          c.beginPath();
          c.moveTo(pts[0][0], pts[0][1]);
          for (const [px, py] of pts) c.lineTo(px, py);
          c.stroke();
        }
      });
      const m = new T.Mesh(new T.PlaneGeometry(620, hgt),
        new T.MeshBasicMaterial({ map: tex, transparent: true, fog: false }));
      m.position.set(0, hgt / 2 - 6, z);
      R3.scene.add(m);
    }
    hill('#9ecf8e', -128, 9, 1.7, true);   // tops peek ~3 wu above the horizon
    hill('#7cbb6c', -122, 7, 2.6, false);
  }

  function buildClouds() {
    const tex = canvasTex(256, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) {
        const x = w / 2 + (Math.random() - 0.5) * w * 0.7;
        const y = h * 0.6 + (Math.random() - 0.5) * h * 0.35;
        const r = 18 + Math.random() * 30;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
    });
    for (let i = 0; i < 7; i++) {
      const sm = new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, fog: true });
      const s = new T.Sprite(sm);
      // small world-sized puffs drifting INSIDE the sky band (y 2..9 wu at
      // z ≈ −129 — the visible horizon strip)
      const sc = 16 + Math.random() * 20;
      s.scale.set(sc, sc * 0.45, 1);
      s.position.set((Math.random() - 0.5) * 420, 2 + Math.random() * 7, -125 - Math.random() * 8);
      s.userData.speed = 1.2 + Math.random() * 1.6;
      R3.scene.add(s); R3.clouds.push(s);
    }
  }

  function buildWindmill() {
    /* Stands ON the horizon. The meadow's far edge is at z ≈ −111 and lands
       at the bottom of the visible sky band; at that depth the whole band is
       only ~100px of screen, so the mill is sized to ~13 wu — any taller and
       it runs off the top of the frame. It used to sit at z −17, in the
       middle of the field, where it read as a garden ornament. */
    const g = new T.Group();
    const stone = toon(0xcfc2a4), stoneD = toon(0xa8997c);
    // tapered tower
    g.add(mesh(GEO.cyl, stone, PX(15), PX(74), PX(15), 0, PX(37), 0));
    g.add(mesh(GEO.cyl, stoneD, PX(16.6), PX(5), PX(16.6), 0, PX(2.6), 0));    // base course
    g.add(mesh(GEO.cyl, stoneD, PX(13.4), PX(4), PX(13.4), 0, PX(71), 0));     // gallery ring
    g.add(mesh(GEO.cyl, stoneD, PX(9), PX(3), PX(9), 0, PX(58), 0));           // hoist band
    // cap
    g.add(mesh(GEO.cone, toon(0x9e4a34), PX(17.5), PX(20), PX(17.5), 0, PX(82), 0));
    // door + window so it reads as a building, not a pole
    g.add(mesh(GEO.box, toon(0x6a4526), PX(8), PX(14), PX(2), -PX(14), PX(8), PX(0)));
    g.add(mesh(GEO.box, toon(0x2a2a22), PX(1.6), PX(7), PX(1.4), -PX(14.6), PX(34), 0));
    // sails — offset in +z so they clear the tower; long arms, a windmill
    // is mostly sail
    const hub = new T.Group(); hub.position.set(0, PX(78), PX(14));
    for (let i = 0; i < 4; i++) {
      const arm = new T.Group(); arm.rotation.z = i * Math.PI / 2;
      arm.add(mesh(GEO.box, toon(0xf0e8d4), PX(5.0), PX(54), PX(1.7), 0, PX(31), 0));
      arm.add(mesh(GEO.box, toon(0x8a7a5c), PX(1.9), PX(54), PX(2.6), PX(3.2), PX(31), 0));
      arm.add(mesh(GEO.box, toon(0x8a7a5c), PX(15), PX(1.7), PX(2.6), 0, PX(24), 0));
      hub.add(arm);
    }
    g.add(hub);
    g.position.set(COL_W3D * 5 + PX(110), 0, -104);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    R3.scene.add(g);
    R3.windmill = hub;
  }

  /* ================= BLOB SHADOWS ================= */
  // Genre look (BTD6): every actor gets a dark ground-contact blob that
  // reads at gameplay scale regardless of sun angle. Pooled per actor.
  function makeBlob(radius) {
    const m = new T.Mesh(GEO.blobGeo, R3.blobMat);
    m.scale.setScalar(radius);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    R3.scene.add(m);
    return m;
  }

  /* ================= MODELS ================= */
  function melonMaterial() {
    const tex = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#4a9c30'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#144f1c'; c.lineWidth = 13;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo((i + 0.5) * w / 5 - 8, 0);
        c.bezierCurveTo((i + 0.5) * w / 5 + 12, h * 0.33, (i + 0.5) * w / 5 - 12, h * 0.66, (i + 0.5) * w / 5 + 8, h);
        c.stroke();
      }
      c.fillStyle = 'rgba(30,80,20,0.12)'; c.fillRect(0, 0, w, h);
    });
    return new T.MeshToonMaterial({ map: tex, gradientMap: GRAD });
  }

  /* ============================================================
     ZOMBIE 3D RIG
     Mirrors zombie_art2d.js: same roster row drives colours,
     proportions, props and gait, so a zombie looks like the same
     character in both render paths.
     Local space: feet at y=0, faces -x. All sizes in sprite px
     through PX().
     ============================================================ */
  const HEX = c => '#' + String(c).replace('#', '');

  /* Exposure compensation.
     The scene is lit dusk-bright (hemi 0.42 + warm sun 1.05 ≈ 1.47x, with
     an orange cast) and rendered with sRGB output. Materials authored at
     their literal artwork value come out bleached and desaturated, which
     is exactly what killed the old cast. Zombie materials are therefore
     authored DOWN: darker, more saturated, so what lands on screen
     matches the 2D palette instead of a washed-out cousin of it. */
  const EXPO = { l: 0.60, s: 1.45, h: 0.035 };
  function expose(col) {
    const c = new T.Color(col);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    /* Only push COLOUR. Near-neutral materials — eye whites, teeth, metal —
       must survive untouched, otherwise the sun's warm cast turns sclera
       yellow and steel into brass. The weight ramps in over s 0.22..0.50. */
    const w = Math.max(0, Math.min(1, (hsl.s - 0.22) / 0.28));
    const h = (hsl.h + EXPO.h * w + 1) % 1;
    const s = Math.min(1, hsl.s * (1 + (EXPO.s - 1) * w));
    const l = Math.max(0, hsl.l * (1 - (1 - EXPO.l) * w));
    c.setHSL(h, s, l);
    return c.getHex();
  }

  /* prop builders, keyed by the same ids the 2D painter uses.
     Each returns a Group whose origin is the documented anchor. */
  const ZPROP3D = {
    /* head-local (origin = neck top; cranium centred at +PX(15), crown at PX(31)) */
    cone(g, M_) {
      const c = M_('#e8752a'), cD = M_('#a94a12'), band = M_('#f2f0e6');
      const b = new T.Group(); b.rotation.z = -0.06;
      b.add(mesh(GEO.coneHi, c, PX(14), PX(40), PX(14), 0, PX(42), 0));        // spans 22..62
      b.add(mesh(GEO.cylHi, cD, PX(15), PX(4.5), PX(15), 0, PX(22), 0));      // flared base
      b.add(mesh(GEO.cylHi, band, PX(11.8), PX(3.6), PX(11.8), 0, PX(29), 0));
      b.add(mesh(GEO.cylHi, band, PX(8.8), PX(3.0), PX(8.8), 0, PX(38), 0));
      g.add(b); return b;
    },
    bucket(g, M_) {
      const m = M_('#b6bfc8'), mD = M_('#7c858e'), mH = M_('#e2e9ef');
      const b = new T.Group(); b.rotation.z = 0.07;
      // rim rides just above the brow so the whole face stays readable
      b.add(mesh(GEO.cylHi, m, PX(18.5), PX(40), PX(18.5), 0, PX(42), 0));    // spans 22..62
      b.add(mesh(GEO.cylHi, mH, PX(19.2), PX(5), PX(19.2), 0, PX(60), 0));    // rim
      b.add(mesh(GEO.cylHi, mD, PX(18.8), PX(4), PX(18.8), 0, PX(23), 0));    // bottom lip
      const bail = mesh(GEO.torus, mD, PX(21), PX(21), PX(13), 0, PX(59), 0);
      bail.rotation.y = Math.PI / 2; b.add(bail);
      const d1 = mesh(GEO.sphereLo, mD, PX(6), PX(3.8), PX(6), -PX(15), PX(40), 0);    // dent
      const d2 = mesh(GEO.sphereLo, mD, PX(4.6), PX(3.2), PX(4.6), PX(14), PX(52), 0); // dent
      const d3 = mesh(GEO.sphereLo, mD, PX(5.2), PX(3.4), PX(5.2), 0, PX(34), PX(17)); // dent, camera side
      b.add(d1); b.add(d2); b.add(d3);
      // bucket damage feedback: dents + tint + tilt as the 5-hit economy drains
      b.userData.dents = [d1, d2, d3];
      b.userData.tint = m;
      g.add(b); return b;
    },
    helmet(g, M_) {
      const c = M_('#cf3b31'), cD = M_('#8d1f18'), pad = M_('#e2ddcd'), met = M_('#7e8792');
      const b = new T.Group();
      b.add(mesh(GEO.hemi, c, PX(20), PX(21), PX(20), 0, PX(16), 0));         // dome
      b.add(mesh(GEO.sphere, cD, PX(19.6), PX(4.5), PX(19.6), 0, PX(16), 0)); // shell band
      b.add(mesh(GEO.box, pad, PX(4.6), PX(3.4), PX(37), 0, PX(32), 0));      // crown stripe
      for (const s of [-1, 1]) b.add(mesh(GEO.sphere, pad, PX(6.4), PX(7.4), PX(8.4), PX(2), PX(9), s * PX(18.5))); // ear pad
      // face mask cage, out in front of the face
      b.add(mesh(GEO.box, met, PX(3), PX(3), PX(23), -PX(18), PX(3), 0));
      b.add(mesh(GEO.box, met, PX(3), PX(3), PX(21), -PX(14), -PX(5), 0));
      for (const s of [-1, 1]) b.add(mesh(GEO.box, met, PX(3), PX(14), PX(3), -PX(17), -PX(6), s * PX(9.5)));
      g.add(b); return b;
    },
    hardhat(g, M_) {
      const c = M_('#f0c33c'), cD = M_('#a8801a'), lamp = M_('#f6e06a');
      const b = new T.Group(); b.rotation.z = 0.05;
      b.add(mesh(GEO.hemi, c, PX(18.5), PX(19), PX(18.5), 0, PX(16), 0));
      b.add(mesh(GEO.sphere, cD, PX(18.5), PX(3.6), PX(18.5), 0, PX(16), 0));
      b.add(mesh(GEO.box, c, PX(12), PX(3.6), PX(39), -PX(5), PX(17), 0));    // brim
      for (const zz of [-PX(7), 0, PX(7)]) b.add(mesh(GEO.box, cD, PX(2), PX(14), PX(2), PX(3), PX(25), zz));
      b.add(mesh(GEO.cylHi, lamp, PX(5.2), PX(5.2), PX(5.2), -PX(14), PX(23), 0));
      g.add(b); return b;
    },
    headband(g, M_) {
      const c = M_('#cf3b31'), cD = M_('#8d1f18');
      const b = new T.Group();
      const r = mesh(GEO.torus, c, PX(18), PX(18), PX(18), 0, PX(17), 0);
      r.rotation.x = Math.PI / 2; b.add(r);
      b.add(mesh(GEO.box, cD, PX(4), PX(3), PX(18), PX(17), PX(17), PX(11)));
      b.add(mesh(GEO.box, cD, PX(4), PX(3), PX(18), PX(17), PX(17), -PX(11)));
      g.add(b); return b;
    },
    /* torso-local */
    tie(g, M_, y) {
      const c = M_('#8d3a34'), cD = M_('#5c221e'), st = M_('#d9d3bd');
      const b = new T.Group(); b.position.set(-PX(2), y, 0);
      b.add(mesh(GEO.box, c, PX(7), PX(6), PX(9), 0, 0, 0));
      let yy = -PX(6);
      for (let i = 0; i < 5; i++) {
        b.add(mesh(GEO.box, i % 2 ? st : c, PX(6 + i * 0.7), PX(6), PX(3), -PX(1.5), yy, 0));
        yy -= PX(6);
      }
      g.add(b); return b;
    },
    pads(g, M_, shoY) {
      const pad = M_('#e2ddcd'), padD = M_('#a8a292');
      const b = new T.Group();
      for (const s of [-1, 1]) {
        b.add(mesh(GEO.sphere, pad, PX(15), PX(9), PX(14), -PX(2), shoY + PX(4), s * PX(17)));
        b.add(mesh(GEO.sphere, padD, PX(14), PX(3), PX(13), -PX(2), shoY + PX(10), s * PX(17)));
      }
      g.add(b); return b;
    },
    /* held in the world, anchored on the body */
    screen(g, M_) {
      // PvZ screen door: PALE painted frame + see-through crosshatch mesh +
      // yellow kick panel — the mesh must read as SCREEN, not a plank slab.
      const frame = M_('#e8e2d2'), frameD = M_('#c9c2ad'), kick = M_('#e0b53c'),
            brass = M_('#e0b53c'), latch = M_('#4a4741');
      const b = new T.Group(); b.position.set(-PX(30), PX(60), 0); b.rotation.y = 0.45; b.rotation.z = 0.05;
      // stiles + head/sill rails (these cast the door's shadow)
      for (const s of [-1, 1]) b.add(mesh(GEO.box, frame, PX(5), PX(112), PX(9), 0, 0, s * PX(24)));
      b.add(mesh(GEO.box, frameD, PX(5), PX(9), PX(57), 0, PX(52), 0));   // head rail
      b.add(mesh(GEO.box, frameD, PX(5), PX(9), PX(57), 0, -PX(52), 0));  // sill rail
      // yellow kick panel across the bottom (the ref's strongest signifier)
      b.add(mesh(GEO.box, kick, PX(3), PX(18), PX(40), 0, -PX(38), 0));
      // translucent wire-mesh inset — a REAL weave: light veil + dark grid,
      // tight repeat so the grid survives minification. NO cast shadow.
      const meshTex = canvasTex(128, 128, (c, w, h) => {
        // DARK translucent fill + BRIGHT weave: dark against the light lawn,
        // light wire over the dark body behind it — the screen reads through
        c.clearRect(0, 0, w, h);
        c.fillStyle = 'rgba(38,46,42,0.62)'; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(200,214,206,0.95)'; c.lineWidth = 1.5;
        for (let i = -h; i < w + h; i += 4) {
          c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke();
          c.beginPath(); c.moveTo(i + h, 0); c.lineTo(i, h); c.stroke();
        }
      });
      meshTex.wrapS = meshTex.wrapT = T.RepeatWrapping; meshTex.repeat.set(9, 14);
      const screenMesh = new T.Mesh(GEO.box,
        new T.MeshBasicMaterial({ map: meshTex, transparent: true, alphaTest: 0.03, side: T.DoubleSide, depthWrite: false }));
      screenMesh.scale.set(PX(2), PX(86), PX(39));
      screenMesh.position.set(0, PX(8), 0);
      screenMesh.userData.noShadow = true;
      b.add(screenMesh);
      // knob + latch on opposite stiles
      b.add(mesh(GEO.sphere, brass, PX(4), PX(4), PX(4), -PX(4), -PX(30), PX(20)));
      b.add(mesh(GEO.box, latch, PX(3), PX(10), PX(3), -PX(4), PX(2), -PX(21)));
      return b;
    },
    paper(g, M_) {
      const p = M_('#e8e4d3'), ink = M_('#4a4741');
      const b = new T.Group(); b.position.set(-PX(28), PX(92), 0); b.rotation.y = 0.62;
      b.add(mesh(GEO.box, p, PX(3), PX(48), PX(54), 0, 0, 0));
      b.add(mesh(GEO.box, ink, PX(1.2), PX(6), PX(42), -PX(2), PX(17), 0));
      for (let i = 0; i < 6; i++) b.add(mesh(GEO.box, ink, PX(1), PX(2.4), PX(44), -PX(2), PX(9 - i * 6.4), 0));
      return b;
    },
    pole(g, M_) {
      const p = M_('#c9cfd6'), red = M_('#c0392b');
      const b = new T.Group(); b.position.set(-PX(12), PX(74), 0); b.rotation.z = 0.42;
      b.add(mesh(GEO.cylHi, p, PX(4), PX(126), PX(4), 0, 0, 0));
      b.add(mesh(GEO.cylHi, red, PX(4.6), PX(6), PX(4.6), 0, PX(40), 0));
      b.add(mesh(GEO.cylHi, red, PX(4.6), PX(6), PX(4.6), 0, PX(14), 0));
      b.add(mesh(GEO.sphere, p, PX(4.6), PX(3.6), PX(4.6), 0, PX(64), 0));
      return b;
    },
    pick(g, M_) {
      const w = M_('#a8763f'), m = M_('#9aa3ac');
      const b = new T.Group(); b.position.set(-PX(26), PX(64), 0); b.rotation.z = -0.5; b.rotation.y = 0.7;
      b.add(mesh(GEO.cylHi, w, PX(3.4), PX(70), PX(3.4), 0, 0, 0));
      b.add(mesh(GEO.box, m, PX(6), PX(7), PX(46), 0, PX(34), 0));
      b.add(mesh(GEO.coneHi, m, PX(4), PX(14), PX(4), 0, PX(40), PX(24)));
      return b;
    },
    flag(g, M_) {
      const p = M_('#c9cfd6'), c = M_('#c0392b'), cD = M_('#7f2018'), bone = M_('#ece8d6');
      // angled forward and yawed so the banner reads from the game camera
      const b = new T.Group(); b.position.set(-PX(18), PX(104), 0);
      b.rotation.z = -0.26; b.rotation.y = 0.85;
      b.add(mesh(GEO.cylHi, p, PX(3), PX(100), PX(3), 0, 0, 0));
      b.add(mesh(GEO.sphere, p, PX(4), PX(4), PX(4), 0, PX(52), 0));
      b.add(mesh(GEO.box, c, PX(2.5), PX(38), PX(52), 0, PX(30), -PX(27)));
      b.add(mesh(GEO.box, cD, PX(3.5), PX(38), PX(9), 0, PX(30), -PX(53)));
      b.add(mesh(GEO.sphere, bone, PX(9), PX(9), PX(5), -PX(3), PX(33), -PX(27)));
      b.add(mesh(GEO.sphere, cD, PX(2.6), PX(2.8), PX(2.6), -PX(6.5), PX(34), -PX(22)));
      b.add(mesh(GEO.sphere, cD, PX(2.6), PX(2.8), PX(2.6), -PX(6.5), PX(34), -PX(32)));
      return b;
    },
  };
  const HEAD_PROP_IDS = { cone: 1, bucket: 1, helmet: 1, hardhat: 1, headband: 1 };

  /* ================= THE BOSS (3D) =================
     The Don, modelled against the SAME rig contract as every other corpse —
     group / torso / head / legL / legR / armL / armR / mats / hipY / spec —
     so poseZombie() animates him with no special cases. Two extra handles
     come back: `rug` and `cap`, which poseZombie toggles straight from the
     live phase flags.

     SIZE IS DERIVED, NOT TYPED. The body is authored at rig scale and then
     normalised so its total height equals its OWN HIT BOX —
     (FIG_PX.crown + headwear) × roster scale. That one rule keeps the mesh
     and the projectile test in agreement however the roster is retuned, which
     is exactly the bug class that used to let shots sail through hats.
     It also makes him 2.3× a 3D zombie: the frame can hold him in rows 2-3,
     which is the only place he ever spawns. */
  function buildBossModel(z) {
    const ZT = G.ZT, BP = ZT.BOSS;
    const t = ZT.get(z.type);
    const g = new T.Group();          // transform root — what poseZombie drives
    const inner = new T.Group();      // the body; normalised to the hit box below
    g.add(inner);
    const mats = [];
    // Exposure compensation is calibrated for the ZOMBIE palettes (sickly
    // greens that need darkening against the dusk light). It shifts the hue
    // warm by ~12°, which turns the boss's orange skin GOLD and his navy suit
    // PURPLE — the two things his wardrobe must never be. The Don therefore
    // gets compensation that pushes saturation and level WITHOUT touching hue.
    const push = (col, s0, l0) => {
      const c = new T.Color(col); const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(1, hsl.s * s0), Math.max(0.02, hsl.l * l0));
      return c.getHex();
    };
    const M0 = c => { const m = toonZ(c); mats.push(m); return m; };          // straight
    const M_ = c => { const m = toonZ(push(c, 1.30, 0.92)); mats.push(m); return m; };   // cloth
    const MK = c => { const m = toonZ(push(c, 1.45, 0.78)); mats.push(m); return m; };   // skin
    const MH = c => { const m = toonZ(push(c, 1.75, 0.96)); mats.push(m); return m; };   // hair

    const mSuit = M_(BP.suit.base), mSuitD = M_(BP.suit.dark), mSuitL = M_(BP.suit.light);
    const mSuitX = M_(BP.suitD.base);
    const mPants = M_(BP.pants.base), mPantsD = M_(BP.pants.dark);
    const mSkin = MK(BP.skin.base), mSkinD = MK(BP.skin.dark), mSkinL = MK(BP.skin.light);
    const mShirt = M_(BP.shirt.base), mTie = M_(BP.tie.base);
    // hair is authored HERE, not taken from the palette: the palette's light
    // stop is near-white and the dusk key light bleaches it into a cream
    // bonnet, where the design wants GOLD
    const mHair = MH('#dcb43f'), mHairL = MH('#f7dc84'), mHairD = MH('#a9862c');
    const mHat = M_(BP.hat.base), mHatD = M_(BP.hat.dark);
    const mShoe = M_(BP.shoes.base), mEye = M_('#f6f2e4'), mPup = M_('#4a3520');
    const mMouth = M_('#7a3a34'), mDark = M_('#2a1a0c');

    /* ---------------- THE LAYOUT, MEASURED OFF THE REFERENCE ----------------
       One table, in sprite px above the ground, taken off the sticker this
       design is cut from (figure height 580px there, so every value is a
       FRACTION of him, not a taste):

         ankle 8 · knee 34 · HIP 64            → his legs are 27% of him
         belly centre 118, 48% of his height WIDE — wider than his shoulders
         chest 162 · shoulder line 168          → and the arms hang PAST the
         head pivot 170 (NO neck: the jowls land on the collar)   widest point
         crown 224 · hair crest 240             → the head is 23% of him, half
                                                  what a walker's reads as

       The joke IS the order of those numbers — an egg with a head on top —
       so every part is placed from this one table. A part that is typed twice
       is a part that drifts. */
    const LY = {
      hip: 64, knee: 34, ankle: 8,
      pelvis: 86, belly: 118, chest: 162, shoulder: 168, collar: 170,
      head: 170, crown: 224, crest: 240,
      armHalf: 56,               // the arms hang outside the belly's widest point
      shoulderZ: 40,
    };
    const hipY = PX(LY.hip);
    const shoulderZ = PX(LY.shoulderZ);
    const TY = v => PX(v) - hipY;        // "px above the ground" → torso-local y

    /* ---------------- legs: short, wide, and mostly trouser ----------------
       Two cylinders and a flared hem. Anything longer than a third of him
       stops reading as the reference's stubby base and starts reading as a
       man standing on stilts. */
    const mkLeg = (side, back) => {
      const grp = new T.Group();
      grp.position.set(side * PX(17), hipY, 0);
      const mat = back ? mPantsD : mPants;
      grp.add(mesh(GEO.cylHi, mat, PX(17), PX(30), PX(17), 0, -PX(15), 0));                           // thigh
      grp.add(mesh(GEO.sphere, mat, PX(18), PX(12), PX(18), 0, -PX(30), 0));                          // the trouser hem, flared
      grp.add(mesh(GEO.cylHi, mat, PX(13), PX(22), PX(13), 0, -PX(42), 0));                           // calf
      grp.add(mesh(GEO.sphere, back ? mDark : mShoe, PX(12), PX(6.5), PX(16), -PX(3), -PX(58), 0));   // small shoe, toe forward
      return grp;
    };
    const legL = mkLeg(1, false), legR = mkLeg(-1, true);
    inner.add(legL); inner.add(legR);

    /* ---------------- torso: the barrel ----------------
       Belly forward, shoulders square and wide, an open jacket with a shirt
       wedge and a tie that is far too long — the whole silhouette is the
       joke, so it has to read from the far lane. */
    const torso = new T.Group(); torso.position.set(0, hipY, 0);
    // hips — deliberately NARROW next to what is about to sit on them
    torso.add(mesh(GEO.sphere, mPants, PX(40), PX(26), PX(46), 0, TY(LY.pelvis), 0));
    // THE BELLY: an egg wider than his shoulders. This is the silhouette; if
    // the belly loses to the chest the whole caricature collapses back into a
    // barrel-shaped generic boss (which is what the old build read as).
    torso.add(mesh(GEO.sphereHi, mSuit, PX(47), PX(50), PX(58), -PX(2), TY(LY.belly), 0));
    // the jacket hem riding up over the waistband, and the shadow under the gut
    torso.add(mesh(GEO.sphere, mSuitX, PX(45), PX(9), PX(56), -PX(2), TY(74), 0));
    // chest + sloping shoulders — narrower than the gut, never wider, and
    // deliberately NARROWER THAN THE JOWLS at the head's own height so the
    // skull can turn and bob without the chest cutting through it
    torso.add(mesh(GEO.sphere, mSuit, PX(40), PX(30), PX(42), 0, TY(LY.chest - 4), 0));
    for (const s of [-1, 1]) {
      torso.add(mesh(GEO.sphere, mSuit, PX(19), PX(15), PX(19), -PX(2), TY(LY.shoulder - 5), s * shoulderZ));
    }
    // collar: mostly buried behind the jowls, which is the point
    const collar = mesh(GEO.torusHi, mShirt, PX(19), PX(19), PX(8), -PX(1), TY(LY.collar), 0);
    collar.rotation.x = Math.PI / 2; torso.add(collar);

    /* ---------------- arms: all shoulder, tiny hands ---------------- */
    /* Thick, short, and pinned to the outside of the gut (armHalf 56 is the
       belly's own half-width 58, minus a hair of overlap so the sleeve reads
       as PRESSED against him). The deltoid reaches back in toward the chest,
       or the arm floats beside the body like a separate sausage. */
    const mkArm = (side, back) => {
      const grp = new T.Group();
      grp.position.set(-PX(2), TY(LY.shoulder), side * PX(LY.armHalf));
      grp.rotation.x = side * 0.05;
      const mat = back ? mSuitD : mSuit;
      const matS = back ? mSkinD : mSkin;
      grp.add(mesh(GEO.sphere, mat, PX(20), PX(18), PX(20), 0, 0, -side * PX(12)));   // deltoid, into the chest
      grp.add(mesh(GEO.cylHi, mat, PX(15), PX(46), PX(15), 0, -PX(24), 0));          // sleeve
      grp.add(mesh(GEO.sphereLo, mat, PX(14), PX(12), PX(14), 0, -PX(48), 0));       // elbow
      grp.add(mesh(GEO.sphere, matS, PX(13), PX(11), PX(13), 0, -PX(50), 0));        // cuff
      grp.add(mesh(GEO.cylHi, matS, PX(12), PX(30), PX(12), 0, -PX(66), 0));         // bare forearm
      grp.add(mesh(GEO.sphere, matS, PX(13), PX(12), PX(14), 0, -PX(86), 0));        // the hand. yes, that one.
      for (let i = 0; i < 3; i++) {
        grp.add(mesh(GEO.sphere, matS, PX(3.4), PX(4.6), PX(3.6), -PX(5.5), -PX(96), (i - 1) * PX(6)));
      }
      return grp;
    };
    const armL = mkArm(1, false), armR = mkArm(-1, true);
    torso.add(armL); torso.add(armR);

    /* ---------------- head --------------
       Face features are pushed WELL forward of the skull centre and up out of
       the jaw: from a high, near-side game camera any detail that sits flush
       on the cranium is erased by the skull's own shading. The muzzle block
       is what the eyes and mouth sit on, so they get a plane of their own. */
    /* A SMALL head — 23% of him, where a walker's is 33% — with NO neck: the
       jowls land straight on the collar and the double chin hangs over it.
       Everything is authored at 1× (the old build scaled a walker-ish skull
       by 1.25, which is what made him read as tall instead of fat). */
    const head = new T.Group(); head.position.set(0, TY(LY.head), 0);
    head.add(mesh(GEO.sphere, mSkinD, PX(38), PX(16), PX(40), -PX(2), PX(4), 0));       // the double chin, ON the collar
    head.add(mesh(GEO.sphereHi, mSkin, PX(31), PX(24), PX(33), -PX(2), PX(14), 0));     // jowls — wider than the skull
    head.add(mesh(GEO.sphereHi, mSkin, PX(26), PX(25), PX(27), 0, PX(32), 0));          // cranium
    head.add(mesh(GEO.sphere, mSkin, PX(20), PX(15), PX(22), -PX(11), PX(20), 0));      // muzzle plane
    head.add(mesh(GEO.sphere, mSkinD, PX(16), PX(4.0), PX(22), -PX(9), PX(44), 0));     // brow ridge (a fold, not a bar)
    head.add(mesh(GEO.sphere, mSkin, PX(10.5), PX(9.5), PX(10.5), -PX(36), PX(26), 0)); // nose, proud of the decal
    head.add(mesh(GEO.sphere, mSkinL, PX(8), PX(7), PX(8), -PX(40), PX(23), 0));        // nose tip
    head.add(mesh(GEO.sphereLo, mMouth, PX(7), PX(2.6), PX(9), -PX(31), PX(13), 0));    // pursed mouth
    head.add(mesh(GEO.sphere, mSkinD, PX(7.5), PX(3.4), PX(9), -PX(26), PX(6), 0));     // chin
    // ears only: the EYES belong to the decal. Carved eyeballs and painted eyes
    // sat a few px apart and read as a second pair of dark holes.
    for (const s of [-1, 1]) {
      head.add(mesh(GEO.sphereLo, mSkin, PX(7), PX(8), PX(6), PX(3), PX(30), s * PX(28)));             // ear
    }

    /* ---------------- the FRONT ----------------
       A carved face and a carved shirt DO NOT SURVIVE THIS CAMERA. Every
       authored chest piece (shirt box, lapels, tie, collar) was modelled
       INSIDE the chest taper and the belly sphere, and the facial features sat
       flush on the skull — so at gameplay size the boss rendered as a
       featureless blue column under an orange dome. (Measured: zero readable
       tie, zero readable mouth, two eye dots.)

       The front is therefore a DECAL: a camera-facing plane standing proud of
       the volume it dresses. A plane cannot be swallowed by the body it is
       attached to, and the drawn outline is what makes the shape read at 1x.
       The geometry stays for the silhouette; the plane carries the identity. */
    const faceTex = canvasTex(256, 288, (c, w, h) => {
      const X = v => v * w, Y = v => v * h;
      c.clearRect(0, 0, w, h);
      c.lineJoin = 'round'; c.lineCap = 'round';
      const OUTL = '#2a1505';
      // brow ridge — a soft fold, NOT a black bar: the carved ridge is already
      // there, and two dark brows stack into a unibrow
      c.fillStyle = 'rgba(150,95,40,0.55)'; c.strokeStyle = 'rgba(42,21,5,0.55)'; c.lineWidth = 3;
      c.beginPath();
      c.moveTo(X(0.10), Y(0.30)); c.lineTo(X(0.92), Y(0.26));
      c.lineTo(X(0.90), Y(0.20)); c.lineTo(X(0.08), Y(0.235));
      c.closePath(); c.fill(); c.stroke();
      for (const [ex, sc] of [[0.31, 1.0], [0.70, 0.94]]) {
        // eye white, small and wide — a squint, not a saucer
        c.fillStyle = '#fbf8ee'; c.strokeStyle = OUTL; c.lineWidth = 3;
        c.beginPath(); c.ellipse(X(ex), Y(0.385), X(0.105) * sc, Y(0.052) * sc, 0, 0, TAU_); c.fill(); c.stroke();
        // pupil + catchlight
        c.fillStyle = '#3d2c18';
        c.beginPath(); c.ellipse(X(ex - 0.024), Y(0.385), X(0.030) * sc, Y(0.032) * sc, 0, 0, TAU_); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(X(ex + 0.012), Y(0.372), X(0.012), 0, TAU_); c.fill();
        // the LID: a filled skin-coloured hood that eats the top of the eye,
        // plus one firm line — the whole expression
        c.fillStyle = '#e0985a';
        c.beginPath();
        c.moveTo(X(ex - 0.125), Y(0.378));
        c.quadraticCurveTo(X(ex), Y(0.330), X(ex + 0.125), Y(0.376));
        c.lineTo(X(ex + 0.125), Y(0.318)); c.lineTo(X(ex - 0.125), Y(0.318));
        c.closePath(); c.fill();
        c.strokeStyle = 'rgba(58,32,8,0.92)'; c.lineWidth = 5;
        c.beginPath();
        c.moveTo(X(ex - 0.128), Y(0.378));
        c.quadraticCurveTo(X(ex), Y(0.334), X(ex + 0.128), Y(0.376));
        c.stroke();
      }
      // nose
      c.fillStyle = '#f0ae63'; c.strokeStyle = OUTL; c.lineWidth = 6;
      c.beginPath();
      c.moveTo(X(0.50), Y(0.52)); c.lineTo(X(0.66), Y(0.50));
      c.lineTo(X(0.60), Y(0.66)); c.lineTo(X(0.44), Y(0.62));
      c.closePath(); c.fill(); c.stroke();
      // mouth: small, pursed, unimpressed
      c.fillStyle = '#8c4a40';
      c.beginPath(); c.ellipse(X(0.40), Y(0.79), X(0.085), Y(0.022), 0, 0, TAU_); c.fill(); c.stroke();
      c.strokeStyle = OUTL; c.lineWidth = 4;
      c.beginPath();
      c.moveTo(X(0.24), Y(0.755)); c.quadraticCurveTo(X(0.40), Y(0.735), X(0.56), Y(0.775));
      c.stroke();
      // jowl crease
      c.strokeStyle = 'rgba(154,90,36,0.75)'; c.lineWidth = 6;
      c.beginPath();
      c.moveTo(X(0.86), Y(0.66)); c.quadraticCurveTo(X(0.66), Y(0.94), X(0.30), Y(0.90));
      c.stroke();
    });
    faceTex.center.set(0.5, 0.5);
    const facePlate = new T.Mesh(new T.PlaneGeometry(PX(52), PX(62)),
      new T.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }));
    facePlate.position.set(-PX(33), PX(30), 0);
    facePlate.rotation.y = -Math.PI / 2;
    facePlate.castShadow = false;
    head.add(facePlate);

    /* ---------------- the rug (phase 2) ---------------- */
    /* ---------------- the rug: a POMPADOUR ----------------
       The signature is a swept-back quiff that RISES off the forehead with
       volume over the crown — so the hair is TWO pieces: a flat mass for the
       cap to sit on, and the tall front lift, which the cap hides. (A cap
       squashes a quiff; it does not intersect it. Leaving the lift standing
       under the cap is exactly what made the hat look like it was bleeding
       into his skull.) */
    const rug = new T.Group();
    rug.add(mesh(GEO.sphere, mHair, PX(29), PX(14), PX(30), -PX(1), PX(46), 0));         // the crown mass
    rug.add(mesh(GEO.sphere, mHair, PX(15), PX(9), PX(17), PX(16), PX(40), 0));          // swept over the occiput
    for (const s of [-1, 1]) {
      rug.add(mesh(GEO.sphere, mHair, PX(11), PX(7), PX(9), -PX(6), PX(39), s * PX(23)));  // tight at the temples
    }
    const quiff = new T.Group();
    quiff.add(mesh(GEO.sphere, mHair, PX(21), PX(23), PX(25), -PX(15), PX(58), 0));      // the lift itself
    quiff.add(mesh(GEO.sphere, mHairL, PX(16), PX(13), PX(19), -PX(20), PX(68), 0));     // its lit crest
    quiff.add(mesh(GEO.sphere, mHairD, PX(14), PX(10), PX(20), -PX(25), PX(50), 0));     // the fold over the brow
    rug.add(quiff);
    rug.userData.quiff = quiff;
    head.add(rug);

    /* ---------------- the cap (phase 1, final boss / stage 5) ---------------- */
    const cap = new T.Group();
    cap.add(mesh(GEO.hemi, mHat, PX(31), PX(23), PX(32), 0, PX(51), 0));
    const brim = mesh(GEO.box, mHatD, PX(30), PX(5.2), PX(54), -PX(36), PX(51), 0);
    brim.rotation.z = 0.20; cap.add(brim);
    cap.add(mesh(GEO.sphere, mHat, PX(3.4), PX(3.4), PX(3.4), 0, PX(74), 0));  // button
    // the lettering, on a plane facing the game camera. The boss is yawed so
    // his -x side faces the lens, so the label (like the face) belongs on -x:
    // on +z it lands edge-on at his temple and the text is invisible.
    const label = canvasTex(512, 160, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.font = "900 118px 'Trebuchet MS', sans-serif";
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 18; c.strokeStyle = 'rgba(70,0,0,0.9)';
      c.strokeText('MAGA', w / 2, h / 2);
      c.fillStyle = '#ffffff';
      c.fillText('MAGA', w / 2, h / 2);
    });
    label.center.set(0.5, 0.5);
    const plate = new T.Mesh(new T.PlaneGeometry(PX(38), PX(16)),
      new T.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false, side: T.DoubleSide }));
    // proud of the dome: an earlier pass sat the plate INSIDE the cap's own
    // front surface and it never rendered at all.
    plate.position.set(-PX(42), PX(57), 0);
    plate.rotation.y = -Math.PI / 2;
    plate.castShadow = false;
    cap.add(plate);
    head.add(cap);

    torso.add(head);
    // ← the whole body hangs off this. Without it the torso, head, cap, rug
    // and arms are an ORPHAN group: built, visible-flagged, never in the scene
    // graph. (The same bug that hid the screen door — third time in this rig.)
    inner.add(torso);

    /* ---------------- the chest, as a decal ----------------
       Same reason as the face: every carved chest piece (shirt box, lapels,
       tie, collar) was authored INSIDE the chest taper and the belly sphere,
       so at gameplay size all five were invisible. A white shirt V, two lapels
       and a tie that is far too long, drawn on ONE camera-facing plane that
       stands proud of the jacket. */
    const chestTex = canvasTex(256, 352, (c, w, h) => {
      const X = v => v * w, Y = v => v * h;
      c.clearRect(0, 0, w, h);
      c.lineJoin = 'round';
      const OUTL = '#0e1730';
      c.fillStyle = '#f4f2e6'; c.strokeStyle = OUTL; c.lineWidth = 7;
      c.beginPath();                                   // shirt
      c.moveTo(X(0.72), Y(0.06)); c.lineTo(X(0.88), Y(0.94));
      c.lineTo(X(0.12), Y(0.94)); c.lineTo(X(0.28), Y(0.06));
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#1e2a49';                         // lapels
      for (const s of [1, -1]) {
        c.beginPath();
        c.moveTo(X(0.5 + s * 0.22), Y(0.04));
        c.lineTo(X(0.5 + s * 0.06), Y(0.34));
        c.lineTo(X(0.5 - s * 0.02), Y(0.92));
        c.lineTo(X(0.5 + s * 0.40), Y(0.30));
        c.closePath(); c.fill(); c.stroke();
      }
      c.fillStyle = '#f4f2e6';                         // collar
      c.beginPath();
      c.moveTo(X(0.20), Y(0.08)); c.lineTo(X(0.80), Y(0.08));
      c.lineTo(X(0.66), Y(0.00)); c.lineTo(X(0.34), Y(0.00));
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#c0272d';                         // the tie
      c.beginPath();
      c.moveTo(X(0.42), Y(0.10)); c.lineTo(X(0.58), Y(0.10));
      c.lineTo(X(0.62), Y(0.24)); c.lineTo(X(0.38), Y(0.24));
      c.closePath(); c.fill(); c.stroke();
      c.beginPath();
      c.moveTo(X(0.40), Y(0.24)); c.lineTo(X(0.60), Y(0.24));
      c.lineTo(X(0.66), Y(0.90)); c.lineTo(X(0.50), Y(0.99)); c.lineTo(X(0.34), Y(0.90));
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = 'rgba(126,18,22,0.5)';
      c.beginPath(); c.ellipse(X(0.50), Y(0.42), X(0.030), Y(0.16), 0.03, 0, TAU_); c.fill();
    });
    chestTex.center.set(0.5, 0.5);
    const chestPlate = new T.Mesh(new T.PlaneGeometry(PX(46), PX(66)),
      new T.MeshBasicMaterial({ map: chestTex, transparent: true, depthWrite: false }));
    chestPlate.position.set(-PX(53), TY(146), 0);
    chestPlate.rotation.y = -Math.PI / 2;
    chestPlate.castShadow = false;
    torso.add(chestPlate);

    /* ---------------- normalise to the hit box ----------------
       A rig WALKER measures PX(141) tall (Box3 of a built shambler against a
       168px FIG_PX.crown box — the mesh sits ~16% inside its own box, the same
       convention every zombie already uses). The boss is scaled against that
       number rather than against his own box, so `scale` keeps meaning the
       same thing in both render paths: "how many walkers tall he is". */
    inner.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(inner);
    const h0 = Math.max(1e-4, box.max.y - box.min.y);
    const WALKER3D_PX = 141;
    const targetPx = WALKER3D_PX * ((t.figCrown || ZT.FIG_PX.crown) / ZT.FIG_PX.crown) * (t.scale || 1);
    const S = PX(targetPx) / h0;
    inner.scale.setScalar(S);
    inner.position.y = -box.min.y * S;      // feet on the ground plane

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.traverse(o => { if (o.userData && o.userData.noShadow) o.castShadow = false; });

    return {
      group: g, mats, torso, head, legL, legR, armL, armR,
      headProp: null, held: null, rug, cap, isBoss: true,
      hipY, shoY: PX(LY.shoulder), headY: PX(LY.head) - hipY, spec: t,
    };
  }

  function buildZombieModel(z) {
    const ZT = G.ZT;
    const t = ZT.get(z.type);
    if (t.boss) return buildBossModel(z);
    const L = ZT.look(z.type, z.seed === undefined ? 3 : z.seed);
    const b = t.build, bulk = b.bulk;
    const g = new T.Group();
    const mats = [];
    const M_ = c => { const m = toonZ(expose(c)); mats.push(m); return m; };

    // personal grime tint, same rule as the 2D painter
    const tint = (col, f) => {
      const c = new T.Color(col);
      c.r = Math.min(1, c.r * f); c.g = Math.min(1, c.g * f); c.b = Math.min(1, c.b * f);
      return c.getHex();
    };
    const jf = L.grime;
    const mSkin = M_(tint(L.skin.base, jf)), mSkinD = M_(tint(L.skin.dark, jf)), mSkinL = M_(tint(L.skin.light, jf));
    const mCloth = M_(tint(L.suit.base, jf)), mClothD = M_(tint(L.suit.dark, jf));
    const mPants = M_(tint(L.pants.base, jf)), mPantsD = M_(tint(L.pants.dark, jf));
    const mShoe = M_('#4a3320'), mDark = M_('#2a2a22'), mBone = M_('#eae6d4');
    const mEye = M_('#f6f4e8'), mPup = M_('#201c18'), mMouth = M_('#3b1616');
    const mShirt = M_('#cdc6ab'), mTie = M_('#8d3a34'), mTieS = M_('#d9d3bd');

    const hipY = PX(56 * b.legLen);
    const shoY = hipY + PX(32);
    const shoW = PX(21 * b.shoulder * bulk);
    const legW = PX(7.4 * bulk);

    /* ---------------- legs (pivot at hip) ---------------- */
    const mkLeg = (side, back) => {
      const grp = new T.Group();
      grp.position.set(side * PX(6.5 * bulk), hipY, 0);
      const mat = back ? mPantsD : mPants;
      grp.add(mesh(GEO.capsule, mat, legW, PX(13), legW, 0, -PX(13), 0));      // thigh
      grp.add(mesh(GEO.sphereLo, mat, legW * 0.92, PX(5.6), legW * 0.92, 0, -PX(26), 0)); // knee
      grp.add(mesh(GEO.capsule, mat, legW * 0.82, PX(9), legW * 0.82, 0, -PX(36), 0));    // shin
      grp.add(mesh(GEO.box, back ? mDark : mShoe, PX(9), PX(3.4), PX(8), 0, -PX(45), 0)); // cuff
      grp.add(mesh(GEO.sphere, back ? mDark : mShoe, PX(8), PX(5), PX(12.5), -PX(3), -PX(51), 0)); // shoe
      return grp;
    };
    const legL = mkLeg(1, false), legR = mkLeg(-1, true);
    g.add(legL); g.add(legR);

    /* ---------------- torso (pivot at hip) ----------------
       Jacket silhouette: wide shoulders tapering to a pinched waist, a
       rounded shoulder cap each side, torn hem, then the open front —
       shirt V, lapels, tie — so the torso is a costume, not a barrel. */
    const torso = new T.Group(); torso.position.set(0, hipY, 0);
    torso.add(mesh(GEO.sphere, mPants, PX(14 * bulk), PX(11), PX(12.5), 0, PX(4), 0));         // pelvis
    torso.add(mesh(GEO.taper, mCloth, shoW, PX(31), PX(15.5), 0, PX(20), 0));                  // jacket
    for (const s of [-1, 1]) {
      torso.add(mesh(GEO.sphere, mCloth, PX(10 * bulk), PX(8.5), PX(9.5), -PX(1), PX(34), s * PX(13 * b.shoulder)));
    }
    torso.add(mesh(GEO.sphere, mClothD, shoW * 0.78, PX(5.5), PX(13.5), 0, PX(5), 0));         // torn hem
    // open jacket front: shirt V + two lapels
    torso.add(mesh(GEO.box, mShirt, PX(3), PX(24), PX(13), -PX(13.5), PX(22), 0));
    for (const s of [-1, 1]) {
      const lap = mesh(GEO.taper, mClothD, PX(4), PX(26), PX(2.6), -PX(14), PX(22), s * PX(6.5));
      lap.rotation.x = s * 0.30; lap.rotation.z = 0.16; torso.add(lap);
    }
    // collar roll
    const collar = mesh(GEO.torusHi, mClothD, PX(9.5), PX(9.5), PX(6), 0, PX(34), 0);
    collar.rotation.x = Math.PI / 2; torso.add(collar);
    if (t.props.includes('tie')) ZPROP3D.tie(torso, M_, PX(30));
    if (t.props.includes('pads')) ZPROP3D.pads(torso, M_, PX(32));

    /* ---------------- arms (pivot at shoulder, hang -y) ---------------- */
    const mkArm = (side, back) => {
      const grp = new T.Group();
      grp.position.set(-PX(2), PX(31), side * PX(13 * b.shoulder));
      const mat = back ? mClothD : mCloth;
      const matS = back ? mSkinD : mSkin;
      grp.add(mesh(GEO.sphere, mat, PX(8.5), PX(8), PX(8.5), 0, 0, 0));                      // shoulder
      grp.add(mesh(GEO.capsule, mat, PX(6.2), PX(10), PX(6.2), 0, -PX(13), 0));              // upper arm
      grp.add(mesh(GEO.sphereLo, mat, PX(6), PX(5.4), PX(6), 0, -PX(23), 0));                // elbow
      grp.add(mesh(GEO.capsule, matS, PX(5.2), PX(9), PX(5.2), 0, -PX(32), 0));              // forearm
      grp.add(mesh(GEO.sphere, matS, PX(6.6), PX(5.2), PX(7.6), 0, -PX(42), 0));             // mitt
      // fingers: boxes, not capsules — 36 tris instead of 300 each, and at
      // this size nobody can tell the difference
      for (let i = 0; i < 3; i++) {
        grp.add(mesh(GEO.box, matS, PX(3.4), PX(7.4), PX(3.8), -PX(1), -PX(49), (i - 1) * PX(4.2)));
      }
      return grp;
    };
    const armL = mkArm(1, false), armR = mkArm(-1, true);
    torso.add(armL); torso.add(armR);

    /* ---------------- head (pivot at neck) ----------------
       Head-local origin = top of the neck; the cranium is centred at
       +PX(15) and the figure tops out near PX(135), so the head is
       about a third of the zombie — the PopCap read. Face features are
       pushed out along -x and deliberately proud of the skull so they
       survive the 3/4 camera instead of sinking into the mesh. */
    const head = new T.Group(); head.position.set(0, PX(42), 0);
    const sk = b.headScale;
    head.add(mesh(GEO.cylHi, mSkinD, PX(6), PX(12), PX(6), 0, -PX(5), 0));                  // neck
    /* Skull: the cranium is only the top ~55% — the jaw and muzzle own the
       rest — so the face gets real estate instead of being cramped under a
       giant empty dome. Local crown lands at ~PX(31). */
    head.add(mesh(GEO.sphereHi, mSkin, PX(17 * sk), PX(16 * sk), PX(16.5 * sk), PX(1 * sk), PX(15 * sk), 0)); // cranium
    head.add(mesh(GEO.sphere, mSkin, PX(15 * sk), PX(13 * sk), PX(14.5 * sk), PX(4 * sk), PX(12 * sk), 0)); // occiput
    head.add(mesh(GEO.sphere, mSkin, PX(12 * sk), PX(8.5 * sk), PX(13.5 * sk), -PX(5 * sk), PX(4 * sk), 0));  // muzzle
    head.add(mesh(GEO.sphere, mSkin, PX(14 * sk), PX(10 * sk), PX(14 * sk), -PX(6 * sk), -PX(3 * sk), 0));    // jaw
    head.add(mesh(GEO.sphere, mSkinD, PX(8 * sk), PX(3.2 * sk), PX(9 * sk), -PX(10 * sk), -PX(11 * sk), 0));  // chin
    head.add(mesh(GEO.sphere, mSkinD, PX(14 * sk), PX(3.6 * sk), PX(16 * sk), PX(2 * sk), PX(20 * sk), 0));   // brow ridge
    head.add(mesh(GEO.sphere, mSkin, PX(5 * sk), PX(4.2 * sk), PX(5 * sk), -PX(17 * sk), PX(1 * sk), 0));     // nose
    // grin: dark cavity + a row of teeth over the lip
    head.add(mesh(GEO.sphereLo, mMouth, PX(8 * sk), PX(4.6 * sk), PX(10 * sk), -PX(13 * sk), -PX(4 * sk), 0));
    for (let i = 0; i < 4; i++) {
      head.add(mesh(GEO.box, mBone, PX(3.2), PX(3.6), PX(3.2), -PX(16 * sk), -PX(6.4 * sk), (i - 1.5) * PX(4.2)));
    }
    head.add(mesh(GEO.box, mBone, PX(3), PX(3), PX(3), -PX(16 * sk), -PX(0.6 * sk), -PX(2)));
    /* eyes: huge and bulging well proud of the skull. From this near
       side-on camera a flush eye disappears, so they sit forward of the
       muzzle and carry a fat dark pupil on their front face. */
    for (const s of [-1, 1]) {
      head.add(mesh(GEO.sphereLo, mSkin, PX(4.6 * sk), PX(5.4 * sk), PX(3.6 * sk), PX(2 * sk), PX(10 * sk), s * PX(16 * sk))); // ear
      head.add(mesh(GEO.sphereHi, mEye, PX(9 * sk), PX(9.6 * sk), PX(9.2 * sk), -PX(10.5 * sk), PX(9 * sk), s * PX(7 * sk)));
      head.add(mesh(GEO.sphereLo, mPup, PX(3.4 * sk), PX(3.6 * sk), PX(3.4 * sk), -PX(18.4 * sk), PX(8.2 * sk), s * PX(7.8 * sk)));
    }
    // hair tufts on the crown
    for (let i = 0; i < 4; i++) {
      const tuft = mesh(GEO.coneHi, mDark, PX(2.4), PX(9 + i), PX(2.4),
        PX(3) - PX(i * 2), PX(29 * sk), (i - 1.5) * PX(6.5));
      tuft.rotation.z = (i % 2 ? 0.3 : -0.2) + (i * 0.08);
      head.add(tuft);
    }
    // head armour / headwear
    let headProp = null;
    for (const pid of t.props) {
      if (HEAD_PROP_IDS[pid]) headProp = ZPROP3D[pid](head, M_);
    }
    torso.add(head);
    // head carries a global size bump (and takes its headwear with it)
    head.scale.setScalar(1.08);

    /* ---------------- held props ---------------- */
    let held = null;
    for (const pid of ['screen', 'paper', 'pole', 'pick', 'flag']) {
      if (t.props.includes(pid)) held = ZPROP3D[pid](g, M_);
    }
    // The held-prop builders only RETURN their group — unlike the head props
    // they never g.add() it themselves, so without this line the door (and
    // paper/pole/flag) floated as an orphan: visible-flagged but never in
    // the scene graph, therefore never rendered.
    if (held) g.add(held);

    g.add(torso);
    g.scale.setScalar(t.scale * 1.07);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    g.traverse(o => { if (o.userData && o.userData.noShadow) o.castShadow = false; });

    return {
      group: g, mats, torso, head, legL, legR, armL, armR,
      headProp, held, baseSkin: L.skin,
      hipY, shoY, spec: t,
    };
  }

  function buildZombieBlob(z) {
    const t = z && G.ZT ? G.ZT.get(z.type) : null;
    if (t && t.boss) return makeBlob(PX(46 * (t.scale || 1)));
    return makeBlob(PX(17 * (t ? t.build.bulk : 1)));
  }

  function buildPultModel() {
    const g = new T.Group();
    const mats = [];
    const M_ = (c) => { const m = toon(c); mats.push(m); return m; };
    const mPot = M_(0xb85c2e), mPotD = M_(0x94461e), mWood = M_(0x8a6a3c), mWoodD = M_(0x6e522e);
    const mGreen = M_(0x3e8c38), mLeaf = M_(0x4aa440);

    // pot — squashed urn, reads from the high camera; face toward +z (camera)
    const pot = mesh(GEO.sphere, mPot, PX(40), PX(30), PX(34), 0, PX(26), 0);
    g.add(pot);
    g.add(mesh(GEO.cyl, mPotD, PX(26), PX(10), PX(26), 0, PX(5), 0));
    // soil + rim on top
    g.add(mesh(GEO.cyl, M_(0x5a4028), PX(30), PX(6), PX(27), 0, PX(48), 0));
    // vine leaves hugging the urn shoulders
    for (const [a, s] of [[0.5, 1.15], [2.4, 1.25], [4.1, 1.0]]) {
      const leaf = mesh(GEO.sphere, mLeaf, PX(13) * s, PX(4.5), PX(9) * s, Math.cos(a) * PX(34), PX(42), Math.sin(a) * PX(28) * 0.8 + PX(6));
      leaf.rotation.y = -a;
      g.add(leaf);
    }
    // BIG face on +z side (toward the camera) — must read at gameplay scale
    const mEye = M_(0xf8f5ea), mPup = M_(0x14140e), mBrow = M_(0x2e5a28);
    g.add(mesh(GEO.sphere, mEye, PX(8), PX(9.5), PX(6), PX(14), PX(30), PX(30)));
    g.add(mesh(GEO.sphere, mEye, PX(8), PX(9.5), PX(6), -PX(14), PX(30), PX(30)));
    g.add(mesh(GEO.sphere, mPup, PX(3.4), PX(3.8), PX(2.6), PX(14), PX(30), PX(34.5)));
    g.add(mesh(GEO.sphere, mPup, PX(3.4), PX(3.8), PX(2.6), -PX(14), PX(30), PX(34.5)));
    // brows — determined angle
    g.add(mesh(GEO.box, mBrow, PX(13), PX(3), PX(3.4), PX(14), PX(39), PX(32)));
    g.add(mesh(GEO.box, mBrow, PX(13), PX(3), PX(3.4), -PX(14), PX(39), PX(32)));
    // mouth — grit
    g.add(mesh(GEO.box, M_(0x54301a), PX(16), PX(4), PX(3), 0, PX(15), PX(33)));
    // leafy hair tuft
    g.add(mesh(GEO.sphere, mLeaf, PX(11), PX(5.5), PX(7), PX(6), PX(52), PX(4)));

    // yoke + axle
    g.add(mesh(GEO.box, mWoodD, PX(6), PX(42), PX(4), -PX(8), PX(62), PX(13)));
    g.add(mesh(GEO.box, mWoodD, PX(6), PX(42), PX(4), -PX(8), PX(62), -PX(13)));
    g.add(mesh(GEO.cyl, mWood, PX(3), PX(30), PX(3), -PX(8), PX(80), 0));
    R3._pultAxle = new T.Vector3(-PX(8), PX(80), 0);

    // throwing arm (pivot at axle, points +x)
    const arm = new T.Group();
    arm.position.copy(R3._pultAxle);
    arm.add(mesh(GEO.box, mWood, PX(66), PX(6.5), PX(6.5), PX(29), 0, 0));
    // scoop basket at tip
    arm.add(mesh(GEO.box, mWoodD, PX(15), PX(3.4), PX(19), PX(60), -PX(2.5), 0));
    arm.add(mesh(GEO.box, mWoodD, PX(2.6), PX(7), PX(19), PX(66.5), 0, 0));
    arm.add(mesh(GEO.box, mWoodD, PX(2.6), PX(7), PX(19), PX(53.5), 0, 0));
    // counterweight
    arm.add(mesh(GEO.box, M_(0x4c4c54), PX(12), PX(11), PX(11), -PX(11), -PX(5), 0));
    g.add(arm);

    // held melon in scoop
    const heldMelon = new T.Mesh(GEO.melon, melonMaterial());
    heldMelon.scale.setScalar(PX(15));
    heldMelon.position.set(PX(60), PX(5), 0);
    heldMelon.castShadow = true;
    arm.add(heldMelon);

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { group: g, arm, heldMelon, mats };
  }

  function buildTombstoneModel(dmg) {
    // Proportional to the cast: a walker renders ≈16.5wu tall (Box3), so the
    // stone stands ≈9.4wu — 0.57×, the PvZ gravestone read. (The old 4.2wu
    // model made gameplay stones read as pebbles next to the zombies they
    // share a lane with.) STONE_BLOCK_H in game.js is the same height in
    // Board units, so the block ceiling sits just above the visible cap —
    // the same mesh-sits-inside-its-box convention every zombie uses.
    const g = new T.Group();
    const mStone = toon(0x9aa396), mStoneD = toon(0x7d867a);
    g.add(mesh(GEO.box, mStone, PX(46), PX(60), PX(10), 0, PX(30), 0));
    const top = mesh(GEO.cyl, mStone, PX(23), PX(9), PX(23), 0, PX(60), 0);
    top.rotation.x = Math.PI / 2;
    g.add(top);
    g.add(mesh(GEO.box, mStoneD, PX(56), PX(6), PX(15), 0, PX(3), 0));
    if (dmg > 0) g.rotation.z = 0.06 * dmg;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* ================= BOARD CALIBRATION ================= */
  function project(v3) {
    const p = v3.clone().project(R3.camera);
    return { x: (p.x * 0.5 + 0.5) * 1280, y: (-p.y * 0.5 + 0.5) * 720 };
  }
  R3.project = project;

  function calibrateBoard() {
    const B = G.Board;
    for (let r = 0; r < 4; r++) {
      const p0 = project(worldPos(4.5, r, 0));
      const p1 = project(worldPos(5.5, r, 0));
      B.laneY[r] = p0.y;
      // TRUE projected scale — no normalisation: every world-anchored overlay
      // (popups, bars, aim arc) must sit exactly on the 3D meshes.
      B.rowScale[r] = (p1.x - p0.x) / B.colW;
    }
  }

  /* ================= POINTER ================= */
  const _ray = new T.Raycaster();
  const _ndc = new T.Vector2();
  const _ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
  R3.pointerToU = function (mx, my) {
    _ndc.set((mx / 1280) * 2 - 1, -(my / 720) * 2 + 1);
    _ray.setFromCamera(_ndc, R3.camera);
    const hit = new T.Vector3();
    if (!_ray.ray.intersectPlane(_ground, hit)) return null;
    return hit.x / COL_W3D + 4.5;
  };

  /* ================= ANIM HELPERS ================= */
  const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);

  /* Per-gait amplitudes, mirrored from the 2D GAITS table.
     In 3D a limb hangs along -y, so a POSITIVE z-rotation swings it
     toward +x (backwards — zombies face -x). Forward arm reach is
     therefore negative; hips are symmetric so the sign only picks
     which leg leads. */
  const GAIT3D = {
    shamble: { step: 0.55, bob: 1.6, sway: 0.050, arm: 0.55, base: -0.92, baseB: -1.30, jaw: 1.0 },
    plod: { step: 0.40, bob: 2.2, sway: 0.035, arm: 0.34, base: -1.00, baseB: -1.42, jaw: 0.7 },
    lurch: { step: 0.34, bob: 1.0, sway: 0.020, arm: 0.06, base: -1.10, baseB: -1.44, jaw: 0.5 },
    trudge: { step: 0.42, bob: 1.6, sway: 0.030, arm: 0.10, base: -1.26, baseB: -0.86, jaw: 0.4 },
    trot: { step: 0.72, bob: 2.4, sway: 0.045, arm: 0.85, base: -0.70, baseB: -1.16, jaw: 1.3 },
    stomp: { step: 0.62, bob: 2.8, sway: 0.060, arm: 0.45, base: -0.80, baseB: -1.30, jaw: 0.8 },
    march: { step: 0.60, bob: 2.0, sway: 0.038, arm: 0.50, base: -0.78, baseB: -1.34, jaw: 0.9 },
  };
  /* the pelvis slides back as the head leads forward, pivoting at mid-torso;
     a pure hip pivot would just tilt the whole body like a plank */
  const HUNCH_LEAN = { shamble: 0.26, plod: 0.34, lurch: 0.14, trudge: 0.22, trot: 0.13, stomp: 0.18, march: 0.20 };

  function poseZombie(model, z, time) {
    const { group, torso, head, legL, legR, armL, armR, mats, spec } = model;
    const s = z.seed, state = z.state;
    const gg = GAIT3D[spec.gait] || GAIT3D.shamble;
    const b = spec.build;
    let headProp = model.headProp, held = model.held;
    if (headProp && !model._hpBase) model._hpBase = headProp.rotation.clone();
    if (held && !model._heldBase) model._heldBase = held.rotation.clone();

    // base transform — a slight yaw turns the face toward the camera, so
    // we read eyes and grin instead of a pure profile (the PvZ framing)
    const wp = worldPos(z.u, z.row, 0);
    group.position.set(wp.x, 0, wp.z);
    const BASE_YAW = (R3.baseYaw === undefined ? 0.46 : R3.baseYaw);
    // The boss turns further. He is built deep in x (belly to back) and at the
    // walker's yaw that depth reads as a sideways slab — a quarter-turn brings
    // the chest, the tie and the swoop round to face the player.
    const YAW = model.isBoss ? 1.35 : BASE_YAW;

    // reset accumulative channels
    torso.rotation.set(0, 0, 0);
    torso.position.set(0, model.hipY, 0);
    torso.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0);
    group.rotation.set(0, YAW, 0);
    group.position.y = 0;
    let opacity = 1;

    // headwear follows the helmet flag; held gear follows the front-armour flag
    if (headProp) {
      headProp.visible = !!z.helmet;
      headProp.rotation.copy(model._hpBase);
      const dents = headProp.userData.dents;
      if (dents) {   // bucket: dents + tint + tilt — the armour is the health bar
        const hits0 = z.spec.headArmor ? z.spec.headArmor.hits : 1;
        const frac = (z.helmetHits || 0) / hits0;
        dents[0].visible = frac <= 0.8;
        dents[1].visible = frac <= 0.6;
        dents[2].visible = frac <= 0.4;
        // the whole bucket tilts further askew with every hit
        headProp.rotation.z = model._hpBase.z + (1 - frac) * 0.28;
        // and the metal darkens as it beats in
        const tint = headProp.userData.tint;
        if (tint) tint.color.setHex(0xb6bfc8).multiplyScalar(0.5 + 0.5 * frac);
      }
    }
    if (held) {
      const alwaysCarried = !spec.frontArmor;      // flag zombie never drops it
      held.visible = alwaysCarried || !!z.shield;
      held.rotation.copy(model._heldBase);
      held.scale.set(1, 1, 1);
      if (!alwaysCarried && spec.frontArmor.kind === 'pole' && z.poleBroken) {
        held.rotation.z = model._heldBase.z + 0.45;
        held.scale.set(1, 0.48, 1);
      }
    }
    // ---- the boss's two knock-off phases. Visibility only: the geometry is
    // built once and the piece is SUBTRACTED from the model when it is gone,
    // so the silhouette changes with the fight instead of being repainted.
    if (model.rug) {
      model.rug.visible = !!z.toupeeOn;
      // the cap flattens the quiff rather than intersecting it
      if (model.rug.userData.quiff) model.rug.userData.quiff.visible = !z.magaOn;
    }
    if (model.cap) model.cap.visible = !!z.magaOn;

    const idle = Math.sin(time * 2.2 + s);
    const hunch = b.hunch + (HUNCH_LEAN[spec.gait] || 0.2);
    // pelvis slides back as the head leads forward
    const hipSetback = Math.sin(hunch) * PX(11);

    if (state === 'spawn') {
      const k = clamp01(z.spawnT / 0.55);
      group.position.y = (1 - k) * PX(60);
      opacity = k;
    } else if (state === 'hold') {
      const br = Math.sin(time * 2.2 + s) * 0.03;
      torso.scale.set(1 + br, 1 + br * 0.6, 1 + br);
      torso.rotation.z = hunch + Math.sin(time * 1.1 + s) * 0.025;
      torso.position.x = hipSetback;
      armL.rotation.z = gg.base + Math.sin(time * 1.3 + s) * 0.09;
      armR.rotation.z = (gg.baseB || gg.base) + Math.sin(time * 1.3 + s + 1) * 0.08;
      head.rotation.z = Math.sin(time * 0.9 + s) * 0.05;
      // headY comes from the model: the walker's head is authored at PX(42) so
      // this used to be a no-op for him — but it silently yanked the BOSS's
      // (smaller, lower) head down by 14px on every idle frame.
      head.position.y = (model.headY === undefined ? PX(42) : model.headY)
        + Math.sin(time * 2.2 + s) * PX(0.8);
      head.rotation.x = Math.sin(time * 1.5 + s * 2) * 0.06;
      legL.rotation.z = -0.10; legR.rotation.z = 0.13;
      group.position.y = idle * PX(1.2);
      // ---- the boss's idle bits: accordion hands, the YMCA (game.js rolls
      // the schedule; this only poses). A hit clears idleKind and the
      // standard hold pose flows straight back.
      if (z.gripeK > 0.02) {
        // the HOWL: both arms flung skyward, shaking — the body shows the rage
        const k = Math.min(1, z.gripeK * 1.6);
        const shake = Math.sin(time * 27) * 0.12 * k;
        armL.rotation.z = (-2.35 + shake) * k + armL.rotation.z * (1 - k);
        armR.rotation.z = (2.4 - shake) * k + armR.rotation.z * (1 - k);
        armL.rotation.x = -0.3 * k; armR.rotation.x = -0.3 * k;
        head.rotation.x = -0.25 * k;
        head.rotation.z += shake * 0.8;
      } else if (z.idleKind === 'accordion') {
        const pump = Math.sin(z.idleT * 8.5);
        armL.rotation.z = -1.14 + pump * 0.24; armL.rotation.x = -0.42;
        armR.rotation.z = -1.2 - pump * 0.24; armR.rotation.x = -0.42;
        head.rotation.z += pump * 0.09;
        torso.rotation.z += pump * 0.03;
      } else if (z.idleKind === 'ymca') {
        const letter = Math.floor(z.idleT / 0.85) % 4;
        const bop = Math.sin(z.idleT * 10) * 0.09;
        // Y — high V · M — hands at the hat · C — swept to one side · A — dome.
        // MIRRORED vs the canvas painter: three.js +z on armL lifts it, where
        // the 2D rig needs negative — prove the sign with a probe, not hope.
        const set = letter === 0 ? [2.55, -2.55]
          : letter === 1 ? [2.9, -2.9]
          : letter === 2 ? [2.1, -2.6]
          : [3.0, -3.0];
        armL.rotation.z = set[0] + bop;
        armR.rotation.z = set[1] - bop;
        head.rotation.z += bop * 0.7;
        group.position.y += Math.abs(Math.sin(z.idleT * 5)) * PX(2.2);
      }
    } else if (state === 'walk') {
      const ph = z.walkPhase;
      const s1 = Math.sin(ph);
      const legSw = s1 * gg.step;
      legL.rotation.z = legSw; legR.rotation.z = -legSw;
      legL.rotation.x = Math.cos(ph) * 0.10; legR.rotation.x = -Math.cos(ph) * 0.10;
      torso.rotation.z = hunch + s1 * gg.sway;
      torso.position.x = hipSetback;
      armL.rotation.z = gg.base + Math.sin(ph + Math.PI) * gg.arm;
      armR.rotation.z = (gg.baseB || gg.base) + Math.sin(ph) * gg.arm * 0.75;
      head.rotation.z = Math.sin(ph * 2 + 0.5) * 0.055;
      group.position.y = Math.abs(s1) * PX(gg.bob);
      head.rotation.y = Math.sin(ph) * 0.07;
    } else if (state === 'kneel') {
      legL.rotation.z = 1.15; legR.rotation.z = 1.35;
      legL.rotation.x = 0.5; legR.rotation.x = 0.55;
      group.position.y = -PX(24);
      torso.rotation.z = hunch + 0.42;
      torso.position.x = hipSetback;
      armL.rotation.z = -0.35; armR.rotation.z = -0.55;
      head.rotation.z = -0.30;
      head.rotation.x = 0.25;
    } else if (state === 'die') {
      const k = clamp01(z.dieT / 0.7);
      group.rotation.z = -k * 1.45;                 // tip backwards, away from -x
      group.position.y = -PX(4) * k;
      legL.rotation.z = 0.4 * k; legR.rotation.z = -0.3 * k;
      armL.rotation.z = -1.4 * k; armR.rotation.z = -1.2 * k;
      head.rotation.z = -0.5 * k;
      opacity = z.dieT > 1.1 ? Math.max(0, 1 - (z.dieT - 1.1) / 0.5) : 1;
    } else if (state === 'hang') {
      // dangling from the chopper's harness — kicking, swinging, undignified
      const sw = Math.sin(time * 2.4 + s) * 0.16;
      const kick = Math.sin(time * 7.3 + s) * 0.4;
      group.rotation.z = sw;
      torso.rotation.z = hunch * 0.35;
      torso.position.x = hipSetback;
      armL.rotation.z = 0.5 + Math.sin(time * 5.1) * 0.3; armR.rotation.z = -0.4 - Math.sin(time * 4.6) * 0.3;
      legL.rotation.z = 0.3 + kick; legR.rotation.z = -0.25 - kick * 0.7;
      legL.rotation.x = 0.2; legR.rotation.x = -0.14;
      head.rotation.z = sw * 0.8;
    } else if (state === 'glorydie') {
      const k = z.dieT;
      group.rotation.y = YAW + k * 9;
      group.position.y = Math.sin(Math.min(1, k / 0.55) * Math.PI) * PX(26);
      if (k > 0.55) group.rotation.z = clamp01((k - 0.55) / 0.4) * 1.5;
      opacity = k > 1.0 ? Math.max(0, 1 - (k - 1.0) / 0.6) : 1;
    }

    // enraged newspaper zombie: lower head, arms pumping
    if (z.angry) {
      torso.rotation.z += 0.10;
      head.rotation.z -= 0.10;
    }

    // hit flash
    const hf = z.hitFlash;
    for (const m of mats) {
      if (hf > 0) { m.emissive.setRGB(0.8 * hf, 0.05 * hf, 0.05 * hf); }
      else m.emissive.setRGB(0, 0, 0);
    }

    // wobbles
    if (headProp) {
      if (z.helmetWobble > 0.01) headProp.rotation.z = model._hpBase.z + Math.sin(time * 42) * z.helmetWobble * 0.9;
    }
    if (held) {
      if (z.shieldWobble > 0.01) held.rotation.z = model._heldBase.z + Math.sin(time * 38) * z.shieldWobble * 0.8;
    }
    if (z.lean) group.rotation.z += z.lean * 0.3;

    // boss lane jump: eased lateral arc between the lane lines, legs tucked,
    // arms out for balance, a takeoff stretch and a landing impact squash.
    // The row flips only on landing (game.js) — this arc IS the animation.
    if (z.isBoss && z.jumpT < 1) {
      const k = z.jumpT;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const za = worldPos(z.u, z.jumpFrom, 0).z, zb = worldPos(z.u, z.jumpTo, 0).z;
      group.position.z = za + (zb - za) * e;
      // scaled by the boss's own size — a fixed hop vanishes on a 24-wu figure
      group.position.y += Math.sin(k * Math.PI) * PX(112) * (z.spec.scale || 1);
      const tuck = Math.sin(k * Math.PI);
      legL.rotation.z += 0.55 * tuck; legR.rotation.z -= 0.45 * tuck;
      legL.rotation.x += 0.3 * tuck; legR.rotation.x += 0.3 * tuck;
      armL.rotation.z = -0.7 * tuck; armR.rotation.z = 0.7 * tuck;
      const sq = Math.sin(clamp01(k / 0.2) * Math.PI) * 0.8 - Math.sin(clamp01((k - 0.75) / 0.25) * Math.PI) * 1.0;
      torso.scale.x *= 1 + sq * 0.10; torso.scale.y *= 1 - sq * 0.12;
    }
    if (z.isBoss && z.landSquash > 0.01) {
      torso.scale.x *= 1 + z.landSquash * 0.13;
      torso.scale.y *= 1 - z.landSquash * 0.15;
      group.position.y -= z.landSquash * PX(5);
    }

    // Boss shake — the toupee/hit convulsion. The 2D painter does this with a
    // canvas translate; here the whole rig is thrown, root rotation plus a
    // vertical jolt, so the overlays and the mesh stay locked together.
    if (z.isBoss && z.shakeAmp > 0.02) {
      const k = Math.min(2.6, z.shakeAmp);
      group.rotation.z += Math.sin(time * 57) * 0.05 * k;
      group.rotation.y += Math.sin(time * 47 + 0.8) * 0.04 * k;
      group.position.y += Math.sin(time * 43 + 1.7) * PX(6) * k;
    }

    // transparency only when needed
    const wantT = opacity < 0.999;
    for (const m of mats) {
      m.transparent = wantT;
      m.opacity = opacity;
    }
  }

  function posePult(model, p, game, time) {
    const { group, arm, heldMelon } = model;
    const wp = worldPos(G.Board.pultU, p.row, 0);
    group.position.set(wp.x, p.hopY * K, wp.z);

    // lean & squash
    group.rotation.z = 0;
    const k = clamp01(p.jumpT);
    const dir = p.jumpTo > p.jumpFrom ? 1 : -1;
    let lean = p.jumpT < 1 ? Math.sin(p.jumpT * Math.PI) * 0.30 * dir : 0;
    if (p.landSquash > 0) lean += Math.sin((1 - p.landSquash) * Math.PI) * 0.10 * Math.pow(p.landSquash, 0.6) * dir;
    group.rotation.z = -lean;
    const breath = Math.sin(time * 2.2) * 0.03;
    const squash = breath + (p.charging ? -p.charge * 0.5 : 0) - p.recoil * 0.6
      + (p.jumpT < 1 ? (Math.sin(clamp01(p.jumpT / 0.20) * Math.PI) * 1.0
        - Math.sin(clamp01((p.jumpT - 0.20) / 0.55) * Math.PI) * 0.75
        + Math.sin(clamp01((p.jumpT - 0.75) / 0.25) * Math.PI) * 1.1) : 0)
      + p.landSquash * 0.9;
    group.scale.set(1 + squash * 0.12, 1 - squash * 0.14, 1);
    if (p.dead) {
      group.rotation.z = Math.min(1.4, p.deathT * 3);
    }

    // arm: the shared catapult cycle from game.armAngle — ready, wind back and
    // LOW, whip forward and HIGH, settle. No snap: the power stroke is timed.
    arm.rotation.z = game.armAngle(p);

    heldMelon.visible = p.holding && !p.dead;
    // STRONG THROW glow — the scoop melon lights up only while the shot is
    // in the strong window (aim > 45°, charge between HIGH ARC marker and MAX)
    if (model.heldMelon.material.emissive) {
      if (game.strongWindow()) {
        const gp = 0.55 + 0.35 * Math.sin(time * 12);
        model.heldMelon.material.emissive.setRGB(0.4 * gp, 1.0 * gp, 0.2 * gp);
        model.heldMelon.scale.setScalar(PX(15) * (1 + gp * 0.22));   // bloom owns the silhouette
      } else {
        model.heldMelon.material.emissive.setRGB(0, 0, 0);
        model.heldMelon.scale.setScalar(PX(15));
      }
    }
    if (p.blink > 0) {
      model.mats[4] && 0; // eyes are spheres; blink via scale below
    }
    if (model.eyeL) {
      const bl = p.blink > 0 ? 0.15 : 1;
      model.eyeL.scale.y = PX(6) * bl;
      model.eyeR.scale.y = PX(6) * bl;
    }
  }

  /* ================= THE CHOPPER (3D) =================
     A light utility helicopter, modelled the way the real thing reads from
     ABOVE and from the side: a teardrop cabin with a glazed nose, the engine
     deck stepped up behind it, a tapering tail boom carrying a swept fin, a
     stabiliser and its own little rotor, a mast with a four-blade head — plus
     the blur disc those blades leave — and two skids on splayed struts.
     Nose = −x, the convention every other rig here uses, so ONE yaw aims it. */
  function buildHeli3D() {
    const g = new T.Group();
    const mats = [];
    const M_ = c => { const m = toon(c); mats.push(m); return m; };
    const mBody = M_(0x33405a), mBodyD = M_(0x1d2534), mBelly = M_(0xd7dce2);
    const mGlass = M_(0x86bcdd), mTrim = M_(0xc0272d), mMetal = M_(0x9aa2ac);
    const mDark = M_(0x23282e), mRotor = M_(0x2b3140);

    // a tube lying along x — a boom, an exhaust or a mast that is not a post
    const tube = (mat, r0, r1, len, x, y, z) => {
      const m = new T.Mesh(new T.CylinderGeometry(r0, r1, len, 16), mat);
      m.rotation.z = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true;
      return m;
    };

    /* ---- fuselage ---- */
    g.add(mesh(GEO.sphere, mBody, PX(46), PX(36), PX(32), PX(6), 0, 0));          // cabin
    g.add(mesh(GEO.sphere, mBelly, PX(38), PX(15), PX(27), PX(2), -PX(24), 0));   // pale underside
    g.add(mesh(GEO.sphere, mBody, PX(30), PX(23), PX(25), -PX(40), -PX(4), 0));   // nose
    g.add(mesh(GEO.sphere, mGlass, PX(25), PX(16), PX(22), -PX(34), PX(8), 0));   // canopy
    g.add(mesh(GEO.sphere, mGlass, PX(13), PX(11), PX(17), -PX(8), PX(7), 0));    // side window
    g.add(mesh(GEO.box, mTrim, PX(56), PX(5), PX(33), PX(2), -PX(9), 0));         // livery stripe

    /* ---- engine deck, stepped up behind the cabin ---- */
    g.add(mesh(GEO.box, mBodyD, PX(48), PX(15), PX(27), PX(24), PX(26), 0));
    g.add(mesh(GEO.sphere, mMetal, PX(18), PX(7), PX(19), PX(22), PX(34), 0));    // gearbox fairing
    g.add(tube(mDark, PX(4.5), PX(4.5), PX(16), PX(50), PX(26), PX(7)));          // exhausts
    g.add(tube(mDark, PX(4.5), PX(4.5), PX(16), PX(50), PX(26), -PX(7)));

    /* ---- tail: boom, swept fin, stabiliser ---- */
    g.add(tube(mBody, PX(9), PX(4.5), PX(74), PX(78), PX(6), 0));
    const fin = mesh(GEO.box, mBodyD, PX(12), PX(34), PX(4), PX(110), PX(22), 0);
    fin.rotation.z = 0.22; g.add(fin);
    g.add(mesh(GEO.box, mTrim, PX(10), PX(9), PX(4.6), PX(108), PX(38), 0));      // fin flash
    g.add(mesh(GEO.box, mBodyD, PX(9), PX(3), PX(34), PX(96), PX(4), 0));         // stabiliser

    /* ---- tail rotor: two teetering blades, spinning in the y/z plane ---- */
    const tailRotor = new T.Group();
    tailRotor.position.set(PX(114), PX(24), PX(7));
    for (let i = 0; i < 2; i++) {
      const arm = new T.Group(); arm.rotation.x = (i / 2) * Math.PI;
      arm.add(mesh(GEO.box, mRotor, PX(3), PX(30), PX(1.8), 0, PX(15), 0));
      arm.add(mesh(GEO.box, mRotor, PX(3), PX(30), PX(1.8), 0, -PX(15), 0));
      tailRotor.add(arm);
    }
    g.add(tailRotor);

    /* ---- main rotor head ---- */
    g.add(mesh(GEO.cyl, mMetal, PX(6), PX(18), PX(6), 0, PX(38), 0));            // mast
    const rotor = new T.Group();
    rotor.position.set(0, PX(48), 0);
    for (let i = 0; i < 4; i++) {
      const arm = new T.Group(); arm.rotation.y = (i / 4) * Math.PI * 2;
      const bl = mesh(GEO.box, mRotor, PX(104), PX(3), PX(12), PX(56), 0, 0);
      bl.rotation.x = -0.05;              // a little coning, like the real head
      arm.add(bl); rotor.add(arm);
    }
    rotor.add(mesh(GEO.cyl, mMetal, PX(9), PX(5), PX(9), 0, PX(3), 0));           // hub
    g.add(rotor);
    // the disc the blades leave behind — reads as RPM, not as a second rotor
    const blur = new T.Mesh(GEO.circle, new T.MeshBasicMaterial({
      color: 0x7c8fa6, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false,
    }));
    blur.rotation.x = -Math.PI / 2; blur.position.y = PX(48); blur.scale.setScalar(PX(112));
    g.add(blur);

    /* ---- skids ---- */
    for (const s of [-1, 1]) {
      g.add(mesh(GEO.box, mMetal, PX(88), PX(4.5), PX(4.5), PX(2), -PX(46), s * PX(21)));
      g.add(mesh(GEO.box, mMetal, PX(4.5), PX(26), PX(3.5), -PX(22), -PX(32), s * PX(17)));
      g.add(mesh(GEO.box, mMetal, PX(4.5), PX(26), PX(3.5), PX(26), -PX(32), s * PX(17)));
      const sk = mesh(GEO.box, mMetal, PX(12), PX(4), PX(4), PX(46), -PX(44), s * PX(21));
      sk.rotation.z = 0.5; g.add(sk);     // tail skid, kicked up
    }

    /* ---- lights: red port, green starboard, white tail ---- */
    const lamp = (col, x, y, z) => {
      const m = new T.Mesh(GEO.sphereLo, new T.MeshBasicMaterial({ color: col }));
      m.position.set(x, y, z); m.scale.setScalar(PX(3.4)); g.add(m);
    };
    lamp(0xff3b30, PX(2), -PX(14), -PX(30));
    lamp(0x39d353, PX(2), -PX(14), PX(30));
    lamp(0xfff4d0, PX(118), PX(36), 0);

    g.userData.rotor = rotor;
    g.userData.tailRotor = tailRotor;
    g.userData.blur = blur;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.traverse(o => { if (o.material && o.material.transparent) o.castShadow = false; });
    return g;
  }

  /* ================= DON FALL (3D) =================
     THE LAST FLIGHT. The chopper comes in, hooks him, hauls him out of the
     frame, flies off, comes back as a speck on the horizon, DROPS him — and
     he falls all the way from the distance onto his own lawn — and then the
     chopper follows him down and piles itself into the dirt beside him.

     game.js owns the timeline; the channels (inK / hookK / liftK / carryK /
     backK / dropK / followK) are pure functions of exit-t, so both render
     paths and every probe read the SAME beats. This file owns the meshes.

     Everything below is expressed in the Don's own frame:
       col  columns of lateral offset from his spot (+ = right of screen)
       y    sprite px above the lawn
       z    world wu of DEPTH (− = away, into the distance)
     The Don's position is DERIVED from the hook while the rope is on him, so
     the rope cannot detach from either end of it. */
  /* The flight plan. y is in SPRITE PX above the lawn (the same currency the
     hanging-chain constants below use, and the same one the 2D painter wants)
     — only z is in world units, because depth is the one thing the 2D path
     cannot have. */
  const HELI_KEY = [
    //  u    col   y(px)  z(wu)   (the flight plan, in beat order)
    [0.00, 9.0, 110, 90],          // in     — off to the right, low and close
    [1.00, 0.0, 364, 0],           //        — hover: his feet still on the grass
    [1.30, 0.0, 364, 0],           // hook   — station-keeping while the rope runs out
    [2.00, 0.6, 560, 0],           // lift   — up, and he swings horizontal
    [3.00, 14.0, 820, -170],       // away   — up and out of the frame, way out
    [4.00, 2.9, 96, -150],         // back   — a speck on the horizon, right of him
    [5.00, 0.2, 370, -120],        // return — over the LAWN at TWICE the old drop
    [6.00, 0.2, 385, -120],        // drop   — the buckle lets go (and it climbs)
    [7.00, 2.6, 6, -122],          // follow — the chopper comes down after him
    [8.00, 2.6, 4, -120],          // rest   — in the dirt, burning
  ];
  /* The crash is staged UP THE LAWN — out past the far fence, DOUBLE the old
     depth (-60): the wreck now burns almost at the meadow's far edge, a small
     bright tragedy in the middle distance. The miniature shrinks with it
     (FAR_S 0.62 → 0.34, game.js: FAR_DS / FAR_LIFT doubled to match), so both
     paths tell the same story: the same beats, only much farther away. */
  /* THE HANGING CHAIN, in sprite px — the three numbers that decide whether
     this gag even fits in the shot. The clear air above his lawn is only
     ~387px at his lane (the frame's top ray lands at 44wu there) and the Don
     is 292px of it: a man hanging VERTICALLY under a visible chopper always
     ends up with his feet back on the grass. So he does not hang vertically.
     The harness takes him round the chest and the rope hauls him HORIZONTAL —
     feet first, belly down, deeply undignified — which costs the shot his 55px
     half-THICKNESS instead of his 292px height, and THAT is what buys the
     drop 143px of clear air with the skids still in frame.       44 (hook under the hull) + 138 (rope) + 182 (his chest → his ankles)
       = 364 = the tallest hover at which he is still standing on the grass. */
  const HELI_HOOK_PX = 44;        // the hook rides this far under the hull centre
  const HELI_ROPE_PX = 138;       // paid out to the harness on his chest
  const DON_CHEST_PX = 182;       // harness → his ankles, for the boss figure
  const HELI_REL = HELI_KEY[6];   // the hover he is let go from
  /* THE STAGED DISTANCE. At the depth of the crash the frame only has a thin
     band of air (≈270px there against 385px at his own lane), so a full-size
     man standing on that lawn pokes out of the top of the frame. The whole far
     sequence is therefore played as a MINIATURE — rig, hull and chain shrink
     by the same factor — which is exactly what the 2D painter does with the
     same two numbers (game.js: FAR_DS / FAR_LIFT). */
  const FAR_S = 0.34;
  const farK = z => { const a = Math.abs(z); return a < 8 ? 0 : a > 112 ? 1 : (a - 8) / 104; };
  const apS = z => 1 - (1 - FAR_S) * farK(z);

  function heliPath(d) {
    const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const c01 = v => (v === undefined || v < 0 ? 0 : v > 1 ? 1 : v);
    const inK = c01(d.inK), hk = c01(d.hookK), liftK = c01(d.liftK);
    const carryK = c01(d.carryK), backK = c01(d.backK), dropK = c01(d.dropK);
    const flwK = c01(d.followK), smokeK = c01(d.smokeK);
    // the last two legs are rewritten onto the WRECK's own column, so the hull,
    // the crater and the firelight all end on the same square of lawn
    const wreckCol = d.heliCol === undefined ? 1.7 : d.heliCol;
    const K3 = HELI_KEY.map((k, i) => (i >= 7 ? [k[0], wreckCol, k[2], k[3]] : k));
    /* one parameter, stepped through the beats — the keys above are read
       through it, so the chopper's path and the Don's place on the rope are
       the same statement instead of two sets of numbers that can disagree */
    const u = inK < 1 ? inK
      : hk < 1 ? 1 + 0.3 * ease(hk)
      : liftK < 1 ? 1.3 + 0.7 * ease(liftK)
      : carryK < 1 ? 2 + ease(carryK)
      : backK < 1 ? 3 + 2 * ease(backK)
      : dropK < 1 ? 5 + ease(dropK)
      : 6 + ease(flwK) + smokeK * 0.001;
    let a = K3[0], b = K3[K3.length - 1];
    for (let i = 0; i < K3.length - 1; i++) {
      if (u >= K3[i][0] && u <= K3[i + 1][0]) { a = K3[i]; b = K3[i + 1]; break; }
    }
    const k = (u - a[0]) / Math.max(1e-4, b[0] - a[0]);
    const heli = {
      col: a[1] + (b[1] - a[1]) * k,
      y: a[2] + (b[2] - a[2]) * k,
      z: a[3] + (b[3] - a[3]) * k,
      bob: d.bob || 0,
    };
    // the miniature factor for each actor at its own depth
    const aH = apS(heli.z), HOOK = HELI_HOOK_PX * aH, ROPE = HELI_ROPE_PX * aH;
    heli.y *= aH;
    // he rides the rope's depth until he is released, then falls where he was
    // let go — so his own miniature factor is that of whichever depth he is at
    const donZf = dropK <= 0 ? heli.z : HELI_REL[3];
    const aD = apS(donZf);
    const CHEST = DON_CHEST_PX * aD;
    /* THE PIVOT IS THE HARNESS — the point the rope actually holds: a chest up
       his body while he is upright, the centre of it once he is horizontal.
       Until the rope has finished running down to him, that point is simply
       where his chest already is: he has not moved, the rope is still coming. */
    const harnessY = heli.y - HOOK - ROPE * hk;
    const pivotY = hk < 1 ? CHEST : harnessY;
    /* ON THE ROPE he swings round to HORIZONTAL (see the chain note above):
       the half-thickness of a man is all this frame has to hold, not his
       height. */
    const hangK = dropK > 0 ? 1 : clamp01(liftK * 1.8);
    /* Released: a BODY FALLING TOWARD THE CAMERA. His depth collapses while
       he falls, so the drop reads as "from way out there" rather than "from
       just above the lawn" — and it is what lets the chopper be SEEN letting
       go of him, with 133px of clear air already under his body. */
    const relY = HELI_REL[2] * aH - HOOK - ROPE;
    /* Until the harness is actually ON him he has not moved an inch: the rope
       is still paying out, so he stands at his own spot with his chest exactly
       where the harness will land. Everywhere below, `y` is THE HARNESS — the
       point the rope holds — and the renderers hang the body one chest-height
       under it. That keeps his feet on the lawn when he is standing AND when
       the fall has finished, with no second set of numbers to keep in sync. */
    const onRope = hk >= 1;
    const don = dropK <= 0
      ? (onRope
        ? {
          col: heli.col, z: heli.z, hangK,
          hanging: hangK > 0.02, flying: false, y: pivotY,
        }
        : {
          col: 0, z: 0, hangK, hanging: false, flying: false,
          y: DON_CHEST_PX,
        })
      : {
        col: HELI_REL[1] * (1 - dropK),
        y: CHEST + (relY - CHEST) * (1 - dropK * dropK),
        // he does NOT close the distance as he falls: the whole gag happens
        // out where he was let go, so the wreck stays in the middle distance
        z: HELI_REL[3],
        hangK: 1, hanging: false, flying: true,
      };
    return {
      u, heli, don, harnessY, pivotY, dropK, flwK,
      hookPx: HOOK, ropePx: ROPE, chestPx: CHEST, apH: aH, apD: aD,
      airborne: don.hanging || don.flying,
    };
  }

  R3.donFallInit = function (d) {
    R3.donFallClear();
    const m = buildZombieModel({ type: d.type, seed: d.seed, spec: G.ZT.get(d.type) });
    // A WRAPPER owns the placement, the model keeps the pose. Rotating the
    // model itself would spin it about its own feet — the wrong end once the
    // rope has hold of his harness — and the swing round to horizontal is a
    // placement, not a pose.
    const rig = new T.Group();
    rig.add(m.group);
    R3.scene.add(rig);
    // his own blob, with its OWN material: R3.blobMat is shared by every
    // actor in the scene, so fading "his" shadow would fade the horde's too
    const blob = new T.Mesh(GEO.blobGeo, R3.blobMat.clone());
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; blob.renderOrder = 2;
    R3.scene.add(blob);
    const heli = buildHeli3D();
    R3.scene.add(heli);
    const rope = new T.Mesh(new T.CylinderGeometry(PX(1.7), PX(1.7), 1, 8),
      new T.MeshBasicMaterial({ color: 0x2a241c }));
    rope.visible = false; R3.scene.add(rope);
    // the wreck: a firelight on the lawn, and one pool of glow under the hull
    const light = new T.PointLight(0xff8a2a, 0, 260);
    R3.scene.add(light);
    const glow = new T.Mesh(GEO.circle, new T.MeshBasicMaterial({
      color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending,
    }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.09; glow.scale.setScalar(PX(150));
    R3.scene.add(glow);
    const rr = (a, b) => a + Math.random() * (b - a);
    const F = { m, rig, blob, heli, rope, light, glow, fx: [], yaw: Math.PI, boom: false, washT: 0, roll: 0, flwK: 0 };
    /* fire and smoke, thrown off the airframe when it goes in — 3D-only FX
       (the lawn dust and debris ride the shared 2D particle pass instead, so
       they look the same in both render paths) */
    F.spawn = (x, yW, z, n, smoke) => {
      for (let i = 0; i < n; i++) {
        const r = smoke ? PX(rr(13, 26)) : PX(rr(9, 20));
        const mat = new T.MeshBasicMaterial({
          color: smoke ? [0x4c4a48, 0x5c5751, 0x3a3836][i % 3] : [0xffe9a0, 0xff9a2a, 0xff5a1e][i % 3],
          transparent: true, opacity: 0.95, depthWrite: false,
        });
        const mm = new T.Mesh(smoke ? GEO.sphereLo : GEO.sphere, mat);
        mm.position.set(x + rr(-PX(16), PX(16)), yW + rr(0, PX(10)), z + rr(-PX(12), PX(12)));
        mm.scale.setScalar(r);
        R3.scene.add(mm);
        F.fx.push({
          m: mm, r, smoke: !!smoke, t: 0,
          vx: rr(-PX(24), PX(24)),
          // fire LINGERS on the wreck (no gravity — thrown chunks fell through
          // the lawn within half a second and the crash read as a fizzle);
          // smoke only ever climbs
          vy: smoke ? rr(PX(28), PX(64)) : rr(PX(6), PX(40)),
          vz: rr(-PX(20), PX(20)),
          g: 0,
          life: smoke ? rr(1.6, 3.0) : rr(0.35, 0.8),
        });
      }
    };
    R3.donFall3d = F;
  };

  R3.donFallSync = function (d, time, dt) {
    const F = R3.donFall3d;
    if (!F) return;
    const wp = worldPos(d.u, d.row, 0);
    const px2w = PX;                       // sprite px → world units, same K
    /* ---------------- THE SWALLOW (final boss) ----------------
       No chopper: the lawn opens under him and takes him. The plane of the
       lawn is OPAQUE, so sinking the rig below y=0 does the clipping for us
       — the hole the overlay paints just covers the seam. All the fire, the
       rocks and the lava are thrown by game.js and drawn on the shared 2D
       overlay, so both render paths get the identical show. */
    if (d.mode === 'swallow') {
      const sinkK = d.sinkK || 0;
      poseZombie(F.m, {
        id: -999, u: d.u, row: d.row, type: d.type, seed: d.seed, spec: F.m.spec,
        state: 'die', dieT: 0.9 * clamp01((sinkK - 0.35) / 0.55),
        walkPhase: 0, spawnT: 1, magaOn: !!d.magaOn, toupeeOn: !!d.toupeeOn,
        helmet: false, shield: false, hitFlash: 0, helmetWobble: 0,
        shieldWobble: 0, angry: false, isBoss: true, lean: 0, shakeAmp: 0.34,
      }, time);
      F.m.group.position.set(0, 0, 0);
      F.rig.rotation.set(0, 0, 0);
      F.rig.position.set(wp.x, -PX(sinkK * 292), wp.z);
      F.rig.visible = true;
      F.blob.position.set(wp.x, 0.05, wp.z);
      F.blob.scale.setScalar(PX(55 * (1 - sinkK * 0.9)) + 0.01);
      F.blob.material.opacity = 0.5 * (1 - sinkK);
      F.heli.visible = false; F.rope.visible = false;
      // the firelight on the grass: it flickers with the burps
      const rk = d.ringK || 0;
      const flick = d.spew ? 1 : 0;
      F.light.position.set(wp.x, PX(20), wp.z);
      // a FIRELIGHT, not a floodlight: the wreck's own lamp runs at ~1.9 and
      // thirty washed the entire lawn yellow
      F.light.intensity = flick * (2.1 + Math.sin(time * 23) * 0.7 + Math.sin(time * 7.3) * 0.4);
      F.glow.position.set(wp.x, 0.09, wp.z);
      F.glow.scale.setScalar(PX(130) * (0.35 + rk * 0.65));
      F.glow.material.opacity = flick * (0.30 + Math.sin(time * 17) * 0.09) * (0.5 + rk * 0.5);
      for (const p of F.fx) { p.t += dt; p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt;
        p.m.position.y += (p.vy + (p.g || 0) * p.t) * dt;
        const k = p.t / p.life; if (k >= 1) { p.dead = true; continue; }
        p.m.material.opacity = 0.95 * (1 - k * k); p.m.scale.setScalar(p.r * (1 - k * 0.5)); }
      F.fx = F.fx.filter(p => !p.dead);
      return;
    }
    const P = heliPath(d);
    const donDown = d.phase === 'fall' && (d.dropK || 0) >= 1;

    /* ---------------- the Don ---------------- */
    poseZombie(F.m, {
      id: -999, u: d.u + P.don.col, row: d.row, type: d.type, seed: d.seed, spec: F.m.spec,
      state: donDown ? 'die' : P.airborne ? 'hang' : 'hold',
      // dieT ramps over the `landK` beat: the fall is horizontal, so the flop
      // onto his back has to be SEEN rather than snapped to
      dieT: donDown ? 0.9 * (d.landK === undefined ? 1 : d.landK) : 0, walkPhase: 0, spawnT: 1,
      magaOn: !!d.magaOn, toupeeOn: !!d.toupeeOn,
      helmet: false, shield: false, hitFlash: 0, helmetWobble: 0,
      shieldWobble: 0, angry: false, isBoss: true,
      lean: d.phase !== 'fall' ? Math.sin(time * 1.9) * 0.16 : 0,
      shakeAmp: 0.28,
    }, time);
    const donG = F.m.group;
    /* past the horizon he is simply not in the shot any more — the far lawn
       is opaque and his rope hangs below its edge, which is the honest way to
       stage "they are miles away": only the chopper reads at that size. The
       gate sits between the 'back' beat (-150) and the new release depth
       (-120), so he is hidden on the far legs and SEEN letting go. */
    const pastHorizon = Math.abs(P.don.z) > 140;
    F.rig.visible = !pastHorizon;
    /* the rig: where he is, and how far round the rope has taken him.
       hangK 0 = on his feet, 1 = horizontal and furious. */
    const hangK = P.don.hangK || 0;
    F.rig.position.set(
      worldPos(d.u + P.don.col, d.row, 0).x,
      px2w(P.don.y),
      wp.z + P.don.z
    );
    if (P.don.flying) {
      F.rig.position.x += Math.sin((d.dropK || 0) * 11) * PX(8);   // a body in the air
    }
    const wantRoll = donDown ? 0
      : hangK * 1.5
      + (P.don.flying ? (d.dropK || 0) * 6.6 : Math.sin(time * 1.5) * 0.05);
    F.roll = F.roll + (wantRoll - F.roll) * Math.min(1, dt * 8);
    F.rig.rotation.set(0, 0, F.roll);
    // the far staging is played as a MINIATURE: the wrapper carries the scale,
    // so the body's own offset has to be divided back out of it to keep the
    // world distance from the harness to his feet exactly one chest
    F.rig.scale.setScalar(P.apD);
    donG.position.set(0, -PX(P.chestPx) / P.apD, 0);
    // his shadow: on the lawn the whole time, spreading as he comes down
    const shadowK = P.don.flying ? Math.max(0, 1 - (P.don.y - P.chestPx) / 140) : 0;
    F.blob.position.set(worldPos(d.u + P.don.col, d.row, 0).x, 0.05, wp.z + P.don.z * 0.5);
    F.blob.scale.setScalar(PX(55 * P.apD * (P.don.flying ? 0.45 + shadowK * 0.75 : 1)) + 0.01);
    F.blob.material.opacity = 0.55 * (P.don.flying ? 0.25 + shadowK * 0.75 : 1);

    /* ---------------- the chopper ---------------- */
    const hp = new T.Vector3(
      worldPos(d.u + P.heli.col, d.row, 0).x,
      px2w(P.heli.y + P.heli.bob),
      wp.z + P.heli.z
    );
    F.heli.position.copy(hp);
    F.heli.scale.setScalar(P.apH);         // the hull shrinks with the rig
    F.heli.visible = true;                 // the wreck stays on stage too
    // nose into the wind: yaw from the frame's own displacement, smoothed, so
    // the chopper always leads with its canopy instead of sliding sideways
    if (F.last) {
      const vx = hp.x - F.last.x, vz = hp.z - F.last.z;
      if (Math.abs(vx) + Math.abs(vz) > 1e-3) {
        const want = Math.atan2(vz, -vx);
        let dth = want - F.yaw;
        while (dth > Math.PI) dth -= Math.PI * 2;
        while (dth < -Math.PI) dth += Math.PI * 2;
        F.yaw += dth * Math.min(1, dt * 5);
      }
    }
    F.last = { x: hp.x, z: hp.z };
    F.heli.rotation.y = F.yaw;
    // the airframe leans into whatever it is doing — and then SETTLES once it
    // is in the dirt instead of holding the 52° dive it came down in
    const climb = P.heli.y > PX(300) ? 0.16 : 0;
    const crashTilt = d.heliDown ? -0.22
      : (P.flwK > 0 ? -0.9 * Math.min(1, P.flwK * 2) : 0);
    F.heli.rotation.z = climb + crashTilt + Math.sin(time * 3.1) * 0.035;
    // rotors: always turning, faster while it is working
    const spin = dt * (d.phase === 'fall' ? 34 : 22);
    F.heli.userData.rotor.rotation.y += spin;
    F.heli.userData.tailRotor.rotation.x += dt * 46;
    F.heli.userData.blur.material.opacity = Math.min(0.22, 0.06 + Math.abs(spin) * 0.02);

    /* the rope: from the hook under the belly down to the harness */
    const hookY = px2w(P.heli.y - P.hookPx);
    const ropeLen = px2w(P.ropePx * (d.hookK || 0));
    F.rope.visible = !pastHorizon && d.phase === 'fall' && (d.hookK || 0) > 0.02 && (d.dropK || 0) <= 0.6;
    if (F.rope.visible) {
      F.rope.position.set(worldPos(d.u + P.heli.col, d.row, 0).x, hookY - ropeLen / 2, wp.z + P.heli.z + 0.02);
      F.rope.scale.y = Math.max(0.001, ropeLen);
    }

    /* ---------------- the wreck ---------------- */
    const crashX = worldPos(d.u + (d.heliCol || 1.7), d.row, 0).x;
    // the wreck's own square of lawn — it used to be `wp.z - 8`, which parked
    // the firelight on the near lane while the hull burned 50wu up the lawn
    const crashZ = wp.z + P.heli.z + 2;
    if (F.flwK < P.flwK || F.flwK === undefined) F.flwK = P.flwK;   // no rewinding on a skip
    if (F.flwK >= 1 && !F.boom) {
      F.boom = true;
      // the airframe goes in: fireball, then it burns on the lawn
      F.spawn(crashX, PX(24), crashZ, 22, false);
      F.spawn(crashX, PX(30), crashZ, 10, true);
    }
    if (F.boom) {
      // burning: a fireball every frame or two, smoke off the top of it
      F.washT += dt;
      if (F.washT > 0.03) {
        F.washT = 0;
        F.spawn(crashX, PX(10), crashZ, 3, false);
        if (Math.random() < 0.5) F.spawn(crashX, PX(20), crashZ, 1, true);
      }
      F.light.position.set(crashX, PX(30), crashZ);
      F.light.intensity = 1.9 + Math.sin(time * 31) * 0.6 + Math.random() * 0.5;
      F.glow.position.set(crashX, 0.09, crashZ);
      F.glow.material.opacity = 0.42;
      F.glow.scale.setScalar(PX(150) * (0.9 + Math.sin(time * 23) * 0.1));
    }
    for (const p of F.fx) {
      p.t += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.vy -= p.g * dt;
      const k = p.t / p.life;
      if (k >= 1) { R3.scene.remove(p.m); p.dead = true; continue; }
      if (p.smoke) {
        p.m.scale.setScalar(p.r * (1 + k * 2.2));
        p.m.material.opacity = 0.34 * (1 - k);
      } else {
        p.m.scale.setScalar(p.r * (1 - k * 0.45));
        p.m.material.opacity = 0.95 * (1 - k * k);
      }
    }
    F.fx = F.fx.filter(p => !p.dead);
  };

  R3.donFallAnchor = function (u, row) {
    return project(worldPos(u, row, 5.2));
  };
  // where the ground at a given depth lands on screen: the overlay needs it to
  // place the crash dust and scorch up the lawn in 3D, where the projection —
  // not a hand-tuned constant — decides how far up that is
  R3.groundAt = function (u, row, dz) {
    const wp = worldPos(u, row, 0);
    return project(new T.Vector3(wp.x, 0, wp.z + (dz || 0)));
  };
  // the 2D path reads the SAME choreography — one flight plan, two renderers
  R3.donFallPath = heliPath;
  // where an airborne Don/JetRanger actually is, in screen px — the 2D overlay
  // uses this to pin his speech bubble to him while he dangles
  R3.donFallAirAnchor = function (d) {
    const P = heliPath(d);
    const wp = worldPos(d.u + P.don.col, d.row, 0);
    return project(new T.Vector3(wp.x, PX(P.don.y), wp.z + P.don.z));
  };
  R3.donFallClear = function () {
    if (R3.donFall3d) {
      const F = R3.donFall3d;
      R3.scene.remove(F.rig); R3.scene.remove(F.blob);
      R3.scene.remove(F.heli); R3.scene.remove(F.rope);
      R3.scene.remove(F.light); R3.scene.remove(F.glow);
      for (const p of F.fx) R3.scene.remove(p.m);
      R3.donFall3d = null;
    }
  };

  /* ================= FINALE PARADE (3D) =================
     The chase plays on the LIVING lawn: standalone zombie rigs (the same
     builders as the gameplay pool, never entered into it) march across the
     front lanes with a SECOND pult rig doing the chasing or the fleeing.
     The BOARD pult stands down for the whole parade — the only pult on
     screen is the one in the chase. game.js drives positions each frame;
     these functions own the models, the poses and the visibility swap. */
  R3.paradeInit = function (cast) {
    R3.paradeClear();
    const pult = buildPultModel();
    R3.scene.add(pult.group);
    const pultBlob = makeBlob(PX(30));
    R3.scene.add(pultBlob);
    const zombies = cast.map(c => {
      const m = buildZombieModel({ type: c.type, seed: c.seed });
      m.blob = buildZombieBlob({ type: c.type });
      R3.scene.add(m.group); R3.scene.add(m.blob);
      return m;
    });
    // the BOARD pult stands down — the chase pult is the only one on stage
    R3.pultModel.group.visible = false;
    if (R3.pultBlob) R3.pultBlob.visible = false;
    R3.parade3d = { zombies, pult, pultBlob };
    return R3.parade3d;
  };
  /* zItems: [{ type, seed, phase, helmet, dir, u, row }] · pult: { u, row, dir } */
  R3.paradeSync = function (zItems, pultItem, time) {
    const P3 = R3.parade3d;
    if (!P3) return;
    zItems.forEach((it, i) => {
      const m = P3.zombies[i];
      if (!m) return;
      poseZombie(m, {
        id: -100 - i, u: it.u, row: it.row, type: it.type, seed: it.seed,
        spec: m.spec,                 // poseZombie reads z.spec.headArmor etc.
        state: 'walk', walkPhase: it.phase, spawnT: 1, dieT: 0,
        helmet: it.helmet, shield: false, hitFlash: 0, helmetWobble: 0,
        shieldWobble: 0, lean: 0, angry: false, isBoss: false,
      }, time);
      // poseZombie's base yaw presents the face toward the camera (-x lean);
      // flip a half-turn when the cast marches +x so nobody moonwalks
      const BASE_YAW = (R3.baseYaw === undefined ? 0.46 : R3.baseYaw);
      m.group.rotation.y = BASE_YAW + (it.dir > 0 ? Math.PI : 0);
      m.blob.position.set(m.group.position.x, 0.05, m.group.position.z);
      m.blob.scale.setScalar(PX(17 * m.spec.build.bulk));
    });
    const { pult, pultBlob } = P3;
    const wp = worldPos(pultItem.u, pultItem.row, 0);
    pult.group.position.set(wp.x, Math.abs(Math.sin(time * 9)) * PX(7), wp.z);
    // the pot's face stays toward the camera; the body leans into travel
    pult.group.rotation.set(0, pultItem.dir > 0 ? 0.45 : -0.45, 0);
    const k = clamp01(1 - pult.group.position.y / PX(7));
    pultBlob.position.set(wp.x, 0.05, wp.z);
    pultBlob.scale.setScalar(PX(30) * (0.5 + 0.5 * k));
    // sprinting scoop: whipping arm, melon still aboard for the drama
    pult.arm.rotation.z = -1.15 + Math.sin(time * 8) * 0.4;
    pult.heldMelon.visible = true;
  };
  R3.paradeClear = function () {
    if (R3.parade3d) {
      R3.scene.remove(R3.parade3d.pult.group);
      R3.scene.remove(R3.parade3d.pultBlob);
      for (const m of R3.parade3d.zombies) { R3.scene.remove(m.group); R3.scene.remove(m.blob); }
      R3.parade3d = null;
    }
    // the board pult returns to its rail
    if (R3.pultModel) R3.pultModel.group.visible = true;
    if (R3.pultBlob) R3.pultBlob.visible = true;
  };
  /* screen anchor above the chase pult — the "!" thought bubble hangs here */
  R3.paradeAnchor = function (u, row) {
    return project(worldPos(u, row, 0));
  };

  /* ================= INIT ================= */
  R3.init = function (canvas) {
    buildSharedGeo();
    const q = new URLSearchParams(location.search);
    // Camera framing — NUMERICALLY CALIBRATED (grid search on laneY targets
    // + sky-band): fov 30, cam (0,66,116) → lookAt (0,6,-2), pitch ≈ 27°.
    // Projects the 4x10 lawn to laneY≈[270,372,486,608] (rowScale fan
    // 0.8..1.2 — PvZ-style depth cue) with a ≈100px sunset horizon band.
    const fov = parseFloat(q.get('fov')) || 30;
    R3.baseYaw = parseFloat(q.get('yaw') || '0.46');
    const cy = parseFloat(q.get('cy')) || 66;
    const cz = parseFloat(q.get('cz')) || 116;
    const ty = parseFloat(q.get('ty')) || 6;
    const tz = parseFloat(q.get('tz')) || -2;

    R3.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    R3.renderer.setSize(1280, 720, false);
    R3.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    R3.renderer.shadowMap.enabled = true;
    R3.renderer.shadowMap.type = T.PCFSoftShadowMap;
    R3.renderer.outputEncoding = T.sRGBEncoding;

    R3.scene = new T.Scene();
    R3.camera = new T.PerspectiveCamera(fov, 1280 / 720, 1, 2600);
    R3.camera.position.set(0, cy, cz);
    R3.camera.lookAt(0, ty, tz);
    R3.camera.updateMatrixWorld(true);
    R3.camBase = R3.camera.position.clone();

    // lights — dusk toon look. The KEY light is anchored to the painted sun:
    // the disc reads TOP-CENTRE (slightly left, SUN_WX = −14) just above the
    // horizon, so the light comes from straight beyond the board, a hair from
    // the left — shadows fall TOWARD the camera (down-screen) with that same
    // tiny right slant, agreeing with the on-screen sun. Elevation is cheated
    // to ~31°: low enough that the faint shadows stretch into long visible
    // streaks (length reads better than darkness for "subtle but present"),
    // high enough to stay tame on the board.
    // VERY subtle (~18% dip in the cast core — half of what it was).
    const hemi = new T.HemisphereLight(0xd8b0d8, 0x5f7a48, 1.15);
    R3.scene.add(hemi);
    const sun = new T.DirectionalLight(0xffb87a, 0.18);
    sun.position.set(-14, 143, -235);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 4;      // PCFSoft + radius: soft, low-contrast edges
    R3.scene.add(sun);
    R3.sun = sun;

    buildSky(); buildLawn(); buildFence(); buildCottage(); buildGraveyard();
    buildHedge(); buildHills(); buildClouds(); buildWindmill(); buildDressing();
    buildNearFence();

    // pult model
    R3.pultModel = buildPultModel();
    // tag eyes for blink
    R3.pultModel.group.traverse(o => {
      if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0xf8f5ea) {
        if (!R3.pultModel.eyeL) R3.pultModel.eyeL = o;
        else if (!R3.pultModel.eyeR) R3.pultModel.eyeR = o;
      }
    });
    R3.scene.add(R3.pultModel.group);

    // menu showcase zombie
    R3.menuZombie = buildZombieModel({ type: 'shambler', seed: 3 });
    R3.menuZombie.blob = buildZombieBlob({ type: 'shambler' });
    R3.menuZombie.group.visible = false;
    R3.scene.add(R3.menuZombie.group);

    calibrateBoard();
    R3.ready = true;
  };

  /* ================= SYNC ================= */
  R3.pultTip3D = function (p) {
    // Melon-release point: the arm's scoop at the LAUNCH pose, in world space.
    // Same convention and same constants as the drawn arm (G.PULT_ARM), so the
    // melon leaves the scoop instead of a point somewhere else entirely — the
    // old version read the angle as canvas-space (tip DOWN) while the rig drew
    // it as three.js-space (tip UP), so the melon spawned below the axle.
    const a = G.PULT_ARM.launch;
    const wp = worldPos(G.Board.pultU, p.row, 0);
    // arm-local scoop (60, 5) rotated by a, then the axle at model (-8, 80)
    const rx = 60 * Math.cos(a) - 5 * Math.sin(a);
    const ry = 60 * Math.sin(a) + 5 * Math.cos(a);
    return new T.Vector3(wp.x + PX(-8 + rx), wp.y + PX(80 + ry), wp.z);
  };
  R3.pultTipScreen = function (p) {
    const v = R3.pultTip3D(p);
    return project(v);
  };

  R3.sync = function (game, time) {
    if (!R3.ready) return;
    const inMenu = game.state === 'menu';

    // ---- zombies ----
    const seen = new Set();
    for (const z of game.zombies) {
      seen.add(z.id);
      let m = R3.zombiePool.get(z.id);
      if (!m) { m = buildZombieModel(z); m.blob = buildZombieBlob(z); R3.zombiePool.set(z.id, m); R3.scene.add(m.group); }
      poseZombie(m, z, time);
      // blob shadow: feet contact + air-time shrink (spawn hop / glory launch)
      m.blob.position.set(m.group.position.x, 0.05, m.group.position.z);
      const airK = clamp01(1 - m.group.position.y / PX(60));
      const blobR = z.spec.boss ? 38 * z.spec.scale : 17 * z.spec.build.bulk;
      m.blob.scale.setScalar(PX(blobR) * (0.55 + 0.45 * airK));
    }
    for (const [id, m] of R3.zombiePool) {
      if (!seen.has(id)) { R3.scene.remove(m.group); R3.scene.remove(m.blob); R3.zombiePool.delete(id); }
    }

    // menu showcase zombie
    if (inMenu) {
      R3.menuZombie.group.visible = true;
      poseZombie(R3.menuZombie, {
        id: -1, row: 2, u: 6.2, type: 'shambler', seed: 3, state: 'hold',
        walkPhase: 0, spawnT: 1, dieT: 0, helmet: false, shield: false,
        hitFlash: 0, helmetWobble: 0, shieldWobble: 0, lean: 0,
      }, time);
    } else R3.menuZombie.group.visible = false;

    // ---- pult ----
    if (game.pult) {
      posePult(R3.pultModel, game.pult, game, time);
      // blob shadow under the pult, shrinking with hop height
      if (!R3.pultBlob) R3.pultBlob = makeBlob(PX(30));
      const wp2 = worldPos(G.Board.pultU, game.pult.row, 0);
      R3.pultBlob.position.set(wp2.x, 0.05, wp2.z);
      const pAirK = clamp01(1 - game.pult.hopY / 46);
      R3.pultBlob.scale.setScalar(PX(30) * (0.5 + 0.5 * pAirK));
    }

    // ---- projectiles ----
    const pseen = new Set();
    for (const pr of game.projectiles) {
      pseen.add(pr);
      let rec = R3.projPool.get(pr);
      if (!rec) {
        let mm;
        if (pr.heavy) {
          mm = new T.Mesh(GEO.iron, toon(0x3d434d));
          mm.scale.setScalar(PX(17));
        } else {
          mm = new T.Mesh(GEO.melon, melonMaterial());
          mm.scale.setScalar(PX(15));
        }
        mm.castShadow = true;
        // 3D bead trail: 16 fading spheres, additive-free toon glow colors
        const beads = [];
        for (let i = 0; i < 16; i++) {
          const b = new T.Mesh(GEO.sphere, new T.MeshBasicMaterial({
            color: pr.heavy ? 0xffb040 : 0xbfe84a, transparent: true, opacity: 0, depthWrite: false,
          }));
          b.visible = false;
          R3.scene.add(b);
          beads.push(b);
        }
        rec = { mesh: mm, beads };
        R3.projPool.set(pr, rec); R3.scene.add(mm);
      }
      const mm = rec.mesh;
      let wp;
      if (pr.launchSx != null && pr.launchT < pr.launchDur && pr._tip3D) {
        // visual bridge: 3D quadratic bezier tip -> physics point
        const k = pr.projK(), i = 1 - k;
        const ph = worldPos(pr.u, pr.row, Math.max(0, pr.h));
        const c = pr._ctrl3D;
        wp = new T.Vector3()
          .addScaledVector(pr._tip3D, i * i)
          .addScaledVector(c, 2 * i * k)
          .addScaledVector(ph, k * k);
      } else {
        wp = worldPos(pr.u, pr.row, Math.max(0, pr.h));
      }
      mm.position.copy(wp);
      mm.rotation.z = -pr.spin;
      if (pr.glowing) {
        // STRONG THROW in flight: pulse + emissive (matches the 2D halo)
        const pulse = 0.5 + 0.3 * Math.sin(pr.launchT * 20);
        mm.scale.setScalar(PX(pr.heavy ? 17 : 15) * (1 + pulse * 0.3));
        if (mm.material.emissive) mm.material.emissive.setRGB(0.25 * pulse, 0.85 * pulse, 0.12 * pulse);
      } else if (mm.material.emissive) {
        mm.material.emissive.setRGB(0, 0, 0);
      }
      // bead trail — chunky and bright, but the YOUNGEST bead is suppressed:
      // a bright bead hugging the melon washed it out to a white blob
      const n = pr.trail3d.length;
      rec.beads.forEach((b, i) => {
        const p = pr.trail3d[i];
        if (!p || i >= n - 1) { b.visible = false; return; }
        b.visible = true;
        b.position.set(p.x, p.y, p.z);
        const f = i / Math.max(1, n - 2);
        b.scale.setScalar(PX(5 + 14 * f));
        b.material.opacity = 0.28 + 0.6 * f * f;
      });
      // flight blob: shadow tracks the ground point, shrinking with height
      if (!rec.blob) rec.blob = makeBlob(PX(12));
      rec.blob.position.set(wp.x, 0.06, wp.z);
      const hK = clamp01(1 - wp.y / (G.Board.maxApexH * R3.H3D));
      rec.blob.scale.setScalar(PX(12) * (0.45 + 0.55 * hK));
    }
    for (const [pr, rec] of R3.projPool) {
      if (!pseen.has(pr)) {
        R3.scene.remove(rec.mesh);
        rec.beads.forEach(b => R3.scene.remove(b));
        if (rec.blob) R3.scene.remove(rec.blob);
        R3.projPool.delete(pr);
      }
    }

    // ---- obstacles ----
    const oseen = new Set();
    for (const ob of game.obstacles) {
      oseen.add(ob);
      let m = R3.obstPool.get(ob);
      if (!m) { m = buildTombstoneModel(2 - ob.hp); R3.obstPool.set(ob, m); R3.scene.add(m); }
      const wp = worldPos(ob.u, ob.row, 0);
      m.position.set(wp.x + (ob.shake > 0 ? (Math.random() - 0.5) * PX(6) * ob.shake : 0), 0, wp.z);
    }
    for (const [ob, m] of R3.obstPool) {
      if (!oseen.has(ob)) { R3.scene.remove(m); R3.obstPool.delete(ob); }
    }

    // ---- craters (flat decals) ----
    const cseen = new Set();
    let ci = 0;
    for (const cr of game.craters) {
      // craters staged UP THE LAWN have no mesh: they are drawn on the 2D
      // overlay in both paths (a mesh here would sit on the near lane)
      if (cr.far) continue;
      cseen.add(cr);
      let m = R3.craterPool.get(cr);
      if (!m) {
        const u = (cr.u != null) ? cr.u : G.Board.toU(cr.row, cr.x);
        const wp = worldPos(u, cr.row, 0);
        m = new T.Mesh(GEO.circle, new T.MeshBasicMaterial({
          color: cr.heavy ? 0x2a221a : 0x3d3226, transparent: true, opacity: 0.75, depthWrite: false,
        }));
        m.rotation.x = -Math.PI / 2;
        m.scale.setScalar(PX(cr.heavy ? 46 : 30));
        m.position.set(wp.x, 0.06 + (ci++) * 0.004, wp.z);
        R3.craterPool.set(cr, m); R3.scene.add(m);
      }
      const ttl = cr.dieAt || (cr.heavy ? 20 : 10);
      m.material.opacity = 0.75 * clamp01(1 - cr.t / ttl);
    }
    for (const [cr, m] of R3.craterPool) {
      if (!cseen.has(cr)) { R3.scene.remove(m); R3.craterPool.delete(cr); }
    }

    // ---- ambience ----
    if (R3.windmill) R3.windmill.rotation.z += 0.01;
    for (const c of R3.clouds) {
      c.position.x += c.userData.speed * 0.016;
      if (c.position.x > 320) c.position.x = -320;
    }

    // ---- camera shake (from game's 2D camera; px→world keeps the 2D
    // overlay and the 3D world shaking in screen-lockstep) ----
    const cam = game.camera;
    R3.camera.position.set(
      R3.camBase.x + cam.x * K,
      R3.camBase.y + cam.y * K,
      R3.camBase.z
    );
  };

  R3.render = function () {
    if (R3.ready) R3.renderer.render(R3.scene, R3.camera);
  };
})();

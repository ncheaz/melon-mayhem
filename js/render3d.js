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
  const LANE_D3D = 84 * K;              // wu between lane centrelines
  const H3D = 38 * K;                   // wu per height-unit h
  const PX = v => v * K;                // sprite px -> world units

  const worldPos = (u, row, h) => new T.Vector3((u - 4.5) * COL_W3D, h * H3D, (row - 1.5) * LANE_D3D);

  /* ---------------- toon gradient ---------------- */
  function makeGradientMap() {
    const steps = new Uint8Array([90, 150, 210, 255]);
    const tex = new T.DataTexture(steps, steps.length, 1, T.RedFormat);
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
  function toon(color, opts = {}) {
    return new T.MeshToonMaterial(Object.assign({ color, gradientMap: GRAD }, opts));
  }

  function buildSharedGeo() {
    GEO.box = new T.BoxGeometry(1, 1, 1);
    GEO.sphere = new T.SphereGeometry(1, 14, 12);
    GEO.cyl = new T.CylinderGeometry(1, 1, 1, 14);
    GEO.cone = new T.ConeGeometry(1, 1, 14);
    GEO.melon = new T.SphereGeometry(1, 16, 14);
    GEO.iron = new T.IcosahedronGeometry(1, 1);
    GEO.circle = new T.CircleGeometry(1, 22);
    GEO.torus = new T.TorusGeometry(1, 0.18, 10, 18);
    GEO.blobGeo = new T.CircleGeometry(1, 26);
    R3.blobMat = new T.MeshBasicMaterial({ color: 0x0c1608, transparent: true, opacity: 0.5, depthWrite: false });
  }

  function mesh(geo, mat, sx, sy, sz, x, y, z) {
    const m = new T.Mesh(geo, mat);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = false;
    return m;
  }

  /* ================= TERRAIN & BACKDROP ================= */
  function buildSky() {
    const tex = canvasTex(16, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#3f8fd6');
      g.addColorStop(0.45, '#7cc0ea');
      g.addColorStop(0.8, '#b8e0f5');
      g.addColorStop(1, '#dff0e2');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    R3.scene.background = tex;
    R3.scene.fog = new T.Fog(0xbfe3ee, 260, 620);
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
    const meadow = new T.Mesh(new T.PlaneGeometry(560, 420), new T.MeshToonMaterial({ map: mtex, gradientMap: GRAD }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(0, -0.4, 0);
    meadow.receiveShadow = true;
    R3.scene.add(meadow);
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

  function buildCottage() {
    const g = new T.Group();
    const wall = toon(0xf3e6c8), roof = toon(0xb0533a), timber = toon(0x7a5a38);
    const W = PX(84), H = PX(56), D = PX(64);
    g.add(mesh(GEO.box, wall, W, H, D, 0, H / 2, 0));
    // gable roof: two slabs
    const rl = Math.hypot(W / 2, PX(26)) + PX(3);
    const r1 = mesh(GEO.box, roof, rl, PX(4), D + PX(8), -W / 4, H + PX(12), 0); r1.rotation.z = Math.atan2(PX(26), W / 2);
    const r2 = mesh(GEO.box, roof, rl, PX(4), D + PX(8), W / 4, H + PX(12), 0); r2.rotation.z = -Math.atan2(PX(26), W / 2);
    g.add(r1); g.add(r2);
    // timber trim
    g.add(mesh(GEO.box, timber, W + PX(2), PX(4), PX(2), 0, H, D / 2 - PX(0.5)));
    g.add(mesh(GEO.box, timber, PX(3), H, PX(3), -W / 2 + PX(1), H / 2, D / 2 - PX(1)));
    g.add(mesh(GEO.box, timber, PX(3), H, PX(3), W / 2 - PX(1), H / 2, D / 2 - PX(1)));
    // door (facing board, +x side)
    g.add(mesh(GEO.box, toon(0x6a4526), PX(2), PX(24), PX(15), W / 2 + PX(0.5), PX(12), PX(6)));
    // glowing window
    const win = mesh(GEO.box, new T.MeshBasicMaterial({ color: 0xffdf8a }), PX(1.5), PX(12), PX(12), W / 2 + PX(0.5), PX(32), -PX(10));
    g.add(win);
    g.add(mesh(GEO.box, timber, PX(2.4), PX(14), PX(14), W / 2 + PX(0.4), PX(32), -PX(10)));
    // chimney
    g.add(mesh(GEO.box, toon(0x9a7050), PX(8), PX(16), PX(8), -W / 4, H + PX(24), -D / 4));
    g.position.set(-COL_W3D * 5 - PX(70), 0, -PX(14));
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
    // Treeline right behind the fence — fills the top of the frame the way
    // BTD6 fills its top edge with vegetation. Bushy sphere clusters, two
    // tones, varied heights; a couple of taller tree clusters for rhythm.
    const g = new T.Group();
    const mH1 = toon(0x2e6630), mH2 = toon(0x3a7d38), mH3 = toon(0x265426);
    const zH = -1.5 * LANE_D3D - PX(52);
    let x = -COL_W3D * 5 - PX(140);
    let i = 0;
    while (x < COL_W3D * 5 + PX(190)) {
      const h = 24 + Math.sin(i * 1.7) * 5 + Math.random() * 4;
      const r = h * 0.42;
      const m = [mH1, mH2, mH3][i % 3];
      const bush = new T.Group();
      const n = 3;
      for (let b = 0; b < n; b++) {
        const bx = (Math.random() - 0.5) * r * 1.2;
        const by = h * 0.35 + Math.random() * h * 0.3;
        const bz = (Math.random() - 0.5) * 3;
        const br = r * (0.7 + Math.random() * 0.5);
        const s = mesh(GEO.sphere, m, br, br * 0.85, br, bx, by, bz);
        bush.add(s);
      }
      if (i % 5 === 2) { // taller accent tree
        const th = h * 1.5;
        bush.add(mesh(GEO.cyl, toon(0x6a4a2c), 1.2, th * 0.5, 1.2, 0, th * 0.25, 0));
        bush.add(mesh(GEO.cone, mH3, h * 0.75, th * 0.8, h * 0.75, 0, th * 0.75, 0));
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
    // silhouette hills on alpha planes, two depths
    function hill(color, z, hgt, seed) {
      const tex = canvasTex(1024, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = color;
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 16) {
          const y = h - (h * 0.35 + h * 0.3 * Math.abs(Math.sin(x * 0.006 * seed + 1.3)) + h * 0.22 * Math.sin(x * 0.0023 * seed));
          c.lineTo(x, y);
        }
        c.lineTo(w, h); c.closePath(); c.fill();
      });
      const m = new T.Mesh(new T.PlaneGeometry(620, hgt),
        new T.MeshBasicMaterial({ map: tex, transparent: true, fog: true }));
      m.position.set(0, hgt / 2 - 6, z);
      R3.scene.add(m);
    }
    hill('#9ecf8e', -230, 130, 1.7);
    hill('#7cbb6c', -170, 90, 2.6);
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
      const sc = 60 + Math.random() * 70;
      s.scale.set(sc, sc * 0.45, 1);
      s.position.set((Math.random() - 0.5) * 420, 75 + Math.random() * 55, -240 - Math.random() * 60);
      s.userData.speed = 1.2 + Math.random() * 1.6;
      R3.scene.add(s); R3.clouds.push(s);
    }
  }

  function buildWindmill() {
    const g = new T.Group();
    g.add(mesh(GEO.cyl, toon(0xe8dcc0), PX(11), PX(46), PX(11), 0, PX(23), 0));
    g.add(mesh(GEO.cone, toon(0xa04a34), PX(13), PX(12), PX(13), 0, PX(52), 0));
    const hub = new T.Group(); hub.position.set(0, PX(50), PX(11));
    for (let i = 0; i < 4; i++) {
      const b = mesh(GEO.box, toon(0xf0e8d4), PX(3.4), PX(30), PX(1.4), 0, PX(15), 0);
      const arm = new T.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(b);
      hub.add(arm);
    }
    g.add(hub);
    g.position.set(COL_W3D * 5 + PX(150), 0, -PX(150));
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

  function buildZombieModel(z) {
    const g = new T.Group();
    const mats = [];
    const M_ = (color, opts) => { const m = toon(color, opts); mats.push(m); return m; };
    const skin = z.type === 'brute' ? 0xa4cc58 : (z.type === 'runner' ? 0xbccc78 : 0xb2cc74);
    const shirt = z.type === 'brute' ? 0x4c3a26 : (z.type === 'runner' ? 0x2e4a5e : 0x6e3a30);
    const mSkin = M_(skin), mShirt = M_(shirt), mPants = M_(0x2e2a20), mDark = M_(0x262a20);

    // legs (pivot at hip)
    const legL = new T.Group(), legR = new T.Group();
    legL.position.set(0, PX(36), PX(7)); legR.position.set(0, PX(36), -PX(7));
    legL.add(mesh(GEO.box, mPants, PX(11), PX(36), PX(12), 0, -PX(18), 0));
    legR.add(mesh(GEO.box, mPants, PX(11), PX(36), PX(12), 0, -PX(18), 0));
    legL.add(mesh(GEO.box, mDark, PX(12), PX(5), PX(15), -PX(2), -PX(34), PX(1)));
    legR.add(mesh(GEO.box, mDark, PX(12), PX(5), PX(15), -PX(2), -PX(34), PX(1)));
    g.add(legL); g.add(legR);

    // torso group (pivot at hip) — breathing/sway/lean applied here
    const torso = new T.Group(); torso.position.set(0, PX(36), 0);
    torso.add(mesh(GEO.box, mShirt, PX(26), PX(38), PX(17), 0, PX(19), 0));
    torso.add(mesh(GEO.box, mPants, PX(24), PX(8), PX(16), 0, PX(1), 0));
    // ragged shirt hem
    torso.add(mesh(GEO.box, mDark, PX(26.4), PX(2.5), PX(17.4), 0, PX(3), 0));
    // chest strap — costume read so the torso isn't a bare box
    torso.add(mesh(GEO.box, mDark, PX(27), PX(5), PX(18), 0, PX(28), 0));

    // arms — outstretched toward -x (pivot at shoulder)
    const armL = new T.Group(), armR = new T.Group();
    armL.position.set(-PX(4), PX(32), PX(10)); armR.position.set(-PX(4), PX(32), -PX(10));
    const mkArm = (grp) => {
      grp.add(mesh(GEO.box, mShirt, PX(10), PX(9), PX(9), -PX(6), 0, 0));
      grp.add(mesh(GEO.box, mSkin, PX(24), PX(8), PX(8), -PX(22), -PX(1), 0));
      grp.add(mesh(GEO.box, mSkin, PX(6), PX(7), PX(9), -PX(34), -PX(1), 0)); // hand
    };
    mkArm(armL); mkArm(armR);
    torso.add(armL); torso.add(armR);

    // head (pivot at neck) — rounded cranium over a boxy jaw: chunky cartoon
    // skull, reads soft not "Minecraft"
    const head = new T.Group(); head.position.set(0, PX(40), 0);
    head.add(mesh(GEO.box, mSkin, PX(21), PX(17), PX(19), 0, PX(13), 0));
    const cranium = mesh(GEO.sphere, mSkin, PX(11.5), PX(10.5), PX(10.5), 0, PX(20), 0);
    head.add(cranium);
    head.add(mesh(GEO.box, mSkin, PX(7), PX(6), PX(11), -PX(11), PX(3), 0)); // jaw
    // eyes on -x face
    const mEye = M_(0xf2f2e9), mPup = M_(0x1c1c14);
    head.add(mesh(GEO.sphere, mEye, PX(4), PX(4), PX(4), -PX(10), PX(14), PX(5.5)));
    head.add(mesh(GEO.sphere, mEye, PX(4), PX(4), PX(4), -PX(10), PX(14), -PX(5.5)));
    head.add(mesh(GEO.sphere, mPup, PX(1.8), PX(1.8), PX(1.8), -PX(12.2), PX(14), PX(5.8)));
    head.add(mesh(GEO.sphere, mPup, PX(1.8), PX(1.8), PX(1.8), -PX(12.2), PX(14), -PX(5.8)));
    // brow
    head.add(mesh(GEO.box, mDark, PX(2), PX(2), PX(13), -PX(10.4), PX(18.5), 0));
    torso.add(head);

    // helmet (bucket) — visible only while z.helmet
    const helmet = new T.Group(); helmet.position.y = PX(21.5);
    const mMetal = M_(0xb8c0c8), mMetalD = M_(0x98a1aa);
    const bucket = mesh(GEO.cyl, mMetal, PX(11.5), PX(16), PX(11.5), 0, PX(8), 0);
    helmet.add(bucket);
    helmet.add(mesh(GEO.cyl, mMetalD, PX(12.3), PX(2.4), PX(12.3), 0, PX(16.2), 0));
    helmet.add(mesh(GEO.cyl, mMetalD, PX(12.1), PX(1.6), PX(12.1), 0, PX(0.6), 0));
    head.add(helmet);

    // shield — visible only while z.shield
    const shield = new T.Group(); shield.position.set(-PX(26), PX(30), 0);
    const mWood = M_(0xa08050), mWoodD = M_(0x8a6a3c), mEdge = M_(0x5f4526);
    shield.add(mesh(GEO.box, mWood, PX(4), PX(46), PX(32), 0, 0, 0));
    shield.add(mesh(GEO.box, mWoodD, PX(4.6), PX(5), PX(33), 0, PX(14), 0));
    shield.add(mesh(GEO.box, mWoodD, PX(4.6), PX(5), PX(33), 0, -PX(14), 0));
    shield.add(mesh(GEO.box, mEdge, PX(4.8), PX(48), PX(3), 0, 0, PX(15.5)));
    shield.add(mesh(GEO.box, mEdge, PX(4.8), PX(48), PX(3), 0, 0, -PX(15.5)));
    shield.add(mesh(GEO.box, mEdge, PX(4.8), PX(3), PX(33), 0, PX(22.5), 0));
    shield.add(mesh(GEO.sphere, mMetal, PX(3), PX(3), PX(3), -PX(2.8), 0, 0)); // boss
    g.add(shield);

    g.add(torso);
    const zs = z.type === 'brute' ? 1.5 : (z.type === 'runner' ? 1.08 : 1.22);
    g.scale.setScalar(zs);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

    return {
      group: g, mats, torso, head, legL, legR, armL, armR, helmet, shield,
      baseSkin: skin,
    };
  }

  function buildZombieBlob() { return makeBlob(PX(17)); }

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
    const g = new T.Group();
    const mStone = toon(0x9aa396), mStoneD = toon(0x7d867a);
    g.add(mesh(GEO.box, mStone, PX(22), PX(26), PX(7), 0, PX(13), 0));
    const top = mesh(GEO.cyl, mStone, PX(11), PX(7), PX(11), 0, PX(26), 0);
    top.rotation.x = Math.PI / 2;
    g.add(top);
    g.add(mesh(GEO.box, mStoneD, PX(26), PX(4), PX(10), 0, PX(2), 0));
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

  function poseZombie(model, z, time) {
    const { group, torso, head, legL, legR, armL, armR, helmet, shield, mats } = model;
    const s = z.seed;
    const state = z.state;

    // base transform
    const wp = worldPos(z.u, z.row, 0);
    group.position.set(wp.x, 0, wp.z);

    // reset accumulative channels
    torso.rotation.set(0, 0, 0);
    torso.position.set(0, PX(36), 0);
    head.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0);
    helmet.rotation.set(0, 0, 0);
    helmet.visible = z.helmet;
    shield.visible = z.shield;
    helmet.position.y = PX(21.5);
    group.rotation.set(0, 0, 0);
    group.position.y = 0;
    let opacity = 1;

    if (state === 'spawn') {
      const k = clamp01(z.spawnT / 0.55);
      group.position.y = (1 - k) * PX(60);
      opacity = k;
    } else if (state === 'hold') {
      const br = Math.sin(time * 2.2 + s) * 0.03;
      torso.scale.set(1 + br, 1 + br * 0.6, 1 + br);
      torso.rotation.z = Math.sin(time * 1.1 + s) * 0.03;
      armL.rotation.z = Math.sin(time * 1.3 + s) * 0.07;
      armR.rotation.z = Math.sin(time * 1.3 + s + 1) * 0.07;
      head.rotation.z = Math.sin(time * 0.9 + s) * 0.05;
      head.position.y = PX(40) + Math.sin(time * 2.2 + s) * PX(0.8);
    } else if (state === 'walk') {
      const ph = z.walkPhase;
      const legSw = Math.sin(ph) * 0.55;
      legL.rotation.z = legSw; legR.rotation.z = -legSw;
      legL.rotation.x = Math.cos(ph) * 0.1; legR.rotation.x = -Math.cos(ph) * 0.1;
      torso.rotation.z = 0.08 + Math.sin(ph * 2) * 0.03; // hunch + bob
      torso.scale.set(1, 1, 1);
      armL.rotation.z = -0.12 + Math.sin(ph + Math.PI) * 0.1;
      armR.rotation.z = -0.12 + Math.sin(ph) * 0.1;
      head.rotation.z = Math.sin(ph * 2 + 0.5) * 0.06;
      group.position.y = Math.abs(Math.sin(ph)) * PX(1.8);
    } else if (state === 'kneel') {
      legL.rotation.z = -1.15; legR.rotation.z = -1.35;
      group.position.y = -PX(15);
      torso.rotation.z = 0.35 + Math.sin(time * 2.5 + s) * 0.02;
      armL.rotation.z = 0.5; armR.rotation.z = 0.55;
      head.rotation.z = -0.25;
    } else if (state === 'die') {
      const k = clamp01(z.dieT / 0.7);
      group.rotation.z = k * 1.45;
      group.position.y = -PX(3) * k;
      opacity = z.dieT > 1.1 ? Math.max(0, 1 - (z.dieT - 1.1) / 0.5) : 1;
    } else if (state === 'glorydie') {
      const k = z.dieT;
      group.rotation.y = k * 9;
      group.position.y = Math.sin(Math.min(1, k / 0.55) * Math.PI) * PX(26);
      if (k > 0.55) group.rotation.z = clamp01((k - 0.55) / 0.4) * 1.5;
      opacity = k > 1.0 ? Math.max(0, 1 - (k - 1.0) / 0.6) : 1;
    }

    // hit flash
    const hf = z.hitFlash;
    for (const m of mats) {
      if (hf > 0) { m.emissive.setRGB(0.8 * hf, 0.05 * hf, 0.05 * hf); }
      else m.emissive.setRGB(0, 0, 0);
    }

    // wobbles
    if (z.helmetWobble > 0.01) helmet.rotation.z = Math.sin(time * 42) * z.helmetWobble * 0.9;
    if (z.shieldWobble > 0.01) shield.rotation.x = Math.sin(time * 38) * z.shieldWobble * 0.8;
    if (z.lean) group.rotation.z += z.lean * 0.3;

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

    // arm: rest -0.55, winds back with charge, swings through on release
    const armAng = -0.55 - p.charge * 1.9 + p.armSwing * 2.4 - p.recoil * 0.55;
    // sprite y-down rotation -> 3D y-up rotation around z (arm along +x)
    arm.rotation.z = armAng;

    heldMelon.visible = p.holding && !p.dead;
    if (p.blink > 0) {
      model.mats[4] && 0; // eyes are spheres; blink via scale below
    }
    if (model.eyeL) {
      const bl = p.blink > 0 ? 0.15 : 1;
      model.eyeL.scale.y = PX(6) * bl;
      model.eyeR.scale.y = PX(6) * bl;
    }
  }

  /* ================= INIT ================= */
  R3.init = function (canvas) {
    buildSharedGeo();
    const q = new URLSearchParams(location.search);
    const fov = parseFloat(q.get('fov')) || 44;
    const cy = parseFloat(q.get('cy')) || 85;
    const cz = parseFloat(q.get('cz')) || 72;
    const ty = parseFloat(q.get('ty')) || 8;
    const tz = parseFloat(q.get('tz')) || -2;

    R3.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    R3.renderer.setSize(1280, 720, false);
    R3.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    R3.renderer.shadowMap.enabled = true;
    R3.renderer.shadowMap.type = T.PCFSoftShadowMap;
    R3.renderer.outputEncoding = T.sRGBEncoding;

    R3.scene = new T.Scene();
    R3.camera = new T.PerspectiveCamera(fov, 1280 / 720, 1, 900);
    R3.camera.position.set(0, cy, cz);
    R3.camera.lookAt(0, ty, tz);
    R3.camera.updateMatrixWorld(true);
    R3.camBase = R3.camera.position.clone();

    // lights — saturated toon look: gentle fill, warm key, readable shadows
    const hemi = new T.HemisphereLight(0xcfe8ff, 0x6a8a4e, 0.34);
    R3.scene.add(hemi);
    const sun = new T.DirectionalLight(0xffe8c0, 1.12);
    sun.position.set(90, 190, 110);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0008;
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
    R3.menuZombie.blob = buildZombieBlob();
    R3.menuZombie.group.visible = false;
    R3.scene.add(R3.menuZombie.group);

    calibrateBoard();
    R3.ready = true;
  };

  /* ================= SYNC ================= */
  R3.pultTip3D = function (p) {
    // release pose tip (matches sprite fire pose: charge0, armSwing1, recoil1)
    const a = -0.55 + 2.4 - 0.55;
    const wp = worldPos(G.Board.pultU, p.row, 0);
    const rx = 60 * Math.cos(a) + 5 * Math.sin(a);
    const ry = 60 * Math.sin(a) - 5 * Math.cos(a);
    // sprite y-down rotation: screen up-right -> world +x,+y (arm pivot PX(8,80))
    return new T.Vector3(wp.x + PX(8 + rx), wp.y + PX(80 - ry), wp.z);
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
      if (!m) { m = buildZombieModel(z); m.blob = buildZombieBlob(); R3.zombiePool.set(z.id, m); R3.scene.add(m.group); }
      poseZombie(m, z, time);
      // blob shadow: feet contact + air-time shrink (spawn hop / glory launch)
      m.blob.position.set(m.group.position.x, 0.05, m.group.position.z);
      const airK = clamp01(1 - m.group.position.y / PX(60));
      m.blob.scale.setScalar(PX(17) * (0.55 + 0.45 * airK));
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
      if (pr.highArc) {
        const pulse = 0.5 + 0.3 * Math.sin(pr.launchT * 20);
        mm.scale.setScalar(PX(pr.heavy ? 17 : 15) * (1 + pulse * 0.15));
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

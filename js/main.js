/* ============================================================
   MELON MAYHEM — main.js
   Boot, fixed-timestep 60 FPS loop, resize letterbox.
   ============================================================ */
'use strict';
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  if (G.IS3D) {
    try { G.R3.init(document.getElementById('game3d')); }
    catch (e) { console.error('3D init failed, falling back to 2D:', e); G.IS3D = false; }
  }
  const input = new G.Input(canvas);
  const game = new G.Game(canvas, input);
  G.game = game;

  let last = performance.now();
  const time_now = () => performance.now() / 1000;
  let acc = 0;
  const STEP = 1 / 60;
  let fps = 60, fpsT = 0, fpsN = 0, showFps = new URLSearchParams(location.search).has('debug');

  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'f') showFps = !showFps;
  });

  // menu: click to start
  canvas.addEventListener('mousedown', e => {
    if (game.state === 'menu' && e.button === 0) {
      G.Audio.uiClick();
      game.start(1);
    }
  });

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // tab-back spike guard
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      game.update(STEP); // pause handling lives inside Game.update
      input.postUpdate(); // clear edge flags only after an update consumed them
      acc -= STEP;
      steps++;
    }
    // note: edge flags are consumed per-update above, not per-render frame
    if (G.IS3D && G.R3.ready) { G.R3.sync(game, time_now()); G.R3.render(); }
    game.draw(ctx);

    // fps meter
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    if (showFps) {
      ctx.save();
      G.outlinedText(ctx, `${fps} FPS`, 1230, 690, 14, fps >= 55 ? '#8ee05c' : '#ff5555', 'right');
      ctx.restore();
    }
  }
  requestAnimationFrame(frame);
})();

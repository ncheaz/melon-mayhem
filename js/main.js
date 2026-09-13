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
   MELON MAYHEM — main.js
   Boot, fixed-timestep 60 FPS loop, resize letterbox.
   ============================================================ */
'use strict';
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // SHORT GAME is the DEFAULT: two stages, a Don in each (stage 1 the
  // plain Don, stage 2 the FINAL capped Don + parade + THE END).
  // ?short=0 opts into the FULL 5-stage campaign.
  G.SHORT = new URLSearchParams(location.search).get('short') !== '0';
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

  // menu: click to start (the difficulty picker consumes its own clicks)
  canvas.addEventListener('mousedown', e => {
    if (game.state === 'menu' && e.button === 0) {
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (canvas.width / r.width);
      const my = (e.clientY - r.top) * (canvas.height / r.height);
      if (game.menuClick(mx, my)) return;
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

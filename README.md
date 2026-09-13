# Melon Mayhem 🍈💥

**Garden artillery versus the zombie horde.** A Plants-vs-Zombies-inspired
tower defense where your melon-pult lobs real-physics projectiles across a
4×10 garden — true arcs, apex-height skill shots, an armor-shredding economy,
glory kills, and a boss called **The Don**.

Fully playable in the browser. No build step, no external assets — every
sprite is drawn procedurally and every sound is synthesized in Web Audio.

## Running

Open `index.html` in any modern browser — that's it. (Or serve the folder if
you prefer: `python3 -m http.server`.)

- Default mode is **3D** (Three.js perspective scene) and **short campaign**
  (two stages, a Don in each).
- `index.html?short=0` — the full five-stage campaign.
- `index.html?flat` — the original 2D canvas renderer. Both render paths read
  the same simulation and the same zombie roster table, so gameplay is
  identical.
- `progress.html` — the development status page: architecture notes and a
  log of every gameplay piece and how it was verified.

## How to play

| Input | Action |
|---|---|
| **Mouse X** | Set the arc's midway X (10–80° angle) · ground ring shows the landing spot |
| **Hold LMB** | Charge power — the meter ramps, dwells at MAX for half a second, then cycles back to weak. Release to lob |
| **High arc** | Any shot with a steep apex counts as a **double hit** (x2 popups) — apex height is a real skill lever |
| **RMB** | Heavy iron-shell munition: one-hit kill, ignores armor. Stockpiled by landing glory kills |
| **W / S** | Hop the pult between the four lanes |
| **1 / 2 / 3** | Difficulty: Very Easy / Easy / Hard |
| **P / M / R** | Pause / Mute / Restart |

### The armor economy

Zombies march in from the right, hold each grid square, then advance. Armor is
per-tier — every shield and helmet has its own hit count (a cone pops in one,
a steel bucket soaks five, a screen door five, and so on), and armor is
knocked off with exaggerated animations rather than slowly ground down:

- **Front armor** (screen door, paper shield, pole, pads) absorbs frontal hits
  until it tears away
- **Head armor** (cone, bucket, helmet, hard hat) is knocked loose by head
  hits — one glowing high-arc lob rips it clean off
- **Headshot a helmetless zombie** and it drops to its knees for 3 seconds —
  walk-up and finish it for a **glory kill**, which refunds heavy munitions
- **Body:** body and head hits drain a visible health bar (5 hits take down a
  basic shambler)

Even The Don plays by it: forty body hits — or twelve high arcs — end him.

Lose if a zombie reaches the left edge and eats your brain — or touches the
pult.

### The campaign

Stage 1 (*the garden wakes*) → Stage 2 (**THE DON** — high arcs rip his rug,
then he folds) → *masterless horde* → *the shadow grows* → **THE FINAL**, where
the cap comes off, the rug comes off, and The Don gets his last words.

## Project layout

```
index.html          entry point (3D by default, ?flat for 2D)
progress.html       dev status page
css/style.css
js/engine.js        math, input, camera shake, timing, projection
js/audio.js         fully synthesized sound (Web Audio)
js/zombie_types.js  the roster: stats, palettes, gait — single source of truth
js/sprites.js       procedural 2D vector art
js/zombie_art2d.js  roster-driven 2D zombie painter (skeletal rig)
js/boss_art2d.js    The Don: 2D caricature painter
js/render3d.js      Three.js perspective scene mirroring the 2D sim
js/game.js          state, physics, waves/stages, FX, HUD, win/lose
js/main.js          boot, fixed-timestep 60 FPS loop, letterbox
js/lib/three.min.js vendored Three.js (MIT)
```

The simulation runs untouched in board space (`u` = column units, lanes, height
units) with the same physics in both renderers; `render3d.js` mirrors that
state into the 3D scene.

## License

Copyright © 2026 Nixon Cheaz.

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU General Public License** as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [LICENSE](LICENSE).

`js/lib/three.min.js` is vendored Three.js, licensed under the
[MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE).

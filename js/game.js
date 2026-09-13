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
   MELON MAYHEM — game.js
   Game state, physics, zombies, armor economy, glory kills,
   waves/stages/obstacles, FX, HUD, win/lose.
   ============================================================ */
'use strict';
(function () {
  const { clamp, lerp, rand, randi, pick, damp } = M;

  // Fixed vertical rail for the pult at the left edge of the field.
  // Hopping lanes (W/S) changes ONLY y/scale — the drawn x must never move.
  // 208 = colX(r,0) − 10 in EVERY lane (uniform row scale: colX is
  // row-independent), so the rail sits just left of the leftmost square of
  // whichever lane the pult occupies, between the house (x<172) and column 0.
  const PULT_RAIL_X = 208;

  // Iron munition cap. Glory kills forge shells up to this stockpile.
  const IRON_MAX = 15;

  // Rail anchor for overlay FX & probes. In 3D the perspective makes
  // colX(row,0) row-dependent — always derive from the live projection;
  // flat mode keeps the legacy constant.
  function pultRailX(row) {
    return G.IS3D ? G.Board.colX(row, 0) : PULT_RAIL_X;
  }

  // HIGH ARC threshold, in units of apex HEIGHT above the ground: ANY hit
  // delivered from an arc that crests at/above this counts as TWO hits
  // (every damage popup from that shot gets ' x2'). With real ballistics a
  // 4.0u crest clears a gravestone (2.8u, see STONE_BLOCK_H) 1.4× and is
  // reachable from ~⅔ bar at 45° — a meaningful, attainable skill target.
  // Game.highArcH() exposes it; Projectile keys its highArc flag off it —
  // single source of truth.
  const HIGH_ARC_H = 4.0;
  G.HIGH_ARC_H = HIGH_ARC_H;   // exposed for Projectile (same module, later use)

  // GRAVESTONE height, in Board height units — the ONE number for how tall an
  // obstacle stone is, and it is the same number in BOTH render paths:
  // drawTombstone (2D) is authored ×1.4 to ≈106 sprite px ≈ 2.8u, and
  // buildTombstoneModel (3D) to ≈9.4wu — 0.6× a walker, the PvZ gravestone
  // read, instead of the old 0.35× pebble. The projectile test blocks
  // anything crossing a stone below this, so the hitbox tracks the art; a
  // HIGH ARC (4.0u) still clears it, which is the whole point of the lever.
  const STONE_BLOCK_H = 2.8;

  // STRONG THROW (glow) window — the melon glows, and glowing hits stun, only
  // when BOTH levers are set: the launch angle is over STRONG_ANGLE (45°)
  // AND the charge sits between the HIGH ARC marker and the MAX line. Over
  // MAX the throw is overcharged: no glow, no stun bonus.
  const STRONG_ANGLE = 45;
  G.STRONG_ANGLE = STRONG_ANGLE;

  // How long a bare-headed zombie stays on its knees after a head hit. The
  // kneel IS the glory-kill window, so this is the player's follow-up window.
  const KNEEL_SECONDS = 5;

  // WAVE STORY — one line per wave, shown under the wave banner. The arc runs
  // stage 1 (the garden wakes) → 2 (THE DON comes) → 3 (masterless horde)
  // → 4 (the shadow grows) → 5 (THE FINAL). Boss stages read line 5.
  const STORY = {
    1: ['Day 1 — the melon-pult is all that stands between them and your brain.',
        'They shamble between the tomato rows. Hold the lawn.',
        'The graveyard is emptying. The fence is next.',
        'The lawn holds — but something BIG stomps somewhere west.',
        'THE DON HIMSELF — high arcs rip the rug, then he folds.'],   // short mode only
    2: ['Day 2 — his crew walks in first. The Don never leads from the front.',
        'A huge orange shadow drums the horizon. Arc your shots.',
        'The ground shakes with every stomp. Stack some iron.',
        'He can smell the melons. Everything he has is on the lawn.',
        'THE DON HIMSELF — high arcs rip the rug, then he folds.'],
    3: ['The Don is down — but nobody told the horde.',
        'They shuffle on, masterless and hungry. The garden is still not yours.',
        'Runners in the rows. Keep the high arcs coming.',
        'The hills go quiet. Quiet is not the same as safe.'],
    4: ['Rumor from the far ridge: a cap, red as the sunset.',
        'He is back — rebuilt, furious, and wearing the crown this time.',
        'Everything the horde has left is marching. Spend iron freely.',
        'The sky turns gold, then grey. The FINAL stage is next.'],
    5: ['THE LAST STAGE — whatever is left of the horde comes all at once.',
        'The ground hums. The tombstones lean away from the hills.',
        'High arcs win wars. Iron wins emergencies. Keep both.',
        'Two stomps on the ridge. THE DON is back — and the cap is red.',
        'THE DON · FINAL — cap off, rug off, finish him FOR GOOD.'],
  };

  /* ---------- THE DON'S LAST WORDS ----------
     When he drops he does not just vanish: still on his feet he RAMBLES —
     three random messages, incoherent and merciless, each bubble somewhere
     new around him — then thinks one last impossible thought, and only
     then does the exit take him (the chopper, or the ground itself). */
  const DONFALL_MSG_T = 5;        // seconds per ramble bubble — time to read it
  const DONFALL_THOUGHT_T = 5.5;  // the last, incoherent thought lingers this long
  const COLLAPSE_T = 1.8;         // the first Don folds to the turf this fast
  const COLLAPSE_SETTLE_T = 0.5;  // ...and bounces to rest before the thought
  /* ---------- THE LAST FLIGHT ----------
     He is not tipped over and he is not swallowed: a helicopter hooks him,
     hauls him off his feet and out of the frame, flies him away to the
     horizon, brings him back — and DROPS him. He comes down out of the sky
     onto his own lawn, and the chopper follows him in and piles itself up
     beside him. The next-wave screen waits for every one of these beats.
     The choreography itself lives in ONE place (render3d's heliPath) so both
     render paths and every probe read the same story; these are its clock. */
  const HELI_IN_T = 2.4;      // rotor down, decelerating to a hover over him
  const HELI_HOOK_T = 1.0;    // the rope pays out and the harness snaps on
  const HELI_LIFT_T = 2.2;    // hauled off his feet, up and out of the frame
  const HELI_AWAY_T = 2.4;    // away, climbing, shrinking into the distance
  const HELI_BACK_T = 3.0;    // back — a speck on the horizon, then in again
  const HELI_DROP_T = 1.5;    // the buckle lets go and he falls
  const HELI_FOLLOW_T = 2.6;  // the chopper comes down after him
  const HELI_SMOKE_T = 1.8;   // and the lawn smokes where they landed
  /* THE PICKUP LINE rides the rope for THREE seconds: it pops in just before
     the harness snaps on (the last 0.15 s of the hook) and pops out a beat
     into the haul-away — 0.15 + lift 2.2 + 0.65 ≈ 3 s, then it is gone. The
     old gate read the DROP instead and hung the line over the whole flight. */
  const HELI_LINE_HOOKK = 0.85;
  const HELI_LINE_CARRYK = 0.27;   // 0.65 s into the 2.4 s away leg
  /* ---------- THE SWALLOW (the FINAL boss only) ----------
     No chopper at all: the lawn opens under him, he goes down into it, and
     the ground throws fire, rock and lava back up for ten full seconds
     before it closes over him. The flames are game-side particles drawn on
     the shared overlay, so the 2D path and the 3D path show the same thing. */
  const SWALLOW_OPEN_T = 0.9;     // the ground gapes open this fast
  const SWALLOW_SINK_AT = 0.55;   // in he goes, once the mouth is most of the way open
  const SWALLOW_SINK_T = 4.2;     // a THIRD of the old 1.4s — a slow, deliberate swallow
  const SWALLOW_FIRE_T = 10.0;    // TEN FULL SECONDS of it before the ground shuts
  const SWALLOW_CLOSE_T = 0.8;    // how long the hole takes to sew itself up
  const SWALLOW_TOTAL = SWALLOW_FIRE_T + SWALLOW_CLOSE_T + 0.3;
  const SWALLOW_SPEW_T = 0.55;    // seconds between rocks / lava launches
  // his last thought does not ride the dialog: it drifts up out of the HOLE,
  // once he is all the way under and the ground is already spitting chunks
  const SWALLOW_THOUGHT_AT = SWALLOW_SINK_AT + SWALLOW_SINK_T + 0.9;
  const SWALLOW_HOLE_THOUGHT_T = Math.min(DONFALL_THOUGHT_T,
    SWALLOW_TOTAL - 0.25 - SWALLOW_THOUGHT_AT);
  /* ...and after the ground sews itself shut, one last card before the chase:
     THE DON IS <term> — the term rolled fresh every run from DON_COOKED — a
     sarcastic sub-line under it, and five seconds to read before the horde
     comes marching back out. */
  const SEEYA_T = 5;              // the good-riddance card lingers this long
  const DON_COOKED = [
    'WELL DONE', 'EXTRA CRISPY', 'FULLY ROASTED', 'MEDIUM-RARE',
    'CHAR-BROILED', 'FLAMBÉED', 'TOASTED', 'COOKED',
    'BURNT TO A CRISP', 'A SMOKING CRATER', 'REDUCED TO ASH', 'A PUBLIC ROAST',
    'WELL AND TRULY DONE', 'PRESSED INTO PULP', 'PRESSURE-COOKED',
    'SLOW-ROASTED', 'SERVED COLD', 'GRILLED, THEN BILLED',
  ];
  const SEEYA_SUBS = [
    'The lawn has never looked better. The tomatoes sent a card.',
    'His final approval rating: zero percent. His ash percentage: huge.',
    'The compost heap took one look and refused him.',
    'The crows are already calling it their favorite episode.',
    'He said he would be back. The ground said: no.',
    'Rug: fake. Cap: confiscated. Don: done.',
    'The worms filed a restraining order at the ninety-foot mark.',
    'The lava asked for a transfer. Anywhere. It has standards.',
    'His library will be a pamphlet. Mostly coupons.',
    'History will remember a footnote with a comb-over.',
    'The fire marshal rated his legacy: "does not meet code."',
    'The ground kept the receipt. No refunds.',
    'He wanted a legacy. He got a landfill.',
    'The hole was the only thing proud to hold him.',
    'Approval rating underground: still zero. Consistency!',
    'The fire asked for his résumé, then burned it.',
    'Even the crows say he’s the best thing that ever fell in.',
    'The tomatoes sent a card. It was not sympathetic.',
  ];
  const SEEYA_KICKERS = [
    '— AN OFFICIAL LAWN ANNOUNCEMENT —',
    '— A MESSAGE FROM THE GARDEN —',
    '— DEPT. OF AGRICULTURE, FINAL RULING —',
    '— THE HOLE HAS SPOKEN —',
    '— CERTIFIED BY THE COMPOST BOARD —',
    '— FILED UNDER: GOOD RIDDANCE —',
  ];
  const SEEYA_BYES = [
    'GOOD RIDDANCE — SEE YA, DON!',
    'DON’T LET THE HOLE HIT YOU ON THE WAY DOWN.',
    'THE BEST GOODBYE. EVERYBODY SAYS SO.',
    'FAREWELL, YOU TANGERINE TRAGEDY.',
    'OUTSHOT BY A PULT. FOREVER.',
    'GONE. LIKE HIS MONEY.',
  ];
  /* The roast's big finish: the verdict line is set in a calligraphic script,
     HUGE, and it vibrates with rage — the one line the report builds to. */
  const FIRED_TXT = 'YOU ARE FIRED.';
  const FIRED_FONT = '"Brush Script MT","Segoe Script","Lucida Handwriting","Apple Chancery","URW Chancery L","Z003",cursive';
  /* ================= THE TAUNT BANKS =================
     Everything the lawn says once the Don is down — the scrolling report,
     the good-riddance card, the end screen — is rolled FRESH from these
     banks on every single run, so no two defeats read the same. The
     register is fixed: loud, merciless, and very funny. The neighbors have
     waited five whole stages for this, and they are not holding back.

     In the report exactly TWO lines never change — the verdict and the
     pult’s sign-off — because the report builds to the first and lands on
     the second. Everything else is dealt off the top of the deck. */
  const ROAST_EDITIONS = [
    '— special evening edition —',
    '— late extra: the lawn reacts —',
    '— victory edition, all caps —',
    '— the garden gazette, final word —',
    '— published once, cherished forever —',
    '— printed on 100% recycled campaign promises —',
  ];
  const ROAST_STATUS = [
    [['The undead horde: HERDED. The Don: DONE.', 26, '#f4f2e6']],
    [['Lawn attendance: record high.', 24, '#f4f2e6'], ['Don approval: record low. Again.', 24, '#f4f2e6']],
    [['One garden. One pult. One spectacular collapse.', 26, '#f4f2e6']],
    [['Tonight’s forecast: falling cap,', 24, '#f4f2e6'], ['100% chance of DONE.', 24, '#f4f2e6']],
    [['The biggest crowd this lawn ever drew —', 24, '#f4f2e6'], ['and every single one came to watch him lose.', 24, '#f4f2e6']],
    [['The garden stood up. The Don went down.', 26, '#f4f2e6'], ['Physics voted first. It voted melon.', 24, '#f4f2e6']],
    [['A local vegetable just achieved what entire', 24, '#f4f2e6'], ['agencies could not. Polls are calling it "huge." ', 24, '#f4f2e6']],
  ];
  const ROAST_SECTIONS = [
    // ---- the wall that never was ----
    [['He promised a wall around the garden.', 24, '#cfe8c2'], ['We built him a compost heap instead.', 24, '#cfe8c2']],
    [['He said the melons were paying for the wall.', 24, '#cfe8c2'], ['The melons declined. Loudly. At high speed.', 24, '#cfe8c2']],
    [['The wall remains unbuilt, unpaid,', 24, '#cfe8c2'], ['and now also on fire.', 24, '#cfe8c2']],
    // ---- the hair ----
    [['His cap was confiscated at the lawn line.', 24, '#ffe9a0'], ['His rug? Blown clean off. Fake hair. Real losses.', 24, '#ffe9a0']],
    [['Scientists studied the swoop for six hours.', 24, '#ffe9a0'], ['Conclusion: gravity, but personally offended.', 24, '#ffe9a0']],
    [['The wind took one look at that quiff', 24, '#ffe9a0'], ['and took it personally.', 24, '#ffe9a0']],
    [['The rug survived the fall intact.', 24, '#ffe9a0'], ['It has already been offered a better job.', 24, '#ffe9a0']],
    // ---- the cap ----
    [['The red cap read MAKE HIM GONE.', 24, '#ffe9a0'], ['The lawn agreed. Unanimously.', 24, '#ffe9a0']],
    [['He wore the cap. The cap asked', 24, '#ffe9a0'], ['to retire after this one. It has seen enough.', 24, '#ffe9a0']],
    // ---- the melons ----
    [['No collusion — just collision,', 24, '#b9ff2e'], ['with melons, at terminal velocity.', 24, '#b9ff2e']],
    [['Special counsel: one melon.', 24, '#b9ff2e'], ['Findings: direct. Repeated. Delicious.', 24, '#b9ff2e']],
    [['He tried to grab the harvest by the stem.', 24, '#b9ff2e'], ['The harvest grabbed back. At 45 degrees. Twice.', 24, '#b9ff2e']],
    [['The melons never read his speeches.', 24, '#b9ff2e'], ['They simply answered them.', 24, '#b9ff2e']],
    [['Every shot landed like a subpoena.', 24, '#b9ff2e'], ['He ignored them all equally.', 24, '#b9ff2e']],
    // ---- the courts ----
    [['Impeached by artillery. Convicted by squash.', 26, '#ff9e3d']],
    [['The jury: nine kinds of undead.', 24, '#ff9e3d'], ['The verdict: yes. All of it. Immediately.', 24, '#ff9e3d']],
    [['His defense: "I hardly know the melon."', 24, '#ff9e3d'], ['The melon: "He’s lying." Everyone believed the melon.', 24, '#ff9e3d']],
    [['Indicted on forty counts of standing there', 24, '#ff9e3d'], ['smugly. Forty convictions. A perfect record!', 24, '#ff9e3d']],
    [['The appeals court is a scarecrow.', 24, '#ff9e3d'], ['The scarecrow is not moved. Literally.', 24, '#ff9e3d']],
    // ---- the money ----
    [['He billed the garden for the invasion.', 24, '#f4f2e6'], ['The garden sent back this report instead.', 24, '#f4f2e6']],
    [['Six bankruptcies. One lawn.', 24, '#f4f2e6'], ['The lawn is somehow still richer.', 24, '#f4f2e6']],
    [['He tried to trademark the victory.', 24, '#f4f2e6'], ['The victory politely declined to be his.', 24, '#f4f2e6']],
    // ---- the golf ----
    [['His golf cart fled the scene early.', 24, '#cfe8c2'], ['It has since applied for asylum. Granted.', 24, '#cfe8c2']],
    [['He lost a full round to farm equipment', 24, '#cfe8c2'], ['playing from the rough. The vegetable rough.', 24, '#cfe8c2']],
    // ---- the hole ----
    [['The ground opened early. Even the dirt', 24, '#f4f2e6'], ['saw him coming and braced itself.', 24, '#f4f2e6']],
    [['The hole charged him rent on the way down.', 24, '#f4f2e6'], ['The first landlord to ever collect.', 24, '#f4f2e6']],
    [['The lava asked for a transfer.', 24, '#f4f2e6'], ['Anywhere. Immediately. It has standards.', 24, '#f4f2e6']],
    // ---- the legacy ----
    [['Two tours of this garden. Two total wipeouts. SAD!', 26, '#ff9e3d']],
    [['He had the best words.', 24, '#ff9e3d'], ['The melons had the best trajectories.', 24, '#ff9e3d']],
    [['He wanted a monument.', 24, '#ff9e3d'], ['The lawn gave him a scorch mark and a smell.', 24, '#ff9e3d']],
    [['Historians will call it "the incident', 24, '#ff9e3d'], ['with the vegetable." All of it. Just that.', 24, '#ff9e3d']],
    [['In the end he lost, decisively,', 24, '#ff9e3d'], ['to farm equipment. In a garden. In public.', 24, '#ff9e3d']],
    // ---- the garden’s verdict on all of it ----
    [['The roses called it "a cleansing."', 24, '#cfe8c2'], ['The weeds called it "overdue."', 24, '#cfe8c2']],
    [['The compost has opinions now.', 24, '#cfe8c2'], ['All of them are mean. All of them are fair.', 24, '#cfe8c2']],
  ];
  const ROAST_VERDICT_LEAD = [
    'The Melon-Pult has spoken:',
    'The garden’s ruling is final:',
    'The Harvest Court has reached a verdict:',
    'By order of the lawn, the squash, and the pult:',
    'The official record states, in part:',
    'After two invasions, one hole, and zero excuses:',
  ];
  const ROAST_AFTERMATH = [
    'The graveyard is empty. The tomatoes stand tall.',
    'The melons rest easy. The brains remain uneaten.',
    'The lawn is greener now. Suspiciously greener. Worth it.',
    'The fence is being repainted over the scorch. Today.',
    'The crows wrote a ballad. It is not a kind one.',
    'The gnomes stood and applauded. All night. In the rain.',
    'The birdbath still smells faintly of bronzer.',
    'The scarecrow applied for his old job. It went great.',
    'Somewhere below, he is still explaining how he won.',
  ];
  /* THE END screen — the frame never changes (CONGRATULATIONS … THE END),
     but the sub-headline, the quip and the sign-off are dealt fresh. */
  const END_HEADS = [
    'THE DON IS GONE FOR GOOD. CAP OFF. RUG OFF. GONE.',
    'THE DON IS GONE. THE LAWN IS SAFE. THE TAN IS ELSEWHERE.',
    'HE CAME. HE SWAYED. HE GOT PULTED. TWICE.',
    'GONE LIKE A PROMISE AT BILLING TIME.',
    'TWO DONS ENTERED A GARDEN. ZERO MATTERED.',
    'HISTORIC LOSS. THE BIGGEST. EVERYONE AGREES.',
    'THE GARDEN SLEPT GREAT, ACTUALLY.',
  ];
  const END_QUIPS = [
    'He demanded a rematch. The hole declined.',
    'His final statement was just the sound of falling.',
    'Somewhere below, he is still explaining how he won.',
    'The melons have unionized. First rule: no Dons.',
    'Historians agree: the funniest possible outcome.',
    'Even the fence feels taller now.',
    'The worms returned his application. Unopened.',
    'He will be remembered — briefly, unkindly, accurately.',
    'The scarecrow got his parking spot by lunchtime.',
  ];
  const END_THANKS = [
    'Thanks for playing MELON MAYHEM. The Don is unavailable for comment.',
    'Thanks for playing MELON MAYHEM. Zero brains lost. One ego destroyed.',
    'Thanks for playing MELON MAYHEM. The melons will remember your aim.',
    'Thanks for playing MELON MAYHEM. A vegetable did that to him. A vegetable.',
    'Thanks for playing MELON MAYHEM. Pult responsibly.',
    'Thanks for playing MELON MAYHEM. He is never coming back. Probably.',
  ];
  /* Deal the report: header + edition + status, FIVE sections drawn
     without replacement from the bank, the verdict lead-in, the verdict,
     two aftermath lines, and the pult’s sign-off. Rolled once per run and
     cached by roastLines(), so the scroll can never re-deal mid-flight. */
  function buildRoastLines() {
    const L = [];
    L.push(['THE NEIGHBORHOOD REPORT', 40, '#ffd23f']);
    L.push([pick(ROAST_EDITIONS), 18, '#cfe8c2']);
    L.push(['·', 14, '#5a6a52']);
    for (const ln of pick(ROAST_STATUS)) L.push(ln);
    const secs = [...ROAST_SECTIONS];
    for (let i = secs.length - 1; i > 0; i--) {
      const j = randi(0, i); [secs[i], secs[j]] = [secs[j], secs[i]];
    }
    for (const sec of secs.slice(0, 5)) for (const ln of sec) L.push(ln);
    L.push([pick(ROAST_VERDICT_LEAD), 24, '#cfe8c2']);
    L.push([FIRED_TXT, 76, '#ff5555']);   // the verdict: huge, calligraphic, shaking
    L.push(['·', 14, '#5a6a52']);
    const aft = [...ROAST_AFTERMATH];
    for (let i = aft.length - 1; i > 0; i--) {
      const j = randi(0, i); [aft[i], aft[j]] = [aft[j], aft[i]];
    }
    for (const t of aft.slice(0, 2)) L.push([t, 24, '#cfe8c2']);
    L.push(['…and the pult? Already reloading.', 24, '#ffd23f']);
    return L;
  }
  /* The crash is staged UP THE LAWN, not at his feet — the flight's own drop
     depth (twice the old one) in the 3D. These two are the same statement in
     2D: where the distant ground line sits, and how big the little tragedy
     gets. Both numbers are DOUBLE the old staging (150 / 0.62): the wreck now
     burns way out at the horizon, small and bright in the middle distance. */
  const FAR_LIFT = 300;           // px up the lawn for the distant ground line
  const FAR_DS = 0.34;            // and the apparent scale of what happens there
  // what he has to say about it, screamed from the harness
  const HELI_LINES = [
    ['PUT ME DOWN.', 'THIS IS A WITCH HUNT!'],
    ['I DID NOT', 'AUTHORISE THIS FLIGHT.'],
    ['THE BEST PEOPLE', 'HANDLE MY TRANSPORT.', 'THESE ARE NOT', 'THE BEST PEOPLE.'],
    ['I HAVE A', 'TREMENDOUS HELICOPTER.', 'BIGGER. GOLD. THIS ONE', 'IS A DISASTER.'],
  ];
  const GRIPE_T = 10;             // hat/rug destruction complaint lingers a full 10 s
  /* THE RAMBLE BANKS. Each Don draws his five bubble-rants from his OWN pool:
     the rug boss (first fight) and the cap boss (the finale) never share
     material. Five are shuffled out of the bank every single defeat, so no
     two eulogies read the same. */
  const DON_RAMBLE_1 = [
    ['I OBLITERATED the army.', 'The WHOLE army.', 'Nobody obliterates', 'like me. Ask anyone.'],
    ['The plants never got the nuke.', 'I HAD the nuke. A beautiful nuke.', 'They said, sir, you can\u2019t', 'nuke the garden. WRONG!'],
    ['This melon? Total loser.', 'Throws like a little baby.', 'Very weak. SAD!'],
    ['Nobody knows melons better', 'than me. The melon people,', 'big strong people, come up', 'to me with tears and say SIR.'],
    ['I won this garden', 'in a landslide.', 'A HUGE landslide.', 'The fake lawn media', 'will never show it.'],
    ['My rug was REAL.', 'The greatest rug. Many people', 'are saying it. This rug election', 'was RIGGED.'],
    ['They said, sir, you can\u2019t eat', 'brains on a Tuesday.', 'I ate them anyway.', 'Two. Maybe three.', 'Great brains. The best.'],
    ['Tremendous stomper.', 'Maybe the greatest stomper', 'in the history of stompers,', 'possibly ever. People are', 'saying it, everybody is.'],
    ['A windshield man came up to me,', 'big tears, he said SIR, the zombies,', 'they all love you.', 'All of them. Every single one.'],
    ['We had the best chromosomes.', 'Tremendous genes.', 'Everybody says so.', 'Believe me.'],
    ['I know zombies. Believe me,', 'I know more about zombies', 'than the zombie generals.', 'They won\u2019t let me prove it.'],
    ['The melon-pult? LOW ENERGY.', 'It threw at me. AT ME.', 'Nobody throws at me', 'and gets away with it.'],
    ['We\u2019ll build a moat.', 'A beautiful moat. And the melons,', 'they\u2019ll pay for the moat.', 'Every last seed.'],
    ['They said the rug was fake.', 'FAKE? It grew out of my head.', 'Out of it. Watch the tape.', 'The tape is closed.'],
    ['Two words for this garden:', 'TOTAL. VICTORY.', 'Okay, and a third word:', 'TREMENDOUS. And a fourth: SAD!'],
    ['The crows? My best crowd.', 'Massive crowd. The biggest.', 'The lawn media said eight crows.', 'THOUSANDS of crows.'],
    ['I was gonna be a farmer.', 'Best farmer. Nobody farms', 'like I farm. Ask the corn.', 'The corn LOVES me.'],
    ['This isn\u2019t over.', 'We\u2019ll be back.', 'Probably. Look busy.'],
    ['This garden was CRIME INFESTED.', 'Total crime. Zombie crime.', 'I made it safe in one day.', 'Like I always do. ONE day.'],
    ['The windmill? I built that.', 'They say a Dutchman built it.', 'WRONG. I built it.', 'The best windmill, maybe ever.'],
    ['A sunflower turned away from me.', 'ONE sunflower. Disloyal.', 'The rest face me all day.', 'They know. Everybody knows.'],
    ['I met the scarecrow.', 'Strong guy. Silent type.', 'We talked for two hours.', 'He did most of the listening.'],
    ['My hands are huge.', 'People come up to me, they say,', 'SIR, your hands are the size', 'of shovels. It\u2019s true. Look.'],
    ['The gardener begged me.', 'He said SIR, please, don\u2019t eat', 'the vegetable garden.', 'I ate the vegetable garden.'],
    ['Nobody hydrates like me.', 'I drink water like nobody\u2019s', 'business. The best water.', 'Many people don\u2019t know that.'],
    ['The fence is doing a', 'FANTASTIC job. A++ plus.', 'Fence of the year.', 'Almost as good as a wall.'],
    ['That melon-pult kid,', 'whoever built it — genius.', 'A total genius. Not like me.', 'I\u2019m a very stable genius.'],
    ['They spelled my name wrong', 'on the tombstone. SAD.', 'Biggest tombstone, though.', 'Tremendous tombstone. Everybody', 'says it\u2019s the biggest.'],
    ['My rug guy is the best.', 'Honest. Tough. Never talks.', 'Never talks to ANYBODY.', 'The perfect rug guy.'],
    ['I walked this lawn once.', 'Twenty holes in my shoes.', 'The grass apologized to me.', 'It cried. True story.'],
    ['Everything is computer now.', 'Even the zombies. Nobody', 'computers like me.', 'I\u2019m very good at computers.'],
  ];
  const DON_RAMBLE_2 = [
    ['THE GREAT COMEBACK!', 'They counted me out', 'after the compost.', 'Biggest comeback in history.', 'Everybody is saying it.'],
    ['This cap is ONE SIZE', 'FITS ALL.', 'Like my mandate.', 'My beautiful, huge mandate.'],
    ['I\u2019m not just a zombie.', 'I\u2019m a MOVEMENT.', 'The most handsome movement', 'in the history of movements.'],
    ['The polls said I lose the lawn.', 'The POLLS. Fake polls.', 'Fake lawn. Fake dirt.', 'The only real thing out here', 'is me. And the cap.'],
    ['I\u2019ll pardon myself.', 'Just watched it happen.', 'Beautiful paperwork.', 'The lawyers all said SIR,', 'you can\u2019t. WATCH ME.'],
    ['They tried MELONFARE.', 'Total melonfare.', 'Even the tomatoes agree.', 'And the tomatoes HATE me.'],
    ['Nobody negotiates like me.', 'I talked a fence into', 'lying down. A whole fence.', 'It\u2019s true. It\u2019s still down.'],
    ['Rally tonight. HUGE rally.', 'Right here. This lawn.', 'Everyone\u2019s coming.', 'Not you. You\u2019re fired.'],
    ['I know more about defeat', 'than any zombie alive.', 'Nobody gets defeated', 'like I get defeated.', 'It\u2019s a gift.'],
    ['The wheelbarrow? My idea.', 'The shovel? Mine.', 'Compost? I was into compost', 'before it was cool.', 'Way before. Ask anybody.'],
    ['They\u2019re eating the brains.', 'They\u2019re eating the cats.', 'They\u2019re eating the dogs', 'of the people who live here.'],
    ['Doctors ran the tests.', 'Cognitive test. PERFECT score.', 'Person, woman, man, camera,', 'ZOMBIE. Nailed it. First try.'],
    ['A brain came up to me.', 'Big brain. Tears in its folds.', 'It said SIR, please.', 'I said no. I\u2019m on a diet.'],
    ['This is ELECTION', 'INTERFERENCE.', 'That melon is INTERFERING', 'with my ELECTION.', 'LOCK IT UP!'],
    ['I\u2019ll debate the pult.', 'Any time. Any place.', 'It won\u2019t debate me.', 'It\u2019s scared. LOW ENERGY pult.'],
    ['\u2018The Art of the Shamble.\u2019', 'My book. Best seller.', 'Tremendous book.', 'Chapter One is my favorite.'],
    ['They spiked the melons.', 'With VICTORY. Terrible stuff.', 'Nobody spikes a melon', 'like the fake lawn media.'],
    ['I take full responsibility', 'for the GREAT stuff.', 'The other stuff?', 'Ask the melon. It knows.'],
    ['Two terms.', 'The best two terms in zombie', 'history. Maybe three.', 'We\u2019re looking into it.'],
    ['You call this a defeat?', 'This is a STRATEGIC', 'LAWN RETREAT.', 'Everybody will say I won.',],
  ];
  /* What he screams the instant his look is blown. One is picked at random
     and lingers for GRIPE_T seconds — each pool is a set, the pick is a die roll. */
  const CAP_GRIPE = [
    ['MY HAT!', 'That was a LIMITED EDITION.', 'Very rare. You have never', 'seen anything like it.'],
    ['You KNOW how much', 'that hat cost?', 'Neither do I. It was FREE.', 'But everybody wanted one!'],
    ['That hat was winning', 'elections for me.', 'GREAT elections.', 'The fairest. Maybe ever.'],
    ['First they come for the hat.', 'Then the brains.', 'This is EXACTLY', 'what I warned about.'],
    ['I want that hat BACK.', 'I\u2019m calling the lawn police.', 'They love me.', 'The WHOLE department.'],
    ['That hat has seen things.', 'TREMENDOUS things.', 'Rallies. Thousands of zombies.', 'All of them cheering.'],
    ['You just made', 'a POWERFUL enemy.', 'The hat was the powerful one.', 'But also me.'],
    ['Fine. FINE.', 'I have a whole closet of hats.', 'The best closet.', 'Nobody knows about it.'],
  ];
  const RUG_GRIPE = [
    ['MY RUG!', 'Do you know how LONG', 'that took every morning?', 'Hours. BEAUTIFUL hours.'],
    ['That rug was REAL.', 'One hundred percent real.', 'The realest rug', 'in the history of rugs.'],
    ['You ripped off', 'the WRONG zombie.', 'That rug had', 'brand recognition!'],
    ['The wind did that.', 'It was the wind.', 'A very strong wind.', 'The strongest. I saw it.'],
    ['That rug won debates.', 'It DEBATED for me.', 'The hair did the talking.', 'Everybody said so.'],
    ['The rug people are crying.', 'Big, strong rug people.', 'They come up to me and say', 'SIR, we are so sorry.'],
    ['Do you have ANY idea', 'what humidity does', 'to a skull like mine?', 'EXACTLY. Neither do I.'],
    ['That was a FULL head', 'of hair this morning.', 'The fullest.', 'Doctors say so.'],
  ];
  /* The last thought — the one he THINKS once the rant is spent. Incoherent
     on purpose: nobody is listening, least of all him. Every line trails off… */
  const DON_THOUGHTS = [
    ['at last… at last…', 'finally i meet up with Epstein again…', 'we will party together again…', 'the biggest party ever…'],
    ['i see him now… Epstein…', 'is that you, old friend…', 'save me a seat at the party…', 'we will party again… forever…'],
    ['finally…', 'Epstein and i, together again…', 'the party never ended…', 'it never ended…'],
  ];
  /* Where the ramble bubbles hover, relative to his feet: one spot per
     message, SHUFFLED every run so each bubble pops up somewhere new around
     him. The box clamps on-frame; the tail always stretches back to him. */
  const DONFALL_SPOTS = [
    [-240, -360], [240, -360],   // high shoulders
    [-300, -240], [300, -240],   // wide mid-air, left and right
    [0, -480],                   // straight overhead
    [-140, -505], [140, -505],   // the top corners
  ];
  /* ---- the boss\u2019s random life: lane hop + idle bits ---- */
  const LANE_ROLL_T = 3;        // a lane roll every 3 seconds…
  const LANE_JUMP_CHANCE = 0.2; // …1-in-5 he actually hops, even standing still
  const LANE_JUMP_T = 0.62;     // seconds airborne
  const LANE_JUMP_H = 150;      // arc apex, sprite px — a fat man leaves the earth

  // Difficulty tiers. count scales wave size, speed scales how fast zombies
  // advance (seconds-per-column shrinks), interval scales spawn gaps.
  G.DIFFS = {
    veryeasy: { label: 'VERY EASY', key: '1', count: 0.6, speed: 0.65, interval: 1.35, color: '#8ee05c' },
    easy:     { label: 'EASY',      key: '2', count: 0.8, speed: 0.85, interval: 1.15, color: '#ffd23f' },
    hard:     { label: 'HARD',      key: '3', count: 1.4, speed: 1.30, interval: 0.8,  color: '#ff5555' },
  };

  // Pult-only depth cue: mild extra scale response by lane, stacked on top of
  // Board.scale() for the pult sprite, its shadow and rail dust FX ONLY.
  // 0.92 (far row 0) → 1.08 (near row 3). Board.rowScale/laneY untouched.
  function pultLaneScale(r) {
    return 0.92 + 0.16 * clamp(r / (G.Board.ROWS - 1), 0, 1);
  }

  // Weight-of-hop squash channel driven purely by jumpT (0→1 over ~0.26s).
  // + = squash (wide/short), − = stretch (tall/thin). Amplitudes are tuned to
  // PERCEPTUAL thresholds at ±12–14%/1.0 scale: 1.0 → ±12–14% body deformation.
  //   takeoff compress       t 0.00→0.20  peak +1.00 at t=0.10
  //   airborne stretch       t 0.20→0.75  peak −0.75 at t≈0.475
  //   landing anticipation   t 0.75→1.00  peak +1.10 at t≈0.875
  function hopSquash(t) {
    const takeoff = Math.sin(clamp(t / 0.20, 0, 1) * Math.PI) * 1.0;
    const air = -Math.sin(clamp((t - 0.20) / 0.55, 0, 1) * Math.PI) * 0.75;
    const land = Math.sin(clamp((t - 0.75) / 0.25, 0, 1) * Math.PI) * 1.1;
    return takeoff + air + land;
  }

  /* ================= Particles ================= */
  class Particle {
    constructor(o) { Object.assign(this, { vx: 0, vy: 0, g: 0, drag: 0, life: 0.6, t: 0, size: 3, color: '#fff', type: 'dot', rot: 0, vr: 0 }, o); }
    update(dt) {
      this.t += dt;
      this.vy += this.g * dt;
      if (this.drag) { this.vx *= 1 - this.drag * dt; this.vy *= 1 - this.drag * dt; }
      this.x += this.vx * dt; this.y += this.vy * dt; this.rot += this.vr * dt;
      return this.t < this.life;
    }
    draw(ctx) {
      const k = 1 - this.t / this.life;
      ctx.save();
      ctx.globalAlpha = k;
      if (this.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = this.color; ctx.lineWidth = this.size * k;
        ctx.beginPath(); ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.vx * 0.03, this.y - this.vy * 0.03); ctx.stroke();
      } else if (this.type === 'dust') {
        ctx.globalAlpha = k * 0.5;
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size * (1 + this.t * 3), 0, Math.PI * 2); ctx.fill();
      } else if (this.type === 'chunk') {
        ctx.translate(this.x, this.y); ctx.rotate(this.rot);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size, -this.size * 0.7, this.size * 2, this.size * 1.4);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(-this.size, -this.size * 0.7, this.size * 2, this.size * 1.4);
      } else if (this.type === 'star') {
        G.Sprites.drawStar(ctx, this.x, this.y, this.size * (0.5 + k * 0.5), this.color);
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size * (0.4 + k * 0.6), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* ================= Floating popup text ================= */
  class Popup {
    constructor(txt, x, y, color, size = 22) {
      Object.assign(this, { txt, x, y, color, size, t: 0, life: 0.95, vy: -55 });
    }
    update(dt) { this.t += dt; this.y += this.vy * dt; this.vy *= 1 - 2.2 * dt; return this.t < this.life; }
    draw(ctx) {
      const k = this.t / this.life;
      const pop = this.t < 0.12 ? 0.5 + (this.t / 0.12) * 0.7 : 1.2 - Math.min(0.2, (this.t - 0.12) * 0.5);
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(this.x, this.y);
      ctx.scale(pop, pop);
      G.outlinedText(ctx, this.txt, 0, 0, this.size, this.color, 'center', '#1a1208');
      ctx.restore();
    }
  }

  /* ================= Fireworks =================
     Celebration-only FX. Deliberately NOT in game.particles: those are drawn
     inside the world pass and then dimmed by the win overlay, and a firework
     behind a 60%-alpha veil is not a celebration. Shells and embers live in
     their own arrays and are painted LAST, over everything.
     Embers are additive line segments — the cheapest thing that still reads as
     a tracer with several hundred of them in the air at 60 FPS. */
  const FW_PALETTE = ['#ffd23f', '#ff5ea8', '#6ef0ff', '#b9ff2e', '#ffffff', '#ff9c40', '#c58bff'];
  class Shell {
    // vx = sideways launch speed (shells can be fired at an ANGLE, not just
    // straight up); style picks the burst look (see Game.burst)
    constructor(x, targetY, color, night, big, col2, vx, style) {
      this.x = x; this.y = 780; this.targetY = targetY; this.color = color;
      this.night = night; this.big = !!big; this.col2 = col2 || null;
      this.vx = vx || 0; this.style = style || 'peony';
      this.v = big ? rand(600, 820) : night ? rand(470, 720) : rand(360, 520);
      this.t = 0; this.trailT = 0; this.dead = false;
    }
    update(dt, game) {
      this.t += dt;
      this.y -= this.v * dt;
      this.x += this.vx * dt;                     // the angled ascent
      this.v = Math.max(40, this.v - 110 * dt);   // a shell slows near its break
      this.trailT += dt;
      if (this.trailT > 0.022) {
        this.trailT = 0;
        game.fx.push(new Ember(this.x + rand(-2, 2), this.y + 8, rand(-16, 16), rand(20, 60),
          this.color, rand(0.2, 0.42), rand(2, 4), 30));
      }
      if (this.y <= this.targetY || this.v <= 60 || this.t > 2.6) { game.burst(this); this.dead = true; }
    }
    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.big ? 6 : this.night ? 4.4 : 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.big ? 15 : this.night ? 11 : 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  class Ember {
    constructor(x, y, vx, vy, color, life, size, g) {
      Object.assign(this, { x, y, vx, vy, color, life, size, t: 0, g: g === undefined ? 120 : g, drag: 0.85 });
    }
    update(dt) {
      this.t += dt;
      this.vy += this.g * dt;
      if (this.drag) { this.vx *= 1 - this.drag * dt; this.vy *= 1 - this.drag * dt; }
      this.x += this.vx * dt; this.y += this.vy * dt;
      return this.t < this.life;
    }
    draw(ctx) {
      const k = 1 - this.t / this.life;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.size * (0.35 + k * 0.9);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x - this.vx * 0.035, this.y - this.vy * 0.035);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* The paper rain: the calm after the send-off. Rectangles that tumble,
     sway and flip — the vertical scale fakes the paper turning over. */
  class Confetto {
    constructor() {
      this.x = rand(-30, 1310); this.y = rand(-90, -12);
      this.vy = rand(120, 230);
      this.sw = rand(1.6, 3.2); this.ph = rand(0, 6.3); this.amp = rand(26, 64);
      this.rot = rand(0, 6.3); this.vr = rand(-4, 4);
      this.w = rand(6, 11); this.h = rand(9, 15);
      this.color = pick(['#ff5ea8', '#ffd23f', '#6ef0ff', '#b9ff2e', '#ff9c40', '#c58bff', '#ffffff', '#ff6b6b']);
      this.t = 0;
    }
    update(dt) {
      this.t += dt;
      this.y += this.vy * dt;
      this.x += Math.sin(this.t * this.sw + this.ph) * this.amp * dt;
      this.rot += this.vr * dt;
      return this.y < 750;
    }
    draw(ctx) {
      const flip = Math.cos(this.t * 2.6 + this.ph);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot * 0.35);
      ctx.scale(1, Math.max(0.18, Math.abs(flip)));
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      if (flip < 0) {   // the shaded back of the paper
        ctx.fillStyle = 'rgba(10,10,20,0.35)';
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      }
      ctx.restore();
    }
  }

  /* ================= Projectile ================= */
  class Projectile {
    constructor(row, u0, opts) {
      // opts: { thetaDeg, speed, heavy }
      const B = G.Board;
      this.row = row;
      this.u = u0; this.h = 2.0;
      const sc = G.shotCalc(opts.thetaDeg, opts.speed);
      this.vu = sc.vu;
      this.vh = sc.vh;
      this.launchDeg = sc.deg;
      // HIGH ARC rule: a shot is x2 when its arc APEX clears HIGH_ARC_H —
      // steep angles + strong power crest high; flat fast shots skim.
      this.highArc = !opts.heavy && sc.H >= G.HIGH_ARC_H;
      // STRONG THROW: set by fire() when the release landed in the glow window
      // (aim > 45°, charge between the HIGH ARC marker and MAX). A glowing
      // melon stuns unprotected zombies and pops head armour in one hit.
      this.glowing = !!opts.glowing && !opts.heavy;
      this.heavy = !!opts.heavy;
      this.hitsDone = 0;
      this.spin = 0;
      this.dead = false;
      this.trail = [];
      this.trail3d = [];   // world-space trail for the 3D bead chain
      this.launchT = 0;
      // Visual launch continuity: the pult rides a fixed rail x that sits LEFT
      // of colX(row,0) on far lanes. The melon spawns at the drawn ARM TIP
      // (scoop melon position) and rides a short quadratic bezier — control
      // point = armTip + throwDir·30px, where throwDir continues the arm's
      // up-right release direction (launchDeg) — that marries the projected
      // path in ~0.14s. World (row,u) physics are untouched.
      this.launchSx = (opts.launchSx != null) ? opts.launchSx : null;
      this.launchSy = (opts.launchSy != null) ? opts.launchSy : null;
      this.launchDur = 0.14;
      if (this.launchSx != null) {
        const rad = -this.launchDeg * Math.PI / 180; // up-right on screen
        const tipS = B.scale(this.row);
        this.launchCx = this.launchSx + Math.cos(rad) * 30 * tipS;
        this.launchCy = this.launchSy + Math.sin(rad) * 30 * tipS;
      }
    }
    projK() {
      return 1 - Math.pow(1 - clamp(this.launchT / this.launchDur, 0, 1), 3); // ease-out cubic
    }
    // Quadratic bezier through (armTip → armTip+throwDir·30 → path point),
    // parameterised by the eased k. k=1 lands EXACTLY on the projected path.
    projSx() {
      const sx = G.Board.colX(this.row, this.u);
      if (this.launchSx == null) return sx;
      const k = this.projK(), i = 1 - k;
      return i * i * this.launchSx + 2 * i * k * this.launchCx + k * k * sx;
    }
    projSy() {
      const sy = G.Board.laneY[this.row] - G.Board.heightPx(this.row, this.h);
      if (this.launchSy == null) return sy;
      const k = this.projK(), i = 1 - k;
      return i * i * this.launchSy + 2 * i * k * this.launchCy + k * k * sy;
    }
    update(dt, game) {
      this.launchT += dt;
      this.vh -= G.Board.gravity * dt;
      this.u += this.vu * dt;
      this.h += this.vh * dt;
      this.spin += this.vu * dt * 2.4;
      const sx = this.projSx();
      const sy = this.projSy();
      // TRAIL FROM FRAME ONE — no launchDur gate: the streak traces the launch
      // bezier too, so it visibly bridges arm → flight path with no gap.
      // During the 0.14s ease the eased point sprints (ease-out cubic covers
      // ~⅓ of the bezier within the first frames), so early pushes are
      // length-capped: a point is kept only while it stays within EARLY_R of
      // the spawn tip — the first visible trail is a short, dense stub
      // hugging the arm; the aging 16-point buffer does the rest.
      const EARLY_R = 20;
      if (this.launchT < this.launchDur && this.launchSx != null) {
        const dx = sx - this.launchSx, dy = sy - this.launchSy;
        if (dx * dx + dy * dy <= EARLY_R * EARLY_R) this.trail.push({ x: sx, y: sy, t: 0 });
      } else {
        this.trail.push({ x: sx, y: sy, t: 0 });
      }
      // 16 points (was 12): a max-charge lob now hangs ~2s, so the streak
      // needs the longer buffer to read as one continuous arc.
      if (this.trail.length > 16) this.trail.shift();
      this.trail.forEach(p => p.t += dt);

      // world-space trail for the 3D bead chain — mirrors the exact visual
      // path (launch bezier bridge included) so the 3D streak matches 1:1
      {
        let wx, wy, wh;
        if (this.launchSx != null && this._tip3D && this.launchT < this.launchDur) {
          const k = this.projK(), i = 1 - k;
          const ph = { x: (this.u - 4.5) * G.R3.COL_W3D, y: Math.max(0.2, this.h) * G.R3.H3D, z: (this.row - 1.5) * G.R3.LANE_D3D };
          const c = this._ctrl3D, t0 = this._tip3D;
          wx = i * i * t0.x + 2 * i * k * c.x + k * k * ph.x;
          wy = i * i * t0.y + 2 * i * k * c.y + k * k * ph.y;
          wh = i * i * t0.z + 2 * i * k * c.z + k * k * ph.z;
        } else {
          wx = (this.u - 4.5) * G.R3.COL_W3D;
          wy = Math.max(0.2, this.h) * G.R3.H3D;
          wh = (this.row - 1.5) * G.R3.LANE_D3D;
        }
        this.trail3d.push({ x: wx, y: wy, z: wh, t: 0 });
        if (this.trail3d.length > 16) this.trail3d.shift();
        this.trail3d.forEach(p => p.t += dt);
      }

      // Impact test. Runs on BOTH the rise and the fall: a melon that touches
      // a zombie hits it, whether it is coming down onto the head or climbing
      // into the chest. The box spans the whole drawn figure INCLUDING the
      // cone/bucket/helmet — headwear used to sit above the old fixed 2.3u
      // ceiling, so hat shots passed straight through.
      {
        // tombstones block low arcs (STONE_BLOCK_H = the stone's drawn height)
        for (const ob of game.obstacles) {
          if (ob.row === this.row && Math.abs(ob.u - this.u) < 0.45 && this.h < STONE_BLOCK_H) {
            game.hitObstacle(this, ob); return;
          }
        }
        const direct = this.hitsDone === 0;
        for (const z of game.zombies) {
          if (z.row !== this.row || z.dead) continue;
          if (z.state === 'die' || z.state === 'glorydie') continue; // corpses don't collide
          const bands = z.hitBands();
          // a direct hit may land anywhere on the figure; splash/follow-up
          // hits only catch the legs, as before
          const top = direct ? bands.top : bands.legTop;
          // a boss owns a wider silhouette than half a column — the test
          // widens with the art so the player is not aiming at empty air
          const radius = (direct ? 0.58 : 0.72) * (z.hitRadius || 1);
          if (this.h <= top && this.h >= -0.25 && Math.abs(z.u - this.u) < radius) {
            game.resolveImpact(this, z);
            if (this.hitsDone >= 2 || (!this.highArc && !this.heavy && this.hitsDone >= 1)) {
              // regular shot: done after first direct contact (splash handled on ground)
              if (!this.heavy) { game.groundSplash(this); this.dead = true; }
            }
            return;
          }
        }
      }
      if (this.h <= 0.05 && this.vh < 0) {
        game.groundImpact(this);
        this.dead = true;
      }
      if (this.u > G.Board.COLS + 0.6 || this.u < -3) {
        // sailed off the field — still owes the player a MISS read
        if (this.hitsDone === 0 && !this.heavy && this.vh < 0) {
          const B2 = G.Board;
          const ex = B2.colX(this.row, clamp(this.u, -1, G.Board.COLS + 0.4));
          G.Audio.missPoof();
          game.addPopup(ex, B2.laneY[this.row] - 46, 'MISS', '#f0f0f0', 26);
          game.combo = 0;
        }
        this.dead = true;
      }
    }
    draw(ctx) {
      const B = G.Board;
      const s = B.scale(this.row);
      const sx = this.projSx();
      const groundY = B.laneY[this.row];
      const sy = Math.max(12, this.projSy());
      if (!G.IS3D) {
      // melon grows 0.9× → 1× while marrying the path (starts at the arm,
      // closer to camera feel)
      const m = lerp(0.9, 1, this.projK());
      // shadow
      const sk = clamp(1 - this.h / 8, 0.15, 1);
      ctx.save();
      ctx.globalAlpha = 0.3 * sk;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, groundY + 4 * s, 16 * s * sk, 5.5 * s * sk, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(s * m, s * m);
      G.Sprites.drawMelon(ctx, this.heavy ? 17 : 15, this.glowing ? 0.55 + 0.35 * Math.sin(this.launchT * 20) : 0, this.heavy, this.spin);
      ctx.restore();
      }
      // trail (both modes — screen-projected from the live path)
      // trail
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.trail.forEach((p, i) => {
        ctx.globalAlpha = (i / this.trail.length) * 0.5;
        ctx.fillStyle = this.heavy ? '#ff9c40' : '#eaffb0';
        ctx.beginPath(); ctx.arc(p.x, p.y, 7 * s * (i / this.trail.length), 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
  }

  /* ================= Zombie ================= */
  let ZID = 0;
  class Zombie {
    constructor(row, type, stage, speedMult = 1) {
      const T = G.ZT.get(type);
      this.id = ++ZID;
      this.row = row;
      this.u = 9.4 + rand(0, 0.3);
      this.type = T.id;             // roster id, see zombie_types.js
      this.spec = T;
      this.seed = Math.random() * 10;
      this.maxHp = T.hp;
      this.hp = this.maxHp;
      // armour tiers: head armour (cone/bucket/helmet/hard hat) and front
      // armour (screen door / newspaper / vaulting pole / shoulder pads).
      // Both keep the legacy z.helmet / z.shield flags so the damage code
      // downstream reads the same as it always did.
      this.headArmor = G.ZT.headArmor(T.id);
      this.frontArmor = G.ZT.frontArmor(T.id);
      this.helmet = !!this.headArmor;
      this.helmetHits = this.headArmor ? this.headArmor.hits : 0;   // e.g. bucket 5
      this.shield = !!this.frontArmor;
      this.shieldHits = this.frontArmor ? this.frontArmor.hits : 0;
      this.speedMult = speedMult;   // difficulty: how fast this zombie advances
      this.baseSpeed = T.speed;     // seconds per grid column at difficulty 1
      this.angry = false;           // newspaper zombie, once the paper is torn
      this.poleBroken = false;
      this.dents = 0;
      this.bodyJostle = 0;
      this.state = 'spawn'; // spawn | hold | walk | kneel | die | glorydie
      this.t = 0;                 // state timer
      this.holdDur = (T.gait === 'trot' ? 1.6 : 3.2) / speedMult;
      this.walkPhase = rand(0, 6);
      this.hitFlash = 0;
      this.dieT = 0;
      this.kneelTimer = 0;
      this.spawnT = 0;
      this.dead = false;
      this.lean = 0;
      this.helmetWobble = 0;
      this.shieldWobble = 0;
      this.gloryReady = false;
      this.holdBonus = 0;   // extra stand-still seconds banked from hits
      // grounded — the walk advance is gated on this (a mid-jump boss pauses
      // it). Leaving it undefined made EVERY walker freeze in place forever:
      // `undefined >= 1` is false, so nobody ever took a step.
      this.jumpT = 1;

      /* ---------------- BOSS ----------------
         The Don runs the same locomotion as every other corpse (spawn → hold
         → walk → hold …) but his damage model is a three-phase armour
         economy instead of a health bar. Every number comes from the
         roster's `boss` block; this is only the live state. */
      this.isBoss = !!T.boss;
      this.hitRadius = T.hitRadius || 1;
      if (this.isBoss) {
        const bd = T.boss;
        this.magaOn = !!bd.maga;      // final boss (stage 5) only: the red cap comes first
        this.magaHits = 0;            // flat hits toward bd.magaHits
        this.magaHigh = 0;            // high arcs toward bd.magaHigh
        this.toupeeOn = true;
        this.toupeeHigh = 0;          // high arcs only — the rug ignores flat shots
        this.bodyHits = 0;
        this.bodyHigh = 0;
        this.shakeAmp = 0;            // full-body shake, decays every frame
        this.shakeK = 0;
        this.holdDur = 2.6;           // a heavy beat, not a shamble
        this.maxHp = 1; this.hp = 1;  // the HUD bar owns the readout
        // ---- his random life: every LANE_ROLL_T seconds a LANE_JUMP_CHANCE
        // roll — he may hop a lane even when he has nowhere to advance —
        // plus idle bits (accordion hands, the YMCA) while parked.
        this.laneT = rand(1.2, 2.6);  // first roll soon after he boots
        this.jumpT = 1;               // 0..1 mid-jump, 1 = grounded
        this.jumpFrom = this.row; this.jumpTo = this.row;
        this.landSquash = 0;          // landing impact, decays
        this.idleKind = null;         // 'accordion' | 'ymca' | null
        this.idleT = 0; this.idleDur = 0; this.idleNext = rand(2, 5);
        this.gripeK = 0;              // 1→0 over GRIPE_T: the hands-up HOWL
      }
    }
    get bossPhase() {
      return this.magaOn ? 'CAP' : this.toupeeOn ? 'TOUPEE' : 'BARE';
    }
    /* Boss headwear is phase state, not a hits counter — the roster needs the
       live flags to size the collision box. */
    bossGear() { return { magaOn: this.magaOn, toupeeOn: this.toupeeOn }; }
    get speed() {
      const rage = this.angry && this.spec.rage ? this.spec.rage.speedMult : 1;
      return this.baseSpeed * rage / this.speedMult;
    }
    /* Vertical hit bands in Board height units — the collision box tracks the
       drawn figure (and its headwear) via the roster. Bosses pass their live
       phase flags: the box shrinks as the cap and the rug come off. */
    hitBands() { return G.ZT.hitBands(this.type, G.Board.pxPerHeight, this); }
    update(dt, game) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
      this.helmetWobble *= 1 - 6 * dt;
      this.shieldWobble *= 1 - 6 * dt;
      if (this.shakeAmp) {
        // the toupee/hit shake is the boss's stagger — unmistakable, brief
        this.shakeAmp *= 1 - 5.5 * dt;
        if (this.shakeAmp < 0.02) this.shakeAmp = 0;
      }
      if (this.isBoss) this.updateBossLife(dt, game);
      switch (this.state) {
        case 'spawn':
          this.spawnT += dt;
          if (this.spawnT >= 0.55) { this.state = 'hold'; this.t = 0; }
          break;
        case 'hold':
          this.t += dt;
          if (this.t >= this.holdDur + this.holdBonus) {
            this.state = 'walk'; this.t = 0; this.holdBonus = 0;
          }
          break;
        case 'walk': {
          this.t += dt;
          this.walkPhase += dt * 9;
          if (this.jumpT >= 1) this.u -= dt / this.speed;   // a lane jump pauses the advance
          // arrive at next integer square
          if (this.t >= this.speed) {
            this.u = Math.round(this.u);
            this.state = 'hold'; this.t = 0;
          }
          if (this.u <= -0.35) { game.brainEaten(this); }
          else if (this.row === game.pult.row && this.u <= G.Board.pultU + 1.25) { game.pultDestroyed(this); }
          break;
        }
        case 'kneel':
          this.kneelTimer -= dt;
          if (this.kneelTimer <= 0) { this.state = 'hold'; this.t = 0; this.gloryReady = false; }
          break;
        case 'die':
        case 'glorydie':
          this.dieT += dt;
          if (this.dieT > 1.6) this.dead = true;
          break;
      }
    }
    /* ---------- the boss's random life ----------
       He does not march like the others. Every three seconds a die roll:
       one chance in five he leaps to the other lane — advanced or not —
       with a proper animated jump, a dust kick and a screen-shaking thump.
       While parked he occasionally pumps his accordion hands, sometimes
       bursts into the YMCA. None of it is dangerous. All of it is HIM. */
    updateBossLife(dt, game) {
      if (this.state === 'die' || this.state === 'glorydie' || this.state === 'spawn') return;
      // ---- the lane jump
      if (this.jumpT < 1) {
        this.jumpT = Math.min(1, this.jumpT + dt / LANE_JUMP_T);
        if (this.jumpT >= 1) {
          this.row = this.jumpTo;
          const B = G.Board, sx = B.colX(this.row, this.u), sy = B.laneY[this.row];
          game.dustBurst(sx, sy, B.scale(this.row), 14, 1.5);   // the landing poof
          game.dustBurst(sx, sy, B.scale(this.row), 8, 2.6);    // …and a wider skirl
          game.camera.kick(7);                                   // the field feels it
          this.landSquash = 1;
          G.Audio.bossThud(false);
        }
      } else {
        this.laneT -= dt;
        if (this.laneT <= 0) {
          this.laneT = LANE_ROLL_T;
          if (Math.random() < LANE_JUMP_CHANCE) this.startLaneJump(game);
        }
      }
      this.landSquash = Math.max(0, this.landSquash - dt * 5);
      this.gripeK = Math.max(0, this.gripeK - dt / GRIPE_T);   // the howl winds down
      // ---- the idle bits, only while parked and grounded
      if (this.idleKind) {
        if (this.state !== 'hold' || this.jumpT < 1) { this.idleKind = null; this.idleNext = rand(2, 4); }
        else {
          this.idleT += dt;
          if (this.idleT >= this.idleDur) { this.idleKind = null; this.idleNext = rand(2.5, 5.5); }
        }
      } else if (this.state === 'hold' && this.jumpT >= 1) {
        this.idleNext -= dt;
        if (this.idleNext <= 0) {
          const r = Math.random();
          if (r < 0.42) { this.idleKind = 'accordion'; this.idleT = 0; this.idleDur = 2.4; }
          else if (r < 0.74) { this.idleKind = 'ymca'; this.idleT = 0; this.idleDur = 3.4; }
          else this.idleNext = rand(2, 4);   // sometimes he just stands there, fuming
        }
      }
    }
    startLaneJump(game) {
      if (this.jumpT < 1) return;
      const rows = this.spec.bootRows || [2, 3];
      const opts = rows.filter(r => r !== this.row);
      if (!opts.length) return;
      this.jumpFrom = this.row;
      this.jumpTo = opts[Math.floor(Math.random() * opts.length)];
      this.jumpT = 0;
      this.idleKind = null;                       // no dancing mid-air
      const B = G.Board;
      game.dustBurst(B.colX(this.row, this.u), B.laneY[this.row], B.scale(this.row), 9, 1.3);
      G.Audio.bossThud(false);
    }
    /* A hit knocks the zombie out of its stride: it stops dead, loses the
       progress it had made toward the next square, and stands an extra second
       before shambling on. The bonus is capped so a burst of hits can't pin a
       zombie to the spot forever. No-op while dying or already stunned — the
       kneel has its own timer and must not be shortened. */
    stagger() {
      if (this.state === 'die' || this.state === 'glorydie' || this.state === 'kneel') return;
      if (this.state === 'spawn') return;
      this.holdBonus = Math.min(2, this.holdBonus + 1);
      this.u = Math.round(this.u);   // stay on the grid — no half-square drift
      this.state = 'hold';
      this.t = 0;
      this.walkPhase = 0;
      if (this.isBoss) this.idleKind = null;      // the bit is over — he is HIT
    }
    pose() {
      return this.state === 'kneel' ? 'kneel' :
             this.state === 'die' ? 'die' :
             this.state === 'glorydie' ? 'glorydie' :
             this.state === 'walk' ? 'walk' : 'hold';
    }
    draw(ctx, time) {
      const B = G.Board;
      const s = B.scale(this.row);
      let sx = B.colX(this.row, this.u);
      let sy = B.laneY[this.row];
      // boss lane jump: ride the eased arc, high enough to clear a lane gap.
      // The row only flips when he LANDS (updateBossLife) — the drawn arc is
      // between the two lane lines while airborne.
      if (this.isBoss && this.jumpT < 1) {
        const k = this.jumpT;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        sy = B.laneY[this.jumpFrom] + (B.laneY[this.jumpTo] - B.laneY[this.jumpFrom]) * e
           - Math.sin(k * Math.PI) * LANE_JUMP_H;
      }
      ctx.save();
      if (this.state === 'spawn') {
        const k = clamp(this.spawnT / 0.55, 0, 1);
        ctx.globalAlpha = k;
        if (!G.IS3D) sy += (1 - k) * 60 * s;
      }
      const zs = s * (this.spec ? this.spec.scale : 1);
      if (!G.IS3D) {
      // shadow: two layers — soft ground pool + tight dark contact core.
      // A jumping boss leaves his shadow ON THE GROUND between the two lanes,
      // shrinking as he rises — a shadow that flies with the body kills the arc.
      const shadowY = this.isBoss && this.jumpT < 1
        ? B.laneY[this.jumpFrom] + (B.laneY[this.jumpTo] - B.laneY[this.jumpFrom]) * (this.jumpT < 0.5 ? 2 * this.jumpT * this.jumpT : 1 - Math.pow(-2 * this.jumpT + 2, 2) / 2)
        : sy;
      const shrink = this.isBoss && this.jumpT < 1 ? 1 - 0.5 * Math.sin(this.jumpT * Math.PI) : 1;
      ctx.save();
      ctx.globalAlpha = 0.22 * shrink;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, shadowY + 3 * s, 30 * s * shrink, 8 * s * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.38 * shrink;
      ctx.beginPath();
      ctx.ellipse(sx, shadowY + 2.5 * s, 19 * s * shrink, 5 * s * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.translate(sx, sy);
      ctx.scale(zs, zs);
      // squash & stretch through the lane jump — takeoff/air/land via the
      // shared hop curve, plus a fat impact squash the frame he touches down
      if (this.isBoss) {
        const sq = (this.jumpT < 1 ? hopSquash(this.jumpT) : 0) + this.landSquash * 0.9;
        if (sq) ctx.scale(1 + sq * 0.13, 1 - sq * 0.13);
      }
      G.Sprites.drawZombie(ctx, {
        pose: this.pose(),
        walkPhase: this.walkPhase,
        seed: this.seed,
        hitFlash: this.hitFlash,
        shield: this.shield,
        shieldHits: this.shieldHits,
        shieldWobble: this.shieldWobble,
        helmet: this.helmet,
        dents: this.dents,
        helmetHits: this.helmetHits,
        headArmorHits: this.headArmor ? this.headArmor.hits : 1,
        helmetWobble: this.helmetWobble,
        dieT: this.dieT,
        kneelTimer: Math.max(0, this.kneelTimer),
        type: this.type,
        lean: this.lean || 0,
        angry: this.angry,
        poleBroken: this.poleBroken,
        hp: this.hp,
        maxHp: this.maxHp,
        // boss phase state — the 2D boss painter reads these off the same
        // opts object, and without them he draws bald with a BODY marker
        // no matter what is still attached to his head
        magaOn: this.magaOn,
        toupeeOn: this.toupeeOn,
        toupeeHigh: this.toupeeHigh || 0,
        bodyHits: this.bodyHits || 0,
        spec: this.spec,
        // idle life — the boss painter reads the same bits the 3D rig does
        idleKind: this.idleKind,
        idleT: this.idleT,
        gripeK: this.gripeK || 0,
        jumpT: this.jumpT,
      }, time);
      } else {
        // 3D: the body is a real mesh — overlay anchors at the projected feet
        ctx.translate(sx, sy);
        ctx.scale(zs, zs);
      }
      // boss shake: the whole body convulses when a high arc lands on him.
      // (The 3D body is a mesh, so it shakes in poseZombie instead — this
      // channel only has to carry the overlays.)
      if (this.isBoss && this.shakeAmp > 0) {
        const k = Math.min(2.6, this.shakeAmp);
        const tt = time;
        ctx.translate(Math.sin(tt * 57) * 6 * k, Math.sin(tt * 43 + 1.7) * 5 * k);
        ctx.rotate(Math.sin(tt * 51 + 0.6) * 0.055 * k);
      }

      // health bar (only when damaged)
      if (this.hp < this.maxHp && this.state !== 'die' && this.state !== 'glorydie') {
        const bw = 52, bh = 7, by = this.state === 'kneel' ? -112 : -162;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-bw / 2 - 2, by - 2, bw + 4, bh + 4);
        const frac = clamp(this.hp / this.maxHp, 0, 1);
        ctx.fillStyle = frac > 0.5 ? '#6fe86f' : frac > 0.25 ? '#ffd23f' : '#ff5555';
        ctx.fillRect(-bw / 2, by, bw * frac, bh);
        // armour pips above the bar: what is still between us and the brain
        let px = -bw / 2;
        if (this.frontArmor && this.shieldHits > 0) {
          for (let i = 0; i < this.shieldHits; i++) {
            ctx.fillStyle = '#c9a227';
            ctx.fillRect(px, by - 9, 6, 5);
            px += 8;
          }
        }
        if (this.helmet) {
          // one pip per remaining helmet hit — the bucket shows its 5-hit
          // economy right on the zombie, draining like the door pips
          for (let i = 0; i < this.helmetHits; i++) {
            ctx.fillStyle = '#ffd23f';   // amber: same language as the counter
            ctx.fillRect(px + i * 8, by - 9, 6, 5);
          }
        }
      }
      // glory-ready indicator
      if (this.state === 'kneel') {
        const pulse = 0.75 + Math.sin(time * 9) * 0.25;
        ctx.save();
        ctx.globalAlpha = pulse;
        G.Sprites.drawStar(ctx, 0, -178, 11, '#b9ff2e');
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#b9ff2e';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, -162, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.kneelTimer / KNEEL_SECONDS, 0, 1));
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }
  /* ================= Pult ================= */
  class Pult {
    constructor() {
      this.row = 2; // middle of 4 lanes
      this.jumpT = 1; this.jumpFrom = 2; this.jumpTo = 2;
      this.charge = 0; this.charging = false;
      this.dwellT = 0;       // seconds spent parked at MAX (0.5s before reset)
      this.recoil = 0;
      this.armSwing = 0;
      this.swingT = 99;      // s since release; large = idle (see armAngle)
      this.lastQ = -1;
      this.chargeTopGlow = 0; // flash cue when the bar hits MAX (and while it dwells)
      this.blinkT = rand(2, 4);
      this.blink = 0;
      this.hopY = 0;
      this.shadowK = 0;    // damped follower of the hop arc — shadow lag
      this.landSquash = 0; // post-touchdown impact squash (decays ~0.17s)
      this.holding = true;
      this.dead = false;
      this.deathT = 0;
    }
    get jumpK() { return this.jumpT < 1 ? this.jumpT : 1; }
    update(dt, game) {
      this.screenX = pultRailX(this.row); // drawn x — exposed for probes, constant on the rail
      if (this.dead) { this.deathT += dt; return; }
      // lane jump
      if (this.jumpT < 1) {
        this.jumpT += dt / 0.26;
        this.hopY = Math.sin(clamp(this.jumpT, 0, 1) * Math.PI) * 46;
        // shadow follows the arc through an exp damper (k=10/s) → its shrink
        // bottoms out just after the true apex and recovers after touchdown
        this.shadowK = damp(this.shadowK, this.hopY / 46, 10, dt);
        if (this.jumpT >= 1) {
          this.row = this.jumpTo;
          this.hopY = 0;
          this.landSquash = 1; // impact squash on touchdown (+0.9, ~0.15s decay)
          const B = G.Board;
          game.dustBurst(pultRailX(this.row), B.laneY[this.row], B.scale(this.row) * pultLaneScale(this.row), 11, 2.2);
          G.Audio.jumpWhoosh();
        }
      } else {
        this.shadowK = damp(this.shadowK, 0, 10, dt);
        if (game.state === 'play') {
          if (game.input.keyPressed['w'] && this.row > 0) this.startJump(this.row - 1, game);
          if (game.input.keyPressed['s'] && this.row < G.Board.ROWS - 1) this.startJump(this.row + 1, game);
        }
      }
      // blink
      this.blinkT -= dt;
      this.chargeTopGlow = Math.max(0, this.chargeTopGlow - dt / 0.3); // turnaround-cue fade
      if (this.blinkT <= 0) { this.blink = 0.12; this.blinkT = rand(2.2, 4.5); }
      this.blink = Math.max(0, this.blink - dt);
      // recoil / arm
      this.recoil = Math.max(0, this.recoil - dt * 4);
      this.armSwing = Math.max(0, this.armSwing - dt * 7);
      this.swingT += dt;
      this.landSquash = Math.max(0, this.landSquash - dt * 6.7); // ~0.15s decay
      // charge — power RAMPS while held (G.POWER.rampT to full), then DWELLS
      // at max for G.POWER.dwellT (0.5s), then RESETS to zero and climbs
      // again. One-way ramp: no oscillation, the dwell beat is the rhythm.
      if (this.charging) {
        const P = G.POWER;
        if (this.charge < 1) {
          this.charge = Math.min(1, this.charge + dt / P.rampT);
          if (this.charge >= 1) { this.chargeTopGlow = 1; G.Audio.chargeTop(); } // hit MAX
          const q = Math.floor(this.charge * 10);
          if (q !== this.lastQ) { this.lastQ = q; G.Audio.chargeTick(this.charge); }
        } else {
          this.chargeTopGlow = Math.max(this.chargeTopGlow, 0.6); // stay lit through the dwell
          this.dwellT += dt;
          if (this.dwellT >= P.dwellT) { this.dwellT = 0; this.charge = 0; this.lastQ = -1; } // wrap to zero
        }
      }
    }
    startJump(to, game) {
      if (to < 0 || to > G.Board.ROWS - 1 || to === this.row) return;
      this.jumpFrom = this.row;
      this.jumpTo = to;
      this.jumpT = 0;
      this.charging = false; this.charge = 0; this.dwellT = 0;
      this.chargeTopGlow = 0;
      // takeoff: dust poof + loose soil/leaf chunks kicked off the pot
      const B = G.Board;
      const railX = pultRailX(this.row);
      const s = B.scale(this.row) * pultLaneScale(this.row);
      game.dustBurst(railX, B.laneY[this.row], s, 9, 1.6);
      for (let i = 0; i < 4; i++) {
        game.particles.push(new Particle({
          x: railX + rand(-34, 34) * s, y: B.laneY[this.row] - rand(2, 10) * s,
          vx: rand(-140, 140), vy: rand(-230, -110), g: 640, vr: rand(-9, 9),
          life: rand(0.35, 0.55), size: rand(1.8, 3.2) * s, type: 'chunk',
          color: i >= 2 ? pick(['#3f9c46', '#48b04f']) : pick(['#6e4a26', '#7c5026']),
        }));
      }
      G.Audio.jumpWhoosh();
    }
    draw(ctx, time, game) {
      const B = G.Board;
      // Fixed vertical rail: sx never changes, hops are pure vertical travel.
      const sx = PULT_RAIL_X;
      const k = clamp(this.jumpT, 0, 1);
      // Mid-hop, ease the lane line and perspective scale from→to lane.
      // pultLaneScale adds a pult-only near-lane boost on top of the board
      // projection — deepens near lanes without touching the board math.
      const s = lerp(B.rowScale[this.jumpFrom] * pultLaneScale(this.jumpFrom),
                     B.rowScale[this.jumpTo] * pultLaneScale(this.jumpTo), k);
      const groundY = lerp(B.laneY[this.jumpFrom], B.laneY[this.jumpTo], k);
      const sy = groundY - this.hopY;
      // shadow: stays VISIBLE at apex — 48% of parked size, ~0.144 alpha
      // (was 42% / 0.105 = invisible). LAGS the arc via the damped shadowK
      // follower (k=10/s ≈ 0.1s). A faint detached ground-marker ellipse keeps
      // the ground plane readable while the pult separates from the ground.
      const shK = this.shadowK;
      const shSize = 1 - 0.52 * shK;
      ctx.save();
      ctx.globalAlpha = 0.30 * (1 - 0.52 * shK);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, groundY + 3 * s, 34 * s * shSize, 8 * s * shSize, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (shK > 0.02) {
        const markerFade = clamp(shK / 0.35, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.10 * markerFade;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.ellipse(sx, groundY + 3 * s, 40 * s, 9.5 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(s, s);
      if (this.dead) {
        ctx.rotate(Math.min(1.4, this.deathT * 3));
        ctx.globalAlpha = 1;
      }
      const breath = Math.sin(time * 2.2) * 0.03;
      const chargingSquash = this.charging ? -this.charge * 0.5 : 0;
      // landing wobble: one small damped overshoot (~0.10 rad) as the impact
      // squash decays — sin((1−ls)·π) rises once then settles to 0
      const dir = this.jumpTo > this.jumpFrom ? 1 : -1;
      const ls = this.landSquash;
      const landWobble = ls > 0 ? Math.sin((1 - ls) * Math.PI) * 0.10 * Math.pow(ls, 0.6) * dir : 0;
      G.Sprites.drawPult(ctx, {
        // breath/charge/recoil only — the hop has its own, much stronger channel
        squash: breath + chargingSquash - this.recoil * 0.6,
        // hop deformation + post-touchdown impact squash, both on the
        // whole-body hopSquash channel (see drawPult)
        hopSquash: hopSquash(k) + this.landSquash * 0.9,
        armAng: -game.armAngle(this),   // canvas rotate() is inverted
        charge: this.charge,
        recoil: this.recoil,
        hopY: 0,
        blink: this.blink > 0,
        // STRONG THROW only — and PULSING, so the glow reads as a live state,
        // not one more static yellow-green squiggle in the charge zone
        glow: game.strongWindow() ? 0.62 + 0.3 * Math.sin(performance.now() / 70) : 0,
        heavy: game.heavySelected && game.ammo > 0,
        holding: this.holding && !this.dead,
        lean: this.jumpT < 1 ? Math.sin(this.jumpT * Math.PI) * 0.30 * dir : landWobble,
      });
      ctx.restore();
    }
  }

  /* ================= GAME ================= */
  /* ---------- THE DIZZY STATE ----------
     From the beat he drops until the chopper takes him (or the ground
     opens under him) the Don is officially DIZZY: a wobbly halo of stars
     over his head, a slow sway that never repeats, a head that shakes in
     gusts, and one long exaggerated blink every few seconds. Every
     channel here is a PURE function of (donFall, time) so both render
     paths — and any frozen probe frame — agree on the beat. */
  G.DONDIZZY = {
    TAU: Math.PI * 2,
    // 1 while he rambles, fading out as the exit claims him
    amount(d) {
      if (!d) return 0;
      if (d.phase === 'speech' || d.phase === 'collapse' || d.phase === 'thought') return 1;
      if (d.phase !== 'fall') return 0;
      // the chopper's approach, or the slow slide under the lawn — the stars
      // stay with him until the ground is most of the way to having him
      return d.mode === 'swallow'
        ? Math.max(0, 1 - d.t / (SWALLOW_SINK_AT + SWALLOW_SINK_T * 0.75))
        : Math.max(0, 1 - (d.inK || 0));
    },
    // the body sway: three drifting sines so it never repeats, with a slow
    // breathing amplitude — he is swaying slowly, but ERRATICALLY
    sway(t) {
      return (Math.sin(t * 1.13) * 0.55 + Math.sin(t * 2.71 + 1.3) * 0.30
        + Math.sin(t * 5.3 + 2.1) * 0.15) * (0.55 + 0.45 * Math.sin(t * 0.61 + 0.9));
    },
    // the head: fast little shakes that arrive in GUSTS, not on a metronome
    head(t) {
      const gust = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.83) * Math.sin(t * 1.97 + 0.5));
      return (Math.sin(t * 7.9) * 0.6 + Math.sin(t * 11.3 + 1.1) * 0.4) * gust;
    },
    // the blink: one long shut-eye every 2.7 s (1 = fully shut)
    blink(t) {
      const W = 0.46, ph = t % 2.7;
      return ph >= W ? 0 : Math.sin((ph / W) * Math.PI);
    },
    // one star of the halo: a wobbling, drifting elliptical orbit
    star(i, n, t) {
      const th = t * 2.6 + (i / n) * G.DONDIZZY.TAU + Math.sin(t * 0.9) * 0.4;
      const wob = 1 + 0.13 * Math.sin(t * 1.71 + i * 2.1);
      return {
        x: Math.cos(th) * 48 * wob,
        y: Math.sin(th) * 15 * (1 + 0.30 * Math.sin(t * 2.33 + i * 0.7)),
        th,
      };
    },
  };

  class Game {
    constructor(canvas, input) {
      this.canvas = canvas;
      this.input = input;
      this.camera = new G.Camera();
      this.bg = G.IS3D ? null : G.Sprites.bakeBackground();
      this.highScore = parseInt(localStorage.getItem('mm_high') || '0', 10);
      this.reset();
      this.state = 'menu';
      this.menuT = 0;
    }
    reset() {
      this.diffKey = this.diffKey || 'easy';          // difficulty persists across retries
      this.diff = G.DIFFS[this.diffKey];
      this.pult = new Pult();
      this.zombies = [];
      this.projectiles = [];
      this.particles = [];
      this.popups = [];
      this.obstacles = [];
      this.craters = [];
      this.score = 0;
      this.scorePop = 0;
      this.combo = 0;
      this.comboT = 0;
      this.ammo = 1;
      this.stage = 1;
      this.wave = 0;
      this.waveState = 'idle'; // idle | spawning | clearing
      this.spawnQueue = [];
      this.spawnTimer = 0;
      this.toSpawn = 0;
      this.banner = null;
      this.bannerSub = null;
      this.bannerT = 0;
      this.hitstop = 0;
      this.slowmo = 0;
      this.timeScale = 1;
      this.laneJumpFlash = 0;
      this.heavySelected = false;
      this.warning = 0;
      this.paused = false;
      this.loseCause = null;
      this.lastDirectZombie = null;
      this.stageStats = { kills: 0, glory: 0 };
      // boss + finale state
      this.boss = null;
      this.bossWave = false;
      this.shells = [];      // rising firework shells
      this.fx = [];          // firework embers (drawn last, above every overlay)
      this.confetti = [];    // the paper rain after the send-off
      this.celebration = null;
      this.parade = null;      // the finale parade (stage 5 only)
      if (G.IS3D && G.R3.paradeClear) G.R3.paradeClear();  // strike any chase rigs
      this.donFall = null;     // the ceremonious fall
      if (G.IS3D && G.R3.donFallClear) G.R3.donFallClear();
      this.gripe = null;       // the hat/rug complaint
      this.fwTimer = 0;
      this._roastLines = null; // the taunts are dealt fresh every run
      this._endCopy = null;
      this.loseT = 0;
      this.loseLimit = 10;   // the player's window to decide
      this.autoQuit = false;
      this.tips = [
        'W/S hop the pult along the left rail · lanes only, no side-steps.',
        'Hold LMB — power climbs, parks at MAX for half a beat, then restarts at zero.',
        'Mouse X sets the angle, 10° flat to 80° steep — the ground ring is your landing spot.',
        'High arcs crest high, sail over shields AND score x2 — lob high, harvest double.',
        'Head-hits kneel · finish the kneeler for a glory kill · glory forges iron (cap 15).',
      ];
    }

    /* ---------- flow ---------- */
    start(stage = 1) {
      this.reset();
      this.stage = stage;
      this.state = 'play';
      this.startWave(1);
      G.Audio.waveHorn();
    }
    /* Boss stages end on a fifth wave that is nothing but The Don — he shows
       at stage 2 and again at stage 5, the FINAL stage, where he wears the
       red cap. Every other stage keeps its original four.
       ?short=1 collapses the whole campaign into TWO stages: the plain Don
       at stage 1, the FINAL capped Don at stage 2, and the parade + THE END
       after him. bossStage/finalStage are the ONLY stage checks — never
       compare this.stage against a literal elsewhere. */
    bossStage(s) { return G.SHORT ? s <= 2 : (s === 2 || s === 5); }
    finalStage() { return G.SHORT ? this.stage >= 2 : this.stage >= 5; }
    wavesForStage(s) {
      // short: a third of the campaign — 3 waves per stage, boss on the 3rd
      if (G.SHORT) return 3;
      return this.bossStage(s) ? 5 : 4;
    }
    startWave(n) {
      this.wave = n;
      const S = this.stage;
      const D = this.diff;
      if (this.bossStage(S) && n === this.wavesForStage(S)) {
        // ---- BOSS WAVE: no crowd, no queue, just him ----
        this.bossWave = true;
        this.toSpawn = 0;
        this.waveState = 'clearing';
        this.showBanner(this.finalStage() ? 'THE FINAL WAVE — THE DON' : `WAVE ${this.wavesForStage(S)} — THE DON`,
          (STORY[S] && STORY[S][4]) || null);   // boss wave = last story line
        G.Audio.bossHorn();
        this.spawnBoss();
        return;
      }
      this.bossWave = false;
      // short: a THIRD of the horde, and the horde arrives quicker too
      let count = Math.max(1, Math.round((3 + S + n * 2) * D.count));
      if (G.SHORT) count = Math.max(1, Math.round(count / 3));
      this.toSpawn = count;
      this.spawnTimer = 0.8;
      this.waveState = 'spawning';
      this.showBanner(`STAGE ${S} — WAVE ${n} · ${D.label}`,
        (STORY[S] && STORY[S][n - 1]) || null);   // waves are 1-based, the table is 0-based
      G.Audio.waveHorn();
      if (n === 1 && S >= 2) this.placeObstacles();
      // a Flag Zombie leads the wave in — the visual cue that a push is coming
      if (n >= 2) this.spawnZombie('flag');
    }
    /* The Don enters on his own wave. He spawns only in the lanes the frame
       can hold him in (roster bootRows), announces himself with a horn and a
       ground-slam, and walks in slowly enough that the player gets a real
       fight instead of a coin flip. */
    spawnBoss() {
      // the FIRST Don is plain; the FINAL one brings the cap
      const type = this.finalStage() ? 'boss10' : 'boss5';
      const t = G.ZT.get(type);
      const rows = t.bootRows || [2, 3];
      const row = rows[randi(0, rows.length - 1)];
      const z = new Zombie(row, type, this.stage, this.diff.speed);
      z.holdDur = 2.6;
      this.zombies.push(z);
      this.boss = z;
      const B = G.Board;
      this.camera.kick(18);
      this.camera.hitFlash(0.24, '#ffd23f');
      this.dustBurst(B.colX(row, z.u), B.laneY[row], B.scale(row), 20, 1.8);
      this.addPopupScreen(640, 300, 'THE DON ARRIVES', '#ff9e3d', 42);
    }
    placeObstacles() {
      this.obstacles = [];
      const n = 1 + Math.floor(this.stage / 2);
      for (let i = 0; i < n; i++) {
        this.obstacles.push({
          row: randi(0, G.Board.ROWS - 1),
          u: rand(2.5, 8),
          hp: 2,
          shake: 0,
        });
      }
    }
    showBanner(txt, sub) { this.banner = txt; this.bannerSub = sub || null; this.bannerT = 0; }

    /* ---------- difficulty ---------- */
    diffButtons() {
      // shared by drawMenu (render) and menuClick (hit test) — one source
      return ['veryeasy', 'easy', 'hard'].map((k, i) => ({ key: k, x: 310 + i * 230, y: 292, w: 200, h: 60 }));
    }
    setDifficulty(key) {
      if (!G.DIFFS[key]) return;
      this.diffKey = key;
      this.diff = G.DIFFS[key];
      G.Audio.uiClick();
    }
    // returns true when the click was consumed by the picker
    menuClick(mx, my) {
      if (this.state !== 'menu') return false;
      for (const b of this.diffButtons()) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          this.setDifficulty(b.key);
          return true;
        }
      }
      return false;
    }

    /* ---------- spawning ---------- */
    updateSpawns(dt) {
      if (this.waveState === 'spawning') {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.toSpawn > 0) {
          this.toSpawn--;
          this.spawnTimer = Math.max(0.7 * this.diff.interval, (2.4 - this.stage * 0.15 - this.wave * 0.1) * this.diff.interval)
            * (G.SHORT ? 0.6 : 1);   // short mode: the horde arrives quicker too
          this.spawnZombie();
        }
        if (this.toSpawn <= 0) this.waveState = 'clearing';
      } else if (this.waveState === 'clearing') {
        if (this.zombies.every(z => z.dead || z.state === 'die' || z.state === 'glorydie')) {
          if (this.wave >= this.wavesForStage(this.stage)) { this.stageClear(); }
          else { this.score += 250; this.addPopupScreen(640, 300, `WAVE CLEAR +250`, '#b9ff2e', 30); this.startWave(this.wave + 1); }
        }
      }
    }
    spawnZombie(forceType) {
      // roster weights by stage (zombie_types.js owns the table)
      const table = G.ZT.spawnTable(this.stage);
      let type = 'shambler';
      if (forceType) {
        type = forceType;
      } else {
        const total = table.reduce((a, b) => a + b[1], 0);
        let r = Math.random() * total;
        for (const [t, weight] of table) { r -= weight; if (r <= 0) { type = t; break; } }
      }
      let row = randi(0, G.Board.ROWS - 1);
      // slight bias toward pult's row for pressure
      if (Math.random() < 0.3) row = this.pult.row;
      this.zombies.push(new Zombie(row, type, this.stage, this.diff.speed));
    }
    stageClear() {
      this.state = 'stageClear';
      const bonus = 500 + this.stage * 250;
      this.score += bonus;
      this.stageBonus = bonus;
      G.Audio.winJingle();
      this.startCelebration(this.stage);
      if (this.score > this.highScore) { this.highScore = this.score; localStorage.setItem('mm_high', String(this.highScore)); }
    }

    /* ---------- celebration ----------
       Stage 2: daylight fireworks and a shove toward the final stage.
       Stage 5 — the last boss: first the PARADE (the horde is herded out
       left→right with the pult chasing, then the horde chases the pult
       right→left), and only when the screen is empty does the night fall,
       the fireworks double, and THE END is spelled over it all. ENTER skips
       the parade. */
    startCelebration(stage) {
      const big = this.finalStage();   // the finale = the last boss falls
      const fall = !!this.donFall;     // he goes out ceremonious first
      this.celebration = {
        stage, t: 0, night: big, finale: big, scroll: 0,
        phase: fall ? 'fall' : big ? 'parade' : 'end',
        roastT: 0,
        stars: big ? Array.from({ length: 150 }, () => ({
          x: rand(0, 1280), y: rand(0, 540), r: rand(0.5, 1.8), ph: rand(0, 6.3),
        })) : null,
      };
      this.fwTimer = 0.15;
      if (big && !fall) this.startParade();   // parade only after the words
      this.boss = null;
      G.Audio.fanfare(big);
    }
    /* ---------- the ceremonious fall ----------
       He does not just vanish: still on his feet, groggy, he RAMBLES — three
       random bubbles from a pool, each popping up somewhere new around him.
       After that the two exits part ways: the FIRST Don COLLAPSES to the
       turf, shrinks to half size right there on the floor, and thinks his
       last incoherent thought flat on his back — only then does the LAST
       FLIGHT come for him (see updateDonFlight). The FINAL Don goes under
       instead (see updateDonSwallow), and his thought drifts up out of the
       hole once it already has him. */
    startDonFall(z) {
      // his OWN bank: the rug boss and the cap boss never share material —
      // three bubbles shuffled out of it fresh every single defeat
      const pool = [...(this.finalStage() ? DON_RAMBLE_2 : DON_RAMBLE_1)];
      const msgs = [];
      for (let i = 0; i < 3 && pool.length; i++) msgs.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
      const spots = [...DONFALL_SPOTS];
      for (let i = spots.length - 1; i > 0; i--) {
        const j = randi(0, i); [spots[i], spots[j]] = [spots[j], spots[i]];
      }
      this.donFall = {
        type: z.type, seed: z.seed, row: z.row, u: z.u,
        // THE FINAL BOSS GOES UNDER. Everyone else gets the chopper; the last
        // one is taken by the ground itself, and there is no flight at all.
        mode: this.finalStage() ? 'swallow' : 'heli',
        phase: 'speech', t: 0, mi: 0, msgT: DONFALL_MSG_T, msgs, spots,
        // the first Don's collapse: how far he has folded, and the half-size
        // shrink he lands at (the chopper lifts THIS man, already small)
        colK: 0, pickK: 0, thudded: false,
        thought: DON_THOUGHTS[randi(0, DON_THOUGHTS.length - 1)],
        heliLine: HELI_LINES[randi(0, HELI_LINES.length - 1)],
        // the wreck lands BESIDE him — on whichever side the frame can hold,
        // read by every renderer so the fire, the crater and the hull agree
        heliCol: z.u > 6.4 ? -1.7 : 1.7,
        // the flight channels — pure functions of exit-t, read by BOTH render
        // paths and by every probe, so a frozen frame is reproducible
        inK: 0, hookK: 0, liftK: 0, carryK: 0, backK: 0, dropK: 0,
        followK: 0, smokeK: 0, bob: 0,
        // the swallow's channels: the hole, his sink, and the things thrown
        sinkK: 0, ringK: 0, spew: false, spewT: SWALLOW_SPEW_T,
        // ...and the hole's TEMPER: it starts FURIOUS, then alternates
        // rage and simmer on a clock it rolls itself every run
        furious: true, furyK: 1, furyT: rand(1.2, 2.4), burpT: 0,
        flames: [], rocks: [],
      };
      if (G.IS3D && G.R3.donFallInit) G.R3.donFallInit(this.donFall);
    }
    updateDonFall(dt) {
      const D = this.donFall;
      if (!D) return;
      D.t += dt;
      if (D.phase === 'speech') {
        D.msgT -= dt;
        if (D.msgT <= 0) {
          D.mi++;
          if (D.mi >= D.msgs.length) {
            D.t = 0;
            if (D.mode === 'swallow') {
              // no thought in the dialog: the ground clears its throat right
              // away — his last word comes later, FROM the hole
              D.phase = 'fall';
              G.Audio.crashBoom(); G.Audio.deathGroan();
            } else {
              // the words are spent: the knees go, and he folds
              D.phase = 'collapse';
              G.Audio.deathGroan();
            }
          }
          else D.msgT = DONFALL_MSG_T;
        }
      } else if (D.phase === 'collapse') {
        // THE FOLD: dieT is the same channel the corpse flop uses, so he
        // goes over exactly like a dead boss — hesitation, then the whoosh
        D.colK = clamp(D.t / COLLAPSE_T, 0, 1);
        const pk = clamp(D.t / (COLLAPSE_T * 0.8), 0, 1);
        D.pickK = pk * pk * (3 - 2 * pk);        // smoothstep down to PICK_S
        this.camera.kick((0.25 + D.colK * 1.5) * dt * 30);
        if (D.colK >= 0.93 && !D.thudded) {
          D.thudded = true;                      // the lawn takes his weight
          const B = G.Board;
          this.dustBurst(B.colX(D.row, D.u), B.laneY[D.row], B.scale(D.row), 18, 1.6);
          this.camera.kick(7);
          G.Audio.bossThud(true);
        }
        if (D.t >= COLLAPSE_T + COLLAPSE_SETTLE_T) { D.phase = 'thought'; D.t = 0; }
      } else if (D.phase === 'thought') {
        if (D.t >= DONFALL_THOUGHT_T) {
          D.phase = 'fall'; D.t = 0;
          // the cloud clears — only NOW do the rotors come down on him
          G.Audio.heliIn();
        }
      } else if (D.phase === 'fall') {
        if (D.mode === 'swallow') this.updateDonSwallow(D, dt);
        else this.updateDonFlight(D, dt);
      }
      if (G.IS3D && G.R3.donFallSync && G.R3.donFall3d) G.R3.donFallSync(D, performance.now() / 1000, dt);
    }
    /* THE SWALLOW. No chopper: the lawn opens under him, takes him down, and
       then throws fire, rock and lava back up for ten full seconds before it
       sews itself shut. Every particle is thrown in SPRITE px around the
       hole, so the shared overlay can draw the same show in BOTH paths. */
    updateDonSwallow(D, dt) {
      const B = G.Board;
      const x = B.colX(D.row, D.u), gy = B.laneY[D.row], s = B.scale(D.row);
      const t = D.t;
      D.ringK = t < SWALLOW_OPEN_T ? t / SWALLOW_OPEN_T
        : t < SWALLOW_FIRE_T ? 1
        : clamp(1 - (t - SWALLOW_FIRE_T) / SWALLOW_CLOSE_T, 0, 1);
      D.sinkK = clamp((t - SWALLOW_SINK_AT) / SWALLOW_SINK_T, 0, 1);
      D.spew = t < SWALLOW_FIRE_T;
      if (t < SWALLOW_OPEN_T && !D.cracked) {
        D.cracked = true;
        this.dustBurst(x, gy, s, 18, 1.6);
        this.debris(x, gy - 10, '#6b5a42', 12);
        this.camera.kick(9);
        G.Audio.bossThud(true);
      }
      // THE TEMPER: the hole does not blow on a metronome. It works itself
      // into a FURIOUS tantrum — tall columns, heavy rock, hard burps —
      // then simmers down to a low grumble, then rages again, rolling the
      // length of each mood fresh every time
      D.furyT -= dt;
      if (D.furyT <= 0) {
        D.furious = !D.furious;
        D.furyT = D.furious ? rand(1.1, 2.4) : rand(0.8, 1.9);
      }
      D.furyK += ((D.furious ? 1 : 0) - D.furyK) * Math.min(1, dt * 2.4);
      // a hard BURP on its own clock — twice a second or better in a rage,
      // barely once a second while it simmers
      D.burpT -= dt;
      const burp = D.burpT <= 0;
      if (D.spew && burp) {
        D.burpT = rand(0.3, 0.65) / (0.45 + 1.05 * D.furyK);
        G.Audio.jumpWhoosh();
        this.camera.kick(1.2 + 2.4 * D.furyK);
      }
      if (D.spew) {
        const n = Math.round((burp ? 6 : 1.2) + (burp ? 13 : 4) * D.furyK);
        const mouth = 66 * s;                     // the flames come out of the WIDTH of it
        for (let i = 0; i < n; i++) {
          D.flames.push({
            bouncy: false,
            x: x + rand(-mouth * 0.8, mouth * 0.8) * (0.65 + 0.35 * D.furyK),
            y: gy + rand(-4, 8) * s,
            vx: rand(-40, 40) * s * (1 + 0.7 * D.furyK),
            // every tongue its own height, and the temper sets the ceiling:
            // a furious hole throws a column twice as tall as a simmer
            vy: -rand(100, 240 + 400 * D.furyK) * s * (burp ? 1.15 : 0.85),
            r: rand(5, 14) * s * (0.8 + 0.45 * D.furyK) * (burp ? 1.3 : 1),
            t: 0, life: rand(0.6, 1.2) * (0.85 + 0.3 * D.furyK), g: rand(120, 260) * s,
          });
        }
      }
      // and on the temper's clock something SOLID comes out with the fire
      D.spewT -= dt;
      if (D.spew && D.spewT <= 0) {
        D.spewT = D.furyK > 0.5 ? rand(0.16, 0.45) : rand(0.6, 1.35);
        const lava = Math.random() < 0.5;
        const many = lava ? 1 : 1 + Math.floor(Math.random() * (1 + 2.4 * D.furyK));
        for (let i = 0; i < many; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          D.rocks.push({
            kind: lava ? 'lava' : 'rock', bouncy: true, bounced: 0,
            x: x + rand(-12, 12) * s, y: gy - rand(2, 24) * s,
            vx: dir * rand(60, 250) * s * (0.8 + 0.55 * D.furyK),
            vy: -rand(280, 600) * s * (0.75 + 0.5 * D.furyK),
            r: rand(4.5, 9.5) * s * (0.85 + 0.35 * D.furyK), t: 0,
            life: lava ? rand(1.7, 2.7) : rand(2.0, 3.2),
            g: 900 * s, spin: rand(-4, 4),
          });
        }
        if (Math.random() < 0.25 + 0.45 * D.furyK) this.camera.kick(1.5);
      }
      // integrate: the lawn catches whatever comes back down
      const step = p => {
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.bouncy && p.y > gy) {
          p.y = gy;
          if (p.bounced < 2 && Math.abs(p.vy) > 50) { p.bounced++; p.vy *= -0.34; p.vx *= 0.62; }
          else { p.vy = 0; p.vx *= Math.pow(0.03, dt); }
        }
        p.t += dt;
        return p.t < p.life;
      };
      D.flames = D.flames.filter(step);
      D.rocks = D.rocks.filter(step);
      if (t >= SWALLOW_TOTAL) { this.finishDonFall(); return; }
    }
    /* THE LAST FLIGHT, beat by beat. Each channel below is a pure function of
       the exit clock, so the sequence can be frozen anywhere and both render
       paths (and probes) read the same story. game.js owns the clock and the
       consequences — dust, craters, shake, sound; render3d owns the meshes. */
    updateDonFlight(D, dt) {
      const B = G.Board;
      const x = B.colX(D.row, D.u), gy = B.laneY[D.row], s = B.scale(D.row);
      // everything after the drop happens UP THE LAWN (see FAR_LIFT): the dust,
      // the debris and the scorch have to land where the crash is, not at his
      // feet, or the whole staging falls apart in one frame
      const farY = gy - FAR_LIFT, farS = s * FAR_DS;
      // in 3D the crash is BEHIND the fence, so its ground line is wherever the
      // projection puts that depth — ask it instead of guessing
      let crashY = farY;
      if (G.IS3D && G.R3.groundAt && G.R3.donFallPath) {
        const P2 = G.R3.donFallPath(D);
        crashY = G.R3.groundAt(D.u, D.row, P2.don.z).y;
      }
      const t = D.t;
      const T1 = HELI_IN_T, T2 = T1 + HELI_HOOK_T, T3 = T2 + HELI_LIFT_T;
      const T4 = T3 + HELI_AWAY_T, T5 = T4 + HELI_BACK_T, T6 = T5 + HELI_DROP_T;
      const T7 = T6 + HELI_FOLLOW_T;
      D.inK = clamp(t / T1, 0, 1);
      D.hookK = clamp((t - T1) / HELI_HOOK_T, 0, 1);
      D.liftK = clamp((t - T2) / HELI_LIFT_T, 0, 1);
      D.carryK = clamp((t - T3) / HELI_AWAY_T, 0, 1);
      D.backK = clamp((t - T4) / HELI_BACK_T, 0, 1);
      D.dropK = clamp((t - T5) / HELI_DROP_T, 0, 1);
      D.followK = clamp((t - T6) / HELI_FOLLOW_T, 0, 1);
      D.smokeK = clamp((t - T7) / HELI_SMOKE_T, 0, 1);
      // how far through the flop he is, for the 0.35s after he hits
      D.landK = clamp((t - T6) / 0.35, 0, 1);
      D.bob = Math.sin(t * 5.1) * (D.carryK > 0 && D.carryK < 1 ? 0.9 : 1);

      // ---- rotor wash: the grass under him gets sandblasted while the
      //      chopper is over it with the hook out
      if (D.inK > 0.55 && D.hookK < 1 && D.carryK < 0.5) {
        D.washT = (D.washT || 0) + dt;
        if (D.washT > 0.07) { D.washT = 0; this.dustBurst(x, gy, s, 3, 2.8); }
      }
      // ---- the harness snaps on: a pop, a kick, a puff of dust
      if (D.hookK >= 1 && !D.snapped) {
        D.snapped = true;
        G.Audio.harnessPop();
        this.camera.kick(6);
        this.dustBurst(x, gy, s, 12, 1.8);
      }
      // ---- hauled off the grass: the lawn shakes as it takes his weight
      if (D.liftK > 0.04 && !D.lifted) { D.lifted = true; G.Audio.jumpWhoosh(); }
      if (D.liftK > 0 && D.liftK < 1) this.camera.kick(0.45 * dt * 30);
      // ---- let go: the buckle pops and the ground starts coming up
      if (D.dropK > 0 && !D.dropped) { D.dropped = true; G.Audio.fallWhistle(); }
      if (D.dropK > 0 && D.dropK < 1) this.camera.kick((0.2 + D.dropK * 0.9) * dt * 30);
      if (D.dropK >= 1 && !D.donDown) {
        D.donDown = true;
        this.dustBurst(x + 16 * farS, crashY, farS, 30, 2.8);
        this.debris(x + 16 * farS, crashY - 18 * farS, '#8a6a3c', 14);
        this.craters.push({ x: x + 16 * farS, y: crashY, row: D.row, u: D.u, t: 0, heavy: true, far: true, fsc: farS });
        this.camera.kick(18);
        this.camera.hitFlash(0.16, '#ffe9b0');
        G.Audio.bossThud(false);
        G.Audio.deathGroan();
      }
      // ---- and the chopper follows him in
      if (D.followK >= 1 && !D.heliDown) {
        D.heliDown = true;
        const hx = B.colX(D.row, D.u + D.heliCol);
        this.dustBurst(hx, crashY, farS, 34, 3.4);
        this.debris(hx, crashY - 24 * farS, '#3d434d', 24);
        this.debris(hx, crashY - 30 * farS, '#ffb43a', 18);
        this.craters.push({ x: hx, y: crashY, row: D.row, u: D.u + D.heliCol, t: 0, heavy: true, far: true, fsc: farS });
        this.camera.kick(22);
        this.camera.hitFlash(0.34, '#ffd9a0');
        G.Audio.crashBoom();
      }
      // ---- the lawn smokes: burning debris pops and shifts under the hull
      if (D.heliDown && D.smokeK < 1) {
        D.popT = (D.popT || 0) + dt;
        if (D.popT > 0.17) {
          D.popT = 0;
          const hx = B.colX(D.row, D.u + D.heliCol);
          this.debris(hx, crashY - 26 * farS, pick(['#ffb43a', '#ff5a1e', '#ffe9a0']), 3);
          this.dustBurst(hx + rand(-16, 16) * farS, crashY - 4 * farS, farS, 2, 2.4);
        }
      }
      if (D.t >= T7 + HELI_SMOKE_T) { this.finishDonFall(); return; }
    }
    /* How long the whole exit runs, so anything that waits on it (probes, the
       clear screen) can ask instead of guessing. */
    donFallTotal() {
      if (this.donFall && this.donFall.mode === 'swallow') return SWALLOW_TOTAL;
      return HELI_IN_T + HELI_HOOK_T + HELI_LIFT_T + HELI_AWAY_T
        + HELI_BACK_T + HELI_DROP_T + HELI_FOLLOW_T + HELI_SMOKE_T;
    }
    finishDonFall() {
      if (!this.donFall) return;
      if (G.IS3D && G.R3.donFallClear) G.R3.donFallClear();
      this.donFall = null;
      if (this.celebration) {
        if (this.celebration.finale) {
          // the ground just sewed itself shut over him: the good-riddance
          // card hangs for TEN SECONDS, and only then the horde marches
          this.celebration.phase = 'seeya';
          this.celebration.seeyaT = 0;
          this.celebration.seeya = {
            term: DON_COOKED[randi(0, DON_COOKED.length - 1)],
            sub: SEEYA_SUBS[randi(0, SEEYA_SUBS.length - 1)],
            kicker: SEEYA_KICKERS[randi(0, SEEYA_KICKERS.length - 1)],
            bye: SEEYA_BYES[randi(0, SEEYA_BYES.length - 1)],
          };
        } else this.celebration.phase = 'end';
      }
    }
    /* The finale parade. Leg 1: the surviving horde marches out of the
       garden left→right and the melon-pult CHASES them off the lawn. Leg 2:
       they return the favour — the pult flees right→left with the horde
       after it. When everyone is gone, the fireworks spectacular begins. */
    startParade() {
      const cast = ['flag', 'shambler', 'conehead', 'bucket', 'runner', 'newspaper', 'brute', 'digger'];
      this.parade = {
        leg: 1, px: -80, done: false,
        speed: 160,             // a victory lap, not a sprint
        gap: 118, pauseT: 0,
        cast: cast.map((type, i) => ({
          type, seed: 10 + i * 13, phase: rand(0, 6),
          helmet: type === 'bucket' || type === 'conehead',
        })),
      };
      // 3D: the chase plays on the lawn — build the rigs, stand down the
      // BOARD pult so the only pult on screen is the one in the chase
      if (G.IS3D && G.R3.ready && G.R3.paradeInit) G.R3.paradeInit(this.parade.cast);
    }
    updateParade(rawDt) {
      const P = this.parade;
      if (!P || P.done) return;
      for (const c of P.cast) c.phase += rawDt * 7.5;   // amble, don't sprint
      const tail = P.cast.length * P.gap;
      if (P.leg === 1) {
        P.px += P.speed * rawDt;
        if (P.px - tail > 1280 + 90) { P.leg = 1.5; P.pauseT = 3; }   // the beat
      } else if (P.leg === 1.5) {
        // a full 3-second breath between the chase out and the payback
        P.pauseT -= rawDt;
        if (P.pauseT <= 0) { P.leg = 2; P.px = 1280 + 140; G.Audio.waveHorn(); }
      } else if (P.leg === 2) {
        P.px -= P.speed * rawDt;
        if (P.px + tail + P.gap < -110) this.finishParade();
      }
      // 3D: push the parade into the lawn every frame
      if (G.IS3D && G.R3.parade3d) {
        const u = px => 5 + (px - 640) / 100;      // screen px → board u (front lanes)
        const rows = [2, 1, 2, 3, 2, 1, 3, 2];
        const dir = P.leg === 1 ? 1 : -1;
        G.R3.paradeSync(
          P.cast.map((c, i) => ({
            type: c.type, seed: c.seed, phase: c.phase, helmet: c.helmet, dir,
            u: P.leg === 1 ? u(P.px - i * P.gap) : u(P.px + (i + 1) * P.gap),
            row: rows[i % rows.length],
          })),
          { u: u(P.leg === 1 ? P.px - P.cast.length * P.gap : P.px), row: 2, dir },
          performance.now() / 1000,
        );
      }
    }
    finishParade() {
      const P = this.parade;
      if (!P || P.done) return;
      P.done = true;
      if (G.IS3D && G.R3.paradeClear) G.R3.paradeClear();   // rigs strike; the board pult returns
      // the ROAST rides the night sky next; fireworks own it from here on
      this.celebration.phase = 'roast';
      this.celebration.roastT = 0;
      this.fwTimer = 0.2;
      // THE CROWD: a loud, ragged cheer — a swelling shush, a chant with
      // "hey!" stabs, hand claps scattered off the beat, whistles — starting
      // NOW, lifting again under the confetti, and hanging on past its end
      G.Audio.crowdCheer('pro');
      G.Audio.fanfare(true);
    }
    launchShell(night, big) {
      const palette = night
        ? ['#ffd23f', '#ff5ea8', '#6ef0ff', '#b9ff2e', '#ffffff', '#ff9c40', '#c58bff']
        : ['#ffd23f', '#ff6b6b', '#8ee05c', '#ffe9a0', '#ffffff'];
      // the night show breaks ACROSS THE WHOLE SKY — down to mid-screen, not
      // bunched at the top — so the bursts own the frame, not just its crown
      this.shells.push(new Shell(rand(110, 1170), rand(night ? 80 : 130, night ? 430 : 260),
        pick(palette), night, big, big ? pick(palette) : null));
    }
    /* one huge two-colour crown — high-ish, but it can land anywhere across
       the middle band of the sky now, not just pinned over the centre */
    megaShell() {
      const palette = ['#ffd23f', '#ff5ea8', '#6ef0ff', '#b9ff2e', '#ffffff'];
      this.shells.push(new Shell(rand(380, 900), rand(80, 260), pick(palette), true, true, pick(palette)));
    }
    /* the GRAND FINALE's director: a shell with every knob set — launch x,
       break height, colour, sideways angle, burst look */
    shellAt(o) {
      this.shells.push(new Shell(o.x, o.y, o.color, true, !!o.big, o.col2 || null, o.vx || 0, o.style));
    }
    /* a crossette comet's split: one small, fast pop */
    cometPop(x, y, color) {
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2 + rand(-0.1, 0.1);
        const v = rand(70, 190);
        this.fx.push(new Ember(x, y, Math.cos(a) * v, Math.sin(a) * v, color, rand(0.35, 0.7), rand(2, 3.4), 110));
      }
      for (let i = 0; i < 8; i++) {
        this.fx.push(new Ember(x, y, rand(-40, 40), rand(-40, 40), '#fff8d0', rand(0.14, 0.28), rand(5, 9), 0));
      }
      this.camera.kick(2);
    }
    burst(sh) {
      const style = sh.style || 'peony';
      const big = !!sh.big;
      const sp = big ? 450 : sh.night ? 360 : 250;
      const k = big ? 1.4 : 1;
      if (style === 'peony') {
        // the classic: a sphere of tracers, two-tone when it is a big one.
        // The saturation pass wants CHAOS: wider speed spread, looser angles,
        // more of them, so no two bursts ever read the same.
        const n = Math.floor((big ? 170 : sh.night ? 88 : 42) * k);
        const lifeK = big ? 1.6 : 1;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rand(-0.13, 0.13);
          const v = rand(sp * 0.20, sp);
          this.fx.push(new Ember(sh.x + Math.cos(a) * 3, sh.y + Math.sin(a) * 3,
            Math.cos(a) * v, Math.sin(a) * v, sh.color, rand(0.55, 1.35) * lifeK, rand(2.2, 4.2), sh.night ? 90 : 130));
        }
        if (sh.col2) {
          const n2 = Math.floor(n * 0.5);
          for (let i = 0; i < n2; i++) {
            const a = (i / n2) * Math.PI * 2 + 0.12;
            const v = rand(sp * 0.2, sp * 0.62);
            this.fx.push(new Ember(sh.x, sh.y, Math.cos(a) * v, Math.sin(a) * v,
              sh.col2, rand(0.8, 1.9), rand(2.2, 4.2), sh.night ? 70 : 110));
          }
        }
      } else if (style === 'ring') {
        // the ORGANIZED look: one perfect circle, every ember the same speed
        const n = Math.floor(64 * k);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const v = sp * 0.72;
          this.fx.push(new Ember(sh.x, sh.y, Math.cos(a) * v, Math.sin(a) * v,
            sh.color, rand(0.7, 1.05), rand(2.2, 3.2), sh.night ? 90 : 120));
        }
      } else if (style === 'willow') {
        // long gold branches that hang and DRIP down instead of flying out
        const n = Math.floor(92 * k);
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2);
          const v = rand(sp * 0.22, sp * 0.72);
          this.fx.push(new Ember(sh.x, sh.y, Math.cos(a) * v, Math.sin(a) * v * 0.55 - 30,
            i % 3 ? '#ffd98a' : '#ffe9a0', rand(1.4, 2.5), rand(1.6, 2.9), 34));
        }
      } else if (style === 'palm') {
        // a dozen thick fronds that rise, spread and sag under their own weight
        const fronds = Math.floor(11 * k);
        for (let i = 0; i < fronds; i++) {
          const a = (i / fronds) * Math.PI * 2 + rand(-0.12, 0.12);
          const v = rand(sp * 0.5, sp * 0.95);
          this.fx.push(new Ember(sh.x, sh.y, Math.cos(a) * v, Math.sin(a) * v,
            sh.color, rand(1.1, 1.7), rand(4.5, 7), 160));
        }
      } else if (style === 'crossette') {
        // eight fat comets that SPLIT a beat later — the splits are queued
        const n = Math.floor(8 * k);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
          const v = rand(sp * 0.38, sp * 0.62);
          this.fx.push(new Ember(sh.x, sh.y, Math.cos(a) * v, Math.sin(a) * v,
            sh.color, rand(0.5, 0.85), rand(3.5, 5.5), 80));
        }
        if (this.fwQueue && this.celebration) {
          const q0 = this.celebration.fwT || 0;
          for (let i = 0; i < (big ? 6 : 4); i++) {
            const a = rand(0, Math.PI * 2), d = big ? 95 : 70;
            const px2 = sh.x + Math.cos(a) * d, py2 = sh.y + Math.sin(a) * d - 26;
            this.fwQueue.push({ t: q0 + 0.36, fn: () => this.cometPop(px2, py2, sh.col2 || sh.color) });
          }
        }
      }
      // core flash — a BRIGHT bloom so the break reads even on a still
      for (let i = 0; i < (big ? 40 : sh.night ? 24 : 9); i++) {
        this.fx.push(new Ember(sh.x, sh.y, rand(-50, 50) * (big ? 1.9 : 1), rand(-50, 50) * (big ? 1.9 : 1),
          '#fff8d0', rand(0.16, 0.34), big ? rand(10, 20) : rand(7, 15), 0));
      }
      // plus one fat colour bloom of its own — the break itself should GLOW
      if (sh.night || big) {
        for (let i = 0; i < 10; i++) {
          this.fx.push(new Ember(sh.x + rand(-14, 14), sh.y + rand(-14, 14),
            rand(-30, 30), rand(-30, 30), sh.col2 || sh.color, rand(0.22, 0.4), rand(9, 17), 0));
        }
      }
      const cel2 = this.celebration;
      const cap = cel2 && cel2.phase === 'fwfinal' ? 4600 : cel2 && cel2.phase === 'fwshow' ? 3000 : 1400;
      if (this.fx.length > cap) this.fx.splice(0, this.fx.length - cap);
      // during the saturated send-off the bursts outrun the ear — throttle
      // the booms so the mix stays a boom, not a buzz
      const now = performance.now();
      if (!this._fwSfxT || now - this._fwSfxT > 90) { this._fwSfxT = now; G.Audio.fireworkBurst(sh.night); }
      this.camera.kick(big ? 7 : sh.night ? 5 : 2.5);
    }

    /* ---------- lose ---------- */
    brainEaten(z) {
      if (this.state !== 'play') return;
      this.loseCause = 'brain';
      this.lose(z);
    }
    pultDestroyed(z) {
      if (this.state !== 'play') return;
      this.loseCause = 'pult';
      this.pult.dead = true;
      this.camera.kick(20);
      this.shakeBits(this.pult.screenX, G.Board.laneY[this.pult.row], '#b0713a', 14);
      this.lose(z);
    }
    lose(z) {
      this.state = 'gameover';
      this.slowmo = 1.2;
      this.loseT = 0;
      this.autoQuit = false;
      G.Audio.loseSting();
      if (this.score > this.highScore) { this.highScore = this.score; localStorage.setItem('mm_high', String(this.highScore)); }
    }
    /* Two ways out of a loss: replay THIS stage, or quit to the menu. The
       player gets ten seconds to choose; the bar under the buttons shows the
       clock draining, and an expired timer quits (never silently restarts). */
    gameoverButtons() {
      return [
        { key: 'restart', label: 'RESTART LEVEL', x: 352, y: 452, w: 268, h: 68, color: '#8ee05c' },
        { key: 'quit',    label: 'QUIT',          x: 660, y: 452, w: 268, h: 68, color: '#c9cfd6' },
      ];
    }
    gameoverClick(mx, my) {
      if (this.state !== 'gameover') return false;
      for (const b of this.gameoverButtons()) {
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          this.gameoverPick(b.key);
          return true;
        }
      }
      return false;
    }
    gameoverPick(key) {
      if (key === 'restart') { G.Audio.uiClick(); this.start(this.stage); }
      else { this.quitToMenu(); }
    }
    quitToMenu() {
      G.Audio.uiClick();
      this.reset();
      this.state = 'menu';
      this.menuT = 0;
    }

    /* Catapult arm angle, world convention (see G.PULT_ARM).
       Idle/charging winds the arm back and DOWN with the charge; the release
       whips it forward and UP through a short power stroke; then it eases
       back to the ready pose. */
    armAngle(p) {
      const A = G.PULT_ARM;
      const wind = A.rest - A.cock;               // total wind-up travel
      const t = p.swingT;
      if (t < A.stroke) {                          // power stroke: back-low → forward-high
        const k = 1 - Math.pow(1 - clamp(t / A.stroke, 0, 1), 3);   // ease-out = a whip
        return A.cock + (A.launch - A.cock) * k;
      }
      if (t < A.stroke + A.settle) {               // settle back to ready
        const k = clamp((t - A.stroke) / A.settle, 0, 1);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        return A.launch + (A.rest - A.launch) * e;
      }
      return A.rest - wind * clamp(p.charge, 0, 1);
    }
    updateShooting(dt) {
      const p = this.pult;
      if (this.state !== 'play' || p.dead) return;
      const inp = this.input;
      const canAct = p.jumpT >= 1;
      if (canAct && inp.lmb && !p.charging) {
        p.charging = true; p.charge = 0; p.dwellT = 0; p.chargeTopGlow = 0; p.lastQ = -1;
      }
      if (p.charging) {
        if (!inp.lmb) {
          // release → fire at the CURRENT charge (speed) and aimed angle
          p.charging = false;
          this.fire(this.aimThetaDeg(), this.powerSpeed(p.charge), false);
          p.charge = 0; p.dwellT = 0;
        }
      }
      if (canAct && inp.rmbPressed) {
        if (this.ammo > 0) {
          this.ammo--;
          p.charging = false; p.charge = 0; p.dwellT = 0; // heavy shot cancels charge
          p.chargeTopGlow = 0;
          this.fire(this.aimThetaDeg(), 15, true); // iron shell: flat fast strike
          p.recoil = 1.4; p.armSwing = 1;
        } else {
          this.addPopupScreen(this.input.mx, this.input.my - 20, 'NO IRON!', '#ff8080', 18);
          G.Audio.uiClick();
        }
      }
    }
    // AIM — mouse X across the board maps to launch angle 10°..80°.
    aimThetaDeg() {
      const B = G.Board;
      const x0 = B.colX(this.pult.row, 0);
      const u = clamp((this.input.mx - x0) / B.colW, 0, B.COLS);
      return G.ANGLE_MIN + (u / B.COLS) * (G.ANGLE_MAX - G.ANGLE_MIN);
    }
    // POWER — charge 0..1 maps to launch speed vMin..vMax.
    powerSpeed(c) { const P = G.POWER; return P.vMin + (P.vMax - P.vMin) * clamp(c, 0, 1); }
    // Apex-height threshold for the x2 rule (see HIGH_ARC_H).
    highArcH() { return HIGH_ARC_H; }
    // Minimal charge (0..1) whose launch speed gives an apex of highArcH()
    // at launch angle thetaDeg: H = 2 + (v·sinθ)²/2g ≥ HIGH_ARC_H
    //   →  v ≥ √(2g(HIGH_ARC_H−2)) / sinθ  →  c = (v − vMin)/(vMax − vMin)
    // Returns null when even a full bar falls short (very flat angles) — hide marker.
    highArcChargeFor(thetaDeg) {
      const B = G.Board, P = G.POWER;
      const s = Math.sin(clamp(thetaDeg, G.ANGLE_MIN, G.ANGLE_MAX) * Math.PI / 180);
      if (s < 0.05) return null;
      const v = Math.sqrt(2 * B.gravity * (HIGH_ARC_H - 2)) / s;
      const c = (v - P.vMin) / (P.vMax - P.vMin);
      return c > 1 ? null : clamp(c, 0, 1);
    }
    // STRONG THROW — the glow window (see STRONG_ANGLE). True only when the
    // aim is over 45°, the charge is past the HIGH ARC marker for that angle,
    // and still under MAX (charge 1 = dwelling overcharge: no glow). Takes an
    // explicit charge so fire() can call it AFTER charging has been cleared.
    strongWindow(charge = this.pult ? this.pult.charge : 0) {
      if (!(charge > 0) || charge >= 1) return false;
      if (this.aimThetaDeg() <= STRONG_ANGLE) return false;
      const cMin = this.highArcChargeFor(this.aimThetaDeg());
      return cMin != null && charge >= cMin;
    }
    // Screen-space position of the melon exactly as G.Sprites.drawPult paints
    // the held/scoop melon at the LAUNCH pose — the moment the melon leaves.
    // Mirrors the sprite transform chain: arm-local melon (58,−6) → arm rotate
    // (canvas −a) → arm pivot (0,−74) → lean → squash scale →
    // pult scale → rail origin. lean=0 at release (fire only when landed).
    // landSquash is read live because firing within ~0.15s of touchdown still
    // squashes the body.
    pultMelonScreen(p) {
      const B = G.Board;
      const squash = -1 * 0.6 + p.landSquash * 0.9; // release pose: recoil 1
      const a = -G.PULT_ARM.launch;                 // world → canvas convention
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = 58 * ca + 6 * sa;   // rotate scoop melon (58,−6) by a
      const ry = 58 * sa - 6 * ca;
      const px = rx, py = ry - 74;   // arm pivot sits above the head box
      const sqx = 1 + squash * 0.12, sqy = 1 - squash * 0.14;
      const s = B.scale(p.row) * pultLaneScale(p.row);
      return {
        x: PULT_RAIL_X + s * (px * sqx),
        y: B.laneY[p.row] - p.hopY + s * (py * sqy),
      };
    }
    fire(thetaDeg, speed, heavy) {
      const B = G.Board;
      const p = this.pult;
      // Spawn at the drawn arm tip at the LAUNCH pose — the top of the power
      // stroke, where the scoop actually lets go. Both render paths derive
      // that point from G.PULT_ARM.launch, so the melon leaves the scoop it
      // is drawn in.
      // 3D mode: tip comes from the real 3D arm geometry (projected for the
      // 2D trail; world-space for the mesh's bezier bridge).
      let tip, tip3D = null;
      if (G.IS3D && G.R3.ready) {
        tip3D = G.R3.pultTip3D(p);
        tip = G.R3.project(tip3D);
      } else {
        tip = this.pultMelonScreen(p);
      }
      // STRONG THROW is judged on the charge STILL IN THE SCOOP at release
      const glowing = !heavy && this.strongWindow(p.charge);
      const pr = new Projectile(p.row, B.pultU, { thetaDeg, speed, heavy, glowing, launchSx: tip.x, launchSy: tip.y });
      if (tip3D) {
        pr._tip3D = tip3D;
        // control point continues the release throw direction (up-right)
        const rad = -35 * Math.PI / 180;
        pr._ctrl3D = tip3D.clone().add(new THREE.Vector3(Math.cos(rad), Math.sin(rad), 0).multiplyScalar(30 * G.R3.K));
      }
      this.projectiles.push(pr);
      p.recoil = 1; p.armSwing = 1; p.swingT = 0; p.holding = false;
      setTimeout(() => { p.holding = true; }, 420);
      const pw = clamp((speed - G.POWER.vMin) / (G.POWER.vMax - G.POWER.vMin), 0, 1);
      heavy ? G.Audio.heavyShoot() : G.Audio.shoot(pw);
      this.camera.kick(heavy ? 9 : 3 + pw * 3.5);
      // muzzle leaves — anchored to the fixed rail, pult-lane scale
      const sc = B.scale(p.row) * pultLaneScale(p.row);
      const sx = pultRailX(p.row) + 40 * sc;
      const sy = B.laneY[p.row] - 78 * sc;
      for (let i = 0; i < 6; i++) {
        this.particles.push(new Particle({
          x: sx, y: sy, vx: rand(40, 160), vy: rand(-90, -20), g: 300, life: 0.4,
          size: rand(2, 4), color: '#dfe8c8', type: 'dot',
        }));
      }
    }

    /* ---------- impacts & damage ---------- */
    /* One zombie, one break: a boss does not route through the shield/helmet
       economy at all — he has his own three-phase armour model and his own
       idea of what a hit is. */
    resolveImpact(pr, z) {
      pr.hitsDone++;
      this.lastDirectZombie = z;
      if (z.isBoss) { this.bossImpact(pr, z); return; }
      // a kneeling zombie dies to ANY hit — glory kill
      if (z.state === 'kneel' && !pr.heavy) {
        this.killZombie(z, 'glory', pr.highArc);
        if (!pr.highArc || pr.hitsDone >= 2) { this.groundSplash(pr); pr.dead = true; }
        return;
      }
      const B = G.Board;
      const sx = B.colX(pr.row, z.u);
      const syTop = B.laneY[pr.row] - B.heightPx(pr.row, pr.h);
      if (pr.heavy) {
        // iron shell detonates: one-hit kill on contact + small blast radius
        this.craters.push({ x: sx, y: B.laneY[pr.row], row: pr.row, u: z.u, t: 0, heavy: true });
        if (this.craters.length > 12) this.evictOldestCrater();
        this.killZombie(z, 'heavy');
        for (const other of this.zombies) {
          if (other === z || other.row !== pr.row || other.dead ||
              other.state === 'die' || other.state === 'glorydie') continue;
          if (Math.abs(other.u - z.u) < 0.9) this.killZombie(other, 'heavy');
        }
        this.camera.kick(12);
        this.camera.hitFlash(0.25, '#fff');
        this.hitstop = 0.06;
        this.addPopup(sx, syTop - 30, 'SMASHED!', '#ff9c40', 26);
        this.sparks(sx, syTop, 14);
        this.debris(sx, syTop, '#3d434d', 10);
        this.dustBurst(sx, B.laneY[pr.row], B.scale(pr.row), 10);
        pr.dead = true;
        return;
      }
      if (pr.hitsDone === 1 && pr.highArc) {
        // HIGH ARC: over the shield, straight down on the head — armor piece #1 evaded
        if (z.shield) { z.shield = false; this.shieldBreakFX(z, true, true); }
        this.headHit(z, sx, true, true, pr.glowing);
        // bounce into splash second hit
        pr.h = Math.max(pr.h, 0.9);
        pr.vh = 2.2; pr.vu = pr.vu * 0.45;
        this.sparks(sx, syTop, 10);
        return;
      }
      if (z.shield) {
        // frontal against the front armour (door / paper / pads / pole):
        // the barricade is held across the body and the head, so it eats
        // everything that comes in flat — only a HIGH ARC lob goes over it
        const fa = z.frontArmor || { label: 'ARMOUR', hits: 5 };
        z.shieldHits--;
        z.shieldWobble = 0.25;
        z.hitFlash = 0.5;
        G.Audio.shieldClink();
        this.sparks(sx - 14, syTop, 12);
        this.camera.kick(2);
        if (z.shieldHits <= 0) { this.shieldBreakFX(z, false, pr.highArc); }
        z.stagger();
        this.addPopup(sx, syTop - 18, `${fa.label} ${Math.max(0, z.shieldHits)}/${fa.hits}`, '#ffd23f', 17);
      } else if (pr.h >= z.hitBands().head) {
        // landed on the skull (or on the cone / bucket / helmet covering it)
        this.headHit(z, sx, false, pr.highArc && pr.hitsDone >= 2, pr.glowing);
      } else {
        this.bodyHit(z, sx, syTop, '-1', pr.highArc && pr.hitsDone >= 2, pr.glowing);
      }
      this.groundSplash(pr);
      pr.dead = true;
    }

    /* ================= THE BOSS =================
       Three phases, and the ROSTER owns every number:

         CAP     (final boss, stage 5 only) 40 flat hits, or 12 high arcs → flies off
         TOUPEE  12 high arcs ONLY — flat shots bounce off the rug
         BARE    40 flat hits, or 12 high arcs → he goes down

       An iron shell counts as a high-arc strike (it is the heavy round), so
       the stockpile is a real shortcut through the fight without one-shotting
       a boss. A HIGH ARC is the game's existing skill lever: an arc that
       crests at or above HIGH_ARC_H, read straight off the projectile. */
    bossImpact(pr, z) {
      const B = G.Board;
      const bd = z.spec.boss;
      const sx = B.colX(z.row, z.u);
      const bands = z.hitBands();
      const hy = B.laneY[z.row] - B.heightPx(z.row, bands.head + (bands.top - bands.head) * 0.45);
      const high = !!pr.highArc;
      const iron = !!pr.heavy;
      const top = high || iron;              // iron strikes count as a high arc
      const label = iron ? 'IRON' : high ? 'HIGH ARC' : 'HIT';

      // every hit rocks him. A high hit shakes the whole body hard enough to
      // read from the far lane — that shake IS the boss's stagger.
      z.shakeAmp = Math.max(z.shakeAmp, top ? 1.05 : 0.45);
      z.shakeK = 1;
      z.hitFlash = 0.5;
      this.camera.kick(top ? 9 : 3);
      G.Audio.bossThud(top);

      if (z.magaOn) {
        if (top) { z.magaHigh++; z.magaHits += 3; } else z.magaHits++;
        if (z.magaHigh >= bd.magaHigh || z.magaHits >= bd.magaHits) {
          z.magaOn = false;
          this.bossPhaseBeat(z, sx, hy - 40, 'CAP OFF!', '#ff5555');
          this.debris(sx, hy - 40, '#c62828', 34);
          this.sparks(sx, hy - 40, 28);
          this.bossPropFly(z, '#c62828', 1.35);
          this.bossGripe(z, CAP_GRIPE, '#ff8080');   // he WILL be heard about this
        } else {
          this.sparks(sx, hy - 36, top ? 13 : 6);
          this.addPopup(sx, hy - 42, `${label} · CAP ${Math.max(0, bd.magaHits - z.magaHits)}`, '#ff8080', 21);
        }
        this.groundSplash(pr); pr.dead = true;
        return;
      }

      if (z.toupeeOn) {
        if (!top) {
          // the rug is the weak point, and the weak point is the ARC: a flat
          // shot slides off it. Say so — silence here reads as a bug.
          this.sparks(sx, hy - 38, 8);
          G.Audio.shieldClink();
          this.addPopup(sx, hy - 44, 'BOUNCE! ARC IT HIGH', '#cfe8ff', 20);
          this.camera.kick(2);
          this.groundSplash(pr); pr.dead = true;
          return;
        }
        z.toupeeHigh++;
        if (z.toupeeHigh >= bd.toupeeHigh) {
          z.toupeeOn = false;
          this.bossPhaseBeat(z, sx, hy - 46, 'RUG OFF!', '#ffd23f');
          this.debris(sx, hy - 44, '#f0d071', 36);
          this.sparks(sx, hy - 44, 26);
          this.bossPropFly(z, '#f0d071', 1.5);
          this.bossGripe(z, RUG_GRIPE, '#d8a92a');   // the rug has its own lobby
        } else {
          this.sparks(sx, hy - 40, 12);
          this.addPopup(sx, hy - 46,
            `HIGH ARC · RUG ${bd.toupeeHigh - z.toupeeHigh}`, '#ffe9a0', 22);
        }
        this.groundSplash(pr); pr.dead = true;
        return;
      }

      // ---- BARE: the normal kill economy ----
      if (top) { z.bodyHigh++; z.bodyHits += 3; } else z.bodyHits++;
      if (z.bodyHigh >= bd.bodyHigh || z.bodyHits >= bd.bodyHits) {
        this.killZombie(z, 'boss');
      } else {
        this.bloodBurst(sx, hy, top ? 18 : 12);
        this.addPopup(sx, hy - 16, `${label} · ${Math.max(0, bd.bodyHits - z.bodyHits)} TO GO`, '#ff5555', 20);
      }
      this.groundSplash(pr); pr.dead = true;
    }
    /* A phase change is the loudest beat in the fight: freeze, shake the
       camera, flash, and let the popup land before anything else happens. */
    bossPhaseBeat(z, sx, sy, txt, color) {
      this.hitstop = 0.16;
      this.slowmo = 0.55;
      this.camera.kick(22);
      this.camera.hitFlash(0.3, color);
      z.shakeAmp = 3;
      z.shakeK = 1;
      this.addPopup(sx, sy, txt, color, 42);
      G.Audio.bossPhase();
    }
    /* His look just got blown off his head. He has THOUGHTS. One complaint
       is rolled from the pool and pinned over him for a full ten seconds —
       it follows him, survives lane jumps, and will not be rushed. */
    bossGripe(z, pool, border) {
      const B = G.Board;
      this.popups.length = 0;            // the bubble owns the screen — no HUD noise
      z.gripeK = 1;                      // hands-up HOWL for the full linger
      this.gripe = {
        z,
        lines: pool[Math.floor(Math.random() * pool.length)],
        border,
        t: 0, dur: GRIPE_T,
        sx: B.colX(z.row, z.u),
        sy: B.laneY[z.row] - B.heightPx(z.row, z.hitBands().top),
      };
    }
    /* The headwear leaves the head as physical debris — the same shape as the
       helmet pop, but bigger and unmistakably coloured. */
    bossPropFly(z, color, s) {
      const B = G.Board;
      const sx = B.colX(z.row, z.u);
      const sy = B.laneY[z.row] - B.heightPx(z.row, z.hitBands().top) + 14 * B.scale(z.row);
      for (let i = 0; i < 12; i++) {
        this.particles.push(new Particle({
          x: sx + rand(-10, 10) * s, y: sy, vx: rand(-260, 320) * s, vy: rand(-460, -190) * s,
          g: 900, vr: rand(-16, 16), life: rand(0.7, 1.15), size: rand(4, 7.5) * s,
          type: 'chunk', color: pick([color, color, '#ffffff']),
        }));
      }
    }
    headHit(z, sx, plunging, fromHighArc = false, glowPop = false) {
      const B = G.Board;
      const bands = z.hitBands();
      // FX anchor rides the real head band, not a hard-coded 2.4 any more
      const hy = B.laneY[z.row] - B.heightPx(z.row, bands.head + (bands.top - bands.head) * 0.45);
      if (z.helmet) {
        const ha = z.headArmor || { label: 'HELMET', hits: 1 };
        z.helmetHits--;                    // every head hit loosens it
        z.dents++;
        z.hitFlash = 0.5;
        z.helmetWobble = 0.4;
        z.stagger();
        G.Audio.helmetClank();
        this.sparks(sx, hy - 30, 8);
        this.debris(sx, hy - 30, ha.kind === 'cone' ? '#e8752a' : '#9aa3ad', 7);
        if (z.helmetHits <= 0 || glowPop) {
          // last hit knocks it off — and a GLOWING lob rips it straight off.
          // The pop gets its OWN beat: hitstop + a big popup + flying steel.
          z.helmet = false;
          z.helmetHits = 0;
          this.hitstop = 0.06;
          const suffix = glowPop ? ' GLOW!' : (fromHighArc ? ' -1 x2' : ' -1');
          this.addPopup(sx, hy - 44, `${ha.label} OFF${suffix}`, '#ff9e3d', 24);
          this.helmetFlyFX(sx, hy - 30);
        } else {
          this.addPopup(sx, hy - 44, fromHighArc ? `${ha.label} ${z.helmetHits}/${ha.hits} x2` : `${ha.label} ${z.helmetHits}/${ha.hits}`, '#ff9e3d', 18);
        }
        this.camera.kick(3);
        this.hitstop = 0.04;
      } else {
        z.hp--;
        z.state = 'kneel';
        z.kneelTimer = KNEEL_SECONDS;
        z.gloryReady = true;
        z.hitFlash = 0.6;
        G.Audio.headBonk();
        G.Audio.knockdown();
        this.bloodBurst(sx, hy, 10);
        this.addPopup(sx, hy - 40, fromHighArc ? '-1 HEAD x2' : '-1 HEAD', '#ff9e3d', 20);
        this.addPopup(sx + 4, hy - 66, 'GLORY!', '#b9ff2e', 22);
        this.camera.kick(5);
        this.hitstop = 0.05;
      }
      this.registerHit();
    }
    bodyHit(z, sx, sy, label = '-1', fromHighArc = false, glowPop = false) {
      const hadShield = z.shield;
      if (z.shield) { // splash/body hit drops the shield outright
        this.shieldBreakFX(z, true, fromHighArc);
      }
      if (z.helmet) {
        const ha = z.headArmor || { label: 'HELMET', hits: 1 };
        z.helmetHits--;                  // every body hit shakes it loose too
        z.dents++;                       // and shows on the armour itself
        z.helmetWobble = 0.3;
        if (z.helmetHits <= 0 || glowPop) {
          z.helmet = false;
          z.helmetHits = 0;
          this.hitstop = 0.06;
          G.Audio.helmetClank();
          this.debris(sx, sy - 24, ha.kind === 'cone' ? '#e8752a' : '#9aa3ad', 10);
          this.addPopup(sx, sy - 40, glowPop ? `${ha.label} OFF GLOW!` : (fromHighArc ? `${ha.label} OFF x2` : `${ha.label} OFF!`), '#ffd23f', 22);
          this.helmetFlyFX(sx, sy - 24);
        } else {
          // counter rides HIGH above the '-1' and stays a SUPPORTING whisper —
          // the dents and tilt on the armour are the primary read
          this.addPopup(sx, sy - 58, `${ha.label} ${z.helmetHits}/${ha.hits}`, '#ffd23f', 12);
        }
      } else if (glowPop && !hadShield && z.state !== 'kneel' && z.state !== 'die' && z.state !== 'glorydie') {
        // GLOWING hit on an unprotected body: the stun bonus — knocked to its
        // knees even without the head-shot rule (a glowing HEAD hit already
        // kneels). The armour must have been off BEFORE the hit for this to
        // count: a glow strike that only breaks a door doesn't stun.
        z.state = 'kneel';
        z.kneelTimer = KNEEL_SECONDS;
        z.gloryReady = true;
        z.hitFlash = 0.6;
        this.addPopup(sx, sy - 58, 'STUN!', '#b9ff2e', 18);
      }
      z.hp--;
      z.hitFlash = 0.55;
      z.stagger();
      G.Audio.splat();
      this.bloodBurst(sx, sy - 6, 12);
      // the '-1' drops LOW so it never buries the armour popups above it
      this.addPopup(sx, sy - 14, fromHighArc ? `${label} x2` : label, '#ff5555', 20);
      this.camera.kick(2.5);
      this.registerHit();
      if (z.hp <= 0) this.killZombie(z, 'normal', fromHighArc);
    }
    helmetFlyFX(sx, sy) {
      // the pop must feel like an EVENT: steel chunks spin off the head
      for (let i = 0; i < 7; i++) {
        this.particles.push(new Particle({
          x: sx + rand(-8, 8), y: sy, vx: rand(-220, 220), vy: rand(-380, -160), g: 900,
          vr: rand(-14, 14), life: rand(0.5, 0.8), size: rand(2.6, 4.6),
          type: 'chunk', color: pick(['#b6bfc8', '#7c858e', '#e2e9ef']),
        }));
      }
      this.sparks(sx, sy, 6);
    }
    shieldBreakFX(z, silentSplash, fromHighArc = false) {
      const kind = z.frontArmor ? z.frontArmor.kind : 'screen';
      const label = z.frontArmor ? z.frontArmor.label : 'ARMOUR';
      z.shield = false;
      z.shieldHits = 0;
      const B = G.Board;
      const sx = B.colX(z.row, z.u) - 20 * B.scale(z.row);
      const sy = B.laneY[z.row] - 40 * B.scale(z.row);
      G.Audio.shieldBreak();
      // debris reads as the thing that just broke
      const debrisCol = kind === 'paper' ? '#e8e4d3'
        : kind === 'pads' ? '#e2ddcd'
          : kind === 'pole' ? '#c9cfd6' : '#8a6a3c';
      this.debris(sx, sy, debrisCol, 12);
      this.sparks(sx, sy, 6);
      if (kind === 'paper') {
        // tearing the paper off enrages him — the classic sprinter
        z.angry = true;
        z.lean = 0.09;
        G.Audio.knockdown();
        this.addPopup(sx, sy - 46, z.spec.rage ? z.spec.rage.label : 'ENRAGED!', '#ff5555', 24);
        this.camera.kick(4);
      }
      if (kind === 'pole') {
        z.poleBroken = true;
        this.addPopup(sx, sy - 46, 'POLE SNAPPED', '#cfe8ff', 18);
      }
      this.addPopup(sx, sy - 24, fromHighArc ? `${label} DOWN x2` : `${label} DOWN`, '#ffd23f', 18);
      this.camera.kick(3);
    }
    killZombie(z, how, fromHighArc = false) {
      if (z.state === 'die' || z.state === 'glorydie') return;
      const B = G.Board;
      const sx = B.colX(z.row, z.u);
      const sy = B.laneY[z.row] - 50 * B.scale(z.row);
      if (how === 'boss') {
        // the finale: he tips, the field shakes, the score lands. The corpse
        // itself stands down at once — the donFall rig owns the body now.
        z.dead = true;
        this.stageStats.kills++;
        this.score += 5000 + this.stage * 500;
        this.slowmo = 1.1;
        this.hitstop = 0.14;
        this.camera.kick(22);
        this.camera.hitFlash(0.38, '#ffe9a0');
        G.Audio.bossDown();
        G.Audio.deathGroan();
        this.bloodBurst(sx, sy, 30);
        this.debris(sx, sy, '#e79a52', 22);
        this.dustBurst(sx, B.laneY[z.row], B.scale(z.row), 18, 1.8);
        this.addPopup(sx, sy - 70, 'THE DON IS DOWN!', '#ffd23f', 40);
        this.addPopupScreen(640, 300, `+${5000 + this.stage * 500}`, '#b9ff2e', 34);
        this.scorePop = 1;
        this.startDonFall(z);      // ceremonious: ramble, fire, swallowed
        return;
      }
      if (how === 'glory') {
        z.state = 'glorydie';
        z.dieT = 0;
        this.stageStats.glory++;
        this.ammo = Math.min(IRON_MAX, this.ammo + 1);
        this.score += Math.floor(500 * this.multiplier());
        this.slowmo = 0.5;
        this.hitstop = 0.09;
        this.camera.kick(10);
        this.camera.hitFlash(0.2, '#eaffb0');
        G.Audio.glorySting();
        G.Audio.deathGroan();
        this.addPopup(sx, sy - 50, fromHighArc ? 'GLORY KILL! x2' : 'GLORY KILL!', '#b9ff2e', 34);
        this.addPopup(sx, sy - 20, '+1 IRON', '#86b1ff', 22);
        // ammo icon flies to HUD
        this.particles.push(new Particle({
          x: sx, y: sy, vx: 0, vy: -260, g: 0, life: 0.8, size: 12, color: '#3d434d', type: 'chunk', vr: 9,
        }));
        this.bloodBurst(sx, sy, 22);
        this.stageStats.kills++;
      } else {
        z.state = 'die';
        z.dieT = 0;
        this.score += Math.floor(100 * this.multiplier());
        G.Audio.deathGroan();
        this.bloodBurst(sx, sy, 14);
        this.addPopup(sx, sy - 40, fromHighArc ? 'DOWN x2' : 'DOWN', '#e8e8e8', 18);
        this.stageStats.kills++;
        this.registerHit();
      }
      this.scorePop = 1;
    }
    hitObstacle(pr, ob) {
      pr.hitsDone++;
      ob.hp--;
      ob.shake = 1;
      if (pr.heavy || ob.hp <= 0) {
        this.obstacles.splice(this.obstacles.indexOf(ob), 1);
        this.score += 50;
        G.Audio.stoneCrack();
        const B = G.Board;
        // FX anchors ride the stone's real height (STONE_BLOCK_H × pxPerHeight)
        const stonePx = STONE_BLOCK_H * 38;
        this.debris(B.colX(ob.row, ob.u), B.laneY[ob.row] - stonePx * 0.45, '#9aa396', 16);
        this.dustBurst(B.colX(ob.row, ob.u), B.laneY[ob.row], B.scale(ob.row), 12);
        this.addPopup(B.colX(ob.row, ob.u), B.laneY[ob.row] - stonePx - 22, 'CRUMBLED +50', '#e8e8e8', 18);
        this.camera.kick(6);
      } else {
        G.Audio.stoneCrack();
        const B = G.Board;
        const stonePx = STONE_BLOCK_H * 38;
        this.sparks(B.colX(ob.row, ob.u), B.laneY[ob.row] - stonePx * 0.6, 10);
        this.addPopup(B.colX(ob.row, ob.u), B.laneY[ob.row] - stonePx - 18, 'BLOCKED', '#cfcfcf', 16);
      }
      pr.dead = true;
    }
    groundSplash(pr) {
      // splash damage: nearby zombies take a body hit
      const B = G.Board;
      let any = false;
      for (const z of this.zombies) {
        if (z.row !== pr.row || z.dead || z.state === 'die' || z.state === 'glorydie') continue;
        if (z.isBoss) continue;   // splash never reaches past the bulk
        if (Math.abs(z.u - pr.u) < 0.85 && z !== this.lastDirectZombie) {
          any = true;
          if (z.state === 'kneel') { this.killZombie(z, 'glory', pr.highArc); }
          else {
            const sx = B.colX(z.row, z.u);
            const sy = B.laneY[z.row] - 40 * B.scale(z.row);
            this.bodyHit(z, sx, sy, '-1', pr.highArc);
          }
        }
      }
      return any;
    }
    groundImpact(pr) {
      const B = G.Board;
      const sx = B.colX(pr.row, pr.u);
      const sy = B.laneY[pr.row];
      // scorch decal lingers as evidence of the shot
      this.craters.push({ x: sx, y: sy, row: pr.row, u: pr.u, t: 0, heavy: false });
      if (this.craters.length > 12) this.evictOldestCrater();
      this.dustBurst(sx, sy - 6, B.scale(pr.row), 6);
      // melon shatters
      this.debris(sx, sy - 8, '#2f8f3e', 8);
      this.debris(sx, sy - 8, '#ff6b6b', 6);
      this.dustBurst(sx, sy, B.scale(pr.row), 8);
      if (pr.hitsDone === 0) {
        // clear miss
        G.Audio.missPoof();
        this.addPopup(sx, sy - 50, 'MISS', '#f0f0f0', 26);
        this.combo = 0;
      }
    }
    registerHit() {
      this.combo++;
      this.comboT = 4;
    }
    multiplier() { return 1 + Math.floor(this.combo / 3); }
    evictOldestCrater() {
      // oldest fades out quickly instead of popping out of existence
      let oldest = 0;
      for (let i = 1; i < this.craters.length; i++) if (this.craters[i].t > this.craters[oldest].t) oldest = i;
      const cr = this.craters.splice(oldest, 1)[0];
      cr.dieAt = cr.t + 0.5;
      this.craters.push(cr);
    }

    /* ---------- FX helpers ---------- */
    addPopup(wx, wy, txt, color, size) { this.popups.push(new Popup(txt, wx, wy, color, size)); }
    addPopupScreen(x, y, txt, color, size) { this.popups.push(new Popup(txt, x, y, color, size)); }
    sparks(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI, 0);
        const sp = rand(120, 420);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 500, drag: 1.2,
          life: rand(0.2, 0.45), size: rand(1.5, 3), color: pick(['#fff6c0', '#ffd23f', '#ffb040']), type: 'spark',
        }));
      }
    }
    bloodBurst(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI, 0.2);
        const sp = rand(60, 320);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 700, drag: 0.4,
          life: rand(0.35, 0.8), size: rand(1.8, 4.2), color: pick(['#c81e1e', '#a01010', '#e04040']), type: 'dot',
        }));
      }
    }
    debris(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI - 0.4, 0.4);
        const sp = rand(80, 300);
        this.particles.push(new Particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, g: 800, drag: 0.2,
          life: rand(0.4, 0.9), size: rand(3, 6), color, type: 'chunk', vr: rand(-10, 10),
        }));
      }
    }
    dustBurst(x, y, s, n, spread = 1) {
      for (let i = 0; i < n; i++) {
        this.particles.push(new Particle({
          x: x + rand(-14, 14) * s * spread, y: y + rand(-4, 2),
          vx: rand(-70, 70) * spread, vy: rand(-60, -10) * (0.6 + 0.4 * spread), g: -30,
          life: rand(0.3, 0.6) * (1 + 0.25 * (spread - 1)), size: rand(3, 6) * s, color: '#c9c0a8', type: 'dust',
        }));
      }
    }
    shakeBits(x, y, color, n) { this.debris(x, y, color, n); }

    /* ---------- main update ---------- */
    update(rawDt) {
      const time = performance.now() / 1000;
      // global keys (checked even while paused)
      if (this.input.keyPressed['p'] || this.input.keyPressed['escape']) {
        if (this.state === 'play') { this.paused = !this.paused; G.Audio.uiClick(); }
      }
      if (this.input.keyPressed['m']) G.Audio.toggleMute();
      if (this.input.keyPressed['r'] && this.state === 'play') this.start(this.stage);
      // difficulty pick: buttons in the menu, or keys 1 / 2 / 3
      if (this.state === 'menu') {
        const kmap = { '1': 'veryeasy', '2': 'easy', '3': 'hard' };
        for (const k in kmap) {
          if (this.input.keyPressed[k]) { this.setDifficulty(kmap[k]); }
        }
      }
      if (this.paused && this.state === 'play') return;
      // slow-mo & hitstop
      let dt = rawDt;
      if (this.hitstop > 0) { this.hitstop -= rawDt; dt = 0; }
      if (this.slowmo > 0) {
        this.slowmo -= rawDt;
        this.timeScale = damp(this.timeScale, this.slowmo > 0 ? 0.3 : 1, 8, rawDt);
      } else this.timeScale = damp(this.timeScale, 1, 8, rawDt);
      dt *= this.timeScale;
      if (dt > 0.05) dt = 0.05;

      this.camera.update(rawDt);
      this.scorePop = Math.max(0, this.scorePop - rawDt * 4);
      if (this.comboT > 0) { this.comboT -= rawDt; if (this.comboT <= 0) this.combo = 0; }
      this.warning = this.zombies.some(z => !z.dead && z.u < 2.2 && z.state !== 'die' && z.state !== 'glorydie')
        ? this.warning + rawDt : 0;
      this.bannerT += rawDt;
      if (this.gripe) {                      // the complaint lingers its full 3 s
        this.gripe.t += rawDt;
        if (this.gripe.t >= this.gripe.dur) this.gripe = null;
      }

      if (this.state === 'menu') { this.menuT += rawDt; this.updateEntities(dt); return; }
      if (this.state === 'gameover') {
        // 10-second decision window: restart this level or quit. No choice
        // inside the window quits — it never silently throws the player back
        // into a stage they just lost.
        this.loseT += rawDt;
        if (this.loseT >= this.loseLimit) { this.autoQuit = true; this.quitToMenu(); return; }
        this.updateEntities(dt);
        this.handleMetaInput();
        return;
      }
      if (this.state === 'stageClear') {
        const ph = this.celebration && this.celebration.phase;
        if (ph === 'fall') {
          this.updateDonFall(rawDt);         // his last words, then the swallow
        } else if (this.parade && !this.parade.done) {
          this.updateParade(rawDt);          // the fireworks wait their turn
        } else if (this.celebration) {
          // fireworks own the sky from here on — through the roast and the end
          this.celebration.t += rawDt;
          const ph2 = this.celebration.phase;
          if (ph2 === 'fwshow') {
            this.updateFwShow(rawDt);        // the saturated send-off
          } else if (ph2 === 'fwfinal') {
            this.updateFwFinal(rawDt);       // the scored pattern → the extreme
          } else if (ph2 === 'confetti') {
            this.updateConfetti(rawDt);      // the calm after — ten s of paper rain
          } else if (ph2 === 'seeya') {
            // the good-riddance card: five seconds to read, then the chase
            this.celebration.seeyaT += rawDt;
            if (this.celebration.seeyaT >= SEEYA_T) { this.startParade(); this.celebration.phase = 'parade'; }
          } else {
            // THE END screen: on the finale the sky gets FIVE more seconds of
            // fireworks once the message is up — then it goes quiet for good.
            // Ordinary stage clears keep their celebratory sky the whole time.
            const cel = this.celebration;
            cel.endT = (cel.endT || 0) + rawDt;
            if (!cel.finale || cel.endT <= 5) {
              this.fwTimer -= rawDt;
              if (this.fwTimer <= 0) {
                this.launchShell(cel.night);
                // the finale (stage 5) doubles the rate: a dense, constant bloom
                this.fwTimer = cel.night ? rand(0.14, 0.42) : rand(0.3, 0.72);
              }
            }
          }
          if (ph2 === 'roast') {
            this.celebration.roastT += rawDt * 39.2;   // 40% faster — the report almost struts now
            // the send-off trigger: the whole report has been read and its
            // bottom edge is halfway up the screen, on its way out — the
            // sky answers with everything it has
            if (this.roastBottomY() <= 360) this.startFwShow();
            else if (this.celebration.roastT > this.roastSpan()) this.celebration.phase = 'end';
          } else if (ph2 === 'fwshow' || ph2 === 'fwfinal') {
            this.celebration.roastT += rawDt * 39.2;   // the report rolls on through the show
          }
        }
        this.updateEntities(dt);
        this.handleMetaInput();
        return;
      }

      // play
      this.updateShooting(dt);
      this.updateSpawns(dt);
      this.updateEntities(dt); // pult updates inside updateEntities (single-step)
      G.Audio.ambience(rawDt,
        this.zombies.filter(z => z.state === 'walk').length,
        this.zombies.filter(z => !z.dead && z.state !== 'die' && z.state !== 'glorydie').length);
    }
    updateEntities(dt) {
      this.zombies.forEach(z => z.update(dt, this));
      this.zombies = this.zombies.filter(z => !z.dead);
      this.projectiles.forEach(p => p.update(dt, this));
      this.projectiles = this.projectiles.filter(p => !p.dead);
      this.particles = this.particles.filter(p => p.update(dt));
      this.popups = this.popups.filter(p => p.update(dt));
      this.craters.forEach(cr => cr.t += dt);
      this.craters = this.craters.filter(cr => cr.t < (cr.dieAt || 10));
      this.obstacles.forEach(o => o.shake = Math.max(0, o.shake - dt * 4));
      this.shells.forEach(sh => sh.update(dt, this));
      this.shells = this.shells.filter(sh => !sh.dead);
      this.fx = this.fx.filter(e => e.update(dt));
      this.confetti = this.confetti.filter(c => c.update(dt));
      if (this.state !== 'menu' && !this.pult.dead) this.pult.update(dt, this);
    }
    handleMetaInput() {
      if (this.input.keyPressed['enter']) {
        if (this.state === 'stageClear') {
          if (this.celebration && this.celebration.phase === 'fall') this.finishDonFall();  // skip the eulogy
          else if (this.celebration && this.celebration.phase === 'seeya') { this.startParade(); this.celebration.phase = 'parade'; }  // skip the card → the chase
          else if (this.parade && !this.parade.done) this.finishParade();             // skip the chase
          else if (this.celebration && (this.celebration.phase === 'roast' || this.celebration.phase === 'fwshow' || this.celebration.phase === 'fwfinal' || this.celebration.phase === 'confetti')) { // skip the roast / send-off / finale / rain
            this.celebration.phase = 'end';
            if (this.fwQueue) this.fwQueue.length = 0;   // no scored beat fires late
          }
          else if (this.celebration && this.celebration.finale) this.quitToMenu(); // THE END — menu
          else { this.stage++; this.start(this.stage); }
        } else this.start(this.stage);
      }
      if (this.input.keyPressed['r']) this.start(this.stage);   // replay (the finale replays stage 5)
      if (this.input.keyPressed['q'] && this.state === 'gameover') this.quitToMenu();
      if (this.input.keyPressed['m']) G.Audio.toggleMute();
    }

    /* ================= DRAW ================= */
    draw(ctx) {
      const time = performance.now() / 1000;
      ctx.clearRect(0, 0, 1280, 720);
      ctx.save();
      this.camera.apply(ctx);

      const is3d = G.IS3D;
      if (!is3d) ctx.drawImage(this.bg, 0, 0);

      // the far-staged scorches (the Don's crash, up the lawn) are drawn in
      // BOTH paths: in 3D there is no mesh for them, because a mesh would land
      // on the near lane instead of where the crash actually happened
      if (is3d) for (const cr of this.craters) if (cr.far) this.drawFarScorch(ctx, cr);

      if (!is3d) {
      // scorch craters under everything else (far lanes keep a legible minimum size)
      for (const cr of this.craters) {
        if (cr.far) { this.drawFarScorch(ctx, cr); continue; }
        const s = Math.max(0.9, G.Board.scale(cr.row)) * (cr.heavy ? 1.6 : 1);
        const ttl = cr.dieAt || (cr.heavy ? 20 : 10);
        const fade = clamp(1 - cr.t / ttl, 0, 1);
        ctx.save();
        ctx.globalAlpha = 0.8 * fade;
        ctx.fillStyle = '#3d3226';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.9 * fade;
        ctx.strokeStyle = '#2a221a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.55 * fade;
        ctx.fillStyle = '#241d16';
        ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 17 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        if (cr.heavy) {
          // raised dirt rim + embedded shrapnel — the field remembers iron
          ctx.globalAlpha = 0.7 * fade;
          ctx.strokeStyle = '#6a5638'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 38 * s, 14 * s, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#3d434d';
          for (const [ox, oy, rr] of [[-20, -3, 4], [14, 4, 3.4], [2, 8, 2.6]]) {
            ctx.beginPath(); ctx.arc(cr.x + ox * s, cr.y + oy * s, rr, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }

      // obstacles
      for (const ob of this.obstacles) {
        const B = G.Board;
        const s = B.scale(ob.row);
        const sx = B.colX(ob.row, ob.u) + (ob.shake > 0 ? rand(-3, 3) * ob.shake : 0);
        const sy = B.laneY[ob.row] + 4 * s;
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(sx, sy + 2 * s, 44 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(sx, sy); ctx.scale(s, s);
        G.Sprites.drawTombstone(ctx, 2 - ob.hp);
        ctx.restore();
      }
      } // end !is3d (2D-only field decals)

      // entities sorted by row (far first)
      const actors = [];
      for (const z of this.zombies) actors.push({ row: z.row, draw: () => z.draw(ctx, time) });
      for (const p of this.projectiles) actors.push({ row: p.row, draw: () => p.draw(ctx) });
      if (!is3d && this.state !== 'menu') actors.push({ row: this.pult.row, draw: () => this.pult.draw(ctx, time, this) });
      actors.sort((a, b) => a.row - b.row);
      for (const a of actors) a.draw();

      // particles & popups on top
      for (const p of this.particles) p.draw(ctx);
      for (const p of this.popups) p.draw(ctx);
      this.drawBossGripe(ctx);   // his hat-rage, pinned over him for a full 3 s

      // aiming UI
      if (this.state === 'play') this.drawAimUI(ctx);
      // HUD (suppressed on the celebration / lose screens — they present it all)
      if (this.state !== 'menu') this.drawHUD(ctx);

      ctx.restore();

      // overlays (not shaken)
      if (this.banner && this.bannerT < 2.4 && this.state === 'play') this.drawBanner(ctx);
      if (this.state === 'menu') this.drawMenu(ctx);
      if (this.state === 'stageClear') this.drawStageClear(ctx);
      if (this.state === 'gameover') this.drawGameOver(ctx);
      if (this.paused && this.state === 'play') this.drawPause(ctx);

      // flash
      if (this.camera.flash > 0) {
        ctx.save();
        ctx.globalAlpha = this.camera.flash;
        ctx.fillStyle = this.camera.flashColor;
        ctx.fillRect(0, 0, 1280, 720);
        ctx.restore();
      }
      // vignette when danger
      if (this.warning > 0.15 && this.state === 'play') {
        const a = 0.16 + Math.sin(time * 8) * 0.08;
        const vg = ctx.createRadialGradient(640, 360, 300, 640, 360, 760);
        vg.addColorStop(0, 'rgba(255,0,0,0)');
        vg.addColorStop(1, `rgba(255,30,30,${a})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, 1280, 720);
        if (Math.sin(time * 8) > 0) G.outlinedText(ctx, '!', 90, 400, 60, '#ff4040');
      }

      // celebration fireworks — LAST, above every overlay, so nothing dims them
      if (this.celebration) this.drawFireworks(ctx);
    }

    drawFireworks(ctx) {
      ctx.save();
      for (const e of this.fx) e.draw(ctx);
      for (const sh of this.shells) sh.draw(ctx);
      for (const c of this.confetti) c.draw(ctx);
      ctx.restore();
    }

    /* The finale happens under a real night sky: a deep gradient, a
       field of twinkling stars and a low moon, painted as a full-frame overlay
       so BOTH render paths get the same night (the 3D sky is a baked sunset
       texture and the 2D one is a baked canvas — repainting either would mean
       two night skies that drift apart). */
    drawNightSky(ctx) {
      const cel = this.celebration;
      const t = cel ? cel.t : 0;
      ctx.save();
      const g = ctx.createLinearGradient(0, 0, 0, 720);
      g.addColorStop(0, '#050a1e');
      g.addColorStop(0.45, '#0a1230');
      g.addColorStop(0.72, '#16203f');
      g.addColorStop(1, '#241a2c');
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.restore();
      // stars — a fixed field, each one breathing on its own clock
      if (cel && cel.stars) {
        ctx.save();
        for (const s of cel.stars) {
          const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.8 + s.ph));
          ctx.globalAlpha = tw;
          ctx.fillStyle = '#eaf2ff';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // moon + halo, low and warm
      ctx.save();
      const mg = ctx.createRadialGradient(1058, 132, 8, 1058, 132, 118);
      mg.addColorStop(0, 'rgba(255,246,214,0.55)');
      mg.addColorStop(1, 'rgba(255,246,214,0)');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(1058, 132, 118, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fdf6d8';
      ctx.beginPath(); ctx.arc(1058, 132, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(196,188,158,0.5)';
      ctx.beginPath(); ctx.arc(1046, 124, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(1068, 146, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    drawAimUI(ctx) {
      const B = G.Board;
      const p = this.pult;
      if (p.charging && p.jumpT >= 1) {
        const thetaDeg = this.aimThetaDeg();
        const speed = this.powerSpeed(p.charge);
        const sc = G.shotCalc(thetaDeg, speed);
        const g = B.gravity;
        const highArc = sc.H >= this.highArcH();
        // while the STRONG window is open, the trajectory steps BACK — the
        // pulsing melon must be the only bright thing in the charge zone
        const inWin = this.strongWindow();
        const col = inWin ? 'rgba(255,255,255,0.45)'
                  : highArc ? '#b9ff2e' : '#ffffff';
        // REAL flight: launch at h=2, land at h=0 — solved once, shared with
        // the projectile (G.landTime). The preview IS the flight, to landing.
        const tLand = G.landTime(sc.vh, g, 2.0);
        const landU = B.pultU + sc.vu * tLand;
        const LAND_MAX = B.COLS + 0.4;         // past the board's right edge
        const offBoard = landU > LAND_MAX;
        ctx.save();
        // ---- trajectory preview: the true parabola, launch → landing.
        // Steep high-power shots crest above the frame and clip naturally.
        ctx.strokeStyle = inWin ? 'rgba(255,255,255,0.4)'
                        : highArc ? 'rgba(185,255,46,0.85)' : 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 9]);
        ctx.beginPath();
        for (let t = 0; t <= tLand; t += 0.03) {
          const u = B.pultU + sc.vu * t;
          const h = 2 + sc.vh * t - 0.5 * g * t * t;
          const sx = B.colX(p.row, u);
          const sy = B.laneY[p.row] - B.heightPx(p.row, Math.max(0, h));
          t === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // ---- apex diamond, only while the crest is on-screen
        const apexX = B.colX(p.row, B.pultU + sc.vu * sc.tApex);
        const apexY = B.laneY[p.row] - B.heightPx(p.row, sc.H) - 14 * B.scale(p.row);
        if (apexY > 30) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(apexX, apexY - 7); ctx.lineTo(apexX + 7, apexY);
          ctx.lineTo(apexX, apexY + 7); ctx.lineTo(apexX - 7, apexY);
          ctx.closePath(); ctx.stroke();
          ctx.restore();
        }
        // ---- LANDING SPOT ring — where THIS shot actually touches down.
        // h(t) = 2 + vh·t − ½g·t² solved for h=0: exact for every
        // angle/power combination, same physics as Projectile.update.
        {
          const lx = B.colX(p.row, clamp(landU, 0.2, LAND_MAX));
          const ls = B.scale(p.row);
          const ly = B.laneY[p.row] + 4 * ls;  // on the lane ground line
          ctx.save();
          ctx.strokeStyle = col;
          ctx.fillStyle = col;
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(performance.now() / 150));
          // squashed ellipse reads as a mark painted on the ground
          ctx.beginPath();
          ctx.ellipse(lx, ly, 17 * ls, 6 * ls, 0, 0, Math.PI * 2);
          ctx.stroke();
          // center dot + side ticks
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(lx, ly, 2.6 * ls, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(lx - 25 * ls, ly); ctx.lineTo(lx - 19 * ls, ly);
          ctx.moveTo(lx + 19 * ls, ly); ctx.lineTo(lx + 25 * ls, ly);
          ctx.stroke();
          // landing beyond the board — chevron says "even farther"
          if (offBoard) {
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(lx + 28 * ls, ly - 5 * ls); ctx.lineTo(lx + 34 * ls, ly);
            ctx.lineTo(lx + 28 * ls, ly + 5 * ls);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
        if (highArc) {
          // smooth pulse, no strobe — label rides the arc's visible crest
          const labelX = clamp(apexX, 130, 1150);
          const labelY = Math.max(44, Math.min(apexY, B.laneY[p.row] - 70));
          ctx.save();
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(performance.now() / 130);
          G.outlinedText(ctx, 'HIGH ARC x2', labelX, labelY, 16, '#b9ff2e');
          ctx.restore();
        }
      } else if (p.jumpT >= 1) {
        // no idle reticle — the mouse X reads through the charge UI alone
      }
    }

    drawHUD(ctx) {
      // The celebration screens own their own copy (score, high score, glory
      // kills) and a live score/wave/ammo rail showing through a night sky is
      // just noise — a critic flagged it as "the gameplay layer is not dimmed".
      if (this.state !== 'play') return;
      const p = this.pult;
      this.drawBossBars(ctx);
      this.drawStageMeter(ctx);
      // score
      const spop = 1 + this.scorePop * 0.25;
      ctx.save();
      ctx.translate(140, 46);
      ctx.scale(spop, spop);
      G.outlinedText(ctx, String(this.score), 0, 0, 40, '#ffffff');
      ctx.restore();
      G.outlinedText(ctx, 'SCORE', 140, 74, 14, '#cfe8c2');
      G.outlinedText(ctx, `HI ${this.highScore}`, 140, 96, 15, '#ffd23f');
      // stage / wave / difficulty
      G.outlinedText(ctx, `STAGE ${this.stage}`, 1130, 40, 22, '#ffffff', 'center');
      G.outlinedText(ctx, `WAVE ${this.wave}/${this.wavesForStage(this.stage)}`, 1130, 64, 16, '#cfe8c2', 'center');
      G.outlinedText(ctx, this.diff.label, 1130, 88, 15, this.diff.color, 'center');
      // combo
      if (this.combo >= 2) {
        const mult = this.multiplier();
        const a = clamp(this.comboT / 4, 0, 1);
        G.outlinedText(ctx, `STREAK x${mult}`, 640, 40, 26, mult >= 2 ? '#ffd23f' : '#e8e8e8');
        ctx.fillStyle = `rgba(255,210,63,${a})`;
        ctx.fillRect(640 - 60 * a, 58, 120 * a, 4);
      }
      // ammo icons (bottom-left): 8 per row, up to 15 shells forged
      for (let i = 0; i < IRON_MAX; i++) {
        const col = i % 8, row = Math.floor(i / 8);
        const x = 46 + col * 36, y = 650 + row * 34;
        ctx.save();
        ctx.globalAlpha = i < this.ammo ? 1 : 0.18;
        ctx.translate(x, y);
        G.Sprites.drawMelon(ctx, 13, 0, true, 0);
        ctx.restore();
      }
      G.outlinedText(ctx, 'IRON', 46, 618, 15, '#cfe8c2', 'left');
      G.outlinedText(ctx, `×${this.ammo}`, 46 + 7 * 36 + 26, 684, 22, '#ffe9a0', 'left');
      // power bar while charging: ramp up, DWELL at max (0.5s), reset to 0
      if (p.charging) {
        const B = G.Board;
        const bx = pultRailX(p.row) + 64 * B.scale(p.row);
        const by = B.laneY[p.row] - 170 * B.scale(p.row);
        const bw = 20, bh = 150 * B.scale(p.row);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRectPath(ctx, bx - 3, by - 3, bw + 6, bh + 6, 6); ctx.fill();
        const atMax = p.charge >= 1;
        const fh = bh * p.charge;
        const grad = ctx.createLinearGradient(0, by + bh, 0, by);
        grad.addColorStop(0, '#7ddc5f'); grad.addColorStop(0.6, '#ffd23f'); grad.addColorStop(1, '#ff5030');
        ctx.fillStyle = grad;
        roundRectPath(ctx, bx, by + bh - fh, bw, fh, 4); ctx.fill();
        // MAX line — the top of the ramp. While dwelling, the whole bar
        // pulses white so the 0.5s grace window reads as a beat, not a bug.
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - 4, by + 1, bw + 8, 2);
        G.outlinedText(ctx, 'MAX', bx + bw + 12, by + 3, 9, '#ffffff', 'left');
        ctx.globalAlpha = 1;
        if (atMax) {
          ctx.globalAlpha = 0.45 + 0.4 * Math.sin(performance.now() / 60);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx, by + bh - fh, bw, fh);
          ctx.globalAlpha = 1;
          G.outlinedText(ctx, 'MAX!', bx + bw / 2, by - 14, 14, '#ffffff');
        } else if (p.chargeTopGlow > 0) {
          ctx.globalAlpha = p.chargeTopGlow;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx, by + bh - fh, bw, 2);
          ctx.globalAlpha = 1;
        }
        // current launch ANGLE readout — set by aim, not power. Green once the
        // 45° gate is passed, bright while the STRONG window is fully open.
        const inWin = this.strongWindow();
        const over45 = this.aimThetaDeg() > G.STRONG_ANGLE;
        G.outlinedText(ctx, `${Math.round(this.aimThetaDeg())}°`, bx + bw / 2, by + bh + 16, 15,
          inWin ? '#eaffb0' : over45 ? '#b9ff2e' : '#ffe9a0');
        // HIGH ARC marker — the minimal charge whose speed crests highArcH()
        // at the CURRENT aim angle; hidden when even a full bar can't get there.
        const fNeeded = this.highArcChargeFor(this.aimThetaDeg());
        if (fNeeded != null) {
          const myy = by + bh - bh * fNeeded;
          // THE WINDOW, MADE VISIBLE: a DARK window with a bright border —
          // reads against every hue the fill gradient can be
          ctx.fillStyle = 'rgba(12,20,12,0.45)';
          ctx.fillRect(bx, myy, bw, (by + bh) - myy);
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(bx - 1.5, myy - 1.5, bw + 3, (by + bh) - myy + 3);
          ctx.setLineDash([]);
          G.outlinedText(ctx, 'STRONG', bx - 6, myy + ((by + bh) - myy) / 2, 8, '#b9ff2e', 'right');
          // the part of the FILL that is inside the band turns lime: the
          // gauge itself announces the strong zone
          if (fh > (by + bh) - myy) {
            ctx.fillStyle = 'rgba(185,255,46,0.6)';
            ctx.fillRect(bx, myy, bw, Math.min(fh, bh) - ((by + bh) - myy));
          }
          // while the STRONG window is open the marker steps BACK — the glowing
          // melon must be the brightest thing in the charge zone
          ctx.globalAlpha = this.strongWindow() ? 0.35 : 1;
          ctx.strokeStyle = '#b9ff2e'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(bx - 8, myy); ctx.lineTo(bx + bw + 8, myy); ctx.stroke();
          G.outlinedText(ctx, 'HIGH ARC', bx + bw + 12, myy, 12, '#b9ff2e', 'left');
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
      // tip line (first stage)
      if (this.stage === 1 && this.wave === 1) {
        ctx.save();
        ctx.globalAlpha = clamp(12 - this.bannerT * 0.5, 0, 1) * 0.85;
        G.outlinedText(ctx, 'Hold LMB — power ramps, dwells at MAX, then restarts · HIGH ARC = x2', 640, 142, 18, '#ffffff');
        ctx.restore();
      }
    }
    /* ================= BOSS HUD =================
       The boss has no health bar — he has ARMOUR, and the armour is the whole
       fight. So the panel shows the live phase and exactly two tracks: the
       hits-countdown for this phase, and the high-arc shortcut. Only the live
       phase is lit, so the player always knows what to hit next. */
    drawBossBars(ctx) {
      const z = this.zombies.find(q => q.isBoss && !q.dead && q.state !== 'die' && q.state !== 'glorydie');
      if (!z) return;
      const bd = z.spec.boss;
      const phase = z.bossPhase;
      // BOTTOM-CENTRE, not top: he is a tall figure in the near lanes and a
      // top panel would sit exactly where his cap is.
      const W = 600, X = 344, Y = 612, H = 98;
      const accent = phase === 'BARE' ? '#ff5555' : phase === 'TOUPEE' ? '#ffe9a0' : '#ff8080';

      let bigN, bigLeft, bigLbl, bigCol;
      if (phase === 'CAP') { bigN = bd.magaHits; bigLeft = bigN - z.magaHits; bigLbl = 'CAP'; bigCol = '#ff8080'; }
      else if (phase === 'TOUPEE') { bigN = bd.toupeeHigh; bigLeft = bigN - z.toupeeHigh; bigLbl = 'RUG'; bigCol = '#ffe9a0'; }
      else { bigN = bd.bodyHits; bigLeft = bigN - z.bodyHits; bigLbl = 'BODY'; bigCol = '#ff9e3d'; }
      const hiN = phase === 'CAP' ? bd.magaHigh : phase === 'TOUPEE' ? bd.toupeeHigh : bd.bodyHigh;
      const hiLeft = phase === 'CAP' ? hiN - z.magaHigh : phase === 'TOUPEE' ? hiN - z.toupeeHigh : hiN - z.bodyHigh;
      const onlyHigh = phase === 'TOUPEE';

      ctx.save();
      ctx.fillStyle = 'rgba(10,8,6,0.76)';
      roundRectPath(ctx, X, Y, W, H, 12); ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 3;
      roundRectPath(ctx, X, Y, W, H, 12); ctx.stroke();
      G.outlinedText(ctx, bd.name, X + 18, Y + 22, 22, '#ffd23f', 'left');
      G.outlinedText(ctx, phase === 'CAP' ? 'PHASE 1 · KNOCK THE CAP OFF'
        : phase === 'TOUPEE' ? 'PHASE 2 · RIP THE RUG — HIGH ARCS ONLY'
          : 'PHASE 3 · HE IS EXPOSED', X + W - 18, Y + 22, 14,
        phase === 'TOUPEE' ? '#b9ff2e' : '#cfe8c2', 'right');

      // ---- hits track (hidden while flat hits do nothing, i.e. the rug phase)
      let cy = Y + 38;
      if (!onlyHigh) {
        // auto-fit: the fight is 40 pips deep now — shrink pips and gap until
        // the row plus its countdown label still lives inside the 600px panel
        const avail = W - 36 - 112;
        let cw, gx;
        if (bigN <= 6) { cw = 44; gx = 6; }
        else if (bigN * 36 - 6 <= avail) { cw = 30; gx = 6; }   // the proven look, when it fits
        else { gx = 2; cw = Math.max(7, Math.min(30, Math.floor(avail / bigN) - gx)); }
        for (let i = 0; i < bigN; i++) {
          const on = i < bigLeft;
          ctx.globalAlpha = on ? 1 : 0.16;
          ctx.fillStyle = on ? bigCol : '#ffffff';
          roundRectPath(ctx, X + 18 + i * (cw + gx), cy, cw, 16, 4); ctx.fill();
          ctx.globalAlpha = 1;
        }
        const rowW = bigN * (cw + gx) - gx;
        G.outlinedText(ctx, `${bigLbl} ${Math.max(0, bigLeft)} LEFT`, X + 18 + rowW + 16, cy + 8, 15, '#cfe8c2', 'left');
        cy += 26;
      }

      // ---- high-arc track: chevrons, the game's shorthand for "arc it".
      //      12 chevrons must also fit — same auto-fit as the pips above.
      const chevLabel = onlyHigh ? 'HIGH ARCS TO STRIP IT' : `HIGH ARC ×${Math.max(0, hiLeft)}`;
      const avail2 = W - 36 - (chevLabel.length * 9 + 26);
      const unit2 = Math.min(onlyHigh ? 70 : 54, Math.floor(avail2 / Math.max(1, hiN)));
      const hw2 = Math.max(18, unit2 - 8), hh = onlyHigh ? 26 : 20;
      for (let i = 0; i < hiN; i++) {
        const on = i < hiLeft;
        ctx.globalAlpha = on ? 1 : 0.16;
        ctx.fillStyle = on ? '#b9ff2e' : '#ffffff';
        const bx = X + 18 + i * (hw2 + 8), by = cy;
        ctx.beginPath();
        ctx.moveTo(bx + hw2 / 2, by); ctx.lineTo(bx + hw2, by + hh / 2);
        ctx.lineTo(bx + hw2 / 2, by + hh); ctx.lineTo(bx, by + hh / 2);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      G.outlinedText(ctx, chevLabel,
        X + 18 + hiN * (hw2 + 8) + 10, cy + hh / 2 + 1, 15, '#b9ff2e', 'left');
      ctx.restore();
    }
    /* ================= STAGE PROGRESS =================
       The PvZ flag bar, bottom-right: a dark track, one flag planted per
       wave, the last flag red and capped because that wave is The Don.
       Fill advances one segment per cleared wave; during the boss wave the
       final segment fills WITH the fight itself — cap, then rug, then body
       — so "how much is left" reads true all the way to his last hit. */
    drawStageMeter(ctx) {
      const waves = this.wavesForStage(this.stage);
      const bossStage = this.bossStage(this.stage);
      const X = 964, Y = 650, W = 276, H = 16;
      const w = Math.min(this.wave, waves);

      // base fill: fully cleared waves …
      let frac = (w - 1) / waves;
      // … and on the boss wave the last segment IS the fight
      const boss = this.zombies.find(q => q.isBoss && !q.dead && q.state !== 'die' && q.state !== 'glorydie');
      const bossLive = !!(boss && this.wave >= waves);
      if (bossLive) {
        const bd = boss.spec.boss;
        let ph, pf;
        if (bd.maga && boss.magaOn) { ph = 0; pf = clamp(boss.magaHits / bd.magaHits, 0, 1); }
        else if (boss.toupeeOn) { ph = bd.maga ? 1 : 0; pf = clamp(boss.toupeeHigh / bd.toupeeHigh, 0, 1); }
        else { ph = bd.maga ? 2 : 1; pf = clamp(boss.bodyHits / bd.bodyHits, 0, 1); }
        const phases = bd.maga ? 3 : 2;
        frac = (w - 1 + (ph + pf) / phases) / waves;
      }
      frac = clamp(frac, 0, 1);

      ctx.save();
      // track
      ctx.fillStyle = 'rgba(10,8,6,0.78)';
      roundRectPath(ctx, X, Y, W, H, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(207,232,194,0.4)'; ctx.lineWidth = 2;
      roundRectPath(ctx, X, Y, W, H, 8); ctx.stroke();
      // fill — same green ramp as the charge bar, so "fuller = closer" is a
      // colour the player already knows
      const fw = (W - 6) * frac;
      if (fw > 2) {
        const grad = ctx.createLinearGradient(X, 0, X + W, 0);
        grad.addColorStop(0, '#7ddc5f'); grad.addColorStop(1, '#b9ff2e');
        ctx.fillStyle = grad;
        roundRectPath(ctx, X + 3, Y + 3, fw, H - 6, 5); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(X + 3 + fw - 2, Y + 3, 2, H - 6);
      }
      // one flag per wave, planted ON the track — passed flags light up
      for (let i = 1; i <= waves; i++) {
        const fx = X + 3 + (W - 6) * (i / waves);
        const passed = frac >= i / waves - 0.0015;
        const isBoss = bossStage && i === waves;
        ctx.save();
        ctx.translate(fx, Y);
        ctx.strokeStyle = passed ? '#e8e8d8' : '#7a7f74';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, H + 2); ctx.stroke();
        ctx.fillStyle = isBoss ? (passed ? '#ff5555' : '#a03c3c')
          : passed ? '#b9ff2e' : '#6f7a68';
        ctx.beginPath();
        ctx.moveTo(0, -14); ctx.lineTo(isBoss ? 15 : 11, isBoss ? -9.5 : -10); ctx.lineTo(0, -5);
        ctx.closePath(); ctx.fill();
        if (isBoss) { ctx.fillRect(0, -5.5, 8, 2); }   // the cap brim
        ctx.restore();
      }
      // captions: what this bar is, and exactly how much is left
      G.outlinedText(ctx, 'STAGE PROGRESS', X + 2, Y + H + 16, 11, '#9fd6a8', 'left');
      const left = waves - (w - 1);
      const onBoss = bossLive || (this.wave >= waves && bossStage);
      G.outlinedText(ctx, onBoss ? (boss ? 'THE DON!' : 'FINAL WAVE!') : `${left} WAVE${left === 1 ? '' : 'S'} LEFT`,
        X + W, Y + H + 16, 12, onBoss ? '#ff8080' : '#ffe9a0', 'right');
      ctx.restore();
    }

    drawBanner(ctx) {
      const k = this.bannerT;
      let a = 1, off = 0;
      if (k < 0.25) { a = k / 0.25; off = (1 - a) * -60; }
      else if (k > 1.9) { a = clamp((2.4 - k) / 0.5, 0, 1); off = (1 - a) * 60; }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(640 + off, 200);
      // story line rides under the wave headline — the panel grows for it
      const sub = this.bannerSub;
      const ph = sub ? 104 : 72;
      ctx.fillStyle = 'rgba(14,20,12,0.88)';
      roundRectPath(ctx, -280, -ph / 2, 560, ph, 14); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.5;
      roundRectPath(ctx, -280, -ph / 2, 560, ph, 14); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 7;
      roundRectPath(ctx, -286, -ph / 2 - 6, 572, ph + 12, 17); ctx.stroke();
      G.outlinedText(ctx, this.banner, 0, sub ? -14 : 0, 36, '#ffe9a0');
      if (sub) G.outlinedText(ctx, sub, 0, 26, 16, '#cfe8c2');
      ctx.restore();
    }
    drawMenu(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.55)';
      ctx.fillRect(0, 0, 1280, 720);
      const bob = Math.sin(this.menuT * 2) * 8;
      G.outlinedText(ctx, 'MELON MAYHEM', 640, 108 + bob, 76, '#8ee05c', 'center', '#1a2a10', 14);
      G.outlinedText(ctx, 'GARDEN ARTILLERY DEFENSE', 640, 162 + bob * 0.5, 24, '#ffe9a0');
      // difficulty picker
      G.outlinedText(ctx, 'CHOOSE YOUR DEFENSE', 640, 252, 20, '#cfe8c2');
      for (const b of this.diffButtons()) {
        const D = G.DIFFS[b.key];
        const sel = this.diffKey === b.key;
        ctx.save();
        ctx.globalAlpha = sel ? 1 : 0.6;
        ctx.fillStyle = sel ? 'rgba(22,34,18,0.92)' : 'rgba(14,20,12,0.7)';
        roundRectPath(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
        ctx.strokeStyle = sel ? D.color : 'rgba(207,232,194,0.45)';
        ctx.lineWidth = sel ? 3.5 : 2;
        roundRectPath(ctx, b.x, b.y, b.w, b.h, 12); ctx.stroke();
        G.outlinedText(ctx, D.label, b.x + b.w / 2, b.y + 24, 21, sel ? D.color : '#cfe8c2');
        G.outlinedText(ctx, b.key === 'veryeasy' ? 'few & slow' : b.key === 'hard' ? 'many & fast' : 'the garden war', b.x + b.w / 2, b.y + 46, 13, '#9fd6a8');
        ctx.restore();
      }
      // preview: idle pult + zombie (2D mode; 3D shows the live scene instead)
      if (!G.IS3D) {
      ctx.save();
      ctx.translate(430, 655);
      ctx.scale(1.1, 1.1);
      G.Sprites.drawPult(ctx, { squash: Math.sin(this.menuT * 2.2) * 0.04, armAng: -0.55, holding: true, charge: 0 });
      ctx.restore();
      ctx.save();
      ctx.translate(850, 655);
      ctx.scale(1.1, 1.1);
      G.Sprites.drawZombie(ctx, { pose: 'hold', walkPhase: 0, seed: 3, hitFlash: 0, shield: false, helmet: true, dents: 0, dieT: 0, type: 'shambler', kneelTimer: 0 }, this.menuT);
      ctx.restore();
      }
      const pulse = 0.75 + Math.sin(this.menuT * 4) * 0.25;
      ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'CLICK TO DEFEND YOUR BRAIN', 640, 408, 28, '#ffffff');
      ctx.globalAlpha = 1;
      G.outlinedText(ctx, 'Hold LMB — power climbs, parks at MAX for half a beat, then restarts · release to lob', 640, 462, 16, '#cfe8c2');
      G.outlinedText(ctx, 'Mouse X sets the angle 10°–80° · ground ring = landing spot · HIGH ARC = x2 · RMB iron shell · glory kills forge iron', 640, 488, 16, '#cfe8c2');
      G.outlinedText(ctx, '1 / 2 / 3 difficulty · W/S hop lanes · P pause · M mute · R restart', 640, 514, 15, '#9fd6a8');
      G.outlinedText(ctx, G.SHORT
        ? 'SHORT GAME — 2 stages, a Don in each  ·  add ?short=0 for the FULL 5-stage campaign'
        : 'THE FULL CAMPAIGN — 5 stages, two Don fights  ·  ?short=1 for the short game', 640, 540, 14, '#ffd23f');
      ctx.restore();
    }
    /* ================= CELEBRATION SCREENS =================
       Stage 2: daylight fireworks, congratulation, and a shove toward 5.
       Stage 5 — the final boss: the PARADE crosses first (horde herded out
       with the pult chasing, then the chase reversed), and once the screen
       is empty the night sky falls, the fireworks double, and the finale
       copy is spelled out: CONGRATULATIONS — a dealt-fresh send-off line —
       THE END. */
    drawStageClear(ctx) {
      const cel = this.celebration;
      const finale = !!(cel && cel.finale);

      // ---- the Don's last words + the swallow, over the living field
      if (cel && cel.phase === 'fall' && this.donFall) {
        this.drawDonFall(ctx);
        return;
      }

      // ---- the good-riddance card: the ground has shut, the Don is cooked
      if (finale && cel.phase === 'seeya') {
        this.drawSeeya(ctx);
        return;
      }

      // ---- the parade plays over the living field, nothing veils it
      if (finale && this.parade && !this.parade.done) {
        this.drawParade(ctx);
        return;
      }
      // ---- the ROAST: scrolling neighborhood report while the sky burns.
      //      The send-off and the grand finale play over the tail of the scroll.
      if (finale && (cel.phase === 'roast' || cel.phase === 'fwshow' || cel.phase === 'fwfinal')) {
        this.drawRoast(ctx);
        return;
      }
      // ---- the CALM: the show has cooled — just the night, and the paper
      if (finale && cel.phase === 'confetti') {
        this.drawNightSky(ctx);
        ctx.save();
        ctx.fillStyle = 'rgba(4,6,18,0.30)';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.restore();
        return;
      }

      if (finale) {
        this.drawNightSky(ctx);
        ctx.save();
        ctx.fillStyle = 'rgba(4,6,18,0.30)';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.restore();

        const EC = this.endCopy();
        G.outlinedText(ctx, 'CONGRATULATIONS', 640, 116, 50, '#ffd23f', 'center', '#04060f', 8);
        G.outlinedText(ctx, EC.head, 640, 160, 21, '#b9ff2e', 'center', '#04060f', 6);
        const te = 0.82 + Math.sin(performance.now() / 320) * 0.18;   // THE END breathes
        ctx.save(); ctx.globalAlpha = te;
        G.outlinedText(ctx, 'THE  END', 640, 272, 96, '#ffffff', 'center', '#1a2a10', 14);
        ctx.restore();

        G.outlinedText(ctx, `FINAL SCORE  ${this.score}`, 640, 366, 34, '#ffffff');
        G.outlinedText(ctx, `HIGH SCORE  ${this.highScore}`, 640, 408, 24, '#ffd23f');
        G.outlinedText(ctx, `GLORY KILLS  ${this.stageStats.glory}   ·   KILLS  ${this.stageStats.kills}`, 640, 446, 20, '#cfe8c2');
        G.outlinedText(ctx, G.SHORT
          ? 'Two stages. Two Dons. Zero brains lost.'
          : 'Five stages. Nine kinds of undead. Two Dons. Your brain: still yours.', 640, 492, 22, '#ff9e3d');
        G.outlinedText(ctx, EC.quip, 640, 526, 20, '#b9ff2e', 'center', '#04060f', 5);
        G.outlinedText(ctx, EC.thanks, 640, 558, 24, '#f4f2e6');
        const pulse = 0.7 + Math.sin(performance.now() / 250) * 0.3;
        ctx.save(); ctx.globalAlpha = pulse;
        G.outlinedText(ctx, 'ENTER — BACK TO THE MENU  ·  R — REPLAY THE FINALE', 640, 664, 24, '#ffd23f');
        ctx.restore();
        return;
      }

      // ---- every other stage: the honest version — who really fell, and
      //      what (exactly) comes next. In SHORT mode the only clear screen
      //      before the finale is stage 1 — where the first Don just fell.
      const S = this.stage;
      const donDown = G.SHORT ? S === 1 : S === 2;
      const SUB = G.SHORT ? {
        1: 'The plain Don is down — but a red cap glints on the far ridge.',
      } : {
        1: 'The lawn held. But out west, something BIG is stomping this way.',
        2: 'Rug in the compost, pride in the dirt.',
        3: 'Masterless and thinner — but the garden is not yours yet.',
        4: 'A red cap glints on the far ridge. Rest while you can.',
      };
      const NEXT = G.SHORT ? {
        1: 'NEXT — STAGE 2 · THE FINAL WAVE',
      } : {
        1: 'NEXT — STAGE 2 · THE DON COMES',
        2: 'NEXT — STAGE 3 · NO MASTER, NO MERCY',
        3: 'NEXT — STAGE 4 · THE SHADOW GROWS',
        4: 'NEXT — STAGE 5 · THE FINAL WAVE',
      };
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.58)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, `STAGE ${S} CLEAR!`, 640, 206, 62, '#b9ff2e', 'center', '#1a2a10', 12);
      if (donDown) G.outlinedText(ctx, 'THE DON IS DOWN!', 640, 262, 34, '#ff9e3d');
      G.outlinedText(ctx, SUB[S] || '', 640, donDown ? 314 : 296, 22, '#cfe8c2');
      G.outlinedText(ctx, `BONUS +${this.stageBonus || 0}`, 640, 362, 26, '#ffe9a0');
      G.outlinedText(ctx, `SCORE ${this.score}   ·   HI ${this.highScore}`, 640, 400, 22, '#ffffff');
      G.outlinedText(ctx, NEXT[S] || `NEXT — STAGE ${S + 1}`, 640, 456, 24, '#ff8080');
      if (S === 4) G.outlinedText(ctx, 'Twelve high arcs take the cap. Twelve more take the rug. Then forty clean hits.', 640, 490, 17, '#cfe8c2');
      const pulse = 0.7 + Math.sin(performance.now() / 250) * 0.3;
      ctx.save(); ctx.globalAlpha = pulse;
      G.outlinedText(ctx, `PRESS ENTER — ON TO STAGE ${S + 1}`, 640, 540, 28, '#ffd23f');
      ctx.restore();
      ctx.restore();
    }
    /* The good-riddance card. The hole has shut over the Don, and the lawn
       takes ten unhurried seconds to say what everybody is thinking: the
       cooking term, the kicker, the sneer and the big goodbye are all rolled
       fresh off the banks every run — and only then does the chase start.
       Embers keep drifting up off the sealed seam, because the lawn is not
       done being smug about it. */
    drawSeeya(ctx) {
      const s = this.celebration.seeya || {
        term: 'COOKED', sub: SEEYA_SUBS[0],
        kicker: SEEYA_KICKERS[0], bye: SEEYA_BYES[0],
      };
      const now = performance.now() / 1000;
      this.drawNightSky(ctx);
      ctx.save();
      ctx.fillStyle = 'rgba(4,6,18,0.30)';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.restore();
      // embers off the sealed hole, drifting up through the card
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        const sd = i * 97.31;
        const ex = 120 + ((sd * 13.77) % 1040);
        const spd = 24 + (sd % 26);
        const ey = 660 - ((now * spd + sd * 37) % 600);
        const tw = 0.5 + Math.sin(now * (3 + (sd % 5)) + sd) * 0.5;
        ctx.globalAlpha = 0.28 + tw * 0.45;
        ctx.fillStyle = i % 3 ? '#ff9a3c' : '#ffe9a0';
        ctx.beginPath(); ctx.arc(ex, ey, 1.6 + (sd % 2), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      G.outlinedText(ctx, s.kicker, 640, 196, 18, '#8a9384');
      const flick = 0.88 + Math.sin(now * 21) * 0.06 + Math.sin(now * 7.3) * 0.06;
      ctx.save(); ctx.globalAlpha = flick;
      G.outlinedText(ctx, `THE DON IS ${s.term}.`, 640, 278, 58, '#ff8040', 'center', '#1a0a05', 14);
      ctx.restore();
      G.outlinedText(ctx, s.sub, 640, 348, 24, '#cfe8c2');
      // the big goodbye: shrinks to stay inside the card on the longer ones
      G.outlinedText(ctx, s.bye, 640, 432, s.bye.length > 32 ? 36 : 46, '#ffd23f', 'center', '#241004', 11);
      const pulse = 0.55 + Math.sin(performance.now() / 240) * 0.25;
      ctx.save(); ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'ENTER — LET THE CHASE BEGIN', 640, 694, 15, '#cfe8c2');
      ctx.restore();
    }
    /* The parade itself. 2D: the sprite painters march over the live field
       (the same layer the fireworks use). 3D: real rigs chase on the lawn
       (render3d.paradeSync drives them; the BOARD pult is hidden for the
       whole parade) and the canvas overlay adds only caption + bubble. */
    drawParade(ctx) {
      const P = this.parade;
      const time = performance.now() / 1000;
      const N = P.cast.length;
      const is3d = G.IS3D && !!G.R3.parade3d;
      let psx = 0, psy = 0;
      if (!is3d) {
        const GY = 648;
        for (let i = 0; i < N; i++) {
          const c = P.cast[i];
          const zx = P.leg === 1 ? P.px - i * P.gap : P.px + (i + 1) * P.gap;
          // leg 1 marches right (sprites face left natively → flip); leg 2 is native
          const dir = P.leg === 1 ? -1 : 1;
          ctx.save();
          ctx.translate(zx, GY);
          ctx.scale(dir, 1);
          G.Sprites.drawZombie(ctx, {
            pose: 'walk', walkPhase: c.phase, seed: c.seed, hitFlash: 0,
            shield: false, helmet: c.helmet, dents: 0, dieT: 0, type: c.type, kneelTimer: 0,
          }, time);
          ctx.restore();
        }
        // the pult — chasing in leg 1, fleeing in leg 2 (the outsider of the line)
        psx = P.leg === 1 ? P.px - N * P.gap : P.px;
        psy = GY - Math.abs(Math.sin(time * 9)) * 7;
        ctx.save();
        ctx.translate(psx, psy);
        ctx.scale(P.leg === 1 ? 1 : -1, 1);
        G.Sprites.drawPult(ctx, { squash: 0.05 + Math.sin(time * 9) * 0.04, armAng: -0.95 + Math.sin(time * 6) * 0.3, holding: true, charge: 0 });
        ctx.restore();
      } else {
        // the rigs play on the lawn — anchor the overlay on the chase pult
        const u = px => 5 + (px - 640) / 100;
        const pu = u(P.leg === 1 ? P.px - N * P.gap : P.px);
        const a = G.R3.paradeAnchor(pu, 2);
        psx = a.x; psy = a.y;
      }
      // ---- the pult's thought bubble: being chased deserves an "!"
      if (P.leg === 2) {
        const bx = psx, by = psy - (is3d ? 150 : 118);
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.strokeStyle = 'rgba(20,24,18,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(bx, by, 30, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (const [dx, dy, r] of [[17, 33, 7], [9, 50, 4.5]]) {
          ctx.beginPath(); ctx.arc(bx + dx, by + dy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        G.outlinedText(ctx, '!', bx, by + 16, 46, '#e03030', 'center', '#ffffff', 5);
        ctx.restore();
      }
      // ---- caption (the 3-second regroup gets a countdown)
      const cap = P.leg === 1 ? 'THE UNDEAD PARADE — HERDED OUT OF THE GARDEN'
        : P.leg === 1.5 ? `THE PARADE REGROUPS… ${Math.ceil(Math.max(0, P.pauseT))}`
        : '…AND NOW THE PULT IS BEING CHASED BACK';
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(14,20,12,0.8)';
      roundRectPath(ctx, 310, 36, 660, 54, 12); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5;
      roundRectPath(ctx, 310, 36, 660, 54, 12); ctx.stroke();
      G.outlinedText(ctx, cap, 640, 70, 21, '#ffe9a0');
      ctx.restore();
      const pulse = 0.55 + Math.sin(performance.now() / 240) * 0.25;
      ctx.save(); ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'ENTER — SKIP TO THE FIREWORKS', 640, 694, 15, '#cfe8c2');
      ctx.restore();
    }
    /* ================= THE ROAST =================
       After the chase: the neighborhood report scrolls up the burning sky —
       epic, funny, and utterly without mercy. The copy is DEALT FRESH from
       the taunt banks every run: a status, five sections, a verdict lead-in,
       two aftermath lines — with exactly two constants, the YOU ARE FIRED.
       verdict and the pult’s sign-off at the very end. */
    roastLines() {
      if (!this._roastLines) this._roastLines = buildRoastLines();
      return this._roastLines;
    }
    /* The end screen’s copy — the frame is fixed (CONGRATULATIONS … THE
       END) but the headline, the quip and the sign-off are dealt fresh off
       the banks once per run and cached here, so the screen never flickers
       between variants mid-read. */
    endCopy() {
      if (!this._endCopy) {
        this._endCopy = {
          head: pick(END_HEADS),
          quip: pick(END_QUIPS),
          thanks: pick(END_THANKS),
        };
      }
      return this._endCopy;
    }
    /* The verdict line needs a taller slot than the report's 54px column
       pitch — 76px of calligraphy would crowd its neighbours to death. */
    roastSlot(ln) { return ln[0] === FIRED_TXT ? 116 : 54; }
    roastSpan() { return 760 + this.roastLines().reduce((a, ln) => a + this.roastSlot(ln), 0) + 160; }
    /* screen y of the report's bottom edge right now — it scrolls upward */
    roastBottomY() {
      const L = this.roastLines();
      let total = 0;
      for (const ln of L) total += this.roastSlot(ln);
      return 780 + total - this.roastSlot(L[L.length - 1]) + 40 - this.celebration.roastT;
    }
    /* ---- the SEND-OFF: the report has been read, so the sky answers.
       Ten and a half seconds of saturated fireworks — volleys stacking,
       two-tone crowns, two huge mega breaks — then the GRAND FINALE takes
       over for ten more seconds before the paper rain. */
    startFwShow() {
      const cel = this.celebration;
      cel.phase = 'fwshow';
      cel.fwT = 0; cel.volleyT = 0.1; cel.megaT = 2.6;
      G.Audio.fanfare(true);
    }
    updateFwShow(rawDt) {
      const cel = this.celebration;
      const SHOW_T = 10.5;
      cel.fwT += rawDt;
      const p = cel.fwT / SHOW_T;
      const peak = p >= 0.24 && p < 0.7;
      cel.volleyT -= rawDt;
      if (cel.volleyT <= 0 && p < 0.88) {
        // build → SATURATE → calm: volleys of 2, then 5 at once, then singles
        cel.volleyT = (peak ? 0.15 : 0.52) * rand(0.8, 1.25);
        const n = peak ? 5 : 2;
        for (let i = 0; i < n; i++) this.launchShell(true, true);
      }
      if (peak && cel.fwT >= cel.megaT) {
        cel.megaT = cel.fwT + 2.8;
        this.megaShell();
        this.camera.hitFlash(0.2, '#fff2c0');
      }
      if (cel.fwT >= SHOW_T) this.startFwFinal();
    }
    /* ---- the GRAND FINALE: fifteen seconds, in two halves.
       First five: an ORGANIZED sequence — every shell placed on a score
       (waves marching across the sky, mirrored crossfire angling in from
       the edges, a peacock fan, a row of perfect rings, one salvo of every
       burst look at once), each beat with its own coloured light.
       Then TEN seconds of saturation: the first five ramp the intensity and
       density up without mercy — the volley interval collapses from 0.42 s
       to 0.07 s, the volleys grow from two shells to ten, every burst look
       mixes in at every size, named mega crowns land faster and faster —
       and the last five hold EXTREME: volleys of up to fourteen shells
       every ~0.05 s, nearly all of them big, angled hard, breaking all over
       the sky, with an organized ENCORE scored underneath the chaos — tight
       steep crossfire, a double ring row, an oversized all-looks salvo and
       an inverted peacock — until THE CLOSER fires everything at once under
       a full white-out and the whole skyline saturates. */
    startFwFinal() {
      const cel = this.celebration;
      cel.phase = 'fwfinal';
      cel.fwT = 0; cel.volleyT = 0.35; cel.megaT = 6.0; cel.closerDone = false;
      this.fwQueue = [];
      this.buildFwPattern();
      G.Audio.fanfare(true);
    }
    /* the first half, scored beat by beat. Entries are {t, fn} on the phase
       clock and are fired by updateFwFinal. */
    buildFwPattern() {
      const C = { gold: '#ffd23f', ice: '#6ef0ff', pink: '#ff5ea8', lime: '#b9ff2e', violet: '#c58bff', white: '#ffffff', orange: '#ff9c40' };
      const Q = (t, fn) => this.fwQueue.push({ t, fn });
      // 1 · the GOLD WAVE — six peonies marching left → right, scattered
      //     through the middle band so even the organized half fills the sky
      for (let i = 0; i < 6; i++) {
        Q(0.15 + i * 0.11, () => {
          this.shellAt({ x: 170 + i * 188, y: rand(110, 300), color: C.gold });
          this.camera.hitFlash(0.09, '#ffe9a0'); this.camera.kick(4);
        });
      }
      // 2 · the ICE WAVE marches back — perfect rings this time
      for (let i = 0; i < 6; i++) {
        Q(0.95 + i * 0.11, () => {
          this.shellAt({ x: 1110 - i * 188, y: rand(110, 300), color: C.ice, style: 'ring' });
          this.camera.hitFlash(0.09, '#cfe8ff'); this.camera.kick(4);
        });
      }
      // 3 · CROSSFIRE — mirrored two-tone bigs angling in from the edges
      for (let i = 0; i < 3; i++) {
        const y = 120 + i * 55;
        Q(1.85 + i * 0.28, () => {
          this.shellAt({ x: 90, y, color: C.pink, col2: C.white, big: true, vx: 190 });
          this.shellAt({ x: 1190, y, color: C.lime, col2: C.white, big: true, vx: -190 });
          this.camera.kick(5);
        });
      }
      // 4 · the PEACOCK — five shells fanning out of the middle, rainbow order
      const rainbow = [C.gold, C.orange, C.pink, C.violet, C.ice];
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        Q(2.85 + Math.abs(k) * 0.06, () =>
          this.shellAt({ x: 640 + k * 105, y: 100 + Math.abs(k) * 46, color: rainbow[i], vx: k * 95, style: i % 2 ? 'palm' : 'peony' }));
      }
      // 5 · the RING ROW — three perfect circles on one line, a white-and-gold
      //     crown blooming over the centre a beat later
      Q(3.7, () => {
        for (const x of [320, 640, 960]) this.shellAt({ x, y: 190, color: C.violet, style: 'ring' });
      });
      Q(3.95, () => this.shellAt({ x: 640, y: 84, color: C.white, big: true, col2: C.gold }));
      // 6 · the SALVO — every look at once, mirrored, and the lights come up
      Q(4.45, () => {
        const looks = ['peony', 'ring', 'willow', 'palm', 'crossette'];
        const cols = [C.gold, C.ice, C.orange, C.pink, C.lime];
        looks.forEach((st, i) => {
          this.shellAt({ x: 250 + i * 195, y: rand(90, 150), color: cols[i], style: st });
          this.shellAt({ x: 1030 - i * 195, y: rand(90, 150), color: cols[4 - i], style: st });
        });
        this.camera.hitFlash(0.16, '#ffe9b0');
      });
      /* ---- the EXTREME ENCORE — the extra five seconds of saturation keep
         a spine of organized beats under the chaos: different angles, sizes
         and patterns, all oversized. ---- */
      // 7 · tight LOW crossfire, twice the angle, big two-tones
      for (let i = 0; i < 3; i++) {
        const y = 90 + i * 70;
        Q(10.55 + i * 0.24, () => {
          this.shellAt({ x: 60, y, color: i % 2 ? C.ice : C.gold, col2: C.pink, big: true, vx: 260 });
          this.shellAt({ x: 1220, y, color: i % 2 ? C.violet : C.lime, col2: C.white, big: true, vx: -260 });
          this.camera.kick(6);
        });
      }
      // 8 · the DOUBLE RING ROW — five rings on two heights, one gold crown
      Q(11.35, () => {
        for (const [xx, yy] of [[210, 150], [425, 220], [640, 150], [855, 220], [1070, 150]])
          this.shellAt({ x: xx, y: yy, color: C.ice, style: 'ring' });
      });
      Q(11.55, () => this.shellAt({ x: 640, y: 80, color: C.gold, big: true, col2: C.violet }));
      // 9 · the BIG SALVO — every look at once, oversized, mirrored
      Q(12.15, () => {
        const looks = ['peony', 'ring', 'willow', 'palm', 'crossette'];
        const cols = [C.pink, C.gold, C.ice, C.lime, C.violet];
        looks.forEach((st, i) => {
          this.shellAt({ x: 190 + i * 225, y: rand(80, 140), color: cols[i], style: st, big: true });
          this.shellAt({ x: 1090 - i * 225, y: rand(80, 140), color: cols[4 - i], style: st, big: true });
        });
        this.camera.hitFlash(0.2, '#ffe9b0');
      });
      // 10 · the INVERTED PEACOCK — five angled bigs fanning IN from the edges
      const encoreCols = [C.violet, C.pink, C.white, C.orange, C.gold];
      for (let i = 0; i < 5; i++) {
        const k = i - 2;
        Q(12.9 + Math.abs(k) * 0.05, () =>
          this.shellAt({ x: 640 + k * 150, y: 260, color: encoreCols[i], vx: -k * 110, style: i % 2 ? 'palm' : 'peony', big: true }));
      }
    }
    updateFwFinal(rawDt) {
      const cel = this.celebration;
      const FIN_T = 15.0;                    // 5 s pattern + 10 s saturation
      cel.fwT += rawDt;
      // whatever scored beat has come due, fire it — the ENCORE beats and the
      // crossette splits ride this queue through the whole saturation
      if (this.fwQueue) {
        this.fwQueue = this.fwQueue.filter(ev => { if (ev.t <= cel.fwT) { ev.fn(); return false; } return true; });
      }
      // q ramps to max over the first five seconds of saturation;
      // x = the EXTRA five — everything holds EXTREME and keeps climbing
      const q = clamp((cel.fwT - 5) / 5, 0, 1);
      const x = clamp((cel.fwT - 10) / 5, 0, 1);
      if (q > 0) {
        cel.volleyT -= rawDt;
        if (cel.volleyT <= 0) {
          // 0.42 s → 0.07 s across the ramp, then squeezed to ~0.04 s extreme
          cel.volleyT = Math.max(0.04, 0.42 - 0.35 * q - 0.028 * x) * rand(0.85, 1.15);
          const n = 3 + Math.floor(q * q * 7 + q * 3 + x * 5);   // 3 → 13 → 18 shells
          const looks = ['peony', 'peony', 'ring', 'willow', 'palm', 'crossette'];
          for (let i = 0; i < n; i++) {
            this.shellAt({
              // breaks ALL OVER the sky — the lower band is what makes the
              // frame feel taken over rather than crowned
              x: rand(110, 1170), y: rand(60, 450),
              color: pick(FW_PALETTE), style: pick(looks),
              big: Math.random() < 0.25 + q * 0.5 + x * 0.2,   // → 95% big
              vx: rand(-1, 1) * (60 * q + 70 * x),             // angled harder extreme
            });
          }
          if (x > 0.4 && Math.random() < 0.1) this.camera.hitFlash(0.1, '#fff2c0');
          this.camera.kick(2 + 6 * q + 4 * x);
        }
        // named mega crowns land on an accelerating chain right up to the closer
        const satK = (cel.fwT - 5) / (FIN_T - 5);
        if (satK < 0.9 && cel.fwT >= cel.megaT) {
          cel.megaT = cel.fwT + (FIN_T - cel.fwT) * 0.38;
          this.megaShell();
          this.camera.hitFlash(0.18, '#fff2c0');
          this.camera.kick(9);
        }
        // THE CLOSER: everything at once, one last white-out, then the rain
        if (satK >= 0.9 && !cel.closerDone) {
          cel.closerDone = true;
          for (let i = 0; i < 20; i++) {
            this.shellAt({ x: rand(120, 1160), y: rand(70, 420), color: pick(FW_PALETTE), big: true, style: pick(['peony', 'willow', 'ring', 'palm']) });
          }
          this.megaShell(); this.megaShell(); this.megaShell();
          this.camera.hitFlash(0.46, '#ffffff');
          this.camera.kick(24);
          G.Audio.crashBoom();
        }
      }
      if (cel.fwT >= FIN_T) { cel.phase = 'confetti'; cel.confettiT = 0; cel.cheeredUp = false; this.fwQueue.length = 0; }
    }
    /* the paper rain — about ten full seconds of confetti before the end */
    updateConfetti(rawDt) {
      const cel = this.celebration;
      cel.confettiT += rawDt;
      if (cel.confettiT < 8.4) {
        for (let i = 0; i < 3; i++) this.confetti.push(new Confetto());
      }
      // the crowd lifts the rain one more time — and when the paper stops,
      // the cheer hangs on a few seconds past the last of it
      if (!cel.cheeredUp && cel.confettiT >= 3.9) { cel.cheeredUp = true; G.Audio.crowdCheer('up'); }
      this.fwTimer -= rawDt;
      if (this.fwTimer <= 0) { this.launchShell(true); this.fwTimer = rand(1.1, 2.0); }
      if (cel.confettiT >= 10) { G.Audio.crowdCheer('out'); cel.phase = 'end'; }
    }
    drawRoast(ctx) {
      const cel = this.celebration;
      this.drawNightSky(ctx);
      ctx.save();
      ctx.fillStyle = 'rgba(4,6,18,0.30)';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.restore();
      const LINES = this.roastLines();
      ctx.save();
      ctx.beginPath(); ctx.rect(120, 0, 1040, 720); ctx.clip();
      let y = 780 - cel.roastT;                     // the whole report scrolls up
      for (const ln of LINES) {
        if (y > -90 && y < 830) {
          if (ln[0] === FIRED_TXT) {
            // THE VERDICT: calligraphic, huge, and shaking — it rattles on the
            // page like it was carved by somebody with a grudge and a quill
            const jx = (Math.random() - 0.5) * 10, jy = (Math.random() - 0.5) * 10;
            ctx.save();
            ctx.font = `italic 700 ${ln[1]}px ${FIRED_FONT}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
            ctx.strokeStyle = '#04060f'; ctx.lineWidth = 16;
            ctx.strokeText(ln[0], 640 + jx, y + jy);
            ctx.strokeStyle = '#5a0e0e'; ctx.lineWidth = 8;
            ctx.strokeText(ln[0], 640 + jx, y + jy);
            ctx.fillStyle = ln[2];
            ctx.fillText(ln[0], 640 + jx, y + jy);
            ctx.restore();
          } else {
            G.outlinedText(ctx, ln[0], 640, y, ln[1], ln[2], 'center', '#04060f', 7);
          }
        }
        y += this.roastSlot(ln);
      }
      ctx.restore();
      const pulse = 0.55 + Math.sin(performance.now() / 240) * 0.25;
      ctx.save(); ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'ENTER — SKIP TO THE END', 640, 694, 15, '#cfe8c2');
      ctx.restore();
    }
    /* The Don's exit. One ceremony, BOTH render paths: still on his feet and
       groggy he RAMBLES — three bubbles, each one popping up somewhere new
       around him — then thinks one last incoherent thought in a cloud. Then
       THE LAST FLIGHT: the chopper hooks him, hauls him out of the frame,
       flies him out to the horizon, brings him back and DROPS him, and then
       follows him into the dirt. 3D: render3d owns the meshes; this overlay
       owns the bubbles, the hint, and the whole 2D version of the flight. */
    drawDonFall(ctx) {
      const D = this.donFall;
      const B = G.Board;
      const time = performance.now() / 1000;
      const x = B.colX(D.row, D.u), gy = B.laneY[D.row];
      const ss = B.scale(D.row);
      const P = (G.R3 && G.R3.donFallPath && D.mode !== 'swallow') ? G.R3.donFallPath(D) : null;
      let ax = x, ay = gy;                 // where a box hovers (his feet + spot)
      let txA = x, tyA = gy - 122;         // and where his BODY is, for the stem
      const is3d = G.IS3D && !!G.R3.donFall3d;
      if (is3d) {
        const a = (P && P.airborne) ? G.R3.donFallAirAnchor(D) : G.R3.donFallAnchor(D.u, D.row);
        ax = a.x; ay = a.y; txA = a.x; tyA = a.y;
        // FLAT ON HIS BACK (the first Don's collapse): the cloud trails to
        // the head he is lying on — a touch toward it, off the feet anchor
        if (D.mode !== 'swallow' && (D.colK || 0) > 0.85 && !(P && P.airborne)) {
          const a2 = G.R3.donFallAnchor(D.u + 0.9, D.row);
          txA = a2.x; tyA = a.y - 12 * ss;
        }
      } else {
        this.drawDonFallBody2D(ctx, D, x, gy, time, P);
      }
      // the words ride the camera too, so the shake lands on the whole scene
      // — the celebration overlays above are not shaken by default
      ctx.save();
      this.camera.apply(ctx);
      // the swallow's whole show lives here, on the SHARED overlay: it is the
      // same fire in both render paths (the 3D adds only a firelight + glow)
      if (D.mode === 'swallow') this.drawDonSwallowFx(ctx, D, x, gy, ss, time);
      if (D.phase === 'speech') {
        // each message takes the next spot off the SHUFFLED pool — the box
        // pops up somewhere new around him every single run, and the stem
        // stretches all the way back to his body wherever the box landed
        const i = Math.min(D.mi, D.msgs.length - 1);
        const spot = D.spots[Math.min(D.mi, D.spots.length - 1)];
        this.drawBubble(ctx, D.msgs[i], ax + spot[0], ay + spot[1], '#ffffff',
          `\u25CF ${D.mi + 1} / ${D.msgs.length}`, txA, tyA);
      } else if (D.phase === 'thought') {
        const spot = D.spots[D.spots.length - 1];
        // he thinks it FLAT ON HIS BACK at half size: the trail walks down to
        // the head he is lying on, not to where his gut used to be
        if (!is3d && (D.colK || 0) > 0) {
          const figS = P ? P.apD : 1;
          const tt = clamp(0.9 * D.colK / 0.85, 0, 1), e = tt * tt, th = 1.35 * e;
          txA = x + ss * figS * (16 * e - 4 * Math.cos(th) + 192 * Math.sin(th));
          tyA = gy + ss * figS * (30 * e - 4 * Math.sin(th) - 192 * Math.cos(th));
        }
        this.drawThought(ctx, D.thought, ax + spot[0], ay + spot[1], D.t, txA, tyA);
      } else if (D.phase === 'fall') {
        if (D.mode === 'swallow') {
          // HIS LAST THOUGHT COMES LATE — out of the hole itself, only once
          // he is all the way under and the ground is spitting chunks. The
          // cloud hangs over the mouth and its trail walks down INTO it.
          const tw = D.t - SWALLOW_THOUGHT_AT;
          if (tw >= 0 && tw < SWALLOW_HOLE_THOUGHT_T) {
            const spot = D.spots[D.spots.length - 1];
            this.drawThought(ctx, D.thought, x + spot[0], gy + spot[1] - 40, tw, x, gy - 26 * ss);
          }
          // THE PICKUP LINE — he shouts it on the rope, and only for its
          // three-second beat (see HELI_LINE_*): gone well before the drop
        } else if (D.hookK > HELI_LINE_HOOKK && D.carryK < HELI_LINE_CARRYK) {
          let bx2 = ax, by2 = ay - 66;
          if (!is3d && P) {                    // 2D: his body rides the path too
            const s2 = B.scale(D.row);
            txA = x + P.don.col * B.colW * s2;
            tyA = gy - (P.don.y - 122 * P.apD) * s2;   // his gut, at his scale
            bx2 = txA; by2 = tyA - 66;
          }
          this.drawBubble(ctx, D.heliLine, bx2, by2, '#ffd23f', null, txA, tyA);
        }
      }
      ctx.restore();
      const pulse = 0.55 + Math.sin(time * 4) * 0.25;
      ctx.save(); ctx.globalAlpha = pulse;
      G.outlinedText(ctx, 'ENTER — SKIP THE SEND-OFF', 640, 694, 15, '#cfe8c2');
      ctx.restore();
    }
    /* THE FLIGHT, 2D — the same beats through the same channels, in screen
       px. The depth the 3D camera gives for free is faked with a distance
       scale, so the horizon beat still reads as "way out there" and the fall
       still grows as he comes down. */
    drawDonFallBody2D(ctx, D, x, gy, time, P) {
      const B = G.Board, s = B.scale(D.row);
      const donOpts = extra => Object.assign({
        type: D.type, seed: D.seed,
        magaOn: !!D.magaOn, toupeeOn: !!D.toupeeOn,     // the eulogy is entered
        bodyHits: 40, toupeeHigh: 12, hitFlash: 0, shakeAmp: 0.4, dents: 0,   // stripped,
        kneelTimer: 0, shield: false, helmet: false, walkPhase: 0, spawnT: 1, // so these
        hp: 0, maxHp: 5, lean: 0, angry: false, shieldHits: 0, jumpT: 1, noMarker: true,  // read false
      }, extra);
      const drawDon = (px, py, rot, sc, opts) => {
        ctx.save();
        ctx.translate(px, py);
        if (rot) ctx.rotate(rot);
        if (sc !== 1) ctx.scale(sc, sc);
        G.Sprites.drawZombie(ctx, donOpts(opts), time);
        ctx.restore();
      };
      const shadowAt = (px, spread, alpha, gyLine, sc) => {
        const gl = gyLine === undefined ? gy : gyLine;
        const k = sc === undefined ? s : sc;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(px, gl + 4 * k, 46 * k * spread, 11 * k * spread, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      /* THE FAR STAGING. The flight's last legs (return → drop → follow) play
         UP THE LAWN, not beside his feet. The 3D gets that free from its
         projection; this is the same statement in 2D — the ground line rises
         and the whole little tragedy shrinks with it. The ramp saturates at
         |z| 112 so the double-depth drop (-120) lands on the full far stage. */
      const fk = z => clamp((Math.abs(z) - 8) / 104, 0, 1);   // 0 = beside him, 1 = staged far
      const at = z => {
        const k = fk(z);
        return { k, gy: gy - FAR_LIFT * k, ds: 1 - (1 - FAR_DS) * k };
      };
      // THE DIZZY STATE — 1 through the whole ramble, easing out as the exit
      // claims him (the chopper's approach, or the ground's first yawn)
      const dizK = G.DONDIZZY ? G.DONDIZZY.amount(D) : 0;

      /* ---- THE SWALLOW (final boss): the ground takes him, no chopper ----
         He sinks his own height (so he really does go out of sight), and the
         hole, the fire, the rock and the lava are painted over the seam by the
         shared overlay (drawDonSwallowFx) in BOTH render paths. */
      if (D.mode === 'swallow') {
        const sinkK = D.sinkK || 0;
        if (sinkK < 0.985) {
          shadowAt(x, 1 - sinkK * 0.6, 0.3 * (1 - sinkK * 0.8));
          // going UNDER, not toward the camera: clip him at the lawn line —
          // the 3D gets this free, the plane of the lawn is opaque there
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, 1280, gy + 2 * s); ctx.clip();
          const fy = gy + sinkK * 292 * s;
          // DIZZY: he sways on his feet right up until the lawn has him
          if (dizK > 0.02) {
            ctx.translate(x, fy);
            ctx.rotate(G.DONDIZZY.sway(time) * 0.075 * dizK);
            ctx.translate(-x, -fy);
          }
          drawDon(x, fy, 0, s,
            { pose: 'die', dieT: 0.9 * clamp((sinkK - 0.35) / 0.55, 0, 1), dizzy: dizK });
          // the wobbly crown of stars rides the same sway
          if (dizK > 0.02) this.drawDizzyHalo(ctx, x - 4 * s, fy - 192 * s, s, time, dizK);
          ctx.restore();
        }
        return;
      }

      /* ---- THE COLLAPSE (the first Don): the words run out and he FOLDS —
         tipped flat onto the turf and shrunk to half size right there on the
         floor. He lies here through his last thought and the whole approach,
         and it is this same half-size man the rope eventually lifts. */
      if (D.mode !== 'swallow' && (D.colK || 0) > 0 && !D.donDown && !(P && P.airborne)) {
        const colK = D.colK, figS = P ? P.apD : 1;
        const tt = clamp(0.9 * colK / 0.85, 0, 1), e = tt * tt;
        // a lying man's shadow is a WIDE one
        shadowAt(x, 1 + 0.4 * e, 0.3, gy, s * figS);
        drawDon(x, gy, 0, s * figS,
          { pose: 'die', dieT: 0.9 * colK, dizzy: dizK });
        // the halo rides the head he is lying on: replay the painter's own
        // die transform so the stars land where his skull actually is
        if (dizK > 0.02 && e < 0.995) {
          ctx.save();
          ctx.translate(x, gy);
          if (s * figS !== 1) ctx.scale(s * figS, s * figS);
          ctx.translate(16 * e, 30 * e);
          ctx.rotate(1.35 * e);
          this.drawDizzyHalo(ctx, -4, -192, 1, time, dizK);
          ctx.restore();
        }
        return;
      }

      /* ---- down and staying down: the crater, the corpse, and the wreck */
      if (D.donDown) {
        const far = at(P ? P.don.z : -100);
        const farH = at(P ? P.heli.z : -100);
        const hx = x + D.heliCol * B.colW * s;
        shadowAt(x + 16 * s * far.ds, 0.9, 0.24, far.gy, s * far.ds);
        drawDon(x + 16 * s * far.ds, far.gy, 0, s * far.ds,
          { pose: 'die', dieT: 0.9 * (D.landK === undefined ? 1 : D.landK) });
        this.drawHeli2D(ctx, hx, farH.gy - 10 * s * farH.ds, s * farH.ds, 1,
          D.heliDown ? -0.4 : -0.2, time, 0.25);
        if (D.heliDown) this.drawWreckFire2D(ctx, hx, farH.gy, s * farH.ds, time);
        return;
      }

      /* ---- in the air, or standing the way he was before all this ----
         Past the horizon he is not in the shot at all: only the chopper reads
         at that size, and the rope would otherwise end in the lawn. */
      const pastHorizon = !P || Math.abs(P.don.z) > 140;
      const farD = P ? at(P.don.z) : { k: 0, gy, ds: 1 };
      const farH = P ? at(P.heli.z) : { k: 0, gy, ds: 1 };
      // the FIGURE scale is the flight plan's own apD — the depth miniature
      // AND the pickup shrink (full size through the words, half once the
      // chopper takes him) — while farD stages only the GROUND he stands over
      const figS = P ? P.apD : 1;
      const px = P ? x + P.don.col * B.colW * s : x;
      const py = P ? farD.gy - P.don.y * s : gy;   // don.y already carries the scale
      const hangK = P ? (P.don.hangK || 0) : 0;
      if (!pastHorizon) {
        if (P.airborne) {
          // the higher he is, the wider and fainter the contact patch under him
          const k = clamp((P.don.y - 182 * figS) / 140, 0, 1);
          shadowAt(px, 0.8 + k * 0.7, 0.3 - k * 0.13, farD.gy, s * figS);
        } else {
          shadowAt(px, 1, 0.3, farD.gy, s * figS);
        }
        ctx.save();
        // DIZZY: a slow, erratic sway on his feet while the chopper comes
        const fy = py + 182 * figS;
        if (dizK > 0.02 && !P.airborne) {
          ctx.translate(px, fy);
          ctx.rotate(G.DONDIZZY.sway(time) * 0.075 * dizK);
          ctx.translate(-px, -fy);
        }
        ctx.translate(px, py);
        // the hoist takes him round to HORIZONTAL (hangK) — feet first, head
        // trailing — and spins him on the way down; the rope holds his
        // harness, so the body is hung one chest-height under that point
        ctx.rotate(-hangK * 1.5 - (P.don.flying ? (D.dropK || 0) * 6.6 : 0));
        ctx.translate(0, 182 * figS);
        if (figS !== 1) ctx.scale(figS, figS);
        G.Sprites.drawZombie(ctx, donOpts({ pose: 'hold', dizzy: dizK }), time);
        // the wobbly halo lives in FIGURE space, so it rides every sway —
        // (−4, −192) is his head's own centre in this authoring space
        if (dizK > 0.02 && !P.airborne) this.drawDizzyHalo(ctx, -4, -192, 1, time, dizK);
        ctx.restore();
      }
      if (!P) return;

      /* ---- the rope, and the chopper on the end of it ---- */
      const hx = x + P.heli.col * B.colW * s;
      const hy = farH.gy - (P.heli.y + P.heli.bob) * s * farH.ds;
      const prev = this._heliCol === undefined ? P.heli.col : this._heliCol;
      const flip = P.heli.col >= prev ? 1 : -1;      // the nose leads
      this._heliCol = P.heli.col;
      if (D.hookK > 0.02 && D.dropK <= 0.6) {
        const top = farH.gy - (P.heli.y - 44) * s * farH.ds;          // the hook
        const bot = farD.gy - (P.harnessY || P.don.y) * s * farD.ds;  // the harness
        ctx.save();
        ctx.strokeStyle = '#2a241c'; ctx.lineWidth = 4 * s * farD.ds; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx, top); ctx.lineTo(hx, bot); ctx.stroke();
        if (D.hookK < 1) {
          ctx.lineWidth = 5 * s * farD.ds;
          ctx.beginPath(); ctx.arc(hx, bot + 6 * s * farD.ds, 7 * s * farD.ds, -0.4, Math.PI * 1.15); ctx.stroke();
        }
        ctx.restore();
      }
      const tilt = (P.heli.y > 300 ? 0.14 : 0)
        + (D.followK > 0 ? -0.55 * D.followK : 0)
        + Math.sin(time * 3.1) * 0.03;
      this.drawHeli2D(ctx, hx, hy, s * farH.ds, flip, tilt, time, 1);
    }
    /* THE DIZZY HALO — six cartoon stars wobbling around his head on a
       tilted, drifting ellipse, plus one soft golden glow. Drawn in the
       FIGURE's own space (feet at the origin, sprite px), so it inherits
       whatever sway the body already has and shrinks with his staging. */
    drawDizzyHalo(ctx, hx, hy, s, time, dizK) {
      const DZ = G.DONDIZZY, N = 6;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(0, 0, 4, 0, 0, 62 * s);
      gr.addColorStop(0, `rgba(255,214,90,${0.20 * dizK})`);
      gr.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, 62 * s, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < N; i++) {
        const st = DZ.star(i, N, time);
        const sc = s * (0.8 + 0.25 * Math.sin(time * 5 + i * 2.4));
        ctx.save();
        ctx.translate(st.x * s, st.y * s);
        ctx.rotate(st.th * 1.6 + time * 3.1 + i);
        ctx.globalAlpha = (0.45 + 0.55 * dizK) * (0.82 + 0.18 * Math.sin(time * 3.7 + i));
        this.dizzyStar(ctx, 10.5 * sc);
        ctx.restore();
      }
      ctx.restore();
    }
    dizzyStar(ctx, r) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.44 : r;
        const sx = Math.cos(a) * rr, sy = Math.sin(a) * rr;
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffd23f'; ctx.fill();
      ctx.strokeStyle = '#7c4c06'; ctx.lineWidth = Math.max(1.4, r * 0.2); ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = '#fff3b8';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
    /* THE HOLE. Drawn on the SHARED overlay — it works in both render paths
       (the 3D lawn is opaque, so the sunken body is already cut off by it; the
       hole simply covers the seam) and it is where the fire comes from. */
    drawDonSwallowFx(ctx, D, x, gy, s, time) {
      const rk = D.ringK || 0;
      const flames = D.flames || [], rocks = D.rocks || [];
      if (rk <= 0.002 && !flames.length && !rocks.length) return;
      const hy = 22 * s * rk;                       // half-height of the mouth

      /* ---- the light it throws on the grass ---- */
      if (D.spew && rk > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createRadialGradient(x, gy, 2, x, gy, 170 * s * rk);
        const flick = (0.42 + Math.sin(time * 19) * 0.07 + Math.sin(time * 6.1) * 0.05)
          * (0.72 + 0.42 * (D.furyK || 0));   // a furious hole burns brighter
        gr.addColorStop(0, `rgba(255,150,50,${0.5 * flick * rk})`);
        gr.addColorStop(0.55, `rgba(255,110,30,${0.22 * flick * rk})`);
        gr.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.ellipse(x, gy, 170 * s * rk, 52 * s * rk, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      /* ---- the mouth itself ---- */
      if (rk > 0.002) {
        ctx.save();
        ctx.fillStyle = '#241a10';
        ctx.beginPath(); ctx.ellipse(x, gy + 2 * s, 66 * s * rk, hy, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4a3620'; ctx.lineWidth = Math.max(1.5, 3 * s * rk);
        ctx.beginPath(); ctx.ellipse(x, gy + 2 * s, 66 * s * rk, hy, 0, 0, Math.PI * 2); ctx.stroke();
        if (D.spew) {                              // the molten lip
          ctx.globalAlpha = 0.5 + Math.sin(time * 13) * 0.15;
          ctx.strokeStyle = '#ff8a2a'; ctx.lineWidth = Math.max(1, 2 * s * rk);
          ctx.beginPath(); ctx.ellipse(x, gy + 2 * s, 60 * s * rk, hy * 0.86, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      /* ---- the fire: a tongue per flame, hot inside and deep at the edge ---- */
      for (const f of flames) {
        const k = f.t / f.life, a = Math.max(0, 1 - k) * (1 - k * 0.3);
        const stretch = clamp(-f.vy / 210, 0.8, 2.1);
        const w = f.r * 0.58, h = f.r * 2.0 * stretch;
        const tongue = (ww, hh, tipX) => {
          ctx.beginPath();
          ctx.moveTo(f.x - ww, f.y + f.r * 0.3);
          ctx.quadraticCurveTo(f.x - ww * 1.2, f.y - hh * 0.45, f.x + tipX, f.y - hh);
          ctx.quadraticCurveTo(f.x + ww * 1.2, f.y - hh * 0.45, f.x + ww, f.y + f.r * 0.3);
          ctx.quadraticCurveTo(f.x, f.y + f.r * 0.95, f.x - ww, f.y + f.r * 0.3);
          ctx.closePath();
        };
        ctx.save();
        ctx.globalAlpha = a * 0.95;
        ctx.fillStyle = k < 0.4 ? '#ff5a1e' : '#c9330c';       // the deep outer body
        tongue(w, h, f.vx * 0.012);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.fillStyle = k < 0.45 ? '#ff9a2a' : '#ff6a20';      // the bright tongue
        tongue(w * 0.62, h * 0.78, f.vx * 0.012);
        ctx.fill();
        ctx.fillStyle = k < 0.4 ? '#ffd36a' : '#ff9a2a';       // and its hot heart
        tongue(w * 0.3, h * 0.5, f.vx * 0.012);
        ctx.fill();
        if (f.r > 6 * s) {                                     // white-hot at the root
          ctx.fillStyle = '#fff7cf';
          ctx.beginPath(); ctx.ellipse(f.x, f.y - f.r * 0.3, w * 0.22, f.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      /* ---- rock and lava, thrown clear of the hole ---- */
      for (const r of rocks) {
        const k = r.t / r.life, a = clamp(1 - k * k * 1.1, 0, 1);
        ctx.save();
        ctx.globalAlpha = a;
        if (r.kind === 'lava') {
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 1; i <= 3; i++) {            // a hot trail behind it
            ctx.globalAlpha = a * (0.4 - i * 0.1);
            ctx.fillStyle = '#ff7a22';
            ctx.beginPath();
            ctx.arc(r.x - r.vx * 0.012 * i, r.y - r.vy * 0.012 * i, r.r * (1.1 - i * 0.22), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = a; ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#ff8a2a';
          ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffe9a0';
          ctx.beginPath(); ctx.arc(r.x - r.r * 0.15, r.y - r.r * 0.2, r.r * 0.5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.translate(r.x, r.y); ctx.rotate(r.spin * r.t);
          ctx.fillStyle = '#4a4239'; ctx.strokeStyle = '#2a241d'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2, rr = r.r * (i % 2 ? 0.82 : 1.05);
            const px2 = Math.cos(ang) * rr, py2 = Math.sin(ang) * rr;
            if (i) ctx.lineTo(px2, py2); else ctx.moveTo(px2, py2);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }
    /* A scorch crater staged UP THE LAWN (the Don's crash): the same decal the
       2D crater pass draws, but placed by hand at the distant ground line —
       the one part of the crash the 3D crater pool cannot do, because a mesh
       there would sit on the near lane instead. */
    drawFarScorch(ctx, cr) {
      const s = (cr.fsc || FAR_DS) * 1.6;
      const ttl = cr.dieAt || (cr.heavy ? 20 : 10);
      const fade = clamp(1 - cr.t / ttl, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.8 * fade;
      ctx.fillStyle = '#3d3226';
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = '#2a221a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 34 * s, 12 * s, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.55 * fade;
      ctx.fillStyle = '#241d16';
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y, 17 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    /* The chopper, 2D side view — the same machine the 3D path builds: glazed
       nose, stepped engine deck, tapering boom, swept fin with its own rotor,
       skids, and a four-blade head plus the blur it leaves. Nose points +x;
       `flip` aims it and `tilt` banks it. */
    drawHeli2D(ctx, x, y, sc, flip, tilt, time, rotor) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flip * sc, sc);
      ctx.rotate(tilt || 0);
      const OUTL = '#12161e';
      const body = '#33405a', dark = '#1d2534', belly = '#d7dce2';
      const metal = '#9aa2ac', glass = '#86bcdd', trim = '#c0272d';
      const ell = (ex, ey, rx, ry, fill, stroke, lw) => {
        ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 4; ctx.stroke(); }
      };
      const poly = (pts, fill, stroke, lw) => {
        ctx.beginPath();
        pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 4; ctx.lineJoin = 'round'; ctx.stroke(); }
      };
      /* ---- tail: boom, swept fin, stabiliser, and its little rotor ---- */
      poly([[-40, -12], [-148, -6], [-148, 10], [-40, 16]], body, OUTL, 4);
      poly([[-152, 6], [-168, -34], [-146, -38], [-134, 4]], dark, OUTL, 4);      // fin
      poly([[-166, -26], [-146, -30], [-140, -20], [-158, -16]], trim, OUTL, 3);  // fin flash
      poly([[-132, 2], [-100, 0], [-100, 9], [-132, 11]], dark, OUTL, 3);         // stabiliser
      const spin = (rotor ? time * 22 : 0);
      ctx.save();
      ctx.translate(-160, -18);
      ctx.rotate(spin);
      ctx.strokeStyle = '#2b3140'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.restore();
      ell(-160, -18, 5, 5, metal, OUTL, 3);
      /* ---- fuselage ---- */
      ell(0, 0, 66, 32, body, OUTL, 4);            // cabin
      ell(52, 2, 28, 24, body, OUTL, 4);           // nose
      ell(50, -2, 22, 17, glass, OUTL, 3);         // canopy
      ell(-10, -6, 15, 12, glass, OUTL, 3);        // cabin window
      poly([[-56, 2], [34, 2], [34, 12], [-56, 12]], trim, null);   // livery stripe
      ell(0, 16, 54, 15, belly, null);             // pale underside
      ctx.save();                                  // door seam + handle
      ctx.strokeStyle = 'rgba(10,14,20,0.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, -22); ctx.lineTo(8, 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-22, -20); ctx.lineTo(-22, 20); ctx.stroke();
      ctx.fillStyle = metal;
      ctx.fillRect(12, 2, 12, 6);
      ctx.restore();
      /* ---- engine deck, stepped up behind the cabin ---- */
      poly([[-26, -30], [26, -34], [30, -14], [-26, -10]], dark, OUTL, 4);
      ell(8, -36, 20, 8, metal, OUTL, 3);          // gearbox fairing
      poly([[30, -30], [46, -26], [46, -18], [30, -20]], '#23282e', OUTL, 3);  // exhaust
      /* ---- skids ---- */
      ctx.strokeStyle = metal; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-42, 46); ctx.lineTo(56, 46); ctx.stroke();
      ctx.lineWidth = 5;
      for (const sx of [-30, 40]) {
        ctx.beginPath(); ctx.moveTo(sx, 46); ctx.lineTo(sx + (sx < 0 ? 6 : -4), 24); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-46, 46); ctx.lineTo(-58, 34); ctx.stroke();   // tail skid
      /* ---- the main rotor: mast, blur, blades ---- */
      ctx.fillStyle = metal;
      ctx.fillRect(-4, -60, 9, 30);
      ctx.save();
      if (rotor) {
        ctx.globalAlpha = 0.20; ctx.fillStyle = '#7c8fa6';
        ctx.beginPath(); ctx.ellipse(0, -62, 116, 9, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.translate(0, -62);
      ctx.rotate(spin * 1.0);
      ctx.strokeStyle = '#2b3140'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-108, 0); ctx.lineTo(108, 0); ctx.stroke();
      ctx.restore();
      ell(0, -60, 9, 7, metal, OUTL, 3);
      /* ---- lights ---- */
      ell(56, 16, 5, 5, '#ff3b30', OUTL, 2);
      ell(-58, 10, 4.5, 4.5, '#39d353', OUTL, 2);
      ell(-150, -6, 4, 4, '#fff4d0', OUTL, 2);
      ctx.restore();
    }
    /* burning kerosene and burning paperwork, 2D */
    drawWreckFire2D(ctx, x, y, s, time) {
      ctx.save();
      for (let i = 0; i < 8; i++) {
        const ph = time * (2.2 + i * 0.37) + i * 1.7;
        const fx = x + Math.sin(ph) * 30 * s;
        const fy = y - 8 * s - (i % 3) * 13 * s;
        const r = (13 + (i % 4) * 7) * s * (0.8 + 0.2 * Math.sin(ph * 3));
        ctx.globalAlpha = 0.5 + 0.32 * Math.sin(ph * 5);
        ctx.fillStyle = ['#ffd23f', '#ff9a2a', '#ff5a1e'][i % 3];
        ctx.beginPath(); ctx.ellipse(fx, fy, r * 0.8, r * 1.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < 6; i++) {
        const rise = ((time * 42 * s + i * 52 * s) % (250 * s));
        const sy = y - 26 * s - rise;
        ctx.globalAlpha = 0.24 * Math.max(0, 1 - rise / (250 * s));
        ctx.fillStyle = '#4a4a48';
        ctx.beginPath();
        ctx.arc(x + Math.sin(time * 0.6 + i) * 22 * s, sy, (16 + i * 6) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    /* A THOUGHT bubble: a puffy cloud with trailing puffs down toward the
       thinker. Fill → stroke → fill again leaves one clean outer outline on
       the union of the lumps — no seams. It pops in over a quarter second. */
    drawThought(ctx, lines, ax, ay, t, tx, ty) {
      const bw = Math.max(...lines.map(l => l.length)) * 9.2 + 80;
      const bh = lines.length * 24 + 40;
      const bx = clamp(ax, bw / 2 + 16, 1280 - bw / 2 - 16);
      const by = clamp(ay - bh, 16, 420);
      if (tx === undefined) { tx = bx; ty = ay; }
      const ease = 1 - Math.pow(1 - clamp(t / 0.25, 0, 1), 3);
      ctx.save();
      ctx.translate(bx, by + bh / 2);
      ctx.scale(0.7 + 0.3 * ease, 0.7 + 0.3 * ease);
      ctx.globalAlpha = 0.35 + 0.65 * ease;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = 'rgba(30,36,28,0.85)'; ctx.lineWidth = 3;
      const lumps = [
        [0, 0, bw * 0.33, bh * 0.52],
        [-bw * 0.30, bh * 0.06, bw * 0.21, bh * 0.40],
        [bw * 0.30, bh * 0.06, bw * 0.21, bh * 0.40],
        [-bw * 0.15, -bh * 0.24, bw * 0.21, bh * 0.36],
        [bw * 0.15, -bh * 0.24, bw * 0.21, bh * 0.36],
      ];
      for (const pass of [0, 1, 2]) {
        for (const [dx, dy, rx, ry] of lumps) {
          ctx.beginPath();
          ctx.ellipse(dx, dy, rx, ry, 0, 0, Math.PI * 2);
          if (pass === 1) ctx.stroke(); else ctx.fill();
        }
      }
      // the trail: puffs that drift AWAY down the line to the thinker, so the
      // cloud reads as a thought coming out of his head — not a stray bubble
      const tdx0 = tx - bx, tdy0 = ty - (by + bh / 2);
      const tlen = Math.hypot(tdx0, tdy0) || 1;
      const tdx = tdx0 / tlen, tdy = tdy0 / tlen;
      const tEdge = Math.min(Math.abs(tdx) < 1e-4 ? 1e9 : (bw * 0.5) / Math.abs(tdx),
                             Math.abs(tdy) < 1e-4 ? 1e9 : (bh * 0.5) / Math.abs(tdy));
      const d0 = Math.min(tEdge + 7, tlen * 0.62);
      for (const [d, r] of [[d0, 7], [Math.min(d0 + 27, tlen - 4), 12]]) {
        if (d < d0 - 1) continue;
        const dx = tdx * d, dy = tdy * d;
        ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      lines.forEach((ln, i) =>
        G.outlinedText(ctx, ln, 0, -((lines.length - 1) * 24) / 2 + i * 24 + 8, 18, '#20261e', 'center', '#ffffff', 4));
      ctx.restore();
    }
    /* The stem of any bubble: it leaves the box's edge NEAREST the target and
       runs straight at the target. Boxes get clamped and shuffled around the
       speaker, so a fixed downward stub ends up pointing at nobody (and the
       old one overshot him by a whole box-height). Returns the exit point. */
    bubbleStem(ctx, bx, by, bw, bh, tx, ty, half) {
      const cx = bx, cy = by + bh / 2;
      let dx = tx - cx, dy = ty - cy;
      const len = Math.hypot(dx, dy);
      if (len < 2) return null;
      dx /= len; dy /= len;
      const tEdge = Math.min(Math.abs(dx) < 1e-4 ? 1e9 : (bw / 2) / Math.abs(dx),
                             Math.abs(dy) < 1e-4 ? 1e9 : (bh / 2) / Math.abs(dy));
      const ex = cx + dx * tEdge, ey = cy + dy * tEdge;
      const tip = Math.max(20, Math.min(len - tEdge, 112));
      const nx = -dy, ny = dx;
      const mx = ex + dx * tip, my = ey + dy * tip;          // the tip, on the line
      const bow = Math.min(12, tip * 0.22);                  // a gentle S so it reads
      ctx.beginPath();                                       // as a tail, not a needle
      ctx.moveTo(ex + nx * half, ey + ny * half);
      ctx.quadraticCurveTo(ex + dx * tip * 0.45 + nx * (half * 0.55 + bow),
                           ey + dy * tip * 0.45 + ny * (half * 0.55 + bow), mx, my);
      ctx.quadraticCurveTo(ex + dx * tip * 0.45 - nx * (half * 0.85 - bow),
                           ey + dy * tip * 0.45 - ny * (half * 0.85 - bow),
                           ex - nx * half, ey - ny * half);
      ctx.closePath();
      return true;
    }
    /* One reusable speech bubble: rounded box, stem aimed at (tx,ty) — the
       speaker — defaulting to a stub below the box. Clamped inside the frame,
       stem recomputed from wherever the box actually landed. */
    drawBubble(ctx, lines, ax, ay, border, tag, tx, ty) {
      const bw = Math.max(...lines.map(l => l.length)) * 10.4 + 44;
      const bh = lines.length * 26 + 30;
      const bx = clamp(ax, bw / 2 + 12, 1280 - bw / 2 - 12);
      const by = clamp(ay - bh, 18, 430);
      if (tx === undefined) { tx = bx; ty = by + bh + 46; }
      ctx.save();
      const fill = 'rgba(255,255,255,0.96)';
      ctx.fillStyle = fill;
      ctx.strokeStyle = border === '#ffffff' ? 'rgba(20,24,18,0.9)' : border; ctx.lineWidth = 3;
      // stem FIRST, box over its base: the join is then invisible
      if (this.bubbleStem(ctx, bx, by, bw, bh, tx, ty, 11)) { ctx.fill(); ctx.stroke(); }
      roundRectPath(ctx, bx - bw / 2, by, bw, bh, 14); ctx.fill(); ctx.stroke();
      lines.forEach((ln, i) => G.outlinedText(ctx, ln, bx, by + 34 + i * 26, 19, '#20261e', 'center', '#ffffff', 4));
      if (tag) G.outlinedText(ctx, tag, bx + bw / 2 - 8, by + bh - 14, 13, '#8a9384', 'right', '#ffffff', 3);
      ctx.restore();
    }
    /* The hat-rage bubble. Pinned over whoever just lost his look, pops in,
       jitters with his shake, and lingers a full ten seconds — then goes. */
    drawBossGripe(ctx) {
      const g = this.gripe;
      if (!g) return;
      const B = G.Board, z = g.z;
      if (z && !z.dead) {   // follows him across lane jumps
        g.sx = B.colX(z.row, z.u);
        g.sy = B.laneY[z.row] - B.heightPx(z.row, z.hitBands().top);
      }
      const pop = Math.min(1, g.t / 0.16);
      const fade = g.t > g.dur - 0.45 ? clamp((g.dur - g.t) / 0.45, 0, 1) : 1;
      const jit = z && z.shakeAmp ? Math.min(2.4, z.shakeAmp) : 0;
      const lines = g.lines;
      const bw = Math.max(...lines.map(l => l.length)) * 10.4 + 44;
      const bh = lines.length * 26 + 30;
      const bx = clamp(g.sx + 8, bw / 2 + 12, 1280 - bw / 2 - 12);
      const by = clamp(g.sy - bh - 40, 18, 430);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(bx, by + bh / 2);
      const k = pop * (1.15 - 0.15 * pop);   // tiny overshoot on the pop-in
      ctx.scale(k, k);
      ctx.translate(-bx, -(by + bh / 2));
      ctx.translate(Math.sin(g.t * 47) * 2.2 * jit, Math.sin(g.t * 39 + 1.3) * 1.8 * jit);
      ctx.fillStyle = 'rgba(255,252,240,0.97)';
      ctx.strokeStyle = g.border || '#ff8080'; ctx.lineWidth = 3.5;
      // the stem runs at his head, from wherever the box had to land
      if (this.bubbleStem(ctx, bx, by, bw, bh, g.sx, g.sy, 12)) { ctx.fill(); ctx.stroke(); }
      roundRectPath(ctx, bx - bw / 2, by, bw, bh, 14); ctx.fill(); ctx.stroke();
      lines.forEach((ln, i) => G.outlinedText(ctx, ln, bx, by + 34 + i * 26, 19, i === 0 ? '#c62828' : '#20261e', 'center', '#ffffff', 4));
      G.outlinedText(ctx, '!!!', bx + bw / 2 - 14, by + bh - 14, 15, '#c62828', 'right', '#ffffff', 3);
      ctx.restore();
    }
    drawGameOver(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(24,6,6,0.7)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, this.loseCause === 'brain' ? 'YOUR BRAIN HAS BEEN EATEN' : 'THE PULT IS GONE',
        640, 158, 50, '#ff5555', 'center', '#200808', 12);
      G.outlinedText(ctx, `SCORE ${this.score}`, 640, 226, 34, '#ffffff');
      G.outlinedText(ctx, `HIGH ${this.highScore}`, 640, 266, 24, '#ffd23f');
      G.outlinedText(ctx,
        `Kills ${this.stageStats.kills} · Glory kills ${this.stageStats.glory} · Stage ${this.stage}${this.bossWave ? ' · BOSS WAVE' : ''}`,
        640, 304, 18, '#cfe8c2');

      // ---- the 10-second clock
      const left = Math.max(0, this.loseLimit - this.loseT);
      const frac = clamp(left / this.loseLimit, 0, 1);
      const bx = 352, bw = 576, by = 344;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRectPath(ctx, bx - 3, by - 3, bw + 6, 20, 6); ctx.fill();
      ctx.fillStyle = frac > 0.4 ? '#ffd23f' : '#ff5555';
      roundRectPath(ctx, bx, by, Math.max(2, bw * frac), 14, 5); ctx.fill();
      G.outlinedText(ctx, `DECIDE IN ${left.toFixed(1)}s  ·  NO ANSWER QUITS`, 640, by + 36, 17,
        frac > 0.4 ? '#ffe9a0' : '#ff8080');
      ctx.restore();

      // ---- the two ways out. Hover lights them; the clock decides if you don't.
      for (const b of this.gameoverButtons()) {
        const hot = this.input.rawMx >= b.x && this.input.rawMx <= b.x + b.w
          && this.input.rawMy >= b.y && this.input.rawMy <= b.y + b.h;
        ctx.save();
        ctx.fillStyle = hot ? 'rgba(34,46,26,0.95)' : 'rgba(14,20,12,0.85)';
        roundRectPath(ctx, b.x, b.y, b.w, b.h, 12); ctx.fill();
        ctx.strokeStyle = b.color; ctx.lineWidth = hot ? 4 : 2.5;
        roundRectPath(ctx, b.x, b.y, b.w, b.h, 12); ctx.stroke();
        G.outlinedText(ctx, b.label, b.x + b.w / 2, b.y + 26, 22, b.color);
        G.outlinedText(ctx, b.key === 'restart' ? 'press R or ENTER' : 'press Q', b.x + b.w / 2, b.y + 50, 14, '#9fd6a8');
        ctx.restore();
      }
    }
    drawPause(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,18,10,0.55)';
      ctx.fillRect(0, 0, 1280, 720);
      G.outlinedText(ctx, 'PAUSED', 640, 330, 60, '#ffffff');
      G.outlinedText(ctx, 'P to resume · M mute · R restart', 640, 390, 20, '#cfe8c2');
      ctx.restore();
    }
  }

  G.Game = Game;
  G.Particle = Particle;
})();

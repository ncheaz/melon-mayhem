/* ============================================================
   MELON MAYHEM — audio.js
   Fully synthesized sound (Web Audio). No external assets.
   ============================================================ */
'use strict';
(function () {
  class AudioSys {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.stepTimer = 0;
      this.groanTimer = M.rand(2, 5);
    }
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { /* audio unavailable */ }
    }
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
      return this.muted;
    }
    get t() { return this.ctx ? this.ctx.currentTime : 0; }

    /* ---- primitives ---- */
    osc(type, f0, f1, dur, vol, delay = 0, curve = 'exp') {
      if (!this.ctx || this.muted) return;
      const t = this.t + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(1, f0), t);
      if (f1 !== null) {
        if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        else o.frequency.linearRampToValueAtTime(Math.max(1, f1), t + dur);
      }
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noise(dur, vol, filterFreq, delay = 0, type = 'lowpass', q = 1) {
      if (!this.ctx || this.muted) return;
      const t = this.t + delay;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    }

    /* ---- game sounds ---- */
    chargeTick(f) { this.osc('sine', 140 + f * 420, null, 0.06, 0.05); }
    chargeTop() { this.osc('sine', 1180, null, 0.05, 0.03); } // soft crest blip at the top turnaround
    chargeFull() { this.osc('square', 880, null, 0.09, 0.06); }
    shoot(power) {
      this.noise(0.12, 0.35, 900, 0, 'lowpass');
      this.osc('sine', 160 - power * 40, 60, 0.18, 0.4);
      this.osc('triangle', 320, 90, 0.12, 0.18);
    }
    heavyShoot() {
      this.noise(0.25, 0.5, 500, 0, 'lowpass');
      this.osc('sine', 110, 38, 0.4, 0.55);
      this.osc('square', 220, 60, 0.2, 0.2);
    }
    shieldClink() {
      this.osc('square', 2100, 1400, 0.07, 0.14);
      this.osc('sine', 3200, 2400, 0.05, 0.08, 0.01);
      this.noise(0.05, 0.12, 4000, 0, 'highpass');
    }
    shieldBreak() {
      this.noise(0.3, 0.4, 2400, 0, 'highpass');
      this.osc('square', 900, 200, 0.25, 0.2);
      this.noise(0.2, 0.3, 600, 0.05);
    }
    helmetClank() {
      this.osc('triangle', 1500, 500, 0.22, 0.22);
      this.osc('square', 2400, 900, 0.12, 0.1, 0.02);
    }
    splat() {
      this.noise(0.14, 0.4, 700, 0, 'lowpass');
      this.osc('sine', 300, 70, 0.16, 0.35);
      this.osc('sine', 130, 50, 0.22, 0.25, 0.02);
    }
    headBonk() {
      this.osc('sine', 420, 90, 0.2, 0.4);
      this.noise(0.08, 0.25, 1200, 0);
    }
    knockdown() {
      this.osc('sine', 130, 40, 0.35, 0.5);
      this.noise(0.2, 0.3, 400, 0.02);
    }
    glorySting() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => this.osc('sawtooth', f, f, 0.22, 0.12, i * 0.07));
      this.osc('sine', 130, 60, 0.5, 0.4, 0.1);
      this.noise(0.4, 0.2, 3000, 0.1, 'highpass');
    }
    deathGroan() {
      this.osc('sawtooth', 190, 55, 0.7, 0.16, 0, 'lin');
      this.osc('sawtooth', 187, 52, 0.7, 0.12, 0.02, 'lin');
    }
    missPoof() { this.noise(0.18, 0.18, 500, 0, 'lowpass'); }
    stoneCrack() {
      this.noise(0.2, 0.4, 1600, 0, 'bandpass', 2);
      this.osc('triangle', 300, 80, 0.2, 0.25);
    }
    ammoPickup() {
      this.osc('sine', 660, null, 0.09, 0.18);
      this.osc('sine', 990, null, 0.14, 0.18, 0.08);
    }
    waveHorn() {
      this.osc('sawtooth', 196, 196, 0.5, 0.2);
      this.osc('sawtooth', 147, 147, 0.6, 0.18, 0.12);
      this.noise(0.4, 0.1, 800, 0.05);
    }
    loseSting() {
      [392, 370, 349, 262].forEach((f, i) => this.osc('sawtooth', f, f * 0.97, 0.5, 0.2, i * 0.28));
      this.osc('sine', 90, 40, 1.6, 0.4, 0.9);
    }
    winJingle() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => this.osc('triangle', f, f, 0.3, 0.16, i * 0.13));
    }
    uiClick() { this.osc('square', 700, 500, 0.06, 0.1); }
    jumpWhoosh() { this.noise(0.15, 0.16, 1400, 0, 'bandpass', 1.5); this.osc('sine', 300, 520, 0.14, 0.1); }

    /* ---- the boss ---- */
    bossHorn() {      // a slow, ugly two-note brass: the entrance, not a wave horn
      this.osc('sawtooth', 98, 98, 1.1, 0.3);
      this.osc('sawtooth', 147, 147, 1.2, 0.22, 0.04);
      this.osc('sawtooth', 92, 92, 1.5, 0.26, 0.62);
      this.osc('square', 73, 73, 1.8, 0.2, 0.62);
      this.noise(1.0, 0.14, 320, 0, 'lowpass');
    }
    bossThud(top) {
      // every hit lands like a hammer on a barrel; a high arc lands like two
      this.noise(0.16, top ? 0.5 : 0.32, 420, 0, 'lowpass');
      this.osc('sine', top ? 74 : 96, 34, top ? 0.36 : 0.22, top ? 0.55 : 0.36);
      if (top) this.osc('square', 168, 60, 0.14, 0.16, 0.01);
    }
    bossPhase() {
      // the headwear comes off: crack, then a rising squeal
      this.noise(0.3, 0.45, 2600, 0, 'highpass');
      this.osc('sawtooth', 240, 900, 0.4, 0.22);
      this.osc('sine', 60, 30, 0.6, 0.4, 0.05);
    }
    bossDown() {
      [196, 175, 147, 98, 73].forEach((f, i) => this.osc('sawtooth', f, f * 0.92, 0.7, 0.26, i * 0.22));
      this.osc('sine', 55, 26, 2.2, 0.5, 1.0);
      this.noise(1.4, 0.25, 260, 1.0, 'lowpass');
    }
    /* ---- the last flight (see Game.updateDonFlight) ---- */
    heliIn() {
      // blade slap coming down THROUGH the arrival — the gaps tightening
      [0, 0.22, 0.4, 0.54, 0.66, 0.76, 0.84].forEach((d, i) => {
        this.noise(0.09, 0.16 + i * 0.02, 320, d, 'lowpass');
        this.osc('sine', 62 - i * 2, 52, 0.1, 0.1, d);
      });
      this.osc('sawtooth', 220, 300, 0.9, 0.05, 0.1);   // turbine whine
    }
    harnessPop() {
      this.osc('square', 900, 220, 0.08, 0.22);
      this.noise(0.08, 0.3, 2600, 0, 'bandpass', 2);
    }
    fallWhistle() {
      this.osc('sine', 1500, 260, 0.85, 0.16, 0, 'exp');
      this.osc('sine', 2000, 340, 0.85, 0.07, 0.02, 'exp');
    }
    crashBoom() {
      this.noise(1.1, 0.55, 900, 0, 'lowpass');
      this.noise(0.5, 0.4, 3000, 0, 'highpass');
      this.osc('sine', 130, 30, 1.2, 0.6);
      this.osc('sawtooth', 90, 28, 0.9, 0.3, 0.02);
      this.noise(1.6, 0.18, 220, 0.25, 'lowpass');
    }
    fireworkBurst(night) {
      this.noise(night ? 0.5 : 0.34, night ? 0.42 : 0.3, night ? 1900 : 1500, 0, 'highpass');
      this.osc('sine', night ? 90 : 130, 40, 0.4, 0.3);
      if (night) this.noise(0.7, 0.2, 900, 0.06, 'bandpass', 1.2);
    }
    fanfare(big) {
      const notes = big ? [523, 659, 784, 1047, 1319, 1568, 2093] : [392, 523, 659, 784, 1047];
      notes.forEach((f, i) => this.osc('triangle', f, f, big ? 0.42 : 0.3, 0.17, i * (big ? 0.16 : 0.13)));
      this.osc('sawtooth', big ? 131 : 98, big ? 131 : 98, 1.4, 0.16, 0.2);
      if (big) this.noise(2.0, 0.14, 2200, 0.5, 'highpass');
    }

    /* ---- ambience driven by game state ---- */
    ambience(dt, walkingZombies, aliveZombies) {
      if (!this.ctx || this.muted) return;
      // march steps while anyone is walking
      if (walkingZombies > 0) {
        this.stepTimer -= dt * Math.min(3, walkingZombies);
        if (this.stepTimer <= 0) {
          this.stepTimer = 0.34;
          this.osc('sine', 78, 45, 0.09, 0.12);
          this.noise(0.05, 0.05, 300, 0);
        }
      }
      // random groans from the horde
      this.groanTimer -= dt * (1 + aliveZombies * 0.15);
      if (this.groanTimer <= 0) {
        this.groanTimer = M.rand(2.5, 6);
        const f = M.rand(110, 170);
        this.osc('sawtooth', f, f * 0.7, 0.9, 0.05, 0, 'lin');
        this.osc('sawtooth', f * 1.02, f * 0.68, 0.9, 0.04, 0.05, 'lin');
      }
    }
  }
  G.Audio = new AudioSys();
})();

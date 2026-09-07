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

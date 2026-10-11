// Synthesised WebAudio sound effects (no audio files).
export class Sfx {
  constructor() { this.ctx = null; this.volume = 0.8; this.fxVol = 1; this.uiVol = 0.8; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // buses: game effects and interface sounds, each with its own volume
    this.fxBus = ctx.createGain(); this.fxBus.gain.value = this.fxVol; this.fxBus.connect(this.master);
    this.uiBus = ctx.createGain(); this.uiBus.gain.value = this.uiVol; this.uiBus.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2; this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb impulse (outdoor slap-back + tail)
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const b = ir.getChannelData(c); for (let i = 0; i < b.length; i++) { const t = i / ctx.sampleRate; b[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / 1.6, 3) * (t > 0.06 && t < 0.09 ? 2.2 : 0.6); } }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.fxBus);
    this.ambient();
  }
  setVolume(v, fx = this.fxVol, ui = this.uiVol) {
    this.volume = v; this.fxVol = fx; this.uiVol = ui;
    if (this.master) { this.master.gain.value = v; this.fxBus.gain.value = fx; this.uiBus.gain.value = ui; }
  }
  // ---- interface sounds (menu hover / press / back, kill streak sting, heartbeat)
  ui(kind = 'press') {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createGain(); o.connect(this.uiBus);
    if (kind === 'hover') { this.tone(o, t, 1900, 2100, 0.04, 0.05, 'sine'); }
    else if (kind === 'back') { this.tone(o, t, 900, 520, 0.09, 0.12, 'triangle'); }
    else if (kind === 'select') { this.tone(o, t, 700, 700, 0.06, 0.12, 'triangle'); this.tone(o, t + 0.06, 1050, 1050, 0.1, 0.12, 'triangle'); }
    else if (kind === 'notify') { this.tone(o, t, 880, 880, 0.08, 0.1, 'sine'); this.tone(o, t + 0.09, 1320, 1320, 0.12, 0.1, 'sine'); }
    else { this.tone(o, t, 1300, 900, 0.05, 0.14, 'triangle'); this.noiseBurst(o, t, { type: 'bandpass', freq: 3200, q: 3, gain: 0.12, decay: 0.03 }); }
  }
  streak(level = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createGain(); o.connect(this.uiBus);
    const base = 440 * Math.pow(1.12, level);
    [0, 0.08, 0.16].forEach((d, i) => this.tone(o, t + d, base * [1, 1.25, 1.5][i], base * [1, 1.25, 1.5][i], 0.22, 0.12, 'sawtooth'));
    this.noiseBurst(o, t, { type: 'lowpass', freq: 300, gain: 0.5, decay: 0.3 });
  }
  heartbeat() {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.ctx.createGain(); o.connect(this.uiBus); o.gain.value = 1.4;
    this.tone(o, t, 62, 40, 0.14, 0.9); this.tone(o, t + 0.2, 55, 36, 0.16, 0.7);
  }
  out(pos) {
    const ctx = this.ctx; const g = ctx.createGain();
    if (pos) { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; g.connect(p); p.connect(this.fxBus); p.connect(this.verb); }
    else { g.connect(this.fxBus); g.connect(this.verb); }
    return g;
  }
  noiseBurst(dest, t, { type = 'bandpass', freq = 1000, q = 1, gain = 1, attack = 0.001, decay = 0.1, offset = 0 } = {}) {
    const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, offset || Math.random()); s.stop(t + attack + decay + 0.05);
  }
  tone(dest, t, f0, f1, dur, gain, type = 'sine') {
    const ctx = this.ctx; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  // per-weapon synthesized gunshot profiles: hi = crack, mid = body, lo = boom, thump = sub tone
  gunshot(pos = null, loud = 1, kind = 'rifle') {
    if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(pos); o.gain.value = loud;
    const P = Sfx.PROFILES[kind] || Sfx.PROFILES.rifle;
    this.noiseBurst(o, t, { type: 'highpass', freq: P.hiF, q: 0.5, gain: P.hi, decay: P.hiD });
    this.noiseBurst(o, t, { type: 'bandpass', freq: P.midF, q: 0.6, gain: P.mid, decay: P.midD });
    this.noiseBurst(o, t, { type: 'lowpass', freq: P.loF, q: 0.7, gain: P.lo, decay: P.loD });
    this.tone(o, t, P.th0, P.th1, P.thD, P.th);
    this.noiseBurst(o, t + 0.008, { type: 'bandpass', freq: P.mechF, q: 3, gain: P.mech, decay: 0.03 }); // mechanism
    if (P.tail) this.noiseBurst(o, t + 0.05, { type: 'lowpass', freq: 900, q: 0.5, gain: P.tail, decay: 0.9 }); // long echo tail (sniper / shotgun)
    if (kind === 'shotgun' && !pos) { this.click(900, 0.5, 0.33); this.click(1400, 0.55, 0.42); this.click(700, 0.45, 0.5); } // pump: back - forward
    if (kind === 'sniper' && !pos) { this.click(2200, 0.5, 0.45); this.click(1300, 0.45, 0.6); this.click(2800, 0.55, 0.78); this.click(1700, 0.5, 0.9); } // bolt
  }
  explosion(pos) {
    if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(pos); o.gain.value = 2.2;
    this.noiseBurst(o, t, { type: 'lowpass', freq: 420, q: 0.6, gain: 1.4, decay: 1.6 });
    this.noiseBurst(o, t, { type: 'bandpass', freq: 1400, q: 0.5, gain: 0.8, decay: 0.35 });
    this.noiseBurst(o, t + 0.04, { type: 'lowpass', freq: 160, q: 0.8, gain: 1.2, decay: 2.4 });
    this.tone(o, t, 70, 28, 0.9, 1.0);
  }
  // looping engine for the local driver: set(load 0..1, throttle 0..1)
  engineLoop() {
    const ctx = this.ctx, t = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0; out.connect(this.fxBus);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.35; o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(out);
    o1.frequency.value = 38; o2.frequency.value = 19; o1.start(t); o2.start(t); out.gain.linearRampToValueAtTime(0.16, t + 0.4);
    return {
      set: (load, th) => { const n = ctx.currentTime, hz = 34 + load * 70 + th * 10; o1.frequency.setTargetAtTime(hz, n, 0.12); o2.frequency.setTargetAtTime(hz / 2, n, 0.12); f.frequency.setTargetAtTime(380 + load * 900 + th * 400, n, 0.1); out.gain.setTargetAtTime(0.12 + th * 0.08 + load * 0.05, n, 0.15); },
      stop: () => { const n = ctx.currentTime; out.gain.setTargetAtTime(0, n, 0.08); o1.stop(n + 0.5); o2.stop(n + 0.5); },
    };
  }
  horn() { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(); this.tone(o, t, 370, 370, 0.45, 0.22, 'sawtooth'); this.tone(o, t, 466, 466, 0.45, 0.16, 'sawtooth'); }
  switchWeapon() { this.click(1500, 0.35); this.click(2600, 0.4, 0.26); this.click(900, 0.35, 0.32); }
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(); this.tone(o, t, 660, 660, 0.08, 0.18, 'triangle'); this.tone(o, t + 0.08, 990, 990, 0.14, 0.18, 'triangle'); this.click(1800, 0.4, 0.02); }
  click(freq = 3000, gain = 0.3, when = 0, pos = null) { if (!this.ctx) return; const o = this.out(pos); this.noiseBurst(o, this.ctx.currentTime + when, { type: 'bandpass', freq, q: 4, gain, decay: 0.035 }); }
  // medkit: velcro rip, foil tear, then a soft rising chime when the heal completes
  medkit() { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out();
    this.noiseBurst(o, t, { type: 'highpass', freq: 2500, gain: 0.35, attack: 0.01, decay: 0.28 }); this.noiseBurst(o, t + 0.45, { type: 'bandpass', freq: 4200, q: 2, gain: 0.25, decay: 0.12 });
    this.click(1400, 0.35, 0.9); this.tone(o, t + 1.9, 520, 520, 0.12, 0.12, 'triangle'); this.tone(o, t + 2.02, 780, 780, 0.2, 0.12, 'triangle'); }
  coins() { if (!this.ctx) return; const t = this.ctx.currentTime, o = this.out(); this.tone(o, t, 1320, 1320, 0.07, 0.12, 'triangle'); this.tone(o, t + 0.07, 1760, 1760, 0.12, 0.12, 'triangle'); }
  empty() { this.click(2600, 0.4); }
  reload(k = 1) { this.click(1800, 0.45, 0.15 * k); this.click(1200, 0.35, 0.22 * k); this.click(2400, 0.5, 1.2 * k); this.click(1500, 0.5, 1.25 * k); this.click(3200, 0.5, 1.75 * k); this.click(2000, 0.6, 1.85 * k); }
  hit(head) { if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(); if (head) { this.tone(o, t, 2400, 2300, 0.18, 0.18); this.tone(o, t, 3600, 3500, 0.12, 0.1); } else this.tone(o, t, 1700, 1500, 0.05, 0.14, 'triangle'); }
  impact(pos, kind) { if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(pos); o.gain.value = 0.6;
    if (kind === 'metal') { this.tone(o, t, 2200 + Math.random() * 1500, 1800, 0.2, 0.15, 'triangle'); this.noiseBurst(o, t, { freq: 4000, q: 2, gain: 0.3, decay: 0.05 }); }
    else this.noiseBurst(o, t, { type: 'lowpass', freq: kind === 'wood' ? 900 : 1500, gain: 0.5, decay: 0.07 }); }
  step(pos, gain = 0.12) { if (!this.ctx) return; const o = this.out(pos); this.noiseBurst(o, this.ctx.currentTime, { type: 'lowpass', freq: 500 + Math.random() * 300, q: 1, gain, decay: 0.07 }); }
  shellTink(pos) { if (!this.ctx) return; const o = this.out(pos); o.gain.value = 0.25; this.tone(o, this.ctx.currentTime, 5200 + Math.random() * 1500, 4800, 0.08, 0.08, 'triangle'); }
  hurt() { if (!this.ctx) return; const t = this.ctx.currentTime; const o = this.out(); this.tone(o, t, 90, 45, 0.25, 0.8); this.noiseBurst(o, t, { type: 'lowpass', freq: 600, gain: 0.5, decay: 0.15 }); }
  whiz(pos) { if (!this.ctx) return; const o = this.out(pos); this.noiseBurst(o, this.ctx.currentTime, { type: 'bandpass', freq: 3500, q: 8, gain: 0.35, attack: 0.03, decay: 0.08 }); }
  ambient() {
    const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350;
    const g = ctx.createGain(); g.gain.value = 0.05; const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(this.fxBus); s.start(); lfo.start();
  }
  listener(cam) {
    if (!this.ctx) return; const L = this.ctx.listener; const p = cam.position; const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
}
Sfx.PROFILES = {
  rifle:   { hiF: 2500, hi: 0.9, hiD: 0.045, midF: 1100, mid: 1.1, midD: 0.12, loF: 380, lo: 1.4, loD: 0.32, th0: 140, th1: 38, thD: 0.16, th: 0.9, mechF: 5200, mech: 0.25 },
  ak:      { hiF: 2000, hi: 0.8, hiD: 0.05, midF: 800, mid: 1.3, midD: 0.15, loF: 300, lo: 1.6, loD: 0.38, th0: 120, th1: 32, thD: 0.2, th: 1.1, mechF: 4200, mech: 0.3 },
  smg:     { hiF: 3200, hi: 0.8, hiD: 0.03, midF: 1600, mid: 0.9, midD: 0.07, loF: 520, lo: 0.8, loD: 0.16, th0: 190, th1: 70, thD: 0.08, th: 0.5, mechF: 6000, mech: 0.35 },
  shotgun: { hiF: 1600, hi: 1.0, hiD: 0.06, midF: 600, mid: 1.4, midD: 0.2, loF: 220, lo: 2.0, loD: 0.55, th0: 95, th1: 28, thD: 0.3, th: 1.4, mechF: 3000, mech: 0.2, tail: 0.5 },
  sniper:  { hiF: 3000, hi: 1.3, hiD: 0.06, midF: 900, mid: 1.3, midD: 0.18, loF: 260, lo: 1.9, loD: 0.6, th0: 110, th1: 25, thD: 0.35, th: 1.3, mechF: 4500, mech: 0.2, tail: 0.7 },
  pistol:  { hiF: 2800, hi: 0.8, hiD: 0.035, midF: 1400, mid: 0.9, midD: 0.08, loF: 450, lo: 0.9, loD: 0.18, th0: 170, th1: 55, thD: 0.1, th: 0.6, mechF: 5600, mech: 0.3 },
};

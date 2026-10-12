// Mobile / touch controls: floating joystick (with sprint lock), drag-to-look, icon buttons.
const $ = (id) => document.getElementById(id);

export function isTouchDevice() {
  const p = new URLSearchParams(location.search);
  if (p.get('mobile') === '1') return true;
  if (p.get('mobile') === '0') return false;
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return true; // Android app
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent) || isIOS();
  return touch && (matchMedia('(pointer: coarse)').matches || uaMobile);
}
// iPhone / iPad (iPadOS reports itself as a Mac with touch)
export function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
export function isStandalone() { return matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
export function fullscreenSupported() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); }
export function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

// v1.5 on-foot controls cut from the reference sheet (assets/ui/controls/*.png): ring centre (fx, fy) as a fraction of the
// screen, ring radius fr as a fraction of the sheet height; ox / oy / r = ring centre + radius in the PNG's own pixels.
const CTL = {"joystick":{"w":512,"h":547,"ox":256.0,"oy":256.0,"r":223.2,"fx":0.1719,"fy":0.6738,"fr":0.2214},"run":{"w":256,"h":297,"ox":128.0,"oy":128.0,"r":108.5,"fx":0.3096,"fy":0.3385,"fr":0.1048},"medkit":{"w":256,"h":298,"ox":128.0,"oy":128.0,"r":108.7,"fx":0.4386,"fy":0.1738,"fr":0.11},"drive":{"w":256,"h":294,"ox":128.0,"oy":128.0,"r":108.9,"fx":0.5705,"fy":0.4453,"fr":0.1152},"scope":{"w":256,"h":295,"ox":128.0,"oy":128.0,"r":108.7,"fx":0.7616,"fy":0.3079,"fr":0.11},"settings":{"w":256,"h":297,"ox":128.0,"oy":128.0,"r":108.7,"fx":0.9161,"fy":0.151,"fr":0.1061},"reload":{"w":256,"h":297,"ox":128.0,"oy":128.0,"r":108.5,"fx":0.9023,"fy":0.4935,"fr":0.1087},"shoot":{"w":384,"h":422,"ox":192.0,"oy":192.0,"r":166.2,"fx":0.7344,"fy":0.679,"fr":0.1758},"crouch":{"w":256,"h":297,"ox":128.0,"oy":128.0,"r":108.5,"fx":0.9004,"fy":0.8099,"fr":0.1048}};
const CTL_IDS = { joystick: 'joybase', run: 'tSprint', medkit: 'tMed', drive: 'tUse', scope: 'tAim', settings: 'tPause', reload: 'tReload', shoot: 'tFire', crouch: 'tCrouch' };
export class TouchControls {
  constructor(game) {
    this.g = game; this.inp = game.input;
    this.inp.joy = { active: false, x: 0, y: 0 };
    this.joyId = null; this.lookIds = new Map(); this.fireIds = new Set();
    this.root = $('touch'); this.base = $('joybase'); this.knob = $('joyknob');
    document.body.classList.add('mobile');
    this.ts = 1; this.layout();
    this.applySettings();
    this.bind(); this.bindGyro();
  }
  // GYROSCOPE INPUT: while aiming down sights, tilting the phone fine-tunes the aim (rotation rate in deg/s)
  bindGyro() {
    addEventListener('devicemotion', (e) => {
      const g = this.g, s = g.settings, r = e.rotationRate; if (!s.gyro || !r || g.state !== 'playing' || !g.player || !g.player.aiming) return;
      const dt = Math.min(0.05, (e.interval > 1 ? e.interval / 1000 : e.interval) || 0.016), land = Math.abs(screen.orientation ? screen.orientation.angle : window.orientation || 90) === 90 ? 1 : -1;
      const inv = s.gyroInv ? -1 : 1, k = 12 * (s.gyroSens || 1) * dt;
      // landscape: turning the phone left/right is the beta axis, tilting it toward / away is gamma
      g.look(-(r.beta || 0) * k * inv * land, -(r.gamma || 0) * k * inv * land * 0.8, 'gyro');
    });
  }
  applySettings() {
    const s = this.g.settings;
    document.body.classList.toggle('lefthand', s.hand === 'left');
    this.root.style.setProperty('--op', s.btnOp ?? 0.85);
    if (this.ctl) this.placeControls();
  }
  get R() { return this.joyR || 56 * this.ts; }
  // scale controls with the viewport (reference: 915x412 phone landscape) and keep the HUD proportional
  layout() {
    const vv = window.visualViewport, w = vv ? vv.width : innerWidth, h = vv ? vv.height : innerHeight;
    const k = Math.min(w / 915, h / 412);
    this.ts = Math.max(0.8, Math.min(1.3, k));
    const hud = document.getElementById('hud'); hud.style.setProperty('--ts', this.ts.toFixed(3));
    hud.style.setProperty('--hs', Math.max(0.62, Math.min(1.0, 0.78 * k)).toFixed(3));
    this.placeControls(w, h);
  }
  // put every cut-out control where it sits on the reference sheet (sizes follow the sheet's height, capped by its aspect)
  // Default arrangement (CoD-Mobile style, centre kept clear). x/y = ring centre as fractions of the
  // screen in the right-handed frame, d = ring diameter as a fraction of the screen height.
  static get DEFAULTS() { return {
    joybase: { x: 0.14, y: 0.72, d: 0.27 }, tSprint: { x: 0.285, y: 0.50, d: 0.125 }, tMed: { x: 0.065, y: 0.43, d: 0.125 },
    tFire: { x: 0.845, y: 0.70, d: 0.20 }, tCrouch: { x: 0.95, y: 0.86, d: 0.12 }, tReload: { x: 0.95, y: 0.50, d: 0.12 },
    tAim: { x: 0.70, y: 0.80, d: 0.12 }, tUse: { x: 0.72, y: 0.48, d: 0.13 }, tPause: { x: 0.955, y: 0.10, d: 0.10 },
    tScore: { x: 0.955, y: 0.265, d: 0.09 }, tChat: { x: 0.955, y: 0.375, d: 0.09 },
  }; }
  placeControls(w = innerWidth, h = innerHeight) {
    const S = Math.min(h, w / 1.7917), st = this.g.settings, left = st.hand === 'left';
    const U = st.ctl || {}, G = st.ctlScale || 1, D = TouchControls.DEFAULTS;
    this.ctl = {};
    const ids = { ...CTL_IDS, score: 'tScore', chat: 'tChat' };
    for (const [k, id] of Object.entries(ids)) {
      const el = $(id); if (!el) continue;
      const d = D[id], u = U[id] || {}, c = CTL[k];
      const fx = u.x ?? d.x, fy = u.y ?? d.y, R = d.d / 2 * S * (u.s || 1) * G;
      const fixed = id === 'tPause' || id === 'tScore' || id === 'tChat'; // stay top-right for both hands
      const mirrored = !!el.closest('#tbtns'); // #tbtns flips itself for left-handed
      let cx = fx * w; if (left && (mirrored === fixed)) cx = (1 - fx) * w;
      const cy = fy * h;
      this.ctl[id] = { cx: left && mirrored ? w - cx : cx, cy, R };
      if (!c) { el.style.width = el.style.height = 2 * R + 'px'; el.style.left = cx - R + 'px'; el.style.top = cy - R + 'px'; el.style.margin = '0'; continue; }
      const sc = R / c.r, ew = c.w * sc, eh = c.h * sc;
      el.classList.add('refctl'); el.style.width = ew + 'px'; el.style.height = eh + 'px';
      if (id === 'joybase') { el.style.margin = `${-c.oy * sc}px 0 0 ${-c.ox * sc}px`; this.joyRest = { x: cx, y: cy }; this.joyR = R * 0.42;
        this.knob.style.left = c.ox * sc + 'px'; this.knob.style.top = c.oy * sc + 'px'; const kd = R * 0.78; this.knob.style.width = this.knob.style.height = kd + 'px'; this.knob.style.margin = -kd / 2 + 'px';
        if (this.joyId === null || this.joyId === undefined) { el.style.left = cx + 'px'; el.style.top = cy + 'px'; } }
      else { el.style.left = (cx - c.ox * sc) + 'px'; el.style.top = (cy - c.oy * sc) + 'px'; }
      el.style.setProperty('--rx', c.ox * sc + 'px'); el.style.setProperty('--ry', c.oy * sc + 'px'); el.style.setProperty('--rr', R + 'px');
    }
  }
  bind() {
    const zone = $('touchzone');
    const opt = { passive: false };
    zone.addEventListener('touchstart', (e) => this.onStart(e), opt);
    zone.addEventListener('touchmove', (e) => this.onMove(e), opt);
    zone.addEventListener('touchend', (e) => this.onEnd(e), opt);
    zone.addEventListener('touchcancel', (e) => this.onEnd(e), opt);
    const btn = (el, down, up, look = false) => {
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation(); this.g.sfx.init();
        el.classList.add('down'); down && down(e);
        if (look) for (const t of e.changedTouches) this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
        this.g.haptic(6);
      }, opt);
      el.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); if (look) this.lookMove(e); }, opt);
      const end = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!e.targetTouches.length) el.classList.remove('down');
        up && up(e); for (const t of e.changedTouches) this.lookIds.delete(t.identifier);
      };
      el.addEventListener('touchend', end, opt); el.addEventListener('touchcancel', end, opt);
      return el;
    };
    // fire buttons (right big + left small): hold to shoot, and drag on them to keep aiming
    for (const id of ['tFire', 'tFireL']) btn($(id),
      (e) => { for (const t of e.changedTouches) this.fireIds.add(id + t.identifier); this.inp.fire = true; },
      (e) => { for (const t of e.changedTouches) this.fireIds.delete(id + t.identifier); this.inp.fire = this.fireIds.size > 0; }, true);
    btn($('tAim'), () => { this.inp.aim = !this.inp.aim; });
    btn($('tReload'), () => { this.inp.reloadPressed = true; });
    btn($('tJump'), () => { this.inp.jumpPressed = true; });
    btn($('tCrouch'), () => { this.g.player.crouchToggle = !this.g.player.crouchToggle; });
    btn($('tMed'), () => { this.inp.medkitPressed = true; });
    btn($('tSprint'), () => { const t = performance.now(); if (t - (this.runTap || 0) < 300) { this.inp.jumpPressed = true; this.runTap = 0; } else this.runTap = t; this.inp.sprintToggle = !this.inp.sprintToggle; if (!this.inp.sprintToggle) this.setLock(false); }); // double-tap: jump
    btn($('tPause'), () => this.g.pause());
    // tap the ammo panel to reload
    btn($('tSwap'), () => this.g.player.cycle(1));
    btn($('tUse'), () => { this.inp.usePressed = true; });
    // driving pad (shown instead of the joystick while driving): steer left / right, gas, brake-reverse, horn, camera
    this.inp.drive = { l: false, r: false, gas: false, brake: false };
    for (const [id, key] of [['tSteerL', 'l'], ['tSteerR', 'r'], ['tGas', 'gas'], ['tBrake', 'brake']]) btn($(id), () => { this.inp.drive[key] = true; }, () => { this.inp.drive[key] = false; });
    btn($('tHorn'), () => { this.g.sfx.horn && this.g.sfx.horn(); });
    btn($('tCam'), () => { this.g.driveCamFar = !this.g.driveCamFar; $('tCam').classList.toggle('on', !!this.g.driveCamFar); });
    // ammo panel: tap a weapon slot to switch, swipe left/right to cycle, tap elsewhere for the next weapon
    const ab = $('ammobox'); let sw = null;
    ab.addEventListener('touchstart', (e) => {
      e.preventDefault(); const t = e.changedTouches[0]; const ws = e.target.closest && e.target.closest('.ws');
      if (ws) { this.g.player.switchTo(+ws.dataset.i); this.g.haptic(10); sw = null; return; }
      sw = { id: t.identifier, x: t.clientX, y: t.clientY };
    }, opt);
    ab.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (!sw || t.identifier !== sw.id) continue;
        const dx = t.clientX - sw.x; sw = null;
        if (Math.abs(dx) > 35) { this.g.player.cycle(dx < 0 ? 1 : -1); this.g.haptic(10); }
        else { this.g.player.cycle(1); this.g.haptic(6); } // tap the weapon panel: next weapon
      }
    }, opt);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    addEventListener('contextmenu', (e) => e.preventDefault());
  }
  isJoySide(x) { return this.g.settings.hand === 'left' ? x > innerWidth * 0.6 : x < innerWidth * 0.4; }
  // The stick only spawns in the movement zone: the outer ~40% on the stick side, below the radar strip,
  // and never on top of a button or HUD panel (those keep their own touches).
  inJoyZone(x, y) {
    if (document.body.classList.contains('driving') || !this.isJoySide(x) || y < innerHeight * 0.3) return false;
    const pad = 14 * this.ts;
    for (const el of document.querySelectorAll('#touch .tb, #ammobox, #healthbox, #radarbox, #mpbar, #chatbox, #quickchat')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      if (x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad) return false;
    }
    return true;
  }
  setLock(on) {
    this.inp.sprintLock = on; this.base.classList.toggle('lock', on); this.base.classList.toggle('sprint', on);
    if (on) { Object.assign(this.inp.joy, { active: true, x: 0, y: -1 }); this.g.haptic(25); }
  }
  onStart(e) {
    e.preventDefault(); this.g.sfx.init();
    for (const t of e.changedTouches) {
      if (this.joyId === null && this.inJoyZone(t.clientX, t.clientY)) {
        if (this.inp.sprintLock) this.setLock(false); // touching the stick again cancels sprint lock
        // keep the whole ring on screen
        const R = this.R + 8;
        this.joyId = t.identifier; this.ox = Math.min(innerWidth - R, Math.max(R, t.clientX)); this.oy = Math.min(innerHeight - R, Math.max(R * 1.6, t.clientY));
        this.base.style.left = this.ox + 'px'; this.base.style.top = this.oy + 'px'; this.base.classList.add('on');
        this.setKnob(0, 0); this.inp.joy.active = true;
      } else if (!this.isJoySide(t.clientX)) this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY }); // right side: camera look only
    }
  }
  setKnob(dx, dy) {
    const R = this.R, m = Math.hypot(dx, dy), k = m > R ? R / m : 1;
    // sprint lock: drag straight up past the ring onto the lock icon
    this.reachLock = dy < -R * 1.45 && Math.abs(dx) < R * 0.75;
    this.base.classList.toggle('reach', dy < -R * 0.7);
    this.base.classList.toggle('lock', this.reachLock);
    this.base.classList.toggle('sprint', this.reachLock);
    this.knob.style.transform = `translate(${dx * k / this.ts}px, ${dy * k / this.ts}px)`;
    this.inp.joy.x = dx * k / R; this.inp.joy.y = dy * k / R;
    this.inp.sprintLock = this.reachLock;
  }
  lookMove(e) {
    for (const t of e.changedTouches) {
      const l = this.lookIds.get(t.identifier); if (!l) continue;
      const dx = t.clientX - l.x, dy = t.clientY - l.y; l.x = t.clientX; l.y = t.clientY;
      if (this.g.state === 'playing') this.g.look(dx * 1.6, dy * 1.6, 'touch');
    }
  }
  onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === this.joyId) this.setKnob(t.clientX - this.ox, t.clientY - this.oy);
    this.lookMove(e);
  }
  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        this.joyId = null; this.base.classList.remove('on', 'reach'); if (this.joyRest) { this.base.style.left = this.joyRest.x + 'px'; this.base.style.top = this.joyRest.y + 'px'; } // back to its resting place
        if (this.reachLock) { this.setLock(true); this.knob.style.transform = `translate(0px, ${-this.R / this.ts}px)`; }
        else { Object.assign(this.inp.joy, { active: false, x: 0, y: 0 }); this.setKnob(0, 0); this.base.classList.remove('reach'); }
        this.reachLock = false;
      }
      this.lookIds.delete(t.identifier);
    }
  }
  reset() {
    this.joyId = null; this.lookIds.clear(); this.fireIds.clear(); Object.assign(this.inp.joy, { active: false, x: 0, y: 0 });
    this.inp.sprintToggle = false; this.inp.sprintLock = false; this.inp.fire = false; this.inp.aim = false; if (this.inp.drive) Object.assign(this.inp.drive, { l: false, r: false, gas: false, brake: false });
    this.base.classList.remove('on', 'lock', 'reach', 'sprint'); this.knob.style.transform = '';
    for (const el of this.root.querySelectorAll('.on, .down')) el.classList.remove('on', 'down');
  }
  update() { // reflect state on toggle buttons + reload ring
    const p = this.g.player;
    $('tAim').classList.toggle('on', !!this.inp.aim);
    $('tCrouch').classList.toggle('on', !!p.crouchToggle);
    $('tSprint').classList.toggle('on', !!(this.inp.sprintToggle || this.inp.sprintLock));
    const ring = this.ring || (this.ring = document.querySelector('#tReload .ring circle'));
    ring.style.strokeDashoffset = p.reloading > 0 ? (289 * (p.reloading / this.g.player.reloadTime)).toFixed(1) : 289;
    $('tReload').classList.toggle('low', p.lowAmmo && p.reloading <= 0 && p.reserve > 0);
  }
}

// Must be called from a user gesture (tap). iPhone Safari has no element fullscreen: that case is handled by the
// Add to Home Screen (PWA, display: fullscreen) hint instead.
export async function goFullscreenLandscape() {
  const d = document.documentElement;
  try {
    if (!isFullscreen()) {
      if (d.requestFullscreen) await d.requestFullscreen({ navigationUI: 'hide' });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    }
  } catch (e) {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) {}
}

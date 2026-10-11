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

export class TouchControls {
  constructor(game) {
    this.g = game; this.inp = game.input;
    this.inp.joy = { active: false, x: 0, y: 0 };
    this.joyId = null; this.lookIds = new Map(); this.fireIds = new Set();
    this.root = $('touch'); this.base = $('joybase'); this.knob = $('joyknob');
    document.body.classList.add('mobile');
    this.ts = 1; this.layout();
    this.applySettings();
    this.bind();
  }
  applySettings() {
    const s = this.g.settings;
    document.body.classList.toggle('lefthand', s.hand === 'left');
    this.root.style.setProperty('--op', s.btnOp ?? 0.85);
  }
  get R() { return 56 * this.ts; }
  // scale controls with the viewport (reference: 915x412 phone landscape) and keep the HUD proportional
  layout() {
    const vv = window.visualViewport, w = vv ? vv.width : innerWidth, h = vv ? vv.height : innerHeight;
    const k = Math.min(w / 915, h / 412);
    this.ts = Math.max(0.8, Math.min(1.3, k));
    const hud = document.getElementById('hud'); hud.style.setProperty('--ts', this.ts.toFixed(3));
    hud.style.setProperty('--hs', Math.max(0.62, Math.min(1.0, 0.78 * k)).toFixed(3));
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
    btn($('tSprint'), () => { this.inp.sprintToggle = !this.inp.sprintToggle; if (!this.inp.sprintToggle) this.setLock(false); });
    btn($('tPause'), () => this.g.pause());
    // tap the ammo panel to reload
    btn($('tSwap'), () => this.g.player.cycle(1));
    // ammo panel: tap a weapon slot to switch, swipe left/right to cycle, tap elsewhere to reload
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
        else { this.inp.reloadPressed = true; this.g.haptic(6); }
      }
    }, opt);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    addEventListener('contextmenu', (e) => e.preventDefault());
  }
  isJoySide(x) { return this.g.settings.hand === 'left' ? x > innerWidth * 0.58 : x < innerWidth * 0.42; }
  setLock(on) {
    this.inp.sprintLock = on; this.base.classList.toggle('lock', on); this.base.classList.toggle('sprint', on);
    if (on) { Object.assign(this.inp.joy, { active: true, x: 0, y: -1 }); this.g.haptic(25); }
  }
  onStart(e) {
    e.preventDefault(); this.g.sfx.init();
    for (const t of e.changedTouches) {
      if (this.isJoySide(t.clientX) && this.joyId === null) {
        if (this.inp.sprintLock) this.setLock(false); // touching the stick again cancels sprint lock
        this.joyId = t.identifier; this.ox = t.clientX; this.oy = t.clientY;
        this.base.style.left = this.ox + 'px'; this.base.style.top = this.oy + 'px'; this.base.classList.add('on');
        this.setKnob(0, 0); this.inp.joy.active = true;
      } else this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
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
      if (this.g.state === 'playing') this.g.look(dx * 1.6, dy * 1.6);
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
        this.joyId = null; this.base.classList.remove('on', 'reach');
        if (this.reachLock) { this.setLock(true); this.knob.style.transform = `translate(0px, ${-this.R / this.ts}px)`; }
        else { Object.assign(this.inp.joy, { active: false, x: 0, y: 0 }); this.setKnob(0, 0); this.base.classList.remove('reach'); }
        this.reachLock = false;
      }
      this.lookIds.delete(t.identifier);
    }
  }
  reset() {
    this.joyId = null; this.lookIds.clear(); this.fireIds.clear(); Object.assign(this.inp.joy, { active: false, x: 0, y: 0 });
    this.inp.sprintToggle = false; this.inp.sprintLock = false; this.inp.fire = false; this.inp.aim = false;
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

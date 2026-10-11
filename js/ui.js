// Menus and screens: navigation + transitions, UI sounds, loading tips, loadout (3D gun preview + stat bars),
// tabbed settings (saved to localStorage), touch-button layout editor, dialogs.
import * as THREE from 'three';
import { WEAPONS, WEAPON_BY_ID, PRIMARIES, SECONDARIES } from './weapons.js';
import { buildGun } from './character.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SCREENS = ['menu', 'loadout', 'settings', 'pause', 'gameover', 'mpmenu', 'lobby'];
export const TIPS = [
  'Headshots deal up to three times the damage.',
  'Aim down sights to tighten your spread. Crouching steadies it further.',
  'Hostiles drop ammo crates. Walk over them to restock every weapon.',
  'Press Q to swap straight back to your last weapon.',
  'The SVD scope snaps in when you aim. Hold your breath and squeeze.',
  'The shotgun shreds up close but its pellets lose punch beyond 7 m.',
  'Change your loadout from the main menu: one primary, one secondary.',
  'Multiplayer: host a room and share the 5-letter code or the link.',
  'Kill streaks: chain kills within 4 seconds for DOUBLE and TRIPLE KILL.',
  'On phones, drag the joystick upward past the ring to lock sprint.',
  'Health regenerates after 5 seconds out of combat.',
  'Press V to swap the camera shoulder when peeking around cover.',
  'Rearrange and resize the touch buttons in Settings → Controls.',
];
export const STAT_DEFS = [
  ['DAMAGE', w => Math.min(1, w.dmg * w.pellets / 110), w => w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg],
  ['FIRE RATE', w => Math.min(1, 60 / w.cool / 1100), w => Math.round(60 / w.cool)],
  ['RANGE', w => Math.min(1, (w.range[0] * 0.6 + w.range[1] * 0.4) / 140), w => w.range[0] + 'm'],
  ['MOBILITY', w => w.mob, w => Math.round(w.mob * 100)],
  ['MAGAZINE', w => Math.min(1, w.mag / 34), w => w.mag],
];

export class UI {
  constructor(game) {
    this.g = game; this.stack = []; this.cur = 'loading';
    this.tipI = (Math.random() * TIPS.length) | 0; this.nextTip();
    this.tipTimer = setInterval(() => this.nextTip(), 3800);
    // interface sounds: hover on desktop, press everywhere
    document.addEventListener('pointerdown', () => this.g.sfx.init(), { capture: true });
    document.addEventListener('pointerover', (e) => {
      if (this.g.mobile || e.pointerType === 'touch') return;
      const b = e.target.closest && e.target.closest('button, .lo'); if (!b || b === this.hoverEl || b.closest('#hud')) return;
      this.hoverEl = b; this.g.sfx.ui('hover');
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button, .lo'); if (!b || b.closest('#hud')) return;
      this.g.sfx.ui(b.matches('.back,[data-back]') ? 'back' : b.matches('.primary') ? 'select' : 'press');
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => this.back()));
    $('dlgOk').onclick = () => { $('dialog').classList.add('hidden'); const f = this.dlgCb; this.dlgCb = null; f && f(); };
  }
  nextTip() {
    const el = $('tiptxt'); if (!el) return; this.tipI = (this.tipI + 1) % TIPS.length;
    $('tip').style.opacity = 0; setTimeout(() => { el.textContent = TIPS[this.tipI]; $('tip').style.opacity = 1; }, 250);
  }
  progress(frac, text) {
    const pct = Math.max(this.pct || 0, Math.round(frac * 100)); this.pct = pct;
    $('loadfill').style.width = pct + '%'; $('loadpct').textContent = pct + '%'; if (text) $('loadtxt').textContent = text;
  }
  loaded() { clearInterval(this.tipTimer); $('loading').classList.add('hidden'); }
  // show one screen (null = in-game HUD only)
  show(id, push = true) {
    if (push && this.cur && this.cur !== id && id && !['pause', 'gameover', 'menu'].includes(id)) this.stack.push(this.cur);
    if (!id || ['menu', 'pause', 'gameover'].includes(id)) this.stack = [];
    this.cur = id;
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    const inGame = id === null || id === 'pause' || (id === 'settings' && this.g.inMatch());
    $('hud').classList.toggle('hidden', !inGame);
    if (id === 'loadout') this.openLoadout();
    if (id === 'menu') this.refreshMenu();
    this.g.onScreen && this.g.onScreen(id);
  }
  back() {
    const prev = this.stack.pop() || (this.g.inMatch() ? 'pause' : 'menu');
    if (this.cur === 'loadout') this.closeLoadout();
    this.show(prev, false);
  }
  dialog(title, text, cb) { $('dlgTitle').textContent = title; $('dlgText').textContent = text; $('dialog').classList.remove('hidden'); this.dlgCb = cb; }
  refreshMenu() {
    const s = this.g.settings;
    $('loadoutsum').textContent = s.allWeapons ? 'All six weapons (solo)' : `${WEAPON_BY_ID[s.primary].name} + ${WEAPON_BY_ID[s.secondary].name}`;
    $('menuname').textContent = s.name;
  }

  // ---------------- settings (tabs, all saved to localStorage) ----------------
  bindSettings() {
    const g = this.g, s = g.settings;
    const save = () => localStorage.setItem('swat-settings', JSON.stringify(s));
    const bind = (id, key, fmt, num = true, after) => {
      const el = $(id), val = $('val' + id.slice(3));
      if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = s[key];
      const upd = () => { s[key] = el.type === 'checkbox' ? el.checked : num ? parseFloat(el.value) : el.value; if (val) val.textContent = fmt ? fmt(s[key]) : ''; };
      upd();
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => { upd(); save(); after && after(); });
    };
    const pct = v => Math.round(v * 100) + '%';
    bind('optQuality', 'quality', null, false, () => g.applySettings()); bind('optRes', 'res', null, false, () => g.applySettings());
    bind('optFov', 'fov', v => v + '°'); bind('optFps', 'fps');
    bind('optSens', 'sens', v => v.toFixed(2)); bind('optAdsSens', 'adsSens', v => v.toFixed(2)); bind('optInvert', 'invert');
    bind('optHand', 'hand', null, false, () => { g.touch && g.touch.applySettings(); this.applyLayout(); });
    bind('optBtnOp', 'btnOp', pct, true, () => g.touch && g.touch.applySettings()); bind('optHaptics', 'haptics');
    const vol = () => g.sfx.setVolume(s.vol, s.fxVol, s.uiVol);
    bind('optVol', 'vol', pct, true, vol); bind('optFxVol', 'fxVol', pct, true, vol); bind('optUiVol', 'uiVol', pct, true, () => { vol(); g.sfx.ui('hover'); });
    bind('optName', 'name', null, false, () => { s.name = cleanName(s.name) || s.name; this.refreshMenu(); });
    $('optName').addEventListener('change', () => { s.name = cleanName($('optName').value) || 'Operator'; $('optName').value = s.name; save(); this.refreshMenu(); });
    bind('optDmgNum', 'dmgNum'); bind('optXp', 'xp'); bind('optXhair', 'xhair', null, false, () => g.hud.applyCrosshair()); bind('optAllW', 'allWeapons', null, true, () => this.refreshMenu());
    const tabs = [...$('setTabs').children];
    tabs.forEach(b => b.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('on', t === b));
      document.querySelectorAll('.setbody .tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab));
    }));
    $('btnLayout').onclick = () => this.editLayout();
    $('btnSettings').onclick = () => this.show('settings');
    $('btnPauseSettings').onclick = () => this.show('settings');
    $('btnLoadout').onclick = () => this.show('loadout');
  }

  // ---------------- touch layout editor ----------------
  // positions are stored as button-centre fractions of the screen in the right-handed frame (mirrored for left-handed)
  applyLayout() {
    const L = this.g.settings.layout || {};
    for (const el of document.querySelectorAll('#tbtns .tb')) {
      const c = L[el.id];
      if (c) { el.classList.add('custom'); el.style.left = (c.x * 100).toFixed(2) + '%'; el.style.top = (c.y * 100).toFixed(2) + '%'; el.style.setProperty('--tx', '-50%'); el.style.setProperty('--ty', '-50%'); el.style.setProperty('--bs', c.s || 1); }
      else { el.classList.remove('custom'); el.style.left = el.style.top = ''; el.style.removeProperty('--tx'); el.style.removeProperty('--ty'); el.style.removeProperty('--bs'); }
    }
  }
  editLayout() {
    const g = this.g; if (!g.touch) return;
    const s = g.settings; s.layout = s.layout || {};
    const work = JSON.parse(JSON.stringify(s.layout));
    document.body.classList.add('editing'); $('layouted').classList.remove('hidden'); $('settings').classList.add('hidden');
    $('hud').classList.remove('hidden');
    let sel = null, drag = null;
    const btns = [...document.querySelectorAll('#tbtns .tb')];
    const W = () => innerWidth, H = () => innerHeight, left = () => s.hand === 'left';
    const centre = (el) => { const r = el.getBoundingClientRect(); let x = (r.left + r.width / 2) / W(); if (left()) x = 1 - x; return { x, y: (r.top + r.height / 2) / H() }; };
    const select = (el) => { sel = el; btns.forEach(b => b.classList.toggle('sel', b === el)); $('leSize').value = (work[el.id] && work[el.id].s) || 1; };
    const apply = () => { const keep = s.layout; s.layout = work; this.applyLayout(); s.layout = keep; };
    const down = (e) => {
      const el = e.target.closest('.tb'); if (!el || !btns.includes(el)) return;
      e.preventDefault(); e.stopPropagation(); select(el);
      if (!work[el.id]) work[el.id] = { ...centre(el), s: 1 };
      drag = { id: e.pointerId, el, sx: e.clientX, sy: e.clientY, ox: work[el.id].x, oy: work[el.id].y };
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return; e.preventDefault();
      let dx = (e.clientX - drag.sx) / W(); if (left()) dx = -dx;
      const c = work[drag.el.id]; c.x = Math.min(0.97, Math.max(0.03, drag.ox + dx)); c.y = Math.min(0.96, Math.max(0.12, drag.oy + (e.clientY - drag.sy) / H()));
      apply();
    };
    const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    const tb = $('tbtns'); tb.style.pointerEvents = 'auto';
    tb.addEventListener('pointerdown', down, true); addEventListener('pointermove', move, true); addEventListener('pointerup', up, true);
    $('leSize').oninput = () => { if (!sel) return; if (!work[sel.id]) work[sel.id] = { ...centre(sel), s: 1 }; work[sel.id].s = parseFloat($('leSize').value); apply(); };
    const finish = (keep) => {
      tb.removeEventListener('pointerdown', down, true); removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true);
      tb.style.pointerEvents = ''; btns.forEach(b => b.classList.remove('sel'));
      if (keep) { s.layout = work; localStorage.setItem('swat-settings', JSON.stringify(s)); }
      this.applyLayout(); document.body.classList.remove('editing'); $('layouted').classList.add('hidden');
      g.touch.reset(); this.show('settings', false);
    };
    $('leDone').onclick = () => finish(true);
    $('leReset').onclick = () => { for (const k in work) delete work[k]; apply(); sel && select(sel); };
    this.layoutTest = { work, finish, select }; // for headless tests
  }

  // ---------------- loadout: rotating 3D preview of the selected gun ----------------
  bindLoadout() {
    this.loSlot = 0;
    [...$('loTabs').children].forEach(b => b.addEventListener('click', () => { this.loSlot = +b.dataset.slot; this.renderLoadoutList(); }));
    $('loEquip').onclick = () => this.equip(this.loSel);
  }
  openLoadout() {
    const g = this.g;
    if (!this.pv) {
      const sc = new THREE.Scene(); sc.environment = g.scene.environment; sc.background = g.scene.background;
      sc.backgroundBlurriness = 0.5; sc.backgroundIntensity = 0.28; sc.environmentIntensity = 1.1;
      const key = new THREE.DirectionalLight(0xfff2e0, 2.6); key.position.set(2, 3, 2); sc.add(key);
      const rim = new THREE.DirectionalLight(0xa8c8ff, 1.8); rim.position.set(-3, 1.5, -2); sc.add(rim);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
      const pivot = new THREE.Group(); sc.add(pivot);
      this.pv = { sc, cam, pivot, guns: {}, t: 0 };
    }
    this.loSel = [this.g.settings.primary, this.g.settings.secondary][this.loSlot];
    this.renderLoadoutList(); this.preview(this.loSel);
  }
  closeLoadout() {}
  renderLoadoutList() {
    const s = this.g.settings, ids = this.loSlot === 0 ? PRIMARIES : SECONDARIES, eq = this.loSlot === 0 ? s.primary : s.secondary;
    [...$('loTabs').children].forEach(b => b.classList.toggle('on', +b.dataset.slot === this.loSlot));
    if (!ids.includes(this.loSel)) this.loSel = eq;
    $('loList').innerHTML = ids.map(id => { const w = WEAPON_BY_ID[id]; return `<div class="lo${id === this.loSel ? ' sel' : ''}${id === eq ? ' eq' : ''}" data-id="${id}"><img src="${w.thumb}" alt=""><div><b>${w.name}</b><small>${w.cls}</small></div></div>`; }).join('');
    $('loList').querySelectorAll('.lo').forEach(el => {
      el.addEventListener('click', () => { if (this.loSel === el.dataset.id) { this.equip(el.dataset.id); return; } this.loSel = el.dataset.id; this.renderLoadoutList(); this.preview(this.loSel); });
    });
    $('loP').textContent = WEAPON_BY_ID[s.primary].name; $('loS').textContent = WEAPON_BY_ID[s.secondary].name;
    $('loEquip').textContent = this.loSel === eq ? 'EQUIPPED' : 'EQUIP ' + (this.loSlot === 0 ? 'PRIMARY' : 'SECONDARY');
    $('loEquip').disabled = this.loSel === eq;
    this.statBars(WEAPON_BY_ID[this.loSel]);
  }
  equip(id) {
    const s = this.g.settings;
    if (this.loSlot === 0) { s.primary = id; if (s.secondary === id) s.secondary = SECONDARIES.find(x => x !== id); }
    else { s.secondary = id; if (s.primary === id) s.primary = PRIMARIES.find(x => x !== id); }
    localStorage.setItem('swat-settings', JSON.stringify(s)); this.g.sfx.switchWeapon(); this.renderLoadoutList(); this.refreshMenu();
  }
  statBars(w) {
    $('loName').textContent = w.name; $('loClass').textContent = w.cls + (w.auto ? ' · FULL AUTO' : w.pump ? ' · PUMP ACTION' : ' · SEMI AUTO');
    if (!$('loStats').children.length) $('loStats').innerHTML = STAT_DEFS.map(([n]) => `<div class="stat"><span>${n}</span><div class="bar"><i></i></div><em></em></div>`).join('');
    [...$('loStats').children].forEach((el, i) => { el.querySelector('i').style.width = (STAT_DEFS[i][1](w) * 100).toFixed(0) + '%'; el.querySelector('em').textContent = STAT_DEFS[i][2](w); });
  }
  preview(id) {
    const pv = this.pv; if (!pv) return;
    if (!pv.guns[id]) {
      const g = buildGun(this.g.factory.gunScenes[id], WEAPON_BY_ID[id]).group;
      const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const holder = new THREE.Group(); g.position.sub(c); holder.add(g); holder.userData.size = Math.max(sz.x, sz.y, sz.z);
      holder.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      pv.guns[id] = holder;
    }
    pv.pivot.clear(); pv.pivot.add(pv.guns[id]); pv.size = pv.guns[id].userData.size; pv.spin = 0.6; pv.pivot.rotation.y = -Math.PI / 2 - 0.35; // start side-on, muzzle to the right
  }
  // called every frame while the loadout screen is open; returns true if it rendered
  renderPreview(dt) {
    const pv = this.pv; if (!pv || this.cur !== 'loadout') return false;
    const r = this.g.renderer, w = innerWidth, h = innerHeight;
    pv.t += dt; pv.spin = Math.max(0, pv.spin - dt * 0.8);
    pv.pivot.rotation.y += dt * (0.45 + pv.spin * 2.5); pv.pivot.rotation.x = Math.sin(pv.t * 0.7) * 0.06;
    const cam = pv.cam; cam.aspect = w / h;
    const dist = pv.size * 0.62 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.max(1, 1.9 / (w / h));
    cam.position.set(0, pv.size * 0.12, dist); cam.lookAt(0, 0, 0);
    // put the gun in the right part of the screen (the list is on the left)
    const sh = w > h * 1.2 ? -w * 0.17 : 0; cam.setViewOffset(w, h, sh, h * (h < 520 ? 0.25 : 0.2), w, h); cam.updateProjectionMatrix();
    r.render(pv.sc, cam); return true;
  }
}
export function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14); }

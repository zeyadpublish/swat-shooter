// Menus and screens: navigation + transitions, UI sounds, loading tips, loadout (3D gun preview + stat bars),
// tabbed settings (saved to localStorage), touch-button layout editor, dialogs.
import { prog, owns, buy, PRICES, fmt, rankOK, rankReq, rankName } from './prog.js';
import * as THREE from 'three';
import { WEAPONS, WEAPON_BY_ID, PRIMARIES, SECONDARIES } from './weapons.js';
import { buildGun } from './character.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SCREENS = ['menu', 'loadout', 'operators', 'store', 'settings', 'pause', 'gameover', 'mpmenu', 'lobby', 'maps', 'campaign', 'briefing'];
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
  ['FIRE RATE', w => Math.min(1, 60 / w.cool / 1000), w => Math.round(60 / w.cool)],
  ['RANGE', w => Math.min(1, (w.range[0] * 0.6 + w.range[1] * 0.4) / 140), w => w.range[0] + 'm'],
  ['MOBILITY', w => w.mob, w => Math.round(w.mob * 100)],
  // accuracy from the aimed spread, control from the recoil kick (both real weapon values)
  ['ACCURACY', w => Math.max(0.08, Math.min(1, 1 - Math.log10(w.ads / 0.0002) / 2.4)), w => Math.round(Math.max(0.08, Math.min(1, 1 - Math.log10(w.ads / 0.0002) / 2.4)) * 100)],
  ['CONTROL', w => Math.max(0.1, Math.min(1, 1 - (w.recoil - 0.008) / 0.06)), w => Math.round(Math.max(0.1, Math.min(1, 1 - (w.recoil - 0.008) / 0.06)) * 100)],
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
    if (id === 'settings' && this.g.settingsUI) { this.g.settingsUI.fit(); this.g.settingsUI.refresh(); }
    this.g.meta && this.g.meta.onShow(id);
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
    $('loadoutsum').textContent = s.allWeapons ? 'All unlocked weapons (solo)' : `${WEAPON_BY_ID[owns('gun', s.primary) ? s.primary : 'm4a1'].name} + ${WEAPON_BY_ID[s.secondary].name}`;
    $('menuname').textContent = s.name;
  }

  // ---------------- settings (tabs, all saved to localStorage) ----------------
  bindSettings() {
    // v1.6: the settings sheet itself is js/settings.js (SettingsUI); only the entry points live here
    $('btnLayout').onclick = () => { if (this.g.touch) this.editLayout(); else this.g.hud.toast('HUD LAYOUT EDITOR IS FOR TOUCH SCREENS'); };
    $('btnSettings').onclick = () => this.show('settings');
    $('btnPauseSettings').onclick = () => this.show('settings');
    $('btnLoadout').onclick = () => this.show('loadout');
  }

  // ---------------- touch layout editor ----------------
  // positions are stored as button-centre fractions of the screen in the right-handed frame (mirrored for left-handed)
  applyLayout() { if (this.g.touch) this.g.touch.placeControls(); }
  // Customize Controls: drag any on-foot control, per-control size slider, global size slider, reset, save.
  // Stored in settings.ctl = { id: { x, y, s } } (ring centre, right-handed frame) and settings.ctlScale.
  editLayout() {
    const g = this.g; if (!g.touch) return;
    const s = g.settings;
    const saved = { ctl: JSON.parse(JSON.stringify(s.ctl || {})), ctlScale: s.ctlScale || 1 };
    const work = JSON.parse(JSON.stringify(saved.ctl)); let gscale = saved.ctlScale;
    document.body.classList.add('editing'); $('layouted').classList.remove('hidden'); $('settings').classList.add('hidden');
    $('hud').classList.remove('hidden');
    const D = g.touch.constructor.DEFAULTS;
    const ids = ['joybase', 'tSprint', 'tMed', 'tUse', 'tAim', 'tPause', 'tReload', 'tFire', 'tCrouch'];
    const els = ids.map(id => $(id)).filter(Boolean);
    let sel = null, drag = null;
    const W = () => innerWidth, H = () => innerHeight, left = () => s.hand === 'left';
    const apply = () => { s.ctl = work; s.ctlScale = gscale; g.touch.placeControls(); };
    const cur = (id) => { const d = D[id], u = work[id] || {}; return { x: u.x ?? d.x, y: u.y ?? d.y, s: u.s || 1 }; };
    const select = (el) => { sel = el; els.forEach(b => b.classList.toggle('sel', b === el)); $('leSize').value = cur(el.id).s; $('leName').textContent = (el.dataset.label || 'JOYSTICK'); };
    const down = (e) => {
      const el = e.target.closest && e.target.closest('.refctl'); if (!el || !els.includes(el)) return;
      e.preventDefault(); e.stopPropagation(); select(el);
      work[el.id] = cur(el.id);
      drag = { id: e.pointerId, el, sx: e.clientX, sy: e.clientY, ox: work[el.id].x, oy: work[el.id].y };
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return; e.preventDefault();
      const fixed = drag.el.id === 'tPause';
      let dx = (e.clientX - drag.sx) / W(); if (left() && !fixed) dx = -dx;
      const c = work[drag.el.id]; c.x = Math.min(0.97, Math.max(0.03, drag.ox + dx)); c.y = Math.min(0.95, Math.max(0.05, drag.oy + (e.clientY - drag.sy) / H()));
      apply();
    };
    const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    const root = $('touch');
    root.addEventListener('pointerdown', down, true); addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    $('leSize').value = 1; $('leAll').value = gscale; $('leName').textContent = 'TAP A CONTROL';
    $('leSize').oninput = () => { if (!sel) return; work[sel.id] = cur(sel.id); work[sel.id].s = parseFloat($('leSize').value); apply(); };
    $('leAll').oninput = () => { gscale = parseFloat($('leAll').value); apply(); };
    const finish = (keep) => {
      root.removeEventListener('pointerdown', down, true); removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
      els.forEach(b => b.classList.remove('sel'));
      if (keep) { s.ctl = work; s.ctlScale = gscale; localStorage.setItem('swat-settings', JSON.stringify(s)); g.settingsUI && g.settingsUI.onLayoutSaved(); }
      else { s.ctl = saved.ctl; s.ctlScale = saved.ctlScale; }
      g.touch.placeControls(); document.body.classList.remove('editing'); $('layouted').classList.add('hidden');
      g.touch.reset(); this.show('settings', false);
    };
    $('leDone').onclick = () => finish(true);
    $('leCancel').onclick = () => finish(false);
    $('leReset').onclick = () => { for (const k in work) delete work[k]; gscale = 1; $('leAll').value = 1; $('leSize').value = 1; apply(); };
    this.layoutTest = { work, finish, select, apply, setAll: (v) => { gscale = v; apply(); } }; // for headless tests
  }

  // ---------------- loadout: rotating 3D preview of the selected gun ----------------
  bindLoadout() {
    this.loSlot = 0;
    [...$('loTabs').children].forEach(b => b.addEventListener('click', () => { this.loSlot = +b.dataset.slot; this.renderLoadoutList(); }));
    $('loEquip').onclick = () => {
      const id = this.loSel;
      if (!owns('gun', id)) { const pr = PRICES.guns[id]; if (!rankOK('gun', id)) { this.dialog('RANK REQUIRED', `${WEAPON_BY_ID[id].name} unlocks at rank ${rankReq('gun', id)} (${rankName(rankReq('gun', id))}). Earn XP from kills, waves, matches and campaign missions.`); return; } if (!buy('gun', id, pr)) { this.dialog('NOT ENOUGH COINS', `${WEAPON_BY_ID[id].name} costs ${fmt(pr)} coins. You have ${fmt(prog().coins)}.`); return; } this.g.sfx.coins && this.g.sfx.coins(); this.g.meta.refreshTop(); }
      this.equip(id);
    };
    $('loSmith').onclick = () => { const w = WEAPON_BY_ID[this.loSel]; this.dialog('GUNSMITH', `${w.name}: attachments and upgrades are not in this version yet. Barrel, optic and stock are the stock parts shown on the model.`); };
  }
  openLoadout() {
    const g = this.g;
    if (!this.pv) {
      const sc = new THREE.Scene(); sc.environment = g.scene.environment; sc.background = pegboard(); sc.environmentIntensity = 1.1;
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
    const status = (id) => owns('gun', id) ? (id === eq ? '<em class="eq">EQUIPPED</em>' : '<em class="own">OWNED</em>') : !rankOK('gun', id) ? `<em class="rk"><span class="lock"></span>RANK ${rankReq('gun', id)}</em>` : `<em class="price"><i class="coinic"></i>${fmt(PRICES.guns[id])}</em>`;
    $('loList').innerHTML = ids.map(id => { const w = WEAPON_BY_ID[id], own = owns('gun', id); return `<div class="lo${id === this.loSel ? ' sel' : ''}${id === eq ? ' eq' : ''}${own ? '' : ' locked'}" data-id="${id}"><div class="lt"><b>${w.name}</b><small>${w.cls}</small></div><img src="${w.thumb}" alt="">${status(id)}</div>`; }).join('')
      + `<div class="lo sum"><div><b>PRIMARY</b><small id="loP">${WEAPON_BY_ID[s.primary].name}</small></div><div><b>SECONDARY</b><small id="loS">${WEAPON_BY_ID[s.secondary].name}</small></div></div>`;
    $('loList').querySelectorAll('.lo:not(.sum)').forEach(el => {
      el.addEventListener('click', () => { if (this.loSel === el.dataset.id) { $('loEquip').click(); return; } this.loSel = el.dataset.id; this.renderLoadoutList(); this.preview(this.loSel); });
    });
    const own = owns('gun', this.loSel);
    if (own) $('loEquip').textContent = this.loSel === eq ? 'EQUIPPED' : 'EQUIP ' + (this.loSlot === 0 ? 'PRIMARY' : 'SECONDARY');
    else if (!rankOK('gun', this.loSel)) $('loEquip').innerHTML = `RANK ${rankReq('gun', this.loSel)} REQUIRED`;
    else $('loEquip').innerHTML = `UNLOCK <i class="coinic"></i> ${fmt(PRICES.guns[this.loSel])}`;
    $('loEquip').disabled = own && this.loSel === eq; $('loEquip').classList.toggle('cant', !own && (prog().coins < PRICES.guns[this.loSel] || !rankOK('gun', this.loSel)));
    this.statBars(WEAPON_BY_ID[this.loSel]);
  }
  equip(id) {
    const s = this.g.settings;
    if (this.loSlot === 0) { s.primary = id; if (s.secondary === id) s.secondary = SECONDARIES.find(x => x !== id); }
    else { s.secondary = id; if (s.primary === id) s.primary = PRIMARIES.find(x => x !== id); }
    localStorage.setItem('swat-settings', JSON.stringify(s)); this.g.sfx.switchWeapon(); this.renderLoadoutList(); this.refreshMenu();
  }
  statBars(w) {
    $('loName').textContent = w.name; $('loClass').textContent = w.cls + (w.auto ? ' • FULL AUTO' : w.pump ? ' • PUMP ACTION' : w.scope ? ' • BOLT / SCOPED' : ' • SEMI AUTO');
    // segmented bars, two columns (DAMAGE / FIRE RATE / RANGE | MOBILITY / ACCURACY / CONTROL)
    if (!$('loStats').children.length) $('loStats').innerHTML = STAT_DEFS.map(([n]) => `<div class="stat"><span>${n}</span><div class="bar">${'<i></i>'.repeat(16)}</div><em></em></div>`).join('');
    [...$('loStats').children].forEach((el, i) => { const n = Math.round(STAT_DEFS[i][1](w) * 16); [...el.querySelector('.bar').children].forEach((x, j) => x.classList.toggle('on', j < n)); el.querySelector('em').textContent = STAT_DEFS[i][2](w); });
    $('loSpecs').innerHTML = `<span><small>FIRE MODE</small>${w.auto ? 'AUTO' : w.pump ? 'PUMP' : w.scope ? 'BOLT' : 'SEMI'}</span><span><small>MAGAZINE</small>${w.mag}</span><span><small>RESERVE</small>${w.reserve ?? w.mag * 6}</span>`;
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
    pv.pivot.clear(); pv.pivot.add(pv.guns[id]); pv.size = pv.guns[id].userData.size; pv.spin = 0.6; pv.pivot.rotation.y = -Math.PI / 2 - 0.35; pv.t = 0; // start side-on, muzzle to the right
    // callout anchors in the gun's local frame: muzzle end, top centre (optic / sights), butt end
    const bb = new THREE.Box3().setFromObject(pv.guns[id]); const ax = (bb.max.x - bb.min.x) > (bb.max.z - bb.min.z) ? 'x' : 'z', V = (u, y) => ax === 'x' ? new THREE.Vector3(-u, y, 0) : new THREE.Vector3(0, y, u); /* rotation -90° about y: local -z (or +x) is the muzzle side */
    const lo = ax === 'x' ? -bb.max.x : bb.min.z, hi = ax === 'x' ? -bb.min.x : bb.max.z;
    pv.anchors = { barrel: V(hi * 0.84, bb.max.y * 0.2), optic: V((lo + hi) * 0.5 + (hi - lo) * 0.04, bb.max.y * 0.9), stock: V(lo * 0.8, bb.max.y * 0.4) };
  }
  // called every frame while the loadout screen is open; returns true if it rendered
  renderPreview(dt) {
    const pv = this.pv; if (!pv || this.cur !== 'loadout') return false;
    const r = this.g.renderer, w = innerWidth, h = innerHeight;
    pv.t += dt; pv.spin = Math.max(0, pv.spin - dt * 0.8);
    // v1.7: shown side-on like the gunsmith shot, swaying slowly (drag-free), with a spin when a gun is picked
    pv.pivot.rotation.y = -Math.PI / 2 + Math.sin(pv.t * 0.45) * 0.32 + pv.spin * 6.3; pv.pivot.rotation.x = Math.sin(pv.t * 0.7) * 0.04;
    const cam = pv.cam; cam.aspect = w / h; cam.fov = 30;
    const dist = pv.size / (0.9 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (w / h)); // the gun spans ~45% of the width
    cam.position.set(0, pv.size * 0.05, dist); cam.lookAt(0, 0, 0);
    // the gun sits upper-right (the list is left, the stat panel below)
    cam.setViewOffset(w, h, -w * 0.18, h * 0.07, w, h); cam.updateProjectionMatrix();
    r.render(pv.sc, cam);
    // callouts follow their anchor points
    const g0 = pv.pivot.children[0]; if (g0 && pv.anchors) { pv.pivot.updateMatrixWorld(true);
      for (const el of $('callouts').children) { const a = pv.anchors[el.dataset.c]; const v = a.clone().applyMatrix4(pv.pivot.matrixWorld).project(cam);
        const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k17')) || 1; el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w / k).toFixed(0)}px, ${((-v.y * 0.5 + 0.5) * h / k).toFixed(0)}px)`; /* #callouts lives on the scaled stage */ } }
    return true;
  }
}
// dark workshop pegboard behind the gunsmith view (canvas texture)
function pegboard() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#2a2e31'); gr.addColorStop(1, '#151719'); x.fillStyle = gr; x.fillRect(0, 0, 1024, 512);
  for (let yy = 14; yy < 512; yy += 22) for (let xx = 14; xx < 1024; xx += 22) { x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.arc(xx, yy, 3.4, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.05)'; x.beginPath(); x.arc(xx + 0.8, yy + 1, 3.4, 0, 3.2); x.fill(); }
  // hanging tool silhouettes
  x.fillStyle = 'rgba(10,11,12,.55)'; for (let i = 0; i < 9; i++) { const xx = 360 + i * 64, L = 70 + (i * 37) % 60; x.fillRect(xx, 60, 7, L); x.fillRect(xx - 9, 60 + L, 25, 14); }
  const v = x.createRadialGradient(512, 230, 80, 512, 256, 620); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.75)'); x.fillStyle = v; x.fillRect(0, 0, 1024, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14); }

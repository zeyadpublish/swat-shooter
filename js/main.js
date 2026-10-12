import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SettingsUI, SET_DEFAULTS, GFX_PRESETS, migrateSettings } from './settings.js';
import { Voice } from './voice.js';
import { World, analyzeHDR } from './world.js';
import { MAPS, MAP_BY_ID } from './maps.js';
import { Campaign } from './campaign.js';
import { raycastBoxes } from './physics.js';
import { CharacterFactory, ENEMY_LOOKS, enemyLook, RIGS } from './character.js';
import { FX } from './fx.js';
import { Vehicles } from './vehicle.js';
import { Sfx } from './audio.js';
import { Player, fwdVec, rightVec } from './player.js';
import { Enemy } from './enemy.js';
import { TouchControls, isTouchDevice, goFullscreenLandscape, isIOS, isStandalone, fullscreenSupported, isFullscreen } from './touch.js';
import { ICONS, icon } from './icons.js';
import { WEAPONS, WEAPON_BY_ID } from './weapons.js';
import { Pickups } from './pickups.js';
import { asset, MOBILE_ASSETS } from './assets.js';
import { UI, cleanName, esc } from './ui.js';
import { MP } from './mp.js';
import { PRIMARIES, SECONDARIES } from './weapons.js';
import { prog, save as saveProg, addCoins, addXP, levelOf, owns, COINS, fmt , rankName, RANK_REQ } from './prog.js';
import { Meta } from './meta.js';

const $ = (id) => document.getElementById(id);
const QUALITY = {
  low: { shadow: 1024, ao: false, bloom: false, msaa: 0, prCap: 1.0, shadowChars: true },
  medium: { shadow: 2048, ao: false, bloom: true, msaa: 4, prCap: 1.5, shadowChars: true },
  high: { shadow: 4096, ao: true, bloom: true, msaa: 4, prCap: 2, shadowChars: true },
  ultra: { shadow: 4096, ao: true, bloom: true, msaa: 4, prCap: 3, shadowChars: true },
  // phones / tablets: no GTAO, no bloom, no MSAA, 1024 shadows, pixel ratio capped at 1.5, lighter city
  mobile: { shadow: 1024, ao: false, bloom: false, msaa: 0, prCap: 1.5, shadowChars: true },
};
// main-menu depth of field: blur grows with distance from the focus point (the operator), 12-tap disc
const MenuDOF = {
  uniforms: { tDiffuse: { value: null }, focus: { value: new THREE.Vector2(0.62, 0.5) }, aspect: { value: 1.7 }, px: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, amount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 focus; uniform float aspect; uniform vec2 px; uniform float amount; varying vec2 vUv;
    void main() {
      vec2 d = (vUv - focus) * vec2(aspect, 1.0); float m = smoothstep(0.22, 0.75, length(d)) * amount;
      float vig = mix(1.0, smoothstep(1.25, 0.35, length((vUv - vec2(0.62, 0.5)) * vec2(aspect * 0.8, 1.15))), 0.6 * amount);
      vec4 c = texture2D(tDiffuse, vUv); if (m < 0.01) { gl_FragColor = vec4(c.rgb * vig, c.a); return; }
      vec4 acc = c; float r = m * 5.0;
      for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996; float rr = sqrt(float(i) + 0.5) / 3.5; acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr * r * px * 2.0); }
      acc /= 13.0; gl_FragColor = vec4(acc.rgb * vig, acc.a);
    }`,
};
const TINTS = [0x9c8a6e, 0x7d8a63, 0x9a6458, 0x6f7a8c, 0x8a8a8a];
const params = new URLSearchParams(location.search);
const MOBILE = isTouchDevice();

class HUD {
  constructor(game) {
    this.g = game; this.hmT = 0; this.dirs = []; this.bannerT = 0; this.last = {};
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] || '';
    $('hpsegs').innerHTML = '<i></i>'.repeat(10); this.segs = [...$('hpsegs').children];
    this.radar = $('radarc').getContext('2d');
    this.disp = { score: 0, kills: 0, hp: 100 }; this.multi = []; this.lifeKills = 0; this.bestStreak = 0; this.beatT = 0;
  }
  // weapon slot strip, built from the current loadout
  buildSlots() {
    const sl = this.g.player.slots, key = sl.map(s => s.w.id).join();
    if (this.slotKey === key) return; this.slotKey = key;
    $('wslots').innerHTML = sl.map((s, i) => `<div class="ws" data-i="${i}" title="${s.w.name}"><b>${i + 1}</b><img src="${s.w.thumb}" alt="${s.w.name}"></div>`).join('');
    this.slotEls = [...$('wslots').children]; this.last.sel = -1;
    for (const el of this.slotEls) el.addEventListener('mousedown', (e) => { e.stopPropagation(); this.g.player && this.g.player.switchTo(+el.dataset.i); });
  }
  applyCrosshair() { const s = this.g.settings, c = $('crosshair'); c.style.setProperty('--xc', s.xhair || '#fff'); c.style.setProperty('--xo', s.xOp ?? 1); c.classList.toggle('nodot', s.xDot === false); c.style.scale = s.xScale ?? 1; }
  subtitle(text) { if (!this.g.settings.subs) return; const el = $('subs'); if (!el) return; el.textContent = text; clearTimeout(this.subT); this.subT = setTimeout(() => el.textContent = '', 2600); }
  resetMatch() { this.disp = { score: 0, kills: 0, hp: 100 }; this.multi = []; this.lifeKills = 0; this.bestStreak = 0; $('streak').innerHTML = ''; $('popups').innerHTML = ''; this.feedItems = []; $('killfeed').innerHTML = ''; $('wavecard').classList.add('hidden'); }
  resetStreak() { this.lifeKills = 0; this.multi = []; }
  // the local player scored a kill: multi-kill / spree banners, +XP popup
  onLocalKill(pts, head) {
    const t = this.g.time; this.multi = this.multi.filter(x => t - x < 4); this.multi.push(t);
    this.lifeKills++; this.bestStreak = Math.max(this.bestStreak, this.lifeKills);
    const n = this.multi.length, L = this.lifeKills;
    let big = null, small = '';
    if (L === 5) { big = 'KILLING SPREE'; small = '5 KILLS'; } else if (L === 10) { big = 'UNSTOPPABLE'; small = '10 KILLS'; } else if (L === 15) { big = 'GODLIKE'; small = '15 KILLS'; }
    else if (n === 2) { big = 'DOUBLE KILL'; } else if (n === 3) { big = 'TRIPLE KILL'; } else if (n >= 4) { big = 'MULTI KILL'; small = n + ' KILLS'; }
    const g = this.g; g.earn.kills++; if (head) g.earn.hs++;
    g.reward(COINS.kill + (head ? COINS.headshot : 0), 100 + (head ? 50 : 0));
    if (big) {
      const sxp = { 'DOUBLE KILL': 50, 'TRIPLE KILL': 100, 'MULTI KILL': 150, 'KILLING SPREE': 250, UNSTOPPABLE: 500, GODLIKE: 750 }[big] || 50;
      g.earn.streakXP += sxp; g.earn.streakCoins += COINS.streak; g.reward(COINS.streak, sxp);
      $('streak').innerHTML = `<div class="sk">${big}<small>${small ? small + ' · ' : ''}+${sxp} XP</small></div>`; g.sfx.streak(Math.min(4, n >= 2 ? n - 1 : L / 5)); g.sfx.announce(big.toLowerCase());
    }
    if (g.settings.xp) { this.popup(`<b>+100</b> KILL`); if (head) this.popup(`<b>+50</b> HEADSHOT`, true); }
  }
  popup(html, hs) {
    const d = document.createElement('div'); d.className = 'xp' + (hs ? ' hs' : ''); d.innerHTML = html;
    d.style.top = (-10 + $('popups').children.length * 22) + 'px'; $('popups').appendChild(d); setTimeout(() => d.remove(), 1400);
  }
  toast(text, cls = '') { const t = $('hudtoast'); t.textContent = text; t.className = 'on ' + cls; clearTimeout(this.toastT2); this.toastT2 = setTimeout(() => t.className = '', 1400); }
  // compass strip: 15° ticks, cardinal letters, numeric heading
  compass() {
    const yaw = this.g.player.yaw, deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    if (!this.compBuilt) {
      let h = ''; for (let a = -360; a <= 720; a += 15) { const n = ((a % 360) + 360) % 360, lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n]; h += `<span style="left:${(a + 360) * 4}px" class="${lab ? 'c' : n % 45 === 0 ? 'm' : ''}">${lab || (n % 45 === 0 ? n : '')}</span>`; }
      $('compstrip').innerHTML = h; this.compBuilt = true;
    }
    if (this.last.deg !== Math.round(deg)) { this.last.deg = Math.round(deg); $('compstrip').style.transform = `translateX(${-(deg + 360) * 4}px)`; $('compdeg').textContent = String(Math.round(deg) % 360).padStart(3, '0'); }
  }
  damageNumber(point, dmg, head) {
    const mode = this.g.settings.dmgNum; if (!mode || mode === 'off' || !point) return;
    const v = point.clone().project(this.g.camera); if (v.z > 1) return;
    if (mode === 'stack') { // STACKING: one number per burst that adds up, held near the target
      const now = this.g.time, st = this.stack; if (st && now - st.t < 0.9 && st.d.isConnected) { st.n += dmg; st.t = now; st.d.textContent = Math.round(st.n); st.d.classList.toggle('hs', head || st.d.classList.contains('hs')); clearTimeout(st.to); st.to = setTimeout(() => st.d.remove(), 900); return; }
      const d = document.createElement('div'); d.className = 'dn stk' + (head ? ' hs' : ''); d.textContent = Math.round(dmg);
      d.style.left = ((v.x * 0.5 + 0.5) * innerWidth + 26).toFixed(0) + 'px'; d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight - 24).toFixed(0) + 'px';
      $('nameplates').appendChild(d); this.stack = { d, n: dmg, t: now, to: setTimeout(() => d.remove(), 900) }; return;
    }
    const d = document.createElement('div'); d.className = 'dn' + (head ? ' hs' : ''); d.textContent = Math.round(dmg);
    d.style.left = ((v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 24).toFixed(0) + 'px'; d.style.top = ((-v.y * 0.5 + 0.5) * innerHeight - 10).toFixed(0) + 'px';
    $('nameplates').appendChild(d); setTimeout(() => d.remove(), 820);
  }
  waveCard(st) {
    const el = $('wavecard'); el.innerHTML = `<h3>WAVE ${st.wave} CLEARED</h3><div class="wr"><span><b>${st.kills}</b>KILLS</span><span><b>${st.hs}</b>HEADSHOTS</span><span><b>${st.acc}%</b>ACCURACY</span><span><b>+${st.score}</b>SCORE</span></div>`;
    el.classList.remove('hidden'); clearTimeout(this.wcT); this.wcT = setTimeout(() => el.classList.add('hidden'), 4500);
  }
  // rebuild the ammo panel for the weapon in hand
  weaponChanged() {
    const p = this.g.player, W = p.weapon; this.buildSlots();
    const ab = $('ammobox'); if (this.wcW && this.wcW !== W.id) { ab.classList.remove('swap'); void ab.offsetWidth; ab.classList.add('swap'); } this.wcW = W.id;
    $('gunimg').src = W.thumb; $('gunimg').alt = W.name; this.set('gunname', W.name);
    $('bullets').innerHTML = '<i></i>'.repeat(W.mag); this.bul = [...$('bullets').children]; this.last.bul = -1;
    $('bullets').className = W.pellets > 1 ? 'shells' : W.mag <= 8 ? 'big' : W.mag <= 12 ? 'mid' : '';
  }
  pickupFlash() { const t = $('ammotoast'); t.style.opacity = 1; clearTimeout(this.toastT); this.toastT = setTimeout(() => t.style.opacity = 0, 1200); }
  hitmarker(head, kill) {
    const h = $('hitmarker'); h.classList.toggle('head', head && !kill); h.classList.toggle('kill', !!kill);
    this.hmT = kill ? 0.45 : 0.18; h.style.transform = 'scale(1.25)'; requestAnimationFrame(() => h.style.transform = '');
  }
  damageFrom(pos) {
    const el = document.createElement('div'); $('dmgdirs').appendChild(el); this.dirs.push({ el, pos: pos.clone(), t: 1.4 });
    this.vig = 1;
  }
  banner(text, sub = '', t = 2.5) { $('banner').innerHTML = text + (sub ? `<small>${sub}</small>` : ''); $('banner').style.opacity = 1; this.bannerT = t; }
  kill(head, pts, w) { this.feed('<span class="you">YOU</span>', w.id, head, '<span class="foe">HOSTILE</span>', pts); this.onLocalKill(pts, head); }
  // kill feed line: killer, weapon icon, headshot icon, victim (killer/victim are pre-escaped HTML)
  feed(killer, wid, head, victim, pts) {
    const w = WEAPON_BY_ID[wid], d = document.createElement('div');
    d.innerHTML = `${killer}${w ? `<img src="${w.thumb}" alt="${w.name}" title="${w.name}">` : wid === 'vehicle' ? icon('car', 'veh') : icon('skull')}${head ? icon('headshot') : ''}${victim}${pts ? `<span class="pts">+${pts}</span>` : ''}`;
    $('killfeed').prepend(d); (this.feedItems = this.feedItems || []).push({ d, t: 0 });
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  }
  // static top-down map of the city (buildings + roads) for the radar
  buildMap() {
    const S = 4, N = 150, c = document.createElement('canvas'); c.width = c.height = N * 2 * S; const x = c.getContext('2d');
    const mm = this.g.world.env.minimap;
    x.fillStyle = mm.bg; x.fillRect(0, 0, c.width, c.height);
    const P = (v) => (v + N) * S;
    if (mm.roads) { x.fillStyle = '#4a5058'; x.fillRect(P(-6), 0, 12 * S, c.height); x.fillRect(0, P(-6), c.width, 12 * S); // roads
      x.fillStyle = 'rgba(255,214,90,.55)'; x.fillRect(P(-0.2), 0, 0.4 * S, c.height); x.fillRect(0, P(-0.2), c.width, 0.4 * S); }
    else { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(P(-4.5), 0, 9 * S, c.height); x.fillRect(0, P(-4), c.width, 8 * S); }
    for (const b of this.g.world.boxes) {
      const h = b.max.y - b.min.y, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (b.min.y > 0.5 || w * d > 6000 || h < 0.6) continue;
      x.fillStyle = h > 4 ? mm.hi : mm.lo;
      x.fillRect(P(b.min.x), P(b.min.z), w * S, d * S);
      if (h > 4) { x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 2; x.strokeRect(P(b.min.x), P(b.min.z), w * S, d * S); }
    }
    this.map = c; this.mapS = S; this.mapN = N;
  }
  drawRadar() {
    if (!this.map) this.buildMap();
    const ctx = this.radar, W = ctx.canvas.width, g = this.g, p = g.player, R = 38; // metres shown to the edge
    const k = (W / 2) / R;
    const rot = g.settings.mmRot !== false; // MINI-MAP ROTATION off = north-up map, rotating arrow
    ctx.clearRect(0, 0, W, W); ctx.save(); ctx.translate(W / 2, W / 2); if (rot) ctx.rotate(p.yaw);
    ctx.globalAlpha = 0.85; const s = k / this.mapS;
    ctx.drawImage(this.map, (-p.pos.x - this.mapN) * k, (-p.pos.z - this.mapN) * k, this.map.width * s, this.map.height * s);
    ctx.globalAlpha = 1;
    // range rings
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, W * 0.25, 0, 7); ctx.stroke();
    // enemies (red dots, pulsing when they can see you)
    for (const e of g.enemies) {
      if (e.dead) continue;
      let dx = (e.pos.x - p.pos.x) * k, dz = (e.pos.z - p.pos.z) * k; const m = Math.hypot(dx, dz), lim = W / 2 - 9;
      const out = m > lim; if (out) { dx *= lim / m; dz *= lim / m; }
      const r = out ? 5 : 8 + (e.canSee ? Math.sin(g.time * 12) * 2 : 0);
      ctx.fillStyle = out ? 'rgba(255,59,48,.6)' : '#ff3b30'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(dx, dz, r, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (g.mp && g.mp.active) for (const o of g.mp.radarDots()) {
      let dx = (o.pos.x - p.pos.x) * k, dz = (o.pos.z - p.pos.z) * k; const m = Math.hypot(dx, dz), lim = W / 2 - 9;
      const out = m > lim; if (out) { dx *= lim / m; dz *= lim / m; }
      ctx.fillStyle = o.color; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(dx, dz, out ? 5 : 8 + (o.pulse ? Math.sin(g.time * 12) * 2 : 0), 0, 7); ctx.fill(); ctx.stroke();
    }
    { const o = g.campaign && g.campaign.radarPoint(); if (o) { // campaign objective marker (gold diamond, clamped to the edge)
      let dx = (o.x - p.pos.x) * k, dz = (o.z - p.pos.z) * k; const m = Math.hypot(dx, dz), lim = W / 2 - 12; if (m > lim) { dx *= lim / m; dz *= lim / m; }
      ctx.save(); ctx.translate(dx, dz); ctx.rotate((rot ? -p.yaw : 0) + Math.PI / 4); ctx.fillStyle = '#e4c45a'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3; ctx.fillRect(-9, -9, 18, 18); ctx.strokeRect(-9, -9, 18, 18); ctx.restore(); } }
    for (const it of g.pickups ? g.pickups.items : []) {
      let dx = (it.pos.x - p.pos.x) * k, dz = (it.pos.z - p.pos.z) * k; const m = Math.hypot(dx, dz), lim = W / 2 - 9;
      if (m > lim) { dx *= lim / m; dz *= lim / m; }
      ctx.fillStyle = '#ffc94a'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.fillRect(dx - 5, dz - 5, 10, 10); ctx.strokeRect(dx - 5, dz - 5, 10, 10);
    }
    ctx.restore();
    // view cone + player arrow (facing up, or turning with the player on a north-up map)
    ctx.save(); ctx.translate(W / 2, W / 2); if (!rot) ctx.rotate(-p.yaw);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.48); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, W * 0.48, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2a33a'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 6); ctx.lineTo(-12, 13); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    // north marker sits on the rim
    const nx = Math.sin(-p.yaw) * 0, n = $('radarN'); const a = p.yaw; const rr = 44;
    n.style.left = `calc(50% + ${(-Math.sin(a) * rr).toFixed(1)}%)`; n.style.top = `calc(50% + ${(-Math.cos(a) * rr).toFixed(1)}% - 7px)`;
  }
  set(id, v) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } }
  update(dt) {
    const g = this.g, p = g.player;
    this.hmT -= dt; $('hitmarker').style.opacity = this.hmT > 0 ? Math.min(1, this.hmT * 8) : 0;
    this.bannerT -= dt; if (this.bannerT <= 0) $('banner').style.opacity = 0;
    const gap = (p.aiming ? 3 : 6) + (g.settings.xSpread === false ? 0.004 : p.spread()) * 900; const ch = $('crosshair');
    ch.style.setProperty('--g', gap.toFixed(1) + 'px'); ch.classList.toggle('ads', p.aiming);
    ch.style.opacity = p.sprint || p.dead ? 0.15 : 1;
    // ammo
    this.set('mag', p.mag); this.set('reserve', p.reserve);
    const low = p.lowAmmo; $('mag').classList.toggle('low', low); $('bullets').classList.toggle('low', low);
    if (this.last.bul !== p.mag) { this.last.bul = p.mag; this.bul.forEach((b, i) => b.classList.toggle('e', i >= p.mag)); }
    const hint = p.reloading > 0 ? 'RELOADING' : p.mag === 0 && p.reserve === 0 ? 'NO AMMO' : low ? (g.mobile ? 'TAP TO RELOAD' : 'PRESS R TO RELOAD') : '';
    this.set('ammohint', hint); $('ammohint').classList.toggle('red', low && p.reloading <= 0);
    $('reloadbar').style.opacity = p.reloading > 0 ? 1 : 0; $('reloadfill').style.width = (p.reloading > 0 ? (1 - p.reloading / p.reloadTime) * 100 : 0) + '%';
    if (this.last.wi !== p.wi) { this.last.wi = p.wi; this.weaponChanged(); }
    const sel = p.pendingWi >= 0 ? p.pendingWi : p.wi;
    if (this.last.sel !== sel || this.last.slotT !== ((g.time * 2) | 0)) {
      this.last.sel = sel; this.last.slotT = (g.time * 2) | 0;
      this.slotEls.forEach((el, i) => { el.classList.toggle('on', i === sel); el.classList.toggle('empty', p.slots[i].mag + p.slots[i].reserve === 0); });
    }
    const scoped = p.weapon.scope && g.aimT > 0.85 && !p.switching && !p.dead && p.reloading <= 0;
    $('scope').classList.toggle('on', !!scoped); $('hud').classList.toggle('scoped', !!scoped);
    this.set('stance', p.crouch ? 'CROUCHED' : p.sprint ? 'SPRINTING' : p.aiming ? 'AIMING' : 'STANDING');
    // health segments
    const hp = Math.max(0, p.health);
    this.segs.forEach((s, i) => s.style.setProperty('--f', (Math.max(0, Math.min(1, hp / 10 - i)) * 100).toFixed(0) + '%'));
    $('healthbox').classList.toggle('low', hp < 35); $('healthbox').classList.toggle('mid', hp >= 35 && hp < 65);
    // smooth number tweens
    const D = this.disp, tw = (k, v, rate) => { D[k] += (v - D[k]) * Math.min(1, dt * rate); if (Math.abs(v - D[k]) < 0.5) D[k] = v; return Math.round(D[k]); };
    this.set('hpnum', Math.ceil(Math.max(hp, tw('hp', hp, 9) - 0.49)));
    this.set('wave', g.wave); this.set('kills', tw('kills', g.kills, 12)); this.set('score', tw('score', g.score, 7)); this.set('left', Math.max(0, g.waveTotal - g.waveKills));
    this.vig = Math.max(0, (this.vig || 0) - dt * 1.5);
    // low health: heartbeat + pulsing red edge
    let beat = 0;
    if (hp > 0 && hp < 30 && !p.dead) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 0.62 + hp / 60; g.sfx.heartbeat(); this.beatAt = g.time; } const s = g.time - (this.beatAt || 0); beat = Math.max(0, 1 - s * 3.5) * 0.35; }
    $('vignette').style.opacity = Math.min(1, Math.max(this.vig * 0.85, p.health < 40 ? (40 - p.health) / 40 * 0.75 : 0) + beat);
    for (const d of this.dirs) {
      d.t -= dt; const to = d.pos.clone().sub(p.pos); const a = Math.atan2(-to.x, -to.z); const rel = -(a - p.yaw);
      d.el.style.transform = `rotate(${rel}rad)`; d.el.style.opacity = Math.min(1, d.t);
      if (d.t <= 0) d.el.remove();
    }
    this.dirs = this.dirs.filter(d => d.t > 0);
    // kill feed: slide in, hold, fade (driven here so it follows game time)
    for (const f of this.feedItems || []) {
      f.t += dt; const a = Math.min(1, f.t / 0.18), o = f.t > 3.8 ? Math.max(0, 1 - (f.t - 3.8) / 0.6) : a;
      f.d.style.opacity = o; f.d.style.transform = `translateX(${((1 - a) * 24).toFixed(1)}px)`;
      if (f.t > 4.4 || !f.d.isConnected) f.d.remove();
    }
    this.feedItems = (this.feedItems || []).filter(f => f.d.isConnected);
    this.radarT = (this.radarT || 0) - dt; if (this.radarT <= 0) { this.radarT = 1 / 20; this.drawRadar(); }
    this.compass();
    // medkit slot
    const mk = p.medkits; if (this.last.mk !== mk) { this.last.mk = mk; $('medn').textContent = mk; $('tMedN').textContent = mk; $('medslot').classList.toggle('empty', mk <= 0); $('tMed').classList.toggle('empty', mk <= 0); }
    const healing = p.healT > 0; $('medslot').classList.toggle('on', healing); $('tMed').classList.toggle('on', healing);
    if (healing) $('medslot').style.setProperty('--p', (1 - p.healT / 2).toFixed(3));
    if (g.touch) g.touch.update();
  }
}

class Game {
  constructor() {
    this.canvas = $('c');
    this.mobile = MOBILE;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('swat-settings') || '{}') || {}; } catch (e) {}
    const fresh = !saved.gPreset;
    this.settings = Object.assign({ quality: MOBILE ? 'mobile' : 'high', res: 'native', haptics: true,
      name: 'Operator-' + (100 + Math.random() * 900 | 0), layout: {}, primary: 'm4a1', secondary: 'pistol' }, SET_DEFAULTS, saved);
    const st = this.settings; st.name = cleanName(st.name) || 'Operator'; migrateSettings(st, saved);
    // first run of v1.6: phones start on the MED preset (old 'mobile' quality), laptops on HIGH; the photo defaults are kept otherwise
    if (fresh && saved.quality) { const m = { low: 'low', mobile: 'med', medium: 'med', high: 'high', ultra: 'ultra' }[saved.quality]; if (m) { Object.assign(st, GFX_PRESETS[m]); st.gPreset = m; } }
    else if (fresh && MOBILE) { Object.assign(st, GFX_PRESETS.med); st.gPreset = 'med'; }
    if (!PRIMARIES.includes(st.primary)) st.primary = 'm4a1'; if (!SECONDARIES.includes(st.secondary) || st.secondary === st.primary) st.secondary = 'pistol';
    if (!localStorage.getItem('swat-settings')) localStorage.setItem('swat-settings', JSON.stringify(st));
    if (params.get('quality')) { const q = this.settings.quality = params.get('quality'), m = { low: 'low', mobile: 'low', medium: 'med', high: 'high', ultra: 'ultra' }[q]; if (m) { Object.assign(this.settings, GFX_PRESETS[m]); this.settings.gPreset = m; } }
    if (params.get('res')) this.settings.res = params.get('res');
    if (MOBILE) { this.settings.res = 'native'; if (!QUALITY[this.settings.quality]) this.settings.quality = 'mobile'; }
    this.lite = MOBILE || this.settings.quality === 'mobile';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (this.lite) r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, this.lite ? 320 : 600);
    this.clock = new THREE.Clock(); this.time = 0; this.state = 'loading'; this.shake = 0;
    this.input = { keys: {}, fire: false, aim: false, jumpPressed: false, reloadPressed: false };
    this.sfx = new Sfx(); this.sfx.setVolume(this.settings.vol, this.settings.fxVol, this.settings.uiVol);
    this.enemies = []; this.shoulder = 1; this.aimT = 0; this.camBack = 2.6; this.pivotY = 1.6; this.fpsAcc = [];
    this.settingsUI = new SettingsUI(this);
    this.hud = new HUD(this); this.ui = new UI(this); this.kills = 0; this.score = 0; this.wave = 0; this.waveKills = 0; this.waveTotal = 0;
    this.load();
  }
  async load() {
    const mgr = new THREE.LoadingManager();
    mgr.onProgress = (url, a, b) => this.ui.progress(a / b * 0.9, `Loading assets ${a} / ${b}`);
    this.world = new World(this.scene, this.renderer, mgr);
    const glLoader = new GLTFLoader(mgr); glLoader.setMeshoptDecoder(MeshoptDecoder);
    const gltfP = glLoader.loadAsync(asset('assets/swat.glb'), (e) => { if (e.total) $('loadtxt').textContent = `Loading operator ${(e.loaded / e.total * 100) | 0}%`; });
    const gunP = Promise.all(WEAPONS.map(w => glLoader.loadAsync(asset(w.file))));
    const rigP = Promise.all(RIGS.map(n => glLoader.loadAsync(asset('assets/chars/' + n + '.glb'))));
    const hdrP = new RGBELoader(mgr).loadAsync(asset('assets/hdr/kloofendal_48d_partly_cloudy_puresky.hdr'));
    const cityLoader = new GLTFLoader(mgr); cityLoader.setMeshoptDecoder(MeshoptDecoder);
    await this.world.loadCity(cityLoader);
    this.world.build({ lite: this.lite, map: 'city' });
    const [gltf, hdr, gun, rigs] = await Promise.all([gltfP, hdrP, gunP, rigP]);
    // lighting from HDR
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const info = analyzeHDR(hdr);
    this.scene.background = hdr; this.scene.environment = hdr; this.scene.environmentIntensity = 0.75; this.scene.backgroundIntensity = 0.9;
    const fogC = info.fogColor.clone().multiplyScalar(0.9);
    this.scene.fog = new THREE.FogExp2(fogC, 0.0065);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
    sun.position.copy(info.sunDir).multiplyScalar(120); sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
    this.scene.add(sun, sun.target); this.sunOffset = sun.position.clone();
    this.hemi = new THREE.HemisphereLight(0xbcd0e6, 0x3a332c, 0.35); this.scene.add(this.hemi); this.baseFog = fogC.clone(); this.applyEnv();
    // characters
    const gunScenes = {}; WEAPONS.forEach((w, i) => gunScenes[w.id] = gun[i].scene);
    const extra = {}; RIGS.forEach((n, i) => extra[n] = rigs[i]);
    this.factory = new CharacterFactory(gltf, gunScenes, WEAPON_BY_ID, extra);
    window.__gunCal = this.factory.debug;
    this.fx = new FX(this.scene); this.fx.cam = this.camera;
    for (const s of this.fx.shells) s.onBounce = (p) => this.sfx.shellTink(p);
    const pc = this.factory.create({ isPlayer: true }); this.scene.add(pc.root);
    this.player = new Player(this, pc);
    this.pickups = new Pickups(this); this.hud.weaponChanged(); this.hud.applyCrosshair();
    this.vehicles = new Vehicles(this);
    this.ui.progress(0.95, 'Preparing the city…');
    this.sfx.onSubtitle = (t) => this.hud.subtitle(t.toUpperCase());
    this.sfx.occluder = (pos) => { const c = this.camera.position, d = pos.clone().sub(c), L = d.length(); if (L < 2 || L > 60) return false; d.divideScalar(L); const h = raycastBoxes(this.world.boxes, c, d, L - 0.8); return !!h; };
    this.setupPost(); this.applySettings();
    this.mp = new MP(this); this.voice = new Voice(this);
    this.campaign = new Campaign(this);
    this.meta = new Meta(this); this.bindUI(); this.bindInput(); this.resetEarn();
    this.setPlayerTint(this.opLook());
    if (MOBILE) { this.touch = new TouchControls(this); this.ui.applyLayout(); }
    addEventListener('resize', () => this.relayout());
    if (window.visualViewport) visualViewport.addEventListener('resize', () => this.relayout());
    addEventListener('orientationchange', () => { this.relayout(); setTimeout(() => this.relayout(), 350); });
    // warm up shaders
    this.renderer.compile(this.scene, this.camera);
    this.ui.progress(1, 'Ready'); this.ui.loaded(); this.state = 'menu'; this.menuPose(); this.showScreen('menu');
    this.renderer.setAnimationLoop(() => this.frame());
    window.__ready = true;
    // invite link: ?room=CODE opens the multiplayer screen and joins straight away
    const room = params.get('room');
    if (room) { $('btnMP').click(); $('joinCode').value = room.toUpperCase().slice(0, 5); this.mp.join(room); }
  }
  // v1.6 pipeline, built from the GRAPHICS tab: render (MSAA samples) -> AO -> bloom -> motion blur -> menu DOF -> output -> FXAA / SMAA
  setupPost() {
    const s = this.settings, r = this.renderer;
    const msaa = s.aa === 'msaa4' ? 4 : s.aa === 'msaa2' ? 2 : 0;
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: msaa });
    const c = this.composer = new EffectComposer(r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (s.ao) {
      const ao = this.ao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.1, samples: s.gPreset === 'ultra' ? 24 : MOBILE ? 8 : 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: MOBILE ? 8 : 16 });
      ao.blendIntensity = 0.9; c.addPass(ao);
    } else this.ao = null;
    if (s.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), s.hdr ? 0.32 : 0.2, 0.55, s.hdr ? 3.5 : 0.9));
    this.blur = null; if (s.motionBlur) { this.blur = new AfterimagePass(0.55); c.addPass(this.blur); }
    this.dof = new ShaderPass(MenuDOF); this.dof.enabled = false; c.addPass(this.dof);
    c.addPass(new OutputPass());
    this.fxaa = null;
    if (s.aa === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa); }
    else if (s.aa === 'taa') c.addPass(new SMAAPass(innerWidth, innerHeight)); // WebGL has no real TAA: SMAA stands in (morphological AA, sharper than FXAA)
    // HDR: filmic ACES tone mapping; off = plain linear output
    r.toneMapping = s.hdr ? THREE.ACESFilmicToneMapping : THREE.LinearToneMapping; r.toneMappingExposure = s.hdr ? 1.0 : 0.9;
  }
  pixelRatio() {
    const s = this.settings, cap = MOBILE ? 1.5 : s.gPreset === 'ultra' ? 3 : s.gPreset === 'low' ? 1 : 2;
    return Math.max(0.35, Math.min(devicePixelRatio || 1, cap) * (s.renderScale || 1) * (s.dynRes ? (this.dynScale || 1) : 1));
  }
  applyShadows() {
    const s = this.settings, r = this.renderer, q = s.shadowQ, on = q !== 'off';
    let size = { low: 1024, medium: 2048, high: 4096, realtime: 4096 }[q] || 2048; if (MOBILE) size = Math.min(size, 2048);
    if (r.shadowMap.enabled !== on) { r.shadowMap.enabled = on; this.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; }); }
    this.sun.castShadow = on; this.sun.shadow.mapSize.set(size, size); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    r.shadowMap.type = q === 'low' || MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = true; this.shadowEvery = q === 'realtime' ? 1 : 2;
  }
  // texture quality = anisotropic filtering level (the texture files are fixed per build)
  applyTextures() {
    const max = this.renderer.capabilities.getMaxAnisotropy(), a = Math.min(max, { low: 1, medium: 2, high: 8, ultra: 16 }[this.settings.texQ] || 8);
    this.scene.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = m[k]; if (t && t.anisotropy !== a) { t.anisotropy = a; const im = t.image; // not loaded yet: the loader's own upload picks the level up
        if (im && (im.width || im.data)) t.needsUpdate = true; } } });
  }
  // "RAY TRACING / REFLECTIONS": WebGL has no ray tracing; this boosts the HDR environment reflections (env intensity, glossier surfaces)
  applyReflections() {
    const on = !!this.settings.rt, e = this.world.env;
    if (e) this.scene.environmentIntensity = e.envI * (on ? 1.7 : 1);
    this.scene.traverse(o => { if (!o.isMesh || !o.material || o.userData.char) return; for (const m of [].concat(o.material)) { if (m.roughness === undefined) continue; if (m.userData.r0 === undefined) m.userData.r0 = m.roughness; m.roughness = on ? m.userData.r0 * 0.6 : m.userData.r0; } });
  }
  applySettings() {
    const s = this.settings; localStorage.setItem('swat-settings', JSON.stringify(s));
    this.applyShadows();
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.setupPost(); this.applyTextures(); this.applyReflections();
    if (this.fx) this.fx.q = { low: 0.35, medium: 0.65, high: 1, cinematic: 1.6 }[s.fxQ] || 1;
    this.sfx.configure(s);
    this.hud.applyCrosshair(); this.applyGameplay();
    this.resize();
  }
  // one setting changed in the sheet: apply it live
  applySetting(k) {
    const s = this.settings, G = ['gPreset', 'aa', 'bloom', 'ao', 'hdr', 'motionBlur'];
    if (!this.sun) return; // still loading: everything is applied once at the end of load()
    if (G.includes(k) || k === 'gPreset') { if (k === 'gPreset') { this.applyShadows(); this.applyTextures(); this.applyReflections(); this.fx.q = { low: 0.35, medium: 0.65, high: 1, cinematic: 1.6 }[s.fxQ] || 1; }
      this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.setupPost(); this.resize(); }
    else if (k === 'shadowQ') this.applyShadows();
    else if (k === 'texQ') this.applyTextures();
    else if (k === 'rt') this.applyReflections();
    else if (k === 'fxQ') this.fx.q = { low: 0.35, medium: 0.65, high: 1, cinematic: 1.6 }[s.fxQ] || 1;
    else if (k === 'renderScale' || k === 'dynRes') { this.dynScale = 1; this.resize(); }
    if (/^(vol|fxVol|uiVol|musicVol|dlgVol|ambVol|aPreset|dynRange|hrtf|aQ|occl|foot3d)$/.test(k)) { this.sfx.configure(s); if (k === 'uiVol') this.sfx.ui('hover'); }
    if (/^(voip|voiceVol|micVol|micMode|micThr|muteDeath)$/.test(k) && this.voice) this.voice.configure();
    if (/^(btnOp|ctlScale|hand|layoutPreset|joyDead)$/.test(k) && this.touch) { this.touch.applySettings(); this.ui.applyLayout(); }
    if (k === 'gyro' && s.gyro) this.gyroPermission();
    if (/^(xhair|xDot|xScale|xOp|xSpread)$/.test(k)) this.hud.applyCrosshair();
    if (/^(cblind|killfeed|hmColor|hmVis|dmgSize|netStats|fps|streamer|mmRot)$/.test(k)) this.applyGameplay();
    if (k === 'allWeapons' || k === 'name') this.ui.refreshMenu();
    if (k === 'name' && this.mp && this.mp.onNameChange) this.mp.onNameChange();
  }
  applyGameplay() {
    const s = this.settings;
    this.canvas.style.filter = s.cblind && s.cblind !== 'off' ? `url(#cb-${s.cblind})` : '';
    const kf = $('killfeed'); kf.classList.toggle('off', s.killfeed === 'off'); kf.classList.toggle('compact', s.killfeed === 'compact');
    document.documentElement.style.setProperty('--hmc', s.hmColor === 'yellow' ? '#ffd21c' : '#ff3b30');
    document.documentElement.style.setProperty('--dns', (s.dmgSize / 0.75).toFixed(2));
    $('hitmarker').classList.toggle('off', !s.hmVis);
    document.body.classList.toggle('streamer', !!s.streamer);
  }
  gyroPermission() {
    const D = window.DeviceMotionEvent; if (D && typeof D.requestPermission === 'function' && !this.gyroAsked) { this.gyroAsked = true; D.requestPermission().catch(() => {}); }
  }
  // mobile browsers: address bar showing/hiding, rotation, entering/leaving fullscreen
  relayout() { this.resize(); if (this.touch) this.touch.layout(); }
  resize() {
    const w = innerWidth, h = innerHeight, pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.blur) this.blur.uniforms.damp.value = 0.55;
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.settingsUI) this.settingsUI.stats();
  }
  showScreen(id) { this.ui.show(id); }
  // economy: coins + XP are saved as they are earned; the match tally feeds the after-action report
  // v1.5 maps: rebuild the world for another map (solo, campaign, multiplayer host choice synced to clients)
  setMap(id) {
    id = MAP_BY_ID[id] ? id : 'city'; if (this.world.mapId === id) return false;
    this.world.build({ lite: this.lite, map: id });
    if (this.vehicles) this.vehicles.setSpawns(this.world.vehicleSpawns);
    this.hud.map = null; this.applyEnv(); this.applyReflections(); this.applyTextures(); if (this.fx && this.fx.decals) for (const d of this.fx.decals) d.visible = false;
    if (this.player && this.state === 'menu') { this.player.reset(this.world.playerSpawn); this.menuPose && this.menuPose(); }
    return true;
  }
  applyEnv() {
    const e = this.world.env; if (!this.sun || !e) return;
    this.sun.color.set(e.sun); this.sun.intensity = e.sunI; this.hemi.color.set(e.hemiSky); this.hemi.groundColor.set(e.hemiGround); this.hemi.intensity = e.hemiI;
    this.scene.fog.color.copy(e.fogTint != null ? new THREE.Color(e.fogTint) : this.baseFog); this.scene.fog.density = e.fogD;
    this.scene.environmentIntensity = e.envI; this.scene.backgroundIntensity = e.bgI;
  }
  resetEarn() { this.earn = { kills: 0, hs: 0, waves: 0, streakXP: 0, streakCoins: 0, coins: 0, xp: 0, startXP: prog().xp }; }
  reward(coins, xp) { if (!this.earn) this.resetEarn(); this.earn.coins += coins; this.earn.xp += xp; addCoins(coins); const r = addXP(xp); if (r.up) this.rankUp(r.after.lv); }
  rankUp(lv) { this.sfx.announce('Rank up. ' + rankName(lv) + '.');
    const un = Object.entries(RANK_REQ).flatMap(([k, o]) => Object.entries(o).filter(([, v]) => v === lv).map(([id]) => k === 'gun' ? (WEAPON_BY_ID[id] || {}).name : id.toUpperCase())).filter(Boolean);
    const el = $('rankup'); el.innerHTML = `<div class="rkb">${lv}</div><div><small>RANK UP</small><b>${rankName(lv)}</b>${un.length ? `<span>UNLOCKED: ${un.join(' · ')}</span>` : ''}</div>`;
    el.classList.remove('hidden', 'go'); void el.offsetWidth; el.classList.add('go'); clearTimeout(this.rkT); this.rkT = setTimeout(() => el.classList.add('hidden'), 4200); this.sfx.ui('select');
  }
  opLook() { const o = prog().op; return !o || o === 'swat' ? null : o; }
  saveSettings() { localStorage.setItem('swat-settings', JSON.stringify(this.settings)); }
  inMatch() { return this.state === 'playing' || this.state === 'paused'; }
  // weapons carried: primary + secondary (solo option: all six)
  loadoutIds() {
    const s = this.settings;
    const pri = owns('gun', s.primary) ? s.primary : 'm4a1', sec = owns('gun', s.secondary) ? s.secondary : 'pistol';
    if (s.allWeapons && !(this.mp && this.mp.active)) return [pri, ...WEAPONS.map(w => w.id).filter(id => id !== pri && owns('gun', id))];
    return [pri, sec];
  }
  // menu backdrop: the operator in the idle aiming pose on the street
  menuPose() { const p = this.player; p.c.aimPitch = 0; p.c.yaw = 0.35; p.c.play('idle aiming', { fade: 0.3 }); p.c.root.visible = true; }
  // team colours in multiplayer: rebuild the local operator with a tinted uniform
  setPlayerTint(tint) {
    if ((this.playerTint ?? null) === (tint ?? null)) return; this.playerTint = tint ?? null;
    const old = this.player.c, c = this.factory.create({ tint: tint ?? null, isPlayer: true }); this.scene.add(c.root);
    c.setGun(old.gunId); old.dispose(this.scene); this.player.c = c;
  }
  bindUI() {
    this.ui.bindSettings(); this.ui.bindLoadout();
    $('btnPlay').onclick = () => this.ui.show('maps');
    $('btnResume').onclick = () => this.resume();
    $('btnRestart').onclick = () => { if (this.mp.role) this.mp.backToLobby(); else if (this.campaign.cur) { const n = this.campaign.win && this.campaign.nextMission(); this.campaign.start(n ? n.id : this.campaign.cur.id); } else this.startGame(); };
    $('btnQuit').onclick = () => { if (this.mp.role) this.mp.leave(); else this.toMenu(); };
    $('btnMenu').onclick = () => { if (this.mp.role) this.mp.leave(); else { const c = !!this.campaign.cur; this.toMenu(); if (c) this.ui.show('campaign'); } };
  }
  lock() { this.sfx.init(); if (MOBILE) return; try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) {} }); } catch (e) {} }
  bindInput() {
    addEventListener('keydown', (e) => {
      if (this.state !== 'playing' || this.mpPaused || (this.mp && this.mp.chatOpen)) return;
      if (this.mp.active) {
        if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.mp.toggleBoard(true); return; }
        if ((e.code === 'Enter' || e.code === 'KeyT') && !e.repeat) { e.preventDefault(); this.input.keys = {}; this.input.fire = false; this.mp.openChat(); return; }
      }
      this.input.keys[e.code] = true;
      if (e.code === 'Space') { this.input.jumpPressed = true; e.preventDefault(); }
      if (e.code === 'KeyR') this.input.reloadPressed = true;
      if ((e.code === 'KeyE' || e.code === 'KeyF') && !e.repeat) this.input.usePressed = true;
      if (e.code === 'KeyH' && !e.repeat) { if (this.player.vehicle) this.sfx.horn(); else this.input.medkitPressed = true; }
      if (e.code === 'KeyV' && !e.repeat && this.player.vehicle) this.driveCamFar = !this.driveCamFar;
      if (e.code === 'KeyC' && !e.repeat) this.player.crouchToggle = !this.player.crouchToggle;
      if (e.code === 'KeyV' && !e.repeat) this.shoulder *= -1;
      if (e.code === 'KeyQ' && !e.repeat) this.player.lastWeapon();
      const dm = /^(Digit|Numpad)([1-9])$/.exec(e.code); if (dm && !e.repeat && +dm[2] <= this.player.slots.length) this.player.switchTo(+dm[2] - 1);
      if (e.code === 'KeyP') this.pause();
      if (e.ctrlKey && ['KeyW', 'KeyS', 'KeyD', 'KeyR'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.input.keys[e.code] = false; if (e.code === 'Tab' && this.mp && this.mp.active) this.mp.toggleBoard(false); });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || this.mpPaused) return;
      if (!document.pointerLockElement && !this.testMode) this.lock();
      if (e.button === 0) this.input.fire = true; if (e.button === 2) this.input.aim = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.input.fire = false; if (e.button === 2) this.input.aim = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (this.state !== 'playing' || Math.abs(e.deltaY) < 1) return;
      const now = performance.now(); if (now - (this.wheelT || 0) < 120) return; this.wheelT = now;
      this.player.cycle(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || this.mpPaused || (!document.pointerLockElement && !this.testMode)) return;
      this.look(e.movementX, e.movementY);
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) this.hadLock = true;
      else if (this.state === 'playing' && this.hadLock && !this.mp.chatOpen) this.pause();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && !this.mp.active) this.pause(); });
    addEventListener('blur', () => { this.input.keys = {}; this.input.fire = this.input.aim = false; });
  }
  // kind: fire / hit (hits you land) / dmg (damage taken) / reload / ui; scaled by the vibration intensity
  haptic(p, kind = 'ui') {
    const s = this.settings, v = s.vibInt ?? 0.75;
    if (!this.mobile || this.testMode || !navigator.vibrate || v <= 0) return;
    if ((kind === 'fire' && !s.vibFire) || ((kind === 'hit' || kind === 'dmg') && !s.vibHit) || (kind === 'reload' && !s.vibReload)) return;
    const sc = (x) => Math.max(1, Math.round(x * v / 0.75));
    try { navigator.vibrate(Array.isArray(p) ? p.map((x, i) => i % 2 ? x : sc(x)) : sc(p)); } catch (e) {}
  }
  // look input. src: 'mouse' | 'touch' | 'gyro'
  look(dx, dy, src = 'mouse') {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.lastLook = this.time;
    const s = this.settings, p = this.player, W = p.weapon;
    let m = 1;
    if (p.vehicle) m = s.freeSens;
    else if (p.aiming) m = !W.scope ? 0.6 * s.adsSens : this.aimT > 0.85 ? 0.22 * s.sniperSens / 0.75 : 0.6 * s.scopeSens / 0.85;
    if (src === 'touch') {
      const v = Math.hypot(dx, dy);
      if (s.curveMode !== 'static' && v > 0) {
        if (s.curve === 'standard') m *= THREE.MathUtils.clamp(Math.pow(v / 8, 0.25), 0.6, 1.4);
        else if (s.curve === 'custom') m *= THREE.MathUtils.clamp(Math.pow(v / 8, 0.6), 0.35, 2.2);
      }
      if (s.aimAcc && v > 12) m *= 1 + Math.min(1, (v - 12) / 30) * 0.5 * s.aimAccMul;
    } else if (src === 'mouse' && s.aimAcc && s.aimAccMul > 0) { const v = Math.hypot(dx, dy); if (v > 25) m *= 1 + Math.min(1, (v - 25) / 60) * 0.25 * s.aimAccMul; }
    const k = 0.0022 * m;
    this.player.yaw -= dx * k * s.sensX * (s.invertX ? -1 : 1); this.player.pitch -= dy * k * s.sensY * (s.invert ? -1 : 1);
    this.player.pitch = THREE.MathUtils.clamp(this.player.pitch, -1.15, 1.2);
  }
  startGame() {
    this.sfx.init(); this.setPlayerTint(this.opLook()); this.mpPaused = false; this.resetEarn();
    for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = [];
    this.vehicles.reset(); this.player.reset(this.world.playerSpawn); this.player.c.root.visible = true; this.pickups.clear(); this.pickups.placeSpots(this.world.medkitSpots); this.hud.weaponChanged(); this.hud.resetMatch();
    this.kills = 0; this.score = 0; this.wave = 0; this.waveKills = 0; this.waveTotal = 0; this.intermission = 0; this.gameOverT = -1; this.startT = this.time;
    this.input.keys = {}; this.input.fire = this.input.aim = false;
    this.state = 'playing'; this.showScreen(null); this.hadLock = false;
    if (!this.testMode) this.lock();
    if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); }
    if (this.campaign.cur) this.campaign.begin(); else this.nextWave();
  }
  // multiplayer match start (called by MP for host and clients)
  startMP(mode, spawn, yaw, tint, isHost) {
    this.sfx.init(); this.setPlayerTint(tint); this.mpPaused = false; this.resetEarn();
    for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = [];
    this.vehicles.reset(); this.player.respawn(spawn, yaw); this.player.shots = this.player.hits = this.player.headshots = 0; this.pickups.clear(); this.pickups.placeSpots(this.world.medkitSpots); this.hud.resetMatch(); this.hud.weaponChanged();
    this.kills = 0; this.score = 0; this.wave = 0; this.waveKills = 0; this.waveTotal = 0; this.intermission = 0; this.gameOverT = -1; this.startT = this.time;
    this.input.keys = {}; this.input.fire = this.input.aim = false;
    this.state = 'playing'; this.showScreen(null); this.hadLock = false;
    if (MOBILE) this.touch.reset();
    $('quitlbl').textContent = isHost ? 'END & CLOSE ROOM' : 'LEAVE MATCH';
    if (mode === 'coop' && isHost) this.nextWave();
  }
  // multiplayer match over: after-action report with the standings
  endMP(r) {
    this.state = 'gameover'; this.mpPaused = false; this.input.fire = this.input.aim = false; if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player, acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0, m = r.mine;
    if (!this.earn.ended) { this.earn.ended = true; this.earn.match = true; this.reward(COINS.match, 200); if (r.won) { this.earn.win = true; this.reward(COINS.win, 500); } const P = prog(); P.matches++; if (r.won) P.wins++; P.kills += m[3] ?? 0; P.deaths += m[4] ?? 0; P.headshots += p.headshots; P.bestStreak = Math.max(P.bestStreak, this.hud.bestStreak); saveProg(); }
    $('sumTitle').textContent = r.won ? 'VICTORY' : r.mode === 'coop' ? 'MATCH OVER' : 'DEFEAT'; $('sumTitle').className = r.won ? 'gold' : 'red';
    $('sumSub').textContent = r.title + ' · ' + r.sub;
    const kd = (m[4] ?? 0) ? ((m[3] ?? 0) / m[4]).toFixed(2) : String(m[3] ?? 0);
    this.summaryCards([['KILLS', m[3] ?? 0, true], ['DEATHS', m[4] ?? 0], ['K/D', kd], ['HEADSHOTS', p.headshots], ['ACCURACY', acc + '%'], ['SCORE', m[5] ?? 0, true]]);
    const rows = r.rows.slice().sort((a, b) => b[5] - a[5] || b[3] - a[3]);
    $('sumTable').innerHTML = `<table><tr><th>#</th><th>PLAYER</th>${r.mode === 'tdm' ? '<th>TEAM</th>' : ''}<th>SCORE</th><th>K</th><th>D</th><th>HS</th><th>ACC</th></tr>${rows.map((x, i) => `<tr class="${x[0] === r.myId ? 'me' : ''}${r.mode === 'tdm' ? (x[2] ? ' red' : ' blue') : ''}"><td>${i + 1}</td><td>${esc(x[1])}</td>${r.mode === 'tdm' ? `<td>${x[2] ? 'RED' : 'BLUE'}</td>` : ''}<td>${x[5]}</td><td>${x[3]}</td><td>${x[4]}</td><td>${x[6]}</td><td>${x[7]}%</td></tr>`).join('')}</table>`;
    $('sumTable').classList.remove('hidden');
    $('btnRestart').textContent = 'BACK TO LOBBY'; $('btnMenu').textContent = this.mp.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM';
    this.fillAAR(); this.showScreen('gameover'); this.sfx.ui(r.won ? 'select' : 'back');
  }
  summaryCards(list) { $('stats').innerHTML = list.map(([k, v, hl], i) => `<div class="sc${hl ? ' hl' : ''}" style="animation-delay:${i * 0.06}s"><small>${k}</small><b>${v}</b></div>`).join(''); }
  // XP / coin breakdown + animated rank bar
  fillAAR() {
    const e = this.earn, line = (k, v, cls = '') => `<div class="ln ${cls}"><span>${k}</span><b>+${fmt(v)}</b></div>`;
    $('xpLines').innerHTML = (e.kills ? line(`Kills × ${e.kills}`, e.kills * 100) : '') + (e.hs ? line(`Headshots × ${e.hs}`, e.hs * 50) : '') + (e.streakXP ? line('Kill streaks', e.streakXP) : '') + (e.waves ? line(`Waves cleared × ${e.waves}`, e.waves * 150) : '') + (e.mission ? line('Mission · ' + e.mission.name, e.mission.xp) : '') + (e.match ? line('Match completed', 200) : '') + (e.win ? line('Victory', 500) : '') || '<div class="ln none"><span>No XP this time</span></div>';
    $('xpTotal').textContent = '+' + fmt(e.xp);
    $('coinLines').innerHTML = (e.kills ? line(`Kills × ${e.kills}`, e.kills * COINS.kill) : '') + (e.hs ? line(`Headshots × ${e.hs}`, e.hs * COINS.headshot) : '') + (e.streakCoins ? line('Kill streaks', e.streakCoins) : '') + (e.waves ? line(`Waves × ${e.waves}`, e.waves * COINS.wave) : '') + (e.mission ? line('Mission · ' + e.mission.name, e.mission.coins) : '') + (e.match ? line('Match completed', COINS.match) : '') + (e.win ? line('Victory', COINS.win) : '') || '<div class="ln none"><span>No coins this time</span></div>';
    $('coinTotal').textContent = '+' + fmt(e.coins); $('coinBal').textContent = fmt(prog().coins);
    const A = levelOf(e.startXP), B = levelOf(prog().xp), up = B.lv > A.lv;
    $('rkA').textContent = B.lv; $('rkB').textContent = B.lv + 1; $('rankUp').classList.toggle('hidden', !up); if (up) $('rankUp').textContent = `RANK UP · ${B.lv} · ${rankName(B.lv)}`;
    const prev = up ? 0 : A.frac; $('rbPrev').style.width = (prev * 100).toFixed(1) + '%'; $('rbGain').style.width = '0%';
    setTimeout(() => { $('rbGain').style.width = (Math.max(0, B.frac - prev) * 100).toFixed(1) + '%'; }, 350);
  }
  waveStats() { const p = this.player; return { kills: this.kills, shots: p.shots, hits: p.hits, hs: p.headshots, score: this.score }; }
  nextWave() {
    this.wave++; this.waveKills = 0; this.spawned = 0; this.spawnT = 1.5;
    const coop = this.mp && this.mp.active && this.mp.mode === 'coop';
    this.waveTotal = coop ? this.mp.coopWaveSize(this.wave) : 3 + this.wave * 2;
    this.maxAlive = Math.min(coop ? 12 : 9, 3 + this.wave + (coop ? this.mp.players.size - 1 : 0));
    if (this.wave > 1) { this.player.addAmmo(2); this.player.health = Math.min(100, this.player.health + 40); }
    this.hud.banner('WAVE ' + this.wave, `${this.waveTotal} HOSTILES INBOUND`, 3); this.sfx.announce(`Wave ${this.wave}. ${this.waveTotal} hostiles inbound.`);
    this.waveStart = this.waveStats();
    if (coop) this.mp.onWaveStart();
  }
  pause() {
    if (this.state !== 'playing' || this.mpPaused) return;
    this.input.keys = {}; this.input.fire = this.input.aim = false; if (document.pointerLockElement) document.exitPointerLock();
    if (this.mp.active) { this.mpPaused = true; $('pauseinfo').textContent = 'MATCH IS STILL RUNNING · ROOM ' + this.mp.code; this.showScreen('pause'); return; }
    this.state = 'paused'; $('pauseinfo').textContent = `WAVE ${this.wave} · ${this.kills} KILLS · SCORE ${this.score}`; if (this.campaign.cur) $('pauseinfo').textContent = `${this.campaign.cur.name} · ${this.kills} KILLS`; $('quitlbl').textContent = 'QUIT TO MENU'; this.showScreen('pause');
  }
  resume() {
    if (this.mpPaused) { this.mpPaused = false; this.showScreen(null); this.hadLock = false; if (!this.testMode) this.lock(); if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); } return; }
    if (this.state !== 'paused') return; this.state = 'playing'; this.showScreen(null); this.hadLock = false; if (!this.testMode) this.lock(); if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); }
  }
  toMenu(keepRoom) {
    if (!keepRoom && this.mp.role && !this.mp.leaving) { this.mp.leave(); return; }
    this.campaign.stop(); this.state = 'menu'; this.mpPaused = false; for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = []; this.pickups.clear();
    this.vehicles.reset(); this.setPlayerTint(this.opLook()); this.player.reset(this.world.playerSpawn); this.hud.weaponChanged(); this.menuPose();
    $('btnRestart').textContent = 'PLAY AGAIN'; $('btnMenu').textContent = 'MAIN MENU'; $('sumTable').innerHTML = '';
    if (!keepRoom) this.showScreen('menu'); if (document.pointerLockElement) document.exitPointerLock();
  }
  alert(pos, r) { for (const e of this.enemies) if (!e.dead && e.pos.distanceTo(pos) < r) e.alert(); }
  spawnEnemy(at, forceLook) {
    const p = this.player.pos;
    const cands = this.world.enemySpawns.filter(s => s.distanceTo(p) > 20 && !this.enemies.some(e => !e.dead && e.pos.distanceTo(s) < 1.5));
    const list = cands.length ? cands : this.world.enemySpawns;
    const sp = at ? at.clone() : list[(Math.random() * list.length) | 0].clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
    const nid = this.nextNid = (this.nextNid || 0) + 1; // the look follows the network id so co-op clients see the same soldier
    const look = forceLook || (this.forceLook !== undefined ? this.forceLook : enemyLook(nid));
    const c = this.factory.create(look ? { look } : { tint: TINTS[nid % TINTS.length] }); this.scene.add(c.root);
    const e = new Enemy(this, c, sp, this.wave); e.nid = nid; this.enemies.push(e); this.spawned++; return e;
  }
  onEnemyKilled(e, head) {
    this.waveKills++;
    if (this.mp.active) { this.mp.onEnemyKilled(e, head); return; } // co-op host: credit whoever fired
    if (this.campaign.cur) this.campaign.onKill(e);
    this.kills++; this.score += 100 + (head ? 50 : 0) + this.wave * 10;
    this.hud.kill(head, 100 + (head ? 50 : 0) + this.wave * 10, this.player.weapon);
    const r = Math.random(); if (this.forceDrop || r < 0.7) this.pickups.spawn(e.pos.clone(), !this.forceDrop && r < 0.1 ? 'medkit' : 'ammo');
  }
  onPlayerDeath() {
    this.hud.resetStreak();
    if (this.mp.active) { this.mp.onLocalDeath(); return; }
    this.gameOverT = 3.2; if (this.campaign.cur && !this.campaign.done) this.campaign.finish(false);
  }
  // menu music: plays on the menu screens, fades out in a match
  onScreen(id) { this.sfx.music(!!id && !this.inMatch() && this.state !== 'loading'); }
  gameOver() {
    if (this.campaign.cur) { this.sfx.announce(this.campaign.win ? 'Mission complete.' : 'Mission failed.'); this.missionEnd(); return; }
    this.sfx.announce('Operation over.');
    this.state = 'gameover'; this.input.fire = this.input.aim = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player; const acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0, secs = Math.round(this.time - (this.startT || 0));
    if (!this.earn.ended) { this.earn.ended = true; const P = prog(); P.matches++; P.kills += this.kills; P.deaths++; P.headshots += p.headshots; P.bestWave = Math.max(P.bestWave, this.wave); P.bestWaveMap = P.bestWaveMap || {}; P.bestWaveMap[this.world.mapId] = Math.max(P.bestWaveMap[this.world.mapId] || 0, this.wave); P.bestScore = Math.max(P.bestScore, this.score); P.bestStreak = Math.max(P.bestStreak, this.hud.bestStreak); saveProg(); }
    $('sumTitle').textContent = 'K.I.A.'; $('sumTitle').className = 'red'; $('sumSub').textContent = `${MAP_BY_ID[this.world.mapId].name} · WAVE ${this.wave} REACHED · ${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')} SURVIVED`;
    this.summaryCards([['WAVE', this.wave, true], ['KILLS', this.kills], ['HEADSHOTS', p.headshots], ['ACCURACY', acc + '%'], ['BEST STREAK', this.hud.bestStreak], ['SCORE', this.score, true]]);
    $('sumTable').innerHTML = ''; $('sumTable').classList.add('hidden'); $('btnRestart').textContent = 'PLAY AGAIN'; $('btnMenu').textContent = 'MAIN MENU';
    this.fillAAR(); this.showScreen('gameover');
  }
  // campaign mission over: complete / failed screen (same after-action layout as survival)
  missionEnd() {
    const C = this.campaign, m = C.cur, r = C.result || { win: false, stars: 0, time: this.time - (C.t0 || 0) };
    this.state = 'gameover'; this.input.fire = this.input.aim = false; if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player, acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0, secs = Math.round(r.time);
    if (!this.earn.ended) { this.earn.ended = true; const P = prog(); P.matches++; P.kills += this.kills; if (!r.win) P.deaths++; else P.wins++; P.headshots += p.headshots; P.bestStreak = Math.max(P.bestStreak, this.hud.bestStreak); saveProg(); }
    $('sumTitle').textContent = r.win ? 'MISSION COMPLETE' : 'MISSION FAILED'; $('sumTitle').className = r.win ? 'gold' : 'red';
    $('sumSub').textContent = `${m.name} · ${MAP_BY_ID[m.map].name}` + (r.win ? (r.first ? ' · FIRST CLEAR' : '') : ' · OPERATOR DOWN');
    const stars = `<span class="stars">${'<i class="on">★</i>'.repeat(r.stars)}${'<i>★</i>'.repeat(3 - r.stars)}</span>`;
    this.summaryCards([['STARS', stars, true], ['TIME', `${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')}`], ['KILLS', this.kills], ['HEADSHOTS', p.headshots], ['ACCURACY', acc + '%'], ['HEALTH', r.win ? Math.round(p.health) : 0]]);
    $('sumTable').innerHTML = `<div class="starreq"><span class="${r.stars >= 1 ? 'on' : ''}">★ Complete the mission</span><span class="${r.win && secs <= m.par ? 'on' : ''}">★ Finish within ${(m.par / 60) | 0}:${String(m.par % 60).padStart(2, '0')}</span><span class="${r.win && p.health >= 50 ? 'on' : ''}">★ Finish with 50+ health</span></div>`; $('sumTable').classList.remove('hidden');
    const n = r.win && C.nextMission(); $('btnRestart').textContent = n ? 'NEXT MISSION' : 'RETRY MISSION'; $('btnMenu').textContent = 'CAMPAIGN';
    this.fillAAR(); this.showScreen('gameover'); this.sfx.ui(r.win ? 'select' : 'back');
  }
  updateGame(dt) {
    this.time += dt;
    const inp = this.mpPaused || (this.mp.active && this.mp.chatOpen) ? { keys: {}, fire: false, aim: false } : this.input;
    this.vehicles.update(dt, inp);
    this.player.update(dt, inp);
    const mpClient = this.mp.active && !this.mp.isHost;
    if (!mpClient) for (const e of this.enemies) e.update(dt);
    this.pickups.update(dt);
    if (this.mp.active) this.mp.update(dt);
    if (mpClient || (this.mp.active && this.mp.mode !== 'coop')) return;
    // cleanup corpses
    for (const e of this.enemies) if (e.dead && e.deadT > 8) { e.c.dispose(this.scene); e.removed = true; }
    this.enemies = this.enemies.filter(e => !e.removed);
    // waves
    const C = this.campaign.cur ? this.campaign : null; if (C) C.update(dt);
    if ((this.mp.active ? this.mp.anyAlive() : !this.player.dead) && (!C || (C.wavesMode && !C.done))) {
      const alive = this.enemies.filter(e => !e.dead).length;
      if (this.spawned < this.waveTotal) { this.spawnT -= dt; if (this.spawnT <= 0 && alive < this.maxAlive) { this.spawnEnemy(); this.spawnT = 1.6; } }
      else if (alive === 0) {
        if (this.intermission <= 0 && C && C.onWaveCleared()) { this.intermission = 0; if (!this.player.dead) { this.earn.waves++; this.reward(COINS.wave, 150); } }
        else if (this.intermission <= 0) {
          this.intermission = 6; this.hud.banner('WAVE CLEARED', 'RESUPPLY: +AMMO +HEALTH', 3); this.sfx.announce('Wave cleared.'); if (!this.player.dead) { this.earn.waves++; this.reward(COINS.wave, 150); } this.mp.banner('WAVE CLEARED', 'RESUPPLY: +AMMO +HEALTH');
          const a = this.waveStart || {}, b = this.waveStats(), sh = b.shots - (a.shots || 0);
          this.hud.waveCard({ wave: this.wave, kills: b.kills - (a.kills || 0), hs: b.hs - (a.hs || 0), acc: sh ? Math.round((b.hits - (a.hits || 0)) / sh * 100) : 0, score: b.score - (a.score || 0) });
        }
        if (!C || C.wavesMode) { this.intermission -= dt; if (this.intermission <= 0) { this.intermission = 0; this.nextWave(); } }
      }
    }
    if (this.gameOverT > 0) { this.gameOverT -= dt; if (this.gameOverT <= 0) this.gameOver(); }
  }
  // v1.5: blend the camera from where it was when climbing into / out of a vehicle
  updateCamera(dt) {
    this.updateCamera0(dt); const tr = this.player && this.player.vehTrans; if (!tr || !tr.camP || this.state === 'menu') return;
    const cam = this.camera, k0 = Math.min(1, tr.t / tr.dur), k = k0 * k0 * (3 - 2 * k0);
    cam.position.lerpVectors(tr.camP, cam.position.clone(), k); cam.quaternion.slerpQuaternions(tr.camQ, cam.quaternion.clone(), k);
  }
  updateCamera0(dt) {
    const p = this.player, cam = this.camera;
    if (this.state === 'menu') {
      // slow orbit around the operator; the view is shifted so he stands right of the menu buttons
      const t = this.time * 0.08 + 0.6; const c = p.pos.clone().add(new THREE.Vector3(0, 1.15, 0));
      cam.position.set(c.x + Math.sin(t) * 3.9, c.y + 0.25 + Math.sin(t * 0.7) * 0.12, c.z + Math.cos(t) * 3.9);
      cam.lookAt(c); cam.fov = 40;
      const w = innerWidth, h = innerHeight; if (w > h * 1.15) cam.setViewOffset(w, h, -w * 0.17, 0, w, h); else cam.clearViewOffset();
      cam.updateProjectionMatrix(); return;
    }
    if (cam.view && cam.view.enabled) cam.clearViewOffset();
    if (p.vehicle && !p.dead) { // third-person chase camera around the vehicle (mouse / right thumb orbits, swings back behind when driving)
      const v = p.vehicle, pitch = THREE.MathUtils.clamp(p.pitch, -0.7, 0.35), yaw = p.yaw;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const pivot = v.pos.clone(); pivot.y += v.h + 0.15;
      const back = (this.driveCamFar ? 8.5 : 5.4) + Math.min(2, Math.abs(v.speed) * 0.08);
      const boxes = this.world.boxes.filter(b => b.owner !== v);
      const bh = raycastBoxes(boxes, pivot, dir.clone().negate(), back + 0.3);
      const want = bh ? Math.max(1.2, bh.t - 0.3) : back;
      this.camBack = want < this.camBack ? want : this.camBack + (want - this.camBack) * Math.min(1, dt * 4);
      cam.position.copy(pivot).addScaledVector(dir, -this.camBack); if (cam.position.y < v.pos.y + 0.5) cam.position.y = v.pos.y + 0.5;
      cam.rotation.set(pitch - 0.12, yaw, 0, 'YXZ');
      if (this.shake > 0) { cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.004; cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.004; this.shake = Math.max(0, this.shake - dt * 6); }
      const fov = this.settings.fov + Math.min(8, Math.abs(v.speed) * 0.4); cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix();
      p.c.root.visible = true; this.aimT = 0; return;
    }
    this.aimT += ((p.aiming && !p.dead ? 1 : 0) - this.aimT) * Math.min(1, dt * 12);
    this.pivotY += (p.eyeHeight - this.pivotY) * Math.min(1, dt * 10);
    const yaw = p.yaw, pitch = p.pitch;
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = rightVec(yaw);
    const pivot = p.pos.clone(); pivot.y += this.pivotY;
    const side = THREE.MathUtils.lerp(0.55, 0.62, this.aimT) * this.shoulder;
    let back = THREE.MathUtils.lerp(p.sprint ? 2.9 : 2.6, 1.25, this.aimT);
    if (p.dead) back = 3.5;
    let shoulder = pivot.clone().addScaledVector(right, side); shoulder.y += 0.1;
    const sd = shoulder.clone().sub(pivot); const sl = sd.length(); sd.normalize();
    const sh = raycastBoxes(this.world.boxes, pivot, sd, sl + 0.2); if (sh) shoulder = pivot.clone().addScaledVector(sd, Math.max(0, sh.t - 0.2));
    const bh = raycastBoxes(this.world.boxes, shoulder, dir.clone().negate(), back + 0.25);
    let wantBack = bh ? Math.max(0.3, bh.t - 0.25) : back;
    this.camBack = wantBack < this.camBack ? wantBack : this.camBack + (wantBack - this.camBack) * Math.min(1, dt * 6);
    cam.position.copy(shoulder).addScaledVector(dir, -this.camBack);
    if (cam.position.y < 0.2) cam.position.y = 0.2;
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    if (this.shake > 0) { const a = this.settings.shakeAmt * 2; cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.004 * a; cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.004 * a; this.shake = Math.max(0, this.shake - dt * 6); }
    const W = p.weapon, scoped = !!W.scope && !p.switching && p.reloading <= 0;
    const S = this.settings, hip = S.fov, ads = THREE.MathUtils.lerp(hip, S.fpFov, this.aimT) - W.zoom * this.aimT * S.adsFov;
    const fov = scoped && this.aimT > 0.85 ? W.scopeFov / Math.max(0.5, S.adsFov) * 0.85 : ads + (p.sprint ? 6 : 0);
    if (scoped && this.aimT > 0.85) cam.fov = fov; // snap into the scope
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix();
    // hide the player model if the camera is inside it
    p.c.root.visible = (this.camBack > 0.45 || p.dead) && !(scoped && this.aimT > 0.85);
  }
  // test helpers (headless verification)
  sim(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) { if (this.state === 'playing' || this.state === 'gameover') this.updateGame(dt); this.updateCamera(dt); this.fx.update(dt); if (this.state === 'playing') this.hud.update(dt); } }
  renderOnce() { this.updateCamera(0.016); this.sfx.listener(this.camera); if (this.state === 'playing' || this.state === 'paused') this.hud.update(0.001); this.composer.render(0.016); }
  frame() {
    const cap = this.settings.fpsCap, now = performance.now();
    if (cap !== 'max' && !this.testMode) { const iv = 1000 / +cap; if (now - (this.lastFrame || 0) < iv - 2) return; this.lastFrame = now; }
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.testMode && this.fixedDt) { this.step(this.fixedDt); } else this.step(dt);
  }
  // test helper: run the game logic on a timer without rendering (software-GL headless browsers render very slowly)
  headless(on = true, hz = 30) {
    clearInterval(this.hlI); this.renderer.setAnimationLoop(on ? null : () => this.frame());
    if (on) { let last = performance.now(); this.hlI = setInterval(() => { const t = performance.now(); this.step(Math.min(0.05, (t - last) / 1000), false); last = t; }, 1000 / hz); }
  }
  step(dt, render = true) {
    if (this.state === 'playing' || this.state === 'gameover') this.updateGame(dt);
    else if (this.state === 'menu') { this.time += dt; this.player.c.update(dt); }
    this.updateCamera(dt);
    this.fx.update(dt);
    // keep the sun shadow frustum centred on the action
    const p = this.player.pos; this.sun.target.position.set(p.x * 0.3, 0, p.z * 0.3); this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.sfx.listener(this.camera);
    if (this.state === 'playing' || this.state === 'paused') this.hud.update(dt);
    if (this.dof) { // depth of field only behind the menus (not on phones: keep them fast)
      const on = this.state === 'menu' && !MOBILE; this.dof.enabled = on;
      if (on) { const u = this.dof.uniforms; u.aspect.value = innerWidth / innerHeight; u.px.value.set(1 / innerWidth, 1 / innerHeight); u.focus.value.set(innerWidth > innerHeight * 1.15 ? 0.67 : 0.5, 0.48); }
    }
    this.frameN = (this.frameN || 0) + 1;
    this.renderer.shadowMap.autoUpdate = (this.shadowEvery || 1) === 1 || this.frameN % 2 === 0 || this.state !== 'playing';
    if (render && !this.ui.renderPreview(dt)) this.composer.render(dt);
    // fps
    this.fpsAcc.push(dt); if (this.fpsAcc.length > 30) this.fpsAcc.shift();
    const S = this.settings, f = 1 / (this.fpsAcc.reduce((a, b) => a + b, 0) / this.fpsAcc.length);
    // dynamic resolution: drop the render scale when below ~50 fps, raise it again above ~58 (or the cap)
    if (S.dynRes && render && !this.testMode) { this.dynT = (this.dynT || 0) + dt; if (this.dynT > 1.5) { this.dynT = 0; const tgt = Math.min(57, S.fpsCap === 'max' ? 57 : +S.fpsCap - 3), d = this.dynScale || 1;
      const n = f < tgt - 8 ? Math.max(0.5, d - 0.1) : f > tgt && d < 1 ? Math.min(1, d + 0.05) : d; if (n !== d) { this.dynScale = n; this.resize(); } } }
    this.fpsTxT = (this.fpsTxT || 0) - dt;
    if (this.fpsTxT <= 0) { this.fpsTxT = 0.25;
      const ns = S.netStats, mp = this.mp && this.mp.active, parts = [];
      if (S.fps || (ns !== 'off' && this.inMatch())) parts.push(`${f.toFixed(0)} FPS`);
      if (mp && ns !== 'off' && this.mp.pingMs != null) parts.push(`${Math.round(this.mp.pingMs)} MS`);
      if (S.fps || ns === 'all') { const b = this.renderer.getDrawingBufferSize(new THREE.Vector2()); parts.push(`${b.x}x${b.y}`); if (ns === 'all' || S.fps) parts.push(`${this.renderer.info.render.calls} DRAWS`); if (ns === 'all' && mp) parts.push(`${this.mp.peers ? this.mp.peers.size || 0 : 0} PEERS`); }
      $('fps').textContent = parts.join('  ');
    }
  }
}

// Windows / Linux desktop app (Neutralinojs): native exit button, F11 fullscreen toggle, laptop-friendly default quality
const APP = typeof window.Neutralino !== 'undefined';
if (APP) { try { Neutralino.init(); Neutralino.events.on('windowClose', () => Neutralino.app.exit()); } catch (e) {} if (!localStorage.getItem('swat-settings')) localStorage.setItem('swat-settings', JSON.stringify({ quality: 'medium' })); }
const game = window.__game = new Game();
// ---- phones in a browser: tap-to-play splash (fullscreen needs a user gesture), PWA install, service worker
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (MOBILE && !NATIVE && !APP) {
  const splash = $('tapsplash'); let started = false;
  const iosNoFs = isIOS() && !fullscreenSupported() && !isStandalone();
  if (iosNoFs && !localStorage.getItem('swat-ios-hint')) { $('ioshint').classList.remove('hidden'); localStorage.setItem('swat-ios-hint', '1'); }
  if (params.get('nosplash') !== '1') splash.classList.remove('hidden'); else started = true;
  const first = (e) => {
    if (started) return; started = true; e.preventDefault();
    window.__fsRequested = (window.__fsRequested || 0) + 1;
    goFullscreenLandscape(); game.sfx.init();
    splash.classList.add('hidden'); setTimeout(() => game.relayout && game.state !== 'loading' && game.relayout(), 400);
  };
  splash.addEventListener('touchend', first, { passive: false }); splash.addEventListener('click', first);
  // the user left fullscreen (back gesture / swipe): any later tap asks again
  document.addEventListener('touchend', () => {
    if (!started || isFullscreen() || isStandalone() || !fullscreenSupported()) return;
    window.__fsRequested = (window.__fsRequested || 0) + 1; goFullscreenLandscape();
  }, { capture: true, passive: true });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  if ('serviceWorker' in navigator && params.get('nosw') !== '1') addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => { window.__sw = r.scope; }).catch(e => { window.__swErr = String(e); }));
}
if (APP) {
  document.querySelectorAll('.appexit').forEach(b => { b.classList.remove('hidden'); b.onclick = () => { try { Neutralino.app.exit(); } catch (e) { window.close(); } }; });
  addEventListener('keydown', async (e) => { if (e.code === 'F11') { e.preventDefault(); try { (await Neutralino.window.isFullScreen()) ? Neutralino.window.exitFullScreen() : Neutralino.window.setFullScreen(); } catch (err) {} } });
}
if (params.has('test')) game.testMode = true;

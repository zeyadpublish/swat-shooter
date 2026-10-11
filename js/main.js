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
import { World, analyzeHDR } from './world.js';
import { raycastBoxes } from './physics.js';
import { CharacterFactory } from './character.js';
import { FX } from './fx.js';
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
  applyCrosshair() { $('crosshair').style.setProperty('--xc', this.g.settings.xhair || '#fff'); }
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
    if (big) { $('streak').innerHTML = `<div class="sk">${big}${small ? `<small>${small}</small>` : ''}</div>`; this.g.sfx.streak(Math.min(4, n >= 2 ? n - 1 : L / 5)); }
    if (this.g.settings.xp) this.popup(`+${pts}${head ? ' HEADSHOT' : ''}`, head);
  }
  popup(text, hs) {
    const d = document.createElement('div'); d.className = 'xp' + (hs ? ' hs' : ''); d.textContent = text;
    d.style.top = (-10 + $('popups').children.length * 24) + 'px'; $('popups').appendChild(d); setTimeout(() => d.remove(), 1150);
  }
  damageNumber(point, dmg, head) {
    if (!this.g.settings.dmgNum || !point) return;
    const v = point.clone().project(this.g.camera); if (v.z > 1) return;
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
    d.innerHTML = `${killer}${w ? `<img src="${w.thumb}" alt="${w.name}" title="${w.name}">` : icon('skull')}${head ? icon('headshot') : ''}${victim}${pts ? `<span class="pts">+${pts}</span>` : ''}`;
    $('killfeed').prepend(d); (this.feedItems = this.feedItems || []).push({ d, t: 0 });
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  }
  // static top-down map of the city (buildings + roads) for the radar
  buildMap() {
    const S = 4, N = 150, c = document.createElement('canvas'); c.width = c.height = N * 2 * S; const x = c.getContext('2d');
    x.fillStyle = '#2b3036'; x.fillRect(0, 0, c.width, c.height);
    const P = (v) => (v + N) * S;
    x.fillStyle = '#4a5058'; x.fillRect(P(-6), 0, 12 * S, c.height); x.fillRect(0, P(-6), c.width, 12 * S); // roads
    x.fillStyle = 'rgba(255,214,90,.55)'; x.fillRect(P(-0.2), 0, 0.4 * S, c.height); x.fillRect(0, P(-0.2), c.width, 0.4 * S);
    for (const b of this.g.world.boxes) {
      const h = b.max.y - b.min.y, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (b.min.y > 0.5 || w * d > 6000 || h < 0.6) continue;
      x.fillStyle = h > 4 ? '#8b9097' : '#626870';
      x.fillRect(P(b.min.x), P(b.min.z), w * S, d * S);
      if (h > 4) { x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 2; x.strokeRect(P(b.min.x), P(b.min.z), w * S, d * S); }
    }
    this.map = c; this.mapS = S; this.mapN = N;
  }
  drawRadar() {
    if (!this.map) this.buildMap();
    const ctx = this.radar, W = ctx.canvas.width, g = this.g, p = g.player, R = 38; // metres shown to the edge
    const k = (W / 2) / R;
    ctx.clearRect(0, 0, W, W); ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate(p.yaw);
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
    for (const it of g.pickups ? g.pickups.items : []) {
      let dx = (it.pos.x - p.pos.x) * k, dz = (it.pos.z - p.pos.z) * k; const m = Math.hypot(dx, dz), lim = W / 2 - 9;
      if (m > lim) { dx *= lim / m; dz *= lim / m; }
      ctx.fillStyle = '#ffc94a'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.fillRect(dx - 5, dz - 5, 10, 10); ctx.strokeRect(dx - 5, dz - 5, 10, 10);
    }
    ctx.restore();
    // view cone + player arrow (always facing up)
    ctx.save(); ctx.translate(W / 2, W / 2);
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
    const gap = (p.aiming ? 3 : 6) + p.spread() * 900; const ch = $('crosshair');
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
    if (g.touch) g.touch.update();
  }
}

class Game {
  constructor() {
    this.canvas = $('c');
    this.mobile = MOBILE;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('swat-settings') || '{}') || {}; } catch (e) {}
    this.settings = Object.assign({ quality: MOBILE ? 'mobile' : 'high', res: 'native', sens: 1, adsSens: 1, fov: 72, vol: 0.8, fxVol: 1, uiVol: 0.8, invert: false, fps: false, hand: 'right', btnOp: 0.85, haptics: true,
      name: 'Operator-' + (100 + Math.random() * 900 | 0), dmgNum: false, xp: true, xhair: '#ffffff', allWeapons: false, layout: {}, primary: 'm4a1', secondary: 'pistol' }, saved);
    const st = this.settings; st.name = cleanName(st.name) || 'Operator';
    if (!PRIMARIES.includes(st.primary)) st.primary = 'm4a1'; if (!SECONDARIES.includes(st.secondary) || st.secondary === st.primary) st.secondary = st.primary === 'pistol' ? 'mac10' : 'pistol';
    if (!localStorage.getItem('swat-settings')) localStorage.setItem('swat-settings', JSON.stringify(st));
    if (params.get('quality')) this.settings.quality = params.get('quality');
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
    const hdrP = new RGBELoader(mgr).loadAsync(asset('assets/hdr/kloofendal_48d_partly_cloudy_puresky.hdr'));
    const cityLoader = new GLTFLoader(mgr); cityLoader.setMeshoptDecoder(MeshoptDecoder);
    await this.world.loadCity(cityLoader);
    this.world.build({ lite: this.lite });
    const [gltf, hdr, gun] = await Promise.all([gltfP, hdrP, gunP]);
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
    this.scene.add(new THREE.HemisphereLight(0xbcd0e6, 0x3a332c, 0.35));
    // characters
    const gunScenes = {}; WEAPONS.forEach((w, i) => gunScenes[w.id] = gun[i].scene);
    this.factory = new CharacterFactory(gltf, gunScenes, WEAPON_BY_ID);
    window.__gunCal = this.factory.debug;
    this.fx = new FX(this.scene);
    for (const s of this.fx.shells) s.onBounce = (p) => this.sfx.shellTink(p);
    const pc = this.factory.create({ isPlayer: true }); this.scene.add(pc.root);
    this.player = new Player(this, pc);
    this.pickups = new Pickups(this); this.hud.weaponChanged(); this.hud.applyCrosshair();
    this.ui.progress(0.95, 'Preparing the city…');
    this.setupPost(); this.applySettings();
    this.mp = new MP(this);
    this.bindUI(); this.bindInput();
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
  setupPost() {
    const q = QUALITY[this.settings.quality] || QUALITY.high;
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.msaa });
    const c = this.composer = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = this.ao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1.1, samples: this.settings.quality === 'ultra' ? 24 : 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      ao.blendIntensity = 0.9; c.addPass(ao);
    } else this.ao = null;
    if (q.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 3.5));
    this.dof = new ShaderPass(MenuDOF); this.dof.enabled = false; c.addPass(this.dof);
    c.addPass(new OutputPass());
  }
  pixelRatio() {
    const q = QUALITY[this.settings.quality] || QUALITY.high, res = this.settings.res;
    if (res === 'native') return Math.min(devicePixelRatio || 1, q.prCap);
    return Math.min(4, parseInt(res) / innerHeight);
  }
  applySettings() {
    const s = this.settings; localStorage.setItem('swat-settings', JSON.stringify(s));
    const q = QUALITY[s.quality] || QUALITY.high;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.setupPost();
    this.sfx.setVolume(s.vol, s.fxVol, s.uiVol);
    this.resize();
  }
  // mobile browsers: address bar showing/hiding, rotation, entering/leaving fullscreen
  relayout() { this.resize(); if (this.touch) this.touch.layout(); }
  resize() {
    const w = innerWidth, h = innerHeight, pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    $('resinfo').textContent = `Rendering at ${Math.round(w * pr)} × ${Math.round(h * pr)} px (pixel ratio ${pr.toFixed(2)})`;
  }
  showScreen(id) { this.ui.show(id); }
  saveSettings() { localStorage.setItem('swat-settings', JSON.stringify(this.settings)); }
  inMatch() { return this.state === 'playing' || this.state === 'paused'; }
  // weapons carried: primary + secondary (solo option: all six)
  loadoutIds() {
    const s = this.settings;
    if (s.allWeapons && !(this.mp && this.mp.active)) return [s.primary, ...WEAPONS.map(w => w.id).filter(id => id !== s.primary)];
    return [s.primary, s.secondary];
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
    $('btnPlay').onclick = () => this.startGame();
    $('btnResume').onclick = () => this.resume();
    $('btnRestart').onclick = () => { if (this.mp.role) this.mp.backToLobby(); else this.startGame(); };
    $('btnQuit').onclick = () => { if (this.mp.role) this.mp.leave(); else this.toMenu(); };
    $('btnMenu').onclick = () => { if (this.mp.role) this.mp.leave(); else this.toMenu(); };
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
  haptic(p) { if (this.mobile && this.settings.haptics && !this.testMode && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }
  look(dx, dy) {
    const p = this.player, k = 0.0022 * this.settings.sens * (p.aiming ? (p.weapon.scope ? 0.22 : 0.6) * (this.settings.adsSens || 1) : 1);
    this.player.yaw -= dx * k; this.player.pitch -= dy * k * (this.settings.invert ? -1 : 1);
    this.player.pitch = THREE.MathUtils.clamp(this.player.pitch, -1.15, 1.2);
  }
  startGame() {
    this.sfx.init(); this.setPlayerTint(null); this.mpPaused = false;
    for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = [];
    this.player.reset(this.world.playerSpawn); this.player.c.root.visible = true; this.pickups.clear(); this.hud.weaponChanged(); this.hud.resetMatch();
    this.kills = 0; this.score = 0; this.wave = 0; this.waveKills = 0; this.waveTotal = 0; this.intermission = 0; this.gameOverT = -1; this.startT = this.time;
    this.input.keys = {}; this.input.fire = this.input.aim = false;
    this.state = 'playing'; this.showScreen(null); this.hadLock = false;
    if (!this.testMode) this.lock();
    if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); }
    this.nextWave();
  }
  // multiplayer match start (called by MP for host and clients)
  startMP(mode, spawn, yaw, tint, isHost) {
    this.sfx.init(); this.setPlayerTint(tint); this.mpPaused = false;
    for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = [];
    this.player.respawn(spawn, yaw); this.player.shots = this.player.hits = this.player.headshots = 0; this.pickups.clear(); this.hud.resetMatch(); this.hud.weaponChanged();
    this.kills = 0; this.score = 0; this.wave = 0; this.waveKills = 0; this.waveTotal = 0; this.intermission = 0; this.gameOverT = -1; this.startT = this.time;
    this.input.keys = {}; this.input.fire = this.input.aim = false;
    this.state = 'playing'; this.showScreen(null); this.hadLock = false;
    if (MOBILE) this.touch.reset();
    $('quitlbl').textContent = isHost ? 'END & CLOSE ROOM' : 'LEAVE MATCH';
    if (mode === 'coop' && isHost) this.nextWave();
  }
  // multiplayer match over: summary with the standings
  endMP(r) {
    this.state = 'gameover'; this.mpPaused = false; this.input.fire = this.input.aim = false; if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player, acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0, m = r.mine;
    $('sumTitle').textContent = r.title; $('sumTitle').className = r.won ? 'gold' : r.mode === 'tdm' && r.title.startsWith('BLUE') ? 'blue' : 'red';
    $('sumSub').textContent = (r.won ? 'VICTORY · ' : r.mode !== 'coop' ? 'DEFEAT · ' : '') + r.sub;
    this.summaryCards([['KILLS', m[3] ?? 0, true], ['DEATHS', m[4] ?? 0], ['HEADSHOTS', p.headshots], ['ACCURACY', acc + '%'], ['SCORE', m[5] ?? 0, true]]);
    const rows = r.rows.slice().sort((a, b) => b[5] - a[5] || b[3] - a[3]);
    $('sumTable').innerHTML = `<table><tr><th>PLAYER</th>${r.mode === 'tdm' ? '<th>TEAM</th>' : ''}<th>K</th><th>D</th><th>HS</th><th>ACC</th><th>SCORE</th></tr>${rows.map(x => `<tr class="${x[0] === r.myId ? 'me' : ''}"><td>${esc(x[1])}</td>${r.mode === 'tdm' ? `<td style="color:${x[2] ? '#ff8f80' : '#8cc6ff'}">${x[2] ? 'RED' : 'BLUE'}</td>` : ''}<td>${x[3]}</td><td>${x[4]}</td><td>${x[6]}</td><td>${x[7]}%</td><td>${x[5]}</td></tr>`).join('')}</table>`;
    $('btnRestart').textContent = 'BACK TO LOBBY'; $('btnMenu').textContent = this.mp.isHost ? 'CLOSE ROOM' : 'LEAVE ROOM';
    this.showScreen('gameover'); this.sfx.ui(r.won ? 'select' : 'back');
  }
  summaryCards(list) { $('stats').innerHTML = list.map(([k, v, hl], i) => `<div class="sc${hl ? ' hl' : ''}" style="animation-delay:${i * 0.07}s"><small>${k}</small><b>${v}</b></div>`).join(''); }
  waveStats() { const p = this.player; return { kills: this.kills, shots: p.shots, hits: p.hits, hs: p.headshots, score: this.score }; }
  nextWave() {
    this.wave++; this.waveKills = 0; this.spawned = 0; this.spawnT = 1.5;
    const coop = this.mp && this.mp.active && this.mp.mode === 'coop';
    this.waveTotal = coop ? this.mp.coopWaveSize(this.wave) : 3 + this.wave * 2;
    this.maxAlive = Math.min(coop ? 12 : 9, 3 + this.wave + (coop ? this.mp.players.size - 1 : 0));
    if (this.wave > 1) { this.player.addAmmo(2); this.player.health = Math.min(100, this.player.health + 40); }
    this.hud.banner('WAVE ' + this.wave, `${this.waveTotal} HOSTILES INBOUND`, 3);
    this.waveStart = this.waveStats();
    if (coop) this.mp.onWaveStart();
  }
  pause() {
    if (this.state !== 'playing' || this.mpPaused) return;
    this.input.keys = {}; this.input.fire = this.input.aim = false; if (document.pointerLockElement) document.exitPointerLock();
    if (this.mp.active) { this.mpPaused = true; $('pauseinfo').textContent = 'MATCH IS STILL RUNNING · ROOM ' + this.mp.code; this.showScreen('pause'); return; }
    this.state = 'paused'; $('pauseinfo').textContent = `WAVE ${this.wave} · ${this.kills} KILLS · SCORE ${this.score}`; $('quitlbl').textContent = 'QUIT TO MENU'; this.showScreen('pause');
  }
  resume() {
    if (this.mpPaused) { this.mpPaused = false; this.showScreen(null); this.hadLock = false; if (!this.testMode) this.lock(); if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); } return; }
    if (this.state !== 'paused') return; this.state = 'playing'; this.showScreen(null); this.hadLock = false; if (!this.testMode) this.lock(); if (MOBILE) { this.touch.reset(); if (!this.testMode) goFullscreenLandscape(); }
  }
  toMenu(keepRoom) {
    if (!keepRoom && this.mp.role && !this.mp.leaving) { this.mp.leave(); return; }
    this.state = 'menu'; this.mpPaused = false; for (const e of this.enemies) e.c.dispose(this.scene); this.enemies = []; this.pickups.clear();
    this.setPlayerTint(null); this.player.reset(this.world.playerSpawn); this.hud.weaponChanged(); this.menuPose();
    $('btnRestart').textContent = 'PLAY AGAIN'; $('btnMenu').textContent = 'MAIN MENU'; $('sumTable').innerHTML = '';
    if (!keepRoom) this.showScreen('menu'); if (document.pointerLockElement) document.exitPointerLock();
  }
  alert(pos, r) { for (const e of this.enemies) if (!e.dead && e.pos.distanceTo(pos) < r) e.alert(); }
  spawnEnemy() {
    const p = this.player.pos;
    const cands = this.world.enemySpawns.filter(s => s.distanceTo(p) > 20 && !this.enemies.some(e => !e.dead && e.pos.distanceTo(s) < 1.5));
    const list = cands.length ? cands : this.world.enemySpawns;
    const sp = list[(Math.random() * list.length) | 0].clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
    const c = this.factory.create({ tint: TINTS[(Math.random() * TINTS.length) | 0] }); this.scene.add(c.root);
    const e = new Enemy(this, c, sp, this.wave); e.nid = this.nextNid = (this.nextNid || 0) + 1; this.enemies.push(e); this.spawned++;
  }
  onEnemyKilled(e, head) {
    this.waveKills++;
    if (this.mp.active) { this.mp.onEnemyKilled(e, head); return; } // co-op host: credit whoever fired
    this.kills++; this.score += 100 + (head ? 50 : 0) + this.wave * 10;
    this.hud.kill(head, 100 + (head ? 50 : 0) + this.wave * 10, this.player.weapon);
    if (Math.random() < (this.forceDrop ? 1 : 0.7)) this.pickups.spawn(e.pos.clone());
  }
  onPlayerDeath() {
    this.hud.resetStreak();
    if (this.mp.active) { this.mp.onLocalDeath(); return; }
    this.gameOverT = 3.2;
  }
  gameOver() {
    this.state = 'gameover'; this.input.fire = this.input.aim = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.player; const acc = p.shots ? Math.round(p.hits / p.shots * 100) : 0, secs = Math.round(this.time - (this.startT || 0));
    $('sumTitle').textContent = 'K.I.A.'; $('sumTitle').className = 'red'; $('sumSub').textContent = `WAVE ${this.wave} REACHED · ${(secs / 60) | 0}:${String(secs % 60).padStart(2, '0')} SURVIVED`;
    this.summaryCards([['WAVE', this.wave, true], ['KILLS', this.kills], ['HEADSHOTS', p.headshots], ['ACCURACY', acc + '%'], ['BEST STREAK', this.hud.bestStreak], ['SCORE', this.score, true]]);
    $('sumTable').innerHTML = ''; $('btnRestart').textContent = 'PLAY AGAIN'; $('btnMenu').textContent = 'MAIN MENU';
    this.showScreen('gameover');
  }
  updateGame(dt) {
    this.time += dt;
    const inp = this.mpPaused || (this.mp.active && this.mp.chatOpen) ? { keys: {}, fire: false, aim: false } : this.input;
    this.player.update(dt, inp);
    const mpClient = this.mp.active && !this.mp.isHost;
    if (!mpClient) for (const e of this.enemies) e.update(dt);
    this.pickups.update(dt);
    if (this.mp.active) this.mp.update(dt);
    if (mpClient || (this.mp.active && this.mp.mode !== 'coop')) return;
    // cleanup corpses
    for (const e of this.enemies) if (e.dead && e.deadT > 12) { e.c.dispose(this.scene); e.removed = true; }
    this.enemies = this.enemies.filter(e => !e.removed);
    // waves
    if (this.mp.active ? this.mp.anyAlive() : !this.player.dead) {
      const alive = this.enemies.filter(e => !e.dead).length;
      if (this.spawned < this.waveTotal) { this.spawnT -= dt; if (this.spawnT <= 0 && alive < this.maxAlive) { this.spawnEnemy(); this.spawnT = 1.6; } }
      else if (alive === 0) {
        if (this.intermission <= 0) {
          this.intermission = 6; this.hud.banner('WAVE CLEARED', 'RESUPPLY: +AMMO +HEALTH', 3); this.mp.banner('WAVE CLEARED', 'RESUPPLY: +AMMO +HEALTH');
          const a = this.waveStart || {}, b = this.waveStats(), sh = b.shots - (a.shots || 0);
          this.hud.waveCard({ wave: this.wave, kills: b.kills - (a.kills || 0), hs: b.hs - (a.hs || 0), acc: sh ? Math.round((b.hits - (a.hits || 0)) / sh * 100) : 0, score: b.score - (a.score || 0) });
        }
        this.intermission -= dt; if (this.intermission <= 0) { this.intermission = 0; this.nextWave(); }
      }
    }
    if (this.gameOverT > 0) { this.gameOverT -= dt; if (this.gameOverT <= 0) this.gameOver(); }
  }
  updateCamera(dt) {
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
    if (this.shake > 0) { cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.004; cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.004; this.shake = Math.max(0, this.shake - dt * 6); }
    const W = p.weapon, scoped = !!W.scope && !p.switching && p.reloading <= 0;
    const fov = scoped && this.aimT > 0.85 ? W.scopeFov : this.settings.fov - W.zoom * this.aimT + (p.sprint ? 6 : 0);
    if (scoped && this.aimT > 0.85) cam.fov = fov; // snap into the scope
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix();
    // hide the player model if the camera is inside it
    p.c.root.visible = (this.camBack > 0.45 || p.dead) && !(scoped && this.aimT > 0.85);
  }
  // test helpers (headless verification)
  sim(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) { if (this.state === 'playing' || this.state === 'gameover') this.updateGame(dt); this.updateCamera(dt); this.fx.update(dt); if (this.state === 'playing') this.hud.update(dt); } }
  renderOnce() { this.updateCamera(0.016); this.sfx.listener(this.camera); if (this.state === 'playing' || this.state === 'paused') this.hud.update(0.001); this.composer.render(0.016); }
  frame() {
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
    if (render && !this.ui.renderPreview(dt)) this.composer.render(dt);
    // fps
    this.fpsAcc.push(dt); if (this.fpsAcc.length > 30) this.fpsAcc.shift();
    if (this.settings.fps) { const f = 1 / (this.fpsAcc.reduce((a, b) => a + b, 0) / this.fpsAcc.length); const s = this.renderer.getDrawingBufferSize(new THREE.Vector2()); $('fps').textContent = `${f.toFixed(0)} fps  ${s.x}x${s.y}  ${this.settings.quality}`; }
    else $('fps').textContent = '';
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

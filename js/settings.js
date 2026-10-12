// v1.6 Settings screen: a copy of the reference sheets (GRAPHICS / CONTROLS / AUDIO / GAMEPLAY). Every control is bound
// to a key in game.settings (localStorage 'swat-settings') and applied live through Game.applySetting().
import { cleanName } from './ui.js';
import { TouchControls } from './touch.js';

export const SET_DEFAULTS = {
  // graphics
  gPreset: 'custom', fpsCap: 'max', renderScale: 1, dynRes: false, fov: 90, fpFov: 72, adsFov: 0.85, motionBlur: false,
  texQ: 'high', shadowQ: 'medium', aa: 'taa', fxQ: 'high', bloom: true, ao: false, hdr: true, rt: false, fps: true,
  // controls
  sensX: 1.2, sensY: 1.0, adsSens: 1.0, scopeSens: 0.85, sniperSens: 0.75, freeSens: 1.1, curveMode: 'dynamic', curve: 'standard',
  aimAcc: true, aimAccMul: 1.0, layoutPreset: 'A', layouts: {}, btnOp: 0.85, ctlScale: 1, hand: 'right',
  invert: false, invertX: false, gyroInv: false, joyDead: 0.18, vibInt: 0.75, vibFire: true, vibHit: true, vibReload: true, gyro: true, gyroSens: 1.0,
  // audio
  vol: 0.8, fxVol: 1, foot3d: false, uiVol: 0.6, musicVol: 0.5, dlgVol: 0.8, ambVol: 0.4, aPreset: 'foot', dynRange: null, hrtf: true, aQ: 'high', occl: true,
  voip: true, voiceVol: 0.85, micVol: 0.75, micMode: 'ptt', micThr: 0.35, muteDeath: true, subs: false,
  // gameplay
  streamer: false, netStats: 'fpsping', xp: true, killfeed: 'all', mmRot: true, dmgNum: 'float', dmgSize: 0.75, hmVis: true, hmSnd: 'std',
  cblind: 'off', shakeAmt: 0.5, xhair: '#ffffff', xDot: true, xSpread: true, xScale: 1, xOp: 0.85, hmColor: 'red',
  allWeapons: true, autoReload: true, autoSwitch: true, autoSprint: 'auto', ledge: false,
};
// graphics presets fill in the ADVANCED QUALITY DETAILS
export const GFX_PRESETS = {
  low: { texQ: 'low', shadowQ: 'low', aa: 'off', fxQ: 'low', bloom: false, ao: false, hdr: true, rt: false, motionBlur: false },
  med: { texQ: 'medium', shadowQ: 'medium', aa: 'fxaa', fxQ: 'medium', bloom: true, ao: false, hdr: true, rt: false, motionBlur: false },
  high: { texQ: 'high', shadowQ: 'high', aa: 'taa', fxQ: 'high', bloom: true, ao: true, hdr: true, rt: false, motionBlur: false },
  ultra: { texQ: 'ultra', shadowQ: 'realtime', aa: 'msaa4', fxQ: 'cinematic', bloom: true, ao: true, hdr: true, rt: true, motionBlur: false },
};
export const XHAIR_COLORS = [['#ffffff', 'WHITE'], ['#4dff7a', 'GREEN'], ['#ffe14d', 'YELLOW'], ['#ff4d6a', 'RED'], ['#4dd8ff', 'CYAN']];
// layout B: a second built-in arrangement (bigger SHOOT, scope next to it, crouch/reload swapped low)
export const LAYOUT_B = { tFire: { x: 0.83, y: 0.64, s: 1.12 }, tAim: { x: 0.94, y: 0.40 }, tReload: { x: 0.70, y: 0.86 }, tCrouch: { x: 0.95, y: 0.86 }, tSprint: { x: 0.30, y: 0.45 }, tMed: { x: 0.06, y: 0.40 } };
// settings migrated from v1.5 (old keys)
export function migrateSettings(s, saved) {
  if (saved && saved.sens !== undefined && saved.sensX === undefined) { s.sensX = +(saved.sens * 1.2).toFixed(2); s.sensY = saved.sens; }
  if (typeof s.dmgNum === 'boolean') s.dmgNum = s.dmgNum ? 'float' : 'off';
  if (saved && saved.haptics === false && saved.vibInt === undefined) s.vibInt = 0;
  if (!s.layouts || typeof s.layouts !== 'object') s.layouts = {};
}

const $ = (id) => document.getElementById(id);
const pct = (v) => Math.round(v * 100) + '%';
const F2 = (v) => (+v).toFixed(2);
const FMT = { renderScale: (v) => v >= 0.999 ? 'NATIVE (100%)' : pct(v), fov: (v) => Math.round(v) + '°', fpFov: (v) => Math.round(v) + '°', adsFov: F2,
  sensX: F2, sensY: F2, adsSens: F2, scopeSens: F2, sniperSens: F2, freeSens: F2, aimAccMul: F2, gyroSens: F2 };
const fmt = (k, v) => (FMT[k] || pct)(v);
const PEN = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 13l1-3 7-7 2 2-7 7-3 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const CHK = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
const CLOUD = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 18H7a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1 1 9zm-7-8l-4 4h3v3h2v-3h3z"/></svg>';
const ED = '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4M13 20h7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const CURVES = { standard: 'M4 28 C 10 12, 20 6, 36 4', linear: 'M4 28 L36 4', custom: 'M4 28 C 16 26, 20 18, 26 12 M26 12 L36 4 M30 4 L36 4 L35 10' };

// ---------- tiny markup helpers ----------
const seg = (k, opts, cls = '') => `<div class="sg ${cls}" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
const sl = (k, min, max, step) => `<input type="range" class="sl" data-k="${k}" min="${min}" max="${max}" step="${step}">`;
const val = (k) => `<b class="vl" data-vl="${k}"></b>`;
const tg = (k, mode = '', txt = ['ON', 'OFF']) => `<button class="tg ${mode}" data-k="${k}" data-on="${txt[0]}" data-off="${txt[1]}"><span class="tt"></span><i></i></button>`;
const ck = (k) => `<button class="ck" data-k="${k}">${CHK}</button>`;
const sel = (k, opts) => `<select class="dd" data-k="${k}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;

function graphicsTab() {
  return `<div class="g2">
  <section class="pn"><h3>DISPLAY &amp; PERFORMANCE</h3>
    <div class="blk"><h5>GRAPHICS PRESETS</h5>${seg('gPreset', [['low', 'LOW'], ['med', 'MED'], ['high', 'HIGH'], ['ultra', 'ULTRA'], ['custom', 'CUSTOM']])}
      <h5>FRAME RATE LIMIT</h5>${seg('fpsCap', [['30', '30 FPS'], ['60', '60 FPS'], ['90', '90 FPS'], ['120', '120 FPS'], ['max', 'MAX']])}</div>
    <div class="blk rr"><h5 class="mid">RENDER RESOLUTION</h5><div class="rcol">${val('renderScale')}${sl('renderScale', 0.5, 1, 0.05)}</div>
      <div class="sub"><span>DYNAMIC RESOLUTION</span>${tg('dynRes')}</div></div>
    <div class="blk"><div class="fovrow"><h5>FIELD OF VIEW (FOV)</h5>${sl('fov', 60, 110, 1)}${val('fov')}</div>
      <div class="two"><div><div class="lv"><span>1ST PERSON FOV</span>${val('fpFov')}</div>${sl('fpFov', 55, 90, 1)}</div>
      <div><div class="lv"><span>ADS FOV SCALE (AFFECTS ZOOM)</span></div>${sl('adsFov', 0.5, 1.5, 0.05)}</div></div></div>
    <div class="blk row"><h5>CAMERA MOTION BLUR</h5>${tg('motionBlur', 'txt')}</div>
  </section>
  <section class="pn"><h3>ADVANCED QUALITY DETAILS</h3>
    <div class="aq"><h5>TEXTURE QUALITY</h5>${seg('texQ', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']])}</div>
    <div class="aq"><h5>SHADOW QUALITY</h5>${seg('shadowQ', [['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['realtime', 'REAL-TIME']])}</div>
    <div class="aq"><h5>ANTI-ALIASING (AA)</h5>${seg('aa', [['off', 'OFF'], ['fxaa', 'FXAA'], ['taa', 'TAA'], ['msaa2', 'MSAA 2X'], ['msaa4', 'MSAA 4X']])}</div>
    <div class="aq"><h5>PARTICLE &amp; EFFECTS QUALITY</h5>${seg('fxQ', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['cinematic', 'CINEMATIC']], 'w4')}</div>
    <div class="aq pp"><h5>POST-PROCESSING EFFECTS</h5><div class="ppg">
      <div><span>BLOOM &amp; flare</span>${tg('bloom', 'ico')}</div><div><span>AMBIENT OCCLUSION</span>${tg('ao')}</div>
      <div><span>HDR (HIGH DYNAMIC RANGE)</span>${tg('hdr', 'ico')}</div><div><span>RAY TRACING / REFLECTIONS</span>${tg('rt', 'txt')}</div></div></div>
  </section></div>
  <div class="sfoot"><span id="sRend">Rendering at — px (Native Scaling)</span><div class="vram"><div><b>VRAM / SYSTEM IMPACT</b><em id="sVram">— GB / 4.0 GB</em></div><i><b id="sVramBar"></b></i></div>
    <label class="fck"><span>SHOW FPS &amp; SYSTEM STATS</span>${ck('fps')}</label></div>`;
}
function controlsTab() {
  const srow = (lab, k, cap, min, max, step) => `<div class="sr"><span>${lab}</span><div class="sw"><small>${cap}</small>${sl(k, min, max, step)}</div>${val(k)}</div>`;
  return `<div class="g3">
  <section class="pn wh"><h3>SENSITIVITY &amp; RESPONSE</h3>
    <h4>GENERAL CAMERA</h4>${srow('Horizontal', 'sensX', 'Horizontal', 0.2, 3, 0.05)}${srow('Vertical', 'sensY', 'Vertical', 0.2, 3, 0.05)}
    <h4>AIM (ADS) SENSITIVITY</h4>${srow('Standard ADS', 'adsSens', 'Independent Zoom Multiplier', 0.2, 2, 0.05)}${srow('High Zoom / Scope', 'scopeSens', 'High Zoom / Scope', 0.2, 2, 0.05)}
    ${srow('Sniper', 'sniperSens', 'Zoom Multiplier', 0.2, 2, 0.05)}${srow('Free Look', 'freeSens', 'Zoom Multiplier', 0.2, 2, 0.05)}
    <h4>RESPONSE CURVES</h4><div class="curves">${sel('curveMode', [['dynamic', 'Dynamic'], ['static', 'Static']])}
      <div class="sg tiles" data-k="curve">${['standard', 'linear', 'custom'].map(c => `<button data-v="${c}"><svg viewBox="0 0 40 32"><path d="${CURVES[c]}" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>${c[0].toUpperCase() + c.slice(1)}</span></button>`).join('')}</div></div>
    <h4 class="hrow">AIM ACCELERATION SPEED ${tg('aimAcc', 'txt sm', ['On', 'Off'])}</h4>${srow('Multiplier', 'aimAccMul', '', 0, 2, 0.05)}
  </section>
  <section class="pn wh"><h3>LAYOUT &amp; HUD DESIGN</h3>
    <h4>CURRENT LAYOUT <small>Presets</small></h4>
    <div class="sg lays" data-k="layoutPreset"><button data-v="A">Layout A</button><button data-v="B">Layout B</button><button data-v="c1">Custom Claw 1 ${CLOUD}</button><button data-v="c2">Custom Claw 2 ${CLOUD}</button></div>
    <button id="btnLayout" class="gold">CUSTOMIZE HUD LAYOUT</button>
    <canvas id="layPrev" width="600" height="250"></canvas>
    <h4>GLOBAL BUTTON OPACITY</h4><div class="sr"><span>Opacity</span><div class="sw">${sl('btnOp', 0.25, 1, 0.05)}</div>${val('btnOp')}</div>
    <h4>GLOBAL BUTTON SIZE</h4><div class="sr"><span>Sensitivity</span><div class="sw">${sl('ctlScale', 0.6, 1.05, 0.01)}</div>${val('ctlScale')}</div>
    <h4>CONTROL LAYOUT</h4>${sel('hand', [['right', 'Right-handed (fire on right)'], ['left', 'Left-handed (fire on left)']])}
  </section>
  <section class="pn wh"><h3>INPUT BEHAVIORS &amp; FEEDBACK</h3>
    <h4>INVERT LOOK</h4><div class="tr"><span>Invert Y-Axis</span>${tg('invert', 'wk')}</div><div class="tr"><span>Invert X-Axis</span>${tg('invertX', 'wk')}</div><div class="tr"><span>Gyro Inversion</span>${tg('gyroInv', 'wk')}</div>
    <h4>TOUCH BUTTONS CALIBRATION</h4><div class="calib"><div class="cl"><span id="calInv">Invert Options</span><span id="calDz">Deadzone Options</span><span id="calVis">Deadzone Visual</span></div><canvas id="calGrid" width="160" height="104"></canvas></div>
    <h4>VIBRATION &amp; HAPTICS</h4><div class="sr"><span>Intensity</span><div class="sw">${sl('vibInt', 0, 1, 0.05)}</div>${val('vibInt')}</div>
    <label class="cr">${ck('vibFire')}<span>Firing Feedback</span></label><label class="cr">${ck('vibHit')}<span>Damage/Hit Indicators</span></label><label class="cr">${ck('vibReload')}<span>Reload Vibrations</span></label>
    <h4 class="hrow">GYROSCOPE INPUT ${tg('gyro', 'txt sm', ['On', 'Off'])}</h4><div class="sr"><span>Sensitivity</span><div class="sw">${sl('gyroSens', 0.1, 3, 0.05)}</div>${val('gyroSens')}</div>
  </section></div>`;
}
function audioTab() {
  const vrow = (lab, k, extra = '') => `<div class="vr"><div class="vh"><span>${lab}</span>${extra}</div><div class="vs">${sl(k, 0, 1, 0.05)}${val(k)}</div></div>`;
  return `<div class="g3 lines">
  <section><h3>GENERAL VOLUME</h3>${vrow('MASTER VOLUME', 'vol')}${vrow('SFX (EFFECTS) VOLUME', 'fxVol', `<label class="mini"><span>3D Footsteps Focus</span>${tg('foot3d', 'xs')}</label>`)}
    ${vrow('INTERFACE (UI) VOLUME', 'uiVol')}${vrow('MUSIC VOLUME', 'musicVol')}${vrow('DIALOGUE &amp; ANNOUNCERS', 'dlgVol')}${vrow('AMBIENT (ENVIRONMENT)', 'ambVol')}</section>
  <section><h3>ADVANCED AUDIO</h3><h5>AUDIO PRESET</h5>${seg('aPreset', [['cinematic', 'CINEMATIC'], ['studio', 'STUDIO'], ['night', 'NIGHT MODE'], ['foot', 'BOOST FOOTSTEPS']], 'g22')}
    <h5>DYNAMIC RANGE</h5>${seg('dynRange', [['full', 'FULL'], ['medium', 'MEDIUM'], ['low', 'LOW (NIGHT)']])}
    <div class="tr"><h5>3D SPATIAL AUDIO (HRTF)</h5>${tg('hrtf', 'txt')}</div><small class="note">Enhances directional positioning for headphones</small>
    <h5>AUDIO QUALITY</h5>${seg('aQ', [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']])}
    <div class="tr"><h5>SOUND OCCLUSION &amp; REVERB</h5>${tg('occl', 'txt')}</div></section>
  <section><h3>VOICE CHAT &amp; COMMS</h3><div class="tr"><h5>VOICE CHAT (VOIP)</h5>${tg('voip', 'txt')}</div>
    <h5>VOICE CHAT VOLUME</h5><div class="vs">${sl('voiceVol', 0, 1, 0.05)}${val('voiceVol')}</div>
    <h5>MICROPHONE VOLUME</h5><div class="vs">${sl('micVol', 0, 1, 0.05)}${val('micVol')}</div>
    <h5>MIC ACTIVATION</h5>${seg('micMode', [['open', 'OPEN MIC'], ['ptt', 'PUSH-TO-TALK'], ['muted', 'MUTED']])}
    <h5>MIC INPUT THRESHOLD</h5><div class="vs mic">${sl('micThr', 0, 1, 0.05)}${val('micThr')}<i id="micLvl"></i></div>
    <div class="tr"><h5>MUTE ON DEATH</h5>${tg('muteDeath', 'txt')}</div><small class="note" id="voiceStat"></small></section></div>
  <div class="sfoot"><span id="sDriver">AUDIO DRIVER: NATIVE SYSTEM</span><label class="fck"><span>SUBTITLES</span>${tg('subs')}</label></div>`;
}
function gameplayTab() {
  return `<div class="g3">
  <section><h3>IDENTITY &amp; INTERFACE</h3><div class="tr"><h5>OPERATOR NAME</h5><label class="nm"><input id="optName" maxlength="14" autocomplete="off" spellcheck="false">${ED}</label></div>
    <div class="tr"><h5>STREAMER MODE</h5>${tg('streamer')}</div>
    <h5>NETWORK STATISTICS</h5>${seg('netStats', [['off', 'OFF'], ['fpsping', 'FPS &amp; PING'], ['all', 'SHOW ALL']])}
    <div class="tr"><h5>SCORE (+XP) POPUPS</h5>${tg('xp', 'txt chk')}</div>
    <h5>KILL FEED</h5>${seg('killfeed', [['off', 'OFF'], ['compact', 'COMPACT'], ['all', 'ALL']])}
    <div class="tr"><h5>MINI-MAP ROTATION</h5>${tg('mmRot', 'txt')}</div></section>
  <section><h3>COMBAT HUD &amp; DAMAGE NUMBERS</h3><h5>DAMAGE NUMBERS</h5>${seg('dmgNum', [['off', 'OFF'], ['float', 'FLOATING'], ['stack', 'STACKING']])}
    <h5>DAMAGE NUMBERS SIZE</h5><div class="vs">${sl('dmgSize', 0.1, 1, 0.05)}${val('dmgSize')}</div>
    <div class="tr"><h5>HITMARKER VISUALS</h5>${tg('hmVis', 'txt')}</div>
    <h5>HITMARKER SOUND</h5>${seg('hmSnd', [['off', 'OFF'], ['std', 'STANDARD'], ['dyn', 'DYNAMIC']])}
    <div class="tr"><h5>COLORBLIND FILTER</h5>${sel('cblind', [['off', 'OFF'], ['protan', 'PROTANOPIA'], ['deutan', 'DEUTERANOPIA'], ['tritan', 'TRITANOPIA']])}</div>
    <h5>SCREEN SHAKE</h5><div class="vs">${sl('shakeAmt', 0, 1, 0.05)}${val('shakeAmt')}</div></section>
  <section><h3>CROSSHAIR CUSTOMIZATION</h3><div class="tr"><h5>CROSSHAIR COLOR</h5><button class="xcol" id="xCol"><span></span><i></i><i></i><i></i></button></div>
    <div class="tr"><h5>CENTER DOT</h5>${tg('xDot', 'txt')}</div>
    <div class="tr"><h5>DYNAMIC SPREAD</h5>${tg('xSpread', 'txt')}</div><small class="note up">Expands with movement</small>
    <h5>CROSSHAIR SCALE</h5><div class="vs">${sl('xScale', 0.5, 1, 0.05)}${val('xScale')}</div>
    <h5>CROSSHAIR OPACITY</h5><div class="vs">${sl('xOp', 0.2, 1, 0.05)}${val('xOp')}</div>
    <div class="tr"><h5>HITMARKER COLOR</h5><div class="hmc" data-k="hmColor"><button data-v="red"></button><button data-v="yellow"></button></div></div></section>
  </div>
  <div class="g3 low">
  <section><h3>MOVEMENT &amp; GAMEPLAY BEHAVIOR</h3><div class="tr"><h5>SOLO: CARRY ALL UNLOCKED</h5>${tg('allWeapons', 'txt chk')}</div><div class="tr"><h5>WEAPON AUTO-RELOAD</h5>${tg('autoReload', 'txt')}</div></section>
  <section class="pad"><div class="tr"><h5>WEAPON AUTO-RELOAD</h5>${tg('autoReload', 'txt')}</div><div class="tr"><h5>WEAPON AUTO-SWITCH</h5>${tg('autoSwitch', 'txt')}</div></section>
  <section class="pad"><h5>AUTO-SPRINT / CLIMB</h5>${seg('autoSprint', [['off', 'OFF'], ['tap', 'TAP'], ['auto', 'AUTO']])}<div class="tr"><span class="lg">Ledge Grab Behavior</span>${tg('ledge')}</div></section></div>`;
}

export class SettingsUI {
  constructor(g) {
    this.g = g; const root = $('settings');
    root.className = 'screen hidden full s16';
    root.innerHTML = `<div class="stage"><div class="shd"><button class="back" data-back>‹</button><h1>SETTINGS</h1>
      <div class="tabs" id="setTabs"><button data-tab="gfx" class="on">GRAPHICS</button><button data-tab="ctl">CONTROLS</button><button data-tab="aud">AUDIO</button><button data-tab="gp">GAMEPLAY</button></div></div>
      <div class="sbody"><div class="tab t-gfx" data-tab="gfx">${graphicsTab()}</div><div class="tab t-ctl hidden" data-tab="ctl">${controlsTab()}</div>
      <div class="tab t-aud hidden" data-tab="aud">${audioTab()}</div><div class="tab t-gp hidden" data-tab="gp">${gameplayTab()}</div></div></div>`;
    this.root = root; this.stage = root.querySelector('.stage');
    this.bind(); this.refresh(); this.fit();
    addEventListener('resize', () => this.fit()); if (window.visualViewport) visualViewport.addEventListener('resize', () => this.fit());
  }
  // the sheet is laid out on a 1024 x 455 design stage (the reference screenshots) and scaled to the screen
  fit() {
    const W = innerWidth, H = innerHeight, k = Math.min(W / 1024, H / 455, 1.7);
    this.k = k; const st = this.stage.style; st.transform = `scale(${k})`; st.width = (W / k) + 'px'; st.height = (H / k) + 'px';
    this.drawPreview();
  }
  get s() { return this.g.settings; }
  set(k, v, from) {
    const s = this.s; if (s[k] === v) return; s[k] = v;
    if (k === 'gPreset' && GFX_PRESETS[v]) Object.assign(s, GFX_PRESETS[v]);
    if (k in GFX_PRESETS.low) { const m = Object.entries(GFX_PRESETS).find(([, p]) => Object.keys(p).every(q => p[q] === s[q])); s.gPreset = m ? m[0] : 'custom'; }
    if (k === 'layoutPreset') this.loadLayout(v);
    this.g.saveSettings(); this.g.applySetting(k); this.refresh(from);
  }
  loadLayout(v) {
    const s = this.s, L = s.layouts || (s.layouts = {});
    if (v === 'A') { s.ctl = {}; s.ctlScale = 1; } else if (v === 'B') { s.ctl = JSON.parse(JSON.stringify(LAYOUT_B)); s.ctlScale = 1; }
    else { const c = L[v] || {}; s.ctl = JSON.parse(JSON.stringify(c.ctl || {})); s.ctlScale = c.ctlScale || 1; }
  }
  // the controls editor saved a layout: A / B stay as presets, so the edit is stored in Custom Claw 1 (or the custom slot in use)
  onLayoutSaved() {
    const s = this.s, slot = s.layoutPreset === 'c2' ? 'c2' : 'c1';
    (s.layouts = s.layouts || {})[slot] = { ctl: JSON.parse(JSON.stringify(s.ctl || {})), ctlScale: s.ctlScale || 1 };
    s.layoutPreset = slot; this.g.saveSettings(); this.refresh();
  }
  bind() {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !r.contains(b)) return;
      const sg = b.closest('[data-k]');
      if (b.classList.contains('tg') || b.classList.contains('ck')) { this.set(b.dataset.k, !this.s[b.dataset.k]); return; }
      if (sg && b.dataset.v !== undefined && sg !== b) { this.set(sg.dataset.k, b.dataset.v); return; }
    });
    r.addEventListener('input', (e) => { const t = e.target; if (t.classList.contains('sl')) this.set(t.dataset.k, parseFloat(t.value), t); });
    r.addEventListener('change', (e) => { const t = e.target; if (t.classList.contains('dd')) this.set(t.dataset.k, t.value); });
    const tabs = [...$('setTabs').children];
    tabs.forEach(b => b.addEventListener('click', () => this.tab(b.dataset.tab)));
    $('xCol').onclick = () => { const i = XHAIR_COLORS.findIndex(c => c[0] === this.s.xhair); this.set('xhair', XHAIR_COLORS[(i + 1) % XHAIR_COLORS.length][0]); };
    const nm = $('optName');
    nm.addEventListener('change', () => { const s = this.s; s.name = cleanName(nm.value) || s.name || 'Operator'; nm.value = s.name; this.g.saveSettings(); this.g.applySetting('name'); });
    $('calDz').onclick = () => { const o = [0.1, 0.18, 0.26, 0.34], i = o.indexOf(this.s.joyDead); this.set('joyDead', o[(i + 1) % o.length]); };
    $('calInv').onclick = () => this.set('invertX', !this.s.invertX);
    $('calVis').onclick = () => { this.showDz = !this.showDz; this.drawCalib(); };
    $('calGrid').addEventListener('pointerdown', (e) => { const R = e.target.getBoundingClientRect(), dx = (e.clientX - R.left) / R.width - 0.5, dy = (e.clientY - R.top) / R.height - 0.5; this.set('joyDead', Math.round(Math.min(0.4, Math.max(0.05, Math.hypot(dx, dy) * 1.4)) * 100) / 100); });
  }
  tab(id) {
    [...$('setTabs').children].forEach(t => t.classList.toggle('on', t.dataset.tab === id));
    this.root.querySelectorAll('.sbody .tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== id));
    this.cur = id; this.refresh(); if (id === 'ctl') this.drawPreview();
  }
  refresh(from) {
    const s = this.s, r = this.root;
    r.querySelectorAll('.sg[data-k], .hmc[data-k]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(s[g.dataset.k]) === b.dataset.v)));
    r.querySelectorAll('.tg, .ck').forEach(b => { const on = !!s[b.dataset.k]; b.classList.toggle('on', on); const t = b.querySelector('.tt'); if (t) t.innerHTML = b.classList.contains('ico') ? (on ? PEN : '') : b.classList.contains('chk') ? (on ? `${b.dataset.on} ${CHK}` : b.dataset.off) : b.classList.contains('txt') ? (on ? b.dataset.on : b.dataset.off) : ''; });
    r.querySelectorAll('input.sl').forEach(i => { const k = i.dataset.k; if (i !== from) i.value = s[k]; const p = (i.value - i.min) / (i.max - i.min) * 100; i.style.setProperty('--p', p.toFixed(1) + '%'); });
    r.querySelectorAll('[data-vl]').forEach(v => { v.textContent = fmt(v.dataset.vl, s[v.dataset.vl]); });
    r.querySelectorAll('select.dd').forEach(d => { if (d.value !== String(s[d.dataset.k])) d.value = s[d.dataset.k]; });
    const nm = $('optName'); if (document.activeElement !== nm) nm.value = s.name;
    const xc = XHAIR_COLORS.find(c => c[0] === s.xhair) || XHAIR_COLORS[0], xi = XHAIR_COLORS.indexOf(xc);
    $('xCol').querySelector('span').textContent = `[${xc[1]}]`; $('xCol').querySelectorAll('i').forEach((d, i) => { d.classList.toggle('on', i === Math.min(2, xi)); d.style.background = i === Math.min(2, xi) ? xc[0] : ''; });
    $('calDz').textContent = `Deadzone Options · ${Math.round(s.joyDead * 100)}%`;
    this.stats(); this.drawPreview(); this.drawCalib();
  }
  // footer: render size + a VRAM estimate (render targets, shadow map, textures by quality)
  stats() {
    const g = this.g, r = g.renderer; if (!r || !$('sRend')) return;
    const w = Math.round(innerWidth * r.getPixelRatio()), h = Math.round(innerHeight * r.getPixelRatio()), s = this.s;
    $('sRend').textContent = `Rendering at ${w} x ${h} px (${s.dynRes ? 'Dynamic Scaling' : s.renderScale >= 0.999 ? 'Native Scaling' : Math.round(s.renderScale * 100) + '% Scaling'})`;
    const px = w * h, rts = (2 + (s.bloom ? 1.2 : 0) + (s.ao ? 2 : 0) + (s.motionBlur ? 2 : 0) + (s.aa === 'taa' ? 2 : s.aa === 'fxaa' ? 0.5 : 0)) * px * 8 * (s.aa.startsWith('msaa') ? (s.aa === 'msaa4' ? 2.5 : 1.7) : 1);
    const sh = { off: 0, low: 1024, medium: 2048, high: 4096, realtime: 4096 }[s.shadowQ] ** 2 * 4;
    const tex = { low: 0.55, medium: 0.9, high: 1.4, ultra: 1.9 }[s.texQ] * 1e9 * (g.mobile ? 0.45 : 1);
    const gb = (rts + sh + tex + 0.35e9) / 1e9, cap = Math.max(2, navigator.deviceMemory || 4);
    $('sVram').textContent = `${gb.toFixed(1)} GB / ${cap.toFixed(1)} GB`; $('sVramBar').style.width = Math.min(100, gb / cap * 100).toFixed(0) + '%';
    const v = g.voice; if ($('voiceStat')) $('voiceStat').textContent = v ? v.statusText() : '';
    if ($('sDriver') && g.sfx.ctx) $('sDriver').textContent = `AUDIO DRIVER: NATIVE SYSTEM · ${(g.sfx.ctx.sampleRate / 1000).toFixed(1)} kHz`;
  }
  // HUD layout preview: the map thumbnail with the control cut-outs at their current positions
  drawPreview() {
    const c = $('layPrev'); if (!c || this.cur !== 'ctl') return; const x = c.getContext('2d'), W = c.width, H = c.height, s = this.s;
    if (!this.bg) { this.bg = new Image(); this.bg.onload = () => this.drawPreview(); this.bg.src = 'assets/ui/maps/desert.jpg'; this.icons = {}; }
    x.fillStyle = '#222'; x.fillRect(0, 0, W, H); if (this.bg.complete && this.bg.naturalWidth) { x.globalAlpha = 0.85; x.drawImage(this.bg, 0, 0, W, H); x.globalAlpha = 1; }
    const D = TouchControls.DEFAULTS, IMG = { joybase: 'joystick', tSprint: 'run', tMed: 'medkit', tFire: 'shoot', tCrouch: 'crouch', tReload: 'reload', tAim: 'scope', tPause: 'settings' };
    const left = s.hand === 'left', S = H * 0.95;
    for (const [id, file] of Object.entries(IMG)) {
      const d = D[id]; if (!d) continue; const u = (s.ctl || {})[id] || {}; let fx = u.x ?? d.x; const fy = u.y ?? d.y, sc = (u.s || 1) * (s.ctlScale || 1);
      if (left && id !== 'tPause') fx = 1 - fx;
      let im = this.icons[file]; if (!im) { im = this.icons[file] = new Image(); im.onload = () => this.drawPreview(); im.src = `assets/ui/controls/${file}.png`; }
      const sz = d.d * S * sc * 1.25; x.globalAlpha = s.btnOp; if (im.complete && im.naturalWidth) x.drawImage(im, fx * W - sz / 2, fy * H - sz / 2, sz, sz * im.naturalHeight / im.naturalWidth); x.globalAlpha = 1;
    }
    // HUD hints: minimap, ammo, health bar
    x.fillStyle = 'rgba(20,24,28,.7)'; x.fillRect(W * 0.02, H * 0.04, W * 0.12, H * 0.2); x.fillRect(W * 0.78, H * 0.04, W * 0.16, H * 0.1);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.fillRect(W * 0.38, H * 0.92, W * 0.24, H * 0.018);
  }
  drawCalib() {
    const c = $('calGrid'); if (!c) return; const x = c.getContext('2d'), W = c.width, H = c.height, s = this.s;
    x.clearRect(0, 0, W, H); x.fillStyle = 'rgba(255,255,255,.04)'; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(227,192,106,.32)'; x.fillRect(W / 2, 0, W / 2, H / 2); x.fillRect(0, H / 2, W / 2, H / 2);
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 1; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(W * i / 4, 0); x.lineTo(W * i / 4, H); x.moveTo(0, H * i / 4); x.lineTo(W, H * i / 4); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(W / 2, 6); x.lineTo(W / 2, H - 6); x.moveTo(8, H / 2); x.lineTo(W - 8, H / 2); x.stroke();
    if (this.showDz !== false) { const r = s.joyDead * Math.min(W, H) * 1.1; x.strokeStyle = '#e3c06a'; x.lineWidth = 2; x.beginPath(); x.arc(W / 2, H / 2, r, 0, 7); x.stroke(); }
  }
}

// v1.5 front-end meta: top tab bar (PLAY / WEAPONS / OPERATORS / STORE / SETTINGS), operator select with the
// 3D operator standing in the lobby, the store (weapons, operators, medkits), coin / rank display.
import { OPERATORS, LOOKS } from './character.js';
import { WEAPON_BY_ID, PRIMARIES, SECONDARIES } from './weapons.js';
import { prog, save, levelOf, fmt, owns, buy, PRICES, MEDKIT_MAX, rankName, rankReq, rankOK } from './prog.js';
import { MAPS, MAP_BY_ID } from './maps.js';
import { MISSIONS, MISSION_BY_ID, objText, camp, unlocked } from './campaign.js';

const $ = (id) => document.getElementById(id);
export const TABS = ['menu', 'loadout', 'operators', 'store', 'settings'];
const OP_BY_ID = Object.fromEntries(OPERATORS.map(o => [o.id, o]));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export class Meta {
  constructor(game) {
    this.g = game; this.opSel = prog().op;
    $('topbar').querySelectorAll('[data-scr]').forEach(b => b.addEventListener('click', () => this.go(b.dataset.scr)));
    $('opAct').onclick = () => this.opAction();
    $('btnCampaign').onclick = () => this.g.ui.show('campaign');
    $('mapGo').onclick = () => this.deployMap();
    $('brGo').onclick = () => this.deployMission();
    this.mapSel = game.settings.map || 'city';
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || !$('dialog').classList.contains('hidden')) return;
      const cur = this.g.ui.cur; if (!TABS.includes(cur) || this.g.inMatch()) return;
      if (e.code === 'KeyQ' || e.code === 'KeyE') { const i = TABS.indexOf(cur), n = (i + (e.code === 'KeyE' ? 1 : TABS.length - 1)) % TABS.length; this.go(TABS[n]); e.preventDefault(); }
    });
  }
  go(id) { if (this.g.ui.cur === id) return; if (this.g.ui.cur === 'loadout') this.g.ui.closeLoadout(); this.g.ui.show(id, false); this.g.ui.stack = id === 'menu' ? [] : ['menu']; }
  // called by UI.show for every screen change
  onShow(id) {
    const front = TABS.includes(id) && id !== 'settings' && !this.g.inMatch(); // v1.6: SETTINGS is a full-screen sheet with its own back button
    const bar = front || ['mpmenu', 'lobby', 'maps', 'campaign', 'briefing'].includes(id) && !this.g.inMatch();
    $('topbar').classList.toggle('hidden', !bar); $('hintbar').classList.toggle('hidden', !bar);
    document.body.classList.toggle('front', bar);
    $('topbar').querySelectorAll('[data-scr]').forEach(b => b.classList.toggle('on', b.dataset.scr === (front ? id : 'menu')));
    if (bar) this.refreshTop();
    if (id === 'operators') { this.opSel = prog().op; this.renderOps(); }
    else if (front && this.g.state === 'menu') this.preview(prog().op); // leaving the operator screen: back to your own operator
    if (id === 'store') this.renderStore();
    if (id === 'maps') this.renderMaps();
    if (id === 'campaign') this.renderCampaign();
  }
  // ---------------- v1.5 maps / campaign ----------------
  mapImg(id) { return `assets/ui/maps/${id}.jpg`; }
  mapThumb(el, id) { const i = $(el); if (i) i.src = this.mapImg(id); }
  renderMaps() {
    const P = prog(), best = P.bestWaveMap || {};
    $('mapList').innerHTML = MAPS.map((m, i) => `<button class="mapcard${m.id === this.mapSel ? ' sel' : ''}" data-id="${m.id}"><img src="${this.mapImg(m.id)}" alt=""><span class="mn">${String(i + 1).padStart(2, '0')}</span><div class="mtx"><small>${m.place.toUpperCase()}</small><b>${m.name}</b><p>${m.desc}</p><em>${best[m.id] ? 'BEST · WAVE ' + best[m.id] : 'NOT PLAYED'}</em></div></button>`).join('');
    $('mapList').querySelectorAll('.mapcard').forEach(b => b.addEventListener('click', () => { if (this.mapSel === b.dataset.id) { this.deployMap(); return; } this.mapSel = b.dataset.id; this.g.settings.map = this.mapSel; this.g.saveSettings(); this.renderMaps(); }));
  }
  deployMap() { const g = this.g; g.campaign.stop(); g.settings.map = this.mapSel; g.saveSettings(); g.setMap(this.mapSel); g.startGame(); }
  renderCampaign() {
    const C = camp(), total = MISSIONS.reduce((a, m) => a + (C[m.id] || 0), 0);
    $('campStars').textContent = `${total} / ${MISSIONS.length * 3}`;
    $('campList').innerHTML = MAPS.map(mp => `<section><h3><span>${mp.name}</span><small>${mp.place}</small></h3><div class="crow">${MISSIONS.map((m, i) => [m, i]).filter(([m]) => m.map === mp.id).map(([m, i]) => {
      const st = C[m.id] || 0, open = unlocked(i);
      return `<button class="ccard${open ? '' : ' locked'}${st ? ' done' : ''}" data-id="${m.id}" ${open ? '' : 'disabled'}><span class="cn">${String(i + 1).padStart(2, '0')}</span><b>${m.name}</b><small>${m.obj.map(objText).join(' → ')}</small><span class="cst">${open ? '<i class="on">★</i>'.repeat(st) + '<i>★</i>'.repeat(3 - st) : '<span data-icon="lock"></span> LOCKED'}</span></button>`; }).join('')}</div></section>`).join('');
    $('campList').querySelectorAll('.ccard:not(.locked)').forEach(b => b.addEventListener('click', () => this.brief(b.dataset.id)));
  }
  brief(id) {
    const m = MISSION_BY_ID[id], i = MISSIONS.indexOf(m), st = camp()[m.id] || 0, mp = MAP_BY_ID[m.map]; this.brSel = id;
    $('brImg').src = this.mapImg(m.map); $('brMap').textContent = mp.name; $('brNum').textContent = `MISSION ${String(i + 1).padStart(2, '0')} · THREAT LEVEL ${m.lvl}`;
    $('brName').textContent = m.name; $('brText').textContent = m.brief;
    $('brObj').innerHTML = m.obj.map(o => `<li>${objText(o)}</li>`).join('');
    const par = `${(m.par / 60) | 0}:${String(m.par % 60).padStart(2, '0')}`;
    $('brStars').innerHTML = [['Complete the mission', st >= 1], [`Finish within ${par}`, st >= 2], ['Finish with 50+ health', st >= 3]].map(([t, on]) => `<div class="${on ? 'on' : ''}"><i>★</i>${t}</div>`).join('');
    const k = st ? 0.3 : 1; $('brCoins').textContent = fmt(m.coins * k); $('brXp').textContent = fmt(m.xp * k); $('brNote').textContent = st ? 'REPLAY · 30%' : 'FIRST CLEAR';
    this.g.ui.show('briefing');
  }
  deployMission() { if (this.brSel) this.g.campaign.start(this.brSel); }
  refreshTop() {
    const P = prog(), L = levelOf(P.xp);
    $('topCoins').textContent = fmt(P.coins); $('topMed').textContent = P.medkits; $('topRank').textContent = L.lv;
    $('topName').textContent = this.g.settings.name; $('topRankN') && ($('topRankN').textContent = rankName(L.lv)); $('topXp').style.width = (L.frac * 100).toFixed(1) + '%';
    const op = OP_BY_ID[P.op] || OPERATORS[0]; $('menuOp').textContent = op.name.toUpperCase(); $('menuRole').textContent = op.role;
    $('soloSub').textContent = `${MAP_BY_ID[this.g.settings.map || 'city'].name} · ` + (P.bestWave ? `best: wave ${P.bestWave}` : 'endless waves');
    { const C = camp(), n = MISSIONS.filter(m => C[m.id]).length, s2 = MISSIONS.reduce((a, m) => a + (C[m.id] || 0), 0); $('campSub').textContent = n ? `${n} / ${MISSIONS.length} missions · ${s2} stars` : `${MISSIONS.length} missions across 3 maps`; }
  }
  preview(id) {
    const g = this.g; if (g.state !== 'menu') return;
    g.setPlayerTint(id === 'swat' ? null : id); g.player.c.root.position.copy(g.player.pos); g.menuPose();
  }
  // ---------------- operators ----------------
  renderOps() {
    const P = prog();
    $('opList').innerHTML = OPERATORS.map((o, i) => {
      const own = owns('op', o.id);
      return `<button class="opcard${o.id === this.opSel ? ' sel' : ''}${o.id === P.op ? ' eq' : ''}${own ? '' : ' locked'}" data-id="${o.id}"><span class="on">${String(i + 1).padStart(2, '0')}</span><b>${o.name.toUpperCase()}</b><small>${o.role}</small>${own ? (o.id === P.op ? '<em>EQUIPPED</em>' : '') : (rankOK('op', o.id) ? `<em class="price"><i class="coinic"></i>${fmt(o.price)}</em>` : `<em class="price rk">RANK ${rankReq('op', o.id)}</em>`)}</button>`;
    }).join('');
    $('opList').querySelectorAll('.opcard').forEach(b => b.addEventListener('click', () => {
      if (this.opSel === b.dataset.id && owns('op', b.dataset.id)) { this.opAction(); return; }
      this.opSel = b.dataset.id; this.renderOps();
    }));
    const o = OP_BY_ID[this.opSel], own = owns('op', o.id);
    $('opRole').textContent = o.role.toUpperCase(); $('opName').textContent = o.name.toUpperCase(); $('opBlurb').textContent = o.blurb;
    const act = $('opAct'); act.disabled = false; act.classList.remove('cant');
    if (o.id === P.op) { act.textContent = 'EQUIPPED'; act.disabled = true; }
    else if (own) act.textContent = 'EQUIP OPERATOR';
    else if (!rankOK('op', o.id)) { act.innerHTML = `RANK ${rankReq('op', o.id)} REQUIRED`; act.classList.add('cant'); }
    else { act.innerHTML = `UNLOCK <i class="coinic"></i> ${fmt(o.price)}`; if (P.coins < o.price) act.classList.add('cant'); }
    this.preview(o.id);
  }
  opAction() {
    const o = OP_BY_ID[this.opSel], P = prog();
    if (!owns('op', o.id)) {
      if (!rankOK('op', o.id)) { this.g.ui.dialog('RANK REQUIRED', `${o.name} unlocks at rank ${rankReq('op', o.id)} (${rankName(rankReq('op', o.id))}). You are rank ${levelOf(P.xp).lv}.`); return; }
      if (!buy('op', o.id, o.price)) { this.g.ui.dialog('NOT ENOUGH COINS', `${o.name} costs ${fmt(o.price)} coins. You have ${fmt(P.coins)}. Earn coins from kills, headshots, waves and wins.`); return; }
      this.g.sfx.coins && this.g.sfx.coins();
    }
    P.op = o.id; save(); this.g.sfx.ui('select'); this.refreshTop(); this.renderOps();
  }
  // ---------------- store ----------------
  renderStore() {
    const P = prog(), card = (kind, id, title, sub, price, img, state) => `<div class="scard ${state}" data-kind="${kind}" data-id="${id}" data-price="${price}">
      <div class="simg">${img}</div><div class="stxt"><small>${sub}</small><b>${title}</b></div>
      <button class="sbuy" ${state === 'owned' || state === 'max' || state.startsWith('rank') ? 'disabled' : ''}>${state === 'owned' ? 'OWNED' : state === 'max' ? 'FULL' : state.startsWith('rank') ? 'RANK ' + state.slice(6) : `<i class="coinic"></i>${fmt(price)}`}</button></div>`;
    const guns = [...PRIMARIES, ...SECONDARIES].filter(id => PRICES.guns[id] > 0).map(id => { const w = WEAPON_BY_ID[id]; return card('gun', id, w.name, 'WEAPON · ' + w.cls, PRICES.guns[id], `<img src="${w.thumb}" alt="">`, owns('gun', id) ? 'owned' : !rankOK('gun', id) ? 'rank r' + rankReq('gun', id) : P.coins < PRICES.guns[id] ? 'cant' : ''); });
    const ops = OPERATORS.filter(o => o.price > 0).map(o => card('op', o.id, o.name.toUpperCase(), 'OPERATOR · ' + o.role, o.price, `<span class="opglyph">${o.name[0]}</span>`, owns('op', o.id) ? 'owned' : !rankOK('op', o.id) ? 'rank r' + rankReq('op', o.id) : P.coins < o.price ? 'cant' : ''));
    const med = card('medkit', 'medkit', `MEDKIT <span class="cnt">${P.medkits}/${MEDKIT_MAX}</span>`, 'EQUIPMENT · HEALS 60 HP IN 2 S', PRICES.medkit, '<span class="medglyph"></span>', P.medkits >= MEDKIT_MAX ? 'max' : P.coins < PRICES.medkit ? 'cant' : '');
    $('storeGrid').innerHTML = `<h3>EQUIPMENT</h3><div class="srow">${med}</div><h3>WEAPONS</h3><div class="srow">${guns.join('')}</div><h3>OPERATORS</h3><div class="srow">${ops.join('')}</div>`;
    $('storeGrid').querySelectorAll('.scard').forEach(c => c.querySelector('.sbuy').addEventListener('click', () => this.purchase(c.dataset.kind, c.dataset.id, +c.dataset.price)));
  }
  purchase(kind, id, price) {
    const P = prog();
    if (P.coins < price) { this.g.ui.dialog('NOT ENOUGH COINS', `This costs ${fmt(price)} coins. You have ${fmt(P.coins)}.`); return; }
    if (!buy(kind, id, price)) return;
    this.g.sfx.coins && this.g.sfx.coins(); this.refreshTop(); this.renderStore();
  }
}

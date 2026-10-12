// v1.5 front-end meta: top tab bar (PLAY / WEAPONS / OPERATORS / STORE / SETTINGS), operator select with the
// 3D operator standing in the lobby, the store (weapons, operators, medkits), coin / rank display.
import { OPERATORS, LOOKS } from './character.js';
import { WEAPON_BY_ID, PRIMARIES, SECONDARIES } from './weapons.js';
import { prog, save, levelOf, fmt, owns, buy, PRICES, MEDKIT_MAX, rankName, rankReq, rankOK, addCoins } from './prog.js';
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
    $('topPlus').onclick = (e) => { e.stopPropagation(); this.go('store'); };
    $('btnDaily').onclick = () => this.claimDaily();
    this.fit(); addEventListener('resize', () => this.fit()); if (window.visualViewport) visualViewport.addEventListener('resize', () => this.fit());
    this.ping(); setInterval(() => { if (this.g.ui.cur === 'menu') this.ping(); }, 15000);
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
  // v1.7: the menu screens are laid out on a 1024 x 572 design stage (the reference mockups) and scaled to the screen
  fit() {
    const vv = window.visualViewport, W = vv ? vv.width : innerWidth, H = vv ? vv.height : innerHeight, k = this.k = Math.min(W / 1024, H / 572, 1.6);
    document.querySelectorAll('.v17 > .stg, #topbar > .tb17').forEach(st => { st.style.transform = `scale(${k})`; st.style.width = (W / k) + 'px'; st.style.height = (st.classList.contains('tb17') ? 56 : H / k) + 'px'; });
    $('topbar').style.height = (56 * k) + 'px'; document.documentElement.style.setProperty('--k17', k.toFixed(4));
  }
  // DAILY REWARDS: one claim per calendar day; consecutive days raise the reward (50, 75, 100 … 200 coins, + a medkit on day 7)
  dailyState() { const P = prog(), d = P.daily || {}, today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString(); return { P, d, today, ready: d.last !== today, streak: d.last === yest ? (d.streak || 0) + 1 : d.last === today ? d.streak || 1 : 1 }; }
  claimDaily() {
    const st = this.dailyState(); if (!st.ready) { this.g.ui.dialog('DAILY REWARDS', `Already claimed today (day ${st.streak}). Come back tomorrow for day ${st.streak + 1}.`); return; }
    const day = ((st.streak - 1) % 7) + 1, coins = Math.min(200, 25 + 25 * day);
    st.P.daily = { last: st.today, streak: st.streak }; addCoins(coins); if (day === 7 && st.P.medkits < MEDKIT_MAX) st.P.medkits++; save();
    this.g.sfx.coins && this.g.sfx.coins(); this.refreshTop();
    this.g.ui.dialog(`DAY ${st.streak} REWARD`, `+${coins} coins${day === 7 ? ' and a medkit' : ''}. Log in tomorrow to keep the streak going.`);
  }
  // PING: round trip to the multiplayer matchmaking server (PeerJS broker); OFFLINE when there is no network
  async ping() {
    const el = $('pingTxt'); if (!el) return; if (this.g.testMode) { el.innerHTML = '<i class="wifi"></i>PING: —'; return; }
    if (!navigator.onLine) { el.innerHTML = '<i class="wifi off"></i>OFFLINE'; return; }
    try { const t = performance.now(); await fetch('https://0.peerjs.com/peerjs/id?ts=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }); const ms = Math.round(performance.now() - t); el.innerHTML = `<i class="wifi${ms > 250 ? ' bad' : ''}"></i>PING: ${ms}ms`; }
    catch (e) { el.innerHTML = '<i class="wifi off"></i>PING: —'; }
  }
  // called by UI.show for every screen change
  onShow(id) {
    if (id === 'mpmenu' && $('mpName') && !$('mpName').value) $('mpName').value = this.g.settings.name || '';
    const front = TABS.includes(id) && id !== 'settings' && !this.g.inMatch(); // v1.6: SETTINGS is a full-screen sheet with its own back button
    const bar = front || ['mpmenu', 'lobby', 'maps', 'campaign', 'briefing'].includes(id) && !this.g.inMatch();
    $('topbar').classList.toggle('hidden', !bar); $('hintbar').classList.toggle('hidden', !bar);
    document.body.classList.toggle('front', bar); document.body.classList.toggle('scr-' + (this.lastScr || 'x'), false); this.lastScr = id; document.body.classList.toggle('scr-' + id, true);
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
    $('mapList').innerHTML = MAPS.map((m, i) => `<button class="mapcard${m.id === this.mapSel ? ' sel' : ''}" data-id="${m.id}"><span class="mimg"><img src="${this.mapImg(m.id)}" alt=""><span class="mn">${String(i + 1).padStart(2, '0')}</span></span><span class="mtx"><small>${m.place.toUpperCase()}</small><b>${m.name.toUpperCase()}</b><p>${m.desc.toUpperCase()}</p><em class="${best[m.id] ? 'best' : ''}">${best[m.id] ? 'BEST • WAVE ' + best[m.id] : 'NOT PLAYED'}</em></span></button>`).join('');
    $('mapList').querySelectorAll('.mapcard').forEach(b => b.addEventListener('click', () => { if (this.mapSel === b.dataset.id) { this.deployMap(); return; } this.mapSel = b.dataset.id; this.g.settings.map = this.mapSel; this.g.saveSettings(); this.renderMaps(); }));
  }
  deployMap() { const g = this.g; g.campaign.stop(); g.settings.map = this.mapSel; g.saveSettings(); g.setMap(this.mapSel); g.startGame(); }
  renderCampaign() {
    const C = camp(), total = MISSIONS.reduce((a, m) => a + (C[m.id] || 0), 0); let first = null;
    $('campStars').textContent = `${total} / ${MISSIONS.length * 3}`;
    $('campList').innerHTML = MAPS.map(mp => `<section><h3><b>${mp.name.toUpperCase()}</b><small>${mp.place[0].toUpperCase() + mp.place.slice(1).toLowerCase()}</small></h3><div class="crow">${MISSIONS.map((m, i) => [m, i]).filter(([m]) => m.map === mp.id).map(([m, i]) => {
      const st = C[m.id] || 0, open = unlocked(i), cur = open && !st && !first; if (cur) first = m.id;
      return `<button class="ccard${open ? '' : ' locked'}${st ? ' done' : ''}${cur ? ' cur' : ''}" data-id="${m.id}" ${open ? '' : 'disabled'} style="--img:url(assets/ui/missions/${m.id}.jpg)"><span class="cn">${String(i + 1).padStart(2, '0')}</span><b>${m.name}</b><small>${m.obj.map(objText).join(' → ').toUpperCase()}</small>${open ? `<span class="cst">${[0, 1, 2].map(k => `<i class="${k < st ? 'on' : ''}">★</i>`).join('')}</span>` : '<span class="lock"></span><span class="lk">LOCKED</span>'}</button>`;
    }).join('')}</div></section>`).join('');
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
    const P = prog(), L = levelOf(P.xp), g = this.g;
    $('topCoins').textContent = fmt(P.coins); $('topMed').textContent = P.medkits; $('topRank').textContent = L.lv;
    $('topName').textContent = g.settings.name; $('topRankN') && ($('topRankN').textContent = rankName(L.lv)); $('topXp').style.width = (L.frac * 100).toFixed(1) + '%';
    $('topbar').querySelector('.trank').title = `Rank ${L.lv} · ${rankName(L.lv)} · ${fmt(L.cur)} / ${fmt(L.need)} XP`;
    const op = OP_BY_ID[P.op] || OPERATORS[0]; $('menuOp').textContent = op.name.toUpperCase(); $('menuRole').textContent = op.role.toUpperCase();
    $('menuname').textContent = g.settings.name;
    $('soloSub').textContent = P.bestWave ? `PERSONAL BEST: WAVE ${P.bestWave}` : 'PERSONAL BEST: NOT PLAYED';
    { // campaign card: the act (map) of the next mission + overall progress (stars earned)
      const C = camp(), s2 = MISSIONS.reduce((a, m) => a + (C[m.id] || 0), 0), nx = MISSIONS.find((m, i) => unlocked(i) && !C[m.id]) || MISSIONS[MISSIONS.length - 1];
      const act = MAPS.findIndex(m => m.id === nx.map); $('campSub').textContent = `ACT ${ROMAN[act + 1]}: ${MAP_BY_ID[nx.map].name.toUpperCase()} (${Math.round(s2 / (MISSIONS.length * 3) * 100)}% PROGRESS)`;
    }
    const w = WEAPON_BY_ID[g.settings.primary]; if (w && $('menuGun')) $('menuGun').src = w.thumb;
    $('btnDaily').classList.toggle('ready', this.dailyState().ready);
    if ($('opCall')) $('opCall').textContent = g.settings.name;
  }
  preview(id) {
    const g = this.g; if (g.state !== 'menu') return;
    g.setPlayerTint(id === 'swat' ? null : id); g.player.c.root.position.copy(g.player.pos); g.menuPose();
  }
  // ---------------- operators ----------------
  renderOps() {
    const P = prog();
    $('opList').innerHTML = OPERATORS.map((o, i) => {
      const own = owns('op', o.id), eq = o.id === P.op, rk = rankReq('op', o.id), rOK = rankOK('op', o.id);
      const status = eq ? '<em class="eq">EQUIPPED</em>' : own ? '<em class="own">OWNED</em>' : !rOK ? `<em class="rk">RANK ${rk}</em><span class="lock"></span>` : `<em class="pr"><i class="coinic"></i>${fmt(o.price)}</em><span class="lock"></span>`;
      return `<button class="opcard${o.id === this.opSel ? ' sel' : ''}${eq ? ' eq' : ''}${own ? '' : ' locked'}" data-id="${o.id}"><img src="assets/ui/ops/${o.id}.jpg" alt=""><span class="on">${String(i + 1).padStart(2, '0')}</span><span class="otx"><b>${o.name.toUpperCase()}</b><small>${o.role.toUpperCase()}</small>${status}</span></button>`;
    }).join('');
    $('opList').querySelectorAll('.opcard').forEach(b => b.addEventListener('click', () => {
      if (this.opSel === b.dataset.id && owns('op', b.dataset.id)) { this.opAction(); return; }
      this.opSel = b.dataset.id; this.renderOps();
    }));
    const o = OP_BY_ID[this.opSel], own = owns('op', o.id);
    $('opRole').textContent = o.role.toUpperCase(); $('opName').textContent = o.name.toUpperCase(); $('opBlurb').textContent = o.blurb; $('opCall').textContent = this.g.settings.name;
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
    const P = prog();
    const btn = (state, price) => `<button class="sbuy ${state}" ${state === 'owned' || state === 'max' || state.startsWith('rank') ? 'disabled' : ''}>${state === 'owned' ? 'OWNED' : state === 'max' ? 'FULL' : state.startsWith('rank') ? 'RANK ' + state.slice(6) : `<i class="coinic"></i>${fmt(price)}`}</button>`;
    const card = (kind, id, title, sub, price, img, state, cls = '') => `<div class="scard ${cls} ${state}" data-kind="${kind}" data-id="${id}" data-price="${price}"><small>${sub}</small>${state.startsWith('rank') ? '<span class="lock"></span>' : ''}<div class="simg">${img}</div><b>${title}</b>${btn(state, price)}</div>`;
    const guns = [...PRIMARIES, ...SECONDARIES].filter(id => PRICES.guns[id] > 0).map(id => { const w = WEAPON_BY_ID[id]; return card('gun', id, w.name, 'WEAPON • ' + w.cls, PRICES.guns[id], `<img src="${w.thumb}" alt="">`, owns('gun', id) ? 'owned' : !rankOK('gun', id) ? 'rank r' + rankReq('gun', id) : P.coins < PRICES.guns[id] ? 'cant' : ''); });
    const ops = OPERATORS.filter(o => o.price > 0).map(o => card('op', o.id, o.name.toUpperCase(), 'OPERATOR • ' + o.role.toUpperCase(), o.price, `<img src="assets/ui/ops/${o.id}.jpg" alt="">`, owns('op', o.id) ? 'owned' : !rankOK('op', o.id) ? 'rank r' + rankReq('op', o.id) : P.coins < o.price ? 'cant' : '', 'op'));
    const medState = P.medkits >= MEDKIT_MAX ? 'max' : P.coins < PRICES.medkit ? 'cant' : '';
    const med = `<div class="scard big ${medState}" data-kind="medkit" data-id="medkit" data-price="${PRICES.medkit}"><div class="simg"><span class="medbag"></span></div><div class="mtx"><small>EQUIPMENT •<br>HEALS 60 HP IN 2 S</small><b>MEDKIT</b><span class="cnt">${P.medkits}/${MEDKIT_MAX}</span></div>${btn(medState, PRICES.medkit)}</div>`;
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

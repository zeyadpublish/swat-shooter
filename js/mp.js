// Multiplayer: host-authoritative rooms over WebRTC (see net.js). Up to 8 players.
// Modes: Team Deathmatch, Free-for-all, Co-op Waves (enemies simulated by the host only).
// Clients send their own state (~20 Hz) and their shots; the host validates every hit (rate of fire, origin,
// line of sight, target position in a short history = simple lag compensation, headshot height), owns health,
// kills, respawns, scores and the timer, and broadcasts snapshots (~20 Hz). Remote players are drawn 100 ms in the past
// and interpolated between snapshots.
import * as THREE from 'three';
import { Net, cleanCode, errText } from './net.js';
import { WEAPON_BY_ID, falloff } from './weapons.js';
import { raycastBoxes } from './physics.js';
import { angDiff } from './player.js';
import { esc, cleanName } from './ui.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const A = (v) => [r2(v.x), r2(v.y), r2(v.z)];
export const TEAM_TINT = [0x4d6fae, 0xa84a3c];
const FFA_TINTS = [0x9c8a6e, 0x7d8a63, 0x9a6458, 0x6f7a8c, 0x8a8a8a, 0x6e5a8c, 0x5f8a86, 0x8c7a4a];
const TEAM_NAME = ['BLUE', 'RED'], TEAM_CLS = ['blue', 'red'];
const MODE_NAME = { tdm: 'TEAM DEATHMATCH', ffa: 'FREE-FOR-ALL', coop: 'CO-OP WAVES' };
export const MAX_PLAYERS = 8;
const INTERP = 0.1, SEND_DT = 0.05, RESPAWN = 3, PROTECT = 2;
const TEAM_SPAWNS = [[[-36, -38], [-12, -40], [20, -40], [0, -40], [-28.5, -26], [38, -22]], [[40, 30], [30, 40], [-38, 33], [-20, 42], [0, 40], [-40, 12]]];
const QUICK = ['Nice shot!', 'Follow me', 'Need backup', 'Enemy spotted', 'Thanks', 'GG'];
const ONCE = /^(death|jump|turn|crouching turn)/, LOCO = /^(walk|run|sprint|crouch)/;

// a network-driven character (another player, or a co-op enemy on a client)
class Puppet {
  constructor(mp, tint, gun) {
    this.mp = mp; const g = mp.g;
    this.c = g.factory.create({ tint }); g.scene.add(this.c.root); this.c.root.visible = false;
    if (gun) this.c.setGun(gun);
    this.buf = []; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.crouch = false; this.lastPhase = 0; this.seen = false; this.lastFire = -9;
  }
  push(s, t) {
    const last = this.buf[this.buf.length - 1];
    if (last && s.p.distanceTo(last.p) > 6) this.buf.length = 0; // teleport (respawn): don't glide across the map
    this.buf.push({ t, ...s }); while (this.buf.length > 2 && this.buf[1].t < t - 1) this.buf.shift();
  }
  update(dt) {
    const b = this.buf; if (!b.length) return;
    const rt = now() - INTERP; let s0 = b[0], s1 = b[0];
    for (let i = 0; i < b.length; i++) { if (b[i].t <= rt) s0 = b[i]; if (b[i].t >= rt) { s1 = b[i]; break; } s1 = b[i]; }
    const k = s1.t > s0.t ? Math.min(1, Math.max(0, (rt - s0.t) / (s1.t - s0.t))) : 1;
    const prev = this.pos.clone();
    this.pos.copy(s0.p).lerp(s1.p, k);
    if (dt > 0) this.vel.copy(this.pos).sub(prev).divideScalar(dt).clampLength(0, 9);
    const yaw = s0.y + angDiff(s1.y, s0.y) * k;
    const c = this.c; c.root.visible = true; this.seen = true;
    c.yaw = yaw; c.aimPitch += ((s0.pi + (s1.pi - s0.pi) * k) - c.aimPitch) * Math.min(1, dt * 15);
    const st = k < 0.5 ? s0 : s1; this.crouch = !!(st.f & 1); this.flags = st.f;
    if (st.w && c.gunId !== st.w && WEAPON_BY_ID[st.w]) c.setGun(st.w);
    if (st.a) c.play(st.a, { fade: 0.2, once: ONCE.test(st.a), sync: LOCO.test(st.a) && LOCO.test(c.currentName), timeScale: st.ts || 1 });
    c.root.position.copy(this.pos); c.update(dt);
    // footsteps
    if (LOCO.test(c.currentName) && this.mp.g.player.pos.distanceTo(this.pos) < 24) {
      const ph = c.phase(); if ((this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase) this.mp.g.sfx.step(this.pos, /sprint/.test(c.currentName) ? 0.16 : 0.1); this.lastPhase = ph;
    }
  }
  chest() { return this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 0.85 : 1.3, 0)); }
  dispose() { this.c.dispose(this.mp.g.scene); if (this.plate) this.plate.remove(); }
}
class RemotePlayer extends Puppet {
  constructor(mp, info) { super(mp, mp.tintFor(info), null); this.id = info.id; }
  get info() { return this.mp.players.get(this.id) || {}; }
  get dead() { return !!this.info.dead; }
  get team() { return this.info.team; }
  // co-op: hostile AI shooting at this player (host only)
  damage(amount, fromPos) { this.mp.applyDamage(this.id, amount, -1, fromPos, false, null); }
}
class Ghost extends Puppet { // co-op enemy as seen by a client
  constructor(mp, nid, gun) { super(mp, FFA_TINTS[nid % 5], gun); this.nid = nid; this.dead = false; this.canSee = false; }
  alert() {} damage() {}
}

export class MP {
  constructor(game) {
    this.g = game; this.net = null; this.role = null; this.active = false; this.players = new Map(); this.remotes = new Map(); this.ghosts = new Map();
    this.mode = 'tdm'; this.lim = { score: 30, time: 300 }; this.myId = -1; this.rtt = 0; this.sendT = 0; this.teamScore = [0, 0]; this.timeLeft = 0;
    const me = this;
    this.localProxy = { // the host's own player, as an AI target in co-op
      get pos() { return game.player.pos; }, get vel() { return game.player.vel; }, get crouch() { return game.player.crouch; }, get dead() { return game.player.dead; },
      chest: () => game.player.chest(), damage: (a, f) => me.applyDamage(me.myId, a, -1, f, false, null),
    };
    this.bindUI();
  }
  get isHost() { return this.role === 'host'; }
  get me() { return this.players.get(this.myId); }
  get inLobby() { return !!this.role && !this.active; }
  tintFor(p) { return this.mode === 'tdm' ? TEAM_TINT[p.team || 0] : FFA_TINTS[p.id % FFA_TINTS.length]; }
  name(id) { const p = this.players.get(id); return p ? p.name : '?'; }

  // ------------------------------------------------------------------ UI: multiplayer menu + lobby
  bindUI() {
    const g = this.g, s = g.settings;
    $('btnMP').onclick = () => { $('mpName').value = s.name; this.status(''); g.ui.show('mpmenu'); };
    $('mpName').addEventListener('change', () => { s.name = cleanName($('mpName').value) || s.name; $('mpName').value = s.name; $('optName').value = s.name; g.saveSettings(); g.ui.refreshMenu(); });
    $('joinCode').addEventListener('input', () => { const v = cleanCode($('joinCode').value); if (v !== $('joinCode').value) $('joinCode').value = v; });
    $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
    $('btnHost').onclick = () => this.host();
    $('btnJoin').onclick = () => this.join($('joinCode').value);
    $('lobbyLeave').onclick = () => { g.sfx.ui('back'); this.leave(); };
    for (const id of ['lbMode', 'lbScore', 'lbTime']) $(id).addEventListener('change', () => {
      if (!this.isHost) return; this.mode = $('lbMode').value; this.lim = { score: +$('lbScore').value, time: +$('lbTime').value }; this.broadcastLobby();
    });
    $('btnReady').onclick = () => { if (this.isHost) return; this.net.broadcast({ t: 'rd' }); };
    $('btnTeam').onclick = () => { if (this.isHost) { const me = this.me; me.team = 1 - me.team; this.broadcastLobby(); } else this.net.broadcast({ t: 'tm' }); };
    $('btnStart').onclick = () => this.isHost && this.startMatch();
    $('btnCopy').onclick = () => this.copyLink();
    $('btnShare').onclick = () => this.shareLink();
    // in-match chat / scoreboard (mobile buttons)
    const qc = $('quickchat'); qc.innerHTML = QUICK.map(q => `<button>${q}</button>`).join('');
    qc.querySelectorAll('button').forEach(b => b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.sendChat(b.textContent); qc.classList.add('hidden'); }, { passive: false }));
    qc.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { this.sendChat(b.textContent); qc.classList.add('hidden'); }));
    const tap = (el, f) => { el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); f(); }, { passive: false }); el.addEventListener('click', f); };
    tap($('tScore'), () => this.toggleBoard());
    tap($('tChat'), () => qc.classList.toggle('hidden'));
    $('chatin').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = $('chatin').value.trim(); if (v) this.sendChat(v); this.closeChat(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.closeChat(); e.preventDefault(); }
    });
    addEventListener('beforeunload', () => { if (this.net) { this.net.broadcast(this.isHost ? { t: 'closed' } : { t: 'bye' }); } });
  }
  status(t, err) { $('mpstatus').textContent = t; $('mpstatus').classList.toggle('err', !!err); }
  link() { return location.origin + location.pathname + '?room=' + this.code; }
  async copyLink() {
    const url = this.link(); let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (e2) {} t.remove();
    }
    $('lobbyInfo').textContent = ok ? 'Invite link copied to the clipboard.' : 'Copy this link: ' + url; window.__copied = url;
  }
  async shareLink() {
    if (navigator.share) { try { await navigator.share({ title: 'SWAT: Urban Siege', text: `Join my SWAT room: ${this.code}`, url: this.link() }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    this.copyLink();
  }
  setupNet() {
    const n = this.net = new Net();
    n.onData = (pid, m) => { try { this.isHost ? this.hostMsg(pid, m) : this.clientMsg(m); } catch (e) { console.error('mp message', m && m.t, e); } };
    n.onClose = (pid) => { if (this.isHost) this.playerLeft(pid); else this.hostLost('The connection to the host was lost.'); };
    n.onError = (e) => { if (e && e.type !== 'peer-unavailable') console.warn('peer error', e.type || e); };
    return n;
  }
  async host() {
    if (this.busy) return; this.busy = true; this.g.sfx.init();
    this.status('Creating room…');
    try {
      const n = this.setupNet(); this.code = await n.host(); this.role = 'host'; this.myId = 0; this.nextId = 1;
      this.players.clear(); this.players.set(0, this.newPlayer(0, this.g.settings.name, 0, null)); this.me.ready = true;
      this.mode = $('lbMode').value; this.lim = { score: +$('lbScore').value, time: +$('lbTime').value };
      this.startTick(); this.showLobby();
    } catch (e) { this.status(errText(e), true); this.cleanup(); }
    this.busy = false;
  }
  keepParams() { const q = new URLSearchParams(location.search); q.delete('room'); const s = q.toString(); return s ? '&' + s : ''; }
  async join(code) {
    code = cleanCode(code); if (code.length !== 5) { this.status('Enter the 5-character room code.', true); return; }
    if (this.busy) return; this.busy = true; this.g.sfx.init();
    this.status(`Connecting to room ${code}…`);
    try {
      const n = this.setupNet(); this.role = 'client'; this.code = code;
      await n.join(code);
      const welcome = new Promise((res, rej) => { this.welcomeCb = res; this.rejectCb = rej; setTimeout(() => rej(new Error('The host did not answer.')), 8000); });
      n.broadcast({ t: 'hello', name: this.g.settings.name, v: 1 });
      await welcome; this.startTick(); this.showLobby();
    } catch (e) { this.status(errText(e), true); this.cleanup(); }
    this.busy = false;
  }
  newPlayer(id, name, team, pid) { return { id, name, team, pid, ready: false, k: 0, d: 0, s: 0, hp: 100, dead: false, prot: 0, ping: 0, hist: [], lastHurt: -99, lastShot: -9, hs: 0, shots: 0, hits: 0 }; }
  uniqueName(n) { let name = cleanName(n) || 'Operator', i = 2; const used = new Set([...this.players.values()].map(p => p.name)); const base = name.slice(0, 12); while (used.has(name)) name = base + ' ' + i++; return name; }

  // ------------------------------------------------------------------ host: messages from clients
  hostMsg(pid, m) {
    const p = [...this.players.values()].find(q => q.pid === pid);
    if (m.t === 'hello') {
      if (p) return;
      if (this.players.size >= MAX_PLAYERS) { this.net.send(pid, { t: 'full' }); setTimeout(() => this.net.kick(pid), 400); return; }
      const cnt = [0, 1].map(t => [...this.players.values()].filter(q => q.team === t).length);
      const np = this.newPlayer(this.nextId++, this.uniqueName(m.name), cnt[1] < cnt[0] ? 1 : 0, pid);
      this.players.set(np.id, np);
      this.net.send(pid, { t: 'welcome', id: np.id, code: this.code });
      this.sysChat(`${np.name} joined`);
      if (this.active) { // joining a match in progress
        np.dead = true; np.respawnAt = now() + 1; this.addRemote(np); this.net.send(pid, this.startMsg(false)); this.broadcastRoster();
      } else this.broadcastLobby();
      return;
    }
    if (!p) return;
    switch (m.t) {
      case 'pi': this.net.send(pid, { t: 'po', c: m.c }); p.ping = Math.round(m.r || 0); break;
      case 'rd': if (!this.active) { p.ready = !p.ready; this.broadcastLobby(); } break;
      case 'tm': if (!this.active && this.mode === 'tdm') { p.team = 1 - p.team; this.broadcastLobby(); } break;
      case 's': this.onState(p, m); break;
      case 'sh': this.onClientShot(p, m); break;
      case 'ch': this.chat(p.id, String(m.m || '').slice(0, 80)); break;
      case 'bye': this.net.kick(pid); break;
    }
  }
  onState(p, m) {
    if (!this.active || !m.p) return;
    p.ping = Math.round(m.r || p.ping); p.state = m; const t = now();
    const rp = this.remotes.get(p.id); if (!rp) return;
    const st = { p: V(m.p), y: +m.y || 0, pi: +m.pi || 0, a: String(m.a || 'idle'), ts: +m.ts || 1, w: m.w, f: m.f | 0 };
    rp.push(st, t); p.hist.push({ t, p: st.p, c: !!(st.f & 1) }); while (p.hist.length > 40) p.hist.shift();
  }
  playerLeft(pid) {
    const p = [...this.players.values()].find(q => q.pid === pid); if (!p) return;
    this.players.delete(p.id); this.removeRemote(p.id); this.sysChat(`${p.name} left`);
    if (this.active) { this.broadcastRoster(); this.checkCoopWipe(); } else this.broadcastLobby();
  }
  broadcastLobby() {
    const m = { t: 'lb', mode: this.mode, lim: this.lim, code: this.code, pl: [...this.players.values()].map(p => [p.id, p.name, p.team, p.ready ? 1 : 0]) };
    this.net.broadcast(m); this.renderLobby(m);
  }
  roster() { return [...this.players.values()].map(p => [p.id, p.name, p.team, p.k, p.d, p.s]); }
  broadcastRoster() { const m = { t: 'ro', pl: this.roster() }; this.net.broadcast(m); }

  // ------------------------------------------------------------------ client: messages from the host
  clientMsg(m) {
    switch (m.t) {
      case 'welcome': this.myId = m.id; this.welcomeCb && this.welcomeCb(); this.welcomeCb = null; break;
      case 'full': this.rejectCb && this.rejectCb(new Error('That room is full (8 players).')); break;
      case 'po': this.rtt = (performance.now() - m.c); break;
      case 'lb': this.mode = m.mode; this.lim = m.lim; this.syncPlayers(m.pl.map(([id, name, team, ready]) => ({ id, name, team, ready: !!ready }))); this.renderLobby(m); break;
      case 'st': this.beginMatch(m); break;
      case 'ro': this.syncPlayers(m.pl.map(([id, name, team, k, d, s]) => ({ id, name, team, k, d, s }))); break;
      case 'sn': this.onSnapshot(m); break;
      case 'fx': this.onFx(m); break;
      case 'ht': this.onHitConfirm(m); break;
      case 'dm': this.onLocalDamage(m); break;
      case 'kl': this.onKill(m); break;
      case 'sp': this.onSpawn(m); break;
      case 'ch': this.addChat(m.id, m.m, m.sys); break;
      case 'bn': this.g.hud.banner(esc(m.a), esc(m.b || ''), 3); if (m.wave) this.onWave(m); break;
      case 'end': this.onEnd(m); break;
      case 'closed': this.hostLost('The host closed the room.'); break;
    }
  }
  syncPlayers(list) {
    const keep = new Set(list.map(p => p.id));
    for (const id of [...this.players.keys()]) if (!keep.has(id)) { this.players.delete(id); this.removeRemote(id); }
    for (const q of list) {
      const p = this.players.get(q.id) || this.newPlayer(q.id, q.name, q.team, null);
      Object.assign(p, q); this.players.set(q.id, p);
      if (this.active && q.id !== this.myId && !this.remotes.has(q.id)) this.addRemote(p);
    }
  }
  hostLost(msg) {
    if (!this.role || this.leaving) return;
    const wasActive = this.active || this.role;
    this.cleanup(); if (!wasActive) return;
    this.g.toMenu(); this.g.ui.dialog('DISCONNECTED', msg);
  }

  // ------------------------------------------------------------------ lobby
  showLobby() {
    const g = this.g; $('roomCode').textContent = this.code; g.ui.show('lobby');
    $('lobbyInfo').textContent = this.isHost ? 'Share the code or link. Start when everyone is ready.' : 'Waiting for the host to start…';
    for (const id of ['lbMode', 'lbScore', 'lbTime']) $(id).disabled = !this.isHost;
    $('btnStart').classList.toggle('hidden', !this.isHost); $('btnReady').classList.toggle('hidden', this.isHost);
    $('btnShare').classList.toggle('hidden', !navigator.share);
    if (this.isHost) this.broadcastLobby();
  }
  renderLobby(m) {
    if (!m) return; const pl = [...this.players.values()];
    $('lbMode').value = this.mode; $('lbScore').value = String(this.lim.score); $('lbTime').value = String(this.lim.time);
    $('lbScore').parentElement.classList.toggle('hidden', this.mode === 'coop'); $('lbTime').parentElement.classList.toggle('hidden', this.mode === 'coop');
    const row = (p) => `<div class="lp ${this.mode === 'tdm' ? TEAM_CLS[p.team] : ''}${p.id === this.myId ? ' me' : ''}"><span class="nm">${esc(p.name)}</span>${p.id === 0 ? '<span class="tag hs">HOST</span>' : p.ready ? '<span class="tag rd">READY</span>' : '<span class="tag">NOT READY</span>'}</div>`;
    const el = $('lobbyPlayers');
    if (this.mode === 'tdm') { el.classList.remove('single'); el.innerHTML = [0, 1].map(t => `<div class="lteam ${TEAM_CLS[t]}"><h4>${TEAM_NAME[t]} TEAM</h4>${pl.filter(p => p.team === t).map(row).join('')}</div>`).join(''); }
    else { el.classList.add('single'); el.innerHTML = `<div class="lteam"><h4>${MODE_NAME[this.mode]} · ${pl.length}/${MAX_PLAYERS}</h4>${pl.map(row).join('')}</div>`; }
    $('btnTeam').classList.toggle('hidden', this.mode !== 'tdm');
    const me = this.me; $('btnReady').classList.toggle('on', !!(me && me.ready)); $('btnReady').textContent = me && me.ready ? 'READY ✓' : 'READY';
    const others = pl.filter(p => p.id !== 0), ready = others.filter(p => p.ready).length;
    if (this.isHost) $('btnStart').textContent = others.length && ready < others.length ? `START (${ready}/${others.length} READY)` : 'START MATCH';
    window.__lobby = { n: pl.length, ready, mode: this.mode };
  }

  // ------------------------------------------------------------------ match start
  pickSpawn(p) {
    const w = this.g.world, others = [...this.players.values()].filter(q => q !== p && !q.dead).map(q => this.posOf(q.id)).filter(Boolean);
    let cands;
    if (this.mode === 'tdm') cands = TEAM_SPAWNS[p.team].map(([x, z]) => new THREE.Vector3(x, 0, z));
    else if (this.mode === 'coop') { const a = others[0] || w.playerSpawn; cands = [0, 1, 2, 3, 4, 5].map(i => a.clone().setY(0).add(new THREE.Vector3(Math.cos(i * 1.05) * 1.6, 0, Math.sin(i * 1.05) * 1.6))); cands.push(w.playerSpawn.clone()); }
    else cands = w.enemySpawns.map(s => s.clone()).concat([w.playerSpawn.clone()]);
    let best = cands[0], bd = -1;
    for (const c of cands) {
      if (this.mode === 'coop') { if (!w.boxes.some(b => c.x > b.min.x - 0.5 && c.x < b.max.x + 0.5 && c.z > b.min.z - 0.5 && c.z < b.max.z + 0.5 && b.max.y > 0.5)) { best = c; break; } continue; }
      const d = others.length ? Math.min(...others.map(o => o.distanceTo(c))) : Math.random() * 10;
      const score = d + Math.random() * 6; if (score > bd) { bd = score; best = c; }
    }
    const yaw = Math.atan2(best.x, best.z); // face the centre of the map
    return { p: best.clone(), y: yaw };
  }
  posOf(id) { if (id === this.myId) return this.g.player.pos; const r = this.remotes.get(id); return r && r.seen ? r.pos : null; }
  startMsg(all = true) {
    return { t: 'st', mode: this.mode, lim: this.lim, pl: this.roster(), sp: Object.fromEntries([...this.players.values()].filter(p => !p.dead).map(p => [p.id, [...A(p.spawn.p), r2(p.spawn.y)]])), tl: this.timeLeft, sc: this.teamScore, wave: this.g.wave || 0, all };
  }
  startMatch() {
    this.teamScore = [0, 0]; this.matchEnd = now() + this.lim.time; this.timeLeft = this.lim.time;
    for (const p of this.players.values()) Object.assign(p, { k: 0, d: 0, s: 0, hp: 100, dead: false, prot: now() + PROTECT, hist: [], hs: 0, shots: 0, hits: 0, respawnAt: 0 });
    for (const p of this.players.values()) { p.spawn = this.pickSpawn(p); p.hist.push({ t: now(), p: p.spawn.p.clone(), c: false }); }
    const m = this.startMsg(); this.net.broadcast(m); this.beginMatch(m);
  }
  beginMatch(m) {
    const g = this.g; this.mode = m.mode; this.lim = m.lim; this.timeLeft = m.tl; this.teamScore = m.sc || [0, 0];
    if (!this.isHost) this.syncPlayers(m.pl.map(([id, name, team, k, d, s]) => ({ id, name, team, k, d, s, dead: false, hp: 100 })));
    for (const r of this.remotes.values()) r.dispose(); this.remotes.clear();
    for (const r of this.ghosts.values()) r.dispose(); this.ghosts.clear();
    this.active = true;
    for (const p of this.players.values()) if (p.id !== this.myId) this.addRemote(p);
    const sp = m.sp[this.myId];
    const me = this.me;
    g.startMP(this.mode, sp ? V(sp) : g.world.playerSpawn.clone(), sp ? sp[3] : 0, this.tintFor(me || { id: this.myId, team: 0 }), this.isHost);
    if (!sp && me) { me.dead = true; g.player.dead = true; g.player.c.root.visible = false; } // joined mid-match: wait for the spawn message
    me && (me.prot = now() + PROTECT);
    document.body.classList.add('mp'); document.body.classList.toggle('pvp', this.mode !== 'coop'); document.body.classList.toggle('coop', this.mode === 'coop');
    $('mpbar').classList.remove('hidden'); $('mpbar').classList.toggle('ffa', this.mode === 'ffa');
    $('chatlog').innerHTML = ''; this.lifeKills = 0;
    g.hud.banner(MODE_NAME[this.mode], this.mode === 'tdm' ? `YOU ARE ON ${TEAM_NAME[me ? me.team : 0]} TEAM` : this.mode === 'ffa' ? `FIRST TO ${this.lim.score} KILLS` : 'SURVIVE TOGETHER', 3);
    this.sendT = 0; this.updateBar();
  }
  addRemote(p) { if (this.remotes.has(p.id) || p.id === this.myId) return; const r = new RemotePlayer(this, p); this.remotes.set(p.id, r); r.plate = document.createElement('div'); r.plate.className = 'np'; $('nameplates').appendChild(r.plate); }
  removeRemote(id) { const r = this.remotes.get(id); if (r) { r.dispose(); this.remotes.delete(id); } }

  // ------------------------------------------------------------------ per-frame + network tick
  startTick() {
    clearInterval(this.tickI); let last = performance.now(), pingT = 0;
    this.tickI = setInterval(() => {
      const t = performance.now(), dt = (t - last) / 1000; last = t;
      if (!this.net) return;
      pingT -= dt;
      if (this.isHost) {
        if (pingT <= 0) { pingT = 1; this.net.checkTimeouts(15000); }
        // background tab: requestAnimationFrame stops, keep simulating the match from here
        if (document.hidden && this.active && this.g.state === 'playing') { let n = Math.min(20, Math.round(dt / 0.05)); while (n-- > 0) this.g.updateGame(0.05); }
        if (this.active) this.hostTick(dt);
      } else {
        if (pingT <= 0) { pingT = 1; this.net.broadcast({ t: 'pi', c: performance.now(), r: this.rtt }); this.net.checkTimeouts(15000); }
        if (this.active) this.sendState();
      }
    }, 50);
  }
  stateOfLocal() {
    const p = this.g.player, c = p.c;
    return { p: A(p.pos), y: r2(c.yaw), pi: r2(c.aimPitch), a: c.currentName, ts: c.current ? r2(c.current.timeScale) : 1, w: c.gunId, f: (p.crouch ? 1 : 0) | (p.aiming ? 2 : 0) | (p.sprint ? 4 : 0) };
  }
  sendState() { const s = this.stateOfLocal(); s.t = 's'; s.r = Math.round(this.rtt); this.net.broadcast(s); }
  hostTick(dt) {
    const t = now(), g = this.g, me = this.me;
    // own history (for validating clients' shots at the host)
    me.hist.push({ t, p: g.player.pos.clone(), c: g.player.crouch }); while (me.hist.length > 40) me.hist.shift();
    me.hp = g.player.health; me.dead = g.player.dead;
    // timer, regen, respawns
    if (this.mode !== 'coop') { this.timeLeft = Math.max(0, this.matchEnd - t); if (this.timeLeft <= 0) return this.endMatch('time'); }
    for (const p of this.players.values()) {
      if (p.id !== this.myId && !p.dead && t - p.lastHurt > 5 && p.hp < 100) p.hp = Math.min(100, p.hp + 14 * dt);
      if (p.dead && this.mode !== 'coop' && p.respawnAt && t >= p.respawnAt) this.respawn(p);
    }
    const ps = [];
    for (const p of this.players.values()) {
      const s = p.id === this.myId ? this.stateOfLocal() : p.state; if (!s || !s.p) continue;
      ps.push([p.id, s.p[0], s.p[1], s.p[2], s.y, s.pi, s.a, s.ts, s.w, s.f, Math.ceil(p.hp), p.dead ? 1 : 0, p.prot > t ? 1 : 0, p.k, p.d, p.s, p.ping]);
    }
    const m = { t: 'sn', tl: Math.round(this.timeLeft), sc: this.teamScore, ps };
    if (this.mode === 'coop') {
      m.wv = g.wave; m.left = Math.max(0, g.waveTotal - g.waveKills);
      m.en = g.enemies.map(e => { if (e.nid == null) e.nid = this.nextNid = (this.nextNid || 0) + 1; const c = e.c; return [e.nid, r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r2(c.yaw), r2(c.aimPitch), c.currentName, c.current ? r2(c.current.timeScale) : 1, e.gunId, e.dead ? 1 : 0]; });
    }
    this.net.broadcast(m); this.updateBar();
  }
  // called from Game.updateGame every frame while a match runs
  update(dt) {
    for (const r of this.remotes.values()) r.update(dt);
    for (const gh of this.ghosts.values()) gh.update(dt);
    this.updatePlates(dt);
    const me = this.me, prot = me && me.prot > now() && !this.g.player.dead;
    $('protect').classList.toggle('hidden', !prot);
    if (this.respawnT > 0) { this.respawnT -= dt; $('respawnT').textContent = Math.max(0, Math.ceil(this.respawnT)); }
    if (!$('scoreboard').classList.contains('hidden')) { this.boardT = (this.boardT || 0) - dt; if (this.boardT <= 0) { this.boardT = 0.25; this.renderBoard(); } }
    if (this.isHost) this.updateBar();
  }
  updateBar() {
    const me = this.me; if (!me) return; const ps = [...this.players.values()];
    if (this.mode === 'tdm') { $('scoreA').textContent = this.teamScore[0]; $('scoreB').textContent = this.teamScore[1]; $('nameA').textContent = me.team === 0 ? 'BLUE · YOU' : 'BLUE'; $('nameB').textContent = me.team === 1 ? 'RED · YOU' : 'RED'; }
    else if (this.mode === 'ffa') { const lead = ps.filter(p => p !== me).sort((a, b) => b.k - a.k)[0]; $('scoreA').textContent = me.k; $('nameA').textContent = 'YOU'; $('scoreB').textContent = lead ? lead.k : 0; $('nameB').textContent = lead ? esc(lead.name).slice(0, 10).toUpperCase() : 'LEADER'; }
    else { $('scoreA').textContent = this.g.wave || 1; $('nameA').textContent = 'WAVE'; $('scoreB').textContent = ps.filter(p => !p.dead).length; $('nameB').textContent = 'ALIVE'; }
    const tl = this.mode === 'coop' ? null : Math.max(0, Math.round(this.timeLeft));
    $('mptimer').textContent = tl == null ? 'CO-OP' : `${(tl / 60) | 0}:${String(tl % 60).padStart(2, '0')}`; $('mptimer').classList.toggle('low', tl != null && tl <= 30);
    this.g.kills = me.k; this.g.score = me.s;
  }
  onSnapshot(m) {
    if (!this.active) return; const t = now(), g = this.g;
    this.timeLeft = m.tl; this.teamScore = m.sc || this.teamScore;
    for (const a of m.ps) {
      const [id, x, y, z, yaw, pi, an, ts, w, f, hp, dead, prot, k, d, s, ping] = a;
      const p = this.players.get(id); if (!p) continue;
      Object.assign(p, { hp, dead: !!dead, prot: prot ? t + 0.2 : 0, k, d, s, ping });
      if (id === this.myId) { if (!g.player.dead && !dead && hp > 0) g.player.health = hp; continue; }
      const r = this.remotes.get(id); if (r) r.push({ p: new THREE.Vector3(x, y, z), y: yaw, pi, a: an, ts, w, f }, t);
    }
    if (m.en) {
      g.wave = m.wv; g.waveTotal = m.left; g.waveKills = 0; const seen = new Set();
      for (const e of m.en) {
        const [nid, x, y, z, yaw, pi, an, ts, gun, dead] = e; seen.add(nid);
        let gh = this.ghosts.get(nid); if (!gh) { gh = new Ghost(this, nid, gun); this.ghosts.set(nid, gh); }
        gh.dead = !!dead; gh.push({ p: new THREE.Vector3(x, y, z), y: yaw, pi, a: an, ts, w: gun, f: 0 }, t);
      }
      for (const [nid, gh] of this.ghosts) if (!seen.has(nid)) { gh.dispose(); this.ghosts.delete(nid); }
      g.enemies = [...this.ghosts.values()];
    }
    this.updateBar();
  }

  // ------------------------------------------------------------------ shooting
  // what the local player's bullets can hit
  targets() {
    const list = [];
    for (const r of this.remotes.values()) { if (!r.seen || r.dead) continue; if (this.mode === 'tdm' && r.team === this.me.team) continue; if (this.mode === 'coop') continue; list.push(r); }
    if (this.mode === 'coop') for (const e of this.g.enemies) list.push(e);
    return list;
  }
  // local player fired (Player.shoot): visuals are already done locally
  localShot(W, origin, muzzle, ends, hits, pellets) {
    const g = this.g, me = this.me; if (me) { me.prot = 0; me.shots++; }
    if (this.isHost) {
      this.net.broadcast({ t: 'fx', id: this.myId, w: W.id, m: A(muzzle), e: ends.map(A) });
      for (const [tg, h] of hits) {
        if (tg instanceof RemotePlayer) {
          const dealt = this.applyDamage(tg.id, h.dmg, this.myId, g.player.pos.clone(), h.head, W.id);
          if (dealt > 0) { const kill = tg.dead; g.hud.hitmarker(h.head, kill); g.sfx.hit(h.head); g.hud.damageNumber(h.point, dealt, h.head); me.hits++; if (h.head) me.hs++; }
        } else if (!tg.dead) { // co-op enemy
          g.lastAttacker = this.myId; tg.damage(h.dmg, h.dir, h.head); g.hud.hitmarker(h.head, tg.dead); g.sfx.hit(h.head); g.hud.damageNumber(h.point, h.dmg, h.head); me.hits++;
        }
      }
    } else {
      const key = (t) => t instanceof RemotePlayer ? 'p' + t.id : 'e' + t.nid;
      this.net.broadcast({ t: 'sh', w: W.id, o: A(origin), m: A(muzzle), e: ends.map(A), h: pellets.map(q => [key(q.t), q.part === 'head' ? 1 : q.part === 'legs' ? 2 : 0, ...A(q.pt), r2(q.dist)]) });
      for (const [, h] of hits) { g.hud.hitmarker(h.head, false); g.sfx.hit(h.head); }
    }
  }
  onClientShot(p, m) {
    if (!this.active || p.dead) return;
    const W = WEAPON_BY_ID[m.w]; if (!W) return; const t = now(), g = this.g;
    const okRate = t - p.lastShot >= W.cool * 0.7; p.lastShot = t; p.prot = 0; p.shots++;
    const rp = this.remotes.get(p.id); if (rp) rp.lastFire = t;
    const fx = { t: 'fx', id: p.id, w: W.id, m: m.m, e: (m.e || []).slice(0, 4) };
    this.net.broadcast(fx, p.pid); this.onFx(fx);
    if (!okRate || !Array.isArray(m.h) || !m.o) return;
    const o = V(m.o), last = p.hist[p.hist.length - 1];
    if (!last || o.distanceTo(last.p.clone().setY(last.p.y + 1.5)) > 4.5) return; // origin must be at the shooter
    const tv = t - (p.ping || 0) / 2000 - INTERP; // when the shooter saw the world
    const agg = new Map(), out = [];
    for (const h of m.h.slice(0, W.pellets)) {
      const [key, part, x, y, z] = h; const pt = new THREE.Vector3(x, y, z);
      const dir = pt.clone().sub(o); const dist = dir.length(); if (dist > 320) continue; dir.normalize();
      const wall = raycastBoxes(g.world.boxes, o, dir, Math.max(0, dist - 0.15)); if (wall) continue; // through a wall
      let victim = null, base = null, crouch = false;
      if (key[0] === 'p') {
        const v = this.players.get(+key.slice(1)); if (!v || v.dead || v.id === p.id) continue;
        let bd = 1e9; for (const s of v.hist) if (s.t >= tv - 0.3 && s.t <= tv + 0.2) { const d = Math.hypot(s.p.x - pt.x, s.p.z - pt.z); if (d < bd) { bd = d; base = s.p; crouch = s.c; } }
        if (!base && v.hist.length) { const s = v.hist[v.hist.length - 1]; base = s.p; crouch = s.c; bd = Math.hypot(s.p.x - pt.x, s.p.z - pt.z); }
        if (!base || bd > 1.3 || pt.y < base.y - 0.3 || pt.y > base.y + 2.1) continue;
        victim = v;
      } else {
        const e = g.enemies.find(q => q.nid === +key.slice(1)); if (!e || e.dead) continue;
        if (Math.hypot(e.pos.x - pt.x, e.pos.z - pt.z) > 1.5) continue; victim = e; base = e.pos; crouch = e.crouch;
      }
      const head = part === 1 && pt.y - base.y > (crouch ? 0.8 : 1.25);
      const mul = (head ? W.head : part === 2 ? W.legs : 1) * falloff(W, dist);
      const a = agg.get(victim) || { dmg: 0, head: false, pt, dir }; a.dmg += W.dmg * mul; a.head = a.head || head; agg.set(victim, a);
    }
    for (const [v, a] of agg) {
      let dealt = 0, kill = false;
      if (v.hist) { dealt = this.applyDamage(v.id, a.dmg, p.id, last.p.clone(), a.head, W.id); kill = v.dead; }
      else { g.lastAttacker = p.id; dealt = a.dmg; v.damage(a.dmg, a.dir, a.head); kill = v.dead; }
      if (dealt > 0) { p.hits++; if (a.head) p.hs++; out.push([...A(a.pt), Math.round(dealt), a.head ? 1 : 0, kill ? 1 : 0]); }
    }
    if (out.length) this.net.send(p.pid, { t: 'ht', l: out });
  }
  onHitConfirm(m) {
    const g = this.g;
    for (const [x, y, z, d, h, k] of m.l) { if (k) g.hud.hitmarker(!!h, true); g.hud.damageNumber(new THREE.Vector3(x, y, z), d, !!h); }
    if (this.me) this.me.hits += m.l.length;
  }
  // remote muzzle flash + tracers + sound
  onFx(m) {
    if (!this.active) return; const g = this.g;
    const src = m.id != null ? this.remotes.get(m.id) : this.ghosts.get(m.en); if (m.id === this.myId) return;
    const W = WEAPON_BY_ID[m.w]; const mz = src && src.seen ? src.c.muzzle.getWorldPosition(new THREE.Vector3()) : V(m.m);
    if (src) src.lastFire = now();
    const ends = (m.e || []).map(V);
    const dir = ends.length ? ends[0].clone().sub(mz).normalize() : new THREE.Vector3(0, 0, -1);
    if (src && src.seen) g.fx.muzzleFlash(src.c.muzzle, dir, false, W ? W.flash : 1);
    g.sfx.gunshot(mz, m.en != null ? 0.85 : 1, m.s || (W ? W.sound : 'rifle'));
    ends.forEach((e, i) => {
      g.fx.tracer(mz, e, true);
      if (i < 2) { const d = e.clone().sub(mz); const len = d.length(); d.normalize(); const hit = raycastBoxes(g.world.boxes, mz, d, len + 0.3); if (hit && hit.t > len - 0.6) g.fx.impact(hit.point, hit.normal, hit.box.mat); }
    });
    // bullet passing close to me
    if (ends.length && !g.player.dead) {
      const c = g.player.chest(), seg = ends[0].clone().sub(mz), L = seg.length(); seg.normalize();
      const tt = Math.max(0, Math.min(L, c.clone().sub(mz).dot(seg))), cp = mz.clone().addScaledVector(seg, tt);
      if (cp.distanceTo(c) < 1.6 && cp.distanceTo(c) > 0.3) g.sfx.whiz(cp);
    }
  }
  // co-op: an enemy fired (host) -> clients draw it
  enemyFx(e, muzzle, end) { if (this.active && this.isHost) this.net.broadcast({ t: 'fx', en: e.nid, w: e.gunId, s: e.sound, m: A(muzzle), e: [A(end)] }); }

  // ------------------------------------------------------------------ damage, kills, respawns (host authority)
  applyDamage(vid, amount, aid, fromPos, head, wid) {
    if (!this.active || !this.isHost) return 0;
    const v = this.players.get(vid), t = now(); if (!v || v.dead || v.prot > t || amount <= 0) return 0;
    const a = this.players.get(aid);
    if (a && a !== v && (this.mode === 'coop' || (this.mode === 'tdm' && a.team === v.team))) return 0; // no friendly fire
    v.lastHurt = t;
    if (vid === this.myId) {
      this.pendingKill = { aid, head, wid }; this.g.player.damage(amount, fromPos || this.g.player.pos); v.hp = this.g.player.health;
      if (this.g.player.dead && !v.dead) this.kill(aid, vid, wid, head);
    } else {
      v.hp = Math.max(0, v.hp - amount);
      this.net.send(v.pid, { t: 'dm', hp: Math.ceil(v.hp), f: A(fromPos || new THREE.Vector3()) });
      if (v.hp <= 0) this.kill(aid, vid, wid, head);
    }
    return amount;
  }
  kill(aid, vid, wid, head) {
    const v = this.players.get(vid), a = this.players.get(aid), t = now();
    v.dead = true; v.hp = 0; v.d++; v.respawnAt = t + RESPAWN;
    let pts = 0;
    if (a && a !== v) { pts = 100 + (head ? 50 : 0); a.k++; a.s += pts; if (this.mode === 'tdm') this.teamScore[a.team]++; }
    const pos = this.posOf(vid);
    const m = { t: 'kl', k: a ? a.id : -1, v: vid, w: wid || '', h: head ? 1 : 0, pts, dp: pos && Math.random() < 0.7 ? A(pos) : null, ks: a ? [a.k, a.d, a.s] : null, vs: [v.k, v.d, v.s], sc: this.teamScore };
    this.net.broadcast(m); this.onKill(m);
    if (this.mode === 'coop') return this.checkCoopWipe();
    const lim = this.lim.score;
    if (this.mode === 'tdm' && Math.max(...this.teamScore) >= lim) this.endMatch('score');
    else if (this.mode === 'ffa' && a && a.k >= lim) this.endMatch('score');
  }
  // co-op: hostile killed by someone (Game.onEnemyKilled on the host)
  onEnemyKilled(e, head) {
    const a = this.players.get(this.g.lastAttacker) || this.me; const pts = 100 + (head ? 50 : 0) + (this.g.wave || 1) * 10;
    a.k++; a.s += pts;
    const m = { t: 'kl', k: a.id, e: 1, w: this.g.lastAttackerW || (a.id === this.myId ? this.g.player.weapon.id : (a.state && a.state.w) || ''), h: head ? 1 : 0, pts, dp: Math.random() < 0.6 ? A(e.pos) : null, ks: [a.k, a.d, a.s] };
    this.net.broadcast(m); this.onKill(m);
  }
  onKill(m) {
    const g = this.g, me = this.myId; const kp = this.players.get(m.k), vp = m.v != null ? this.players.get(m.v) : null;
    if (kp && m.ks) [kp.k, kp.d, kp.s] = m.ks; if (vp && m.vs) { [vp.k, vp.d, vp.s] = m.vs; vp.dead = true; }
    if (m.sc) this.teamScore = m.sc;
    const cls = (p) => !p ? 'foe' : this.mode === 'tdm' ? TEAM_CLS[p.team] : p.id === me ? 'you' : 'ffa';
    const nm = (p, fb) => p ? (p.id === me ? 'YOU' : esc(p.name)) : fb;
    g.hud.feed(`<span class="${cls(kp)}">${nm(kp, 'HOSTILE')}</span>`, m.w, !!m.h, `<span class="${m.e ? 'foe' : cls(vp)}">${m.e ? 'HOSTILE' : nm(vp, '?')}</span>`, m.k === me ? m.pts : 0);
    if (m.k === me && m.pts) { g.hud.onLocalKill(m.pts, !!m.h); this.lifeKills = (this.lifeKills || 0) + 1; }
    if (m.v === me) {
      this.lifeKills = 0; g.hud.resetStreak();
      if (!g.player.dead) g.player.damage(9999, kp ? (this.posOf(kp.id) || g.player.pos).clone() : g.player.pos.clone());
      $('killedby').textContent = kp ? kp.name : 'HOSTILES'; this.respawnT = this.mode === 'coop' ? 0 : RESPAWN;
      $('respawn').querySelector('div').classList.toggle('hidden', this.mode === 'coop');
      $('respawn').querySelector('small').textContent = this.mode === 'coop' ? 'YOU ARE DOWN · RESPAWN NEXT WAVE · KILLED BY' : 'YOU WERE ELIMINATED BY';
      $('respawn').classList.remove('hidden');
    }
    if (m.dp) g.pickups.spawn(V(m.dp));
    this.updateBar();
  }
  respawn(p) {
    const s = this.pickSpawn(p); Object.assign(p, { dead: false, hp: 100, prot: now() + PROTECT, respawnAt: 0 });
    p.hist.push({ t: now(), p: s.p.clone(), c: false });
    const m = { t: 'sp', id: p.id, p: A(s.p), y: r2(s.y) }; this.net.broadcast(m); this.onSpawn(m);
  }
  onSpawn(m) {
    const p = this.players.get(m.id); if (p) { p.dead = false; p.hp = 100; p.prot = now() + PROTECT; }
    if (m.id === this.myId) { this.g.player.respawn(V(m.p), m.y); $('respawn').classList.add('hidden'); this.respawnT = 0; if (this.g.touch) this.g.touch.reset(); }
    else { const r = this.remotes.get(m.id); if (r) { r.buf.length = 0; r.pos.copy(V(m.p)); } }
  }
  // host: local death is handled in applyDamage; client: wait for the host's kill/spawn messages
  onLocalDeath() { if (!this.isHost && this.me) this.me.dead = true; }
  onLocalDamage(m) {
    const p = this.g.player; if (p.dead) return;
    const d = p.health - m.hp; if (d > 0) p.damage(d, V(m.f)); if (this.me) this.me.hp = m.hp;
  }
  // co-op
  coopTarget(e) {
    if (e._tgt && e._tgtT > now() && !e._tgt.dead) return e._tgt;
    let best = this.localProxy, bd = this.localProxy.dead ? 1e9 : e.pos.distanceTo(this.g.player.pos);
    for (const r of this.remotes.values()) { if (r.dead || !r.seen) continue; const d = e.pos.distanceTo(r.pos); if (d < bd) { bd = d; best = r; } }
    e._tgt = best; e._tgtT = now() + 1; return best;
  }
  anyAlive() { return [...this.players.values()].some(p => !p.dead); }
  checkCoopWipe() { if (this.mode === 'coop' && this.active && this.isHost && !this.anyAlive()) this.endMatch('wipe'); }
  onWaveStart() { // host: revive the fallen next to a survivor, top everyone up
    if (!this.isHost) return;
    for (const p of this.players.values()) { if (p.dead) this.respawn(p); else if (p.id !== this.myId) p.hp = Math.min(100, p.hp + 40); }
    this.banner('WAVE ' + this.g.wave, `${this.g.waveTotal} HOSTILES INBOUND`, true);
  }
  banner(a, b, wave) { if (this.isHost && this.active) this.net.broadcast({ t: 'bn', a, b, wave: wave ? 1 : 0 }); }
  onWave() { this.g.player.addAmmo(2); }
  coopWaveSize(w) { return 3 + w * 2 + (this.players.size - 1) * 2; }

  // ------------------------------------------------------------------ end of match
  endMatch(reason) {
    if (!this.active) return; const ps = [...this.players.values()];
    let title, sub, win = null;
    if (this.mode === 'tdm') { const [a, b] = this.teamScore; win = a === b ? -1 : a > b ? 0 : 1; title = win < 0 ? 'DRAW' : `${TEAM_NAME[win]} TEAM WINS`; sub = `${a} – ${b}` + (reason === 'time' ? ' · TIME' : ''); }
    else if (this.mode === 'ffa') { const top = ps.slice().sort((x, y) => y.k - x.k || y.s - x.s)[0]; win = top.id; title = `${top.name.toUpperCase()} WINS`; sub = `${top.k} KILLS` + (reason === 'time' ? ' · TIME' : ''); }
    else { title = 'SQUAD WIPED'; sub = `WAVE ${this.g.wave} REACHED`; }
    const m = { t: 'end', ti: title, sub, win, mode: this.mode, rows: ps.map(p => [p.id, p.name, p.team, p.k, p.d, p.s, p.hs, p.shots ? Math.round(p.hits / p.shots * 100) : 0]) };
    this.net.broadcast(m); this.onEnd(m);
  }
  onEnd(m) {
    const g = this.g; if (!this.active) return; this.active = false;
    for (const p of this.players.values()) p.ready = false;
    if (this.me) this.me.ready = this.isHost;
    const mine = m.rows.find(r => r[0] === this.myId) || [];
    const won = m.mode === 'tdm' ? (this.me && m.win === this.me.team) : m.mode === 'ffa' ? m.win === this.myId : false;
    g.endMP({ title: m.ti, sub: m.sub, won, rows: m.rows, myId: this.myId, mode: m.mode, mine });
    this.teardownMatch();
  }
  teardownMatch() {
    for (const r of this.remotes.values()) r.dispose(); this.remotes.clear();
    for (const r of this.ghosts.values()) r.dispose(); this.ghosts.clear();
    if (!this.isHost) this.g.enemies = [];
    $('mpbar').classList.add('hidden'); $('scoreboard').classList.add('hidden'); $('respawn').classList.add('hidden'); $('protect').classList.add('hidden'); $('quickchat').classList.add('hidden'); this.closeChat();
    $('nameplates').innerHTML = ''; document.body.classList.remove('mp', 'pvp', 'coop');
  }
  backToLobby() { this.g.toMenu(true); this.showLobby(); if (this.isHost) this.broadcastLobby(); }
  // leave the room (or close it, as host)
  leave() {
    if (!this.role) { this.g.toMenu(); return; }
    this.leaving = true;
    try { this.net.broadcast(this.isHost ? { t: 'closed' } : { t: 'bye' }); } catch (e) {}
    const n = this.net; if (n) n.onClose = null; setTimeout(() => n && n.close(), 150); this.net = null;
    this.cleanup(); this.leaving = false; this.g.toMenu();
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname + (this.keepParams() ? '?' + this.keepParams().slice(1) : ''));
  }
  cleanup() {
    clearInterval(this.tickI); if (this.active) { this.active = false; } this.teardownMatch();
    if (this.net) { this.net.close(); this.net = null; }
    this.role = null; this.players.clear(); this.myId = -1; this.rtt = 0;
  }

  // ------------------------------------------------------------------ nameplates, scoreboard, chat, radar
  updatePlates(dt) {
    const g = this.g, cam = g.camera, w = innerWidth, h = innerHeight, me = this.me; if (!me) return;
    this.occT = (this.occT || 0) - dt; const occ = this.occT <= 0; if (occ) this.occT = 0.12;
    const v = new THREE.Vector3();
    for (const r of this.remotes.values()) {
      const el = r.plate; if (!el) continue;
      const p = r.info; const friend = this.mode !== 'ffa' && p.team === me.team;
      if (!r.seen || p.dead) { el.style.display = 'none'; continue; }
      const head = r.pos.clone(); head.y += r.crouch ? 1.55 : 2.05;
      const dist = head.distanceTo(cam.position);
      if (occ) {
        const d = head.clone().sub(cam.position); const L = d.length(); d.normalize();
        r.occluded = !!raycastBoxes(g.world.boxes, cam.position, d, L - 0.3);
      }
      v.copy(head).project(cam);
      const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (friend || (!r.occluded && dist < 70));
      if (!show) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const cls = 'np ' + (this.mode === 'tdm' ? TEAM_CLS[p.team] : this.mode === 'coop' ? 'blue' : 'ffa') + (p.prot > now() ? ' prot' : '');
      if (el.className !== cls) el.className = cls;
      const html = `${esc(p.name)}<i><b style="width:${Math.max(0, Math.min(100, p.hp | 0))}%"></b></i>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%) scale(${Math.max(0.7, Math.min(1, 14 / dist)).toFixed(2)})`;
    }
  }
  radarDots() {
    const out = [], me = this.me; if (!me) return out; const t = now();
    for (const r of this.remotes.values()) {
      if (!r.seen || r.dead) continue; const friend = this.mode !== 'ffa' && r.team === me.team;
      if (friend) out.push({ pos: r.pos, color: '#4aa3ff' }); else if (t - r.lastFire < 2) out.push({ pos: r.pos, color: '#ff3b30', pulse: true });
    }
    return out;
  }
  toggleBoard(on) { const el = $('scoreboard'); const show = on == null ? el.classList.contains('hidden') : on; el.classList.toggle('hidden', !show); if (show) this.renderBoard(); }
  renderBoard() {
    const ps = [...this.players.values()].sort((a, b) => b.s - a.s || b.k - a.k), me = this.myId;
    const table = (list, cap, cls) => `<table class="${cls || ''}">${cap ? `<caption>${cap}</caption>` : ''}<tr><th>PLAYER</th><th>K</th><th>D</th><th>SCORE</th><th>PING</th></tr>${list.map(p => `<tr class="${p.id === me ? 'me' : ''}${p.dead ? ' dead' : ''}"><td>${esc(p.name)}${p.id === 0 ? ' ★' : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.s}</td><td>${p.id === 0 ? '–' : p.ping | 0}</td></tr>`).join('')}</table>`;
    const tl = Math.round(this.timeLeft), head = `<h2>${MODE_NAME[this.mode]}<small>${this.mode === 'coop' ? 'WAVE ' + (this.g.wave || 1) : `${(tl / 60) | 0}:${String(tl % 60).padStart(2, '0')} · LIMIT ${this.lim.score}`} · ROOM ${this.code}</small></h2>`;
    $('scoreboard').innerHTML = head + (this.mode === 'tdm'
      ? `<div class="sbcols">${[0, 1].map(t => table(ps.filter(p => p.team === t), `${TEAM_NAME[t]} · ${this.teamScore[t]}`, TEAM_CLS[t])).join('')}</div>`
      : `<div class="sbcols one">${table(ps)}</div>`);
  }
  openChat() { if (!this.active) return; $('chatbox').classList.remove('hidden'); $('chatin').value = ''; $('chatin').focus(); this.g.input.keys = {}; }
  closeChat() { $('chatbox').classList.add('hidden'); $('chatin').blur(); }
  get chatOpen() { return !$('chatbox').classList.contains('hidden'); }
  sendChat(text) {
    text = String(text).slice(0, 80); if (!text || !this.net) return;
    if (this.isHost) this.chat(this.myId, text); else this.net.broadcast({ t: 'ch', m: text });
  }
  chat(id, text) { const m = { t: 'ch', id, m: text }; this.net.broadcast(m); this.addChat(id, text); }
  sysChat(text) { if (!this.net) return; const m = { t: 'ch', id: -1, m: text, sys: 1 }; this.net.broadcast(m); this.addChat(-1, text, true); }
  addChat(id, text, sys) {
    const log = $('chatlog'), d = document.createElement('div'), p = this.players.get(id);
    if (sys) { d.className = 'sys'; d.textContent = text; }
    else { d.className = this.mode === 'tdm' && p ? TEAM_CLS[p.team] : 'ffa'; const b = document.createElement('b'); b.textContent = (p ? p.name : '?') + ':'; d.appendChild(b); d.appendChild(document.createTextNode(' ' + text)); }
    log.appendChild(d); while (log.children.length > 5) log.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 8000); setTimeout(() => d.remove(), 9000);
    if (!sys) this.g.sfx.ui('notify');
    (window.__chat = window.__chat || []).push((p ? p.name : 'sys') + ': ' + text);
  }
}

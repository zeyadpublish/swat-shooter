// v1.5 campaign: 10 missions over the three maps. Objectives run in sequence (clear the area, survive waves,
// eliminate a high-value target, reach extraction, defend a point). Up to 3 stars per mission (complete, beat the
// par time, finish with 50+ HP); clearing a mission unlocks the next. Progress lives in localStorage ('swat-prog').
import * as THREE from 'three';
import { prog, save, fmt } from './prog.js';
import { MAP_BY_ID } from './maps.js';

export const MISSIONS = [
  { id: 'c1', map: 'city', name: 'FIRST RESPONSE', lvl: 1, par: 150, coins: 150, xp: 600, obj: [{ t: 'kill', n: 8 }], brief: 'An armed crew has taken the downtown crossroads. Move in from the south and clear every hostile.' },
  { id: 'c2', map: 'city', name: 'HOLD THE LINE', lvl: 2, par: 240, coins: 200, xp: 800, obj: [{ t: 'waves', n: 3 }], brief: 'Reinforcements are converging on the intersection. Hold your ground for three assault waves.' },
  { id: 'c3', map: 'city', name: 'HIGH VALUE', lvl: 3, par: 180, coins: 250, xp: 900, obj: [{ t: 'hvt' }], brief: 'The crew\'s leader is holed up in the north-west building with his guards. Take him down.' },
  { id: 'c4', map: 'city', name: 'LAST OUT', lvl: 4, par: 200, coins: 300, xp: 1000, obj: [{ t: 'kill', n: 6 }, { t: 'reach', at: 'extract' }], brief: 'Break the ambush, then fight your way to the parking lot for extraction.' },
  { id: 'd1', map: 'desert', name: 'DUST MARKET', lvl: 3, par: 180, coins: 300, xp: 1000, obj: [{ t: 'kill', n: 10 }], brief: 'Insurgents are using the covered market as a staging area. Sweep the town and clear them out.' },
  { id: 'd2', map: 'desert', name: 'HOLD THE SQUARE', lvl: 4, par: 150, coins: 350, xp: 1100, obj: [{ t: 'defend', at: 'defend', secs: 60 }], brief: 'Hold the market square until the convoy is through. Stay inside the zone; the clock only runs while you hold it.' },
  { id: 'd3', map: 'desert', name: 'SANDSTORM EXFIL', lvl: 5, par: 240, coins: 400, xp: 1300, obj: [{ t: 'hvt' }, { t: 'reach', at: 'extract' }], brief: 'Find the bomb maker in the north-west house, eliminate him and get to the south-west gate before the storm.' },
  { id: 'b1', map: 'base', name: 'PERIMETER BREACH', lvl: 5, par: 300, coins: 400, xp: 1300, obj: [{ t: 'waves', n: 4 }], brief: 'Hostiles have cut through the fence. Hold the base against four waves until the quick-reaction force arrives.' },
  { id: 'b2', map: 'base', name: 'HANGAR SWEEP', lvl: 6, par: 220, coins: 450, xp: 1500, obj: [{ t: 'kill', n: 14 }], brief: 'Infiltrators are hiding among the hangars and containers. Sweep the base and clear all of them.' },
  { id: 'b3', map: 'base', name: 'FINAL STAND', lvl: 7, par: 260, coins: 600, xp: 2000, obj: [{ t: 'defend', at: 'defend', secs: 75 }, { t: 'reach', at: 'extract' }], brief: 'Secure the helipad for the evacuation flight, then board when it lands. This is the last one.' },
];
export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map(m => [m.id, m]));
export const objText = (o) => o.t === 'kill' ? `Clear the area (${o.n} hostiles)` : o.t === 'waves' ? `Survive ${o.n} waves` : o.t === 'hvt' ? 'Eliminate the high-value target' : o.t === 'reach' ? 'Reach the extraction point' : `Defend the zone for ${o.secs} s`;
export const camp = () => { const P = prog(); P.camp = P.camp || {}; return P.camp; }; // { missionId: bestStars }
export const unlocked = (i) => i === 0 || (camp()[MISSIONS[i - 1].id] || 0) > 0;

const $ = (id) => document.getElementById(id);
export class Campaign {
  constructor(g) {
    this.g = g; this.cur = null;
    // world-space objective marker: a gold light column + ground ring
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 16, 1, true), mat); this.beam.position.y = 20;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.0, 48), mat.clone()); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.06;
    this.marker = new THREE.Group(); this.marker.add(this.beam, this.ring); this.marker.visible = false; g.scene.add(this.marker);
  }
  get step() { return this.cur ? this.cur.obj[this.si] : null; }
  start(id) {
    const m = MISSION_BY_ID[id]; if (!m) return;
    this.cur = m; this.g.setMap(m.map); this.g.startGame();
  }
  // called by startGame when a mission is active
  begin() {
    const g = this.g; this.si = -1; this.t0 = g.time; this.done = false; this.kills = 0; this.hvt = null;
    g.wave = this.cur.lvl; document.body.classList.add('campaign');
    g.hud.banner(this.cur.name, MAP_BY_ID[this.cur.map].name, 3);
    this.next();
  }
  next() {
    const g = this.g; this.si++; const o = this.step;
    if (!o) { this.finish(true); return; }
    this.cnt = 0; this.spawned = 0; this.spawnT = 1.2; this.hold = 0; this.waves = 0;
    if (this.si > 0) g.hud.banner('OBJECTIVE', objText(o).toUpperCase(), 2.5);
    if (o.t === 'waves') { g.wave = 0; this.wavesMode = true; g.nextWave(); } else this.wavesMode = false;
    if (o.t === 'hvt') {
      const P = g.world.points; const e = g.spawnEnemy(P.hvt, 'merc3'); e.hp = 360; e.hvt = true; e.state = 'patrol'; e.alerted = false; this.hvt = e;
      for (const [x, z] of P.hvtGuard) g.spawnEnemy(new THREE.Vector3(x, 0, z));
    }
    this.updatePanel();
  }
  // objective point in world space (for the minimap + marker)
  radarPoint() {
    const o = this.step; if (!o || this.done) return null;
    if (o.t === 'hvt') return this.hvt && !this.hvt.dead ? this.hvt.pos : null;
    if (o.at) return this.g.world.points[o.at];
    return null;
  }
  onKill(e) { if (!this.cur || this.done) return; this.kills++; const o = this.step; if (!o) return; if (o.t === 'kill') this.cnt++; if (o.t === 'hvt' && e === this.hvt) { this.g.hud.toast && this.g.hud.toast('TARGET ELIMINATED'); this.cnt = 1; } }
  // the wave system reports a cleared wave; returns true when the campaign handles what happens next
  onWaveCleared() { const o = this.step; if (!o || o.t !== 'waves') return false; this.waves = this.g.wave; if (this.waves >= o.n) { this.next(); return true; } return false; }
  update(dt) {
    const g = this.g, o = this.step; if (!o || this.done) return;
    const p = g.player, alive = g.enemies.filter(e => !e.dead).length;
    // spawning (the waves objective uses the regular wave director)
    if (o.t !== 'waves') {
      const cap = o.t === 'kill' ? Math.min(6, 2 + this.cur.lvl) : o.t === 'hvt' ? 3 : 4 + (this.cur.lvl > 4 ? 1 : 0);
      const total = o.t === 'kill' ? o.n : o.t === 'hvt' ? 6 : 999;
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.spawned < total && alive < cap) { g.spawnEnemy(); this.spawned++; this.spawnT = o.t === 'kill' ? 1.4 : 3.2; }
    }
    if (o.t === 'kill' && this.cnt >= o.n) this.next();
    else if (o.t === 'hvt' && this.cnt >= 1) this.next();
    else if (o.t === 'reach' && !p.dead && p.pos.distanceTo(g.world.points[o.at]) < 4) this.next();
    else if (o.t === 'defend') { if (!p.dead && p.pos.distanceTo(g.world.points[o.at]) < 8) this.hold += dt; if (this.hold >= o.secs) this.next(); }
    // marker
    const pt = this.radarPoint(); this.marker.visible = !!pt && !this.done;
    if (pt) { this.marker.position.set(pt.x, o.t === 'hvt' ? pt.y : 0, pt.z); this.ring.visible = o.t !== 'hvt'; const d = p.pos.distanceTo(pt); this.beam.material.opacity = THREE.MathUtils.clamp(d / 30, 0.12, 0.34); this.beam.material.color.set(o.t === 'hvt' ? 0xff5a4a : 0xffd25a); }
    this.updatePanel();
  }
  updatePanel() {
    const o = this.step, el = $('objective'); if (!el) return;
    if (!o || this.done) { el.classList.add('hidden'); return; }
    let prog = '';
    if (o.t === 'kill') prog = `${this.cnt} / ${o.n}`;
    else if (o.t === 'waves') prog = `WAVE ${Math.max(1, this.g.wave)} / ${o.n}`;
    else if (o.t === 'hvt') prog = this.hvt && !this.hvt.dead ? `${Math.round(this.g.player.pos.distanceTo(this.hvt.pos))} m` : '';
    else if (o.t === 'reach') prog = `${Math.round(this.g.player.pos.distanceTo(this.g.world.points[o.at]))} m`;
    else if (o.t === 'defend') prog = `${Math.floor(this.hold)} / ${o.secs} s`;
    const html = `<small>OBJECTIVE ${this.si + 1}/${this.cur.obj.length}</small><b>${objText(o).toUpperCase()}</b><span>${prog}</span>` + (o.t === 'defend' ? `<i style="width:${(this.hold / o.secs * 100).toFixed(1)}%"></i>` : '');
    if (html !== this.lastHtml) { el.innerHTML = html; this.lastHtml = html; }
    el.classList.remove('hidden');
  }
  stars(win) { if (!win) return 0; const g = this.g, t = g.time - this.t0; return 1 + (t <= this.cur.par ? 1 : 0) + (g.player.health >= 50 ? 1 : 0); }
  finish(win) {
    if (this.done) return; this.done = true; this.win = win; this.marker.visible = false; $('objective') && $('objective').classList.add('hidden');
    const g = this.g, m = this.cur, C = camp(), first = win && !C[m.id], st = this.stars(win);
    this.result = { win, stars: st, time: g.time - this.t0, first, coins: 0, xp: 0 };
    if (win) {
      const k = first ? 1 : 0.3; this.result.coins = Math.round(m.coins * k); this.result.xp = Math.round(m.xp * k);
      g.earn.mission = { name: m.name, coins: this.result.coins, xp: this.result.xp }; g.reward(this.result.coins, this.result.xp);
      C[m.id] = Math.max(C[m.id] || 0, st); save();
    }
    if (win) { g.hud.banner('MISSION COMPLETE', '★'.repeat(st) + '☆'.repeat(3 - st), 2.5); g.gameOverT = 2.6; g.sfx.ui('select'); }
    else g.gameOverT = Math.max(g.gameOverT, 0.01);
  }
  nextMission() { const i = MISSIONS.indexOf(this.cur); return MISSIONS[i + 1] && unlocked(i + 1) ? MISSIONS[i + 1] : null; }
  stop() { this.cur = null; this.done = false; this.marker.visible = false; document.body.classList.remove('campaign'); $('objective') && $('objective').classList.add('hidden'); }
}

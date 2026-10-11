// Multiplayer AI bots (v1.4). Bots are ordinary entries in the host's player list (bot: true, no peer), so clients see
// them as regular players through the normal snapshots, scoreboard and kill feed. Only the host runs their brains:
// perception (line of sight), A* navigation on the city grid, strafing / crouching while fighting, burst fire with
// difficulty-scaled accuracy and reaction time. Damage goes through MP.applyDamage, so kills, scores and respawns
// follow the same host-authoritative rules as human players.
import * as THREE from 'three';
import { resolveCircle, lineOfSight, raycastBoxes, groundHeight } from './physics.js';
import { GAIT_SPEED } from './character.js';
import { angDiff, fwdVec, rightVec } from './player.js';
import { WEAPON_BY_ID, falloff } from './weapons.js';

export const BOT_DIFF = {
  easy: { acc: 0.2, react: 0.95, turn: 4, head: 0.05, dmg: 0.7, see: 45 },
  normal: { acc: 0.33, react: 0.6, turn: 6, head: 0.1, dmg: 0.85, see: 55 },
  hard: { acc: 0.48, react: 0.32, turn: 9, head: 0.18, dmg: 1, see: 65 },
};
export const BOT_NAMES = ['Viper', 'Ghost', 'Hawk', 'Reaper', 'Nomad', 'Raven', 'Cobra', 'Wolf', 'Saber', 'Brick', 'Echo', 'Dozer'];
const GUNS = [['m4a1', 0.36], ['akm', 0.36], ['shotgun', 0.14], ['svd', 0.14]];
const now = () => performance.now() / 1000;

export function pickBotGun() { let r = Math.random(); for (const [id, w] of GUNS) { if ((r -= w) <= 0) return id; } return 'm4a1'; }

export class Bot {
  constructor(mp, info) {
    this.mp = mp; this.g = mp.g; this.id = info.id; this.isBot = true; this.isPlayer = true;
    this.c = this.g.factory.create({ tint: mp.tintFor(info) }); this.g.scene.add(this.c.root); this.c.root.visible = false;
    this.gunId = info.gun || pickBotGun(); this.W = WEAPON_BY_ID[this.gunId]; this.c.setGun(this.gunId);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.radius = 0.36; this.crouch = false; this.seen = false;
    this.lastFire = -9; this.path = null; this.pathT = 0; this.percT = 0; this.target = null; this.canSee = false; this.react = 0;
    this.shotT = 0; this.burst = 0; this.tactic = 'hold'; this.tacticT = 0; this.strafeDir = 1; this.mag = this.W.mag; this.reloadT = 0;
    this.lastSeenPos = null; this.lastSeenT = -99; this.deathPlayed = false; this.stuckT = 0; this.lastPhase = 0;
  }
  get info() { return this.mp.players.get(this.id) || {}; }
  get dead() { return !!this.info.dead; }
  get team() { return this.info.team; }
  get diff() { return BOT_DIFF[this.mp.botDiff] || BOT_DIFF.normal; }
  chest() { return this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 0.85 : 1.3, 0)); }
  head() { return this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 1.05 : 1.55, 0)); }
  spawn(p, yaw) {
    this.pos.copy(p); this.c.yaw = yaw || 0; this.c.root.position.copy(p); this.c.root.visible = true; this.seen = true;
    this.deathPlayed = false; this.path = null; this.target = null; this.mag = this.W.mag; this.reloadT = 0; this.crouch = false; this.react = 0.6;
    this.c.aimPitch = 0; this.c.play('idle', { fade: 0 });
  }
  onHurt(fromPos) { // turn toward whoever is shooting
    if (this.dead) return; this.lastSeenPos = fromPos.clone(); this.lastSeenT = now() - 1; this.react = Math.min(this.react, this.diff.react * 0.6);
  }
  // hostile, alive players: local host player, remote humans and other bots
  hostiles() {
    const mp = this.mp, me = this.info, out = [];
    for (const p of mp.players.values()) {
      if (p.id === this.id || p.dead || p.prot > now()) continue;
      if (mp.mode === 'tdm' && p.team === me.team) continue;
      const pos = mp.posOf(p.id); if (!pos) continue;
      out.push({ id: p.id, pos, chest: () => pos.clone().add(new THREE.Vector3(0, mp.crouchOf(p.id) ? 0.85 : 1.3, 0)), vel: mp.velOf(p.id) });
    }
    return out;
  }
  update(dt) {
    const g = this.g, c = this.c, D = this.diff;
    if (this.dead) {
      if (!this.deathPlayed) { this.deathPlayed = true; c.aimPitch = 0; c.upperTarget = 0; c.play(['death from the front', 'death from the back', 'death from right'][(Math.random() * 3) | 0], { fade: 0.15, once: true }); }
      c.update(dt); return;
    }
    if (!this.seen) return;
    // perception (5 Hz): nearest visible hostile, else remember the last sighting
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.2; let best = null, bd = 1e9; const eye = this.head(), fw = fwdVec(c.yaw);
      for (const h of this.hostiles()) {
        const d = h.pos.distanceTo(this.pos); if (d > D.see || d >= bd) continue;
        const dir = h.pos.clone().sub(this.pos).setY(0).normalize();
        if (fw.dot(dir) < -0.2 && d > 8 && !(this.target && this.target.id === h.id)) continue; // behind me
        const veh = this.mp.vehicleOf(h.id); // a driver is seen through his vehicle (bullets then hit the armour)
        if (!lineOfSight(veh ? g.world.boxes.filter(b => b.owner !== veh) : g.world.boxes, eye, h.chest())) continue;
        best = h; bd = d;
      }
      const was = this.canSee; this.canSee = !!best;
      if (best) { if (!was || !this.target || this.target.id !== best.id) this.react = D.react * (0.8 + Math.random() * 0.5); this.target = best; this.lastSeenPos = best.pos.clone(); this.lastSeenT = now(); }
      else if (this.target && now() - this.lastSeenT > 3) this.target = null;
    }
    let speed = 0, anim = 'idle', ts = 1; const before = this.pos.clone();
    const tgt = this.canSee ? this.target : null;
    if (tgt) {
      const to = tgt.pos.clone().sub(this.pos), dist = Math.hypot(to.x, to.z);
      c.yaw += angDiff(Math.atan2(-to.x, -to.z), c.yaw) * Math.min(1, dt * D.turn);
      this.tacticT -= dt;
      if (this.tacticT <= 0) {
        const r = Math.random(); this.tactic = r < 0.35 ? 'hold' : r < 0.75 ? 'strafe' : 'crouch'; this.tacticT = 1.2 + Math.random() * 1.8; this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        if (dist > (this.gunId === 'shotgun' ? 10 : 26) && Math.random() < 0.6) this.tactic = 'advance';
        if (this.gunId === 'svd' && this.tactic === 'advance') this.tactic = 'crouch';
      }
      this.crouch = this.tactic === 'crouch';
      if (this.tactic === 'strafe') { speed = GAIT_SPEED.walk * 1.2; this.pos.addScaledVector(rightVec(c.yaw), this.strafeDir * speed * dt); anim = this.strafeDir > 0 ? 'walk right' : 'walk left'; }
      else if (this.tactic === 'advance') { speed = GAIT_SPEED.walk * 1.3; this.pos.addScaledVector(fwdVec(c.yaw), speed * dt); anim = 'walk forward'; }
      else anim = this.crouch ? 'idle crouching aiming' : 'idle aiming';
      const dy = tgt.chest().y - this.head().y; c.aimPitch += (Math.atan2(dy, dist) - c.aimPitch) * Math.min(1, dt * 8);
      // firing
      this.react -= dt; this.shotT -= dt;
      if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = this.W.mag; }
      else if (this.react <= 0 && this.shotT <= 0 && Math.abs(angDiff(Math.atan2(-to.x, -to.z), c.yaw)) < 0.25) {
        const W = this.W;
        if (this.burst <= 0) this.burst = W.auto ? 3 + ((Math.random() * 4) | 0) : 1;
        this.fire(tgt, dist); this.burst--; this.mag--;
        this.shotT = this.burst > 0 ? W.cool * 1.25 : (W.auto ? 0.45 + Math.random() * 0.7 : W.cool + 0.3 + Math.random() * 0.6) * (1.3 - D.acc);
        if (this.mag <= 0) { this.reloadT = W.reload; this.burst = 0; }
      }
    } else {
      this.crouch = false; c.aimPitch *= 0.9;
      // hunt: the last sighting, otherwise the nearest hostile (bots always know roughly where the fight is)
      this.pathT -= dt;
      if (!this.path || this.pathT <= 0) {
        let goal = this.lastSeenPos && now() - this.lastSeenT < 6 ? this.lastSeenPos : null;
        if (!goal) { let bd = 1e9; for (const h of this.hostiles()) { const d = h.pos.distanceTo(this.pos); if (d < bd) { bd = d; goal = h.pos; } } }
        if (!goal) goal = g.world.nav.randomFree();
        this.path = g.world.nav.findPath(this.pos, goal); this.pathT = 1.5 + Math.random();
      }
      if (this.path && this.path.length) {
        const p0 = this.path[0], d = new THREE.Vector3(p0.x - this.pos.x, 0, p0.z - this.pos.z), len = d.length();
        if (len < 0.5) this.path.shift();
        else { d.divideScalar(len); c.yaw += angDiff(Math.atan2(-d.x, -d.z), c.yaw) * Math.min(1, dt * 8); const fw = fwdVec(c.yaw); speed = 4.3; this.pos.addScaledVector(fw, speed * dt * Math.max(0, fw.dot(d))); anim = 'run forward'; ts = speed / GAIT_SPEED.run; }
      }
    }
    // collisions: world, vehicles, other characters
    const hitWall = resolveCircle(g.world.boxes, this.pos, this.radius, 1.8);
    if (hitWall && this.tactic === 'strafe' && tgt) this.strafeDir *= -1;
    for (const o of this.mp.remotes.values()) if (o !== this && !o.dead && o.seen) { const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz; if (d2 < 0.6 && d2 > 1e-6) { const d = Math.sqrt(d2); this.pos.x += dx / d * (0.78 - d) * 0.5; this.pos.z += dz / d * (0.78 - d) * 0.5; } }
    const lp = this.g.player; if (!lp.dead) { const dx = this.pos.x - lp.pos.x, dz = this.pos.z - lp.pos.z, d2 = dx * dx + dz * dz; if (d2 < 0.6 && d2 > 1e-6) { const d = Math.sqrt(d2); this.pos.x += dx / d * (0.78 - d); this.pos.z += dz / d * (0.78 - d); } }
    // unstick: no progress while running -> new path
    if (speed > 3 && this.pos.distanceTo(before) < speed * dt * 0.25) { this.stuckT += dt; if (this.stuckT > 0.8) { this.stuckT = 0; this.path = g.world.nav.findPath(this.pos, g.world.nav.randomFree()); } } else this.stuckT = 0;
    this.pos.y = groundHeight(g.world.boxes, this.pos, this.radius, 0.45);
    if (dt > 0) this.vel.copy(this.pos).sub(before).divideScalar(dt);
    c.upperTarget = tgt && speed > 0 ? 1 : 0; c.upperName = this.crouch ? 'idle crouching aiming' : 'idle aiming';
    c.play(anim, { fade: 0.25, sync: /^(walk|run)/.test(c.currentName) && /^(walk|run)/.test(anim), timeScale: ts });
    if (speed > 0 && this.pos.distanceTo(lp.pos) < 22) { const ph = c.phase(); if ((this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase) g.sfx.step(this.pos, 0.1); this.lastPhase = ph; }
    c.root.position.copy(this.pos); c.update(dt);
  }
  fire(tgt, dist) {
    const g = this.g, mp = this.mp, W = this.W, D = this.diff, c = this.c;
    const muzzle = c.muzzle.getWorldPosition(new THREE.Vector3()), chest = tgt.chest();
    const tv = tgt.vel ? Math.hypot(tgt.vel.x, tgt.vel.z) : 0, crouch = mp.crouchOf(tgt.id);
    const rangeK = W.scope ? THREE.MathUtils.clamp(1.2 - dist / 120, 0.5, 1) : W.pellets > 1 ? THREE.MathUtils.clamp(1.3 - dist / 14, 0.1, 1) : THREE.MathUtils.clamp(1.15 - dist / 50, 0.25, 1);
    const chance = D.acc * rangeK * (tv > 3 ? 0.6 : tv > 0.5 ? 0.8 : 1) * (crouch ? 0.75 : 1) * (W.scope ? 1.4 : 1);
    const hit = Math.random() < chance, head = hit && Math.random() < D.head;
    let aim = chest.clone(); if (head) aim.y += crouch ? 0.25 : 0.32;
    if (!hit) aim.add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 - 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 1.2));
    const dir = aim.clone().sub(muzzle).normalize(), L = muzzle.distanceTo(aim);
    const wh = raycastBoxes(g.world.boxes, muzzle, dir, 200);
    const blocked = wh && wh.t < L - 0.2;
    const end = blocked ? wh.point : hit ? aim : (wh ? wh.point : muzzle.clone().addScaledVector(dir, 90));
    c.kick(0.7); this.lastFire = now(); g.fx.shell(c);
    const fx = { t: 'fx', id: this.id, w: W.id, m: [muzzle.x, muzzle.y, muzzle.z].map(v => Math.round(v * 100) / 100), e: [[end.x, end.y, end.z].map(v => Math.round(v * 100) / 100)] };
    mp.net.broadcast(fx); mp.onFx(fx);
    if (blocked) { if (wh.box.owner && wh.box.owner.damage) wh.box.owner.damage(W.dmg * 0.5, this.id); return; }
    if (!hit) return;
    let dmg = W.dmg * (head ? W.head : 1) * falloff(W, dist) * D.dmg;
    if (W.pellets > 1) dmg = W.dmg * Math.max(2, Math.round(W.pellets * rangeK)) * falloff(W, dist) * D.dmg;
    mp.applyDamage(tgt.id, dmg, this.id, this.pos.clone(), head, W.id);
  }
  // state in the same shape as a client's 's' message
  state() {
    const c = this.c, r2 = (v) => Math.round(v * 100) / 100;
    return { p: [r2(this.pos.x), r2(this.pos.y), r2(this.pos.z)], y: r2(c.yaw), pi: r2(c.aimPitch), a: c.currentName, ts: c.current ? r2(c.current.timeScale) : 1, w: this.gunId, f: (this.crouch ? 1 : 0) | (this.canSee ? 2 : 0) | (c.upperTarget ? 8 : 0) };
  }
  dispose() { this.c.dispose(this.g.scene); if (this.plate) this.plate.remove(); }
}

import * as THREE from 'three';
import { resolveCircle, lineOfSight, raycastBoxes, groundHeight } from './physics.js';
import { GAIT_SPEED } from './character.js';
import { angDiff, fwdVec, rightVec } from './player.js';

export class Enemy {
  constructor(game, char, pos, wave) {
    this.g = game; this.c = char; this.pos = pos.clone(); this.radius = 0.36; this.hp = 100; this.dead = false; this.deadT = 0;
    this.wave = wave; this.state = Math.random() < 0.6 ? 'chase' : 'patrol'; this.alerted = this.state === 'chase';
    this.path = null; this.pathT = 0; this.percT = Math.random() * 0.2; this.canSee = false; this.lastSeen = -99; this.react = 0;
    this.burst = 0; this.shotT = 0; this.tactic = 'hold'; this.tacticT = 0; this.strafeDir = 1; this.idleT = 0; this.crouch = false;
    this.accuracy = Math.min(0.62, 0.3 + wave * 0.04); this.dmg = Math.min(15, 7 + wave);
    // enemies carry one of the automatic weapons
    const r = Math.random(); this.gunId = r < 0.45 ? 'm4a1' : r < 0.8 ? 'akm' : 'mac10'; char.setGun(this.gunId);
    this.sound = this.gunId === 'akm' ? 'ak' : this.gunId === 'mac10' ? 'smg' : 'rifle';
    if (this.gunId === 'mac10') this.dmg *= 0.75; else if (this.gunId === 'akm') this.dmg *= 1.12;
    this.c.yaw = Math.atan2(-(0 - pos.x), -(0 - pos.z));
    this.c.root.position.copy(this.pos); this.lastPhase = 0;
    this.c.play('idle', { fade: 0 });
  }
  // co-op multiplayer: hunt the nearest operator
  get player() { const mp = this.g.mp; return mp && mp.active && mp.mode === 'coop' ? mp.coopTarget(this) : this.g.player; }
  head() { return this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 1.05 : 1.55, 0)); }
  alert() { if (!this.dead && !this.alerted) { this.alerted = true; if (this.state === 'patrol') { this.state = 'chase'; this.path = null; } } }
  follow(dt, speed) {
    if (!this.path || !this.path.length) return true;
    const tgt = this.path[0]; const d = new THREE.Vector3(tgt.x - this.pos.x, 0, tgt.z - this.pos.z); const len = d.length();
    if (len < 0.4) { this.path.shift(); return !this.path.length; }
    d.divideScalar(len);
    const yawT = Math.atan2(-d.x, -d.z); this.c.yaw += angDiff(yawT, this.c.yaw) * Math.min(1, dt * 8);
    const fw = fwdVec(this.c.yaw); this.pos.addScaledVector(fw, speed * dt * Math.max(0, fw.dot(d)));
    return false;
  }
  update(dt) {
    const g = this.g, p = this.player;
    if (this.dead) {
      this.deadT += dt; if (this.deadT > 9) this.c.root.position.y -= dt * 0.25;
      this.c.update(dt); return;
    }
    const toP = p.pos.clone().sub(this.pos); const dist = Math.hypot(toP.x, toP.z);
    // perception
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.2;
      const fw = fwdVec(this.c.yaw); const dirP = toP.clone().setY(0).normalize();
      const inFov = fw.dot(dirP) > -0.1 || dist < 7 || this.alerted;
      this.canSee = !p.dead && dist < 55 && inFov && lineOfSight(g.world.boxes, this.head(), p.chest());
      if (this.canSee) { if (!this.alerted) this.alerted = true; if (g.time - this.lastSeen > 2) this.react = Math.max(0.35, 0.95 - this.wave * 0.06) + Math.random() * 0.3; this.lastSeen = g.time; }
    }
    let speed = 0, anim = 'idle', animTS = 1;
    if (p.dead) { this.state = 'patrol'; this.alerted = false; }
    if (this.state !== 'engage' && this.canSee && dist < 30) { this.state = 'engage'; this.tacticT = 0; }
    if (this.state === 'engage') {
      if (!this.canSee && g.time - this.lastSeen > 1.2) { this.state = 'chase'; this.path = null; this.crouch = false; }
      else if (dist > 32) { this.state = 'chase'; this.path = null; this.crouch = false; }
    }
    if (this.state === 'engage') {
      const yawT = Math.atan2(-toP.x, -toP.z); this.c.yaw += angDiff(yawT, this.c.yaw) * Math.min(1, dt * 7);
      this.tacticT -= dt;
      if (this.tacticT <= 0) {
        const r = Math.random(); this.tactic = r < 0.4 ? 'hold' : r < 0.8 ? 'strafe' : 'crouch'; this.tacticT = 1.4 + Math.random() * 2; this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        if (dist > 18 && Math.random() < 0.4) this.tactic = 'advance';
      }
      this.crouch = this.tactic === 'crouch';
      if (this.tactic === 'strafe') {
        speed = GAIT_SPEED.walk; const before = this.pos.clone();
        this.pos.addScaledVector(rightVec(this.c.yaw), this.strafeDir * speed * dt);
        anim = this.strafeDir > 0 ? 'walk right' : 'walk left';
        if (resolveCircle(g.world.boxes, this.pos, this.radius, 1.8) && this.pos.distanceTo(before) < speed * dt * 0.3) this.strafeDir *= -1;
      } else if (this.tactic === 'advance') {
        speed = GAIT_SPEED.walk; this.pos.addScaledVector(fwdVec(this.c.yaw), speed * dt); anim = 'walk forward';
      } else anim = this.crouch ? 'idle crouching aiming' : 'idle aiming';
      // firing
      this.react -= dt; this.shotT -= dt;
      if (this.canSee && this.react <= 0 && this.shotT <= 0) {
        if (this.burst <= 0) { this.burst = 3 + (Math.random() * 4 | 0); this.shotT = 0; }
        this.shoot(dist); this.burst--; this.shotT = this.burst > 0 ? (this.gunId === 'mac10' ? 0.07 : 0.11) + Math.random() * 0.04 : 0.7 + Math.random() * 1.1;
      }
      const dy = p.chest().y - this.head().y; this.c.aimPitch += (Math.atan2(dy, dist) * 0.95 - this.c.aimPitch) * Math.min(1, dt * 8);
    } else {
      this.c.aimPitch *= 0.9; this.crouch = false;
      if (this.state === 'chase') {
        this.pathT -= dt;
        if (!this.path || this.pathT <= 0) { this.path = g.world.nav.findPath(this.pos, p.pos); this.pathT = 1.0 + Math.random() * 0.5; }
        speed = 4.0; anim = 'run forward'; animTS = speed / GAIT_SPEED.run;
        if (this.follow(dt, speed)) { this.path = null; if (dist < 4) this.state = 'engage'; }
      } else { // patrol
        if (!this.path) {
          this.idleT -= dt; anim = 'idle';
          if (this.idleT <= 0) { this.path = g.world.nav.findPath(this.pos, g.world.nav.randomFree()); }
        } else {
          speed = GAIT_SPEED.walk; anim = 'walk forward';
          if (this.follow(dt, speed)) { this.path = null; this.idleT = 1 + Math.random() * 2.5; }
        }
      }
    }
    // collision + separation
    resolveCircle(g.world.boxes, this.pos, this.radius, 1.8);
    for (const o of g.enemies) if (o !== this && !o.dead) {
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6) { const d = Math.sqrt(d2), push = (0.8 - d) * 0.5; this.pos.x += dx / d * push; this.pos.z += dz / d * push; }
    }
    const dpx = this.pos.x - p.pos.x, dpz = this.pos.z - p.pos.z, dp2 = dpx * dpx + dpz * dpz;
    if (dp2 < 0.6 && dp2 > 1e-6) { const d = Math.sqrt(dp2); this.pos.x += dpx / d * (0.78 - d); this.pos.z += dpz / d * (0.78 - d); }
    this.pos.y = groundHeight(g.world.boxes, this.pos, this.radius, 0.45);
    this.c.play(anim, { fade: 0.25, sync: /^(walk|run)/.test(this.c.currentName) && /^(walk|run)/.test(anim), timeScale: animTS });
    if (speed > 0 && dist < 22) { const ph = this.c.phase(); if ((this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase) g.sfx.step(this.pos, 0.1); this.lastPhase = ph; }
    this.c.root.position.copy(this.pos);
    this.c.update(dt);
  }
  shoot(dist) {
    const g = this.g, p = this.player;
    const muzzle = this.c.muzzle.getWorldPosition(new THREE.Vector3());
    const chest = p.chest();
    const pm = Math.hypot(p.vel.x, p.vel.z);
    let chance = this.accuracy * THREE.MathUtils.clamp(1.15 - dist / 45, 0.25, 1) * (pm > 3 ? 0.6 : pm > 0.5 ? 0.8 : 1) * (p.crouch ? 0.7 : 1);
    const hit = Math.random() < chance;
    let target = chest.clone();
    if (!hit) target.add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 - 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 1.2));
    const dir = target.clone().sub(muzzle).normalize();
    const wh = raycastBoxes(g.world.boxes, muzzle, dir, 200);
    const dT = muzzle.distanceTo(target);
    g.fx.muzzleFlash(this.c.muzzle, dir, false, 0.9);
    g.sfx.gunshot(muzzle, 0.85, this.sound);
    if (g.mp) g.mp.enemyFx(this, muzzle, wh && wh.t < dT + 2 ? wh.point : target.clone().addScaledVector(dir, 30));
    if (wh && wh.t < dT - 0.1) { // blocked by cover
      g.fx.tracer(muzzle, wh.point, true); g.fx.impact(wh.point, wh.normal, wh.box.mat); g.sfx.impact(wh.point, wh.box.mat);
      return;
    }
    if (hit) { g.fx.tracer(muzzle, chest, true); p.damage(this.dmg * (0.85 + Math.random() * 0.3), this.pos.clone()); }
    else {
      const end = wh ? wh.point : muzzle.clone().addScaledVector(dir, 120);
      g.fx.tracer(muzzle, end, true);
      if (wh) g.fx.impact(wh.point, wh.normal, wh.box.mat);
      if (target.distanceTo(chest) < 1.3) g.sfx.whiz(target);
    }
  }
  damage(amount, dir, head) {
    if (this.dead) return;
    this.hp -= amount; this.alert(); this.react = Math.min(this.react, 0.3);
    if (this.state === 'patrol') this.state = 'chase';
    if (this.hp > 0) return;
    this.dead = true; this.c.aimPitch = 0;
    const fw = fwdVec(this.c.yaw), rt = rightVec(this.c.yaw);
    const from = dir.clone().negate().setY(0).normalize(); // direction toward the shooter
    const df = from.dot(fw), dr = from.dot(rt);
    let clip;
    if (head) clip = this.crouch ? 'death crouching headshot front' : df >= 0 ? 'death from front headshot' : 'death from back headshot';
    else if (dr > 0.7) clip = 'death from right';
    else clip = df >= 0 ? 'death from the front' : 'death from the back';
    this.deathClip = clip;
    this.c.play(clip, { fade: 0.12, once: true });
    this.g.onEnemyKilled(this, head);
  }
}

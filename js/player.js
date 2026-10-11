import * as THREE from 'three';
import { resolveCircle, groundHeight, raycastBoxes, raySphere, rayCapsule } from './physics.js';
import { GAIT_SPEED, locoClip, dirIndexFromInput } from './character.js';
import { WEAPONS, falloff } from './weapons.js';

const UP = new THREE.Vector3(0, 1, 0);
export const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const fwdVec = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
export const rightVec = (yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

export class Player {
  constructor(game, char) {
    this.g = game; this.c = char; this.radius = 0.36;
    this.reset(game.world.playerSpawn);
  }
  reset(spawn) {
    this.pos = spawn.clone(); this.vel = new THREE.Vector3(); this.yaw = 0; this.pitch = -0.05; this.c.yaw = 0;
    this.health = 100; this.reloading = 0; this.cool = 0; this.bloom = 0;
    this.slots = WEAPONS.map(w => ({ w, mag: w.mag, reserve: w.reserve })); this.wi = 0; this.lastWi = 1; this.switchT = 0; this.pendingWi = -1; this.triggerUp = true;
    this.c.setGun(this.slots[0].w.id);
    this.crouch = false; this.crouchToggle = false; this.aiming = false; this.grounded = true; this.airTime = 0; this.jumpPhase = null; this.landTimer = 0;
    this.lastHurt = -99; this.dead = false; this.deadTime = 0; this.fireRecent = 0; this.turning = null; this.recoil = 0; this.moving = false; this.sprint = false;
    this.shots = 0; this.hits = 0; this.headshots = 0; this.emptyClicked = false; this.lastPhase = 0;
    this.c.root.position.copy(this.pos); this.c.aimPitch = 0; this.c.gun.visible = true;
    this.c.play('idle', { fade: 0 });
  }
  get slot() { return this.slots[this.wi]; }
  get weapon() { return this.slots[this.wi].w; }
  get mag() { return this.slot.mag; } set mag(v) { this.slot.mag = v; }
  get reserve() { return this.slot.reserve; } set reserve(v) { this.slot.reserve = v; }
  get lowAmmo() { return this.mag <= Math.max(1, Math.ceil(this.weapon.mag * 0.25)); }
  get reloadTime() { return this.weapon.reload; }
  get switching() { return this.switchT > 0; }
  // weapon switch: lower the gun, swap the model at the bottom, raise it again
  switchTo(i) {
    i = ((i % this.slots.length) + this.slots.length) % this.slots.length;
    if (this.dead || (i === this.wi && !this.switching) || i === this.pendingWi) return;
    this.reloading = 0; this.c.mag.visible = true; this.pendingWi = i; this.switchT = 0.5; this.g.sfx.switchWeapon();
  }
  cycle(d) { this.switchTo((this.pendingWi >= 0 ? this.pendingWi : this.wi) + d); }
  lastWeapon() { this.switchTo(this.lastWi); }
  addAmmo(mult = 1) {
    for (const sl of this.slots) { const add = Math.ceil(sl.w.mag * (sl === this.slot ? 2 : 1) * mult); sl.reserve = Math.min(sl.w.reserve * 1.5, sl.reserve + add); }
  }
  get eyeHeight() { return this.crouch ? 1.12 : 1.6; }
  chest() { return this.pos.clone().add(new THREE.Vector3(0, this.crouch ? 0.85 : 1.3, 0)); }

  update(dt, inp) {
    const g = this.g, k = inp.keys;
    if (this.dead) { this.deadTime += dt; this.c.update(dt); return; }
    // ---- input
    let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    let s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let slow = false;
    // analog touch joystick: small push = walk, push far = run
    const j = inp.joy;
    if (j && j.active && !f && !s) {
      const m = Math.hypot(j.x, j.y);
      if (m > 0.18) { f = -j.y; s = j.x; slow = m < 0.62; }
    }
    this.moving = !!(f || s);
    this.crouch = (this.crouchToggle || !!k.ControlLeft) && this.grounded;
    this.aiming = !!inp.aim;
    this.sprint = !!(k.ShiftLeft || k.ShiftRight || inp.sprintToggle || inp.sprintLock) && this.moving && !slow && !this.aiming && !this.crouch && !inp.fire;
    const gait = this.crouch ? 'crouch' : (this.aiming || slow) ? 'walk' : this.sprint ? 'sprint' : 'run';
    const speed = GAIT_SPEED[gait] * (gait === 'crouch' ? 0.85 : 1);
    // ---- horizontal movement
    const wish = new THREE.Vector3();
    if (this.moving) wish.addScaledVector(fwdVec(this.yaw), f).addScaledVector(rightVec(this.yaw), s).normalize().multiplyScalar(speed);
    const acc = this.grounded ? 12 : 2.5;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, acc * dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    resolveCircle(g.world.boxes, this.pos, this.radius, this.crouch ? 1.2 : 1.8, this.grounded ? 0.45 : 0.1);
    // ---- vertical
    if (inp.jumpPressed && this.grounded && this.landTimer < 0.2) {
      if (this.crouchToggle) this.crouchToggle = false;
      else { this.vel.y = 5.2; this.grounded = false; this.jumpPhase = 'up'; this.airTime = 0; this.c.play('jump up', { fade: 0.1, once: true }); g.sfx.step(null, 0.2); }
    }
    inp.jumpPressed = false;
    const ground = groundHeight(g.world.boxes, this.pos, this.radius, this.grounded ? 0.45 : 0.05);
    if (this.grounded) {
      if (this.pos.y - ground > 0.35) { this.grounded = false; this.jumpPhase = 'loop'; this.airTime = 0; this.c.play('jump loop', { fade: 0.25 }); }
      else this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 18);
    }
    if (!this.grounded) {
      this.airTime += dt; this.vel.y -= 15 * dt; this.pos.y += this.vel.y * dt;
      if (this.jumpPhase === 'up' && (this.vel.y < 0.5)) { this.jumpPhase = 'loop'; this.c.play('jump loop', { fade: 0.2 }); }
      if (this.pos.y <= ground && this.vel.y <= 0) {
        this.pos.y = ground; this.vel.y = 0; this.grounded = true; this.jumpPhase = null;
        if (this.airTime > 0.25) { this.landTimer = 0.45; this.c.play('jump down', { fade: 0.08, once: true }); g.sfx.step(null, 0.35); }
      }
    }
    this.landTimer = Math.max(0, this.landTimer - dt);
    // ---- body orientation
    this.fireRecent = Math.max(0, this.fireRecent - dt);
    const wantFace = this.moving || this.aiming || this.fireRecent > 0 || !this.grounded;
    const d = angDiff(this.yaw, this.c.yaw);
    if (this.turning) {
      this.turning.t -= dt;
      if (this.turning.t <= 0 || wantFace) {
        if (this.turning.t <= 0) { this.c.yaw += this.turning.dir * Math.PI / 2; this.c.play(this.crouch ? 'idle crouching' : 'idle', { fade: 0 }); }
        this.turning = null;
      }
    } else if (wantFace) this.c.yaw += d * Math.min(1, dt * 14);
    else if (this.grounded && this.landTimer <= 0 && Math.abs(d) > 1.75) {
      const dir = Math.sign(d); // + = turn left (counter-clockwise)
      const name = (this.crouch ? 'crouching turn 90 ' : 'turn 90 ') + (dir > 0 ? 'left' : 'right');
      this.c.play(name, { fade: 0.15, once: true }); this.turning = { dir, t: this.c.f.clips[name].duration - 0.02 };
    }
    // ---- animation state
    if (this.grounded && !this.turning && !(this.landTimer > 0 && (!this.moving || this.landTimer > 0.3))) {
      if (this.moving) {
        const fl = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        const lf = fl.dot(fwdVec(this.c.yaw)), ls = fl.dot(rightVec(this.c.yaw));
        const di = dirIndexFromInput(s || ls * 0.01, f || lf * 0.01);
        const hs = Math.hypot(this.vel.x, this.vel.z);
        const name = locoClip(gait, di);
        const loco = /^(walk|run|sprint)/.test(this.c.currentName);
        this.c.play(name, { fade: 0.22, sync: loco, timeScale: THREE.MathUtils.clamp(hs / GAIT_SPEED[gait], 0.55, 1.25) });
        // footsteps at phase wrap / half
        const ph = this.c.phase();
        if ((this.lastPhase < 0.5 && ph >= 0.5) || ph < this.lastPhase) g.sfx.step(null, gait === 'sprint' ? 0.2 : gait === 'crouch' ? 0.06 : 0.13);
        this.lastPhase = ph;
      } else {
        const aimPose = this.aiming || this.fireRecent > 0 || this.reloading > 0;
        const name = this.crouch ? (aimPose ? 'idle crouching aiming' : 'idle crouching') : (aimPose ? 'idle aiming' : 'idle');
        this.c.play(name, { fade: 0.25 });
      }
    }
    // aim pitch on spine (stronger when aiming)
    const pitchTarget = (this.aiming || this.fireRecent > 0 ? 0.95 : 0.6) * THREE.MathUtils.clamp(this.pitch, -1.0, 1.0) + (this.sprint ? 0 : 0);
    this.c.aimPitch += (pitchTarget - this.c.aimPitch) * Math.min(1, dt * 12);
    // ---- weapon
    const W = this.weapon;
    this.cool -= dt; this.bloom = Math.max(0, this.bloom - dt * 0.08);
    if (this.switchT > 0) {
      const before = this.switchT; this.switchT -= dt;
      if (before > 0.25 && this.switchT <= 0.25 && this.pendingWi >= 0) { // gun is fully lowered: swap
        this.lastWi = this.wi; this.wi = this.pendingWi; this.pendingWi = -1; this.c.setGun(this.weapon.id); this.cool = 0; this.bloom = 0;
        g.hud.weaponChanged();
      }
      if (this.switchT <= 0) this.switchT = 0;
    }
    if (this.reloading > 0) {
      this.reloading -= dt; const t = (W.reload - this.reloading) / W.reload;
      this.c.mag.visible = !(t > 0.17 && t < 0.55);
      if (this.reloading <= 0) { const need = W.mag - this.mag, take = Math.min(need, this.reserve); this.mag += take; this.reserve -= take; this.c.mag.visible = true; }
    }
    if (inp.reloadPressed) { inp.reloadPressed = false; this.startReload(); }
    if (!inp.fire) this.triggerUp = true;
    if (inp.fire && this.reloading <= 0 && this.cool <= 0 && !this.switching && (W.auto || this.triggerUp)) {
      if (this.mag > 0) { this.shoot(); this.triggerUp = false; }
      else if (!this.emptyClicked) { g.sfx.empty(); this.emptyClicked = true; this.startReload(); }
    }
    if (!inp.fire) this.emptyClicked = false;
    // recoil recovery
    const rec = Math.min(this.recoil, dt * 0.35); this.pitch -= rec; this.recoil -= rec;
    // regen
    if (g.time - this.lastHurt > 5 && this.health < 100) this.health = Math.min(100, this.health + 14 * dt);
    this.c.root.position.copy(this.pos);
    this.c.update(dt);
    // reload / switch: tilt and lower the weapon procedurally (no reload clip in the pack)
    const q = this.c.gun.quaternion.copy(this.c.f.gunLocalQuat); this.c.gun.position.copy(this.c.f.gunLocalPos);
    if (this.reloading > 0) {
      const t = W.reload - this.reloading; const w = Math.sin(Math.min(1, t / W.reload) * Math.PI);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * w, 0, 0.7 * w)));
    }
    if (this.switchT > 0) { // 0.5 -> 0: down (0.5..0.25), up (0.25..0)
      const k = Math.sin((1 - this.switchT / 0.5) * Math.PI);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1 * k, 0, 0.35 * k)));
      this.c.gun.position.y -= 0.25 * k / this.c.f.gunScale; // pull down out of view
    }
    if (this.pumpT > 0) { this.pumpT -= dt; const k = Math.sin(Math.max(0, 1 - this.pumpT / 0.45) * Math.PI); q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18 * k, 0, 0))); }
  }
  startReload() {
    const W = this.weapon;
    if (this.reloading > 0 || this.switching || this.mag >= W.mag || this.reserve <= 0) return;
    this.reloading = W.reload; this.g.sfx.reload(W.reload / 2.1);
  }
  spread() {
    const W = this.weapon, hs = Math.hypot(this.vel.x, this.vel.z);
    const base = this.aiming ? W.ads : W.hip;
    return Math.max(W.ads * 0.5, base + hs * 0.0025 * (this.aiming ? 0.5 : 1) * (W.scope && this.aiming ? 3 : 1) + (this.grounded ? 0 : 0.03) + this.bloom * (this.aiming ? 0.5 : 1) - (this.crouch ? 0.003 : 0));
  }
  // trace one bullet / pellet from the camera; returns { point, normal, kind, enemy, part, dist, muzzleDir }
  trace(dir) {
    const g = this.g, cam = g.camera;
    const origin = cam.position.clone();
    const tStart = Math.max(0, this.pos.clone().add(new THREE.Vector3(0, this.eyeHeight, 0)).sub(origin).dot(dir));
    const o = origin.clone().addScaledVector(dir, tStart);
    const wh = raycastBoxes(g.world.boxes, o, dir, 300);
    let best = wh ? wh.t : 300, hitEnemy = null, part = null;
    for (const e of g.enemies) {
      if (e.dead) continue;
      if (e.pos.distanceToSquared(o) > (best + 2) * (best + 2)) continue;
      const hb = e.c.hitboxes();
      const th = raySphere(o, dir, hb.head.c, hb.head.r, best);
      if (th != null && th < best) { best = th; hitEnemy = e; part = 'head'; }
      const tt = rayCapsule(o, dir, hb.torso.a, hb.torso.b, hb.torso.r, best);
      if (tt != null && tt < best - 0.02) { best = tt; hitEnemy = e; part = 'body'; }
      const tl = rayCapsule(o, dir, hb.legs.a, hb.legs.b, hb.legs.r, best);
      if (tl != null && tl < best - 0.02) { best = tl; hitEnemy = e; part = 'legs'; }
    }
    let point = o.clone().addScaledVector(dir, best);
    const muzzle = this.c.muzzle.getWorldPosition(new THREE.Vector3());
    // is the line from the muzzle to the aim point blocked (e.g. firing around cover)?
    const md = point.clone().sub(muzzle); const ml = md.length(); md.normalize();
    const mb = raycastBoxes(g.world.boxes, muzzle, md, Math.max(0, ml - 0.05));
    let normal = wh && !hitEnemy ? wh.normal : null, kind = wh ? wh.box.mat : 'concrete';
    if (mb) { point = mb.point; normal = mb.normal; kind = mb.box.mat; hitEnemy = null; }
    return { point, normal, kind, enemy: hitEnemy, part, dist: tStart + best, muzzle, md };
  }
  shoot() {
    const g = this.g, cam = g.camera, W = this.weapon;
    this.cool = W.cool; this.mag--; this.fireRecent = 0.6; this.shots++;
    const aim = cam.getWorldDirection(new THREE.Vector3());
    const sp = Math.max(0, this.spread());
    const hits = new Map(); let firstMd = null, anyHit = false;
    for (let k = 0; k < W.pellets; k++) {
      const dir = aim.clone();
      const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(sp * Math.sqrt(Math.random()) * 2);
      dir.add(rnd).normalize();
      const r = this.trace(dir); if (!firstMd) firstMd = r.md;
      if (k < 4) g.fx.tracer(r.muzzle, r.point, false);
      if (r.enemy) {
        const mul = (r.part === 'head' ? W.head : r.part === 'legs' ? W.legs : 1) * falloff(W, r.dist);
        const h = hits.get(r.enemy) || { dmg: 0, head: false, dir, point: r.point };
        h.dmg += W.dmg * mul; h.head = h.head || r.part === 'head'; hits.set(r.enemy, h);
        if (k < 3 || W.pellets === 1) g.fx.blood(r.point, dir);
      } else if (r.normal) {
        if (k < 5) { g.fx.impact(r.point, r.normal, r.kind); if (k === 0) g.sfx.impact(r.point, r.kind); }
      }
    }
    this.bloom = Math.min(0.035 + W.bloom * 2, this.bloom + W.bloom);
    const kick = W.recoil * (this.aiming ? 0.65 : 1) * (this.crouch ? 0.7 : 1);
    this.pitch += kick; this.recoil += kick * 0.85; this.yaw += (Math.random() - 0.5) * kick * 0.8;
    g.shake = Math.min(1.6, g.shake + 0.25 * Math.max(1, W.recoil / 0.011) ** 0.6);
    g.fx.muzzleFlash(this.c.muzzle, firstMd, true, W.flash);
    if (W.pump) { this.pumpT = 0.45; setTimeout(() => g.fx.shell(this.c), 380); } else g.fx.shell(this.c);
    g.sfx.gunshot(null, 1, W.sound); g.haptic(W.pellets > 1 || W.scope ? 30 : 9);
    g.alert(this.pos, W.sound === 'pistol' || W.sound === 'smg' ? 32 : 45);
    for (const [e, h] of hits) {
      this.hits++; if (h.head) this.headshots++;
      e.damage(h.dmg, h.dir, h.head);
      g.hud.hitmarker(h.head, e.dead); g.sfx.hit(h.head); g.haptic(e.dead ? [30, 40, 50] : 18); anyHit = true;
    }
  }
  damage(amount, fromPos) {
    if (this.dead) return;
    this.health -= amount; this.lastHurt = this.g.time; this.g.sfx.hurt();
    this.g.hud.damageFrom(fromPos); this.g.haptic(45);
    if (this.health <= 0) {
      this.health = 0; this.dead = true; this.deadTime = 0;
      const toShooter = fromPos.clone().sub(this.pos).setY(0).normalize();
      const fw = fwdVec(this.c.yaw), rt = rightVec(this.c.yaw);
      const df = toShooter.dot(fw), dr = toShooter.dot(rt);
      const clip = this.crouch ? 'death crouching headshot front' : (dr > 0.6 ? 'death from right' : df >= 0 ? 'death from the front' : 'death from the back');
      this.c.aimPitch = 0; this.c.play(clip, { fade: 0.15, once: true });
      this.g.onPlayerDeath();
    }
  }
}

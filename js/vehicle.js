// Drivable armoured vehicles (v1.4). CC0 Quaternius models (Poly Pizza): "Pickup Truck Armored" and "Truck Armored".
// Arcade physics: throttle / brake / reverse / handbrake, speed-scaled steering, sliding collisions against the city's
// box colliders (approximated by three circles along the body), curb step-up, run-over damage, hit points, burning,
// explosion with splash damage, a burnt-out wreck that respawns later. Each vehicle also exposes three moving box
// colliders (owner = vehicle) so soldiers bump into it and bullets hit (and damage) it.
// Multiplayer: the host simulates every vehicle (driver input arrives in the clients' state messages) and sends
// compact vehicle states in its snapshots; clients only draw them and request to enter / exit.
import * as THREE from 'three';
import { Box, groundHeight, resolveCircle } from './physics.js';
import { icon } from './icons.js';

const SPECS = { // paint: multiplies the model's colour atlas (military olive / desert tan)
  pickup_armored: { name: 'ARMORED PICKUP', hp: 650, max: 19, acc: 9, rev: 6, grip: 0.62, mass: 1, paint: 0x8f9a6a, cab: 0.1, seatY: 0.2 },
  truck_armored: { name: 'ARMORED TRUCK', hp: 1000, max: 15, acc: 6.5, rev: 5, grip: 0.5, mass: 1.6, paint: 0xb8a77e, cab: 0.45, seatY: 0.3 },
};
const UPv = new THREE.Vector3(0, 1, 0);
const now = () => performance.now() / 1000;

export class Vehicle {
  constructor(g, idx, kit, x, z, yaw) {
    this.g = g; this.idx = idx; this.kit = kit; this.spec = SPECS[kit];
    this.home = { x, z, yaw };
    const src = g.world.kits[kit];
    this.root = new THREE.Group(); const body = src.clone(true);
    // own material copies (so this one can burn black without affecting the other)
    this.mats = []; body.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); if (/atlas/i.test(o.material.name) && this.spec.paint) o.material.color.multiply(new THREE.Color(this.spec.paint)); o.material.roughness = Math.max(0.7, o.material.roughness); this.mats.push([o.material, o.material.color.clone()]); o.castShadow = o.receiveShadow = true; } });
    const bb = new THREE.Box3().setFromObject(body), size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
    body.position.set(-ctr.x, -bb.min.y, -ctr.z); this.root.add(body); g.scene.add(this.root);
    this.hw = size.x / 2; this.hl = size.z / 2; this.h = size.y;
    this.wheels = [];
    body.traverse(o => { if (/Wheel/i.test(o.name)) this.wheels.push({ o, q0: o.quaternion.clone(), front: /Front/i.test(o.name) }); });
    this.wheelR = 0.45;
    this.boxes = [0, 1, 2].map(() => { const b = new Box(new THREE.Vector3(), new THREE.Vector3(), 'metal'); b.owner = this; return b; });
    for (const b of this.boxes) g.world.boxes.push(b);
    this.reset();
  }
  reset() {
    this.pos = new THREE.Vector3(this.home.x, 0, this.home.z); this.yaw = this.home.yaw; this.speed = 0; this.steer = 0; this.spin = 0;
    this.hp = this.spec.hp; this.dead = false; this.wreckT = 0; this.driver = null; this.input = { th: 0, st: 0, hb: 0 }; this.burnT = 0; this.lastHit = {};
    this.mats.forEach(([m, c]) => { m.color.copy(c); m.emissive && m.emissive.setRGB(0, 0, 0); });
    this.root.visible = true; this.place();
  }
  get name() { return this.spec.name; }
  fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  seat() { return this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(this.fwd(), 0.3); }
  // v1.5: driver's door (outside, on the driver's side) and the seated driver's root position in the cab
  doorPos() { return this.pos.clone().addScaledVector(this.right(), this.hw + 0.55).addScaledVector(this.fwd(), this.hl * this.spec.cab); }
  driverSeat() { return this.pos.clone().addScaledVector(this.right(), this.hw * 0.34).addScaledVector(this.fwd(), this.hl * this.spec.cab).add(new THREE.Vector3(0, this.h * this.spec.seatY, 0)); }
  // distance from a point to the body rectangle (0 = inside)
  rectDist(p) {
    const d = new THREE.Vector3(p.x - this.pos.x, 0, p.z - this.pos.z), f = this.fwd(), r = this.right();
    const lf = Math.abs(d.dot(f)) - this.hl, lr = Math.abs(d.dot(r)) - this.hw;
    return Math.hypot(Math.max(0, lf), Math.max(0, lr));
  }
  place() {
    this.root.position.copy(this.pos); this.root.rotation.set(0, this.yaw, 0);
    // tilt a little with acceleration / steering for weight
    this.root.rotateX(-(this.accel || 0) * 0.004); this.root.rotateZ(-this.steer * Math.min(1, Math.abs(this.speed) / 12) * 0.035);
    const f = this.fwd(), r = this.hw;
    [-1, 0, 1].forEach((k, i) => {
      const c = this.pos.clone().addScaledVector(f, k * (this.hl - r)), b = this.boxes[i];
      b.min.set(c.x - r * 0.95, this.pos.y + 0.25, c.z - r * 0.95); b.max.set(c.x + r * 0.95, this.pos.y + this.h * 0.92, c.z + r * 0.95);
      if (this.hidden) { b.min.y = -50; b.max.y = -49; }
    });
  }
  // ---------------------------------------------------------------- simulation (solo, or the MP host)
  update(dt) {
    const g = this.g, S = this.spec;
    if (this.dead) {
      this.wreckT += dt; this.speed *= Math.max(0, 1 - dt * 3);
      if (this.wreckT < 14 && Math.random() < dt * 10) g.fx.puff(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, this.h * 0.8, (Math.random() - 0.5) * 2)), 0x1c1c1c, 0.9, 2.5, 0.55, new THREE.Vector3(0.3, 1.6, 0.2), 2.4);
      if (this.wreckT > 30 && this.canRespawn()) this.reset();
      return;
    }
    const inp = this.driver != null ? this.input : { th: 0, st: 0, hb: 0 };
    const v0 = this.speed;
    // engine / brakes
    if (inp.hb) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 22 * dt);
    else if (inp.th > 0) this.speed += (this.speed < -0.3 ? 18 : S.acc * (1 - Math.max(0, this.speed) / (S.max * 1.05))) * inp.th * dt;
    else if (inp.th < 0) this.speed += (this.speed > 0.3 ? -18 : -S.acc * 0.7 * (1 - Math.max(0, -this.speed) / S.rev)) * -inp.th * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), (1.8 + Math.abs(this.speed) * 0.08) * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -S.rev, S.max);
    this.accel = (this.speed - v0) / Math.max(dt, 1e-3);
    this.steer += (inp.st - this.steer) * Math.min(1, dt * 4.5);
    const yawRate = this.steer * S.grip * this.speed / (this.hl * 1.15) * (1 - Math.min(0.55, Math.abs(this.speed) / 40));
    this.yaw -= yawRate * dt;
    const before = this.pos.clone();
    this.pos.addScaledVector(this.fwd(), this.speed * dt);
    // collisions: three circles along the body vs static world boxes (and the other vehicles)
    const f = this.fwd(), r = this.hw * 0.95, boxes = g.world.boxes.filter(b => b.owner !== this && !(b.max.y <= this.pos.y + 0.5));
    let push = new THREE.Vector3(), hit = false;
    for (const k of [-1, 0, 1]) {
      const c = this.pos.clone().addScaledVector(f, k * (this.hl - r)), c0 = c.clone(); c.y = this.pos.y;
      if (resolveCircle(boxes, c, r, this.h, 0.5)) { hit = true; const d = c.sub(c0); d.y = 0; if (d.lengthSq() > push.lengthSq()) push = d; }
    }
    if (hit && push.lengthSq() > 1e-6) {
      this.pos.add(push);
      const n = push.clone().normalize(), along = Math.abs(n.dot(f)), impact = Math.abs(this.speed) * along;
      if (impact > 2.5) {
        this.speed *= -0.25; g.sfx.impact(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'metal');
        if (impact > 7) this.damage((impact - 7) * 14 / S.mass, this.driver);
        if (this.isLocalDriver()) g.shake = Math.min(2, g.shake + impact * 0.12);
      } else this.speed *= 1 - along * 0.6;
    }
    // ground (curbs, slabs)
    const gy = groundHeight(boxes, this.pos, Math.min(this.hw, 1.0), 0.5);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 10);
    this.spin += this.speed * dt / this.wheelR;
    this.runOver(dt);
    if (this.hp < this.spec.hp * 0.3) { this.burnT += dt; if (Math.random() < dt * 6) g.fx.puff(this.pos.clone().addScaledVector(f, this.hl * 0.7).add(new THREE.Vector3(0, this.h * 0.75, 0)), 0x2a2a2a, 0.5, 1.6, 0.45, new THREE.Vector3(0, 1.4, 0), 2.2); if (this.burnT > 10) this.damage(dt * 12, this.driver); }
    this.place(); this.animate();
  }
  animate() {
    const qs = new THREE.Quaternion(), qy = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
    for (const w of this.wheels) {
      qs.setFromAxisAngle(X, this.spin); w.o.quaternion.copy(w.q0).premultiply(qs);
      if (w.front) { qy.setFromAxisAngle(UPv, -this.steer * 0.45); w.o.quaternion.premultiply(qy); }
    }
  }
  isLocalDriver() { const mp = this.g.mp; return this.driver != null && this.driver === (mp && mp.active ? mp.myId : 'local'); }
  canRespawn() {
    const h = this.home; const near = (p) => p && Math.hypot(p.x - h.x, p.z - h.z) < 6;
    if (near(this.g.player.pos)) return false;
    return !this.g.vehicles.list.some(v => v !== this && !v.dead && Math.hypot(v.pos.x - h.x, v.pos.z - h.z) < 6);
  }
  // soldiers in front of a moving vehicle get hit (host / solo)
  runOver(dt) {
    const sp = Math.abs(this.speed); const g = this.g, mp = g.mp, t = now();
    const victims = [];
    const mpOn = mp && mp.active;
    if (!mpOn || mp.mode === 'coop') for (const e of g.enemies) if (!e.dead) victims.push({ key: 'e' + (e.nid || 0), pos: e.pos, hurt: (d, dir) => e.damage(d, dir, false), push: (v) => e.pos.add(v) });
    if (mpOn) {
      for (const p of mp.players.values()) {
        if (p.dead || p.id === this.driver) continue; if (mp.vehicleOf && mp.vehicleOf(p.id)) continue;
        if (mp.mode === 'tdm' && this.driver != null) { const dp = mp.players.get(this.driver); if (dp && dp.team === p.team) continue; }
        const pos = mp.posOf(p.id); if (!pos) continue; const id = p.id;
        victims.push({ key: 'p' + id, pos, hurt: (d) => mp.applyDamage(id, d, this.driver ?? -1, this.pos.clone(), false, 'vehicle'), push: (v) => { if (id === mp.myId) g.player.pos.add(v); else { const r = mp.remotes.get(id); if (r && r.isBot) r.pos.add(v); } } });
      }
    } else if (!g.player.dead && !g.player.vehicle) victims.push({ key: 'me', pos: g.player.pos, hurt: (d) => g.player.damage(d, this.pos.clone()), push: (v) => g.player.pos.add(v) });
    const f = this.fwd(), rt = this.right();
    for (const v of victims) {
      if (Math.abs(v.pos.y - this.pos.y) > 1.5) continue;
      const d = new THREE.Vector3(v.pos.x - this.pos.x, 0, v.pos.z - this.pos.z), lf = d.dot(f), lr = d.dot(rt);
      if (Math.abs(lf) > this.hl + 0.4 || Math.abs(lr) > this.hw + 0.4) continue;
      // inside the (slightly grown) body: push out sideways, and hurt if we were moving at them
      const side = Math.sign(lr) || 1, out = rt.clone().multiplyScalar(side * Math.max(0, this.hw + 0.42 - Math.abs(lr)));
      const front = Math.sign(this.speed) === Math.sign(lf) && Math.abs(lf) > this.hl * 0.4;
      if (sp > 3 && front && !(this.lastHit[v.key] > t - 0.6)) {
        this.lastHit[v.key] = t; const dmg = sp * 11 * this.spec.mass;
        v.hurt(dmg, f.clone().multiplyScalar(Math.sign(this.speed))); g.sfx.impact(v.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'flesh');
        out.addScaledVector(f, Math.sign(this.speed) * 0.8);
        this.speed *= 0.9;
      }
      v.push(out);
    }
  }
  damage(amount, attacker) {
    if (this.dead || amount <= 0) return; const mp = this.g.mp;
    if (mp && mp.active && !mp.isHost) return; // host decides
    this.hp -= amount; this.lastAttacker = attacker;
    if (this.hp <= 0) this.explode(attacker);
  }
  explode(attacker) {
    const g = this.g, mp = g.mp, c = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
    this.dead = true; this.hp = 0; this.wreckT = 0;
    const driver = this.driver; this.g.vehicles.eject(this, true);
    this.burnLook(); g.vehicles.boom(c);
    // splash damage (solo / host)
    const R = 7.5;
    if (!mp || !mp.active || mp.mode === 'coop') for (const e of g.enemies) if (!e.dead) { const d = e.pos.distanceTo(c); if (d < R) e.damage(160 * (1 - d / R) + 20, e.pos.clone().sub(c).normalize(), false); }
    if (mp && mp.active) {
      for (const p of mp.players.values()) { const pos = p.id === driver ? c : mp.posOf(p.id); if (!pos || p.dead) continue; const d = pos.distanceTo(c); if (d < R) mp.applyDamage(p.id, p.id === driver ? 70 : 150 * (1 - d / R) + 15, attacker ?? -1, c.clone(), false, 'vehicle'); }
    } else { const d = g.player.pos.distanceTo(c); if (d < R) g.player.damage(driver === 'local' ? 70 : 150 * (1 - d / R) + 15, c.clone()); }
  }
  burnLook() { this.mats.forEach(([m]) => { m.color.setRGB(0.05, 0.045, 0.04); if (m.emissive) m.emissive.setRGB(0, 0, 0); }); }
  // MP clients: apply a host snapshot entry
  applyNet(a) {
    const [x, y, z, yaw, speed, steer, hp, driver, dead] = a;
    this.target = { x, y, z, yaw }; this.speed = speed; this.steer = steer; this.hp = hp; this.driver = driver < 0 ? null : driver;
    if (dead && !this.dead) { this.dead = true; this.burnLook(); this.g.vehicles.boom(new THREE.Vector3(x, y + 1, z)); }
    if (!dead && this.dead) { const t = this.target; this.reset(); this.target = t; this.pos.set(x, y, z); this.yaw = yaw; this.driver = driver < 0 ? null : driver; }
  }
  netSmooth(dt) {
    const t = this.target; if (!t) return;
    const k = Math.min(1, dt * 14);
    if (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 8) { this.pos.set(t.x, t.y, t.z); this.yaw = t.yaw; }
    // extrapolate a little along the heading (snapshots are ~50 ms apart)
    this.pos.x += (t.x - this.pos.x) * k; this.pos.y += (t.y - this.pos.y) * k; this.pos.z += (t.z - this.pos.z) * k;
    let dy = t.yaw - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; this.yaw += dy * k;
    this.spin += this.speed * dt / this.wheelR;
    if (this.dead) { this.wreckT = (this.wreckT || 0) + dt; if (this.wreckT < 14 && Math.random() < dt * 10) this.g.fx.puff(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, this.h * 0.8, (Math.random() - 0.5) * 2)), 0x1c1c1c, 0.9, 2.5, 0.55, new THREE.Vector3(0.3, 1.6, 0.2), 2.4); }
    this.place(); this.animate();
  }
  netState() { const r = (v) => Math.round(v * 100) / 100; return [r(this.pos.x), r(this.pos.y), r(this.pos.z), r(this.yaw), r(this.speed), r(this.steer), Math.ceil(this.hp), this.driver ?? -1, this.dead ? 1 : 0]; }
}

// All vehicles + the local player's enter / exit, chase camera and HUD.
export class Vehicles {
  constructor(g) {
    this.g = g;
    const sp = g.world.vehicleSpawns; this.list = [new Vehicle(g, 0, 'pickup_armored', ...sp[0]), new Vehicle(g, 1, 'truck_armored', ...sp[1])];
    this.engine = null;
  }
  reset() { for (const v of this.list) v.reset(); this.leaveLocal(); }
  // v1.5 maps: new parking spots; the world was rebuilt so the vehicle colliders are registered again
  setSpawns(list) {
    this.list.forEach((v, i) => { const s = list[i] || list[0]; v.home = { x: s[0], z: s[1], yaw: s[2] }; for (const b of v.boxes) if (!this.g.world.boxes.includes(b)) this.g.world.boxes.push(b); });
    this.reset();
  }
  // nearest enterable vehicle for the local player
  nearby() {
    const p = this.g.player; if (p.dead || p.vehicle || p.vehTrans) return null; let best = null, bd = 2.6;
    for (const v of this.list) { if (v.dead || v.driver != null || Math.abs(p.pos.y - v.pos.y) > 1.2) continue; const d = v.rectDist(p.pos); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  use() { // E / touch button
    const g = this.g, p = g.player, mp = g.mp, mpOn = mp && mp.active; if (p.vehTrans) return;
    if (p.vehicle) { if (mpOn && !mp.isHost) mp.net.broadcast({ t: 'vx' }); else this.eject(p.vehicle); return; }
    const v = this.nearby(); if (!v) return;
    if (mpOn && !mp.isHost) { mp.net.broadcast({ t: 've', v: v.idx }); return; }
    this.enter(v, mpOn ? mp.myId : 'local');
  }
  enter(v, who) {
    if (v.dead || v.driver != null) return false;
    v.driver = who; v.input = { th: 0, st: 0, hb: 0 };
    if (this.isMe(who)) this.enterLocal(v);
    return true;
  }
  isMe(who) { const mp = this.g.mp; return who === 'local' || (mp && mp.active && who === mp.myId); }
  enterLocal(v, animate = true) {
    const g = this.g, p = g.player; p.vehicle = v; p.crouchToggle = false; p.aiming = false; p.reloading = 0; p.healT = 0;
    p.yaw = v.yaw + Math.PI; p.pitch = -0.12; g.camBack = 6;
    document.body.classList.add('driving'); g.sfx.ui('press'); this.startEngine(); g.touch && g.touch.reset();
    g.hud.toast && g.hud.toast(v.name);
    const c = p.c; c.ikTarget = 0; c.upperTarget = 0;
    if (!animate || p.dead) { p.vehTrans = null; this.poseDriver(c, v); return; }
    // walk to the driver's door, then climb in and turn to face forward (camera blends to the chase view)
    const from = p.pos.clone(), door = v.doorPos(); door.y = from.y;
    const a = THREE.MathUtils.clamp(from.distanceTo(door) / 3.2, 0.12, 0.55);
    p.vehTrans = { dir: 'in', v, t: 0, a, dur: a + 0.6, from, door, camP: g.camera.position.clone(), camQ: g.camera.quaternion.clone() };
  }
  // the seated driver: crouched pose sitting in the cab, gun stowed, facing forward
  poseDriver(c, v) {
    c.root.visible = true; c.root.position.copy(v.driverSeat()); c.yaw = v.yaw + Math.PI; c.aimPitch = 0; c.upperTarget = 0; c.ikTarget = 0;
    c.play('idle crouching', { fade: 0.25 }); if (c.gun) c.gun.visible = false;
  }
  exitSpot(v) {
    const g = this.g;
    // step out on the driver's side, else the other side, else behind / in front
    const tries = [v.right().multiplyScalar(v.hw + 0.8), v.right().multiplyScalar(-(v.hw + 0.8)), v.fwd().multiplyScalar(-(v.hl + 0.8)), v.fwd().multiplyScalar(v.hl + 0.8)];
    const boxes = g.world.boxes.filter(b => b.owner !== v);
    let spot = null;
    for (const o of tries) { const c = v.pos.clone().add(o); c.y = v.pos.y; const c0 = c.clone(); resolveCircle(boxes, c, 0.4, 1.8); if (c.distanceTo(c0) < 0.3) { spot = c; break; } }
    if (!spot) spot = v.pos.clone().add(tries[0]);
    spot.y = groundHeight(g.world.boxes, spot, 0.36, 1.5);
    return spot;
  }
  leaveLocal(animate = false) {
    const g = this.g, p = g.player; if (!p.vehicle) { if (p.vehTrans && !animate) this.finishTrans(); return; }
    const v = p.vehicle; p.vehicle = null; document.body.classList.remove('driving'); this.stopEngine();
    const spot = this.exitSpot(v);
    if (animate && !p.dead) { // climb out to the door, then step clear
      const seat = v.driverSeat(), door = spot.clone();
      p.vehTrans = { dir: 'out', v, t: 0, a: 0.45, dur: 0.8, from: seat, door, spot, camP: g.camera.position.clone(), camQ: g.camera.quaternion.clone() };
      p.pos.copy(seat); p.vel.set(0, 0, 0); g.camBack = 0.6; return;
    }
    p.vehTrans = null; p.pos.copy(spot); p.vel.set(0, 0, 0); p.c.root.visible = !p.dead; p.c.root.position.copy(spot); this.restoreGun();
  }
  restoreGun() { const c = this.g.player.c; if (c.gun) c.gun.visible = true; c.ikTarget = 1; }
  finishTrans() { const p = this.g.player, tr = p.vehTrans; p.vehTrans = null; if (!tr) return; if (tr.dir === 'in' && p.vehicle) this.poseDriver(p.c, p.vehicle); else { p.pos.copy(tr.spot || tr.door); p.c.root.position.copy(p.pos); this.restoreGun(); p.c.play('idle', { fade: 0.25 }); } }
  // animated enter / exit step (runs before the player update)
  transStep(dt) {
    const g = this.g, p = g.player, tr = p.vehTrans, c = p.c, v = tr.v; tr.t += dt;
    const face = (d) => { if (d.lengthSq() > 1e-4) return Math.atan2(-d.x, -d.z); return c.yaw; };
    const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
    const ease = (k) => k * k * (3 - 2 * k), seat = v.driverSeat();
    if (tr.dir === 'in') {
      if (tr.t < tr.a) { const k = tr.t / tr.a; p.pos.copy(tr.from).lerp(tr.door, k); c.yaw = lerpAng(c.yaw, face(tr.door.clone().sub(tr.from)), Math.min(1, dt * 14)); c.play('walk forward', { fade: 0.15 }); }
      else { const k = ease(Math.min(1, (tr.t - tr.a) / (tr.dur - tr.a))); p.pos.copy(tr.door).lerp(seat, k); c.yaw = lerpAng(face(v.right().negate()), v.yaw + Math.PI, Math.min(1, k * 1.6)); c.play('idle crouching', { fade: 0.22 }); if (k > 0.25 && c.gun) c.gun.visible = false; }
    } else {
      if (tr.t < tr.a) { const k = ease(tr.t / tr.a); const door = v.doorPos(); door.y = tr.spot.y; p.pos.copy(seat).lerp(door, k); c.yaw = lerpAng(v.yaw + Math.PI, face(v.right()), Math.min(1, k * 1.5)); c.play('idle crouching', { fade: 0.2 }); }
      else { const k = Math.min(1, (tr.t - tr.a) / (tr.dur - tr.a)); const door = v.doorPos(); door.y = tr.spot.y; p.pos.copy(door).lerp(tr.spot, k); c.play('walk forward', { fade: 0.2 }); if (c.gun) c.gun.visible = true; }
    }
    c.root.visible = true; c.root.position.copy(p.pos); p.vel.set(0, 0, 0);
    if (tr.t >= tr.dur) this.finishTrans();
  }
  eject(v, exploded = false) {
    const who = v.driver; if (who == null) return; v.driver = null; v.input = { th: 0, st: 0, hb: 0 };
    if (this.isMe(who)) this.leaveLocal(!exploded);
  }
  driverInput(inp) { // local keys / joystick -> { th, st, hb }
    const k = inp.keys; let th = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), st = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const dv = inp.drive; if (dv && !th && !st) { th = (dv.gas ? 1 : 0) - (dv.brake ? 1 : 0); st = (dv.r ? 1 : 0) - (dv.l ? 1 : 0); }
    const j = inp.joy; if (j && j.active && !th && !st) { const m = Math.hypot(j.x, j.y); if (m > 0.15) { th = THREE.MathUtils.clamp(-j.y * 1.4, -1, 1); st = THREE.MathUtils.clamp(j.x * 1.3, -1, 1); } }
    return { th, st, hb: k.Space ? 1 : 0 };
  }
  update(dt, inp) {
    const g = this.g, p = g.player, mp = g.mp, mpOn = mp && mp.active, client = mpOn && !mp.isHost;
    if (inp.usePressed) { inp.usePressed = false; if (!p.dead) this.use(); }
    if (p.vehicle && p.dead) this.eject(p.vehicle);
    if (p.vehTrans && p.dead) this.finishTrans();
    if (p.vehicle) { const ip = p.vehTrans ? { th: 0, st: 0, hb: 1 } : this.driverInput(inp); this.localInput = ip; if (!client) p.vehicle.input = ip; inp.jumpPressed = false; }
    if (client) for (const v of this.list) v.netSmooth(dt);
    else for (const v of this.list) {
      if (mpOn && v.driver != null && v.driver !== mp.myId) { const dp = mp.players.get(v.driver); if (!dp || dp.dead) this.eject(v); else v.input = dp.vin || { th: 0, st: 0, hb: 0 }; }
      v.update(dt);
    }
    // the local driver rides along
    if (p.vehicle) {
      const v = p.vehicle; if (!p.vehTrans) { p.pos.copy(v.seat()); p.vel.copy(v.fwd()).multiplyScalar(v.speed); }
      // camera swings behind the vehicle when driving and the mouse is idle
      if (Math.abs(v.speed) > 2 && g.time - (g.lastLook || -9) > 1.2) { let d = v.yaw + Math.PI - p.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.yaw += d * Math.min(1, dt * 2.2); p.pitch += (-0.16 - p.pitch) * Math.min(1, dt * 2); }
      this.updateEngine(v);
    }
    if (p.vehTrans) this.transStep(dt);
    document.body.classList.toggle('cannear', !p.vehicle && !p.vehTrans && !!this.nearby());
    this.hud();
  }
  hud() {
    const g = this.g, p = g.player, el = document.getElementById('vehbox'), pr = document.getElementById('useprompt'); if (!el) return;
    const v = p.vehicle, near = !v && this.nearby();
    if (v) {
      const kmh = Math.round(Math.abs(v.speed) * 3.6), hp = Math.max(0, v.hp / v.spec.hp);
      if (el._k !== kmh + '|' + Math.round(hp * 100)) { el._k = kmh + '|' + Math.round(hp * 100); el.innerHTML = `<div class="vn">${v.name}${g.mobile ? '' : '<span class="vk"><kbd>E</kbd> EXIT</span>'}</div><div class="vs"><b>${kmh}</b><small>KM/H</small></div><div class="vh"><i style="width:${(hp * 100).toFixed(0)}%" class="${hp < 0.3 ? 'low' : ''}"></i></div>`; }
    }
    el.classList.toggle('hidden', !v);
    const txt = v || p.vehTrans ? '' : near ? (g.mobile ? '' : `<kbd>E</kbd>${icon('car')}<b>ENTER</b><small>${near.name}</small>`) : '';
    if (pr && pr._t !== txt) { pr._t = txt; pr.innerHTML = txt; pr.classList.toggle('hidden', !txt); }
    const lab = v ? 'EXIT' : 'DRIVE'; const tl = document.getElementById('tUseL'); if (tl && tl._t !== lab) { tl._t = lab; tl.textContent = lab; }
  }
  // explosion visuals + sound (everyone)
  boom(c) {
    const g = this.g;
    g.fx.explosion ? g.fx.explosion(c) : null; g.sfx.explosion && g.sfx.explosion(c);
    const d = g.camera.position.distanceTo(c); if (d < 30) g.shake = Math.min(3, g.shake + (30 - d) / 10);
  }
  startEngine() { const s = this.g.sfx; if (!s.ctx || this.engine) return; try { this.engine = s.engineLoop(); } catch (e) { this.engine = null; } }
  stopEngine() { if (this.engine) { try { this.engine.stop(); } catch (e) {} this.engine = null; } }
  updateEngine(v) { if (this.engine) this.engine.set(Math.abs(v.speed) / v.spec.max, v.input ? Math.abs(v.input.th) : 0); }
  netStates() { return this.list.map(v => v.netState()); }
  applyNet(arr) { arr.forEach((a, i) => this.list[i] && this.list[i].applyNet(a)); const g = this.g, mp = g.mp, me = mp.myId; for (const v of this.list) { if (v.driver === me && g.player.vehicle !== v && !g.player.dead) this.enterLocal(v); if (g.player.vehicle === v && v.driver !== me) this.leaveLocal(true); } }
}

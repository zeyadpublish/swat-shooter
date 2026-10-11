// Visual effects: muzzle flash, tracers, sparks, dust, blood, bullet-hole decals, shell casings.
import * as THREE from 'three';

function radialTex(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size); return new THREE.CanvasTexture(c);
}
function flashTex() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  g.translate(s / 2, s / 2); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    g.save(); g.rotate(i / 7 * Math.PI * 2 + Math.random() * 0.4);
    const gr = g.createLinearGradient(0, 0, s / 2, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.4, 'rgba(255,170,60,0.7)'); gr.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, -10); g.lineTo(s / 2 * (0.6 + Math.random() * 0.4), 0); g.lineTo(0, 10); g.fill(); g.restore();
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, s / 4); r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = r; g.fillRect(-s / 2, -s / 2, s, s); return new THREE.CanvasTexture(c);
}
function holeTex() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(5,5,5,1)'); r.addColorStop(0.18, 'rgba(15,13,12,1)'); r.addColorStop(0.3, 'rgba(40,36,32,0.85)'); r.addColorStop(0.6, 'rgba(60,55,50,0.25)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(20,18,16,0.6)'; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, l = 20 + Math.random() * 30; g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * l, s / 2 + Math.sin(a) * l); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    const flashMat = new THREE.MeshBasicMaterial({ map: flashTex(), color: new THREE.Color(6, 4.5, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    this.flashMat = flashMat;
    this.flashes = [];
    // tracers
    this.tracers = [];
    const tGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.tracerMatP = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 6, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.tracerMatE = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 3, 1.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(tGeo, this.tracerMatP); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, life: 0, age: 0 }); }
    // sparks (points)
    this.NS = 400; this.spPos = new Float32Array(this.NS * 3); this.spVel = new Float32Array(this.NS * 3); this.spLife = new Float32Array(this.NS); this.spIdx = 0;
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(this.spPos, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(10, 5, 1.5), size: 0.035, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sparks.frustumCulled = false; scene.add(this.sparks);
    for (let i = 0; i < this.NS; i++) this.spPos[i * 3 + 1] = -100;
    // puffs (dust/blood/smoke)
    this.puffTex = radialTex([[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
    this.puffs = [];
    for (let i = 0; i < 60; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s); this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 });
    }
    this.pi = 0;
    // decals
    this.holeMat = new THREE.MeshStandardMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.95, metalness: 0 });
    this.decalGeo = new THREE.PlaneGeometry(0.11, 0.11);
    this.decals = []; this.di = 0;
    // shell casings
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 });
    const cg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8);
    this.shells = []; for (let i = 0; i < 30; i++) { const m = new THREE.Mesh(cg, brass); m.visible = false; m.castShadow = false; scene.add(m); this.shells.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }); }
    this.si = 0;
    // flash lights
    this.light = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(this.light); this.lightLife = 0;
    // explosions: additive fireball sprites + a big short-lived light
    this.fire = [];
    for (let i = 0; i < 18; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color: new THREE.Color(9, 4, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false })); s.visible = false; scene.add(s); this.fire.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1 }); }
    this.boomLife = 0; // the explosion reuses the muzzle-flash light (one point light in the scene keeps shaders cheap)
  }
  muzzleFlash(muzzle, dir, withLight = true, scale = 1) {
    const p = muzzle.getWorldPosition(new THREE.Vector3());
    let f = this.flashes.find(x => x.life <= 0);
    if (!f) {
      if (this.flashes.length >= 12) f = this.flashes[0];
      else {
        const g = new THREE.Group(); const pl = new THREE.PlaneGeometry(1, 1);
        const a = new THREE.Mesh(pl, this.flashMat), b = new THREE.Mesh(pl, this.flashMat), c = new THREE.Mesh(pl, this.flashMat);
        a.rotation.y = Math.PI / 2; b.rotation.y = Math.PI / 2; b.rotation.x = Math.PI / 2; a.position.z = b.position.z = 0.12; a.scale.set(0.28, 0.12, 1); b.scale.set(0.28, 0.12, 1);
        a.scale.set(1, 1, 1); a.scale.x = 0.3; a.scale.y = 0.14; b.scale.x = 0.3; b.scale.y = 0.14; c.scale.setScalar(0.16);
        g.add(a, b, c); this.scene.add(g); f = { g, c, life: 0 }; this.flashes.push(f);
      }
    }
    f.g.visible = true; f.life = 0.05; f.g.position.copy(p);
    f.g.lookAt(p.clone().add(dir)); f.g.rotateZ(Math.random() * Math.PI);
    f.g.scale.setScalar(scale * (0.8 + Math.random() * 0.5));
    if (withLight && this.boomLife <= 0) { this.light.position.copy(p); this.light.intensity = 25; this.lightLife = 0.05; }
    // smoke wisp
    this.puff(p, 0xb0b0b0, 0.08, 0.6, 0.25, new THREE.Vector3(0, 0.3, 0).addScaledVector(dir, 0.5), 2.0);
  }
  // Tracer: a short bright streak that races from the muzzle to the impact and is gone within ~90 ms
  // (age-capped, so it can never linger at low frame rates or on very long misses).
  tracer(from, to, enemy = false) {
    let t = this.tracers.find(x => x.life <= 0);
    if (!t) { t = this.tracers.reduce((a, b) => (b.age > a.age ? b : a)); } // recycle the oldest
    const d = to.clone().sub(from); const len = d.length(); if (len < 1.5) return;
    t.m.material = enemy ? this.tracerMatE : this.tracerMatP;
    d.divideScalar(len); let L = Math.min(len, 160);
    if (this.cam) { // never let a streak end right in front of the lens (incoming fire would draw a huge bar)
      const cp = this.cam.position, along = (cp.x - from.x) * d.x + (cp.y - from.y) * d.y + (cp.z - from.z) * d.z;
      if (along > 0 && along < L + 2.5) { const cx = from.x + d.x * along - cp.x, cy = from.y + d.y * along - cp.y, cz = from.z + d.z * along - cp.z; if (cx * cx + cy * cy + cz * cz < 2.25) L = Math.min(L, along - 3); }
      if (L < 1.5) return;
    }
    t.from = from.clone(); t.dir = d; t.len = L; t.dist = 0.6; t.life = 1; t.age = 0; t.m.visible = true;
    t.speed = Math.max(700, t.len / 0.07); t.streak = Math.min(2.2, 0.6 + t.len * 0.06);
  }
  sparksAt(p, n, normal, color) {
    for (let k = 0; k < n; k++) {
      const i = this.spIdx = (this.spIdx + 1) % this.NS;
      this.spPos[i * 3] = p.x; this.spPos[i * 3 + 1] = p.y; this.spPos[i * 3 + 2] = p.z;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(4).addScaledVector(normal, 3 + Math.random() * 4);
      this.spVel[i * 3] = v.x; this.spVel[i * 3 + 1] = v.y; this.spVel[i * 3 + 2] = v.z; this.spLife[i] = 0.25 + Math.random() * 0.35;
    }
  }
  puff(p, color, size, life, opacity, vel, grow = 3) {
    const q = this.puffs[this.pi = (this.pi + 1) % this.puffs.length];
    q.s.visible = true; q.s.position.copy(p); q.s.material.color.set(color); q.s.material.opacity = opacity; q.s.material.rotation = Math.random() * 6.28;
    q.base = opacity; q.s.scale.setScalar(size); q.size = size; q.life = q.max = life; q.vel.copy(vel || new THREE.Vector3()); q.grow = grow;
  }
  impact(point, normal, kind) {
    const n = normal.clone();
    this.sparksAt(point, kind === 'metal' ? 14 : kind === 'wood' ? 3 : kind === 'sand' ? 1 : 7, n);
    const col = kind === 'wood' ? 0x8a7458 : kind === 'metal' ? 0x9a9a9a : kind === 'sand' ? 0x9c8a66 : 0xa59e92;
    for (let i = 0; i < 2; i++) this.puff(point.clone().addScaledVector(n, 0.05), col, 0.15, 0.9, 0.55, n.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.25, 0)), 4);
    this.decal(point, n);
  }
  blood(point, dir) {
    for (let i = 0; i < 3; i++) this.puff(point.clone().addScaledVector(dir, 0.05 * i), 0x5a0808, 0.12 + i * 0.05, 0.45, 0.85, dir.clone().multiplyScalar(1.2 + i).add(new THREE.Vector3(0, -0.4, 0)), 2.5);
  }
  decal(point, normal) {
    let m = this.decals[this.di];
    if (!m) { m = new THREE.Mesh(this.decalGeo, this.holeMat); m.receiveShadow = true; this.scene.add(m); this.decals[this.di] = m; }
    this.di = (this.di + 1) % 150;
    m.position.copy(point).addScaledVector(normal, 0.004);
    m.lookAt(point.clone().add(normal)); m.rotateZ(Math.random() * 6.28); m.scale.setScalar(0.7 + Math.random() * 0.6);
  }
  explosion(c) {
    for (const f of this.fire) {
      f.s.visible = true; f.life = f.max = 0.45 + Math.random() * 0.5; f.size = 1.2 + Math.random() * 1.6;
      f.s.position.copy(c).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.2, (Math.random() - 0.5) * 1.6));
      f.vel.set((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6); f.s.scale.setScalar(f.size);
    }
    for (let i = 0; i < 12; i++) this.puff(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)), 0x222222, 1.6 + Math.random(), 2.5 + Math.random() * 1.5, 0.7, new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3), 2.5);
    this.sparksAt(c, 70, new THREE.Vector3(0, 1, 0)); this.sparksAt(c, 50, new THREE.Vector3(0, 0.4, 0));
    this.light.position.copy(c).add(new THREE.Vector3(0, 1.5, 0)); this.light.distance = 30; this.light.color.set(0xff8a3a); this.light.intensity = 900; this.boomLife = 0.6; this.lightLife = 0;
  }
  shell(char) {
    const s = this.shells[this.si = (this.si + 1) % this.shells.length];
    char.eject.getWorldPosition(s.m.position);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), char.yaw);
    s.v.copy(right).multiplyScalar(1.6 + Math.random()).add(new THREE.Vector3(0, 2 + Math.random(), 0));
    s.w.set(Math.random() * 20, Math.random() * 20, Math.random() * 20); s.life = 2.5; s.m.visible = true; s.floor = char.root.position.y + 0.006;
  }
  update(dt) {
    for (const f of this.flashes) if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.g.visible = false; }
    if (this.lightLife > 0) { this.lightLife -= dt; if (this.lightLife <= 0) this.light.intensity = 0; }
    if (this.boomLife > 0) { this.boomLife -= dt; this.light.intensity = Math.max(0, 900 * (this.boomLife / 0.6) ** 2); if (this.boomLife <= 0) { this.light.distance = 9; this.light.color.set(0xffb060); this.light.intensity = 0; } }
    for (const f of this.fire) if (f.life > 0) {
      f.life -= dt; const k = 1 - f.life / f.max; f.s.position.addScaledVector(f.vel, dt); f.vel.multiplyScalar(1 - 3 * dt);
      f.s.scale.setScalar(f.size * (1 + k * 1.8)); f.s.material.opacity = (1 - k) * (1 - k) * 0.95; if (f.life <= 0) f.s.visible = false;
    }
    for (const t of this.tracers) if (t.life > 0) {
      t.age += dt; t.dist += t.speed * Math.min(dt, 0.03);
      const head = Math.min(t.dist, t.len), tail = Math.max(0, head - t.streak);
      if (tail >= t.len - 0.01 || t.age > 0.09) { t.life = 0; t.m.visible = false; continue; }
      const hp = t.from.clone().addScaledVector(t.dir, head);
      t.m.position.copy(hp); t.m.lookAt(hp.clone().add(t.dir)); t.m.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    let any = false;
    for (let i = 0; i < this.NS; i++) if (this.spLife[i] > 0) {
      any = true; this.spLife[i] -= dt; this.spVel[i * 3 + 1] -= 9.8 * dt;
      this.spPos[i * 3] += this.spVel[i * 3] * dt; this.spPos[i * 3 + 1] += this.spVel[i * 3 + 1] * dt; this.spPos[i * 3 + 2] += this.spVel[i * 3 + 2] * dt;
      if (this.spLife[i] <= 0) this.spPos[i * 3 + 1] = -100;
    }
    if (any) this.sparks.geometry.attributes.position.needsUpdate = true;
    for (const q of this.puffs) if (q.life > 0) {
      q.life -= dt; const k = 1 - q.life / q.max;
      q.s.position.addScaledVector(q.vel, dt); q.vel.multiplyScalar(1 - 2 * dt);
      q.s.scale.setScalar(q.size * (1 + k * q.grow)); q.s.material.opacity = q.base * (1 - k) * (1 - k);
      if (q.life <= 0) q.s.visible = false;
    }
    for (const s of this.shells) if (s.life > 0) {
      s.life -= dt; s.v.y -= 9.8 * dt; s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      if (s.m.position.y < (s.floor || 0.006)) { s.m.position.y = s.floor || 0.006; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; s.w.multiplyScalar(0.5); if (s.onBounce && Math.abs(s.v.y) > 0.3) s.onBounce(s.m.position); }
      if (s.life <= 0) s.m.visible = false;
    }
  }
}

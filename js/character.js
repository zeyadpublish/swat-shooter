// Character instances built from the SWAT GLB: skeleton clone, tint, procedural rifle, animation controller,
// procedural aim pitch on the spine, and bone-driven hitboxes.
import * as THREE from 'three';
import * as SkeletonUtils from '../libs/three/addons/utils/SkeletonUtils.js';

export const DIRS = ['forward', 'forward right', 'right', 'backward right', 'backward', 'backward left', 'left', 'forward left'];
export const GAIT_SPEED = { walk: 1.84, run: 4.6, sprint: 6.9, crouch: 1.96 };
export function locoClip(gait, dirIndex) {
  const d = DIRS[dirIndex];
  if (gait === 'crouch') return 'walk crouching ' + d;
  return gait + ' ' + d;
}
export function dirIndexFromInput(strafe, fwd) { // strafe +right, fwd +forward
  const a = Math.atan2(strafe, fwd); // 0 = forward, +pi/2 = right
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

// Guns (see weapons.js). The outer group's origin is the grip point so it can be parented straight onto the right-hand bone.
export function buildGun(template, def) {
  const outer = new THREE.Group(); const inner = template.clone(true); inner.position.fromArray(def.grip).negate(); outer.add(inner);
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const muzzle = new THREE.Object3D(); muzzle.position.fromArray(def.muzzle); inner.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.fromArray(def.eject); inner.add(eject);
  return { group: outer, muzzle, eject, mag: (def.magNode && inner.getObjectByName(def.magNode)) || new THREE.Object3D(), def };
}

// Some gun models ship as skinned meshes (rigged for animation). A plain clone() would leave them bound to the
// template's skeleton, so bake the current pose into static geometry once.
function unskin(scene) {
  scene.updateMatrixWorld(true); const list = []; scene.traverse(o => { if (o.isSkinnedMesh) list.push(o); });
  const v = new THREE.Vector3(), n = new THREE.Vector3(), a = new THREE.Vector3();
  for (const o of list) {
    o.skeleton.update(); const src = o.geometry, pos = src.attributes.position, nor = src.attributes.normal;
    const g = new THREE.BufferGeometry(); const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); a.copy(v); o.applyBoneTransform(i, a); a.toArray(P, i * 3);
      if (nor) { n.fromBufferAttribute(nor, i).multiplyScalar(0.01).add(v); o.applyBoneTransform(i, n); n.sub(a).normalize().toArray(N, i * 3); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (nor) g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g.computeVertexNormals();
    if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
    if (src.index) g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    const m = new THREE.Mesh(g, o.material); m.name = o.name; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
    o.parent.add(m); o.parent.remove(o);
  }
  return scene;
}

export class CharacterFactory {
  constructor(gltf, gunScenes, weapons) {
    this.template = gltf.scene; this.gunScenes = gunScenes; this.weapons = weapons;
    for (const k in gunScenes) unskin(gunScenes[k]);
    this.clips = {}; for (const c of gltf.animations) this.clips[c.name] = c;
    this.template.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.calibrateGun();
  }
  // Place the rifle so its barrel points from the right hand toward the left hand in the aiming pose.
  calibrateGun() {
    const root = new THREE.Group(); const model = SkeletonUtils.clone(this.template); model.scale.setScalar(0.01); root.add(model);
    const mixer = new THREE.AnimationMixer(model); mixer.clipAction(this.clips['idle aiming']).play(); mixer.update(0.0);
    root.updateMatrixWorld(true);
    const bone = (n) => model.getObjectByName('mixamorig' + n);
    const rh = bone('RightHand'), lh = bone('LeftHand'), rm = bone('RightHandMiddle1') || rh;
    const pR = rh.getWorldPosition(new THREE.Vector3()), pL = lh.getWorldPosition(new THREE.Vector3()), pM = rm.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3().subVectors(pL, pR); fwd.y *= 0.3; fwd.normalize(); fwd.lerp(new THREE.Vector3(0, 0, 1), 0.9).normalize();
    const up = new THREE.Vector3(0, 1, 0); const x = new THREE.Vector3().crossVectors(up, fwd).normalize(); const y = new THREE.Vector3().crossVectors(fwd, x);
    const qWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, fwd));
    const qHand = rh.getWorldQuaternion(new THREE.Quaternion());
    const grip = pR.clone().lerp(pM, 0.7).addScaledVector(y, -0.015);
    this.gunLocalQuat = qHand.invert().multiply(qWorld);
    this.gunLocalPos = rh.worldToLocal(grip.clone());
    this.gunScale = 1 / rh.getWorldScale(new THREE.Vector3()).x;
    this.debug = { fwd: fwd.toArray(), pR: pR.toArray(), pL: pL.toArray() };
  }
  create({ tint = null, isPlayer = false } = {}) { return new Character(this, tint, isPlayer); }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
export class Character {
  constructor(factory, tint, isPlayer) {
    this.f = factory;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(factory.template);
    this.model.scale.setScalar(0.01); this.model.rotation.y = Math.PI; // face -Z at yaw 0
    this.root.add(this.model);
    this.model.traverse(o => {
      if (o.isMesh) {
        if (Array.isArray(o.material)) o.material = o.material.map(m => this.tintMat(m, tint));
        else o.material = this.tintMat(o.material, tint);
      }
    });
    const b = (n) => this.model.getObjectByName('mixamorig' + n);
    this.bones = { hips: b('Hips'), spine: b('Spine'), spine1: b('Spine1'), spine2: b('Spine2'), neck: b('Neck'), head: b('Head'), rh: b('RightHand'), lh: b('LeftHand'), lf: b('LeftFoot'), rf: b('RightFoot'), top: b('HeadTop_End'), lk: b('LeftLeg'), rk: b('RightLeg') };
    this.guns = {}; this.setGun('m4a1');
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {}; this.current = null; this.currentName = '';
    this.aimPitch = 0; this.yaw = 0;
  }
  // swap the weapon model in the right hand (models are built once per character and cached)
  setGun(id) {
    if (this.gunId === id) return;
    if (this.gun) this.bones.rh.remove(this.gun);
    let g = this.guns[id];
    if (!g) {
      g = this.guns[id] = buildGun(this.f.gunScenes[id], this.f.weapons[id]);
      g.group.position.copy(this.f.gunLocalPos); g.group.quaternion.copy(this.f.gunLocalQuat); g.group.scale.setScalar(this.f.gunScale);
    }
    this.gunId = id; this.gun = g.group; this.muzzle = g.muzzle; this.eject = g.eject; this.mag = g.mag; this.mag.visible = true;
    this.gun.quaternion.copy(this.f.gunLocalQuat); this.gun.position.copy(this.f.gunLocalPos);
    this.bones.rh.add(this.gun); this.gun.updateMatrixWorld(true);
  }
  tintMat(m, tint) {
    const n = m.clone();
    n.roughness = 0.72; n.metalness = 0.0; n.envMapIntensity = 0.9;
    if (tint != null && !/head/i.test(m.name)) n.color = new THREE.Color(tint);
    return n;
  }
  action(name) {
    if (!this.actions[name]) {
      const clip = this.f.clips[name]; if (!clip) { console.warn('missing clip', name); return null; }
      this.actions[name] = this.mixer.clipAction(clip);
    }
    return this.actions[name];
  }
  // Crossfade to a clip. sync: keep normalized phase from current loop (directional locomotion)
  play(name, { fade = 0.2, once = false, sync = false, timeScale = 1, restart = false } = {}) {
    if (this.currentName === name && !restart) { if (this.current) this.current.timeScale = timeScale; return this.current; }
    const a = this.action(name); if (!a) return null;
    const prev = this.current;
    a.reset(); a.enabled = true; a.timeScale = timeScale;
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    if (sync && prev && prev.getClip().duration > 0) a.time = (prev.time / prev.getClip().duration) * a.getClip().duration;
    a.setEffectiveWeight(1);
    if (prev && prev !== a && fade > 0) { a.fadeIn(fade); prev.fadeOut(fade); }
    else if (prev && prev !== a) { prev.stop(); }
    // stop stale actions that have fully faded
    for (const k in this.actions) { const o = this.actions[k]; if (o !== a && o !== prev && o.isRunning() && o.getEffectiveWeight() < 0.01) o.stop(); }
    a.play();
    this.current = a; this.currentName = name;
    return a;
  }
  phase() { return this.current ? (this.current.time / this.current.getClip().duration) % 1 : 0; }
  update(dt) {
    this.root.rotation.y = this.yaw;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // procedural aim pitch distributed over the spine chain, around the character's right axis
    if (Math.abs(this.aimPitch) > 1e-3) {
      const right = _v.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      const per = this.aimPitch / 3;
      for (const bn of [this.bones.spine, this.bones.spine1, this.bones.spine2]) {
        _q.setFromAxisAngle(right, per);
        bn.parent.getWorldQuaternion(_q2);
        // local' = inv(parentWorld) * R * parentWorld * local
        const pInv = _q2.clone().invert();
        bn.quaternion.premultiply(_q2).premultiply(_q).premultiply(pInv);
        bn.updateMatrixWorld(true);
      }
    }
  }
  bonePos(name, out = new THREE.Vector3()) { return this.bones[name].getWorldPosition(out); }
  hitboxes() {
    const head = this.bonePos('head'); const neck = this.bonePos('neck'); const hips = this.bonePos('hips');
    const lf = this.bonePos('lf'), rf = this.bonePos('rf');
    const feet = lf.clone().add(rf).multiplyScalar(0.5);
    const headC = this.bones.top ? head.clone().lerp(this.bonePos('top'), 0.45) : head.clone().lerp(neck, -0.6);
    return { head: { c: headC, r: 0.14 }, torso: { a: hips, b: neck, r: 0.24 }, legs: { a: hips, b: feet, r: 0.2 } };
  }
  dispose(scene) {
    scene.remove(this.root); this.mixer.stopAllAction();
    this.model.traverse(o => { if (o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
  }
}

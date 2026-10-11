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
  constructor(gltf, gunScenes, weapons, extra = {}) {
    this.template = gltf.scene; this.gunScenes = gunScenes; this.weapons = weapons;
    for (const k in gunScenes) unskin(gunScenes[k]);
    this.clips = {}; for (const c of gltf.animations) this.clips[c.name] = c;
    this.template.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.calibrateGun();
    this.rigs = {}; for (const k in extra) this.rigs[k] = prepareRig(extra[k], this);
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
  // the upper-body part of a clip (spine, neck, head, arms, hands): layered over locomotion while aiming/firing
  upperClip(name) {
    this.upperClips = this.upperClips || {};
    if (this.upperClips[name]) return this.upperClips[name];
    const src = this.clips[name]; if (!src) return null;
    const re = /^mixamorig(Spine|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand)[^.]*\.quaternion$/;
    return (this.upperClips[name] = new THREE.AnimationClip(name + ' (upper)', src.duration, src.tracks.filter(t => re.test(t.name))));
  }
  create({ tint = null, isPlayer = false, look = null } = {}) {
    if (typeof tint === 'string') { look = tint; tint = null; } // appearance given as a look key
    const L = typeof look === 'string' ? LOOKS[look] : look;
    if (L && L.tint != null && tint == null) tint = L.tint;
    return new Character(this, tint, isPlayer, L && L.rig && this.rigs[L.rig] ? L : null);
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
export class Character {
  constructor(factory, tint, isPlayer, look) {
    this.f = factory; this.look = look;
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
    // default gun mount: the SWAT model's right hand
    this.gunQ = factory.gunLocalQuat; this.gunP = factory.gunLocalPos; this.gunS = factory.gunScale; this.gunBone = this.bones.rh;
    if (look) this.skin = new RigSkin(this, factory.rigs[look.rig], look);
    this.guns = {}; this.setGun('m4a1');
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {}; this.current = null; this.currentName = '';
    this.aimPitch = 0; this.yaw = 0;
    // procedural layers: breathing sway, per-shot recoil kick, upper-body aim layer over locomotion
    this.breath = Math.random() * 10; this.kickV = 0; this.upperW = 0; this.upperTarget = 0; this.upperName = 'idle aiming'; this.upper = {};
  }
  kick(a = 1) { this.kickV = Math.min(1.6, this.kickV + a); }
  // swap the weapon model in the right hand (models are built once per character and cached)
  setGun(id) {
    if (this.gunId === id) return;
    if (this.gun) this.gunBone.remove(this.gun);
    let g = this.guns[id];
    if (!g) {
      g = this.guns[id] = buildGun(this.f.gunScenes[id], this.f.weapons[id]);
      g.group.scale.setScalar(this.gunS);
    }
    this.gunId = id; this.gun = g.group; this.muzzle = g.muzzle; this.eject = g.eject; this.mag = g.mag; this.mag.visible = true;
    this.gun.quaternion.copy(this.gunQ); this.gun.position.copy(this.gunP);
    this.gunBone.add(this.gun); this.gun.updateMatrixWorld(true);
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
    // upper-body aim layer: arms/spine hold the aiming pose while the legs keep their locomotion clip
    const dying = /^death/.test(this.currentName);
    const tgt = dying ? 0 : this.upperTarget;
    this.upperW += (tgt - this.upperW) * Math.min(1, dt * (tgt > this.upperW ? 14 : 6));
    const ua = this.upperW > 0.01 || this.upperAct ? this.upperAction(this.upperName) : null;
    if (ua) { if (this.upperW > 0.01) { if (!ua.isRunning()) ua.play(); ua.setEffectiveWeight(this.upperW * 14); } else { ua.setEffectiveWeight(0); ua.stop(); } }
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // aim pitch + breathing + recoil kick, distributed over the spine chain around the character's right axis
    this.breath += dt; this.kickV *= Math.exp(-dt * 13);
    const br = dying ? 0 : Math.sin(this.breath * 1.7) * 0.012;
    const kick = -this.kickV * 0.05;
    const per = [this.aimPitch / 3 + br * 0.5, this.aimPitch / 3 + br * 0.3 + kick * 0.4, this.aimPitch / 3 + br * 0.2 + kick];
    if (Math.abs(per[0]) + Math.abs(per[1]) + Math.abs(per[2]) > 1e-4) {
      const right = _v.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      [this.bones.spine, this.bones.spine1, this.bones.spine2].forEach((bn, i) => {
        _q.setFromAxisAngle(right, per[i]);
        bn.parent.getWorldQuaternion(_q2);
        const pInv = _q2.clone().invert();
        bn.quaternion.premultiply(_q2).premultiply(_q).premultiply(pInv);
        bn.updateMatrixWorld(true);
      });
    }
    // gun mount (+ recoil: muzzle climbs and the gun slides back); the player adds reload/switch motion on top
    if (this.gun) {
      this.gun.quaternion.copy(this.gunQ); this.gun.position.copy(this.gunP);
      if (this.kickV > 0.002) { this.gun.rotateX(-this.kickV * 0.09); this.gun.translateZ(-this.kickV * 0.035 * this.gunS); }
    }
    if (this.skin) this.skin.update();
  }
  upperAction(name) {
    if (this.upperActName !== name && this.upperAct) { this.upperAct.stop(); this.upperAct = null; }
    if (!this.upperAct) { const clip = this.f.upperClip(name); if (!clip) return null; this.upperAct = this.mixer.clipAction(clip); this.upperActName = name; this.upperAct.setLoop(THREE.LoopRepeat, Infinity); }
    return this.upperAct;
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
    if (this.skin) this.skin.dispose();
    this.model.traverse(o => { if (o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Extra soldiers: Quaternius CC0 characters (their "CharacterArmature" rig) driven by the SWAT model's Mixamo
// skeleton. The SWAT skeleton keeps running every clip (49 Mixamo animations, aim pitch, hitboxes, gun mount);
// its mesh is hidden and each frame the visible character's bones copy the Mixamo bones' world rotations
// through a per-bone offset measured once in a shared reference pose (bones pointing the same way).
const MAP = { Hips: 'Hips', Spine: 'Abdomen', Spine1: 'Torso', Spine2: 'Chest', Neck: 'Neck', Head: 'Head' };
for (const [m, q] of [['Left', 'L'], ['Right', 'R']]) {
  // (three.js strips the '.' from node names: "UpperArm.L" loads as "UpperArmL")
  Object.assign(MAP, { [m + 'Shoulder']: 'Shoulder' + q, [m + 'Arm']: 'UpperArm' + q, [m + 'ForeArm']: 'LowerArm' + q, [m + 'Hand']: 'Wrist' + q,
    [m + 'UpLeg']: 'UpperLeg' + q, [m + 'Leg']: 'LowerLeg' + q, [m + 'Foot']: 'Foot' + q });
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let i = 1; i <= 3; i++) MAP[`${m}Hand${f}${i}`] = `${f}${i}${q}`;
  for (let i = 1; i <= 3; i++) MAP[`${m}HandThumb${i}`] = `Thumb${i}${q}`;
}
// bone -> the child used to measure its direction (Mixamo name, Quaternius name)
const AIM = [['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head']];
for (const m of ['Left', 'Right']) AIM.push([m + 'Shoulder', m + 'Arm'], [m + 'Arm', m + 'ForeArm'], [m + 'ForeArm', m + 'Hand'], [m + 'Hand', m + 'HandMiddle1'], [m + 'UpLeg', m + 'Leg'], [m + 'Leg', m + 'Foot'],
  ...['Index', 'Middle', 'Ring', 'Pinky'].flatMap(f => [[`${m}Hand${f}1`, `${m}Hand${f}2`], [`${m}Hand${f}2`, `${m}Hand${f}3`]]), [m + 'HandThumb1', m + 'HandThumb2'], [m + 'HandThumb2', m + 'HandThumb3']);

// Looks: which body and colours. Palettes recolour the flat-shaded Quaternius materials by name.
export const LOOKS = {
  swat: { name: 'SWAT', rig: null },
  swat_blue: { name: 'Blue SWAT', rig: null, tint: 0x4d6fae },
  op_black: { name: 'Tactical', rig: 'q_swat', palette: {} },
  op_blue: { name: 'Blue operator', rig: 'q_swat', palette: { Swat: 0x1f3a66, Swat_Black: 0x0e1626, Visor: 0x6fb4ff } },
  op_red: { name: 'Red operator', rig: 'q_swat', palette: { Swat: 0x5a1c16, Swat_Black: 0x1e0d0b, Visor: 0xff6a4a } },
  mil_olive: { name: 'Militia', rig: 'q_adv', palette: { Green: 0x3b4526, LightGreen: 0x55603a, Brown: 0x4a3c26, Brown2: 0x2d2418, Gold: 0x3a3a30 } },
  mil_desert: { name: 'Desert militia', rig: 'q_adv', palette: { Green: 0x8a7552, LightGreen: 0xa08a64, Brown: 0x6b5638, Brown2: 0x3d3122, Gold: 0x55493a } },
  mil_red: { name: 'Red militia', rig: 'q_adv', palette: { Green: 0x6e2a22, LightGreen: 0x8e3a2e, Brown: 0x3a2a20, Brown2: 0x251a14, Gold: 0x9e2c22 } },
  gunner: { name: 'Gunner', rig: 'q_worker', palette: { Worker_Yellow: 0x4d5338, Worker_Vest: 0x2e3324, LightBrown: 0x5a5444, Brown: 0x3a3226, Moustache: 0x1c140c } },
  gunner_red: { name: 'Red gunner', rig: 'q_worker', palette: { Worker_Yellow: 0x5c2620, Worker_Vest: 0x8a2a20, LightBrown: 0x4a3a30, Brown: 0x30241c } },
  insurgent: { name: 'Insurgent', rig: 'q_hoodie', palette: { Purple: 0x2c2f24, White: 0x55524a, LightBlue: 0x23262a } },
  raider: { name: 'Raider', rig: 'q_punk', palette: { Red: 0x3a3226, Red_Dark: 0x2a2620, White: 0x5d5a50, LightBlue: 0x262a2e } },
  scout: { name: 'Scout', rig: 'q_casual', palette: { White: 0x5f6250, Red_Dark: 0x3d3a2c, LightBlue: 0x2b2e26, LightBrown: 0x4a4436 } },
};
export const ENEMY_LOOKS = ['mil_olive', 'mil_desert', 'gunner', 'insurgent', 'raider', 'scout', null];
export const TEAM_LOOKS = [['op_blue', 'swat_blue'], ['mil_red', 'gunner_red', 'op_red']];
export const FFA_LOOKS = ['swat', 'op_black', 'mil_olive', 'gunner', 'insurgent', 'mil_desert', 'raider', 'scout', 'op_blue', 'op_red'];
export const enemyLook = (nid) => ENEMY_LOOKS[((nid || 0) * 5 + 3) % ENEMY_LOOKS.length];

const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function worldQ(o, out) { o.matrixWorld.decompose(_p, out, _s); return out; }

function prepareRig(gltf, factory) {
  const tpl = gltf.scene; tpl.updateMatrixWorld(true);
  // the Quaternius rig drives the feet by IK from the root; hang them under the shins so they follow the legs
  for (const q of ['L', 'R']) { const foot = tpl.getObjectByName('Foot' + q), shin = tpl.getObjectByName('LowerLeg' + q); if (foot && shin && foot.parent !== shin) shin.attach(foot); }
  tpl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }  });
  // reference poses: SWAT in its bind pose, the Quaternius model in its bind pose, both facing -Z like a Character
  const mRoot = new THREE.Group(), mModel = SkeletonUtils.clone(factory.template); mModel.scale.setScalar(0.01); mModel.rotation.y = Math.PI; mRoot.add(mModel);
  mRoot.updateMatrixWorld(true); // node rest transforms = bind poses (T-poses)
  const qRoot = new THREE.Group(), qModel = SkeletonUtils.clone(tpl); qModel.rotation.y = Math.PI; qRoot.add(qModel);
  qRoot.updateMatrixWorld(true);
  const M = (n) => mModel.getObjectByName('mixamorig' + n), Q = (n) => qModel.getObjectByName(MAP[n] || n);
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  // same facing? (the character's left arm on the same side)
  if (Math.sign(wp(M('LeftArm')).x) !== Math.sign(wp(Q('LeftArm')).x)) { qModel.rotation.y += Math.PI; qRoot.updateMatrixWorld(true); }
  const height = { m: wp(M('Hips')).y, q: wp(Q('Hips')).y };
  // align each Quaternius bone so it points where the matching SWAT bone points (parents first)
  for (const [a, b] of AIM) {
    const qa = Q(a), qb = Q(b), ma = M(a), mb = M(b); if (!qa || !qb || !ma || !mb) continue;
    const dq = wp(qb).sub(wp(qa)).normalize(), dm = wp(mb).sub(wp(ma)).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(dq, dm);
    const w = qa.getWorldQuaternion(new THREE.Quaternion()); const pw = qa.parent.getWorldQuaternion(new THREE.Quaternion());
    qa.quaternion.copy(pw.invert().multiply(rot.multiply(w))); qa.updateMatrixWorld(true);
  }
  // per-bone offset: Qworld = Mworld * off
  const map = [];
  for (const mn in MAP) {
    const mb = M(mn), qb = Q(mn); if (!mb || !qb) continue;
    const off = mb.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(qb.getWorldQuaternion(new THREE.Quaternion()));
    map.push({ m: 'mixamorig' + mn, q: qb.name, off });
  }
  // order the driven bones parents-first
  const order = []; qModel.traverse(o => { const e = map.find(x => x.q === o.name); if (e) order.push(e); });
  // gun mount on the Quaternius right wrist, same grip relative to the hand
  const mh = M('RightHand'), qh = Q('RightHand');
  const offH = order.find(e => e.q === qh.name).off;
  const gunQ = offH.clone().invert().multiply(factory.gunLocalQuat);
  const mhS = mh.getWorldScale(new THREE.Vector3()).x, qhS = qh.getWorldScale(new THREE.Vector3()).x;
  const pw = factory.gunLocalPos.clone().multiplyScalar(mhS).applyQuaternion(mh.getWorldQuaternion(new THREE.Quaternion()));
  const gunP = pw.applyQuaternion(qh.getWorldQuaternion(new THREE.Quaternion()).invert()).divideScalar(qhS);
  return { tpl, order, yaw: qModel.rotation.y, hipRatio: height.q / height.m, gunQ, gunP, gunS: 1 / qhS, hand: qh.name };
}

class RigSkin {
  constructor(ch, rig, look) {
    this.ch = ch; this.rig = rig;
    ch.model.traverse(o => { if (o.isMesh) o.visible = false; }); // the SWAT skeleton keeps animating, invisibly
    const m = this.model = SkeletonUtils.clone(rig.tpl); m.rotation.y = rig.yaw; ch.root.add(m);
    const pal = look.palette || {};
    m.traverse(o => { if (o.isMesh) {
      const fix = (mat) => { const n = mat.clone(); n.roughness = 0.82; n.metalness = 0; n.envMapIntensity = 0.8; if (pal[mat.name] != null) n.color = new THREE.Color(pal[mat.name]); return n; };
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    } });
    this.links = rig.order.map(e => ({ mb: ch.model.getObjectByName(e.m), qb: m.getObjectByName(e.q), off: e.off }));
    this.hips = m.getObjectByName('Hips'); this.mHips = ch.model.getObjectByName('mixamorigHips');
    // mount guns on this body's wrist instead of the hidden SWAT hand
    ch.gunBone = m.getObjectByName(rig.hand); ch.gunQ = rig.gunQ; ch.gunP = rig.gunP; ch.gunS = rig.gunS;
    this.wq = new THREE.Quaternion(); this.pq = new THREE.Quaternion();
  }
  update() {
    const m = this.model; m.updateMatrixWorld(true);
    // hips: follow the SWAT hips, scaled to this body's leg length
    const root = this.ch.root; root.matrixWorld.decompose(_p, _qa, _s);
    const hp = this.mHips.getWorldPosition(new THREE.Vector3()); const rel = hp.sub(_p).multiplyScalar(this.rig.hipRatio).add(_p);
    this.hips.parent.updateWorldMatrix(true, false); this.hips.position.copy(this.hips.parent.worldToLocal(rel));
    for (const L of this.links) {
      worldQ(L.mb, this.wq).multiply(L.off);
      L.qb.parent.updateWorldMatrix(false, false); worldQ(L.qb.parent, this.pq);
      L.qb.quaternion.copy(this.pq.invert().multiply(this.wq));
      L.qb.updateMatrix(); L.qb.matrixWorld.multiplyMatrices(L.qb.parent.matrixWorld, L.qb.matrix);
    }
    m.updateMatrixWorld(true);
  }
  dispose() { this.model.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => x.dispose()); }); }
}

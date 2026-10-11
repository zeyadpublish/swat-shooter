// Procedural urban/industrial arena with PBR (Poly Haven CC0) materials and box colliders.
import * as THREE from 'three';
import { Box, NavGrid } from './physics.js';

export const ARENA = 46;

function scaleBoxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return geo;
}

export class World {
  constructor(scene, renderer, manager) {
    this.scene = scene; this.renderer = renderer; this.manager = manager;
    this.boxes = []; this.meshes = []; this.group = new THREE.Group(); scene.add(this.group);
    this.texLoader = new THREE.TextureLoader(manager);
    this.texCache = {}; this.mats = {};
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  tex(name, srgb) {
    if (this.texCache[name]) return this.texCache[name];
    const t = this.texLoader.load('assets/tex/' + name + '.webp');
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return (this.texCache[name] = t);
  }
  pbr(set, opts = {}) {
    const key = set + JSON.stringify(opts);
    if (this.mats[key]) return this.mats[key];
    const arm = this.tex(set + '_arm');
    const m = new THREE.MeshStandardMaterial({
      map: this.tex(set + '_diff', true), normalMap: this.tex(set + '_nor_gl'),
      aoMap: arm, roughnessMap: arm, metalnessMap: arm, metalness: opts.metalness ?? 1, roughness: opts.roughness ?? 1,
      color: opts.color ?? 0xffffff, envMapIntensity: opts.env ?? 1,
    });
    m.normalScale.setScalar(opts.normal ?? 1);
    return (this.mats[key] = m);
  }
  addBox(x, z, w, h, d, mat, { y = 0, tile = 2, collide = true, shadow = true, kind = 'concrete' } = {}) {
    const geo = scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, tile);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y + h / 2, z);
    m.castShadow = shadow; m.receiveShadow = true; this.group.add(m); this.meshes.push(m);
    if (collide) this.boxes.push(new Box(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2), kind));
    return m;
  }
  container(x, z, rot90, color, y = 0) {
    const L = 6.06, W = 2.44, H = 2.59;
    const w = rot90 ? W : L, d = rot90 ? L : W;
    const mat = this.pbr('corrugated_iron', { color, roughness: 1, normal: 1.4 });
    this.addBox(x, z, w, H, d, mat, { y, tile: 2.2, kind: 'metal' });
    // dark steel corner posts and rails
    const steel = this.pbr('rusty_metal_02', { color: 0x4a4a4a });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.addBox(x + sx * (w / 2 - 0.08), z + sz * (d / 2 - 0.08), 0.18, H + 0.02, 0.18, steel, { y: y - 0.01, collide: false, tile: 1 });
    for (const yy of [y - 0.01, y + H - 0.14]) for (const s of [-1, 1]) {
      if (rot90) this.addBox(x + s * (w / 2 - 0.05), z, 0.12, 0.16, d + 0.02, steel, { y: yy, collide: false, tile: 1 });
      else this.addBox(x, z + s * (d / 2 - 0.05), w + 0.02, 0.16, 0.12, steel, { y: yy, collide: false, tile: 1 });
    }
  }
  crate(x, z, s = 1.2, y = 0, rot = 0) {
    const m = this.addBox(x, z, s, s, s, this.pbr('plywood', { color: 0xd8c8a8 }), { y, tile: 1.2, kind: 'wood' });
    m.rotation.y = rot; return m;
  }
  barrel(x, z, color, y0 = 0) {
    const geo = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 24);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.82 / 1.4, uv.getY(i) * 0.88 / 1.4);
    const m = new THREE.Mesh(geo, this.pbr('rusty_metal_02', { color })); m.position.set(x, y0 + 0.44, z);
    m.castShadow = m.receiveShadow = true; this.group.add(m); this.meshes.push(m);
    this.boxes.push(new Box(new THREE.Vector3(x - 0.29, y0, z - 0.29), new THREE.Vector3(x + 0.29, y0 + 0.88, z + 0.29), 'metal'));
  }
  jersey(x, z, rot90, y0 = 0.15) {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.12, 0.3); s.lineTo(0.08, 0.81); s.lineTo(-0.08, 0.81); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.08); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 });
    geo.translate(0, 0, -1.5);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    const m = new THREE.Mesh(geo, this.pbr('concrete_floor_worn_001', { color: 0xc9c5bd }));
    m.position.set(x, y0, z); if (!rot90) m.rotation.y = Math.PI / 2;
    m.castShadow = m.receiveShadow = true; this.group.add(m); this.meshes.push(m);
    const w = rot90 ? 0.6 : 3, d = rot90 ? 3 : 0.6;
    this.boxes.push(new Box(new THREE.Vector3(x - w / 2, y0, z - d / 2), new THREE.Vector3(x + w / 2, y0 + 0.81, z + d / 2), 'concrete'));
  }
  // ---------------------------------------------------------------- city assets
  async loadCity(gltfLoader) {
    const files = ['modular_urban_apartments_facade', 'modular_factory_facade', 'street_lamp_01', 'street_lamp_02', 'fire_hydrant', 'metal_trash_can', 'concrete_road_barrier', 'concrete_road_barrier_02', 'covered_car', 'modular_fire_escape', 'rollershutter_door', 'exterior_aircon_unit', 'trashbag', 'old_tyre', 'sedan'];
    const res = await Promise.all(files.map(f => gltfLoader.loadAsync('assets/city/' + f + '.glb')));
    this.kits = {}; files.forEach((f, i) => { const sc = res[i].scene; sc.updateMatrixWorld(true); this.kits[f] = sc; });
    // painted variants of the CC0 sedan (Innerscene)
    const paints = [0x7e1416, 0x1d3550, 0xa9adb2, 0x1b1c1e, 0xdcdad4, 0x3a4a3a];
    const sedan = this.kits.sedan; let bodyMat = null;
    sedan.traverse(o => { if (o.isMesh && o.material.name === 'blue') bodyMat = o.material; }); // body paint material
    paints.forEach((c, i) => {
      const v = sedan.clone(true); const m = bodyMat.clone(); m.color.set(c); m.metalness = 0.55; m.roughness = 0.28;
      v.traverse(o => { if (o.isMesh && o.material === bodyMat) o.material = m; }); v.updateMatrixWorld(true);
      this.kits['sedan_' + i] = v;
    });
    this.carN = 0;
    this.inst = new Map();
  }
  car(x, z, rot, opts = {}) { // alternate realistic sedans and tarp-covered cars
    const k = this.carN++;
    if (k % 3 === 2) return this.prop('covered_car', '.', x, z, rot, opts);
    return this.prop('sedan_' + (k % 6), '.', x, z, rot, opts);
  }
  // queue every mesh under `nodes` (relative to `origin` in kit space) for instanced drawing at world matrix M
  placeNodes(nodes, originM, M, opts = {}) {
    const inv = originM.clone().invert();
    for (const n of nodes) n.traverse(o => {
      if (!o.isMesh) return;
      const key = o.uuid + (opts.noShadow ? 'n' : '');
      let e = this.inst.get(key); if (!e) { e = { mesh: o, mats: [], shadow: !opts.noShadow }; this.inst.set(key, e); }
      e.mats.push(new THREE.Matrix4().multiplyMatrices(M, inv).multiply(o.matrixWorld));
    });
  }
  finalizeInstances() {
    for (const e of this.inst.values()) {
      const im = new THREE.InstancedMesh(e.mesh.geometry, e.mesh.material, e.mats.length);
      e.mats.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true;
      im.castShadow = e.shadow; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im);
    }
    this.inst.clear();
  }
  // ----- facade modules
  module(kitName, wallName) {
    const key = kitName + '/' + wallName; this.modCache = this.modCache || {};
    if (this.modCache[key]) return this.modCache[key];
    const kit = this.kits[kitName]; const wall = kit.getObjectByName(wallName);
    if (!wall) { console.warn('missing module', key); return null; }
    const wb = new THREE.Box3().setFromObject(wall);
    const nodes = [wall];
    for (const c of kit.children) {
      if (c === wall || /^(wall_|cornice|crown|dado|base)/.test(c.name)) continue;
      const b = new THREE.Box3().setFromObject(c); const ctr = b.getCenter(new THREE.Vector3());
      if (ctr.x > wb.min.x && ctr.x < wb.max.x && ctr.y > wb.min.y && ctr.y < wb.max.y && ctr.z > wb.max.z - 1.2 && ctr.z < wb.max.z + 0.6) nodes.push(c);
    }
    const origin = new THREE.Matrix4().makeTranslation(wb.min.x, wb.min.y, wb.max.z);
    return (this.modCache[key] = { nodes, origin, width: Math.round(wb.max.x - wb.min.x) });
  }
  trim(kitName, name) { // horizontal trim piece: origin at its min x, min y, z=front plane (z=0)
    const n = this.kits[kitName].getObjectByName(name); if (!n) return null; const b = new THREE.Box3().setFromObject(n);
    return { nodes: [n], origin: new THREE.Matrix4().makeTranslation(b.min.x, b.min.y, 0), width: b.max.x - b.min.x };
  }
  building(x0, z0, x1, z1, floors, kit, seed = 1, collide = true) {
    let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const K = kit === 'apt' ? 'modular_urban_apartments_facade' : 'modular_factory_facade';
    const ground = kit === 'apt'
      ? ['wall_door_centered_large_01', 'wall_standard_standard_01', 'wall_door_centered_small_01', 'wall_standard_standard_01', 'wall_door_centered_small_02', 'wall_standard_standard_01']
      : ['wall_door_recessed_large_01', 'wall_standard_standard_01', 'wall_door_recessed_small_01', 'wall_door_garage_door_01', 'wall_standard_standard_01', 'wall_door_centered_small_01'];
    const upperSets = kit === 'apt'
      ? [['wall_window_centered_large_01', 'wall_window_centered_large_02'], ['wall_window_centered_double_01', 'wall_window_centered_double_02'], ['wall_window_centered_small_01', 'wall_window_centered_small_02'], ['wall_door_window_small_01', 'wall_window_centered_large_01'], ['wall_window_offset_small_01', 'wall_window_offset_small_03']]
      : [['wall_window_centered_large_01', 'wall_window_centered_large_02'], ['wall_window_tall_large_01', 'wall_window_tall_large_02'], ['wall_window_centered_medium_01', 'wall_window_centered_medium_02'], ['wall_window_centered_double_01', 'wall_window_centered_double_02'], ['wall_window_tall_small_01', 'wall_window_tall_small_02']];
    const upper = upperSets[(rnd() * upperSets.length) | 0];
    const H = floors * 3;
    const faces = [
      { len: x1 - x0, at: (i) => new THREE.Vector3(x0 + i, 0, z1), rot: 0 },
      { len: x1 - x0, at: (i) => new THREE.Vector3(x1 - i, 0, z0), rot: Math.PI },
      { len: z1 - z0, at: (i) => new THREE.Vector3(x1, 0, z1 - i), rot: Math.PI / 2 },
      { len: z1 - z0, at: (i) => new THREE.Vector3(x0, 0, z0 + i), rot: -Math.PI / 2 },
    ];
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const corn = this.trim(K, kit === 'apt' ? 'cornice_standard_standard_01' : 'cornice02_standard_standard_01');
    const crown = this.trim(K, 'crown_standard_standard_01');
    for (const f of faces) {
      q.setFromAxisAngle(up, f.rot);
      for (let fl = 0; fl < floors; fl++) {
        let u = 0;
        while (u < f.len - 0.01) {
          let name = fl === 0 ? ground[(rnd() * ground.length) | 0] : upper[fl % 2];
          let m = this.module(K, name);
          if (!m || u + m.width > f.len + 0.01) m = this.module(K, fl === 0 ? 'wall_standard_standard_01' : upper[0]);
          const p = f.at(u); p.y = fl * 3;
          this.placeNodes(m.nodes, m.origin, new THREE.Matrix4().compose(p, q, one));
          u += m.width;
        }
        if (fl > 0 && corn) for (let u2 = 0; u2 < f.len - 0.01; u2 += 3) { const p = f.at(u2); p.y = fl * 3 - 0.1; this.placeNodes(corn.nodes, corn.origin, new THREE.Matrix4().compose(p, q, one)); }
      }
      if (crown) for (let u2 = 0; u2 < f.len - 0.01; u2 += 3) { const p = f.at(u2); p.y = H; this.placeNodes(crown.nodes, crown.origin, new THREE.Matrix4().compose(p, q, one), { noShadow: true }); }
    }
    // corner piers
    const pier = this.kits[K].getObjectByName(kit === 'apt' ? 'wall_pier_corner_01' : 'wall_pier_corner_01');
    if (pier) {
      const pb = new THREE.Box3().setFromObject(pier); const pc = pb.getCenter(new THREE.Vector3());
      const po = new THREE.Matrix4().makeTranslation(pc.x, pb.min.y, pc.z);
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) for (let fl = 0; fl < floors; fl++) this.placeNodes([pier], po, new THREE.Matrix4().makeTranslation(cx, fl * 3, cz));
    }
    // interior blocker (dark rooms behind the glass) + roof
    const inner = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.7, H - 0.05, z1 - z0 - 0.7), this.interiorMat || (this.interiorMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 1 })));
    inner.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2); inner.castShadow = true; this.group.add(inner);
    const roof = this.addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 - 0.1, 0.3, z1 - z0 - 0.1, this.pbr('concrete_floor_worn_001', { color: 0x9a968e }), { y: H - 0.2, tile: 4, collide: false });
    roof.castShadow = true;
    if (collide) this.boxes.push(new Box(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, H, z1), 'concrete'));
    this.buildings.push({ x0, z0, x1, z1, H });
  }
  // generic prop from a kit: select nodes, recentre on footprint, instance + collider
  prop(file, filter, x, z, rot = 0, { y = 0, collide = true, kind = 'metal', shadow = true, pad = 0 } = {}) {
    const kit = this.kits[file]; this.propCache = this.propCache || {};
    const key = file + '|' + filter;
    let pc = this.propCache[key];
    if (!pc) {
      const nodes = kit.children.filter(c => typeof filter === 'string' ? new RegExp(filter).test(c.name) : true);
      const b = new THREE.Box3(); nodes.forEach(n => b.expandByObject(n));
      const ctr = b.getCenter(new THREE.Vector3());
      pc = this.propCache[key] = { nodes, origin: new THREE.Matrix4().makeTranslation(ctr.x, b.min.y, ctr.z), size: b.getSize(new THREE.Vector3()) };
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.placeNodes(pc.nodes, pc.origin, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)), { noShadow: !shadow });
    if (collide) {
      const hw = pc.size.x / 2 + pad, hd = pc.size.z / 2 + pad, c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      const ex = hw * c + hd * s, ez = hw * s + hd * c;
      this.boxes.push(new Box(new THREE.Vector3(x - ex, y, z - ez), new THREE.Vector3(x + ex, y + pc.size.y, z + ez), kind));
    }
    return pc.size;
  }
  stripe(x, z, w, d, mat, rot = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, 0.006, z); m.receiveShadow = true; this.group.add(m);
  }

  build(opts = {}) {
    this.lite = !!opts.lite; // mobile: fewer distant buildings / decorative props
    const A = ARENA; this.buildings = [];
    const RW = 6, SW = 9.5; // road half-width, sidewalk outer edge
    // ground: asphalt everywhere (+ collider for bullet impacts)
    const gsz = 420;
    const ggeo = new THREE.PlaneGeometry(gsz, gsz); ggeo.rotateX(-Math.PI / 2);
    const uv = ggeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * gsz / 6, uv.getY(i) * gsz / 6);
    const ground = new THREE.Mesh(ggeo, this.pbr('asphalt_02', { color: 0x9a9a9a })); ground.receiveShadow = true; this.group.add(ground);
    this.boxes.push(new Box(new THREE.Vector3(-gsz / 2, -1, -gsz / 2), new THREE.Vector3(gsz / 2, 0, gsz / 2), 'concrete'));
    // raised sidewalks / blocks (one slab per quadrant) with concrete curbs
    const pav = this.pbr('square_concrete_pavers', { color: 0xc4c4c4 });
    const curb = this.pbr('concrete_floor_worn_001', { color: 0xc8c4bc });
    const far = 200;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * (RW + far) / 2, cz = sz * (RW + far) / 2;
      this.addBox(cx, cz, far - RW, 0.15, far - RW, pav, { tile: 2, kind: 'concrete' });
      this.addBox(sx * (RW + 0.15), cz, 0.3, 0.17, far - RW, curb, { tile: 1.5, collide: false });
      this.addBox(cx, sz * (RW + 0.15), far - RW, 0.17, 0.3, curb, { tile: 1.5, collide: false });
    }
    // road markings
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let t = 12; t < 160; t += 6) for (const s of [-1, 1]) { this.stripe(0, s * t, 0.15, 3, yellow); this.stripe(s * t, 0, 3, 0.15, yellow); }
    for (const s of [-1, 1]) {
      for (let k = -5; k <= 5; k++) { this.stripe(k * 1.0, s * 8, 0.5, 3, white); this.stripe(s * 8, k * 1.0, 3, 0.5, white); }
      this.stripe(s > 0 ? 3 : -3, s * 10, 6, 0.4, white); this.stripe(s * 10, s > 0 ? -3 : 3, 0.4, 6, white);
    }
    // ------------- buildings: inner blocks
    this.building(-27, -30, -9, -9, 4, 'apt', 1);
    this.building(-45, -30, -30, -9, 6, 'fac', 2);
    this.building(30, -45, 45, -33, 2, 'fac', 3);
    this.building(9, 9, 33, 24, 5, 'apt', 4);
    this.building(9, 33, 27, 45, 3, 'fac', 5);
    // perimeter ring (forms the arena boundary) and street arms (visual depth)
    let seed = 10;
    for (const s of [-1, 1]) {
      const zA = s < 0 ? -63 : 45, zB = s < 0 ? -45 : 63;
      this.building(-63, zA, -36, zB, 5 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed);
      this.building(-36, zA, -9, zB, 4 + (seed % 4), seed++ % 2 ? 'apt' : 'fac', seed);
      this.building(9, zA, 36, zB, 6 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed);
      this.building(36, zA, 63, zB, 4 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed);
      const xA = s < 0 ? -63 : 45, xB = s < 0 ? -45 : 63;
      this.building(xA, -45, xB, -9, 5 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed);
      this.building(xA, 9, xB, 45, 4 + (seed % 4), seed++ % 2 ? 'apt' : 'fac', seed);
      // arms beyond the ring
      for (const [a0, a1] of (this.lite ? [[66, 87]] : [[66, 87], [90, 114]])) {
        const lo = s < 0 ? -a1 : a0, hi = s < 0 ? -a0 : a1;
        this.building(-30, lo, -9, hi, 5 + (seed % 4), seed++ % 2 ? 'apt' : 'fac', seed, false);
        this.building(9, lo, 30, hi, 6 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed, false);
        this.building(lo, -30, hi, -9, 4 + (seed % 4), seed++ % 2 ? 'apt' : 'fac', seed, false);
        this.building(lo, 9, hi, 30, 5 + (seed % 3), seed++ % 2 ? 'apt' : 'fac', seed, false);
      }
      if (!this.lite) this.building(-24, s < 0 ? -144 : 120, 24, s < 0 ? -120 : 144, 9, seed++ % 2 ? 'apt' : 'fac', seed, false);
      if (!this.lite) this.building(s < 0 ? -144 : 120, -24, s < 0 ? -120 : 144, 24, 8, seed++ % 2 ? 'apt' : 'fac', seed, false);
    }
    // gap fillers in the ring corners where roads leave
    // ------------- road-end barricades + invisible walls
    for (const s of [-1, 1]) {
      for (let k = -4; k <= 4; k++) {
        this.prop('concrete_road_barrier', 'concrete_road_barrier$', k * 1.6, s * 44, 0, { kind: 'concrete' });
        this.prop('concrete_road_barrier', 'concrete_road_barrier$', s * 44, k * 1.6, Math.PI / 2, { kind: 'concrete' });
      }
      this.prop('covered_car', '.', 3.5, s * 41, 0.25 * s, { kind: 'metal' });
      this.prop('covered_car', '.', s * 41, -3.5, Math.PI / 2 + 0.2, { kind: 'metal' });
      this.boxes.push(new Box(new THREE.Vector3(-9.5, 0, s > 0 ? 44.5 : -46), new THREE.Vector3(9.5, 6, s > 0 ? 46 : -44.5), 'concrete'));
      this.boxes.push(new Box(new THREE.Vector3(s > 0 ? 44.5 : -46, 0, -9.5), new THREE.Vector3(s > 0 ? 46 : -44.5, 6, 9.5), 'concrete'));
    }
    // ------------- street furniture along sidewalks
    for (const s of [-1, 1]) for (let t = -40; t <= 40; t += 14) {
      if (Math.abs(t) < 12) continue;
      this.prop('street_lamp_01', '.', s * 8.8, t, s > 0 ? -Math.PI / 2 : Math.PI / 2, { y: 0.15, pad: -0.2 });
      this.prop('street_lamp_01', '.', t, s * 8.8, s > 0 ? Math.PI : 0, { y: 0.15, pad: -0.2 });
    }
    for (const [x, z] of [[7.2, -14], [-7.2, 17], [16, 7.2], [-22, -7.2], [7.2, 30], [-30, 7.2]]) this.prop('fire_hydrant', '^fire_hydrant(?!.*aged)', x, z, 0, { y: 0.15 });
    for (const [x, z, r] of [[8.3, -20, 0], [-8.3, 21, 1], [20, -8.3, 0], [-16, 8.3, 0.5], [8.3, 25, 0], [-12, -8.4, 0]]) this.prop('metal_trash_can', '^metal_trash_can(?!_rust)', x, z, r, { y: 0.15 });
    // parked cars along the curbs
    for (const [x, z, r] of [[-4.6, -18, 0.02], [-4.6, -30, -0.03], [4.6, 22, Math.PI + 0.02], [4.6, 34, Math.PI], [20, 4.6, -Math.PI / 2], [-24, -4.6, Math.PI / 2 + 0.03], [-36, -4.6, Math.PI / 2]])
      this.car(x, z, r, { kind: 'metal' });
    // ------------- NE parking lot
    const lotMat = this.pbr('asphalt_02', { color: 0x7d7d7d });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), lotMat); lot.position.set(27, 0.152, -27); lot.receiveShadow = true;
    { const u = lot.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 6, u.getY(i) * 6); } this.group.add(lot);
    for (let i = 0; i < 6; i++) this.stripe(14 + i * 3, -18, 0.12, 5, white), this.stripe(14 + i * 3, -36, 0.12, 5, white);
    this.car(15.5, -18, 0.05, { y: 0.15 }); this.car(21.5, -18.3, -0.04, { y: 0.15 }); this.car(27.5, -36, 0.03, { y: 0.15 }); this.car(18.5, -36.2, Math.PI + 0.04, { y: 0.15 }); this.car(24.5, -18, Math.PI, { y: 0.15 });
    for (let k = 0; k < 5; k++) this.prop('concrete_road_barrier_02', '.', 16 + k * 1.6, -27, 0, { y: 0.15, kind: 'concrete' });
    this.prop('concrete_road_barrier_02', '.', 34, -24, Math.PI / 2, { y: 0.15, kind: 'concrete' }); this.prop('concrete_road_barrier_02', '.', 34, -25.6, Math.PI / 2, { y: 0.15, kind: 'concrete' });
    this.container(38, -16, true, 0x2f5f8a, 0.15);
    for (const [x, z] of [[40, -28], [40.6, -28.4], [24, -40]]) if (!this.lite) this.prop('old_tyre', '.', x, z, 0, { y: 0.15 + 0.3 * 0, collide: false });
    // ------------- NW back courtyard + alley
    for (const [x, z, r] of [[-28.5, -12, 0], [-28.6, -18, 0.3], [-14, -33, 0.2], [-20, -42, 0], [-40, -33, 0]]) this.prop('metal_trash_can', '^metal_trash_can_rust|^metal_trash_can_rust_', x, z, r, { y: 0.15 });
    for (const [x, z] of [[-28.2, -14], [-29, -21], [-27.6, -24], [-13, -34], [-42, -35], [-41.2, -34.4]]) if (!this.lite) this.prop('trashbag', '.', x, z, Math.random() * 6, { y: 0.15, collide: false });
    this.prop('rollershutter_door', 'graffiti', -18, -30.05, Math.PI, { y: 0.15, collide: false });
    this.prop('rollershutter_door', '^rollershutter_door$', -36, -30.05, Math.PI, { y: 0.15, collide: false });
    this.prop('modular_fire_escape', '.', -27.1, -20, -Math.PI / 2, { y: 2.6, collide: false });
    for (const [x, y, z, r] of [[-27.05, 4.2, -14, -Math.PI / 2], [-27.05, 7.2, -25, -Math.PI / 2], [-30, 5, -18, Math.PI / 2], [-20, 4.5, -30.05, Math.PI], [9, 4.6, 18, -Math.PI / 2]]) this.prop('exterior_aircon_unit', '^exterior_aircon_unit$', x, z, r, { y, collide: false });
    this.crate(-16, -38); this.crate(-16, -39.3); this.crate(-16.1, -38.6, 1.1, 1.2, 0.3); this.crate(-34, -40, 1.2, 0.15);
    this.container(-36, -38, false, 0x9b3a2e, 0.15);
    this.jersey(-24, -36, true);
    // ------------- SW container yard
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), this.pbr('concrete_floor_worn_001', { color: 0xb0aca4 })); yard.position.set(-27, 0.152, 27); yard.receiveShadow = true;
    { const u = yard.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 9, u.getY(i) * 9); } this.group.add(yard);
    const Y = 0.15;
    this.container(-20, 18, false, 0x9b3a2e, Y); this.container(-20, 18, false, 0x2f5f8a, Y + 2.59);
    this.container(-34, 22, true, 0x3e6b45, Y);
    this.container(-26, 33, false, 0xb36a2a, Y);
    this.container(-38, 38, false, 0x6c5b49, Y); this.container(-38, 38, false, 0x7a7d80, Y + 2.59);
    this.container(-14, 38, true, 0x2f5f8a, Y);
    this.crate(-27, 24, 1.2, Y); this.crate(-25.7, 24.2, 1.2, Y, 0.2); this.crate(-26.4, 24.1, 1.0, Y + 1.2, 0.5);
    this.crate(-40, 14, 1.2, Y); this.crate(-40, 15.3, 1.0, Y);
    for (const [x, z, c] of [[-31, 13, 0x6a7f94], [-31.6, 13.4, 0x6a7f94], [-17, 27, 0x9e3b2c], [-17.6, 27.4, 0x9e3b2c], [-17.2, 28.1, 0x3d5d3a]]) this.barrel(x, z, c, Y);
    this.jersey(-12, 26, true); this.jersey(-30, 29, false); this.jersey(-42, 28, true);
    // ------------- SE back lot
    this.container(39, 16, true, 0xb36a2a, Y); this.container(38, 36, false, 0x3e6b45, Y);
    this.car(31, 29, Math.PI / 2 + 0.1, { y: Y }); this.crate(42, 26, 1.2, Y); this.crate(42, 27.3, 1.2, Y);
    for (const [x, z] of [[34, 10.5], [36, 11.2]]) this.prop('trashbag', '.', x, z, 1, { y: Y, collide: false });
    this.prop('rollershutter_door', '^rollershutter_door$', 33.05, 15, Math.PI / 2, { y: Y, collide: false });
    this.prop('rollershutter_door', 'graffiti', 20, 24.05, 0, { y: Y, collide: false });
    for (let k = 0; k < 4; k++) this.prop('concrete_road_barrier', 'concrete_road_barrier$', 13 + k * 1.6, 28.5, 0, { y: Y, kind: 'concrete' });

    this.finalizeInstances();
    this.nav = new NavGrid(this.boxes, ARENA, 1, 0.55);
    this.playerSpawn = new THREE.Vector3(0, 0, 4);
    this.enemySpawns = [[-36, -38], [-12, -40], [38, -22], [20, -40], [40, 30], [30, 40], [-38, 33], [-20, 42], [0, -40], [40, 0], [0, 40], [-40, 0], [-28.5, -26]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  }
}

// Load HDR sky, build PMREM env, derive sun direction + horizon fog colour from the HDR itself.
export function analyzeHDR(tex) {
  const { data, width, height } = tex.image;
  const get = (i) => data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
  let best = -1, bi = 0, bj = 0; const fog = new THREE.Color(0, 0, 0); let fogN = 0;
  for (let j = 0; j < height; j += 2) for (let i = 0; i < width; i += 2) {
    const k = (j * width + i) * 4; const r = get(k), g = get(k + 1), b = get(k + 2);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (L > best) { best = L; bi = i; bj = j; }
    const v = 1 - (j + 0.5) / height; if (v > 0.5 && v < 0.56) { fog.r += r; fog.g += g; fog.b += b; fogN++; }
  }
  fog.multiplyScalar(1 / Math.max(1, fogN));
  const u = (bi + 0.5) / width, v = 1 - (bj + 0.5) / height;
  const ang = (u - 0.5) * Math.PI * 2; let lat = (v - 0.5) * Math.PI;
  lat = THREE.MathUtils.clamp(lat, THREE.MathUtils.degToRad(38), THREE.MathUtils.degToRad(65));
  const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(lat), Math.sin(lat), Math.sin(ang) * Math.cos(lat)).normalize();
  return { sunDir: dir, fogColor: fog, sunLum: best };
}

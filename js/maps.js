// v1.5 maps: Desert Town and Military Base. Built from the same pieces as the city (PBR box geometry with box
// colliders, enterable buildings, Quaternius props, containers, crates, barrels) plus a few procedural extras
// (palms, market stalls, chain-link fence, watchtowers, hangars, helipad). Static boxes are merged per material
// so each map stays at a phone-friendly number of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box } from './physics.js';
import { enterable } from './buildings.js';

export const MAPS = [
  { id: 'city', name: 'URBAN SIEGE', place: 'Downtown crossroads', desc: 'Four city blocks, a parking lot, a container yard and three enterable buildings.' },
  { id: 'desert', name: 'DESERT TOWN', place: 'Mud-brick market town', desc: 'Sand streets, flat-roof houses, a covered market, palms and burnt-out cars.' },
  { id: 'base', name: 'MILITARY BASE', place: 'Forward operating base', desc: 'Hangars, barracks, watchtowers, a container yard, a helipad and a motor pool.' },
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- merged static geometry
class Merge {
  constructor(W) { this.W = W; this.parts = new Map(); }
  add(mat, g, shadow = true) { const k = mat.uuid + (shadow ? 's' : ''); if (!this.parts.has(k)) this.parts.set(k, { mat, shadow, list: [] }); this.parts.get(k).list.push(g); }
  box(mat, x0, y0, z0, x1, y1, z1, { tile = 2, collide = true, kind = 'concrete', shadow = true } = {}) {
    if (x1 < x0) [x0, x1] = [x1, x0]; if (z1 < z0) [z0, z1] = [z1, z0];
    const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], off = [[z0, y0], [z0, y0], [x0, z0], [x0, z0], [x0, y0], [x0, y0]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0] + off[f][0]) / tile, (uv.getY(i) * dims[f][1] + off[f][1]) / tile); }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); this.add(mat, g, shadow);
    if (collide) this.W.boxes.push(new Box(V(x0, z0, y0), V(x1, z1, y1), kind));
  }
  // centred box helper
  cbox(mat, x, z, w, h, d, y = 0, o = {}) { this.box(mat, x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, o); }
  flush() {
    for (const { mat, shadow, list } of this.parts.values()) {
      const g = mergeGeometries(list.map(q => q.index ? q.toNonIndexed() : q), false); list.forEach(q => q.dispose());
      const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; this.W.group.add(m); this.W.meshes.push(m);
    }
    this.parts.clear();
  }
}
const collider = (W, x0, y0, z0, x1, y1, z1, kind = 'concrete') => W.boxes.push(new Box(V(x0, z0, y0), V(x1, z1, y1), kind));
const flat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.9, metalness: o.m ?? 0, side: o.side ?? THREE.FrontSide, ...(o.extra || {}) });
function canvasTex(w, h, draw, repeat = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }

// ground plane with gentle dunes / berms outside the arena (one mesh) + the ground collider
function ground(W, set, color, tile, dune = 0) {
  const S = 420, N = dune ? 84 : 1, g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (dune) { const r = Math.max(Math.abs(x), Math.abs(z)) - 60; if (r > 0) p.setY(i, Math.min(1, r / 60) * dune * (0.55 + 0.45 * Math.sin(x * 0.045 + Math.cos(z * 0.03) * 2) * Math.cos(z * 0.05))); }
    uv.setXY(i, uv.getX(i) * S / tile, uv.getY(i) * S / tile);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, W.pbr(set, { color, normal: 1 })); m.receiveShadow = true; W.group.add(m);
  W.boxes.push(new Box(V(-S / 2, -S / 2, -1), V(S / 2, S / 2, 0), 'concrete'));
}
function patch(W, mat, x, z, w, d, y = 0.012, tile = 4, rot = 0) {
  const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.y = rot; m.receiveShadow = true; W.group.add(m); return m;
}

// ---------------------------------------------------------------- palms (instanced)
let PALM = null;
function palmKit() {
  if (PALM) return PALM;
  const H = 7.2, trunk = new THREE.CylinderGeometry(0.15, 0.27, H, 7, 8); trunk.translate(0, H / 2, 0);
  const tp = trunk.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i), k = y / H; tp.setX(i, tp.getX(i) + k * k * 0.9); const ring = Math.sin(y * 7) * 0.012; tp.setX(i, tp.getX(i) * (1 + ring)); }
  trunk.computeVertexNormals();
  const barkTex = canvasTex(64, 128, (x, w, h) => { x.fillStyle = '#7a6448'; x.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) { x.fillStyle = 'rgba(40,28,18,.55)'; x.fillRect(0, y, w, 2); x.fillStyle = 'rgba(160,135,100,.35)'; x.fillRect(0, y + 3, w, 2); } });
  const fronds = [];
  for (let i = 0; i < 10; i++) {
    const L = 3.3 + (i % 3) * 0.35, g = new THREE.PlaneGeometry(1.15, L, 1, 6); g.translate(0, L / 2, 0); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const t = p.getZ(k) / L * -1; p.setY(k, p.getY(k) + 0.6 * t - 1.7 * t * t); p.setX(k, p.getX(k) * (1 - t * 0.45)); }
    g.rotateY(i * (Math.PI * 2 / 10) + (i % 2) * 0.2); g.translate(0.9, H - 0.05, 0); fronds.push(g);
  }
  const leaf = mergeGeometries(fronds, false); leaf.computeVertexNormals();
  const leafTex = canvasTex(128, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.strokeStyle = '#5f6a2a'; x.lineWidth = 5; x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
    for (let y = 6; y < h - 4; y += 7) { const len = (w / 2 - 6) * Math.sin(Math.PI * (0.15 + 0.85 * y / h)); const gcol = ['#6f7d2e', '#7d8a35', '#5c6a26', '#8a8c3a'][(y / 7 | 0) % 4]; x.strokeStyle = gcol; x.lineWidth = 3.2;
      x.beginPath(); x.moveTo(w / 2, y); x.lineTo(w / 2 - len, y + 16); x.stroke(); x.beginPath(); x.moveTo(w / 2, y); x.lineTo(w / 2 + len, y + 16); x.stroke(); }
  }, false);
  PALM = { trunk, leaf, trunkMat: new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 }), leafMat: new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }) };
  return PALM;
}
function palms(W, list) {
  const K = palmKit(), n = list.length; if (!n) return;
  const a = new THREE.InstancedMesh(K.trunk, K.trunkMat, n), b = new THREE.InstancedMesh(K.leaf, K.leafMat, n);
  a.userData.shared = b.userData.shared = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  list.forEach(([x, z, r = 0, sc = 1, collide = true], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); s.setScalar(sc); m.compose(V(x, z), q, s); a.setMatrixAt(i, m); b.setMatrixAt(i, m);
    if (collide) collider(W, x - 0.3, 0, z - 0.3, x + 0.3, 7 * sc, z + 0.3, 'wood');
  });
  for (const im of [a, b]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); W.group.add(im); }
}

// =============================================================== DESERT TOWN
export function buildDesert(W) {
  const lite = W.lite, M = new Merge(W);
  ground(W, 'dense_sand', 0xf0d9b0, 5, 9);
  const road = W.pbr('dry_ground_01', { color: 0xd8c3a0 });
  patch(W, road, 0, 0, 92, 9, 0.01, 5); patch(W, road, 0, 0, 9, 92, 0.012, 5); patch(W, road, -20, -12, 26, 12, 0.014, 5);
  const plaster = (c) => W.pbr('clay_plaster', { color: c, normal: 1.3, env: 1.1 });
  const P = [plaster(0xe8cfa6), plaster(0xd9b98c), plaster(0xf0dcc0), plaster(0xc9a47a)];
  const dark = flat(0x2a211a), wood = W.pbr('plywood', { color: 0x9a7650 }), woodDk = W.pbr('plywood', { color: 0x6a4c32 });
  const sandbag = 0;
  // ---- solid flat-roof mud houses (collider = whole volume) with parapet, door, windows and roof beams
  const house = (x0, z0, x1, z1, h, ci = 0, o = {}) => {
    const mat = P[ci % P.length];
    M.box(mat, x0, 0, z0, x1, h, z1, { tile: 3, collide: o.collide !== false });
    const pt = 0.25, ph = 0.55; // parapet
    M.box(mat, x0, h, z0, x1, h + ph, z0 + pt, { tile: 3, collide: false }); M.box(mat, x0, h, z1 - pt, x1, h + ph, z1, { tile: 3, collide: false });
    M.box(mat, x0, h, z0 + pt, x0 + pt, h + ph, z1 - pt, { tile: 3, collide: false }); M.box(mat, x1 - pt, h, z0 + pt, x1, h + ph, z1 - pt, { tile: 3, collide: false });
    if (o.bare) return;
    const faces = [['x', z1, 1, x0, x1], ['x', z0, -1, x0, x1], ['z', x1, 1, z0, z1], ['z', x0, -1, z0, z1]];
    faces.forEach(([ax, f, sgn, a0, a1], fi) => {
      const L = a1 - a0, n = Math.max(1, Math.floor(L / 3.2));
      for (let i = 0; i < n; i++) {
        const c = a0 + (i + 0.5) * L / n, door = fi === (o.door ?? 0) && i === (n / 2 | 0);
        const rows = door ? [[0, 2.2, 0.62]] : [[1.4, 2.3, 0.45]]; if (h > 4.6) rows.push([4.2, 5.1, 0.45]);
        for (const [y0, y1, hw] of rows) {
          if (ax === 'x') M.box(dark, c - hw, y0, f - (sgn > 0 ? 0.02 : 0.04), c + hw, y1, f + (sgn > 0 ? 0.04 : 0.02), { collide: false, shadow: false });
          else M.box(dark, f - (sgn > 0 ? 0.02 : 0.04), y0, c - hw, f + (sgn > 0 ? 0.04 : 0.02), y1, c + hw, { collide: false, shadow: false });
          if (y0 > 0) { if (ax === 'x') M.box(woodDk, c - hw - 0.08, y1, f - 0.06 * -sgn, c + hw + 0.08, y1 + 0.12, f + 0.08 * sgn, { collide: false, shadow: false }); else M.box(woodDk, f - 0.06 * -sgn, y1, c - hw - 0.08, f + 0.08 * sgn, y1 + 0.12, c + hw + 0.08, { collide: false, shadow: false }); }
        }
      }
      // protruding roof beams (vigas)
      if (fi < 2 && !lite) for (let u = a0 + 0.8; u < a1 - 0.5; u += 1.4) M.box(woodDk, u - 0.08, h - 0.45, Math.min(f, f + 0.35 * sgn), u + 0.08, h - 0.3, Math.max(f, f + 0.35 * sgn), { collide: false, shadow: false });
    });
  };
  // ---- low compound walls
  const wall = (x0, z0, x1, z1, h = 2.2, ci = 1) => { M.box(P[ci], x0, 0, z0, x1, h, z1, { tile: 3 }); M.box(woodDk, x0 - 0.03, h, z0 - 0.03, x1 + 0.03, h + 0.08, z1 + 0.03, { collide: false, shadow: false }); };
  // ---- market stall: posts, counter, canvas awning, goods
  const cloth = [0xb33a2a, 0x2f5f8a, 0xd8a32a, 0x3e6b45, 0xe6e0d0].map(c => flat(c, { side: THREE.DoubleSide, r: 1 }));
  const goods = [flat(0xc0752a), flat(0x9b3a2e), flat(0xd8c070), flat(0x6a8a3a)];
  const stall = (x, z, rotZ, k) => {
    const w = 3.2, d = 2.2, hw = rotZ ? d / 2 : w / 2, hd = rotZ ? w / 2 : d / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(woodDk, x + sx * hw - 0.06, 0, z + sz * hd - 0.06, x + sx * hw + 0.06, 2.5, z + sz * hd + 0.06, { collide: false });
    M.box(wood, x - hw + 0.15, 0, z - hd + 0.15, x + hw - 0.15, 0.95, z + (rotZ ? hd - 0.15 : -hd + 0.9), { tile: 1.5, kind: 'wood' });
    const g = new THREE.BoxGeometry(hw * 2 + 0.5, 0.04, hd * 2 + 0.5); g.rotateX(rotZ ? 0 : 0.18); g.rotateZ(rotZ ? 0.18 : 0); g.translate(x, 2.62, z); M.add(cloth[k % cloth.length], g);
    for (let i = 0; i < 4; i++) { const gx = rotZ ? x - hw + 0.5 : x - hw + 0.55 + i * 0.7, gz = rotZ ? z - hd + 0.55 + i * 0.7 : z - hd + 0.5; const gg = new THREE.BoxGeometry(0.42, 0.28, 0.42); gg.translate(gx, 1.09, gz); M.add(goods[(i + k) % goods.length], gg, false); }
  };
  // ================= layout (arena +-46, crossroads at the centre)
  // enterable buildings (clay plaster)
  enterable(W, { x0: -32, z0: -34, x1: -16, z1: -20, floors: 2, base: 0, color: 0xe2c49a, inner: 0xeadcc4, extSet: 'clay_plaster', inSet: 'clay_plaster',
    doors: [{ side: 's', at: -20 }, { side: 'e', at: -27 }, { side: 'w', at: -24 }], stairs: [{ x: -31.0, z: -33.2, dir: 'z+' }, { x: -17.0, z: -21.2, dir: 'z-' }], split: 'x', splitAt: -24, splitDoors: [-30.5, -23.5] });
  enterable(W, { x0: 10, z0: -32, x1: 26, z1: -20, floors: 1, base: 0, color: 0xd6b48a, inner: 0xeadcc4, extSet: 'clay_plaster', inSet: 'clay_plaster',
    doors: [{ side: 's', at: 14 }, { side: 's', at: 22 }, { side: 'w', at: -26 }], stairs: [{ x: 25.0, z: -31.2, dir: 'z+' }] });
  enterable(W, { x0: 12, z0: 14, x1: 28, z1: 28, floors: 2, base: 0, color: 0xf0dcbc, inner: 0xeadcc4, extSet: 'clay_plaster', inSet: 'clay_plaster',
    doors: [{ side: 'n', at: 16 }, { side: 'n', at: 24 }, { side: 'w', at: 17.5 }], stairs: [{ x: 27.0, z: 27.2, dir: 'z-' }, { x: 13.0, z: 15.2, dir: 'z+' }], split: 'z', splitAt: 21, splitDoors: [16.5, 23.5] });
  // houses
  house(-44, -44, -36, -36, 4.2, 0); house(-12, -44, -4, -38, 3.6, 2, { door: 0 }); house(32, -44, 44, -34, 5.4, 1, { door: 0 }); house(32, -24, 42, -12, 4, 3, { door: 3 });
  house(-44, 10, -32, 22, 6, 1, { door: 2 }); house(-24, 10, -12, 18, 3.6, 0, { door: 1 }); house(-44, 30, -34, 44, 4.2, 2, { door: 2 }); house(-14, 34, -4, 44, 3.8, 3, { door: 1 });
  house(32, 32, 44, 44, 4.4, 0, { door: 1 }); house(34, 12, 44, 22, 3.6, 2, { door: 3 }); house(6, 36, 14, 44, 3.4, 1, { door: 1 });
  // compound walls / courtyards
  wall(-44, -30, -36, -29.6); wall(-36.4, -30, -36, -20); wall(-12, -30, -11.6, -18);
  wall(28, -10, 44, -9.6); wall(30, -9.6, 30.4, -4.8, 2.2, 2);
  wall(-30, 26, -16, 26.4); wall(-16.4, 26.4, -16, 32); wall(4, 30, 4.4, 44, 2.2, 3);
  wall(30, 26, 44, 26.4, 2.2, 0);
  // perimeter (tall compound walls) and the skyline behind it
  const PH = 4.2;
  for (const s of [-1, 1]) { M.box(P[1], -47, 0, s > 0 ? 46 : -47, 47, PH, s > 0 ? 47 : -46, { tile: 3 }); M.box(P[1], s > 0 ? 46 : -47, 0, -46, s > 0 ? 47 : -46, PH, 46, { tile: 3 }); }
  collider(W, -60, 0, -60, 60, 12, -46.5); collider(W, -60, 0, 46.5, 60, 12, 60); collider(W, -60, 0, -46.5, -46.5, 12, 46.5); collider(W, 46.5, 0, -46.5, 60, 12, 46.5);
  let k = 0;
  for (let u = -60; u < 60; u += 12) for (const s of [-1, 1]) {
    const h = 4 + ((k * 7) % 5) * 1.3, d = 8 + (k % 3) * 2; k++;
    if (lite && k % 2) continue;
    house(u, s > 0 ? 49 : -49 - d, u + 10, s > 0 ? 49 + d : -49, h, k, { collide: false, bare: true });
    house(s > 0 ? 49 : -49 - d, u, s > 0 ? 49 + d : -49, u + 10, h, k + 1, { collide: false, bare: true });
  }
  // minaret + dome on the skyline
  { const t = new THREE.CylinderGeometry(1.4, 1.8, 26, 12); t.translate(-62, 13, -58); M.add(P[2], t); const c = new THREE.CylinderGeometry(2.2, 2.2, 1.2, 12); c.translate(-62, 22, -58); M.add(P[1], c); const top = new THREE.ConeGeometry(1.5, 4, 12); top.translate(-62, 28, -58); M.add(flat(0x3e7a6a), top);
    const dome = new THREE.SphereGeometry(7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(-50, 9, -66); M.add(flat(0x3e7a6a, { r: 0.6 }), dome); const drum = new THREE.CylinderGeometry(7, 7, 9, 16); drum.translate(-50, 4.5, -66); M.add(P[0], drum); }
  // market (NW of the crossroads) and street stalls
  [[-31, -13, 0], [-27, -13, 0], [-23, -13, 0], [-19, -13, 0], [-12, -9.5, 1], [-30, -8, 0]].forEach(([x, z, r], i) => stall(x, z, !!r, i));
  if (!lite) [[8, 9.8, 0], [12, 9.8, 0]].forEach(([x, z, r], i) => stall(x, z, !!r, i + 2));
  // cover: sandbags, burnt-out cars, crates, barrels, jersey barriers, tyres
  const sb = (x, z, r, small) => W.prop(small ? 'sack_trench_small' : 'sack_trench', '.', x, z, r, { kind: 'sand' });
  sb(-3.4, -12, 0); sb(3.4, 12.5, Math.PI); sb(12.5, 3.2, Math.PI / 2); sb(-12.5, -3.2, -Math.PI / 2); sb(24, 6, 0, true); sb(-24, 4.5, 0, true); sb(4.2, -26, Math.PI / 2, true); sb(-6, 26, Math.PI / 2, true); sb(36, 0, Math.PI / 2, true);
  const wreck = (x, z, r) => W.prop('broken_car', '.', x, z, r, { kind: 'metal' });
  wreck(-2.6, -20, 0.4); wreck(3, 20, -0.6); wreck(20, -2.6, 1.8); wreck(-36, 2.5, 1.3); wreck(30, 38, 0.2);
  W.jersey(-8, 7, true, 0); W.jersey(8, -7, true, 0); W.jersey(30, 5, false, 0);
  W.crate(-10, -24, 1.2); W.crate(-10, -25.3, 1.1, 0, 0.3); W.crate(-9.9, -24.6, 1.0, 1.2, 0.5); W.crate(6, -14, 1.1, 0, 0.2); W.crate(-6, 15, 1.2); W.crate(38, -4, 1.2, 0, 0.2); W.crate(-40, -6, 1.1); W.crate(-26, 40, 1.2, 0, 0.4); W.crate(22, 40, 1.1);
  for (const [x, z, c] of [[-14, -40, 0x6a7f94], [-13.4, -40.4, 0x9e3b2c], [28, -14, 0x3d5d3a], [-28, 20, 0x9e3b2c], [-27.4, 20.5, 0x6a7f94], [8, 30, 0x3d5d3a]]) W.barrel(x, z, c, 0);
  if (!lite) for (const [x, z] of [[18, 8], [-38, -12], [40, 28]]) W.prop('old_tyre', '.', x, z, 0, { collide: false });
  // well in the south-west square
  { const g = new THREE.CylinderGeometry(1.2, 1.3, 0.9, 16, 1, true); g.translate(-22, 0.45, 32); M.add(P[0], g); collider(W, -23.2, 0, 30.8, -20.8, 0.9, 33.2); M.box(woodDk, -23.3, 0.9, 31.95, -20.7, 2.6, 32.05, { collide: false }); }
  palms(W, [[-6, -32, 0.3], [-36, -16, 1.2, 1.1], [-6, 32, 2], [6, -40, 0.7, 0.9], [26, 6, 2.6, 1.05], [-30, 2, 4.1, 0.95], [40, 8, 1.1], [-20, 38, 0.2, 1.1], [38, -28, 3.3], [-40, -24, 5.1, 0.9], [18, 32, 1.5],
    ...(lite ? [] : [[-55, -40, 1, 1.2, false], [55, 30, 2, 1.1, false], [-52, 20, 3, 1.3, false], [30, -55, 0.4, 1.2, false], [-10, 55, 2.2, 1.1, false], [58, -12, 1.7, 1.25, false]])]);
  M.flush();
  // warm desert light and haze
  Object.assign(W.env, { sun: 0xffd9a6, sunI: 3.6, fogD: 0.011, fogTint: 0xd9c19a, hemiSky: 0xf4dcb8, hemiGround: 0x8c6a46, hemiI: 0.5, envI: 0.65, bgI: 0.85, minimap: { bg: '#8a7656', roads: false, hi: '#d8c09a', lo: '#b49a74' } });
  W.playerSpawn = V(0, 4);
  W.medkitSpots = [V(-20, -27), V(18, -26), V(20, 21), V(-20, 4), V(36, 4)];
  W.enemySpawns = [[-40, -40], [-20, -42], [0, -42], [24, -40], [42, -30], [42, -6], [42, 6], [42, 28], [24, 42], [0, 42], [-22, 42], [-42, 26], [-42, 4], [-42, -16], [-6, -30]].map(([x, z]) => V(x, z));
  W.teamSpawns = [[[-40, -40], [-20, -42], [0, -42], [24, -40], [-6, -30], [-42, -16]], [[24, 42], [0, 42], [-22, 42], [42, 28], [-42, 26], [42, 6]]];
  W.vehicleSpawns = [[-4.5, 22, Math.PI], [30, 2.5, -Math.PI / 2]];
  W.points = { extract: V(-29, 36), defend: V(-21, -7.5), hvt: V(-28, -27), hvtGuard: [[-28, -24], [-20, -30], [-24, -16]] };
}

// =============================================================== MILITARY BASE
export function buildBase(W) {
  const lite = W.lite, M = new Merge(W);
  ground(W, 'dry_ground_01', 0xc9b48e, 6, 7);
  const conc = W.pbr('concrete_floor_worn_001', { color: 0xbdb8ae }), asph = W.pbr('asphalt_02', { color: 0x8c8c8c });
  patch(W, asph, 0, 0, 10, 92, 0.01, 6); patch(W, asph, 0, 0, 92, 8, 0.012, 6);
  patch(W, conc, 0, -31, 76, 22, 0.014, 4); patch(W, conc, 30, -2, 22, 18, 0.016, 4);
  const iron = (c) => W.pbr('corrugated_iron', { color: c, normal: 1.3 });
  const steel = W.pbr('rusty_metal_02', { color: 0x4a4d48 }), olive = iron(0x7c8462), sand = iron(0xb8aa86), roofM = iron(0x8f969a);
  const wood = W.pbr('plywood', { color: 0xa0845e });
  // ---- perimeter: chain-link fence on steel posts + invisible collider walls
  const linkTex = canvasTex(64, 64, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = 'rgba(200,205,205,1)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w / 2, 0); x.lineTo(w, h / 2); x.lineTo(w / 2, h); x.closePath(); x.stroke(); });
  linkTex.repeat.set(1, 1);
  const linkMat = new THREE.MeshStandardMaterial({ map: linkTex, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
  const FH = 3.2;
  for (const s of [-1, 1]) for (const ax of ['x', 'z']) {
    const g = new THREE.PlaneGeometry(93, FH); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 93 / 0.6, uv.getY(i) * FH / 0.6);
    g.translate(0, FH / 2, 0); if (ax === 'z') g.rotateY(Math.PI / 2); g.translate(ax === 'x' ? 0 : s * 46.5, 0, ax === 'x' ? s * 46.5 : 0); M.add(linkMat, g, false);
    for (let u = -46.5; u <= 46.6; u += 3.1) { const x = ax === 'x' ? u : s * 46.5, z = ax === 'x' ? s * 46.5 : u; M.box(steel, x - 0.06, 0, z - 0.06, x + 0.06, FH + 0.5, z + 0.06, { collide: false, shadow: false }); }
    // barbed wire rails
    for (const y of [FH + 0.15, FH + 0.4]) M.box(steel, ax === 'x' ? -46.5 : s * 46.5 - 0.02, y, ax === 'x' ? s * 46.5 - 0.02 : -46.5, ax === 'x' ? 46.5 : s * 46.5 + 0.02, y + 0.03, ax === 'x' ? s * 46.5 + 0.02 : 46.5, { collide: false, shadow: false });
  }
  collider(W, -60, 0, -60, 60, 12, -46.3); collider(W, -60, 0, 46.3, 60, 12, 60); collider(W, -60, 0, -46.3, -46.3, 12, 46.3); collider(W, 46.3, 0, -46.3, 60, 12, 46.3);
  // ---- hangars (open to the south): corrugated walls, roof on trusses, interior cover
  const hangar = (x0, z0, x1, z1) => {
    const H = 7.5, t = 0.3;
    M.box(olive, x0, 0, z0, x1, H, z0 + t, { tile: 3, kind: 'metal' });
    M.box(olive, x0, 0, z0, x0 + t, H, z1, { tile: 3, kind: 'metal' }); M.box(olive, x1 - t, 0, z0, x1, H, z1, { tile: 3, kind: 'metal' });
    M.box(olive, x0, 0, z1 - t, x0 + 3, H, z1, { tile: 3, kind: 'metal' }); M.box(olive, x1 - 3, 0, z1 - t, x1, H, z1, { tile: 3, kind: 'metal' });
    M.box(olive, x0 + 3, 5.4, z1 - t, x1 - 3, H, z1, { tile: 3, kind: 'metal' }); // header above the door
    const cx = (x0 + x1) / 2, w = x1 - x0;
    for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(w / 2 + 0.6, 0.2, z1 - z0 + 0.6); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 6); g.translate(s * (w / 4), 0, 0); g.rotateZ(-s * 0.32); g.translate(cx, H + w / 4 * Math.tan(0.32) - 0.05, (z0 + z1) / 2); M.add(roofM, g); }
    collider(W, x0, H, z0, x1, H + 0.3, z1, 'metal');
    for (let z = z0 + 3; z < z1 - 1; z += 4) M.box(steel, x0 + t, H - 0.4, z - 0.12, x1 - t, H - 0.15, z + 0.12, { collide: false, shadow: false });
  };
  hangar(-33, -44, -13, -26); hangar(13, -44, 33, -26);
  // ---- watchtowers (corner): legs, platform, rails, roof, climbable stairs
  const tower = (x, z, sdir) => {
    const top = 3.6, hs = 1.7;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box(steel, x + sx * hs - 0.12, 0, z + sz * hs - 0.12, x + sx * hs + 0.12, top + 2.6, z + sz * hs + 0.12, { kind: 'metal' });
    M.box(wood, x - hs, top - 0.2, z - hs, x + hs, top, z + hs, { kind: 'wood' });
    const rail = (x0, z0, x1, z1) => M.box(wood, x0, top, z0, x1, top + 1.05, z1, { kind: 'wood', tile: 1 });
    rail(x - hs, z - hs, x + hs, z - hs + 0.1); rail(x - hs, z + hs - 0.1, x + hs, z + hs);
    if (sdir > 0) { rail(x - hs, z - hs, x - hs + 0.1, z + hs); rail(x + hs - 0.1, z - hs, x + hs, z - 0.2); } else { rail(x + hs - 0.1, z - hs, x + hs, z + hs); rail(x - hs, z - hs, x - hs + 0.1, z - 0.2); }
    M.box(roofM, x - hs - 0.3, top + 2.6, z - hs - 0.3, x + hs + 0.3, top + 2.8, z + hs + 0.3, { kind: 'metal' });
    // stairs along x, arriving at the open side (sdir = +1 -> stairs on the +x side going -x)
    const steps = 10, rise = top / steps, tread = 0.42, sw = 1.2, zc = z + hs - sw / 2 - 0.1;
    for (let i = 0; i < steps; i++) { const a = x + sdir * (hs + (steps - i) * tread), b = a - sdir * tread; M.box(wood, Math.min(a, b), 0, zc - sw / 2, Math.max(a, b), rise * (i + 1), zc + sw / 2, { kind: 'wood', tile: 1 }); }
  };
  tower(-40, -40, 1); tower(40, -40, -1); tower(-40, 40, 1); tower(40, 40, -1);
  // ---- barracks (enterable) + HQ
  enterable(W, { x0: -38, z0: 14, x1: -22, z1: 26, floors: 2, base: 0, color: 0xc8c0a0, inner: 0xe8e4d8,
    doors: [{ side: 'n', at: -34 }, { side: 'e', at: 20 }, { side: 's', at: -26 }], stairs: [{ x: -37.0, z: 25.2, dir: 'z-' }, { x: -23.0, z: 15.2, dir: 'z+' }], split: 'x', splitAt: -30, splitDoors: [17.5, 22.5] });
  enterable(W, { x0: 18, z0: 14, x1: 34, z1: 26, floors: 1, base: 0, color: 0xb8b496, inner: 0xe8e4d8,
    doors: [{ side: 'n', at: 22 }, { side: 'n', at: 30 }, { side: 'w', at: 20 }], stairs: [{ x: 33.0, z: 25.2, dir: 'z-' }] });
  // ---- helipad (south-centre) with markings
  const padTex = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#5d5f60'; x.fillRect(0, 0, w, h); x.strokeStyle = '#e8e4d6'; x.lineWidth = 14; x.beginPath(); x.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#e8e4d6'; const u = w / 16; x.fillRect(w / 2 - 3.2 * u, h / 2 - 4 * u, 1.6 * u, 8 * u); x.fillRect(w / 2 + 1.6 * u, h / 2 - 4 * u, 1.6 * u, 8 * u); x.fillRect(w / 2 - 1.6 * u, h / 2 - 0.8 * u, 3.2 * u, 1.6 * u);
    for (let i = 0; i < 2000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  }, false);
  { const g = new THREE.CylinderGeometry(7, 7.2, 0.18, 32); const m = new THREE.Mesh(g, [flat(0x6a6c6c), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.9 }), flat(0x6a6c6c)]); m.position.set(0, 0.09, 32); m.receiveShadow = true; W.group.add(m); collider(W, -5, 0, 27, 5, 0.18, 37); }
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; M.box(flat(0xffc040, { extra: { emissive: new THREE.Color(0xffa020), emissiveIntensity: 1.2 } }), Math.cos(a) * 7.4 - 0.12, 0, 32 + Math.sin(a) * 7.4 - 0.12, Math.cos(a) * 7.4 + 0.12, 0.25, 32 + Math.sin(a) * 7.4 + 0.12, { collide: false, shadow: false }); }
  // ---- container yard (west) + crates
  const Y = 0;
  W.container(-30, -6, false, 0x55603a, Y); W.container(-30, -6, false, 0x7a6a48, Y + 2.59); W.container(-38, 2, true, 0x2f5f8a, Y); W.container(-24, 4, true, 0x6c5b49, Y);
  W.container(-34, -14, false, 0x9b3a2e, Y); W.container(-16, -12, true, 0x55603a, Y);
  W.crate(-20, -4, 1.2); W.crate(-20, -5.3, 1.1, 0, 0.3); W.crate(-20.1, -4.6, 1.0, 1.2, 0.2); W.crate(-40, 10, 1.2); W.crate(-41.3, 10, 1.1); W.crate(-12, 10, 1.2, 0, 0.4);
  // ---- motor pool (east): parked armoured vehicles (props) + fuel tanks
  W.prop('truck_armored', '.', 40, 8, Math.PI, { kind: 'metal' }); W.prop('pickup_armored', '.', 34, 10, Math.PI + 0.1, { kind: 'metal' });
  if (!lite) W.prop('truck_armored', '.', -25, -34, Math.PI / 2, { kind: 'metal' }); // inside the west hangar
  W.prop('pickup_armored', '.', 25, -33, -Math.PI / 2 + 0.2, { kind: 'metal' });
  for (const [x, z] of [[-4, -38], [4, -38]]) { const g = new THREE.CylinderGeometry(1.5, 1.5, 6, 18); g.rotateZ(Math.PI / 2); g.translate(x, 1.7, z); M.add(W.pbr('rusty_metal_02', { color: 0xd8d4c8 }), g); collider(W, x - 3, 0, z - 1.5, x + 3, 3.2, z + 1.5, 'metal'); }
  // ---- defensive positions
  const sb = (x, z, r, small) => W.prop(small ? 'sack_trench_small' : 'sack_trench', '.', x, z, r, { kind: 'sand' });
  sb(-4, -14, 0); sb(4, 14, Math.PI); sb(14, -4, Math.PI / 2); sb(-14, 4, -Math.PI / 2); sb(-8, 40, 0, true); sb(8, 40, 0, true); sb(0, -18, 0, true); sb(-36, 32, Math.PI / 2, true); sb(10, 30, Math.PI / 2, true);
  W.jersey(-6, -22, false, 0); W.jersey(6, -22, false, 0); W.jersey(18, 4, true, 0); W.jersey(-10, 22, true, 0); W.jersey(30, 38, false, 0); W.jersey(-24, 38, false, 0);
  for (const [x, z, c] of [[22, -10, 0x3d5d3a], [22.6, -10.4, 0x3d5d3a], [-12, -32, 0x6a7f94], [-11.4, -32.5, 0x9e3b2c], [12, -30, 0x3d5d3a], [40, -12, 0x6a7f94]]) W.barrel(x, z, c, 0);
  W.crate(10, -30, 1.2, 0, 0.1); W.crate(11.2, -30.2, 1.1); W.crate(-12, -28, 1.2, 0, 0.3); W.crate(28, -16, 1.2); W.crate(40, 24, 1.1); W.crate(-6, 28, 1.0, 0, 0.5);
  // gate (south) with a barrier arm
  M.box(sand, -9, 0, 44.5, -6, 3, 46.2, { kind: 'concrete' }); M.box(sand, 6, 0, 44.5, 9, 3, 46.2, { kind: 'concrete' }); M.box(flat(0xd23a2a), -6, 1.1, 45.2, 6, 1.25, 45.35, { collide: false });
  // radio mast + distant hills / buildings for the skyline
  { const g = new THREE.CylinderGeometry(0.08, 0.3, 26, 4); g.translate(30, 13, -50); M.add(steel, g); }
  if (!lite) for (const [x, z, w, h] of [[-70, -30, 30, 8], [70, 20, 26, 10], [-20, 72, 40, 7], [40, -72, 30, 9]]) { const g = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(w, h, w * 0.6); g.translate(x, 0, z); M.add(W.pbr('dry_ground_01', { color: 0xa89470 }), g, false); }
  palms(W, lite ? [] : [[-8, 22, 0.4, 0.9], [8, 22, 2.2, 0.95]]);
  M.flush();
  Object.assign(W.env, { sun: 0xfff2e0, sunI: 3.3, fogD: 0.0085, fogTint: 0xc6c4b8, hemiSky: 0xc8d4dc, hemiGround: 0x5a5040, hemiI: 0.42, envI: 0.75, bgI: 0.9, minimap: { bg: '#5a5444', roads: false, hi: '#9a9a8a', lo: '#7a7462' } });
  W.playerSpawn = V(0, 6);
  W.medkitSpots = [V(-25, -30), V(25, -30), V(-30, 20), V(26, 20), V(0, 26)];
  W.enemySpawns = [[-42, -30], [-42, -14], [-43.5, 12], [-42, 30], [-26, 42], [-14, 42], [14, 42], [26, 42], [42, 30], [42, 0], [42, -24], [0, -42], [-10, -30], [10, -18]].map(([x, z]) => V(x, z));
  W.teamSpawns = [[[-25, -30], [25, -30], [0, -42], [-10, -30], [-42, -14], [42, -24]], [[-26, 42], [-14, 42], [14, 42], [26, 42], [-42, 30], [42, 30]]];
  W.vehicleSpawns = [[26, -4, -Math.PI / 2], [34, 0, -Math.PI / 2]];
  W.points = { extract: V(0, 32), defend: V(0, 32), hvt: V(-25, -30), hvtGuard: [[-30, -34], [-20, -28], [-25, -22]] };
}

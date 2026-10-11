// Enterable buildings (v1.4): concrete shells with real door openings, window holes, floor slabs, stepped stairs
// up to an upper floor and the roof, interior partition walls and parapets. Every solid piece is an axis-aligned
// Box collider (bullets, movement, camera), and the geometry is merged per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box } from './physics.js';

const T = 0.3;          // wall thickness
const FH = 3.2;         // floor-to-floor height
const SLAB = 0.25;      // floor slab thickness
const STEPS = 9, RISE = FH / STEPS, TREAD = 0.42, SW = 1.4; // stairs: 9 risers of 0.356 m (walkable step-up is 0.45)

// Indoor fill light without real lights: faces that sit inside the building get a 'glow' vertex attribute that
// adds an emissive term proportional to their albedo (cheap fake bounce light; no extra cost on phones).
const glowMats = new Map();
function glowMat(base) {
  if (glowMats.has(base)) return glowMats.get(base);
  const m = base.clone(); m.emissive = new THREE.Color(1, 0.97, 0.92); m.emissiveIntensity = 0.75;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * diffuseColor.rgb;');
  };
  m.customProgramCacheKey = () => 'bglow';
  glowMats.set(base, m); return m;
}
class Batch { // merged box geometry per material
  constructor(inside) { this.parts = new Map(); this.inside = inside; }
  add(mat, x0, y0, z0, x1, y1, z1, tile = 2) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    // world-aligned UVs so neighbouring pieces line up
    const off = [[z0, y0], [z0, y0], [x0, z0], [x0, z0], [x0, y0], [x0, y0]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0] + off[f][0]) / tile, (uv.getY(i) * dims[f][1] + off[f][1]) / tile); }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // per-face glow: is the face centre inside the interior volume?
    const I = this.inside, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2, zm = (z0 + z1) / 2, e = 0.02;
    const cen = [[x1, ym, zm], [x0, ym, zm], [xm, y1, zm], [xm, y0, zm], [xm, ym, z1], [xm, ym, z0]];
    const gl = new Float32Array(24);
    for (let f = 0; f < 6; f++) { const [cx, cy, cz] = cen[f]; const inn = I && cx > I.x0 - e && cx < I.x1 + e && cz > I.z0 - e && cz < I.z1 + e && cy < I.top - e; for (let k = 0; k < 4; k++) gl[f * 4 + k] = inn ? 1 : 0.2; }
    g.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
    if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g);
  }
  flush(group, meshes) {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false); list.forEach(q => q.dispose());
      const m = new THREE.Mesh(g, glowMat(mat)); m.castShadow = true; m.receiveShadow = true; group.add(m); meshes.push(m);
    }
    this.parts.clear();
  }
}

// Wall along X (axis 'x', fixed z) or along Z (axis 'z', fixed x). openings: [{a, b, y0, y1}] in world units along the wall.
function wall(B, W, mat, axis, a0, a1, fix0, fix1, y0, y1, openings, kind = 'concrete') {
  const cuts = new Set([a0, a1]); for (const o of openings) { cuts.add(Math.max(a0, Math.min(a1, o.a))); cuts.add(Math.max(a0, Math.min(a1, o.b))); }
  const xs = [...cuts].sort((p, q) => p - q);
  for (let i = 0; i < xs.length - 1; i++) {
    const s0 = xs[i], s1 = xs[i + 1]; if (s1 - s0 < 0.01) continue; const mid = (s0 + s1) / 2;
    const o = openings.find(q => mid > q.a && mid < q.b);
    const spans = o ? [[y0, Math.max(y0, o.y0)], [Math.min(y1, o.y1), y1]] : [[y0, y1]];
    for (const [ya, yb] of spans) {
      if (yb - ya < 0.01) continue;
      if (axis === 'x') piece(B, W, mat, s0, ya, fix0, s1, yb, fix1, kind); else piece(B, W, mat, fix0, ya, s0, fix1, yb, s1, kind);
    }
  }
}
function piece(B, W, mat, x0, y0, z0, x1, y1, z1, kind = 'concrete', collide = true, tile = 2) {
  B.add(mat, x0, y0, z0, x1, y1, z1, tile);
  if (collide) W.boxes.push(new Box(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), kind));
}
// floor slab with rectangular holes (stairwells): split into strips around the holes
function slab(B, W, mat, x0, z0, x1, z1, y, holes) {
  const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h.x0, h.x1])])].sort((p, q) => p - q);
  const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h.z0, h.z1])])].sort((p, q) => p - q);
  // greedy: emit one box per x-strip of contiguous non-hole cells
  for (let i = 0; i < xs.length - 1; i++) {
    let start = null;
    for (let j = 0; j < zs.length; j++) {
      const inside = j < zs.length - 1 && !holes.some(h => (xs[i] + xs[i + 1]) / 2 > h.x0 && (xs[i] + xs[i + 1]) / 2 < h.x1 && (zs[j] + zs[j + 1]) / 2 > h.z0 && (zs[j] + zs[j + 1]) / 2 < h.z1);
      if (inside && start === null) start = zs[j];
      if (!inside && start !== null) { piece(B, W, mat, xs[i], y - SLAB, start, xs[i + 1], y, zs[j], 'concrete', true, 3); start = null; }
    }
  }
}
// straight stair run: steps rise along +dir from the base level. Solid stepped blocks (walkable, bullet-proof).
function stairs(B, W, mat, x, z, dir, base, sideX) { // dir: 'x+','x-','z+','z-'; (x,z) = foot of the run (centre of the first tread's outer edge)
  const run = STEPS * TREAD; const out = [];
  for (let k = 0; k < STEPS; k++) {
    const top = base + RISE * (k + 1) - (k === STEPS - 1 ? 0.0 : 0);
    const a = k * TREAD, b = (k + 1) * TREAD;
    let x0, x1, z0, z1;
    if (dir === 'x+') { x0 = x + a; x1 = x + b; z0 = z - SW / 2; z1 = z + SW / 2; }
    else if (dir === 'x-') { x0 = x - b; x1 = x - a; z0 = z - SW / 2; z1 = z + SW / 2; }
    else if (dir === 'z+') { z0 = z + a; z1 = z + b; x0 = x - SW / 2; x1 = x + SW / 2; }
    else { z0 = z - b; z1 = z - a; x0 = x - SW / 2; x1 = x + SW / 2; }
    piece(B, W, mat, x0, base, z0, x1, Math.min(top, base + FH - 0.02), z1, 'concrete', true, 1);
  }
  // footprint of the run (for the slab hole above)
  if (dir === 'x+') return { x0: x, x1: x + run, z0: z - SW / 2, z1: z + SW / 2 };
  if (dir === 'x-') return { x0: x - run, x1: x, z0: z - SW / 2, z1: z + SW / 2 };
  if (dir === 'z+') return { x0: x - SW / 2, x1: x + SW / 2, z0: z, z1: z + run };
  return { x0: x - SW / 2, x1: x + SW / 2, z0: z - run, z1: z };
}
// rails around a stair hole (leave the arrival end open)
function holeRail(B, W, mat, h, y, openEnd) {
  const r = 0.08, H = 1.0;
  const sides = { 'x+': [['z0'], ['z1'], ['x0']], 'x-': [['z0'], ['z1'], ['x1']], 'z+': [['x0'], ['x1'], ['z0']], 'z-': [['x0'], ['x1'], ['z1']] }[openEnd];
  for (const [s] of sides) {
    if (s === 'z0') piece(B, W, mat, h.x0, y, h.z0 - r, h.x1, y + H, h.z0, 'metal', true, 1);
    if (s === 'z1') piece(B, W, mat, h.x0, y, h.z1, h.x1, y + H, h.z1 + r, 'metal', true, 1);
    if (s === 'x0') piece(B, W, mat, h.x0 - r, y, h.z0 - r, h.x0, y + H, h.z1 + r, 'metal', true, 1);
    if (s === 'x1') piece(B, W, mat, h.x1, y, h.z0 - r, h.x1 + r, y + H, h.z1 + r, 'metal', true, 1);
  }
}

// spec: { x0,z0,x1,z1, floors (2), doors: [{side:'n'|'s'|'e'|'w', at, w}], stairs: [ {x,z,dir} per level ], split: 'x'|'z', splitAt, splitDoors: [..], color }
export function enterable(W, spec) {
  const { x0, z0, x1, z1 } = spec, floors = spec.floors || 2, base = spec.base ?? 0.15;
  const B = new Batch({ x0: x0 + T, z0: z0 + T, x1: x1 - T, z1: z1 - T, top: base + floors * FH });
  const ext = W.pbr('concrete_floor_worn_001', { color: spec.color ?? 0xf0e4cc, roughness: 1, normal: 1.2, env: 1.3 });
  const intr = W.pbr('concrete_floor_worn_001', { color: spec.inner ?? 0xf2eee6, roughness: 1, normal: 0.8, env: 1.4 });
  const flo = W.pbr('square_concrete_pavers', { color: 0xc8c0b4 });
  const trim = W.pbr('concrete_floor_worn_001', { color: 0x8a847a });
  const steel = W.pbr('rusty_metal_02', { color: 0x3c3c3c });
  const top = base + floors * FH;
  // ---- exterior walls with doors (ground) and windows (every floor)
  const sides = {
    n: { axis: 'x', a0: x0, a1: x1, f0: z0, f1: z0 + T }, s: { axis: 'x', a0: x0, a1: x1, f0: z1 - T, f1: z1 },
    w: { axis: 'z', a0: z0 + T, a1: z1 - T, f0: x0, f1: x0 + T }, e: { axis: 'z', a0: z0 + T, a1: z1 - T, f0: x1 - T, f1: x1 },
  };
  for (const [k, s] of Object.entries(sides)) {
    for (let f = 0; f < floors; f++) {
      const yb = base + f * FH, yt = yb + FH;
      const ops = [];
      if (f === 0) for (const d of (spec.doors || []).filter(d => d.side === k)) ops.push({ a: d.at - (d.w || 2.4) / 2, b: d.at + (d.w || 2.4) / 2, y0: yb - 1, y1: yb + 2.5 });
      const L = s.a1 - s.a0, n = Math.max(1, Math.floor(L / 3.6));
      for (let i = 0; i < n; i++) {
        const c = s.a0 + (i + 0.5) * L / n;
        if (ops.some(o => c + 0.8 > o.a - 0.4 && c - 0.8 < o.b + 0.4)) continue;
        if ((spec.blind || []).some(bl => bl.side === k && bl.f === f && Math.abs(bl.at - c) < 1.4)) continue;
        ops.push({ a: c - 0.7, b: c + 0.7, y0: yb + 1.0, y1: yb + 2.25 });
      }
      wall(B, W, ext, s.axis, s.a0, s.a1, s.f0, s.f1, yb, yt - (f === floors - 1 ? 0 : 0), ops);
      // window sills / lintels (dark trim, no collider)
      for (const o of ops) if (o.y0 > yb) {
        if (s.axis === 'x') { B.add(trim, o.a - 0.08, o.y0 - 0.08, s.f0 - 0.06, o.b + 0.08, o.y0, s.f1 + 0.06); B.add(trim, o.a - 0.08, o.y1, s.f0 - 0.04, o.b + 0.08, o.y1 + 0.12, s.f1 + 0.04); }
        else { B.add(trim, s.f0 - 0.06, o.y0 - 0.08, o.a - 0.08, s.f1 + 0.06, o.y0, o.b + 0.08); B.add(trim, s.f0 - 0.04, o.y1, o.a - 0.08, s.f1 + 0.04, o.y1 + 0.12, o.b + 0.08); }
      }
    }
    // floor band + parapet
    for (let f = 1; f <= floors; f++) { const y = base + f * FH; if (s.axis === 'x') B.add(trim, s.a0 - 0.05, y - 0.22, s.f0 - 0.05, s.a1 + 0.05, y, s.f1 + 0.05); else B.add(trim, s.f0 - 0.05, y - 0.22, s.a0, s.f1 + 0.05, y, s.a1); }
    if (s.axis === 'x') piece(B, W, ext, s.a0, top, s.f0, s.a1, top + 1.05, s.f1); else piece(B, W, ext, s.f0, top, s.a0, s.f1, top + 1.05, s.a1);
    if (s.axis === 'x') B.add(trim, s.a0 - 0.06, top + 1.05, s.f0 - 0.06, s.a1 + 0.06, top + 1.17, s.f1 + 0.06); else B.add(trim, s.f0 - 0.06, top + 1.05, s.a0 - 0.06, s.f1 + 0.06, top + 1.17, s.a1 + 0.06);
  }
  // ---- ground floor
  B.add(flo, x0 + T, base - 0.02, z0 + T, x1 - T, base + 0.01, z1 - T, 3);
  // ---- stairs per level (level f -> f+1), slab holes + rails above
  const holes = [];
  (spec.stairs || []).forEach((st, f) => {
    if (f >= floors) return;
    const yb = base + f * FH;
    const h = stairs(B, W, intr, st.x, st.z, st.dir, yb);
    holes[f + 1] = (holes[f + 1] || []).concat([h]);
    // landing guard wall on the stair's open side, if requested
  });
  for (let f = 1; f <= floors; f++) {
    const y = base + f * FH; const hs = holes[f] || [];
    slab(B, W, f === floors ? ext : intr, x0 + T, z0 + T, x1 - T, z1 - T, y, hs);
    hs.forEach((h, i) => { const st = spec.stairs[f - 1]; holeRail(B, W, steel, h, y, st.dir); });
  }
  // ---- interior partition (each floor) with door gaps
  if (spec.split) {
    for (let f = 0; f < floors; f++) {
      const yb = base + f * FH, yt = yb + FH - SLAB;
      const ops = (spec.splitDoors || []).map(c => ({ a: c - 1.2, b: c + 1.2, y0: yb - 1, y1: yb + 2.4 }));
      const t2 = 0.2;
      if (spec.split === 'x') wall(B, W, intr, 'z', z0 + T, z1 - T, spec.splitAt - t2 / 2, spec.splitAt + t2 / 2, yb, yt, ops); // wall at fixed x
      else wall(B, W, intr, 'x', x0 + T, x1 - T, spec.splitAt - t2 / 2, spec.splitAt + t2 / 2, yb, yt, ops);
    }
  }
  // inner face colour: thin interior skin on the exterior walls is skipped (one material per wall keeps it cheap)
  B.flush(W.group, W.meshes);
  W.buildings.push({ x0, z0, x1, z1, H: top, enterable: true, floors, base });
  (W.floorRects = W.floorRects || []).push({ x0, z0, x1, z1 });
  return { top };
}
export const BUILDING_CONST = { FH, SLAB, STEPS, RISE, TREAD, SW, T };

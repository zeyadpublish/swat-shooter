// Collision + ray utilities: axis-aligned box colliders, circle-vs-box character movement,
// ray vs box / sphere / capsule tests, and a grid navmesh with A*.
import * as THREE from 'three';

export class Box {
  constructor(min, max, mat = 'concrete') { this.min = min.clone(); this.max = max.clone(); this.mat = mat; }
}

const _inv = new THREE.Vector3();
// Slab test. Returns {t, nx,ny,nz} or null
export function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
    const mn = i === 0 ? b.min.x : i === 1 ? b.min.y : b.min.z;
    const mx = i === 0 ? b.max.x : i === 1 ? b.max.y : b.max.z;
    if (Math.abs(di) < 1e-9) { if (oi < mn || oi > mx) return null; continue; }
    let t1 = (mn - oi) / di, t2 = (mx - oi) / di, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // origin inside
  return { t: tmin, axis, sign };
}

export function raycastBoxes(boxes, o, d, maxT = 500) {
  let best = null, bb = null;
  for (const b of boxes) {
    const h = rayBox(o, d, b, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) { best = h; bb = b; }
  }
  if (!best) return null;
  const normal = new THREE.Vector3();
  normal.setComponent(best.axis, best.sign);
  return { t: best.t, point: o.clone().addScaledVector(d, best.t), normal, box: bb };
}

export function lineOfSight(boxes, a, b) {
  const d = _inv.subVectors(b, a); const len = d.length(); if (len < 1e-6) return true;
  const dir = d.clone().divideScalar(len);
  for (const bx of boxes) if (rayBox(a, dir, bx, len)) return false;
  return true;
}

export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return null; return t;
}

// ray vs capsule (segment a-b, radius r) — closest-approach approximation
export function rayCapsule(o, d, a, b, r, maxT) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const w = new THREE.Vector3().subVectors(o, a);
  const B = d.dot(ab), C = ab.dot(ab), D = d.dot(w), E = ab.dot(w);
  const denom = C - B * B;
  let s = denom > 1e-8 ? (E - B * D) / denom : 0;
  s = THREE.MathUtils.clamp(s, 0, 1);
  const p = new THREE.Vector3().copy(a).addScaledVector(ab, s);
  const t = Math.max(0, d.dot(new THREE.Vector3().subVectors(p, o)));
  const q = new THREE.Vector3().copy(o).addScaledVector(d, t);
  const dist = q.distanceTo(p);
  if (dist > r || t > maxT) return null;
  return Math.max(0, t - Math.sqrt(r * r - dist * dist));
}

// Push a vertical cylinder (feet at pos.y, radius, height) out of boxes. Mutates pos.
export function resolveCircle(boxes, pos, radius, height, stepUp = 0.45) {
  let hitWall = false;
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      if (b.max.y <= pos.y + stepUp || b.min.y >= pos.y + height) continue;
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hitWall = true;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); pos.x += dx / d * (radius - d); pos.z += dz / d * (radius - d); }
      else { // center inside box: push out along smallest axis
        const px1 = pos.x - b.min.x, px2 = b.max.x - pos.x, pz1 = pos.z - b.min.z, pz2 = b.max.z - pos.z;
        const m = Math.min(px1, px2, pz1, pz2);
        if (m === px1) pos.x = b.min.x - radius; else if (m === px2) pos.x = b.max.x + radius;
        else if (m === pz1) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
      }
    }
  }
  return hitWall;
}

// Highest walkable surface under the circle that is not above feet+maxUp
export function groundHeight(boxes, pos, radius, maxUp = 0.45) {
  let g = 0;
  for (const b of boxes) {
    if (b.max.y > pos.y + maxUp || b.max.y <= g) continue;
    if (pos.x + radius * 0.6 < b.min.x || pos.x - radius * 0.6 > b.max.x || pos.z + radius * 0.6 < b.min.z || pos.z - radius * 0.6 > b.max.z) continue;
    g = b.max.y;
  }
  return g;
}

// ---------------- Navigation grid -----------------
export class NavGrid {
  constructor(boxes, half, cell = 1, inflate = 0.5) {
    this.half = half; this.cell = cell; this.n = Math.ceil(half * 2 / cell);
    this.blocked = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell;
      for (const b of boxes) {
        if (b.max.y < 0.5 || b.min.y > 1.8) continue;
        if (x > b.min.x - inflate && x < b.max.x + inflate && z > b.min.z - inflate && z < b.max.z + inflate) { this.blocked[j * this.n + i] = 1; break; }
      }
    }
  }
  toCell(x, z) { return [Math.floor((x + this.half) / this.cell), Math.floor((z + this.half) / this.cell)]; }
  toWorld(i, j) { return new THREE.Vector3(-this.half + (i + 0.5) * this.cell, 0, -this.half + (j + 0.5) * this.cell); }
  ok(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.blocked[j * this.n + i]; }
  nearestFree(i, j) {
    if (this.ok(i, j)) return [i, j];
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (this.ok(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  randomFree() { for (let k = 0; k < 500; k++) { const i = Math.random() * this.n | 0, j = Math.random() * this.n | 0; if (this.ok(i, j)) return this.toWorld(i, j); } return new THREE.Vector3(); }
  clearLine(i0, j0, i1, j1) {
    const steps = Math.ceil(Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0)) * 3) || 1;
    for (let s = 0; s <= steps; s++) {
      const fi = i0 + (i1 - i0) * s / steps, fj = j0 + (j1 - j0) * s / steps;
      // check the 4 cells around the sample (thick line)
      if (!this.ok(Math.round(fi - 0.35), Math.round(fj - 0.35)) || !this.ok(Math.round(fi + 0.35), Math.round(fj + 0.35)) ||
          !this.ok(Math.round(fi - 0.35), Math.round(fj + 0.35)) || !this.ok(Math.round(fi + 0.35), Math.round(fj - 0.35))) return false;
    }
    return true;
  }
  findPath(from, to) {
    const n = this.n;
    let s = this.nearestFree(...this.toCell(from.x, from.z)), g = this.nearestFree(...this.toCell(to.x, to.z));
    if (!s || !g) return null;
    const N = n * n, gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const si = s[1] * n + s[0], gi = g[1] * n + g[0];
    const heap = [[0, si]]; gScore[si] = 0;
    const h = (i) => { const x = i % n, y = (i / n) | 0; const dx = Math.abs(x - g[0]), dy = Math.abs(y - g[1]); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const push = (e) => { heap.push(e); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    let iters = 0;
    while (heap.length && iters++ < 8000) {
      const [, cur] = pop(); if (cur === gi) break; if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % n, cy = (cur / n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy;
        if (!this.ok(nx, ny)) continue;
        if (dx && dy && (!this.ok(cx + dx, cy) || !this.ok(cx, cy + dy))) continue;
        const ni = ny * n + nx, ng = gScore[cur] + (dx && dy ? 1.414 : 1);
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; push([ng + h(ni), ni]); }
      }
    }
    if (came[gi] < 0 && gi !== si) return null;
    const cells = []; for (let c = gi; c !== -1; c = came[c]) { cells.push(c); if (c === si) break; }
    cells.reverse();
    // string pulling
    const out = []; let anchor = 0;
    for (let k = 1; k < cells.length; k++) {
      const a = cells[anchor], b = cells[k];
      if (!this.clearLine(a % n, (a / n) | 0, b % n, (b / n) | 0)) { anchor = k - 1; out.push(cells[anchor]); }
    }
    const pts = out.map(c => this.toWorld(c % n, (c / n) | 0));
    pts.push(new THREE.Vector3(to.x, 0, to.z));
    return pts;
  }
}

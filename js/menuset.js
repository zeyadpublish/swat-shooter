// v1.7 menu backdrop: dusk grading of the live map plus a small police cordon behind the operator
// (a police-liveried sedan with a flashing red/blue light bar, road barriers, sandbags). Built from the game's own models.
import * as THREE from 'three';
export class MenuSet {
  constructor(g) {
    this.g = g; this.on = false; this.t = 0; const K = g.world.kits;
    const root = this.root = new THREE.Group(); root.visible = false; g.scene.add(root);
    const add = (kit, x, z, ry, s = 1) => { const src = K[kit]; if (!src) return null; const o = src.clone(true); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s); o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } }); root.add(o); return o; };
    // police car: the CC0 sedan, white with black doors look (body tinted white), light bar on the roof
    const car = add('sedan', -3.2, -7.5, 0.55);
    if (car) {
      car.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); const c = m.material.color; if (c) { const L = c.r + c.g + c.b, n = (m.material.name || '') + (m.name || ''); if (!/glass|window|tire|tyre|wheel|light/i.test(n) && L > 0.12) c.setRGB(0.9, 0.91, 0.93); } } });
      const bb = new THREE.Box3().setFromObject(car), top = bb.max.y, ctr = bb.getCenter(new THREE.Vector3());
      const mk = (col) => new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.2), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3, roughness: 0.3 }));
      this.red = mk(0xff2030); this.blue = mk(0x2050ff);
      const bar = new THREE.Group(); bar.add(this.red, this.blue); this.red.position.x = -0.24; this.blue.position.x = 0.24;
      bar.position.set(ctr.x, top + 0.04, ctr.z); bar.rotation.y = 0.55 + Math.PI / 2; root.add(bar);
      this.lr = new THREE.PointLight(0xff2030, 0, 14, 1.6); this.lb = new THREE.PointLight(0x3060ff, 0, 14, 1.6);
      this.lr.position.copy(bar.position).add(new THREE.Vector3(-0.4, 0.4, 0)); this.lb.position.copy(bar.position).add(new THREE.Vector3(0.4, 0.4, 0)); root.add(this.lr, this.lb);
    }
    add('concrete_road_barrier', 1.6, -6.2, 0.15); add('concrete_road_barrier', 4.4, -6.6, -0.1);
    add('sack_trench_small', -0.4, -5.2, 0.35, 0.55); add('sack_trench_small', 3.0, -5.0, -0.25, 0.55);
    // soft key light on the operator from the camera side (dusk would leave him a silhouette)
    this.key = new THREE.PointLight(0xdfe6ff, 0, 12, 1.4); this.key.position.set(1.6, 2.6, 3.2); root.add(this.key);
    add('old_tyre', 5.4, -5.2, 0); add('metal_trash_can', -5.8, -5.0, 0);
  }
  // menu state: dusk light + cordon; anything else: the map's own lighting
  update(dt) {
    const g = this.g, want = g.state === 'menu' && !(g.ui && g.ui.cur === 'loadout');
    if (want !== this.on) { this.on = want; this.root.visible = want; this.grade(want); }
    if (!want) return; this.t += dt;
    const p = g.player.pos; this.root.position.set(p.x, 0, p.z); this.root.rotation.y = Math.PI + 0.5;
    // light bar: alternating double flashes
    const ph = (this.t * 2.2) % 2, f = (a) => (ph > a && ph < a + 0.12) || (ph > a + 0.24 && ph < a + 0.36) ? 1 : 0, r = f(0), b = f(1);
    this.key.intensity = 9; if (this.red) { this.red.material.emissiveIntensity = 0.4 + r * 5; this.blue.material.emissiveIntensity = 0.4 + b * 5; this.lr.intensity = r * 16; this.lb.intensity = b * 18; }
  }
  grade(on) {
    const g = this.g, sc = g.scene, e = g.world.env || {};
    if (on) {
      sc.environmentIntensity = (e.envI ?? 0.75) * 0.42; sc.backgroundIntensity = (e.bgI ?? 0.9) * 0.32; g.sun.intensity = 0.9; g.sun.color.set(0xffb27a); g.hemi.intensity = 0.22;
      sc.fog.color.set(0x2b3240); sc.fog.density = Math.max(0.012, (e.fogD ?? 0.0065) * 1.8); g.renderer.toneMappingExposure = 0.95;
    } else { g.applyEnv(); g.applyReflections && g.applyReflections(); g.renderer.toneMappingExposure = g.settings.hdr === false ? 0.9 : 1.0; }
  }
}

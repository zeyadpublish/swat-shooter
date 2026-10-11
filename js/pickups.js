import * as THREE from 'three';
// Ammo crates dropped by killed enemies: a small olive crate with a glowing band and a light beam.
export class Pickups {
  constructor(game) {
    this.g = game; this.items = [];
    const crate = new THREE.MeshStandardMaterial({ color: 0x4d5a2e, roughness: 0.75, metalness: 0.1 });
    const band = new THREE.MeshStandardMaterial({ color: 0xffc94a, emissive: 0xffb020, emissiveIntensity: 2.2, roughness: 0.4 });
    const beam = new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mats = { crate, band, beam };
    this.geo = { box: new THREE.BoxGeometry(0.5, 0.28, 0.32), band: new THREE.BoxGeometry(0.52, 0.06, 0.34), lid: new THREE.BoxGeometry(0.06, 0.3, 0.34), beam: new THREE.CylinderGeometry(0.16, 0.3, 2.4, 16, 1, true) };
  }
  spawn(pos) {
    const g = new THREE.Group(); const m = this.mats, G = this.geo;
    const box = new THREE.Mesh(G.box, m.crate); box.castShadow = true; box.position.y = 0.14;
    const b = new THREE.Mesh(G.band, m.band); b.position.y = 0.2;
    const l1 = new THREE.Mesh(G.lid, m.band); l1.position.set(-0.17, 0.14, 0); const l2 = l1.clone(); l2.position.x = 0.17;
    const inner = new THREE.Group(); inner.add(box, b, l1, l2);
    const beam = new THREE.Mesh(G.beam, m.beam); beam.position.y = 1.2;
    g.add(inner, beam); g.position.copy(pos); g.position.y += 0.02;
    this.g.scene.add(g); this.items.push({ g, inner, beam, t: 0, pos: g.position });
  }
  update(dt) {
    const p = this.g.player;
    for (const it of this.items) {
      it.t += dt; it.inner.rotation.y += dt * 1.4; it.inner.position.y = 0.06 + Math.sin(it.t * 3) * 0.05;
      it.beam.material.opacity = 0.32;
      const fade = it.t > 27 ? Math.sin(it.t * 18) > 0 : true; it.g.visible = fade;
      if (!p.dead && it.pos.distanceToSquared(p.pos) < 1.3 * 1.3 && Math.abs(it.pos.y - p.pos.y) < 1.5) {
        p.addAmmo(1); this.g.sfx.pickup(); this.g.hud.pickupFlash(); it.done = true;
      }
      if (it.t > 30) it.done = true;
      if (it.done) this.g.scene.remove(it.g);
    }
    this.items = this.items.filter(i => !i.done);
  }
  clear() { for (const it of this.items) this.g.scene.remove(it.g); this.items = []; }
}

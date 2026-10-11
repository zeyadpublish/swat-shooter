import * as THREE from 'three';
// Pickups: ammo crates dropped by killed enemies (olive crate, amber beam) and medkits (white case with a red cross,
// green beam) that sit on fixed spots of the map and come back 40 s after being taken (enemies drop some too).
export class Pickups {
  constructor(game) {
    this.g = game; this.items = []; this.spots = [];
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const beam = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.mats = { crate: M({ color: 0x4d5a2e, roughness: 0.75, metalness: 0.1 }), band: M({ color: 0xffc94a, emissive: 0xffb020, emissiveIntensity: 2.2, roughness: 0.4 }), beam: beam(0xffc23a),
      white: M({ color: 0xeeeeea, roughness: 0.45 }), red: M({ color: 0xd0261c, emissive: 0x9a1008, emissiveIntensity: 1.2, roughness: 0.5 }), gbeam: beam(0x5dff8a) };
    this.geo = { box: new THREE.BoxGeometry(0.5, 0.28, 0.32), band: new THREE.BoxGeometry(0.52, 0.06, 0.34), lid: new THREE.BoxGeometry(0.06, 0.3, 0.34), beam: new THREE.CylinderGeometry(0.16, 0.3, 2.4, 16, 1, true),
      kit: new THREE.BoxGeometry(0.42, 0.26, 0.16), cr1: new THREE.BoxGeometry(0.2, 0.06, 0.165), cr2: new THREE.BoxGeometry(0.06, 0.2, 0.165) };
  }
  spawn(pos, kind = 'ammo', spot = null) {
    const g = new THREE.Group(), m = this.mats, G = this.geo, inner = new THREE.Group();
    if (kind === 'medkit') {
      const box = new THREE.Mesh(G.kit, m.white); box.castShadow = true; box.position.y = 0.14;
      const a = new THREE.Mesh(G.cr1, m.red), b = new THREE.Mesh(G.cr2, m.red); a.position.y = b.position.y = 0.14; inner.add(box, a, b);
    } else {
      const box = new THREE.Mesh(G.box, m.crate); box.castShadow = true; box.position.y = 0.14;
      const b = new THREE.Mesh(G.band, m.band); b.position.y = 0.2;
      const l1 = new THREE.Mesh(G.lid, m.band); l1.position.set(-0.17, 0.14, 0); const l2 = l1.clone(); l2.position.x = 0.17; inner.add(box, b, l1, l2);
    }
    const beam = new THREE.Mesh(G.beam, kind === 'medkit' ? m.gbeam : m.beam); beam.position.y = 1.2;
    g.add(inner, beam); g.position.copy(pos); g.position.y += 0.02;
    this.g.scene.add(g); const it = { g, inner, beam, t: 0, pos: g.position, kind, spot }; this.items.push(it); return it;
  }
  // fixed medkit spots for the current map
  placeSpots(list) { this.spots = (list || []).map(p => ({ p: p.clone(), item: null, back: 0 })); for (const s of this.spots) s.item = this.spawn(s.p, 'medkit', s); }
  update(dt) {
    const p = this.g.player;
    for (const s of this.spots) if (!s.item && (s.back -= dt) <= 0) s.item = this.spawn(s.p, 'medkit', s);
    for (const it of this.items) {
      it.t += dt; it.inner.rotation.y += dt * 1.4; it.inner.position.y = 0.06 + Math.sin(it.t * 3) * 0.05;
      const temp = !it.spot, fade = temp && it.t > 27 ? Math.sin(it.t * 18) > 0 : true; it.g.visible = fade;
      if (!p.dead && !p.vehicle && it.pos.distanceToSquared(p.pos) < 1.3 * 1.3 && Math.abs(it.pos.y - p.pos.y) < 1.5) {
        if (it.kind === 'medkit') { if (p.addMedkit()) { this.g.sfx.pickup(); this.g.hud.toast && this.g.hud.toast('+1 MEDKIT', 'ok'); it.done = true; } }
        else { p.addAmmo(1); this.g.sfx.pickup(); this.g.hud.pickupFlash(); it.done = true; }
      }
      if (temp && it.t > 30) it.done = true;
      if (it.done) { this.g.scene.remove(it.g); if (it.spot) { it.spot.item = null; it.spot.back = 40; } }
    }
    this.items = this.items.filter(i => !i.done);
  }
  clear() { for (const it of this.items) this.g.scene.remove(it.g); this.items = []; this.spots = []; }
}

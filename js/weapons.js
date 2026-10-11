// Weapon definitions. Model frame for every gun: +Z = muzzle, +Y = up, metres.
// grip = point held by the right hand, muzzle / eject in the same frame.
// mob = mobility (0..1): scales movement speed slightly while the gun is in hand.
// Damage: body damage per bullet (pellet); head / legs multipliers; range = [full-damage distance, min-damage distance, min multiplier].
export const WEAPONS = [
  { id: 'm4a1', name: 'M4A1', cls: 'ASSAULT RIFLE', file: 'assets/m4a1.glb', thumb: 'assets/ui/m4a1.png',
    fore: [0, -0.035, 0.2], grip: [0, -0.06, -0.085], muzzle: [0, 0.02, 0.545], eject: [-0.03, 0.01, 0.04], magNode: 'Magazine',
    dmg: 34, head: 3.0, legs: 0.75, cool: 0.092, auto: true, mag: 30, reserve: 180, reload: 2.1,
    hip: 0.012, ads: 0.0015, bloom: 0.0045, recoil: 0.011, range: [30, 80, 0.6], pellets: 1, flash: 1, sound: 'rifle', mob: 0.78, zoom: 22 },
  { id: 'akm', name: 'AKM', cls: 'ASSAULT RIFLE', file: 'assets/guns/akm.glb', thumb: 'assets/ui/akm.png',
    fore: [0, 0.02, 0.1], grip: [0, -0.015, -0.215], muzzle: [0, 0.075, 0.44], eject: [-0.03, 0.07, -0.1], magNode: null,
    dmg: 41, head: 2.6, legs: 0.75, cool: 0.1, auto: true, mag: 30, reserve: 150, reload: 2.4,
    hip: 0.014, ads: 0.0022, bloom: 0.006, recoil: 0.015, range: [28, 75, 0.6], pellets: 1, flash: 1.1, sound: 'ak', mob: 0.72, zoom: 22 },
  { id: 'shotgun', name: 'PUMP SHOTGUN', cls: 'SHOTGUN', file: 'assets/guns/shotgun.glb', thumb: 'assets/ui/shotgun.png',
    fore: [0, 0.0, 0.18], grip: [0, -0.005, -0.16], muzzle: [0, 0.055, 0.52], eject: [-0.03, 0.04, -0.03], magNode: null,
    dmg: 17, head: 1.5, legs: 0.8, cool: 0.85, auto: false, mag: 7, reserve: 42, reload: 2.7,
    hip: 0.045, ads: 0.028, bloom: 0.004, recoil: 0.045, range: [7, 24, 0.15], pellets: 9, flash: 1.6, sound: 'shotgun', mob: 0.7, zoom: 14, pump: true },
  { id: 'svd', name: 'SVD SNIPER', cls: 'SNIPER RIFLE', file: 'assets/guns/svd.glb', thumb: 'assets/ui/svd.png',
    fore: [0, -0.03, 0.08], grip: [0, -0.06, -0.345], muzzle: [0, 0.0, 0.613], eject: [-0.03, 0.02, -0.18], magNode: null,
    dmg: 95, head: 3.0, legs: 0.8, cool: 1.15, auto: false, mag: 10, reserve: 40, reload: 2.8,
    hip: 0.035, ads: 0.0002, bloom: 0.01, recoil: 0.055, range: [90, 220, 0.8], pellets: 1, flash: 1.4, sound: 'sniper', mob: 0.55, zoom: 22, scope: true, scopeFov: 11 },
  { id: 'pistol', name: 'M1911', cls: 'PISTOL', file: 'assets/guns/pistol.glb', thumb: 'assets/ui/pistol.png',
    fore: [-0.03, -0.045, -0.04], grip: [0, -0.02, -0.06], muzzle: [0, 0.05, 0.11], eject: [-0.02, 0.05, 0.0], magNode: 'Pistol_Magazine001',
    dmg: 30, head: 2.6, legs: 0.8, cool: 0.16, auto: false, mag: 8, reserve: 64, reload: 1.5,
    hip: 0.01, ads: 0.003, bloom: 0.008, recoil: 0.02, range: [15, 45, 0.5], pellets: 1, flash: 0.6, sound: 'pistol', mob: 1, zoom: 14 },
];
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
export function falloff(w, d) {
  const [r0, r1, m] = w.range; if (d <= r0) return 1; if (d >= r1) return m;
  return 1 - (d - r0) / (r1 - r0) * (1 - m);
}
// loadout rules: any long gun as primary; the M1911 as secondary
export const PRIMARIES = ['m4a1', 'akm', 'shotgun', 'svd'];
export const SECONDARIES = ['pistol'];

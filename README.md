# SWAT: Urban Siege

A third-person shooter that runs in the browser. It's built with Three.js (r170, included in this folder) around your SWAT soldier (`Swat.fbx`) and its 49 Mixamo animations.

## How to run
Browsers block ES modules on `file://`, so you need to serve this folder over HTTP. The included launchers do this for you:

- **Windows:** double-click `start-windows.bat`. It uses Python (`python` or `py`) or, failing that, Node (`npx serve`), and opens http://localhost:8080 in your browser. Keep the console window open while playing.
- **macOS / Linux:** run `./start-mac-linux.sh` (or `sh start-mac-linux.sh`). It serves on port 8080 and opens the browser.

Or start any static server yourself:

```bash
cd swat-shooter
python3 -m http.server 8080      # then open http://localhost:8080
# or
npx serve .                      # then open the URL it prints
```

Use a desktop Chrome, Edge or Firefox with hardware acceleration turned on. All files are local, so it works offline.

## Android app
`swat-shooter.apk` is distributed separately. It is a debug-signed Capacitor build: sideload it by allowing "install unknown apps" for your file manager or browser, or run `adb install swat-shooter.apk`. It needs Android 5.1 (API 22) or newer with a WebGL2-capable WebView. It runs fullscreen and immersive, locked to landscape, and keeps the screen on.

The game is served inside the app from `https://localhost`. The app uses a lighter asset set: 1K HDR sky, textures at 1024 px or smaller, and props at 512 px. It always starts in the Mobile quality preset with touch controls.

## Windows app
`SWAT-Urban-Siege.exe` (Windows 10/11 x64) is distributed separately. It is a single file: a Neutralinojs wrapper with all game files embedded, served from its own built-in local web server. Double-click it to run. It needs no install, but it does need the Microsoft Edge WebView2 runtime, which comes with Windows 10/11. It starts fullscreen at Medium quality, which you can change in Settings. F11 toggles fullscreen, and EXIT TO DESKTOP on the menu or the pause screen closes it. It uses a lighter sky and ground textures (1K HDR, textures 1024 px or smaller) to stay small. The exe is not code-signed, so SmartScreen may ask you to confirm the first time ("More info" → "Run anyway").

## Hosting on GitHub Pages
This folder can be published as-is (all paths are relative; `.nojekyll` is included).

## Controls
| Key | Action |
|---|---|
| W A S D | Move in 8 directions, each with its own walk/run/sprint animation |
| Mouse | Look and aim (pointer lock: click the game to capture the mouse) |
| Left mouse | Fire (hold for M4A1 / AKM / MAC-10; one shot per click for the shotgun, SVD and pistol) |
| Right mouse (hold) | Aim down sights (tighter spread, closer camera). With the SVD this opens the 8× scope |
| Shift | Sprint |
| C / Left Ctrl | Crouch (C toggles, Ctrl is hold). Note: Ctrl+W closes a browser tab, so C is safer |
| Space | Jump (jump up, loop and land animations) |
| R | Reload |
| 1 – 6 / mouse wheel | Select weapon |
| Q | Previous (last used) weapon |
| V | Swap shoulder |
| Esc / P | Pause |

### Touch controls (phones and tablets)
Touch devices are detected automatically (force with `?mobile=1`, disable with `?mobile=0`). They get on-screen controls and the Mobile quality preset.

| Control | Action |
|---|---|
| Left thumb (anywhere on the left side) | Floating joystick: a small push walks, a far push runs. Drag up past the ring onto the lock icon and let go to lock sprint. Touch the stick again to unlock |
| Runner icon | Toggle sprint |
| Drag on the right side | Look and aim |
| Fire (bullets icon, hold) | Full-auto fire. There's a big button on the right and a small one on the left. You can drag on them to keep aiming |
| Scope icon | Toggle aim down sights |
| Reload icon / tap the ammo panel | Reload (the ring around the icon shows progress) |
| Chevrons / crouching figure | Jump / crouch toggle |
| Weapon slots (under the ammo panel) | Tap a gun to switch. Swipe the ammo panel left or right to cycle |
| Swap arrows (top right, under the gear) | Next weapon |
| Gear (top right) | Pause and settings |

The settings panel adds options for touch devices: left- or right-handed layout (mirrors the buttons and the joystick), button opacity, and vibration on fire, hit and damage. Buttons respect the safe-area insets on notched phones.

When you tap DEPLOY, the browser goes fullscreen and tries to lock to landscape. In portrait you will see a "rotate your device" screen.

## Weapons
Six real 3D guns, each with its own stats, sound, muzzle point and grip. All of them are attached to the right-hand bone with the same calibration: every model was converted to a common frame (barrel along +Z, grip point at the origin).

| # | Weapon | Type | Damage (body) | Headshot | Fire mode / rate | Mag / reserve | Reload | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | M4A1 | Assault rifle | 34 | ×3.0 | Auto, ~650 rpm | 30 / 180 | 2.1 s | Full damage to 30 m, 60% at 80 m+ |
| 2 | AKM | Assault rifle | 41 | ×2.6 | Auto, 600 rpm | 30 / 150 | 2.4 s | Harder recoil, wider spread |
| 3 | MAC-10 | SMG | 22 | ×2.0 | Auto, ~1030 rpm | 32 / 224 | 1.8 s | Falls to 45% damage by 40 m |
| 4 | Pump shotgun | Shotgun | 9 pellets × 17 | ×1.5 | Pump, 0.85 s | 7 / 42 | 2.7 s | Pellet spread. Full damage to 7 m, 15% at 24 m |
| 5 | SVD | Sniper rifle | 95 | ×3.0 | Semi, 1.15 s (bolt/recovery delay) | 10 / 40 | 2.8 s | Scope overlay with 8× zoom (FOV 11°) when aiming. Pin-point accuracy scoped, poor from the hip |
| 6 | M1911 | Pistol | 30 | ×2.6 | Semi, 0.16 s | 8 / 64 | 1.5 s | Light recoil, small flash |

Legs take 75–80% damage. Enemies have 100 HP. They carry an M4A1, AKM or MAC-10 at random, each with its own sound and rate of fire.

- **Switching:** the gun is lowered and raised in code over 0.5 s, and the model swaps at the bottom of the motion. Switching cancels a reload.
- **Ammo panel:** shows the current gun's silhouette (rendered from the actual model) and name. Bullet icons match the magazine size: shells for the shotgun, big rounds for the pistol and SVD. There is a 6-slot weapon bar below it.
- **Ammo crates:** killed enemies drop a glowing ammo crate 70% of the time. Crates show as yellow squares on the radar and last 30 s. Walk over one to refill every weapon's reserve, with double for the gun in hand. Clearing a wave also gives ammo.
- **Kill feed:** shows the weapon used.
- **Sounds:** each weapon has its own synthesized gunshot (crack/body/boom layers). The shotgun adds a pump, the SVD a bolt.
- **Limitations:** there is no weapon pickup (all six guns are carried from the start). The pistol and SMG reuse the rifle pose: the left hand stays where a rifle's handguard would be. Reloads are procedural tilts, not hand animations.

## Features
- **Soldier:** `Swat.fbx` and all its animation FBX files are converted into one GLB (`assets/swat.glb`) with 49 clips. Root motion is removed from locomotion so the clips play in place, and an AnimationMixer crossfades between them. Walk/run/sprint/crouch clips are chosen by movement direction and stay phase-synced when switching. There are idle/aim/crouch-aim poses and turn-in-place (90° clips). Upper-body aim pitch is added procedurally on the spine.
- **Weapons:** six real gun models (see Weapons above). Each is attached to the right-hand bone. Its grip is calibrated automatically from the aiming pose. It has hitscan bullets, recoil, spread bloom, a muzzle flash with light, travelling tracers, ejected brass, sparks, dust, bullet-hole decals, ammo and reload (the magazine is removed during the reload).
- **Enemies:** tinted SWAT clones with grid A* pathfinding. They patrol, chase, then engage: they hold, strafe, crouch or advance, and fire in bursts with reaction times and accuracy that scale with each wave. Gunfire alerts them, and they keep line-of-sight memory.
- **Hit detection:** colliders are built in code from the soldier's bones: a head sphere, a torso capsule and a leg capsule. Headshots play the headshot death clips (front, back, crouching). Other kills play front, back or right deaths depending on the hit direction.
- **City:** an intersection with streets, raised sidewalks and curbs, crosswalks and lane markings. Building facades are assembled from Poly Haven's modular apartment and factory kits using GPU instancing. There are street lamps, hydrants, trash cans, parked sedans in six paint colours and tarp-covered cars, road barriers, a fire escape, AC units, roller-shutter doors, a container yard, a parking lot, a back alley and a courtyard. Box colliders cover everything.
- **Rendering:** HDR sky with image-based lighting, and a sun whose direction is taken from the HDR. ACES tone mapping, PCF soft shadows, GTAO ambient occlusion, bloom, MSAA, distance fog.
- **Quality and resolution:** quality presets Low / Medium / High / Ultra / Mobile. Mobile caps the pixel ratio at 1.5, uses 1024 shadows and turns off AO, bloom and MSAA. It also leaves out the furthest buildings and decorative props. Resolution options are Native (device pixels), 1080p, 1440p and 4K (2160p). 4K supersamples on smaller screens.
- **HUD:** a rotating radar (city map, player arrow, enemy red dots), and icon chips for wave, hostiles, kills and score. The health bar has 10 segments and a cross icon. The ammo panel shows the current gun's silhouette rendered from the in-game model, the mag and reserve counts, one bullet icon per round that empties as you fire, and the weapon slot bar; low ammo flashes red. Kill feed reads "YOU [rifle] [headshot] HOSTILE". The crosshair widens with movement and firing and tightens while aiming. Hit markers are white, yellow on a headshot and a red X on a kill. Red arcs show where damage comes from, and the screen edges turn red when hit. All icons are original inline SVG drawn for this game.
- **Game loop:** waves, score, kill feed, health regeneration, damage-direction indicators. Main menu, pause, game over and restart. Sound effects are synthesized with WebAudio (shots, reverb, reload, footsteps, impacts, near-miss whiz).

## Folder layout
```
index.html, style.css
js/       main.js (game/renderer/UI), world.js (city + colliders), character.js, player.js, enemy.js, physics.js, fx.js, audio.js
libs/     three.js r170 + the addons it uses (MIT)
assets/   swat.glb, m4a1.glb, city/*.glb (meshopt-compressed, WebP textures), tex/*.webp, hdr/*.hdr
start-windows.bat, start-mac-linux.sh   local launchers
```

## Asset licenses
- **SWAT character and animations:** supplied by the user (Mixamo).
- **AKM:** "AKM" by LonesomeDucky, OpenGameArt (https://opengameart.org/content/akm). **CC0**.
- **MAC-10:** "Mac 10" by loltsilol, OpenGameArt (https://opengameart.org/content/mac-10). **CC0**. The model has no textures, so it was given a gunmetal material in code.
- **Pump shotgun:** "3D Gun Part 2 - Free Version" by Lyricsz, OpenGameArt (https://opengameart.org/content/3d-gun-part-2-free-version). **CC0**. Recoloured: walnut furniture and a black receiver.
- **SVD Dragunov:** from "Various Small Arms (Assault Rifles, Sniper, Pistol)" by Tabasco, OpenGameArt (https://opengameart.org/content/various-small-arms-assault-rifles-sniper-pistol). The page lists **CC-BY 3.0 and CC0**, and the author put the models in the public domain on 2023-12-15. Credit: Tabasco. Recoloured wood and metal.
- **M1911 pistol:** "Pistol" by loafbrr_1, OpenGameArt (https://opengameart.org/content/pistol-5). **CC0**.
- **M4A1 rifle:** "M4A1 Assault Rifle" by 3DModelsCC0, via OpenGameArt (https://opengameart.org/content/m4a1-assault-rifle). **CC0**.
- **City models:** Poly Haven (https://polyhaven.com), **CC0**. Includes modular_urban_apartments_facade, modular_factory_facade, street_lamp_01/02, fire_hydrant, metal_trash_can, concrete_road_barrier(_02), covered_car, modular_fire_escape, rollershutter_door, exterior_aircon_unit, trashbag and old_tyre.
- **Textures:** Poly Haven, **CC0**. Includes asphalt_02, square_concrete_pavers, concrete_floor_worn_001, corrugated_iron, rusty_metal_02 and plywood.
- **Sedan:** "Sedan car" by Innerscene (https://www.innerscene.com/tools/library/3d-parts/sedan-car-42109739), **CC0**. Repainted in code into six colours.
- **HDRI:** Poly Haven, "Kloofendal 48d Partly Cloudy (Pure Sky)", **CC0**.
- **Three.js:** MIT license (`libs/three/LICENSE`).

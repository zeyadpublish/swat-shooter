# SWAT: Urban Siege

A third-person shooter that runs in the browser. It's built with Three.js (r170, included in this folder) around your SWAT soldier (`Swat.fbx`) and its 49 Mixamo animations.

## v1.6 settings

Settings is a full-screen sheet with four tabs (GRAPHICS / CONTROLS / AUDIO / GAMEPLAY), built in `js/settings.js`.
Everything is saved in localStorage (`swat-settings`) and applied as soon as you change it.

- **Graphics**
  - Presets and an FPS cap.
  - Render scale, plus dynamic resolution that adjusts to the frame rate.
  - Hip FOV, 1st-person (ADS) FOV and ADS zoom scale.
  - Motion blur (afterimage pass).
  - Texture quality (sets anisotropic filtering).
  - Shadows: off, 1024, 2048 or 4096. Real-time updates them every frame; the other levels update every 2nd frame.
  - AA: FXAA, MSAA 2x/4x, or "TAA", which uses SMAA (WebGL has no TAA).
  - Particle quality, bloom, GTAO and HDR (ACES or linear output).
  - "Ray tracing" does not do real ray tracing (WebGL has none). It boosts environment reflections instead.
- **Controls**
  - Separate X/Y look sensitivity, plus ADS, scope, sniper and vehicle free-look multipliers.
  - Response curves for touch look, and aim acceleration.
  - Invert X/Y, and gyro aim while aiming down sights (with its own invert and sensitivity).
  - Button opacity and size, left/right hand.
  - Layouts A, B, Custom 1 and Custom 2. An edit made with CUSTOMIZE HUD LAYOUT is saved to the custom slot.
  - Joystick deadzone: tap the calibration grid to set it.
  - Vibration intensity and per-event toggles.
- **Audio**
  - Volumes for master, effects, UI, music (a procedural menu pad), dialogue and ambience.
  - Presets, dynamic range (compressor), HRTF or equal-power panning, and reverb quality.
  - Sound occlusion: a wall between you and a sound muffles it.
  - Announcer lines use speech synthesis, with optional subtitles.
- **Voice chat** uses PeerJS audio calls, with push-to-talk on B or the TALK button, open mic with a threshold, or muted. It needs the online PeerJS transport and is not available on the local test relay.
- **Gameplay**
  - Streamer mode, network stats, kill feed, and north-up minimap.
  - Damage numbers (floating or stacking, with size), hitmarker visuals, sound and colour.
  - Colorblind filters and screen shake.
  - Crosshair colour, dot, spread, scale and opacity.
  - Auto reload, auto switch, auto sprint, and ledge grab.

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

Phones and tablets opening the site load the light asset set in `assets-mobile/` (about 14 MB; desktop loads about 29 MB from `assets/`) and the Mobile quality preset. A TAP TO PLAY screen appears, and the first tap enters fullscreen, locks landscape and turns on sound. Leaving fullscreen and tapping again re-enters it. The site is an installable app (`manifest.webmanifest`, `sw.js`), and the service worker caches the phone assets so reloads are fast. On iPhone, Safari can't make a web page fullscreen, so a one-time hint suggests Share → Add to Home Screen, which opens the game fullscreen. Force a mode with `?mobile=1` / `?mobile=0` or `?assets=mobile` / `?assets=desktop`.

## Controls
| Key | Action |
|---|---|
| W A S D | Move in 8 directions, each with its own walk/run/sprint animation |
| Mouse | Look and aim (pointer lock: click the game to capture the mouse) |
| Left mouse | Fire (hold for M4A1 / AKM; one shot per click for the shotgun, SVD and pistol) |
| Right mouse (hold) | Aim down sights (tighter spread, closer camera). With the SVD this opens the 8× scope |
| Shift | Sprint |
| C / Left Ctrl | Crouch (C toggles, Ctrl is hold). Note: Ctrl+W closes a browser tab, so C is safer |
| Space | Jump (jump up, loop and land animations) |
| R | Reload |
| 1 – 2 / mouse wheel | Select weapon (1 – 5 with Settings → Gameplay → All weapons) |
| Tab (hold) | Multiplayer scoreboard |
| Enter / T | Multiplayer chat |
| E | Enter / exit a vehicle (when the E · DRIVE prompt shows). While driving: W/S throttle and brake/reverse, A/D steer, Space handbrake, mouse orbits the chase camera |
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
Five real 3D guns, each with its own stats, sound, muzzle point and grip. All of them are attached to the right-hand bone with the same calibration: every model was converted to a common frame (barrel along +Z, grip point at the origin).

| # | Weapon | Type | Damage (body) | Headshot | Fire mode / rate | Mag / reserve | Reload | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | M4A1 | Assault rifle | 34 | ×3.0 | Auto, ~650 rpm | 30 / 180 | 2.1 s | Full damage to 30 m, 60% at 80 m+ |
| 2 | AKM | Assault rifle | 41 | ×2.6 | Auto, 600 rpm | 30 / 150 | 2.4 s | Harder recoil, wider spread |
| 3 | Pump shotgun | Shotgun | 9 pellets × 17 | ×1.5 | Pump, 0.85 s | 7 / 42 | 2.7 s | Pellet spread. Full damage to 7 m, 15% at 24 m |
| 4 | SVD | Sniper rifle | 95 | ×3.0 | Semi, 1.15 s (bolt/recovery delay) | 10 / 40 | 2.8 s | Scope overlay with 8× zoom (FOV 11°) when aiming. Pin-point accuracy scoped, poor from the hip |
| 5 | M1911 | Pistol | 30 | ×2.6 | Semi, 0.16 s | 8 / 64 | 1.5 s | Light recoil, small flash |

Legs take 75–80% damage. Enemies have 100 HP. They carry an M4A1 or AKM at random, each with its own sound and rate of fire.

- **Switching:** the gun is lowered and raised in code over 0.5 s, and the model swaps at the bottom of the motion. Switching cancels a reload.
- **Ammo panel:** shows the current gun's silhouette (rendered from the actual model) and name. Bullet icons match the magazine size: shells for the shotgun, big rounds for the pistol and SVD. There is a 5-slot weapon bar below it.
- **Ammo crates:** killed enemies drop a glowing ammo crate 70% of the time. Crates show as yellow squares on the radar and last 30 s. Walk over one to refill every weapon's reserve, with double for the gun in hand. Clearing a wave also gives ammo.
- **Kill feed:** shows the weapon used.
- **Sounds:** each weapon has its own synthesized gunshot (crack/body/boom layers). The shotgun adds a pump, the SVD a bolt.
- **Loadout:** you carry one primary (M4A1, AKM, shotgun or SVD) and one secondary (M1911), chosen on the LOADOUT screen. Heavier guns move slightly slower. Settings → Gameplay → All weapons gives the full five-gun bar in solo play.
- **Limitations:** there is no weapon pickup. The pistol reuses the rifle pose: the left hand stays where a rifle's handguard would be. Reloads are procedural tilts, not hand animations.

## What's new in v1.5 (maps, campaign, ranks)
- **Three maps:** Urban Siege (city), **Desert Town** (sand streets, mud-brick flat-roof houses with three enterable buildings, covered market stalls, compound walls, palms, burnt-out cars, sandbags, warm light and haze) and **Military Base** (perimeter fence, two hangars, four climbable watchtowers, container yard, two enterable barracks, helipad, parked trucks, drivable armoured vehicles, crates). Every map has colliders, bot navigation, medkit spots and vehicle spawns.
- **Map select:** PLAY → SOLO SURVIVAL opens map cards (tap a card, tap again or DEPLOY to start). In multiplayer the host picks the map in the lobby and it is synced to everyone.
- **Campaign:** PLAY → CAMPAIGN, 10 missions (4 city, 3 desert, 3 base) with a briefing screen. Objectives: clear the area, survive waves, eliminate a high-value target, reach extraction, defend a zone. Up to 3 stars per mission (complete it, beat the par time, finish with 50+ health). Clearing a mission unlocks the next. First clear pays the full coin and XP reward; replays pay 30%. Progress is saved on the device.
- **Ranks:** the rank badge and rank name sit in the top bar; a RANK UP popup lists what was unlocked. Some operators and weapons need a rank before they can be bought (AKM rank 2, shotgun 3, SVD 5; Ranger 2, Viper 3, Sentinel 5, Warden 6, Recon 8, Sergeant 10).
- **Customize controls:** Settings → CUSTOMIZE CONTROLS lets you drag every phone button and resize it.
- Desert and base textures: Poly Haven (dense sand, clay plaster, dry ground), **CC0**.

## What's new in v1.5 (stage A)
- **Realistic operators:** the cartoon Quaternius characters are replaced by realistic Microsoft Rocketbox soldiers, police and civilians (MIT). The Mixamo SWAT clips are retargeted onto them at runtime with per-bone offsets; models are scaled so leg length matches the clips (no foot sliding). A two-bone IK solver puts every character's left hand on the weapon handguard, with fingers wrapped round it; the IK blends off during reloads, weapon swaps and healing.
- **Operators:** 8 playable operators (SWAT and Breacher free; Ranger, Viper, Sentinel, Warden, Recon and Sergeant unlocked with coins). The selected operator stands in the 3D lobby and is used in solo and multiplayer (in Team Deathmatch the red team keeps red-team uniforms so teams stay readable).
- **Crouch:** C or Ctrl (phones: crouch button), crouch-idle / crouch-walk animations, lower camera, tighter spread, synced in multiplayer.
- **Medkits:** pickups on the map (respawn after 40 s) and from enemy drops; carry up to 3; press H (or the phone medkit button) to heal 60 HP over 2 s with an animation and sound. Buy more in the Store.
- **Coins and rank:** earn coins and XP for kills (+10), headshots (+5), kill streaks (+15), waves (+25), finishing a match (+30) and wins (+100); saved on the device (localStorage). Rank goes up with XP.
- **Store and Armory:** unlock the AKM (400), pump shotgun (600) and SVD (900), operators and medkits (150 each). Locked weapons show their price in the Weapons screen.
- **Vehicles:** entering is animated: your operator walks to the driver's door and climbs in while the camera blends to the chase view (about 1 s); exiting reverses it and steps you out clear of the vehicle. The driver stays seated in the cab (also for other players in multiplayer). Desktop prompt: E ENTER / E EXIT, H horn, V camera distance. On phones the joystick and combat buttons are replaced while driving by STEER LEFT / RIGHT, GAS, BRAKE-REVERSE, EXIT, HORN and CAM buttons.
- **New interface:** a top tab bar (PLAY / WEAPONS / OPERATORS / STORE / SETTINGS; Q / E switch tabs, Esc goes back), condensed uppercase type, flat dark panels, compass bar, kill feed top-left, ammo bottom-right, slim health bar, "+100 KILL" popups, a restyled scoreboard and an after-action report with XP and coin breakdown and a rank bar.

## What's new in v1.4
- **More soldiers:** six CC0 Quaternius rigged characters (operator, militia, gunner, insurgent, raider, scout) in 13 palette looks, driven by the Mixamo SWAT clips retargeted at runtime. Enemies get a deterministic look per spawn (identical for every co-op player). TDM teams are clearly blue (blue operators / blue SWAT) vs red (red militia / gunners / operators); FFA mixes looks.
- **Shooting feel:** short tracer streaks (~70 ms, pooled, never drawn into the camera), upper-body recoil kick, gun kick, camera shake, muzzle flash and ejected shells that land on the floor you stand on. Characters fire while walking or running (upper body aims, legs keep their locomotion clip), breathe and sway when idle, and crossfade between every state. Bodies sink away after ~6 s and are removed at 8 s.
- **Vehicles:** an armored pickup (fast) and an armored truck (heavy) on the map. E (or the orange car button on phones) to get in/out. Arcade physics with grip, handbrake, wall collisions with damage, chase camera, engine sound. Runs over soldiers (damage scales with speed). Vehicles have health (shown in the driving HUD); at 0 they explode (splash damage), stay as a burnt wreck and respawn later. In multiplayer the host simulates every vehicle; the driver seat is claimed through the host and the driver's inputs are sent to it.
- **Cover:** sandbag trenches, concrete jersey barriers, crates, shipping containers, barrels and scorched car wrecks, all with colliders, bullet impacts and AI nav blocking.
- **Enterable buildings:** three buildings with doors, windows, interior walls, a stairwell to the upper floor and stairs/ladder access to the roof. Real colliders, walkable floors, and the AI nav grid routes through doors and stairs.
- **Bots:** PLAY VS BOTS (offline, no network) or host a room and fill empty slots with 0–7 AI bots, Recruit / Regular / Veteran skill, in TDM and FFA. Bots appear to clients as normal players (names, scoreboard, kill feed).
- **Phones:** the floating joystick only spawns in the left movement zone (never over buttons or the HUD); the right side is camera look only.
- **MAC-10 removed** (loadout, enemy guns, icons, assets).
- **TURN-ready networking:** see Multiplayer > TURN below.

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

## Menus and UI (v1.3)
- **Main menu:** the live 3D city is the backdrop (depth-of-field blur and vignette on desktop) behind your operator, with PLAY SOLO, MULTIPLAYER, LOADOUT and SETTINGS. The loading screen shows real progress and gameplay tips. Fonts are Rajdhani and Teko, bundled in `assets/fonts/`.
- **Loadout:** a rotating, lit 3D preview of each gun, with stat bars for damage, fire rate, range, mobility and magazine, and PRIMARY / SECONDARY tabs.
- **Settings:** four tabs, all saved in the browser (localStorage):
  - Graphics: quality, resolution, FOV, FPS counter.
  - Controls: sensitivity, ADS sensitivity, invert Y, handedness, button opacity, vibration, and a touch-layout editor where you drag buttons and resize them with the slider.
  - Audio: master, effects and UI volume.
  - Gameplay: name, crosshair style, damage numbers, +XP popups, all weapons.
- **HUD extras:**
  - Animated counters and a weapon-swap animation.
  - Multi-kill and streak banners (DOUBLE / TRIPLE / MULTI KILL, KILLING SPREE, UNSTOPPABLE, GODLIKE).
  - +XP popups, optional damage numbers, and a heartbeat sound below 30 HP.
  - Wave cards.
- **Pause and end screens:** a redesigned pause menu. The end screen shows wave, kills, headshots, accuracy, best streak and score.

## Multiplayer (peer-to-peer)
MULTIPLAYER → enter a name → **HOST ROOM** creates a 5-character room code. Share it with the COPY or SHARE button; the link adds `?room=CODE` and joins directly. Friends can also type the code and press **JOIN**.

- **Lobby:** up to 8 players, each with a ready check. The host picks the mode, score limit and time limit and presses START.
- **Modes:**
  - **Team Deathmatch:** blue vs red, first team to the score limit wins.
  - **Free-for-all:** every player for themselves.
  - **Co-op:** survive the waves together; the round ends when the whole squad is down.
- **In a match:**
  - Nameplates over other players and a kill feed with names.
  - Respawn after 3 s with brief spawn protection.
  - Scoreboard: hold Tab, or use the list button on phones.
  - Timer and score at the top.
  - Chat: Enter or T on desktop; quick-chat presets on phones.
- **Leaving:**
  - If a player leaves, the others see it in chat and play continues.
  - If the host leaves, the room closes and everyone returns to the menu.
- **How it works:**
  - **Connection:** browsers connect directly over WebRTC data channels using PeerJS (`libs/peerjs`, loaded only when you open Multiplayer). The free public PeerJS broker (0.peerjs.com) introduces the players to each other, and Google's public STUN server helps them find a route.
  - **Who decides what:** the host's browser runs the match. It owns health, hits, kills, scores, the timer and, in co-op, the AI enemies.
  - **Sync:** state is sent 20 times a second, and remote players are interpolated 100 ms behind.
  - **Hit checks:** before accepting a hit, the host checks rate of fire, where the shot came from, line of sight and where the target was a moment ago (simple lag compensation).
- **Limitations:**
  - **No TURN relay by default:** players behind symmetric NAT or networks that block UDP (some mobile carriers, corporate Wi-Fi) may not be able to connect until a TURN server is configured (below).

### TURN (configurable, nothing signed up)
ICE servers are read, in order, from `netconfig.json` (next to index.html), `localStorage['swat-netconfig']`, then URL parameters; later sources win. Default: Google STUN only.
- `netconfig.json`: `{ "iceServers": [{ "urls": "turn:host:3478", "username": "u", "credential": "p" }], "extendDefaults": true, "iceTransportPolicy": "all" }`. See `netconfig.example.json`.
- Short-lived credentials (Metered, Cloudflare Calls TURN, etc.): `{ "credentialsUrl": "https://your-endpoint/ice" }`. The endpoint must return an array of ICE servers or `{ "iceServers": [...] }`; it is fetched when you host or join.
- URL: `?turn=turn:host:3478&turnuser=u&turnpass=p` (repeat `turn=` for several), `?ice=<JSON array>`, `?icerelay=1` to force relay-only.
- Own PeerJS broker: `?peerhost=host&peerport=443&peerpath=/&peersecure=1` or `"peer": {...}` in netconfig.json.
  - **Depends on the public broker:** this is a free service with no uptime guarantee. To use your own [PeerServer](https://github.com/peers/peerjs-server), add `?peerhost=HOST&peerport=443&peerpath=/&peersecure=1&peerkey=KEY` to the URL.
  - **Cheating is possible:** movement is trusted from each client. Hits are checked by the host, but a modified host can cheat.
  - **Host tab:** the host's tab must stay in the foreground, because browsers throttle background tabs.
  - **Co-op joins:** in co-op, players who join mid-match come in at the next wave.
- **Testing aid:** `?relay=ws://127.0.0.1:PORT` swaps WebRTC for a local WebSocket relay (`tools/relay.mjs`). It is used for automated tests and only accepts localhost addresses.

## Folder layout
```
index.html, style.css
js/       main.js (game/renderer/HUD), ui.js (menus/settings/loadout), mp.js (multiplayer), net.js (PeerJS wrapper), world.js (city + colliders), character.js, player.js, enemy.js, physics.js, fx.js, audio.js
libs/     three.js r170 + the addons it uses (MIT), peerjs 1.5.5 (MIT)
assets/fonts/  Barlow Condensed, Rajdhani, Teko (SIL OFL 1.1)
assets/   swat.glb, m4a1.glb, city/*.glb (meshopt-compressed, WebP textures), tex/*.webp, hdr/*.hdr
start-windows.bat, start-mac-linux.sh   local launchers
```

## Asset licenses
- **SWAT character and animations:** supplied by the user (Mixamo).
- **AKM:** "AKM" by LonesomeDucky, OpenGameArt (https://opengameart.org/content/akm). **CC0**.
- **Pump shotgun:** "3D Gun Part 2 - Free Version" by Lyricsz, OpenGameArt (https://opengameart.org/content/3d-gun-part-2-free-version). **CC0**. Recoloured: walnut furniture and a black receiver.
- **SVD Dragunov:** from "Various Small Arms (Assault Rifles, Sniper, Pistol)" by Tabasco, OpenGameArt (https://opengameart.org/content/various-small-arms-assault-rifles-sniper-pistol). The page lists **CC-BY 3.0 and CC0**, and the author put the models in the public domain on 2023-12-15. Credit: Tabasco. Recoloured wood and metal.
- **M1911 pistol:** "Pistol" by loafbrr_1, OpenGameArt (https://opengameart.org/content/pistol-5). **CC0**.
- **M4A1 rifle:** "M4A1 Assault Rifle" by 3DModelsCC0, via OpenGameArt (https://opengameart.org/content/m4a1-assault-rifle). **CC0**.
- **v1.5 characters:** Microsoft Rocketbox avatar library (github.com/microsoft/Microsoft-Rocketbox), **MIT License** (Copyright (c) 2020 Microsoft; text in `assets/chars/LICENSE-Rocketbox.txt`). Converted from FBX to glTF, simplified and recoloured in code; animated by retargeting the Mixamo SWAT clips at runtime. (The v1.4 Quaternius characters are no longer used.)
- **v1.4 vehicles and cover:** armored pickup, armored truck, sandbag trenches and broken car by Quaternius (via Poly Pizza), **CC0**. Vehicles repainted olive/tan, wrecks scorched in code.
- **City models:** Poly Haven (https://polyhaven.com), **CC0**. Includes modular_urban_apartments_facade, modular_factory_facade, street_lamp_01/02, fire_hydrant, metal_trash_can, concrete_road_barrier(_02), covered_car, rollershutter_door, exterior_aircon_unit, trashbag and old_tyre.
- **Textures:** Poly Haven, **CC0**. Includes asphalt_02, square_concrete_pavers, concrete_floor_worn_001, corrugated_iron, rusty_metal_02 and plywood.
- **Sedan:** "Sedan car" by Innerscene (https://www.innerscene.com/tools/library/3d-parts/sedan-car-42109739), **CC0**. Repainted in code into six colours.
- **HDRI:** Poly Haven, "Kloofendal 48d Partly Cloudy (Pure Sky)", **CC0**.
- **Three.js:** MIT license (`libs/three/LICENSE`).
- **PeerJS:** MIT license (`libs/peerjs/LICENSE`).
- **Fonts:** Barlow Condensed (The Barlow Project Authors), Rajdhani (Indian Type Foundry) and Teko (The Teko Project Authors), SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`).

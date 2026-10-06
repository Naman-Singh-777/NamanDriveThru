import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { loadEnvironment } from './scene/environment'
import { createSky, createNightEnvironment } from './scene/sky'
import { createLighting } from './scene/lighting'
import { buildStaticColliders, isCameraObstacle } from './collision/staticColliders'
import { buildRoadBoundaries, buildJunctionBoundaries } from './collision/roadBoundaries'
import { buildStartRockBoundary } from './collision/startRockBoundary'
import { applyObjectBounce } from './collision/objectBounce'
import { Vehicle } from './vehicle/vehicle'
import { createControls } from './vehicle/controls'
import { bindTouchControls } from './vehicle/touchControls'
import { VehicleCamera } from './vehicle/vehicleCamera'
import { DiagnosticCamera } from './vehicle/diagnosticCamera'
import { SideDiagnosticCamera } from './vehicle/sideDiagnosticCamera'
import { HeroCamera } from './vehicle/heroCamera'
import { OverviewCamera } from './vehicle/overviewCamera'
import { OverviewLabels } from './vehicle/overviewLabels'
import { createCheckpoints, updateCheckpoints, triggerActivation, type Checkpoint, type CheckpointDef, type CheckpointId } from './vehicle/checkpoint'
import { playActivationChime } from './vehicle/checkpointAudio'
import { addRoadEndCaps, type RoadEndCapDef } from './scene/roadEndCaps'
import { initOverlay, requestOpenOverlay, isOverlayOpen, isOverlayBusy, preloadOverlayData, warmTrackDurations } from './overlay'
import { initFullscreen } from './fullscreen'
import { isTutorialActive, markLoaded, waitForStart } from './loading/tutorial'
import { initAchievements, registerVisit, hasVisited, notifyOverlayClosed } from './vehicle/achievements'
import { initDeterrence } from './security/deterrence'
import { initOwnerBypassToggle, isOwnerBypassOn } from './security/ownerBypass'

// WEB-PHASE-4 REDO Phase 19: run before anything else on the page. Both are
// click/keystroke listeners only; neither touches vehicle physics,
// road/collision logic, or checkpoint placement. Deterrence is skipped
// entirely when the owner has switched it off for this browser (Ctrl+Alt+
// Shift+D, see ownerBypass.ts) -- every other visitor always gets it.
initOwnerBypassToggle()
if (!isOwnerBypassOn()) initDeterrence()
// Fullscreen from the first key press or click, left again with three Escapes.
initFullscreen(isOverlayBusy)
// Playlists, covers and the GitHub avatar start downloading now, alongside the environment.
preloadOverlayData()

const loadingEl = document.getElementById('loading')!
const loadingFill = document.getElementById('loading-fill')!
const errorEl = document.getElementById('error')!

function showError(msg: string): void {
  console.error(msg)
  errorEl.style.display = 'flex'
  errorEl.textContent = msg
  loadingEl.style.display = 'none'
}

window.addEventListener('error', (e) => showError(`Fatal error:\n${e.message}`))
window.addEventListener('unhandledrejection', (e) => showError(`Fatal error:\n${e.reason}`))

async function main(): Promise<void> {
  const canvas = document.getElementById('app') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // The Blender file renders with the AgX view transform at +0.4 exposure (2^0.4 = 1.32).
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.32
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000)

  // Image-based light built from the night sky itself (see sky.ts), so metallic and glossy
  // materials (car paint, steel, glass, the water) reflect the same navy sky and moon the
  // player sees, instead of the grey studio room the old RoomEnvironment gave them.
  scene.environment = createNightEnvironment(renderer)

  const sky = createSky(scene)
  createLighting(scene)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  await RAPIER.init()

  loadingFill.style.width = '10%'
  const env = await loadEnvironment(scene, (pct) => {
    loadingFill.style.width = `${10 + Math.min(1, pct) * 70}%`
  })
  loadingFill.style.width = '85%'

  // PHASE WEB-FIX-06: scale the vehicle to exactly 0.5x its previous runtime size.
  // Root-only scale — all child geometry (chassis, wheels, mirrors, body) stays
  // internally consistent, and the source GLB/geometry/textures/materials are
  // untouched. Every downstream measurement (physics collider size, wheel radius/
  // positions, suspension rest length, camera framing distance) is derived from
  // this root's CURRENT world-space bounding box at the point it's read, so
  // scaling here — before Vehicle/VehicleCamera are constructed below — keeps
  // all of them consistent automatically, with no separate scaling code needed
  // in vehicle.ts or vehicleCamera.ts.
  // WEB-FIX-18: uniform vehicle scale reduced to 0.75x its prior size, per
  // user request, on top of the existing 0.5x (WEB-FIX-06) adjustment --
  // 0.5 * 0.75 = 0.375. All suspension/collider/wheel-radius geometry reads
  // this live (getWorldScale()/bounding-box based, confirmed by the
  // WEB-FIX-11E/11F comments in vehicle.ts) and adapts automatically. The
  // four hardcoded wheel-well/visual-offset constants in vehicle.ts do NOT
  // auto-scale and were re-derived at this new scale using the same
  // measurement/bisection procedure as WEB-FIX-15B through WEB-FIX-17 (see
  // vehicle.ts comments) -- do not change this scale value without
  // re-deriving those four constants again the same way.
  //
  // WEB-PHASE-4B: 0.375 * 0.75 = 0.28125, redone properly this time -- the
  // four hardcoded wheel-well/visual-offset constants in vehicle.ts were
  // re-derived FIRST (headless sandbox: real environment.glb geometry + real
  // Rapier physics, bisected for ground contact and clash-free visual
  // nesting at this exact new scale) before this multiplier was reapplied,
  // per the user's explicit instruction after the first blind attempt
  // caused visible tire clipping. See vehicle.ts's own comments above
  // FRONT_WELL_CORRECTION/REAR_WELL_CORRECTION/VISUAL_FRONT_OFFSET/
  // VISUAL_REAR_OFFSET for the full derivation.
  env.vehicleRoot.scale.multiplyScalar(0.28125)
  env.root.updateWorldMatrix(true, true)

  const world = new RAPIER.World({ x: 0, y: -24.5, z: 0 })
  const stats = buildStaticColliders(env.root, world)
  console.log('[colliders]', stats)
  // Same soft bounce-back as the railings and road walls for lampposts, buildings and platform structure.
  console.log('[object bounce]', applyObjectBounce(env.root, world))

  // WEB-PHASE-2/3B: road-side walls now stop before entering a major open
  // area's own footprint (Platform/Port/City) -- their existing railings/
  // objects/architecture are the boundary there, not the road edge -- and the
  // Intersection gets its own outer-perimeter walls (with a gap left open on
  // each side matching that side's connecting road, and its interior left
  // fully open). See roadBoundaries.ts for the full derivation.
  const roadBoundaryStats = buildRoadBoundaries(env.root, world)
  console.log('[road boundaries]', roadBoundaryStats)
  const junctionBoundaryStats = buildJunctionBoundaries(env.root, world)
  console.log('[junction boundaries]', junctionBoundaryStats)

  // Invisible hard boundary along the edges of the rocky headland behind the spawn point, so the
  // car cannot drive off the ridge into the sea. Additive only (see startRockBoundary.ts).
  console.log('[start rock boundary walls]', buildStartRockBoundary(world))

  const vehicle = new Vehicle(world, env)
  loadingFill.style.width = '95%'

  const input = createControls()
  bindTouchControls(input)
  const vehicleLength = new THREE.Box3().expandByObject(env.vehicleBody).getSize(new THREE.Vector3()).length() * 0.55
  const chaseCam = new VehicleCamera(camera, vehicleLength)

  // WEB-FIX-08: temporary wheel-diagnostic camera, toggled with F. Purely a camera
  // selection -- see diagnosticCamera.ts. Does not touch physics, vehicle transforms,
  // wheel transforms, controls, collisions, or the normal chase camera's own code path
  // at all; the animate() loop below calls exactly one of the two per frame.
  const diagnosticCam = new DiagnosticCamera(camera, vehicleLength)

  // WEB-FIX-09: two more purely-observational diagnostic cameras, toggled with L
  // (left/FL-RL side) and R (right/FR-RR side) -- see sideDiagnosticCamera.ts for
  // why (PASS_2.mp4 needs a near-perpendicular side view to fully characterize the
  // FL wheel-transform glitch the F camera already confirmed exists). Same pattern
  // as diagnosticCam: read-only, additive, never touches physics/vehicle/wheel
  // transforms/controls/collision.
  const leftCam = new SideDiagnosticCamera(camera, vehicleLength, 'left')
  const rightCam = new SideDiagnosticCamera(camera, vehicleLength, 'right')

  // WEB-FIX-13: L1/R1 -- elevated front-3/4 "hero shot" cameras (see
  // heroCamera.ts), styled after a reference Blender viewport screenshot.
  // Bound to Shift+L / Shift+R since plain L/R already select the pure-side
  // diagnostic cameras above. Same read-only, additive pattern as every other
  // camera here: never touches physics/vehicle/wheel transforms/controls/collision.
  const l1Cam = new HeroCamera(camera, vehicleLength, 'left')
  const r1Cam = new HeroCamera(camera, vehicleLength, 'right')

  // WEB-PHASE-2/3F: new full-map follow-overview camera, toggled by O (see the
  // keydown handler below). Additive only -- does not touch or reuse any
  // camera above. Built from the real loaded environment's own bounding box
  // (env.root) and the real vehicle hierarchy (env.vehicleRoot, excluded from
  // that bounding box so it can't skew the measured map footprint) -- see
  // overviewCamera.ts for the full derivation.
  const overviewCam = new OverviewCamera(camera, env.root, env.vehicleRoot, vehicle)

  // WEB-PHASE-4: three world-space interactive checkpoints (Port/Platform/
  // City). Positions below are centers measured directly off the real
  // exported environment.glb node bounding boxes (not guessed), each on the
  // floor of its own location's drivable surface:
  //   Port     -- center of the open middle of Port_Dock
  //               (Port_Dock: X -875..-625, Z -125..50, floor Y 53.94),
  //               offset off the X center to clear Port_Crane_01/02,
  //               Cargo_Ship and the Container_Group/ContainerExtra rows.
  //   Platform -- center of the Platform_Canopy_Roof footprint
  //               (X 679..821, Z -78..78) sitting on OpenPlatform_Pad's
  //               floor (Y 53.94) -- i.e. exactly under the canopy.
  //   City     -- on Road_North (X -25..25, Z -1000..-75, floor Y 54.12),
  //               just inside its far (northern) end at Z -995, which is
  //               where the drivable road actually stops.
  // WEB-PHASE-4 REDO: each pad's plan footprint is derived from the car's
  // own real runtime bounding box (read-only measurement of env.vehicleBody,
  // same pattern as vehicleLength above) -- never a hardcoded guess. The
  // car's long axis runs along world Z (its length, ~20 units) and its short
  // axis along world X (its width, ~9 units); each checkpoint's own long/
  // short footprint axis is assigned to whichever world axis that location's
  // own geometry naturally runs along (Port/Platform sit on wide-X/narrow-Z
  // ground, City sits on narrow-X/long-Z road), each sized to ~2x the car's
  // corresponding real dimension. Read-only clearance check (via the same
  // real-geometry harness used for the WEB-FIX-19 investigation) confirmed
  // this stays well clear of every nearby obstacle: Port's two cranes
  // (>19 units to spare), Platform's canopy pillars (>40 units to spare),
  // and City's own real drivable perimeter (CityRail_* union spans Z
  // -1081.9..-178.1 -- far past this checkpoint's enlarged extent).
  // WEB-PHASE-4 REDO Phase 6 ("3x bigger, way cooler"): sizes below are NOT a
  // blind 3x of the original car-derived footprint -- a real-geometry
  // clearance probe (read-only, same real-GLTFLoader harness used throughout
  // this project) against the actual locked map meshes found that a literal
  // 3x clips real, locked geometry at every single location, so each pad was
  // instead grown to the largest size that still clears its nearest real
  // obstacle by a comfortable margin:
  //   Port     -- width(X) clamped to 54 by Port_Crane_02 (real bbox X max
  //               -789.25; pad edge at -777, 12.25 units clear). depth(Z)
  //               reaches the full >2x target at 54.4 (crane Z front -86;
  //               pad edge -67.2, 18.8 units clear).
  //   Platform -- width(X) clamped to 56 by the Platform_Monument_
  //               NoteSculpture (real bbox X max 717, sitting between the
  //               pad and the canopy's west fascia; pad edge at 722, 5 units
  //               clear) -- this is the one location where the clamp makes
  //               the pad come out close to square rather than elongated.
  //               depth(Z) reaches 54.4 (pillars at Z 68.75; pad edge 27.2,
  //               41.55 units clear).
  // WEB-PHASE-4 REDO Phase 7: Port/Platform's own Y was 53.94 (the dock/
  // platform floor), but each pad's footprint straddles the exact seam with
  // its approach road, whose real surface sits 0.1875 units HIGHER (54.125)
  // -- the part of the pad over the road was rendering UNDER the road
  // surface ("like a carpet", per the screenshot). Both now use 54.125 (the
  // real road surface height, the higher of the two), so the pad's own 0.08
  // local offset clears BOTH real surfaces; the small sliver over the dock/
  // platform floor now floats ~0.19 units above it instead, imperceptible at
  // driving distance and in keeping with a "holographic terminal" look.
  // City's whole footprint already sits entirely on one surface (the road),
  // so it needed no change.
  //   City     -- width(X) clamped to 40 to stay inside Road_North's own
  //               real 50-unit paved width (pad edge at 20, 5 units clear of
  //               the curb). depth(Z): the real City_Building_20 sits just
  //               2.5 units past the original pad center (its real bbox
  //               reaches Z -997.16, essentially right at the road's end),
  //               so growing depth at all required nudging this pad's own
  //               center 45 units south along the same road (Z -995 -> -950,
  //               still "near the far end" of the 925-unit road, nothing
  //               else moved) -- same technique the original Port placement
  //               already used (offsetting a checkpoint's own anchor to
  //               clear real nearby geometry). That gives depth 80 (pad edge
  //               -990, 7.16 units clear of the building's real south face).
  // activationRadius grown to match each pad's own larger half-extent (+ a
  // few units of buffer) so the "OPEN <Enter>" prompt now appears as soon as
  // the car is actually on the enlarged pad, matching the old (correct)
  // behaviour at the old (smaller) size.
  const checkpointDefs: CheckpointDef[] = [
    {
      id: 'port',
      position: new THREE.Vector3(-750, 54.125, -40),
      width: 54,
      depth: 54.4,
      activationRadius: 30,
      yaw: 0,
      label: 'Projects',
      color: new THREE.Color(0x6fb8ff)
    },
    {
      id: 'platform',
      position: new THREE.Vector3(750, 54.125, 0),
      width: 56,
      depth: 54.4,
      activationRadius: 32,
      yaw: 0,
      label: 'Music',
      color: new THREE.Color(0x7fe3b4)
    },
    {
      id: 'city',
      position: new THREE.Vector3(0, 54.12, -950),
      width: 40,
      depth: 80,
      activationRadius: 44,
      yaw: 0,
      label: 'Connect',
      color: new THREE.Color(0xffc477)
    }
  ]
  const checkpoints = createCheckpoints(scene, checkpointDefs)

  // WEB-PHASE-4 REDO Phase 6: cap each destination road's far end in a
  // semicircle of its own real MAT_ROAD material (see roadEndCaps.ts) so the
  // rectangle closes off into a rounded bulb instead of stopping on a flat
  // cut edge. Centers/radii are the real measured road geometry (all three
  // roads are a real, locked 50-unit-wide strip -- radius = half that, 25):
  //   Road_North (X -25..25, Z -1000..-75) -> City end at Z -1000, bulges
  //     further north (away from the road) since nothing continues past it.
  //   Road_East (X 75..750, Z -25..25) -> Platform end at X 750, bulges
  //     further east onto the already-paved OpenPlatform_Pad.
  //   Road_West (X -750..-75, Z -25..25) -> Port end at X -750, bulges
  //     further west onto the already-paved Port_Dock.
  // Purely additive floor decals -- roadBoundaries.ts/staticColliders.ts
  // (the real collision geometry) are never read from or touched.
  const roadEndCapDefs: RoadEndCapDef[] = [
    { center: new THREE.Vector3(0, 54.12, -1000), radius: 25, outward: new THREE.Vector2(0, -1) },
    { center: new THREE.Vector3(750, 54.12, 0), radius: 25, outward: new THREE.Vector2(1, 0) },
    { center: new THREE.Vector3(-750, 54.12, 0), radius: 25, outward: new THREE.Vector2(-1, 0) }
  ]
  addRoadEndCaps(scene, env.root, roadEndCapDefs)

  let activeCheckpoint: Checkpoint | null = null
  initOverlay((closedId) => {
    // overlay just closed -- driving resumes next frame because the physics
    // loop below checks isOverlayOpen() itself. Also the trigger for the
    // key-unlock popup (WEB-PHASE-4 REDO Phase 13): fires 2s from here, but
    // only when closedId still owes one (a genuine first visit).
    notifyOverlayClosed(closedId)
  })

  type CamMode = 'normal' | 'front' | 'left' | 'right' | 'left1' | 'right1' | 'overview'
  let camMode: CamMode = 'normal'
  // WEB-PHASE-2/3F: remembers whichever mode was active right before O was
  // pressed, so pressing O again restores it exactly (not always 'normal') --
  // required by the spec ("when returning, restore the previously active
  // camera mode"). Only O reads/writes this; every other existing toggle below
  // is completely unchanged.
  let preOverviewMode: CamMode = 'normal'

  // Overview fly-in/out: instead of cutting, the camera travels a curved path
  // (quadratic Bezier that pulls up and out first, then glides over the map)
  // between whichever mode was active and the fixed top-down overview pose,
  // with orientation slerped along the same eased progress. Both end poses are
  // recomputed live each frame, so the path always lands exactly on the real
  // chase/overview framing. Camera-only: physics, colliders and the map are
  // not involved. Labels are DOM-only and faded in near the end of the flight.
  const overviewLabels = new OverviewLabels(checkpointDefs)
  const FLY_DURATION = 2.6
  let fly: { t: number; dir: 1 | -1 } | null = null
  const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const flyAP = new THREE.Vector3()
  const flyBP = new THREE.Vector3()
  const flyCP = new THREE.Vector3()
  const flyAQ = new THREE.Quaternion()
  const flyBQ = new THREE.Quaternion()
  function updateCamMode(mode: CamMode, dt: number): void {
    if (mode === 'front') diagnosticCam.update(vehicle, dt)
    else if (mode === 'left') leftCam.update(vehicle, dt)
    else if (mode === 'right') rightCam.update(vehicle, dt)
    else if (mode === 'left1') l1Cam.update(vehicle, dt)
    else if (mode === 'right1') r1Cam.update(vehicle, dt)
    else if (mode === 'overview') overviewCam.update(vehicle, dt)
    else chaseCam.update(vehicle, cameraObstacles, dt)
  }

  // WEB-PHASE-4 REDO Phase 6: additive camera-shake state for checkpoint
  // activation "visual juice". Applied once per frame in the render loop
  // below, strictly after every existing camera-mode update -- it only ever
  // nudges camera.position by a small decaying random offset for ~0.3s and
  // never touches any camera class file.
  let shakeTime = 0
  const SHAKE_DURATION = 0.32
  const SHAKE_MAGNITUDE = 0.4

  // WEB-PHASE-4 REDO Phase 10: the shared activation sequence -- originally
  // only the ENTER-key branch below, now also called from each checkpoint's
  // own on-screen prompt tap (see the pointerup wiring after this listener),
  // since phones/tablets have no Enter key at all. Exactly the same effects
  // either way: particle burst + audio chime + camera shake, then the
  // light-speed flash before the overlay actually opens. None of this
  // touches vehicle/camera class files -- the shake is a tiny decaying
  // jitter applied to camera.position AFTER whichever camera class already
  // wrote it this frame (see the shakeTime block in the render loop), so
  // it's purely additive and self-resets every frame.
  function activateCheckpoint(cp: Checkpoint, viaShortcut = false): void {
    if (isOverlayOpen()) return
    triggerActivation(cp, vehicle.position)
    playActivationChime()
    shakeTime = SHAKE_DURATION
    registerVisit(cp.def.id) // one-shot achievement + key-unlock popup, first visit only
    // The M/G/C shortcut (and its touch chip) lands Music on the playlist that is
    // already playing; entering the terminal itself opens the playlist grid.
    requestOpenOverlay(cp.def.id, { landOnPlaying: viaShortcut }) // plays the light-speed flash, then actually opens
  }

  // WEB-PHASE-4 REDO Phase 13: once a checkpoint has been visited for real
  // (driven into, not just via its own shortcut), M/G/C reopen its menu
  // from anywhere on the map -- same activateCheckpoint() path as ENTER, so
  // "the same animation and popup" spec is satisfied for free. Also the
  // touch-chip tap target wired in initAchievements() below.
  function activateCheckpointById(id: CheckpointId): void {
    if (!hasVisited(id) || isOverlayOpen()) return
    const cp = checkpoints.find((c) => c.def.id === id)
    if (cp) activateCheckpoint(cp, true)
  }
  initAchievements(activateCheckpointById)

  window.addEventListener('keydown', (e) => {
    // The loading/tutorial screen is still up: Enter, M/G/C and the camera keys must not reach the world yet.
    if (e.repeat || isTutorialActive()) return
    // WEB-PHASE-4: ENTER activates whichever checkpoint the car is currently
    // inside (debounced for free by the e.repeat guard above, same as every
    // other key here). Does nothing while the overlay is already open --
    // ESC/X/backdrop-click (handled inside overlay.ts) are the only way to
    // close it, matching the spec.
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !isOverlayOpen()) {
      if (activeCheckpoint) activateCheckpoint(activeCheckpoint)
      return
    }
    // WEB-PHASE-4 REDO Phase 13: M/G/C reopen Music/Projects/Connect from
    // anywhere, once that checkpoint has been visited for real at least
    // once (activateCheckpointById no-ops otherwise -- see above).
    if (e.code === 'KeyM') { activateCheckpointById('platform'); return }
    if (e.code === 'KeyG') { activateCheckpointById('port'); return }
    if (e.code === 'KeyC') { activateCheckpointById('city'); return }
    handleCamKey(e.code, e.shiftKey)
  })

  // Camera selection, shared by the keyboard handler above and the phone's on-screen Overview
  // button (touch devices have no O key). Same code path either way.
  function handleCamKey(code: string, shift: boolean): void {
    let next: CamMode
    if (code === 'KeyF') next = camMode === 'front' ? 'normal' : 'front'
    else if (code === 'KeyL' && shift) next = camMode === 'left1' ? 'normal' : 'left1'
    else if (code === 'KeyR' && shift) next = camMode === 'right1' ? 'normal' : 'right1'
    else if (code === 'KeyL') next = camMode === 'left' ? 'normal' : 'left'
    else if (code === 'KeyR') next = camMode === 'right' ? 'normal' : 'right'
    else if (code === 'KeyO') {
      if (camMode === 'overview') {
        next = preOverviewMode
        fly = { t: fly ? fly.t : 1, dir: -1 }
      } else {
        preOverviewMode = camMode
        next = 'overview'
        fly = { t: fly ? fly.t : 0, dir: 1 }
      }
    } else return
    if (code !== 'KeyO') fly = null // any other camera key cancels an in-flight transition
    if (next === camMode) return
    camMode = next
    document.getElementById('touch-btn-overview')?.classList.toggle('is-on', camMode === 'overview')
    // re-anchor whichever camera is being switched TO, so it doesn't lerp across
    // the map from a stale position -- switching FROM one leaves it alone since it
    // simply won't be updated again until switched back to.
    if (camMode === 'front') diagnosticCam.reset()
    else if (camMode === 'left') leftCam.reset()
    else if (camMode === 'right') rightCam.reset()
    else if (camMode === 'left1') l1Cam.reset()
    else if (camMode === 'right1') r1Cam.reset()
    else if (camMode === 'overview') overviewCam.reset()
    else chaseCam.reset()
  }
  document.getElementById('touch-btn-overview')?.addEventListener('click', () => {
    if (!isTutorialActive()) handleCamKey('KeyO', false)
  })

  // WEB-PHASE-4 REDO Phase 10: touch/phone devices have no Enter key, so the
  // floating "OPEN" prompt above an active checkpoint is now tappable too --
  // same activateCheckpoint() path as ENTER. CSS (index.html) only makes the
  // prompt pointer-events:auto on touch input, so this changes nothing for
  // keyboard+mouse visitors. cp.active already gates real-world visibility
  // (checkpoint.ts hides the prompt via display:none otherwise), so this is
  // just the extra activation entry point, not a new proximity check.
  // WEB-PHASE-4 REDO Phase 16: listens on 'pointerdown', not 'pointerup' --
  // checkpoint.ts repositions this prompt's transform EVERY frame to track
  // the car's own moving screen projection (it's chasing a moving target,
  // not a fixed button), so while the car is still drifting through the
  // activation radius the prompt can visibly shift between the finger
  // touching down and lifting back up. 'pointerup' hit-tests wherever the
  // prompt (or whatever's now under the finger) is AT RELEASE, which can
  // miss by then -- exactly the "tap it a few times before it opens" bug.
  // 'pointerdown' hit-tests at the instant of contact, when the prompt is
  // guaranteed to be exactly where it was just rendered, so it never gets a
  // chance to slide out from under the finger first.
  for (const cp of checkpoints) {
    cp.promptEl.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (cp.active) activateCheckpoint(cp)
    })
  }

  // Only vertical obstacles (buildings/pillars/railings/cliffs) should ever pull the
  // chase camera inward — road/ground meshes are excluded so the camera can't clip
  // itself back into the car (see isCameraObstacle).
  const cameraObstacles: THREE.Object3D[] = []
  env.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && isCameraObstacle(o.name)) cameraObstacles.push(o)
  })

  loadingFill.style.width = '100%'
  // The world is genuinely loaded. Draw one frame now so the first real frame under the fading
  // loading screen does not stall on shader compilation, then wait for SKIP TUTORIAL / START.
  // The frame is drawn from the real chase-camera pose (not the default camera at the origin), so the
  // geometry, textures and shadows the first driving view needs are uploaded to the GPU now, behind the
  // loading screen, instead of as a ~1 s freeze the moment START is pressed. chaseCam anchors itself on
  // its first update, so the first game frame lands on exactly the same pose as before.
  updateCamMode(camMode, 0)
  sky.update(0, camera)
  renderer.render(scene, camera)
  markLoaded()
  warmTrackDurations() // track lengths load while the tutorial is being read
  await waitForStart()
  loadingEl.style.display = 'none'
  // WEB-PHASE-4 REDO Phase 13: on-screen touch controls (D-pad/brake/shortcut
  // chips) stay hidden via CSS (index.html) until this class is set -- i.e.
  // only once the game has actually finished loading and the vehicle is
  // drivable, not the instant bindTouchControls() runs earlier in main().
  document.documentElement.classList.add('is-ready')

  const clock = new THREE.Clock()
  const FIXED_DT = 1 / 60
  let accumulator = 0

  function animate(): void {
    requestAnimationFrame(animate)
    const frameDt = Math.min(clock.getDelta(), 0.1)
    accumulator += frameDt

    // WEB-PHASE-4: freeze driving/physics while a checkpoint overlay is open
    // (its links/embeds are the focus, not the car) -- the render loop below
    // keeps running exactly as before so the 3D scene stays visible/animated
    // behind the glass panel, only the physics step is skipped.
    if (!isOverlayOpen()) {
      while (accumulator >= FIXED_DT) {
        vehicle.applyControls(input, FIXED_DT)
        world.step()
        vehicle.postStep()
        accumulator -= FIXED_DT
      }
    } else {
      // don't let elapsed real time pile up in the accumulator while paused,
      // or closing the overlay would replay a burst of catch-up physics steps
      accumulator = 0
    }

    // WEB-PHASE-2/3F (render-synchronization rocking fix): the while-loop above
    // runs 0, 1, or 2+ physics steps depending on how frameDt compares to
    // FIXED_DT this frame -- true on every real display, since
    // requestAnimationFrame's actual interval is never a perfectly exact,
    // jitter-free 60Hz (any refresh rate that doesn't evenly divide 60Hz --
    // 75/120/144/165/240Hz are all common -- plus ordinary compositor/OS
    // scheduling jitter on exact 60Hz displays). Previously vehicle.postStep()
    // wrote the rendered car's transform directly, once per physics step inside
    // this loop, so a 0-step frame rendered the car perfectly still and the next
    // (now owing steps) frame rendered it jumping by more than one step at once
    // -- a hold-then-jump pattern, at the display's own refresh rate, that reads
    // on screen as rocking/stutter even though the underlying physics trajectory
    // is smooth. vehicle.applyVisualState() now does the actual mesh write, once
    // per render frame, interpolating between the last two physics-computed
    // states by how far `accumulator` sits toward the next (not-yet-computed)
    // step -- the standard fixed-timestep render-decoupling technique. This
    // changes only what gets drawn each frame; the physics loop above, and
    // everything it does, is unchanged.
    vehicle.applyVisualState(accumulator / FIXED_DT)

    if (fly) {
      // pose A: the non-overview mode (kept live); pose B: the overview frame
      updateCamMode(camMode === 'overview' ? preOverviewMode : camMode, frameDt)
      flyAP.copy(camera.position)
      flyAQ.copy(camera.quaternion)
      overviewCam.update(vehicle, frameDt)
      flyBP.copy(camera.position)
      flyBQ.copy(camera.quaternion)
      fly.t = Math.min(1, Math.max(0, fly.t + (fly.dir * frameDt) / FLY_DURATION))
      const e = easeInOut(fly.t)
      // control point: partway toward B horizontally but already most of the way up
      flyCP.set(flyAP.x + (flyBP.x - flyAP.x) * 0.3, flyAP.y + (flyBP.y - flyAP.y) * 0.75, flyAP.z + (flyBP.z - flyAP.z) * 0.3)
      const u = 1 - e
      camera.position.set(
        u * u * flyAP.x + 2 * u * e * flyCP.x + e * e * flyBP.x,
        u * u * flyAP.y + 2 * u * e * flyCP.y + e * e * flyBP.y,
        u * u * flyAP.z + 2 * u * e * flyCP.z + e * e * flyBP.z
      )
      camera.quaternion.slerpQuaternions(flyAQ, flyBQ, e)
      if ((fly.dir === 1 && fly.t >= 1) || (fly.dir === -1 && fly.t <= 0)) fly = null
    } else {
      updateCamMode(camMode, frameDt)
    }
    // WEB-PHASE-4 REDO Phase 6: additive post-camera shake -- runs after
    // every camMode branch above has already written camera.position for
    // this frame, so it only ever adds a small decaying jitter on top,
    // never replaces or fights with any camera class's own logic.
    if (shakeTime > 0) {
      shakeTime = Math.max(0, shakeTime - frameDt)
      const t = shakeTime / SHAKE_DURATION
      const mag = SHAKE_MAGNITUDE * t * t
      camera.position.x += (Math.random() - 0.5) * 2 * mag
      camera.position.y += (Math.random() - 0.5) * 2 * mag
      camera.position.z += (Math.random() - 0.5) * 2 * mag
    }

    sky.update(clock.elapsedTime, camera)

    // WEB-PHASE-4: checkpoint pads always animate/update (so their glass
    // shader keeps running even while the overlay is open), but the floating
    // "OPEN <Enter>" DOM prompt is suppressed while the overlay has focus.
    activeCheckpoint = updateCheckpoints(checkpoints, vehicle, camera, clock.elapsedTime, frameDt)
    {
      const prog = fly ? easeInOut(fly.t) : camMode === 'overview' ? 1 : 0
      const a = Math.min(1, Math.max(0, (prog - 0.7) / 0.3))
      overviewLabels.update(camera, isOverlayOpen() ? 0 : a)
    }
    if (isOverlayOpen()) {
      for (const cp of checkpoints) cp.promptEl.style.display = 'none'
    }

    renderer.render(scene, camera)
  }
  animate()
}

main().catch((err) => showError(`Failed to start:\n${err?.message ?? err}`))

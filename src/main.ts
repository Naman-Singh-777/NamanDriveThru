import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadEnvironment } from './scene/environment'
import { createSky } from './scene/sky'
import { createLighting } from './scene/lighting'
import { buildStaticColliders, isCameraObstacle } from './collision/staticColliders'
import { buildRoadBoundaries, buildJunctionBoundaries } from './collision/roadBoundaries'
import { Vehicle } from './vehicle/vehicle'
import { createControls } from './vehicle/controls'
import { bindTouchControls } from './vehicle/touchControls'
import { VehicleCamera } from './vehicle/vehicleCamera'
import { DiagnosticCamera } from './vehicle/diagnosticCamera'
import { SideDiagnosticCamera } from './vehicle/sideDiagnosticCamera'
import { HeroCamera } from './vehicle/heroCamera'
import { OverviewCamera } from './vehicle/overviewCamera'
import { createCheckpoints, updateCheckpoints, type Checkpoint, type CheckpointDef } from './vehicle/checkpoint'
import { initOverlay, openOverlay, isOverlayOpen } from './overlay'

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000)

  // Neutral PBR environment (official three.js RoomEnvironment helper) so metallic/
  // glossy materials (car paint, chrome trim, rusted steel, glass) get a believable
  // ambient specular response instead of rendering flat black — without an env map,
  // MeshStandardMaterial's specular/IBL term is simply absent for these surfaces,
  // which was a large part of why everything read as near-black.
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
  pmremGenerator.dispose()

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
    loadingFill.style.width = `${10 + pct * 70}%`
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
  const carFootprint = new THREE.Box3().expandByObject(env.vehicleBody).getSize(new THREE.Vector3())
  const checkpointLongSide = carFootprint.z * 2
  const checkpointShortSide = carFootprint.x * 2
  const checkpointDefs: CheckpointDef[] = [
    {
      id: 'port',
      position: new THREE.Vector3(-750, 53.94, -40),
      width: checkpointLongSide,
      depth: checkpointShortSide,
      activationRadius: 16,
      yaw: 0,
      label: 'Projects',
      color: new THREE.Color(0x6fb8ff)
    },
    {
      id: 'platform',
      position: new THREE.Vector3(750, 53.94, 0),
      width: checkpointLongSide,
      depth: checkpointShortSide,
      activationRadius: 16,
      yaw: 0,
      label: 'Music',
      color: new THREE.Color(0x7fe3b4)
    },
    {
      id: 'city',
      position: new THREE.Vector3(0, 54.12, -995),
      width: checkpointShortSide,
      depth: checkpointLongSide,
      activationRadius: 16,
      yaw: 0,
      label: 'Connect',
      color: new THREE.Color(0xffc477)
    }
  ]
  const checkpoints = createCheckpoints(scene, checkpointDefs)
  let activeCheckpoint: Checkpoint | null = null
  initOverlay(() => {
    // overlay just closed -- nothing extra needed, driving resumes next frame
    // because the physics loop below checks isOverlayOpen() itself.
  })

  type CamMode = 'normal' | 'front' | 'left' | 'right' | 'left1' | 'right1' | 'overview'
  let camMode: CamMode = 'normal'
  // WEB-PHASE-2/3F: remembers whichever mode was active right before O was
  // pressed, so pressing O again restores it exactly (not always 'normal') --
  // required by the spec ("when returning, restore the previously active
  // camera mode"). Only O reads/writes this; every other existing toggle below
  // is completely unchanged.
  let preOverviewMode: CamMode = 'normal'
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return
    // WEB-PHASE-4: ENTER activates whichever checkpoint the car is currently
    // inside (debounced for free by the e.repeat guard above, same as every
    // other key here). Does nothing while the overlay is already open --
    // ESC/X/backdrop-click (handled inside overlay.ts) are the only way to
    // close it, matching the spec.
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !isOverlayOpen()) {
      if (activeCheckpoint) openOverlay(activeCheckpoint.def.id)
      return
    }
    let next: CamMode
    if (e.code === 'KeyF') next = camMode === 'front' ? 'normal' : 'front'
    else if (e.code === 'KeyL' && e.shiftKey) next = camMode === 'left1' ? 'normal' : 'left1'
    else if (e.code === 'KeyR' && e.shiftKey) next = camMode === 'right1' ? 'normal' : 'right1'
    else if (e.code === 'KeyL') next = camMode === 'left' ? 'normal' : 'left'
    else if (e.code === 'KeyR') next = camMode === 'right' ? 'normal' : 'right'
    else if (e.code === 'KeyO') {
      if (camMode === 'overview') next = preOverviewMode
      else {
        preOverviewMode = camMode
        next = 'overview'
      }
    } else return
    if (next === camMode) return
    camMode = next
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
  })

  // Only vertical obstacles (buildings/pillars/railings/cliffs) should ever pull the
  // chase camera inward — road/ground meshes are excluded so the camera can't clip
  // itself back into the car (see isCameraObstacle).
  const cameraObstacles: THREE.Object3D[] = []
  env.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && isCameraObstacle(o.name)) cameraObstacles.push(o)
  })

  loadingFill.style.width = '100%'
  loadingEl.style.display = 'none'

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

    if (camMode === 'front') {
      diagnosticCam.update(vehicle, frameDt)
    } else if (camMode === 'left') {
      leftCam.update(vehicle, frameDt)
    } else if (camMode === 'right') {
      rightCam.update(vehicle, frameDt)
    } else if (camMode === 'left1') {
      l1Cam.update(vehicle, frameDt)
    } else if (camMode === 'right1') {
      r1Cam.update(vehicle, frameDt)
    } else if (camMode === 'overview') {
      overviewCam.update(vehicle, frameDt)
    } else {
      chaseCam.update(vehicle, cameraObstacles, frameDt)
    }
    sky.update(clock.elapsedTime)

    // WEB-PHASE-4: checkpoint pads always animate/update (so their glass
    // shader keeps running even while the overlay is open), but the floating
    // "OPEN <Enter>" DOM prompt is suppressed while the overlay has focus.
    activeCheckpoint = updateCheckpoints(checkpoints, vehicle, camera, clock.elapsedTime)
    if (isOverlayOpen()) {
      for (const cp of checkpoints) cp.promptEl.style.display = 'none'
    }

    renderer.render(scene, camera)
  }
  animate()
}

main().catch((err) => showError(`Failed to start:\n${err?.message ?? err}`))

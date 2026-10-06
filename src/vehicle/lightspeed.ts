import * as THREE from 'three'

// WEB-PHASE-4 REDO Phase 8: real "light speed" / hyperspace jump, built from
// the user's own Blender tutorial reference (Ducky3D's Star Wars warp-speed
// effect) translated into a small, self-contained Three.js scene instead of
// Blender geometry: a tunnel of elongated, emissive-blue streaks flying past
// a wide-FOV camera, recycled front-to-back for a continuous rush, played for
// ~1s right before a checkpoint's overlay opens and again right before it
// closes (see requestOpenOverlay/requestCloseOverlay in overlay.ts). Runs in
// its own canvas/renderer/scene, completely separate from the driving scene
// in main.ts -- it never reads from or touches that camera, scene, or
// renderer.
//
// Mapping from the tutorial to this implementation:
//   - stretched UV sphere + blue emission material -> a Z-stretched low-poly
//     sphere with an additive-blended MeshBasicMaterial (no lights needed).
//   - particle system scattered through a cylinder, instanced -> a
//     THREE.InstancedMesh of the same streak geometry, scattered through an
//     annulus around the forward (-Z) axis.
//   - camera flown down the tunnel, focal length pulled back (wide FOV) to
//     sell the speed -> streaks are moved toward the camera instead (cheaper,
//     identical look) under a wide-FOV (110deg) camera.
//   - collection instances snapped end-to-end for a seamless loop -> each
//     streak just wraps from the far end back to the start once it passes
//     the camera, forever, for as long as this plays.
//   - a volume-shaded cube fading the scene toward the edges -> approximated
//     with a soft core glow sprite at the vanishing point plus the renderer's
//     own near-black clear color, rather than a full volumetric shader.
//   - Eevee's Bloom -> no full postprocessing bloom pipeline here (would mean
//     adding an EffectComposer this project doesn't otherwise use); additive
//     blending on bright, saturated colors against near-black approximates
//     the glow without it.

const DEFAULT_DURATION_MS = 1000
const STREAK_COUNT = 650
const TUNNEL_INNER_RADIUS = 0.5
const TUNNEL_OUTER_RADIUS = 6.5
const FAR_Z = -70
const NEAR_Z = 2
const TUNNEL_LENGTH = NEAR_Z - FAR_Z
const MAX_SPEED = 140 // units/sec at the jump's peak
// The jump's timeline only advances by this much per drawn frame, so a stall in the middle (a slow
// frame, a GC pause) cannot skip over its ramp-up, cruise or drop-out. Normal frames are far shorter.
const MAX_FRAME_STEP_MS = 100
const MAX_MOVE_STEP_MS = 50 // the streaks' own per-frame travel keeps its original 50 ms cap
// Hard stop, as a multiple of the duration after the first frame, so a very slow device is never held
// in the transition for long.
const MAX_WALL_FACTOR = 3

interface StreakState {
  radius: number
  angle: number
  z: number
  spin: number
  lenJitter: number
}

let containerEl: HTMLElement | null = null
let canvas: HTMLCanvasElement | null = null
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let streaks: THREE.InstancedMesh | null = null
let streakState: StreakState[] = []
let coreMat: THREE.MeshBasicMaterial | null = null
let streakMat: THREE.MeshBasicMaterial | null = null
let rafId: number | null = null
// Ends the play that is currently running (if any), so a restart never leaves its caller waiting.
let endCurrent: (() => void) | null = null

function onResize(): void {
  if (!renderer || !camera) return
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function ensureScene(): void {
  if (renderer) return
  containerEl = document.getElementById('lightspeed-overlay')!
  canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
  containerEl.appendChild(canvas)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(0x05060c, 1) // near-black with a faint blue cast, not pure black

  scene = new THREE.Scene()
  // Wide FOV ("focal length pulled way back" in the tutorial) exaggerates
  // the radial rush of streaks toward the frame edges.
  camera = new THREE.PerspectiveCamera(112, window.innerWidth / window.innerHeight, 0.05, 120)

  // Soft glow at the vanishing point, standing in for the tutorial's bloom.
  const coreGeo = new THREE.SphereGeometry(1.6, 16, 16)
  coreMat = new THREE.MeshBasicMaterial({
    color: 0xdcebff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  const core = new THREE.Mesh(coreGeo, coreMat)
  core.position.set(0, 0, FAR_Z + 6)
  scene.add(core)

  // The stretched-sphere "streak" -- elongated along Z (the travel axis),
  // same idea as the tutorial's SY-stretched UV sphere.
  const streakGeo = new THREE.SphereGeometry(0.045, 6, 5)
  streakGeo.scale(1, 1, 7)
  streakMat = new THREE.MeshBasicMaterial({
    color: 0xbfe0ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  streaks = new THREE.InstancedMesh(streakGeo, streakMat, STREAK_COUNT)
  scene.add(streaks)

  streakState = []
  for (let i = 0; i < STREAK_COUNT; i++) {
    streakState.push({
      radius: TUNNEL_INNER_RADIUS + Math.sqrt(Math.random()) * (TUNNEL_OUTER_RADIUS - TUNNEL_INNER_RADIUS),
      angle: Math.random() * Math.PI * 2,
      z: FAR_Z + Math.random() * TUNNEL_LENGTH,
      spin: (Math.random() - 0.5) * 0.6,
      lenJitter: 0.6 + Math.random() * 0.9
    })
  }

  window.addEventListener('resize', onResize)
}

const dummy = new THREE.Object3D()

function renderFrame(speed: number, dt: number, intensity: number): void {
  if (!streaks || !camera || !renderer || !scene) return
  const lengthScale = 0.4 + intensity * 1.8 // longer streaks the faster the jump is going
  for (let i = 0; i < STREAK_COUNT; i++) {
    const s = streakState[i]
    s.z += speed * dt
    if (s.z > NEAR_Z) s.z -= TUNNEL_LENGTH // wrap back to the far end -- the tutorial's seamless loop
    s.angle += s.spin * dt
    const x = Math.cos(s.angle) * s.radius
    const y = Math.sin(s.angle) * s.radius
    dummy.position.set(x, y, s.z)
    dummy.rotation.set(0, 0, s.angle)
    const radialScale = 0.8 + (s.radius / TUNNEL_OUTER_RADIUS) * 0.6
    dummy.scale.set(radialScale, radialScale, lengthScale * s.lenJitter)
    dummy.updateMatrix()
    streaks.setMatrixAt(i, dummy.matrix)
  }
  streaks.instanceMatrix.needsUpdate = true
  renderer.render(scene, camera)
}

// Builds the warp scene and uploads/compiles everything now, invisibly (opacity 0, container hidden), so the
// first transition does not pay for WebGL setup and shader compilation inside its own timeline.
export function warmLightspeed(): void {
  try {
    ensureScene()
    renderFrame(0, 0, 0)
  } catch {
    // purely cosmetic: it is simply built on first use instead
  }
}

export function playLightspeed(durationMs: number = DEFAULT_DURATION_MS): Promise<void> {
  try {
    ensureScene()
  } catch {
    return Promise.resolve() // no WebGL for the flash: the menu still opens/closes
  }
  const node = containerEl!

  if (rafId !== null) cancelAnimationFrame(rafId) // a rapid re-trigger restarts cleanly, no overlap
  rafId = null
  endCurrent?.() // the play being replaced resolves instead of hanging its caller
  node.classList.add('is-active')

  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      endCurrent = null
      rafId = null
      node.classList.remove('is-active')
      resolve()
    }
    endCurrent = finish

    // The timeline starts at the first frame actually drawn, not at the call: whatever delays that frame
    // (first-use setup, other work on the page) can no longer eat into the animation. From then on it
    // advances by real time, capped per frame.
    let firstNow = -1
    let last = 0
    let elapsed = 0

    const tick = (now: number): void => {
      try {
        let stepMs = 0
        if (firstNow < 0) {
          firstNow = now
        } else {
          stepMs = Math.min(Math.max(now - last, 0), MAX_FRAME_STEP_MS)
        }
        last = now
        elapsed += stepMs
        const dt = Math.min(stepMs, MAX_MOVE_STEP_MS) / 1000
        const t = Math.min(elapsed / durationMs, 1)

        // Jump-to-light-speed-and-drop-out envelope: quick ramp up, a held
        // cruise at full speed, then a quick ramp back down -- mirrors the
        // tutorial's "accelerate into the tunnel" feel within a single second.
        let intensity: number
        if (t < 0.18) intensity = t / 0.18
        else if (t < 0.8) intensity = 1
        else intensity = Math.max(0, 1 - (t - 0.8) / 0.2)
        const eased = intensity * intensity * (3 - 2 * intensity) // smoothstep

        const opacity = Math.min(1, t < 0.1 ? t / 0.1 : t > 0.88 ? Math.max(0, (1 - t) / 0.12) : 1)
        if (streakMat) streakMat.opacity = 0.9 * opacity
        if (coreMat) coreMat.opacity = 0.55 * opacity

        renderFrame(eased * MAX_SPEED, dt, eased)

        if (t < 1 && now - firstNow < durationMs * MAX_WALL_FACTOR) {
          rafId = requestAnimationFrame(tick)
        } else {
          finish()
        }
      } catch {
        finish() // never leave the menu waiting on a failed frame
      }
    }
    rafId = requestAnimationFrame(tick)
  })
}
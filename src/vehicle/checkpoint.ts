import * as THREE from 'three'
import type { Vehicle } from './vehicle'
import { playRadioStatic } from './checkpointAudio'

// WEB-PHASE-4 REDO (v2): "Quantum Entanglement Terminal" checkpoints. Original
// design, not a copy of any external reference. Each terminal is a glowing
// floor pad (location-tinted, technical quantum/holographic pattern) with a
// cluster of counter-rotating holographic rings rising above it, a one-shot
// floor-originating reveal the first time it comes alive, a proximity radio-
// static cue the instant the car arrives (handled here), and a particle
// "deconstruction" burst the caller (main.ts) triggers on actual ENTER
// activation via triggerActivation() below -- your position/data physically
// breaking into particles and streaming into the terminal, paired with a
// camera shake and audio chime driven from main.ts. Entirely additive: this
// module creates its own Group per checkpoint and never touches vehicle/
// physics/camera/collision code. Positions AND sizes are derived from the
// real exported map geometry and the car's own real runtime footprint (see
// main.ts comments at the call site), never guessed.

export type CheckpointId = 'port' | 'platform' | 'city'

export interface CheckpointDef {
  id: CheckpointId
  // World-space center of the pad, ON the floor (same Y convention used by
  // the drivable mesh it sits on at that location).
  position: THREE.Vector3
  // Pad footprint, local XZ before the pad's own yaw rotation is applied.
  width: number
  depth: number
  // Horizontal (XZ) distance from center at which the checkpoint activates.
  activationRadius: number
  // Ground-plane yaw (radians) so the pad's long axis can follow the local
  // geometry (e.g. aligned with the dock or the road) instead of always
  // being world-axis-aligned.
  yaw: number
  // Short label shown in the floating prompt, e.g. "PROJECTS".
  label: string
  // Per-checkpoint accent color (restrained, not neon) — glass tint + glow.
  color: THREE.Color
}

export interface Checkpoint {
  def: CheckpointDef
  group: THREE.Group
  promptEl: HTMLDivElement
  active: boolean
  // Elapsed-time (seconds, same clock as updateCheckpoints' elapsedTime arg)
  // at which this pad's one-shot reveal animation began. null until the
  // first updateCheckpoints() call sets it.
  revealStart: number | null
  // Internal: particle-burst state (see triggerActivation / the per-frame
  // update in updateCheckpoints). Not meant to be read by callers.
  _burst: BurstState
}

const REVEAL_DURATION = 1.35 // seconds — small, quick, not a long cutscene.
const BURST_COUNT = 220
const BURST_DURATION = 0.85 // seconds

interface BurstState {
  points: THREE.Points
  positions: Float32Array
  velocities: Float32Array
  ages: Float32Array // 0..1 fraction of BURST_DURATION elapsed; >=1 means dead
  active: boolean
}

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Quantum-terminal floor: soft fill, bright rounded-rect border band, slow
// concentric "data rings" expanding from center, a thin rotating radial
// spoke pattern, a slow scan sweep, a gentle breathing opacity, and a radial
// "iris" reveal mask that draws the whole pad in from its own center the
// first time it comes alive — all driven by uTime/uReveal. uActive blends
// the whole thing up when the car is inside the pad.
const FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uActive;
  uniform float uReveal;
  uniform vec3 uColor;

  float edgeBand(vec2 uv, float inset, float feather) {
    vec2 d = min(uv, 1.0 - uv);
    float m = min(d.x, d.y);
    return 1.0 - smoothstep(inset, inset + feather, m);
  }

  void main() {
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float dist = length(c) * 1.42; // ~0 center .. ~1 corner
    float ang = atan(c.y, c.x);

    // Radial iris reveal: the pad draws itself in from its own center
    // outward, i.e. "originates from the floor" rather than popping in.
    float revealMask = 1.0 - smoothstep(uReveal - 0.10, uReveal, dist);

    float fill = 0.05 + 0.02 * sin(uTime * 0.6);
    float border = edgeBand(uv, 0.015, 0.02);

    // Concentric data rings expanding outward from the terminal's own
    // center, looping -- the "entanglement" pulse.
    float ringPhase = fract(dist * 5.0 - uTime * 0.35);
    float rings = smoothstep(0.08, 0.0, abs(ringPhase - 0.5)) * smoothstep(1.0, 0.15, dist);

    // Thin rotating radial spokes -- technical terminal markings.
    float spokeCount = 16.0;
    float spoke = smoothstep(0.06, 0.0, abs(fract((ang + uTime * 0.12) / (2.0 * 3.14159265) * spokeCount) - 0.5));
    spoke *= smoothstep(0.08, 0.22, dist) * smoothstep(1.0, 0.55, dist);

    float scan = smoothstep(0.0, 0.05, 0.5 - abs(fract(uTime * 0.09) - uv.x));
    scan *= 0.3;

    float breathe = 0.65 + 0.35 * sin(uTime * 0.8);

    float alpha = fill + border * (0.55 + 0.45 * breathe) + scan * 0.35 + rings * 0.3 + spoke * 0.22;
    alpha *= mix(0.55, 1.0, uActive);
    alpha *= revealMask;
    alpha = clamp(alpha, 0.0, 0.88);

    vec3 col = uColor * mix(0.7, 1.35, border) + (rings + spoke + scan) * uColor * 0.7;
    col *= mix(0.8, 1.4, uActive);

    gl_FragColor = vec4(col, alpha);
  }
`

// Thin expanding ring that rides the same reveal progress as the pad's own
// iris mask -- the "thin illuminated floor perimeter" reveal language.
const RING_FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uReveal;
  uniform vec3 uColor;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float band = smoothstep(0.05, 0.0, abs(r - uReveal));
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, uReveal);
    float alpha = band * fadeOut * 0.85;
    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`

function roundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const w = width / 2
  const d = depth / 2
  const r = Math.min(radius, w, d)
  const s = new THREE.Shape()
  s.moveTo(-w + r, -d)
  s.lineTo(w - r, -d)
  s.quadraticCurveTo(w, -d, w, -d + r)
  s.lineTo(w, d - r)
  s.quadraticCurveTo(w, d, w - r, d)
  s.lineTo(-w + r, d)
  s.quadraticCurveTo(-w, d, -w, d - r)
  s.lineTo(-w, -d + r)
  s.quadraticCurveTo(-w, -d, -w + r, -d)
  return s
}

function remapShapeGeometryUv(geo: THREE.ShapeGeometry): void {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const pos = geo.getAttribute('position')
  const uvArr = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    uvArr[i * 2] = (x - bb.min.x) / (bb.max.x - bb.min.x)
    uvArr[i * 2 + 1] = (z - bb.min.z) / (bb.max.z - bb.min.z)
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
}

function buildHoloRings(def: CheckpointDef): THREE.Group {
  // Diegetic "terminal" structure: 3 counter-rotating holographic rings
  // rising above the pad, radii scaled to the pad's own size so they grow
  // with it automatically. Simple additive-blended torus geometry, no extra
  // shader needed -- cheap (3 meshes, a few hundred tris each).
  const group = new THREE.Group()
  const minSide = Math.min(def.width, def.depth)
  // WEB-PHASE-4 REDO Phase 6: heightFactor (fraction of minSide), not a fixed
  // absolute height -- Phase 6 grew the pads substantially (see main.ts), and
  // a fixed height would have left the now-much-wider rings sitting flat and
  // squashed-looking; this keeps the same stacked-ring proportions at any
  // pad size, derived from the original fixed heights (1.4/2.6/4.0) against
  // the original ~18-unit minSide.
  const ringSpecs = [
    { radiusFactor: 0.2, heightFactor: 0.08, tube: 0.07, speed: 0.5, tilt: 0.08 },
    { radiusFactor: 0.27, heightFactor: 0.14, tube: 0.055, speed: -0.35, tilt: -0.12 },
    { radiusFactor: 0.33, heightFactor: 0.22, tube: 0.04, speed: 0.22, tilt: 0.16 }
  ]
  for (const spec of ringSpecs) {
    const radius = minSide * spec.radiusFactor
    const geo = new THREE.TorusGeometry(radius, spec.tube * minSide * 0.35, 8, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const ring = new THREE.Mesh(geo, mat)
    ring.rotation.x = Math.PI / 2 + spec.tilt
    ring.position.y = minSide * spec.heightFactor
    ring.userData.spinSpeed = spec.speed
    ring.name = `Checkpoint_${def.id}_HoloRing`
    group.add(ring)
  }
  return group
}

function buildBurst(def: CheckpointDef): BurstState {
  const positions = new Float32Array(BURST_COUNT * 3)
  const velocities = new Float32Array(BURST_COUNT * 3)
  const ages = new Float32Array(BURST_COUNT).fill(1) // start fully "dead"

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: def.color,
    size: 1.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const points = new THREE.Points(geo, mat)
  points.name = `Checkpoint_${def.id}_Burst`
  points.frustumCulled = false
  return { points, positions, velocities, ages, active: false }
}

function buildPadGroup(def: CheckpointDef): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(def.position)
  group.rotation.y = def.yaw

  const shape = roundedRectShape(def.width, def.depth, Math.min(def.width, def.depth) * 0.1)
  const geo = new THREE.ShapeGeometry(shape, 32)
  geo.rotateX(-Math.PI / 2)
  remapShapeGeometryUv(geo)

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: 0 },
      uReveal: { value: 0 },
      uColor: { value: def.color.clone() }
    }
  })

  const pad = new THREE.Mesh(geo, mat)
  pad.position.y = 0.08
  pad.renderOrder = 5
  pad.name = `Checkpoint_${def.id}_Pad`
  group.add(pad)

  const ringRadius = Math.max(def.width, def.depth) * 0.62
  const ringGeo = new THREE.CircleGeometry(ringRadius, 48)
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: RING_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uReveal: { value: 0 }, uColor: { value: def.color.clone() } }
  })
  ringGeo.rotateX(-Math.PI / 2)
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.position.y = 0.06
  ring.renderOrder = 4
  ring.name = `Checkpoint_${def.id}_Ring`
  group.add(ring)

  group.add(buildHoloRings(def))

  return group
}

function buildPromptEl(label: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'checkpoint-prompt'
  el.innerHTML = `
    <span class="checkpoint-prompt__label">${label}</span>
    <span class="checkpoint-prompt__enter" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15">
        <path d="M20 5 V13 A2 2 0 0 1 18 15 H7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10 11.2 L6.6 15 L10 18.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
  `
  el.style.display = 'none'
  document.body.appendChild(el)
  return el
}

export function createCheckpoints(scene: THREE.Scene, defs: CheckpointDef[]): Checkpoint[] {
  return defs.map((def) => {
    const group = buildPadGroup(def)
    scene.add(group)
    const burst = buildBurst(def)
    group.add(burst.points) // local to the group, same convenience as the pad/rings
    const promptEl = buildPromptEl(def.label)
    return { def, group, promptEl, active: false, revealStart: null, _burst: burst }
  })
}

// Called by main.ts the instant ENTER actually activates a checkpoint (i.e.
// right as its overlay is about to open) -- spawns the "atomic data"
// particle burst streaming from the car's current position into the
// terminal. Caller is responsible for the matching camera shake + audio
// chime (see main.ts), kept out of this module since neither touches the
// world/scene graph.
export function triggerActivation(cp: Checkpoint, carPosition: THREE.Vector3): void {
  const b = cp._burst
  const center = cp.def.position
  for (let i = 0; i < BURST_COUNT; i++) {
    const i3 = i * 3
    // Spawn scattered around the car (a small cloud, not a single point).
    const spread = 1.6
    b.positions[i3] = carPosition.x + (Math.random() - 0.5) * spread
    b.positions[i3 + 1] = carPosition.y + 0.6 + Math.random() * 1.6
    b.positions[i3 + 2] = carPosition.z + (Math.random() - 0.5) * spread
    // Velocity: toward the terminal center plus upward drift plus jitter --
    // "your data physically deconstructing and streaming into the terminal".
    const toCenter = new THREE.Vector3(center.x, carPosition.y + 2.5, center.z).sub(carPosition).normalize()
    const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.5, (Math.random() - 0.5) * 0.6)
    const speed = 4.5 + Math.random() * 5
    const vel = toCenter.add(jitter).normalize().multiplyScalar(speed)
    b.velocities[i3] = vel.x
    b.velocities[i3 + 1] = vel.y
    b.velocities[i3 + 2] = vel.z
    b.ages[i] = 0
  }
  b.active = true
  b.points.geometry.attributes.position.needsUpdate = true
  ;(b.points.material as THREE.PointsMaterial).opacity = 1
}

const _carXZ = new THREE.Vector2()
const _padXZ = new THREE.Vector2()
const _projected = new THREE.Vector3()

function updateBurst(b: BurstState, dt: number): void {
  if (!b.active) return
  let anyAlive = false
  for (let i = 0; i < BURST_COUNT; i++) {
    if (b.ages[i] >= 1) continue
    anyAlive = true
    b.ages[i] += dt / BURST_DURATION
    const i3 = i * 3
    b.positions[i3] += b.velocities[i3] * dt
    b.positions[i3 + 1] += b.velocities[i3 + 1] * dt
    b.positions[i3 + 2] += b.velocities[i3 + 2] * dt
  }
  b.points.geometry.attributes.position.needsUpdate = true
  const mat = b.points.material as THREE.PointsMaterial
  mat.opacity = anyAlive ? 0.9 : 0
  if (!anyAlive) b.active = false
}

// Updates each pad's shader time/active/reveal uniforms, the holo-rings'
// rotation, any in-flight particle burst, decides which (if any) checkpoint
// the car currently sits inside (firing a quiet proximity radio-static cue
// right as it becomes active), and projects+positions that checkpoint's DOM
// prompt on screen. Returns the currently-active checkpoint (or null), for
// the caller to drive ENTER-key activation against.
export function updateCheckpoints(
  checkpoints: Checkpoint[],
  vehicle: Vehicle,
  camera: THREE.PerspectiveCamera,
  elapsedTime: number,
  dt: number
): Checkpoint | null {
  _carXZ.set(vehicle.position.x, vehicle.position.z)
  let current: Checkpoint | null = null

  for (const cp of checkpoints) {
    if (cp.revealStart === null) cp.revealStart = elapsedTime
    const reveal = THREE.MathUtils.clamp((elapsedTime - cp.revealStart) / REVEAL_DURATION, 0, 1)
    const revealEased = 1 - Math.pow(1 - reveal, 3)

    const pad = cp.group.children[0] as THREE.Mesh
    const ring = cp.group.children[1] as THREE.Mesh | undefined
    const holoRings = cp.group.children[2] as THREE.Group | undefined
    const mat = pad.material as THREE.ShaderMaterial
    mat.uniforms.uTime.value = elapsedTime
    mat.uniforms.uReveal.value = revealEased
    if (ring) (ring.material as THREE.ShaderMaterial).uniforms.uReveal.value = revealEased
    if (holoRings) {
      for (const r of holoRings.children) {
        r.rotation.z += (r.userData.spinSpeed as number) * dt
      }
    }
    updateBurst(cp._burst, dt)

    _padXZ.set(cp.def.position.x, cp.def.position.z)
    const dist = _carXZ.distanceTo(_padXZ)
    const wasActive = cp.active
    cp.active = dist <= cp.def.activationRadius
    if (cp.active && !wasActive) playRadioStatic() // "right before a checkpoint is opening"
    if (cp.active) current = cp

    mat.uniforms.uActive.value = THREE.MathUtils.damp(mat.uniforms.uActive.value, cp.active ? 1 : 0, 6, 1 / 60)

    if (cp.active) {
      _projected.set(cp.def.position.x, cp.def.position.y + 6, cp.def.position.z).project(camera)
      const behindCamera = _projected.z > 1
      if (behindCamera) {
        cp.promptEl.style.display = 'none'
      } else {
        const x = (_projected.x * 0.5 + 0.5) * window.innerWidth
        const y = (1 - (_projected.y * 0.5 + 0.5)) * window.innerHeight
        cp.promptEl.style.display = 'flex'
        cp.promptEl.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`
      }
    } else {
      cp.promptEl.style.display = 'none'
    }
  }

  return current
}

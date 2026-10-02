import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// WEB-PHASE-4 REDO: world-space interactive checkpoints (Port / Platform /
// City). Original design, not a copy of any external reference — a
// translucent glass rounded-rect pad embedded in the ground plane with an
// emissive pulsing edge, a slow scanning highlight, a location-specific
// procedural pattern (no new textures/geometry — pure shader), and a one-shot
// floor-originating reveal (radial iris + expanding ring) that plays once
// each pad first comes alive. A small screen-projected "OPEN <Enter-glyph>"
// prompt appears only while the car is inside the pad's activation radius.
// Entirely additive: this module creates its own Group per checkpoint and
// does not touch vehicle/physics/camera/collision code. Positions AND sizes
// are derived from the real exported map geometry and the car's own real
// runtime footprint (see main.ts comments at the call site), never guessed.

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
  // first updateCheckpoints() call sets it, so the reveal starts from
  // whatever moment the scene actually begins animating rather than from a
  // guessed/hardcoded time.
  revealStart: number | null
}

// id -> 0/1/2, purely a shader-branch selector (see uVariant below). Not a
// new concept in the data model — the pad already carries its own `id`, this
// is just how that id reaches the fragment shader as a float uniform.
const VARIANT_INDEX: Record<CheckpointId, number> = { port: 0, platform: 1, city: 2 }

const REVEAL_DURATION = 1.35 // seconds — small, quick, not a long cutscene.

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Restrained glass pad: soft fill, brighter rounded-rect border band, a slow
// single scan line sweeping along the long axis, a gentle breathing opacity,
// a location-specific procedural pattern (uVariant), and a radial "iris"
// reveal mask (uReveal) that draws the whole pad in from its own center the
// first time it comes alive — all driven by uTime/uReveal. uActive blends
// the whole thing up when the car is inside the pad (handled in update()),
// so idle pads stay quiet.
const FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uActive;
  uniform float uReveal;
  uniform float uVariant;
  uniform vec3 uColor;

  float edgeBand(vec2 uv, float inset, float feather) {
    vec2 d = min(uv, 1.0 - uv);
    float m = min(d.x, d.y);
    return 1.0 - smoothstep(inset, inset + feather, m);
  }

  // Port: fine dock-grid lines -- industrial/maritime technical marking.
  float dockGrid(vec2 uv) {
    vec2 g = abs(fract(uv * vec2(7.0, 4.0)) - 0.5);
    float lx = smoothstep(0.045, 0.0, g.x);
    float ly = smoothstep(0.045, 0.0, g.y);
    return max(lx, ly);
  }

  // Platform: soft horizontal architectural light-plane bands, drifting very
  // slowly -- canopy/glass/concrete reflection language, not a hard grid.
  float architecturalBands(vec2 uv, float t) {
    float wave = sin((uv.y * 8.0) - t * 0.18);
    return smoothstep(0.65, 1.0, wave);
  }

  // City: a single longitudinal "lane" centerline with moving dashes plus
  // perpendicular wayfinding ticks near the long edges -- urban road language.
  float laneMarkings(vec2 uv, float t) {
    float center = smoothstep(0.035, 0.0, abs(uv.x - 0.5));
    float dash = step(0.5, fract(uv.y * 9.0 - t * 0.3));
    float nearEdge = smoothstep(0.38, 0.5, abs(uv.x - 0.5));
    float tick = smoothstep(0.08, 0.0, abs(fract(uv.y * 5.0) - 0.5)) * nearEdge;
    return max(center * dash, tick * 0.6);
  }

  void main() {
    vec2 uv = vUv;

    // Radial iris reveal: the pad draws itself in from its own center
    // outward, i.e. "originates from the floor" rather than popping in.
    float radius = length(uv - 0.5) * 1.42;
    float revealMask = 1.0 - smoothstep(uReveal - 0.10, uReveal, radius);

    float fill = 0.05 + 0.02 * sin(uTime * 0.6);
    float border = edgeBand(uv, 0.015, 0.02);

    float scan = smoothstep(0.0, 0.05, 0.5 - abs(fract(uTime * 0.09) - uv.x));
    scan *= 0.35;

    float breathe = 0.65 + 0.35 * sin(uTime * 0.8);

    float variantPattern;
    if (uVariant < 0.5) {
      variantPattern = dockGrid(uv) * 0.26;
    } else if (uVariant < 1.5) {
      variantPattern = architecturalBands(uv, uTime) * 0.16;
    } else {
      variantPattern = laneMarkings(uv, uTime) * 0.4;
    }

    float alpha = fill + border * (0.55 + 0.45 * breathe) + scan * 0.4 + variantPattern;
    alpha *= mix(0.55, 1.0, uActive);
    alpha *= revealMask;
    alpha = clamp(alpha, 0.0, 0.85);

    vec3 col = uColor * mix(0.7, 1.3, border) + scan * uColor * 0.6 + uColor * variantPattern * 0.9;
    col *= mix(0.8, 1.35, uActive);

    gl_FragColor = vec4(col, alpha);
  }
`

// Thin expanding ring that rides the same reveal progress as the pad's own
// iris mask -- the "thin illuminated floor perimeter" / "expanding
// translucent ring" reveal language, as a single cheap extra quad (no
// particles, no extra draw-call-heavy system).
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

function buildPadGroup(def: CheckpointDef): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(def.position)
  group.rotation.y = def.yaw

  const shape = roundedRectShape(def.width, def.depth, Math.min(def.width, def.depth) * 0.12)
  const geo = new THREE.ShapeGeometry(shape, 24)
  // ShapeGeometry is built in the XY plane with its own UVs already in
  // [0,1]-ish local shape space; lay it flat on the ground (rotate into XZ)
  // and lift it a hair above the floor to avoid z-fighting with the road/pad
  // mesh it sits on.
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
      uVariant: { value: VARIANT_INDEX[def.id] },
      uColor: { value: def.color.clone() }
    }
  })

  const pad = new THREE.Mesh(geo, mat)
  pad.position.y = 0.08
  pad.renderOrder = 5
  pad.name = `Checkpoint_${def.id}_Pad`
  group.add(pad)

  // Reveal ring: a flat circle circumscribing the pad, same floor-level
  // treatment, purely additive glow -- fades itself out once the reveal
  // completes (see RING_FRAGMENT_SHADER), so it costs nothing visually (and
  // negligibly on the GPU) once the one-shot animation is done.
  const ringRadius = Math.max(def.width, def.depth) * 0.62
  const ringGeo = new THREE.CircleGeometry(ringRadius, 48)
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: RING_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uReveal: { value: 0 },
      uColor: { value: def.color.clone() }
    }
  })
  ringGeo.rotateX(-Math.PI / 2)
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.position.y = 0.06
  ring.renderOrder = 4
  ring.name = `Checkpoint_${def.id}_Ring`
  group.add(ring)

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
    const promptEl = buildPromptEl(def.label)
    return { def, group, promptEl, active: false, revealStart: null }
  })
}

const _carXZ = new THREE.Vector2()
const _padXZ = new THREE.Vector2()
const _projected = new THREE.Vector3()

// Updates each pad's shader time/active/reveal uniforms, decides which (if
// any) checkpoint the car currently sits inside, and projects+positions that
// checkpoint's DOM prompt on screen. Returns the currently-active checkpoint
// (or null), for the caller to drive ENTER-key activation against.
export function updateCheckpoints(
  checkpoints: Checkpoint[],
  vehicle: Vehicle,
  camera: THREE.PerspectiveCamera,
  elapsedTime: number
): Checkpoint | null {
  _carXZ.set(vehicle.position.x, vehicle.position.z)
  let current: Checkpoint | null = null

  for (const cp of checkpoints) {
    if (cp.revealStart === null) cp.revealStart = elapsedTime
    const reveal = THREE.MathUtils.clamp((elapsedTime - cp.revealStart) / REVEAL_DURATION, 0, 1)
    const revealEased = 1 - Math.pow(1 - reveal, 3)

    const pad = cp.group.children[0] as THREE.Mesh
    const ring = cp.group.children[1] as THREE.Mesh | undefined
    const mat = pad.material as THREE.ShaderMaterial
    mat.uniforms.uTime.value = elapsedTime
    mat.uniforms.uReveal.value = revealEased
    if (ring) {
      const ringMat = ring.material as THREE.ShaderMaterial
      ringMat.uniforms.uReveal.value = revealEased
    }

    _padXZ.set(cp.def.position.x, cp.def.position.z)
    const dist = _carXZ.distanceTo(_padXZ)
    cp.active = dist <= cp.def.activationRadius
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

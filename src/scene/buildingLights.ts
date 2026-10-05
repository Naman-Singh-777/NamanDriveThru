import * as THREE from 'three'
import { sceneTime } from './glslCommon'

// City window lights that switch on and off over time.
// In the GLB every City_Building has its windows as separate 4-vertex quads, split into three
// shared materials: MAT_WINDOW_WARM (tungsten, emissive 3.4), MAT_WINDOW_COOL (cyan, emissive
// 2.39) and MAT_WINDOW_DARK (the unlit ones). Nothing here moves or changes geometry. Each quad
// gets a stable random seed in a per-vertex attribute, and the fragment shader drives its
// emission from a slow per-window timeline: every window waits 16..75 s, then re-rolls whether
// it is lit. Switching on stutters for a moment like a real fluorescent tube, switching off
// fades. Warm and cool windows are mostly lit, dark ones are lit now and then, so the overall
// number of lit windows stays about what the static scene had.

const P_ON: Record<string, number> = {
  MAT_WINDOW_WARM: 0.82,
  MAT_WINDOW_COOL: 0.84,
  MAT_WINDOW_DARK: 0.07
}

const WIN_GLSL = /* glsl */ `
uniform float uTime;
varying float vWin;
float bw_h(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float bw_state(float seed, float pOn) {
  float period = mix(16.0, 75.0, bw_h(seed * 91.7));
  float t = uTime / period + seed * 173.0;
  float slot = floor(t);
  float f = fract(t) * period;                   // seconds into this slot
  float on = step(bw_h(slot * 1.618 + seed * 57.3), pOn);
  float prev = step(bw_h((slot - 1.0) * 1.618 + seed * 57.3), pOn);
  float k = clamp(f / 0.8, 0.0, 1.0);
  float v = mix(prev, on, k);
  if (on > prev && k < 1.0) {                    // switching on: tube stutter
    v *= step(0.4, bw_h(floor(f * 16.0) + seed * 9.1 + slot));
  }
  return v;
}
`

function seedAttribute(mesh: THREE.Mesh): void {
  const geo = mesh.geometry
  if (geo.getAttribute('aWin')) return
  const pos = geo.getAttribute('position')
  const n = pos.count
  const a = new Float32Array(n)
  const p = new THREE.Vector3()
  const wp = new THREE.Vector3()
  mesh.getWorldPosition(wp)
  for (let q = 0; q < n; q += 4) {
    // every window is a 4-vertex quad: seed from its centre in world space
    let cx = 0
    let cy = 0
    let cz = 0
    const m = Math.min(4, n - q)
    for (let k = 0; k < m; k++) {
      p.fromBufferAttribute(pos, q + k)
      cx += p.x
      cy += p.y
      cz += p.z
    }
    cx = cx / m + wp.x
    cy = cy / m + wp.y
    cz = cz / m + wp.z
    const s = Math.sin(cx * 12.9898 + cy * 78.233 + cz * 37.719) * 43758.5453
    const seed = s - Math.floor(s)
    for (let k = 0; k < m; k++) a[q + k] = seed
  }
  geo.setAttribute('aWin', new THREE.BufferAttribute(a, 1))
}

function patch(mat: THREE.MeshStandardMaterial, pOn: number, dark: boolean): void {
  mat.customProgramCacheKey = () => `WINDOW_FLICKER_${dark ? 'DARK' : 'LIT'}_V1`
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWin;\nvarying float vWin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;')
    const emissive = dark
      ? `totalEmissiveRadiance = vec3(1.0, 0.62, 0.24) * 2.7 * bw_state(vWin, ${pOn.toFixed(3)}) * (0.8 + 0.4 * bw_h(vWin * 7.0));`
      : `totalEmissiveRadiance *= bw_state(vWin, ${pOn.toFixed(3)}) * (0.85 + 0.3 * bw_h(vWin * 7.0));`
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WIN_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`)
  }
  mat.needsUpdate = true
}

export function applyBuildingLights(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const done = new Set<THREE.Material>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    const p = P_ON[mat.name]
    if (p === undefined) return
    seedAttribute(mesh)
    if (!done.has(mat)) {
      done.add(mat)
      patch(mat, p, mat.name === 'MAT_WINDOW_DARK')
    }
  })
}

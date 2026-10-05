import * as THREE from 'three'
import { NOISE_GLSL } from './glslCommon'

// Blender procedural materials that glTF export flattens. Every one of these keeps its node
// graph in the .blend (Brick / Noise / Color Ramp, all on Blender's "Generated" coordinates,
// i.e. the object's own bounding box mapped to 0..1). The exporter wrote either a flat colour
// or nothing at all, so the web showed one flat tone (or the glTF default white) where
// Blender shows a dark base with gradients, patches and per-patch roughness. This rebuilds
// each graph in GLSL with the real values read from the file. No geometry is touched: the
// only addition is a per-vertex "Generated coordinates" attribute (a pure function of the
// mesh's own bounding box).

type Kind = 'concrete' | 'quay' | 'rust' | 'bronze' | 'pillar' | 'wetpad' | 'facade'

const KIND_BY_MATERIAL: Record<string, Kind> = {
  MAT_CONCRETE: 'concrete',
  MAT_CONCRETE_PORT_QUAY: 'quay',
  MAT_PLATFORM_RUSTED_STEEL: 'rust',
  MAT_PLATFORM_TARNISHED_BRONZE: 'bronze',
  MAT_PLATFORM_CONCRETE_PILLAR: 'pillar',
  MAT_PLATFORM_WET_CONCRETE: 'wetpad',
  MAT_GLASS: 'facade'
}

// Flat fallback colours (the average of each graph) in case a shader ever fails to compile.
const FALLBACK: Record<Kind, [number, number, number, number]> = {
  concrete: [0.05, 0.05, 0.055, 0.42],
  quay: [0.08, 0.09, 0.1, 0.35],
  rust: [0.18, 0.105, 0.075, 0.45],
  bronze: [0.22, 0.15, 0.075, 0.45],
  pillar: [0.13, 0.13, 0.13, 0.75],
  wetpad: [0.11, 0.108, 0.103, 0.3],
  facade: [0.075, 0.085, 0.104, 0.25]
}

const GLSL = /* glsl */ `
${NOISE_GLSL}
// Cycles Brick Texture, first brick only matters for the huge-scale concrete nodes.
// returns mortar amount 0..1 and writes the brick tint
float pm_mortar(vec3 g, float scale, float msize, float msmooth, float bw, float rh, float offs) {
  vec2 p = g.xy * scale;
  float rownum = floor(p.y / rh);
  float offset = (mod(rownum, 2.0) < 0.5) ? bw * offs : 0.0;
  float bricknum = floor((p.x + offset) / bw);
  float x = (p.x + offset) - bw * bricknum;
  float y = p.y - rh * rownum;
  float d = min(min(x, bw - x), min(y, rh - y));
  if (d >= msize) return 0.0;
  float t = clamp((1.0 - d / msize) / msmooth, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
void pm_surface(int kind, vec3 g, out vec3 col, out float rough) {
  if (kind == 0) {            // MAT_CONCRETE: brick (scale 0.05) + wet-patch roughness ramp
    float m = pm_mortar(g, 0.05, 0.01, 0.1, 0.5, 0.25, 0.5);
    col = mix(vec3(0.0925, 0.0925, 0.0975), vec3(0.02, 0.02, 0.022), m);
    float n = bn_fbm(g * 3.5, 3, 0.5);
    rough = mix(0.22, 0.60, n);
  } else if (kind == 1) {     // MAT_CONCRETE_PORT_QUAY: brick x stain, glossy wet patches
    float m = pm_mortar(g, 0.05, 0.01, 0.1, 0.5, 0.25, 0.5);
    vec3 brick = mix(vec3(0.107, 0.122, 0.135), vec3(0.02, 0.02, 0.022), m);
    float s = mix(0.55, 1.0, bn_ramp(bn_fbm(g * 1.1, 4, 0.65), 0.35, 0.6));
    col = mix(brick, brick * s, 0.7);
    rough = mix(0.065, 0.60, bn_fbm(g * 3.5, 3, 0.5));
  } else if (kind == 2) {     // MAT_PLATFORM_RUSTED_STEEL
    col = mix(vec3(0.08, 0.08, 0.09), vec3(0.28, 0.13, 0.06), bn_fbm(g * 6.0, 3, 0.5));
    rough = 0.45;
  } else if (kind == 3) {     // MAT_PLATFORM_TARNISHED_BRONZE
    col = mix(vec3(0.10, 0.08, 0.05), vec3(0.35, 0.22, 0.10), bn_fbm(g * 12.0, 3, 0.5));
    rough = 0.45;
  } else if (kind == 4) {     // MAT_PLATFORM_CONCRETE_PILLAR
    vec3 c1 = mix(vec3(0.13, 0.13, 0.135), vec3(0.22, 0.215, 0.20), bn_fbm(g * 8.0, 3, 0.5));
    float k = bn_ramp(bn_fbm(g * 2.5, 3, 0.5), 0.55, 0.75);
    col = mix(c1, c1 * k, 0.5);
    rough = 0.75;
  } else if (kind == 5) {     // MAT_PLATFORM_WET_CONCRETE: dry/wet patches, mirror-like puddles
    float n1 = bn_fbm(g * 3.5, 6, 0.55);
    vec3 c1 = mix(vec3(0.085, 0.083, 0.08), vec3(0.135, 0.132, 0.126), bn_ramp(n1, 0.35, 0.65));
    col = mix(c1, c1 * bn_fbm(g * 40.0, 4, 0.5), 0.15);
    rough = mix(0.62, 0.02, bn_ramp(bn_fbm(g * 1.3, 4, 0.5), 0.45, 0.55));
  } else {                    // MAT_GLASS (building facade): small brick pattern, no emission
    float m = pm_mortar(g, 4.0, 0.06, 0.1, 0.5, 0.25, 0.5);
    col = mix(vec3(0.08, 0.09, 0.11), vec3(0.045, 0.05, 0.06), m);
    rough = 0.25;
  }
}
`

const KIND_INDEX: Record<Kind, number> = { concrete: 0, quay: 1, rust: 2, bronze: 3, pillar: 4, wetpad: 5, facade: 6 }

// Blender's Generated coordinates cover the whole object, not just one material's faces.
// glTF splits a Blender object into one Mesh per material under a shared Group, so the box is
// the union of all primitive meshes of that Group.
const boundsCache = new WeakMap<THREE.Object3D, THREE.Box3>()
let sceneRoot: THREE.Object3D | null = null
function objectBounds(mesh: THREE.Mesh): THREE.Box3 {
  const parent = mesh.parent
  // the loaded scene root is also a Group, but it is not a Blender object
  const owner: THREE.Object3D = parent && parent !== sceneRoot && parent.type === 'Group' ? parent : mesh
  const cached = boundsCache.get(owner)
  if (cached) return cached
  const box = new THREE.Box3()
  const add = (m: THREE.Mesh): void => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    box.union(m.geometry.boundingBox as THREE.Box3)
  }
  if (owner === mesh) {
    add(mesh)
  } else {
    let used = false
    for (const c of owner.children) {
      const m = c as THREE.Mesh
      const identity = m.position.lengthSq() === 0 && m.scale.x === 1 && m.scale.y === 1 && m.scale.z === 1 && m.quaternion.w === 1
      if (m.isMesh && identity) {
        add(m)
        used = true
      }
    }
    if (!used) add(mesh)
  }
  boundsCache.set(owner, box)
  return box
}

function addGeneratedAttribute(mesh: THREE.Mesh): void {
  const geo = mesh.geometry
  if (geo.getAttribute('aGen')) return
  const pos = geo.getAttribute('position')
  const b = objectBounds(mesh)
  const sx = b.max.x - b.min.x || 1
  const sy = b.max.y - b.min.y || 1
  const sz = b.max.z - b.min.z || 1
  const a = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    // glTF (x, y, z) = Blender (x, z, -y), so Blender-order generated coords are:
    a[i * 3] = (pos.getX(i) - b.min.x) / sx
    a[i * 3 + 1] = (b.max.z - pos.getZ(i)) / sz
    a[i * 3 + 2] = (pos.getY(i) - b.min.y) / sy
  }
  geo.setAttribute('aGen', new THREE.BufferAttribute(a, 3))
}

function patch(mat: THREE.MeshStandardMaterial, kind: Kind): void {
  const fb = FALLBACK[kind]
  mat.color.setRGB(fb[0], fb[1], fb[2])
  mat.roughness = fb[3]
  mat.customProgramCacheKey = () => `PROC_${kind}_V1`
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGen;\nvarying vec3 vGen;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGen = aGen;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGen;\n${GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 pmCol; float pmRough;
        pm_surface(${KIND_INDEX[kind]}, vGen, pmCol, pmRough);
        diffuseColor.rgb = pmCol;`
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = pmRough;`)
  }
  mat.needsUpdate = true
}

export function applyProceduralMaterials(root: THREE.Object3D): void {
  sceneRoot = root
  root.updateMatrixWorld(true)
  const done = new Set<THREE.Material>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    const kind = KIND_BY_MATERIAL[mat.name]
    if (!kind) return
    addGeneratedAttribute(mesh)
    if (!done.has(mat)) {
      done.add(mat)
      patch(mat, kind)
    }
  })
}

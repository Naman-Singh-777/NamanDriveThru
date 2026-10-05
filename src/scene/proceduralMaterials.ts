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

// ---- concrete surface detail (world space, so the grain has the same size on every object) ----
varying vec3 vPmW;
float pm_vis(float size, float fp) { return smoothstep(7.0, 18.0, size / max(fp, 1e-4)); }
float pm_dl(float x, float s) { float a = mod(x, s); return min(a, s - a); }
// hm: relief in metres, mul: albedo multiplier (mean about 1), rm: roughness multiplier
void pm_concrete(vec3 w, vec3 wn, float fp, out float hm, out float mul, out float rm) {
  float up = abs(wn.y);
  float m1 = bn_fbm(w / 11.0, 3, 0.5);          // big pours: lighter and darker clouds
  float m2 = bn_vnoise(w / 2.6 + 4.0);
  float m3 = bn_vnoise(w / 0.9 + 8.0);
  float v2 = pm_vis(2.6, fp);
  float v3 = pm_vis(0.9, fp);
  float pit = smoothstep(0.80, 0.92, bn_vnoise(w / 0.38 + 2.0)) * pm_vis(0.38, fp);   // air-bubble pits
  float grain = (bn_vnoise(w / 0.13 + 6.0) - 0.5) * pm_vis(0.13, fp);               // aggregate
  // formwork joints: panels on walls, expansion joints on floors
  vec2 dir = vec2(-wn.z, wn.x);
  float t = dot(w.xz, dir / max(length(dir), 1e-3));
  float jd = up < 0.6 ? min(pm_dl(w.y, 3.4), pm_dl(t, 5.6)) : min(pm_dl(w.x, 7.5), pm_dl(w.z, 7.5));
  float gw = max(0.045, fp * 1.1);
  float groove = (1.0 - smoothstep(gw * 0.4, gw, jd)) * smoothstep(5.0, 12.0, 3.4 / max(fp, 1e-4));
  // rain streaks running down walls
  float streak = up < 0.6 ? smoothstep(0.58, 0.85, bn_vnoise(vec3(t / 1.4, w.y / 16.0, 3.0))) * pm_vis(1.4, fp) : 0.0;
  hm = -groove * 0.05 - pit * 0.03 + grain * 0.015 + (m3 - 0.5) * 0.02 * v3;
  mul = (1.0 + (m1 - 0.5) * 0.55 + (m2 - 0.5) * 0.3 * v2 + (m3 - 0.5) * 0.22 * v3 + grain * 0.35 - pit * 0.45 - groove * 0.4 - streak * 0.22) * 1.05;
  rm = 1.0 + (m2 - 0.5) * 0.4 + pit * 0.3 + streak * 0.1;
}
vec3 pm_bump(vec3 N, vec3 viewPos, float H, float strength, float faceDir) {
  vec3 sx = dFdx(viewPos);
  vec3 sy = dFdy(viewPos);
  vec3 r1 = cross(sy, N);
  vec3 r2 = cross(N, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
  return normalize(abs(det) * N - strength * grad);
}
`

const CONCRETE_KINDS = new Set<Kind>(['concrete', 'quay', 'pillar', 'wetpad'])

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
  mat.customProgramCacheKey = () => `PROC_${kind}_V2`
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGen;\nvarying vec3 vGen;\nvarying vec3 vPmW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGen = aGen;\nvPmW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGen;\n${GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 pmCol; float pmRough;
        pm_surface(${KIND_INDEX[kind]}, vGen, pmCol, pmRough);
        diffuseColor.rgb = pmCol;
        float pmHm = 0.0;
        float pmRM = 1.0;
        ${CONCRETE_KINDS.has(kind) ? `{
          float pmMul;
          float pmFp = max(length(dFdx(vPmW)), length(dFdy(vPmW)));
          pm_concrete(vPmW, normalize(inverseTransformDirection(normalize(vNormal), viewMatrix)), pmFp, pmHm, pmMul, pmRM);
          diffuseColor.rgb *= clamp(pmMul, 0.4, 1.6);
        }` : ''}`
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = pmRough * clamp(pmRM, 0.5, 1.5);`)
      .replace('#include <emissivemap_fragment>', `${CONCRETE_KINDS.has(kind) ? 'normal = pm_bump(normal, -vViewPosition, pmHm, 6.0, faceDirection);\n        ' : ''}#include <emissivemap_fragment>`)
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

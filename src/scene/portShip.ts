import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { NOISE_GLSL } from './glslCommon'

// Cargo ship berth. Runs once at load on the parsed graph (the exported GLB and the
// Blender source are never written to, same pattern as the other load-time fixes).
//
// The ship keeps its exact geometry; it is scaled x4 about its own keel / quay-side
// edge and moved out of the old slip onto open water along the quay front, so it
// reads from the car on the upper apron. The slip between the two quay arms is
// filled so the lower quay becomes one straight wharf, and the wharf gets what a
// berth needs at that size: fenders, bollards, mooring lines and two end dolphins.
// Everything added is new geometry under "Berth_" names (no name here matches a
// collider or camera-obstacle pattern, and nothing existing is edited except the
// four old mooring lines, which are hidden because their target moved).

const SCALE = 4
const CENTER_X = -750 // ship centre along the quay (quay spans -875..-625)
const KEEL_Y = -5
const SOUTH_Z = -225.5 // hull side that faces the quay
const DECK_Y = 10.44 // lower quay deck top
const FRONT_Z = -218 // quay front edge

// ---------------------------------------------------------------- shader pieces

const BS_GLSL = /* glsl */ `
float bsFade(float period, vec3 p) {
  float fw = max(length(dFdx(p)), length(dFdy(p)));
  return 1.0 - smoothstep(0.25, 0.9, fw / period);
}
vec3 bsPlates(vec3 base, vec3 p, vec3 n, vec2 cell, float hy, float rustAmt, out float rough) {
  vec2 uv = abs(n.x) > 0.6 ? vec2(p.z, p.y) : vec2(p.x, p.y);
  float row = floor(uv.y / cell.y);
  float u = uv.x / cell.x + 0.5 * mod(row, 2.0);
  vec2 id = vec2(floor(u), row);
  vec2 f = vec2(fract(u), fract(uv.y / cell.y));
  float dx = min(f.x, 1.0 - f.x) * cell.x;
  float dy = min(f.y, 1.0 - f.y) * cell.y;
  float seam = 1.0 - smoothstep(0.02, 0.07, min(dx, dy));
  float tone = 0.9 + 0.16 * bn_hash12(id + 5.3);
  vec3 c = base * tone;
  float w = bn_fbm(p * vec3(0.22, 0.5, 0.22), 3, 0.55);
  c *= 0.88 + 0.24 * w;
  float rc = uv.x * 1.6;
  float rcol = floor(rc);
  float rf = fract(rc);
  float streak = step(0.78, bn_hash12(vec2(rcol, 11.0))) * smoothstep(0.08, 0.25, rf) * (1.0 - smoothstep(0.75, 0.92, rf));
  float rust = streak * (0.5 + 0.5 * bn_hash12(vec2(rcol, 3.3))) * smoothstep(0.3, 1.0, hy) * rustAmt;
  c = mix(c, vec3(0.20, 0.10, 0.06), rust);
  float grime = 1.0 - smoothstep(0.22, 0.45, hy);
  c = mix(c, vec3(0.05, 0.07, 0.06), grime * 0.7);
  c = mix(c, c * 0.45, seam * bsFade(2.0, p) * 0.8);
  rough = mix(0.5, 0.78, w);
  rough = mix(rough, 0.3, grime * 0.6);
  return c;
}
vec3 bsDeck(vec3 p, out float rough) {
  float pw = 0.5;
  float row = floor(p.z / pw);
  float rh = bn_hash12(vec2(row, 3.7));
  float bx = p.x / 5.5 + rh * 7.0;
  float bh = bn_hash12(vec2(row, floor(bx)));
  vec2 f = vec2(fract(bx), fract(p.z / pw));
  float sx = min(f.x, 1.0 - f.x) * 5.5;
  float sz = min(f.y, 1.0 - f.y) * pw;
  float seam = 1.0 - smoothstep(0.012, 0.045, min(sx, sz));
  float g = bn_vnoise(vec3(p.x * 0.9, p.z * 9.0, bh * 20.0));
  vec3 teak = mix(vec3(0.20, 0.145, 0.095), vec3(0.34, 0.25, 0.165), g);
  teak *= 0.82 + 0.3 * bh;
  teak = mix(teak, vec3(0.30, 0.29, 0.27), 0.25 * bn_fbm(p * 0.6, 3, 0.5));
  teak = mix(teak, teak * 0.35, seam);
  rough = 0.82;
  return mix(vec3(0.2, 0.155, 0.106), teak, bsFade(pw, p));
}
vec3 bs_hull(vec3 base, vec3 p, vec3 n, out float rough) {
  float hy = clamp((p.y - uBsA.x) / (uBsA.y - uBsA.x), 0.0, 1.0);
  if (n.y > 0.7) return bsDeck(p, rough);
  return bsPlates(base, p, n, vec2(8.0, 2.4), hy, 0.45, rough);
}
vec3 bs_tower(vec3 base, vec3 p, vec3 n, out float rough) {
  float hy = clamp((p.y - uBsA.x) / (uBsA.y - uBsA.x), 0.0, 1.0);
  if (n.y > 0.7) {
    float s = bn_fbm(p * 3.0, 3, 0.5);
    rough = 0.85;
    return base * (0.62 + 0.3 * s);
  }
  return bsPlates(base, p, n, vec2(3.2, 1.3), max(hy, 0.5), 0.3, rough);
}
vec3 bs_boot(vec3 base, vec3 p, vec3 n, out float rough) {
  float hy = clamp((p.y - uBsA.x) / (uBsA.y - uBsA.x), 0.0, 1.0);
  float w = bn_fbm(p * vec3(0.5, 1.2, 0.5), 3, 0.55);
  vec3 c = base * (0.8 + 0.5 * w);
  c = mix(c, vec3(0.03, 0.05, 0.04), smoothstep(0.2, 0.28, hy) * 0.6);
  rough = 0.62;
  return c;
}
vec3 bs_cargo(vec3 base, vec3 p, vec3 n, out float rough) {
  vec3 c = uBsTint;
  float side = step(abs(n.y), 0.7);
  float ridge = 0.5 + 0.5 * sin((abs(n.x) > 0.6 ? p.z : p.x) * 22.0);
  c *= mix(1.0, 0.82 + 0.18 * ridge, side * bsFade(0.28, p));
  c *= 0.85 + 0.3 * bn_fbm(p * vec3(1.2, 2.0, 1.2), 3, 0.5);
  c = mix(c, vec3(0.28, 0.14, 0.08), smoothstep(0.65, 0.9, bn_vnoise(p * vec3(1.5, 0.4, 1.5))) * 0.4);
  rough = 0.6;
  return c;
}
vec3 bs_timber(vec3 base, vec3 p, vec3 n, out float rough) {
  float g = bn_fbm(vec3(p.x * 3.0, p.y * 0.35, p.z * 3.0), 3, 0.5);
  vec3 c = mix(vec3(0.10, 0.07, 0.042), vec3(0.2, 0.14, 0.085), g);
  float tide = 1.0 - smoothstep(-1.0, 4.5, p.y);
  c = mix(c, vec3(0.06, 0.09, 0.06), tide * 0.75);
  rough = mix(0.9, 0.55, tide * 0.5);
  return c;
}
`

type ShipKind = 'hull' | 'tower' | 'boot' | 'cargo' | 'timber'

function patchMaterial(
  mat: THREE.MeshStandardMaterial,
  kind: ShipKind,
  yMin: number,
  yMax: number,
  tint: THREE.Color,
  center: THREE.Vector3
): void {
  mat.customProgramCacheKey = () => `BERTH_${kind}_V1`
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBsA = { value: new THREE.Vector4(yMin - center.y, yMax - center.y, 0, 0) }
    shader.uniforms.uBsC = { value: center.clone() }
    shader.uniforms.uBsTint = { value: new THREE.Vector3(tint.r, tint.g, tint.b) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBsP;\nvarying vec3 vBsN;\nuniform vec3 uBsC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBsP = position - uBsC;\nvBsN = normalize(objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vBsP;\nvarying vec3 vBsN;\nuniform vec4 uBsA;\nuniform vec3 uBsTint;\n${NOISE_GLSL}\n${BS_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\nfloat bsR = 0.6;\ndiffuseColor.rgb = bs_${kind}(diffuseColor.rgb, vBsP, normalize(vBsN), bsR);`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bsR;')
  }
  mat.needsUpdate = true
}
// ---------------------------------------------------------------- geometry helpers

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return g
}

function cyl(cx: number, cz: number, y0: number, y1: number, r0: number, r1 = r0, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, false)
  g.translate(cx, (y0 + y1) / 2, cz)
  return g
}

// The quay material reads Blender "Generated" coordinates (aGen). To make new concrete
// continue the existing pattern, fit the quay mesh's own local->aGen mapping per axis and
// evaluate it for the new vertices' positions.
function quayGen(quay: THREE.Mesh): ((g: THREE.BufferGeometry) => void) | null {
  const pos = quay.geometry.getAttribute('position')
  const gen = quay.geometry.getAttribute('aGen')
  if (!gen) return null
  const fit = (pc: number, gc: number): [number, number] => {
    let lo = 0
    let hi = 0
    for (let i = 1; i < pos.count; i++) {
      const v = pos.array[i * 3 + pc]
      if (v < pos.array[lo * 3 + pc]) lo = i
      if (v > pos.array[hi * 3 + pc]) hi = i
    }
    const v0 = pos.array[lo * 3 + pc]
    const v1 = pos.array[hi * 3 + pc]
    const g0 = gen.array[lo * 3 + gc]
    const g1 = gen.array[hi * 3 + gc]
    const k = v1 !== v0 ? (g1 - g0) / (v1 - v0) : 0
    return [k, g0 - k * v0]
  }
  const fx = fit(0, 0) // gen.x <- local x
  const fy = fit(2, 1) // gen.y <- local z
  const fz = fit(1, 2) // gen.z <- local y
  const inv = new THREE.Matrix4().copy(quay.matrixWorld).invert()
  const v = new THREE.Vector3()
  return (g) => {
    const p = g.getAttribute('position')
    const a = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(inv)
      a[i * 3] = fx[0] * v.x + fx[1]
      a[i * 3 + 1] = fy[0] * v.z + fy[1]
      a[i * 3 + 2] = fz[0] * v.y + fz[1]
    }
    g.setAttribute('aGen', new THREE.BufferAttribute(a, 3))
  }
}

function addMesh(parent: THREE.Object3D, name: string, geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh | null {
  if (!geos.length) return null
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!geo) return null
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}
// ---------------------------------------------------------------- main

export function applyPortShip(root: THREE.Object3D): void {
  const ship = root.getObjectByName('Cargo_Ship')
  const hull = root.getObjectByName('Cargo_Ship_Hull_Mesh') as THREE.Mesh | undefined
  const quay = root.getObjectByName('Port_QuayExtension') as THREE.Mesh | undefined
  if (!ship || !hull || !quay) return
  root.updateMatrixWorld(true)

  // 1. scale and move the ship, geometry untouched
  const hb = new THREE.Box3().setFromObject(hull)
  const pivot = new THREE.Vector3((hb.min.x + hb.max.x) / 2, hb.min.y, hb.max.z)
  const rig = new THREE.Group()
  rig.name = 'Berth_ShipRig'
  root.add(rig)
  rig.updateMatrixWorld(true)
  rig.attach(ship)
  rig.scale.setScalar(SCALE)
  rig.position.set(CENTER_X - pivot.x * SCALE, KEEL_Y - pivot.y * SCALE, SOUTH_Z - pivot.z * SCALE)
  rig.updateMatrixWorld(true)

  // the old lines ran to the old berth
  for (let i = 0; i < 4; i++) {
    const o = root.getObjectByName(`Port_MooringLine_${i}`)
    if (o) o.visible = false
  }

  // 2. steel / wood / paint on the ship
  hull.geometry.computeBoundingBox()
  const yMin = (hull.geometry.boundingBox as THREE.Box3).min.y
  const yMax = (hull.geometry.boundingBox as THREE.Box3).max.y
  const none = new THREE.Color(1, 1, 1)
  // noise coordinates are taken relative to the hull's local centre; raw local positions are in the hundreds and break the hash noise
  const center = (hull.geometry.boundingBox as THREE.Box3).getCenter(new THREE.Vector3())
  const make = (src: THREE.MeshStandardMaterial, kind: ShipKind, tint = none, metal?: number): THREE.MeshStandardMaterial => {
    const m = src.clone()
    m.name = `${src.name}_BERTH`
    if (metal !== undefined) m.metalness = metal
    patchMaterial(m, kind, yMin, yMax, tint, center)
    return m
  }
  const palette = [0x8a3128, 0x2c4f7c, 0x2f6b5a, 0xb07a2a, 0x6b6f75, 0x7a2c3b, 0x35527a, 0x8a5a2a]
  let hullMat: THREE.MeshStandardMaterial | null = null
  let towerMat: THREE.MeshStandardMaterial | null = null
  let bootMat: THREE.MeshStandardMaterial | null = null
  let ci = 0
  ship.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material)) return
    const src = m.material as THREE.MeshStandardMaterial
    if (src.name === 'MAT_SHIP_HULL_PORT') {
      if (m === hull) m.material = hullMat ?? (hullMat = make(src, 'hull', none, 0.3))
      else m.material = towerMat ?? (towerMat = make(src, 'tower', none, 0.25))
    } else if (src.name === 'MAT_SHIP_BOOTTOP_PORT') {
      m.material = bootMat ?? (bootMat = make(src, 'boot'))
    } else if (src.name === 'MAT_CARGO_CONTAINER_PORT' && /^Ship_HoldCargo/.test(m.name)) {
      m.material = make(src, 'cargo', new THREE.Color(palette[ci++ % palette.length]))
    }
  })

  // 3. the berth itself
  const works = new THREE.Group()
  works.name = 'Berth_Works'
  root.add(works)

  const steel = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6, metalness: 0.6 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.95, metalness: 0 })
  const rope = new THREE.MeshStandardMaterial({ color: 0x7a6a4d, roughness: 1, metalness: 0 })
  const timber = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9, metalness: 0 })
  patchMaterial(timber, 'timber', 0, 1, none, new THREE.Vector3(-750, 0, -250))

  // concrete: the existing quay material, same pattern continued
  const quayMat = quay.material as THREE.Material
  const gen = quayGen(quay)
  const concrete: THREE.BufferGeometry[] = []
  const conc = (g: THREE.BufferGeometry): void => {
    if (gen) gen(g)
    concrete.push(g)
  }

  // slip fill: lower quay becomes one straight wharf (slip is x -800..-680, z -218..-172)
  conc(box(-800.5, -679.5, 9.9, DECK_Y - 0.04, FRONT_Z, -171.5))
  // seawall face along the whole front, down into the water
  conc(box(-875, -625, -3.5, 10.3, FRONT_Z - 0.15, FRONT_Z + 1.4))

  // pneumatic fenders floating between the wall and the hull. The quay edge has rocks and a
  // railing, so fenders are only placed where they clear every rock footprint.
  const FR = 3.4
  const rocks: THREE.Box3[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !/^PortEdge_Rock_/.test(m.name)) return
    const rb = new THREE.Box3().setFromObject(m)
    if (rb.max.z > -230 && rb.min.z < -214 && rb.max.y > -6 && rb.min.y < 12) rocks.push(rb)
  })
  const clearOfRocks = (x: number): boolean => rocks.every((rb) => x + FR + 0.8 < rb.min.x || x - FR - 0.8 > rb.max.x)
  const gridX: number[] = []
  for (let x = -862; x <= -630; x += 25) gridX.push(x)
  const rubberG: THREE.BufferGeometry[] = []
  const steelG: THREE.BufferGeometry[] = []
  for (const x of gridX.filter(clearOfRocks)) {
    const f = new THREE.CapsuleGeometry(FR, 6, 4, 14)
    f.translate(x, 3, FRONT_Z - 0.15 - FR)
    rubberG.push(f)
  }
  // bollards between the fenders
  const bollardX = gridX.slice(0, -1).map((x) => x + 12.5)
  for (const x of bollardX) {
    steelG.push(cyl(x, -213, DECK_Y, DECK_Y + 0.3, 1.2, 1.2, 14))
    steelG.push(cyl(x, -213, DECK_Y + 0.3, DECK_Y + 1.6, 0.75, 0.75, 14))
    steelG.push(cyl(x, -213, DECK_Y + 1.6, DECK_Y + 2.1, 1.05, 0.9, 14))
  }

  // end dolphins (timber piles under a concrete cap) just beyond the hull ends
  const hullBox = new THREE.Box3().setFromObject(hull)
  const axisZ = (hullBox.min.z + hullBox.max.z) / 2
  const dolphinX = [hullBox.min.x - 12, hullBox.max.x + 12]
  const timberG: THREE.BufferGeometry[] = []
  const dolphinTop: THREE.Vector3[] = []
  for (const dx of dolphinX) {
    timberG.push(cyl(dx, axisZ, -14, 11.6, 0.9))
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      timberG.push(cyl(dx + Math.cos(a) * 2.6, axisZ + Math.sin(a) * 2.6, -14, 11.6, 0.8))
    }
    conc(cyl(dx, axisZ, 11.3, 12.6, 4, 4, 20))
    for (const off of [-1.6, 1.6]) {
      steelG.push(cyl(dx + off, axisZ, 12.6, 13.2, 0.9, 0.9, 12))
      steelG.push(cyl(dx + off, axisZ, 13.2, 14.6, 0.6, 0.6, 12))
      steelG.push(cyl(dx + off, axisZ, 14.6, 15.1, 0.85, 0.75, 12))
    }
    dolphinTop.push(new THREE.Vector3(dx, 15.1, axisZ))
  }

  // mooring lines: ray from a bollard (or dolphin) to the hull, the line ends on the hull surface
  const ray = new THREE.Raycaster()
  const ropeG: THREE.BufferGeometry[] = []
  const line = (from: THREE.Vector3, aim: THREE.Vector3, ok?: (pts: THREE.Vector3[]) => boolean): void => {
    const dir = aim.clone().sub(from).normalize()
    ray.set(from, dir)
    const hit = ray.intersectObject(ship, true)[0]
    if (!hit) return
    const end = hit.point.clone().addScaledVector(dir, 0.15)
    const mid = from.clone().lerp(end, 0.5)
    mid.y -= Math.min(2.2, from.distanceTo(end) * 0.07)
    const curve = new THREE.CatmullRomCurve3([from, mid, end])
    if (ok && !ok(curve.getPoints(60))) return
    ropeG.push(new THREE.TubeGeometry(curve, 14, 0.2, 5, false))
  }
  const top = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, DECK_Y + 2.15, z)
  const fairY = 26
  // the lower quay has a railing at both ends of its front edge; lines are only run through the open stretch
  const rails: THREE.Box3[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !/^PortRail_/.test(m.name)) return
    const rb = new THREE.Box3().setFromObject(m)
    if (rb.min.z < -200 && rb.max.y < 30 && rb.max.y > 10) rails.push(rb.expandByScalar(0.4))
  })
  const clearOfRails = (pts: THREE.Vector3[]): boolean => pts.every((q) => rails.every((rb) => !rb.containsPoint(q)))
  const aimAt = (x: number): THREE.Vector3 => new THREE.Vector3(x, fairY, axisZ)
  line(top(-774.5, -213), aimAt(-770.5), clearOfRails) // breast
  line(top(-724.5, -213), aimAt(-728.5), clearOfRails) // breast
  line(top(-799.5, -213), aimAt(-689.5), clearOfRails) // spring, leads forward
  line(top(-699.5, -213), aimAt(-809.5), clearOfRails) // spring, leads aft
  line(dolphinTop[0].clone().setY(14.6), aimAt(hullBox.min.x + 8)) // stern line
  line(dolphinTop[1].clone().setY(14.6), aimAt(hullBox.max.x - 8)) // head line

  addMesh(works, 'Berth_Concrete', concrete, quayMat)
  addMesh(works, 'Berth_Fenders', rubberG, rubber)
  addMesh(works, 'Berth_Steel', steelG, steel)
  addMesh(works, 'Berth_Timber', timberG, timber)
  addMesh(works, 'Berth_Lines', ropeG, rope)

  // 4. running lights (emissive only, no extra light sources)
  const lightAt = (name: string, p: THREE.Vector3, color: number): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({ color }))
    m.name = name
    m.position.copy(p)
    works.add(m)
  }
  const bb = (n: string): THREE.Box3 => new THREE.Box3().setFromObject(root.getObjectByName(n) as THREE.Object3D)
  const bridge = bb('Ship_Superstructure_Bridge')
  const mast = bb('Ship_Mast_Cruciform_Vert')
  const fore = bb('Ship_Foremast_Tpost')
  const bc = bridge.getCenter(new THREE.Vector3())

  // the exported mast bars have no vertical member under them, which is invisible at 1x but floats at 4x
  const mastG: THREE.BufferGeometry[] = []
  const down = new THREE.Raycaster()
  for (const n of ['Ship_Foremast_Post', 'Ship_Foremast_Tpost', 'Ship_Mast_Cruciform_Vert']) {
    const b = bb(n)
    const cx = (b.min.x + b.max.x) / 2
    const cz = (b.min.z + b.max.z) / 2
    down.set(new THREE.Vector3(cx, b.min.y - 0.6, cz), new THREE.Vector3(0, -1, 0))
    const hit = down.intersectObject(ship, true)[0]
    if (!hit) continue
    const r = n === 'Ship_Mast_Cruciform_Vert' ? 0.35 : 0.55
    mastG.push(cyl(cx, cz, hit.point.y - 0.2, b.min.y + 0.4, r, r * 0.8, 10))
  }
  addMesh(works, 'Berth_Masts', mastG, steel)
  lightAt('Berth_LampMast', new THREE.Vector3((mast.min.x + mast.max.x) / 2, mast.max.y + 0.8, (mast.min.z + mast.max.z) / 2), 0xfff1d0)
  lightAt('Berth_LampFore', new THREE.Vector3((fore.min.x + fore.max.x) / 2, fore.max.y + 0.8, (fore.min.z + fore.max.z) / 2), 0xfff1d0)
  lightAt('Berth_LampStbd', new THREE.Vector3(bc.x, bridge.min.y + 1.2, bridge.max.z + 0.6), 0x33ff66)
  lightAt('Berth_LampPort', new THREE.Vector3(bc.x, bridge.min.y + 1.2, bridge.min.z - 0.6), 0xff3322)
  for (const t of dolphinTop) lightAt('Berth_LampDolphin', t.clone().setY(15.6), 0xff5a3c)

  root.updateMatrixWorld(true)
}
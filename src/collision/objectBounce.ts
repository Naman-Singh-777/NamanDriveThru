import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

// Gives the solid scenery the same soft bounce-back the railings and road-edge walls have.
//
// staticColliders.ts (which is locked) builds one fixed trimesh collider per blocking mesh and gives
// it no restitution, so the car stops dead against lampposts, buildings and the platform structure,
// while railings and road walls nudge it back. Rather than touch that file, this runs right after it:
// for every scenery mesh it finds the collider that was built from exactly that mesh's triangles
// (same vertex count, same first and last vertex) and sets the same restitution and combine rule
// the railings use. Ground, terrain, cliffs, ocean and roads are not in the list, so driving and
// landing are unchanged.

const OBJECT_RE =
  /(city_building|city_tower|city_industrial_mass|citydetail_|port_crane|cargo_ship|ship_|container_group|portdetail_|roaddetail_barrier|platformdetail_pylon|platform_fascia|platform_canopy|platform_pillar|platform_monument|streetlight)/i
// roles staticColliders.ts gives to something else (vehicle, drivable ground, railings)
const SKIP_RE = /^(vehicle_|road_|intersection|openplatform_pad|port_dock|port_structure|port_quayextension|port_quaypilings|roaddetail_strip)|(railing|portrail_|cityrail_)/i
const OBJECT_RESTITUTION = 0.4 // same as RAILING_RESTITUTION / WALL_RESTITUTION

const keyOf = (n: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): string =>
  `${n}|${ax.toFixed(2)},${ay.toFixed(2)},${az.toFixed(2)}|${bx.toFixed(2)},${by.toFixed(2)},${bz.toFixed(2)}`

export function applyObjectBounce(root: THREE.Object3D, world: RAPIER.World): { meshes: number; colliders: number } {
  root.updateWorldMatrix(true, true)
  const wanted = new Set<string>()
  const v = new THREE.Vector3()
  let meshes = 0
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !OBJECT_RE.test(obj.name) || SKIP_RE.test(obj.name)) return
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos || pos.count < 3) return
    mesh.updateWorldMatrix(true, false)
    v.fromBufferAttribute(pos, 0).applyMatrix4(mesh.matrixWorld)
    const ax = v.x, ay = v.y, az = v.z
    v.fromBufferAttribute(pos, pos.count - 1).applyMatrix4(mesh.matrixWorld)
    wanted.add(keyOf(pos.count, ax, ay, az, v.x, v.y, v.z))
    meshes++
  })

  let colliders = 0
  world.colliders.forEach((c) => {
    const shape = c.shape as { type: number; vertices?: Float32Array }
    if (shape.type !== RAPIER.ShapeType.TriMesh || !shape.vertices) return
    const a = shape.vertices
    const n = a.length / 3
    if (n < 3) return
    if (!wanted.has(keyOf(n, a[0], a[1], a[2], a[a.length - 3], a[a.length - 2], a[a.length - 1]))) return
    c.setRestitution(OBJECT_RESTITUTION)
    c.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    colliders++
  })
  return { meshes, colliders }
}
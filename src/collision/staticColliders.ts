import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

// Classifies exported Blender objects by name into physics roles, and builds STATIC
// physics colliders for each from the mesh's own triangles (world-space), not
// hand-drawn boxes. Using the real geometry — not an axis-aligned box approximation —
// is what gives roads their actual edges, railings their actual run, and cliffs/ocean
// their actual boundary, so the car can be stopped by the real shape of the world
// instead of a rectangle that doesn't match it. Static trimesh colliders are cheap in
// Rapier (the cost that matters is dynamic trimesh, which this isn't).

const VEHICLE_RE = /^vehicle_/i
const RAILING_RE = /(railing|cityrail_(toprail|lowrail|balusters|post))/i
const DRIVABLE_RE = /^(road_|intersection|openplatform_pad|port_dock|port_structure|port_quayextension|port_quaypilings|roaddetail_strip)/i
const BLOCKING_RE = /(cliff|terrain|bedrockshelf|rock_master|terraindetail|city_building|city_tower|city_industrial_mass|citydetail_|port_crane|cargo_ship|ship_|container_group|portdetail_barrier|portdetail_bollard|portdetail_containerextra|portdetail_fueltank|portdetail_utilitybox|roaddetail_barrier|platformdetail_pylon|platform_fascia|platform_canopy|platform_pillar|platform_monument|streetlight|ocean)/i
// WEB-PHASE-4 REDO Phase 12: mirrors WALL_RESTITUTION in roadBoundaries.ts --
// same mild bounce-back, applied to railing colliders only (see role ===
// 'railing' below), not to cliffs/buildings/terrain/etc.
const RAILING_RESTITUTION = 0.4

export interface ColliderStats {
  drivable: number
  railing: number
  blocking: number
  skipped: number
  fallbackBoxes: number
}

// Which exported meshes count as something the chase camera should not clip through.
// Deliberately excludes drivable/ground surfaces (roads, pads, docks): a large flat
// mesh right under/behind the car was being hit almost immediately by the camera's
// obstruction raycast, collapsing the camera back into the cockpit. Only vertical
// obstacles (buildings, pillars, cliffs, railings) should ever pull the camera in.
export function isCameraObstacle(name: string): boolean {
  if (VEHICLE_RE.test(name)) return false
  if (DRIVABLE_RE.test(name)) return false
  return BLOCKING_RE.test(name) || RAILING_RE.test(name)
}

function extractWorldTriangles(mesh: THREE.Mesh): { vertices: Float32Array; indices: Uint32Array } | null {
  const geom = mesh.geometry
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!posAttr || posAttr.count < 3) return null

  mesh.updateWorldMatrix(true, false)
  const vertices = new Float32Array(posAttr.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i)
    v.applyMatrix4(mesh.matrixWorld)
    vertices[i * 3] = v.x
    vertices[i * 3 + 1] = v.y
    vertices[i * 3 + 2] = v.z
  }

  let indices: Uint32Array
  if (geom.index) {
    indices = Uint32Array.from(geom.index.array)
  } else {
    indices = new Uint32Array(posAttr.count)
    for (let i = 0; i < posAttr.count; i++) indices[i] = i
  }
  if (indices.length < 3) return null

  return { vertices, indices }
}

// WEB-PHASE-4 REDO Phase 12: `restitution`, when given, is applied with the
// Max combine rule so it's the value that governs contact regardless of the
// vehicle's own collider restitution (vehicle.ts untouched) -- used only for
// railings below, per the explicit "railings should deflect, not hard stop"
// request. Every other caller (fallback boxes for drivable/blocking meshes
// whose trimesh failed) omits it and keeps the previous dead-stop behaviour.
function addFallbackBoxCollider(mesh: THREE.Mesh, world: RAPIER.World, restitution?: number): void {
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const hx = Math.max(size.x / 2, 0.05)
  const hy = Math.max(size.y / 2, 0.05)
  const hz = Math.max(size.z / 2, 0.05)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
  let colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
  if (restitution !== undefined) {
    colliderDesc = colliderDesc.setRestitution(restitution).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
  }
  world.createCollider(colliderDesc, body)
}

export function buildStaticColliders(root: THREE.Object3D, world: RAPIER.World): ColliderStats {
  const stats: ColliderStats = { drivable: 0, railing: 0, blocking: 0, skipped: 0, fallbackBoxes: 0 }

  root.updateWorldMatrix(true, true)

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const name = obj.name

    if (VEHICLE_RE.test(name)) return

    let role: 'drivable' | 'railing' | 'blocking' | null = null
    if (DRIVABLE_RE.test(name)) role = 'drivable'
    else if (RAILING_RE.test(name)) role = 'railing'
    else if (BLOCKING_RE.test(name)) role = 'blocking'

    if (!role) {
      stats.skipped++
      return
    }

    // Railings get a lightweight box collider (their own world-space bounding box)
    // that follows the run of the mesh, instead of a full per-triangle trimesh.
    // The visible rail geometry (top rail, low rail, balusters, individual posts)
    // is thin and gappy — balusters in particular are a row of separate bars with
    // open space between them — so colliding against every triangle either lets a
    // fast-moving car tunnel through the gaps or gives a jittery, inconsistent
    // response. Each railing mesh here is already a single straight run (the
    // export splits every side into its own segment: East/North/South_E/... ), so
    // its own AABB is a faithful "long thin box along the run", not an
    // over-sized approximation. Drivable and blocking geometry (roads, terrain,
    // buildings, cliffs, the ship, cranes) keep real per-triangle trimesh
    // collision, since a box would badly misrepresent their actual shape.
    if (role === 'railing') {
      // Same mild bounce-back as the road-edge walls (roadBoundaries.ts) --
      // explicitly requested so hitting a railing nudges the car back
      // toward the road instead of stopping it dead against it.
      addFallbackBoxCollider(mesh, world, RAILING_RESTITUTION)
      stats.railing++
      return
    }

    const tris = extractWorldTriangles(mesh)
    if (!tris) {
      addFallbackBoxCollider(mesh, world)
      stats.fallbackBoxes++
      stats[role]++
      return
    }

    try {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      const colliderDesc = RAPIER.ColliderDesc.trimesh(tris.vertices, tris.indices)
      world.createCollider(colliderDesc, body)
      stats[role]++
    } catch (err) {
      // degenerate geometry (duplicate points, zero-area triangles, etc.) — fall
      // back to a simple box for this one mesh rather than losing its collision.
      console.warn('[colliders] trimesh failed for', name, '— using box fallback', err)
      addFallbackBoxCollider(mesh, world)
      stats.fallbackBoxes++
      stats[role]++
    }
  })

  return stats
}

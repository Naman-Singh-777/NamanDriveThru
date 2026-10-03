import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

// Explicit road/junction boundary system. Builds invisible walls so the car can't
// drive off the side of a road into adjacent terrain, and can't drive through the
// outer edge of the Intersection -- while leaving City/Port/Platform open (their
// own existing railings/objects/architecture are the boundary there, not the road
// edge) and leaving every road's entrance into the Intersection, and the
// Intersection's own interior, open.
//
// WEB-PHASE-2/3B topology correction: the previous version of this file walled
// each road segment's full physical length, which is correct for road-only
// stretches but wrong wherever a road segment's own mesh physically extends INTO
// a major-area's open footprint (confirmed by direct GLB measurement: Road_East's
// box reaches x=750, deep inside OpenPlatform_Pad's own box which starts at
// x=562.5; Road_West similarly overlaps Port_Dock; Road_North overlaps the
// CityRail perimeter almost along its entire length, since it continues as the
// city's own main street). In each of those cases the old side-wall ran straight
// through the open area's entrance, trapping the car on the road. Road_South has
// no such overlap and is unaffected. Separately, the Intersection had ZERO
// perimeter walls at all -- its outer edges were completely unguarded.
//
// Fix, in two parts, both derived from the real loaded geometry every time (no
// hardcoded coordinates):
//  1. buildRoadBoundaries: before placing a road-side wall, the candidate wall's
//     own interval along the road's long axis is intersected against every major
//     open-area's own box (Platform/Port/City, each read from its own real
//     mesh(es)) on that same axis; any overlapping sub-interval is removed before
//     the wall is built, so the remaining wall segment(s) cover only the genuine
//     road-only portion. Road_South is unaffected because it has no overlap.
//  2. buildJunctionBoundaries (new): walls the Intersection's own 4 outer edges,
//     each with a gap left open exactly matching the connecting road's own width
//     at that side (found from that road's own box, not hardcoded), so all four
//     road entrances and the full interior remain open while the outer perimeter
//     is no longer undefended.
//
// Road_East/North/South/West and Intersection are each a simple, thin, unwelded
// box mesh (every face keeps its own vertex copies), so silhouette extraction by
// shared-vertex-index count doesn't isolate a single true outline for the road
// side-wall path -- every face contributes its own 4-edge perimeter. That's fine:
// it just means a physical edge gets a few redundant, coincident wall candidates
// (from the top/bottom/side face copies of the same edge), which the dedupe step
// below collapses to one before the interval-subtraction is even applied.

const ROAD_RE = /^road_/i

const WALL_HEIGHT = 14
const WALL_THICKNESS = 1.6
// WEB-PHASE-4 REDO Phase 12: mild bounce-back off road-edge/junction walls
// (see buildWallSegment/buildSide) -- 0 was a dead stop with no push away
// from the wall at all, which made a near-head-on hit feel like slamming
// into concrete and needing a long reverse to get clear. 1.0 would be a
// springy, unrealistic bounce; this sits well below that, just enough to
// visibly nudge the car back toward the road on contact.
const WALL_RESTITUTION = 0.4
// Minimum remaining sub-interval length worth building a collider for, after
// subtracting a major-area overlap -- avoids a degenerate sliver wall from a
// near-exact boundary-coordinate coincidence.
const MIN_WALL_LEN = 0.5

function extractAllEdges(mesh: THREE.Mesh): { a: THREE.Vector3; b: THREE.Vector3 }[] {
  const geom = mesh.geometry
  const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return []
  mesh.updateWorldMatrix(true, false)

  const index = geom.index ? geom.index.array : null
  const triCount = index ? index.length / 3 : Math.floor(pos.count / 3)
  const getIdx = (t: number, k: number) => (index ? (index[t * 3 + k] as number) : t * 3 + k)

  const v = new THREE.Vector3()
  const worldPos = (idx: number) => v.fromBufferAttribute(pos, idx).clone().applyMatrix4(mesh.matrixWorld)

  const edges: { a: THREE.Vector3; b: THREE.Vector3 }[] = []
  for (let t = 0; t < triCount; t++) {
    const tri = [getIdx(t, 0), getIdx(t, 1), getIdx(t, 2)]
    for (let k = 0; k < 3; k++) {
      edges.push({ a: worldPos(tri[k]), b: worldPos(tri[(k + 1) % 3]) })
    }
  }
  return edges
}

// Finds the world-space box of every mesh whose name matches `re`, unioned
// together -- used to read each major open-area's real footprint (and the
// Intersection's / each Road_*'s own footprint) directly from the loaded GLB,
// never hardcoded.
function unionBoxOf(root: THREE.Object3D, re: RegExp): THREE.Box3 | null {
  const box = new THREE.Box3()
  let found = 0
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && re.test(obj.name)) {
      box.union(new THREE.Box3().setFromObject(mesh))
      found++
    }
  })
  return found ? box : null
}

// Subtracts `exclude` (if it overlaps) from `full`, both 1D intervals [min,max],
// returning the 0-2 remaining sub-intervals. Shared by both the road-side-wall
// fix (subtracting a major-area's footprint from a candidate wall's own span)
// and the junction perimeter-wall builder (subtracting a connecting road's own
// width -- the entrance gap -- from the Intersection's full side length).
function subtractInterval(
  full: [number, number],
  exclude: [number, number] | null
): [number, number][] {
  if (!exclude) return [full]
  const [fMin, fMax] = full
  const [eMin, eMax] = [Math.max(exclude[0], fMin), Math.min(exclude[1], fMax)]
  if (eMin >= eMax) return [full] // no real overlap
  const out: [number, number][] = []
  if (eMin - fMin > MIN_WALL_LEN) out.push([fMin, eMin])
  if (fMax - eMax > MIN_WALL_LEN) out.push([eMax, fMax])
  return out
}

export interface RoadBoundaryStats {
  walls: number
  skippedEndCaps: number
  skippedInterior: number
  openAreaSubtractions: number
}

export function buildRoadBoundaries(root: THREE.Object3D, world: RAPIER.World): RoadBoundaryStats {
  root.updateWorldMatrix(true, true)

  // Real major open-area footprints, read once from the actual loaded geometry.
  // City has no separate "ground" mesh (confirmed by GLB name audit), so its own
  // CityRail_* perimeter -- a real, measured run of railing meshes -- stands in
  // for its footprint: any point inside that perimeter's own box is inside the
  // area the road is allowed to continue into unwalled.
  const openAreas: { name: string; box: THREE.Box3 }[] = []
  const platformBox = unionBoxOf(root, /^openplatform_pad$/i)
  if (platformBox) openAreas.push({ name: 'Platform', box: platformBox })
  const portBox = unionBoxOf(root, /^port_(dock|structure|quayextension|quaypilings)$/i)
  if (portBox) openAreas.push({ name: 'Port', box: portBox })
  const cityBox = unionBoxOf(root, /^cityrail_/i)
  if (cityBox) openAreas.push({ name: 'City', box: cityBox })

  let walls = 0
  let skippedEndCaps = 0
  let skippedInterior = 0
  let openAreaSubtractions = 0
  const placed = new Set<string>() // dedupe coincident edges from unwelded face copies

  function buildWallSegment(
    longAxisIsX: boolean,
    longMin: number,
    longMax: number,
    shortCoord: number,
    y: number
  ): void {
    const halfLen = Math.max((longMax - longMin) / 2, 0.3)
    const mid = (longMin + longMax) / 2
    const x = longAxisIsX ? mid : shortCoord
    const z = longAxisIsX ? shortCoord : mid
    const yaw = longAxisIsX ? Math.PI / 2 : 0 // rotate so the wall's long (Z-local) axis follows the X world axis when needed

    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(x, y + WALL_HEIGHT / 2 - 2, z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
    const body = world.createRigidBody(bodyDesc)
    // WEB-PHASE-4 REDO Phase 12: a soft bounce-back instead of a dead stop --
    // explicitly requested ("deflect the car towards the road, not hard
    // stop"). A road-side wall's own normal already points back in toward
    // the road by construction, so restitution alone naturally pushes the
    // car that direction on contact; Max combine rule makes this value the
    // one that applies regardless of whatever restitution the vehicle's own
    // collider has (vehicle.ts untouched). No other collider property
    // (friction, placement, shape) changed.
    const colliderDesc = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, WALL_HEIGHT / 2, halfLen)
      .setRestitution(WALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    world.createCollider(colliderDesc, body)
    walls++
  }

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !ROAD_RE.test(obj.name)) return

    const box = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    box.getSize(size)
    // the segment's long (travel) direction in the XZ plane
    const longAxisIsX = size.x >= size.z
    const BOUNDARY_TOL = 3

    for (const edge of extractAllEdges(mesh)) {
      const dir = edge.b.clone().sub(edge.a)
      dir.y = 0
      const length = dir.length()
      if (length < 1) continue // vertical/degenerate edge (face diagonals, top/bottom rungs)
      dir.normalize()

      const alongLong = longAxisIsX ? Math.abs(dir.x) : Math.abs(dir.z)
      const isSideEdge = alongLong > 0.9
      if (!isSideEdge) {
        skippedEndCaps++
        continue
      }

      const mid = edge.a.clone().add(edge.b).multiplyScalar(0.5)
      const shortCoord = longAxisIsX ? mid.z : mid.x
      const shortMin = longAxisIsX ? box.min.z : box.min.x
      const shortMax = longAxisIsX ? box.max.z : box.max.x
      const nearBoundary =
        Math.abs(shortCoord - shortMin) < BOUNDARY_TOL || Math.abs(shortCoord - shortMax) < BOUNDARY_TOL
      if (!nearBoundary) {
        skippedInterior++
        continue
      }

      const key = `${Math.round(mid.x / 2)}_${Math.round(mid.z / 2)}`
      if (placed.has(key)) continue
      placed.add(key)

      // Candidate wall's own full span along the road's long axis, from the
      // edge's own endpoints (not mid +/- length/2 derived separately, so this
      // is exact even if the two endpoints aren't symmetric about the mesh box).
      const aLong = longAxisIsX ? edge.a.x : edge.a.z
      const bLong = longAxisIsX ? edge.b.x : edge.b.z
      const fullInterval: [number, number] = [Math.min(aLong, bLong), Math.max(aLong, bLong)]

      // Subtract whichever major open-area overlaps this road's long-axis span
      // -- but ONLY an area that is also physically adjacent on the SHORT axis
      // (the road mesh's own short-axis extent, e.g. z=[-25,25] for Road_East).
      // A long-axis-only check is not enough: City's box, for example, spans
      // x=[-223.9,236.9] -- which overlaps Road_East's long-axis (x) span in
      // pure 1D projection even though City sits far away in Z and is nowhere
      // near Road_East at all. Without this gate that projection alone would
      // wrongly clip a chunk out of Road_East's genuine road-only stretch near
      // the Intersection (caught here before being applied, not shipped).
      let subIntervals: [number, number][] = [fullInterval]
      for (const area of openAreas) {
        const shortOverlaps = longAxisIsX
          ? area.box.min.z < shortMax && area.box.max.z > shortMin
          : area.box.min.x < shortMax && area.box.max.x > shortMin
        if (!shortOverlaps) continue
        const areaInterval: [number, number] = longAxisIsX
          ? [area.box.min.x, area.box.max.x]
          : [area.box.min.z, area.box.max.z]
        const next: [number, number][] = []
        for (const iv of subIntervals) {
          const pieces = subtractInterval(iv, areaInterval)
          if (pieces.length !== 1 || pieces[0][0] !== iv[0] || pieces[0][1] !== iv[1]) openAreaSubtractions++
          next.push(...pieces)
        }
        subIntervals = next
      }

      for (const [subMin, subMax] of subIntervals) {
        buildWallSegment(longAxisIsX, subMin, subMax, shortCoord, mid.y)
      }
    }
  })

  return { walls, skippedEndCaps, skippedInterior, openAreaSubtractions }
}

export interface JunctionBoundaryStats {
  walls: number
  sidesProcessed: number
}

// Builds the Intersection's own outer-perimeter walls, with a gap left open on
// each side exactly matching the connecting road's own width there (read from
// that road's real box, never hardcoded), so every road entrance and the full
// interior stay open while the previously-undefended outer edge is now walled.
export function buildJunctionBoundaries(root: THREE.Object3D, world: RAPIER.World): JunctionBoundaryStats {
  root.updateWorldMatrix(true, true)

  const junctionBox = unionBoxOf(root, /^intersection$/i)
  if (!junctionBox) return { walls: 0, sidesProcessed: 0 }

  const roadEast = unionBoxOf(root, /^road_east$/i)
  const roadWest = unionBoxOf(root, /^road_west$/i)
  const roadNorth = unionBoxOf(root, /^road_north$/i)
  const roadSouth = unionBoxOf(root, /^road_south$/i)
  const y = (junctionBox.min.y + junctionBox.max.y) / 2

  let walls = 0
  let sidesProcessed = 0

  // WEB-PHASE-2/3F (junction corner closure): a side's wall piece that still
  // touches the ORIGINAL (pre-gap) side boundary -- i.e. a true outer corner of
  // the Intersection's own box, not an edge created by subtracting a road's
  // entrance gap -- is extended outward past that corner coordinate by
  // CORNER_OVERLAP. The perpendicular wall on the adjacent side is extended the
  // same way past the SAME shared corner coordinate, so the two walls don't
  // merely meet at a single shared point/edge (which the user's own report
  // explicitly flags as unverifiable -- "do not rely on the vehicle's chassis
  // happening to hit the wall before the gap"): they now overlap each other by
  // a real, solid 2*CORNER_OVERLAP-wide square of collider volume at every
  // corner, closing it by construction regardless of chassis size, collision
  // margins, or floating-point boundary coincidence. A piece boundary created
  // by the gap subtraction (a road entrance) is left exactly where it is --
  // only the box's true outer-corner boundaries are extended, so no entrance
  // gap is narrowed by this change. Visible junction geometry is untouched;
  // this only changes the size/placement of the invisible physics colliders.
  const CORNER_OVERLAP = WALL_THICKNESS * 1.5

  function buildSide(fixedCoord: number, running: [number, number], gap: [number, number] | null, axisIsX: boolean): void {
    sidesProcessed++
    const pieces = subtractInterval(running, gap)
    for (const [pMin, pMax] of pieces) {
      // Only extend an end that still sits at the side's true original boundary
      // (a real outer corner) -- not an end created by the gap subtraction.
      const runMin = Math.abs(pMin - running[0]) < 1e-6 ? pMin - CORNER_OVERLAP : pMin
      const runMax = Math.abs(pMax - running[1]) < 1e-6 ? pMax + CORNER_OVERLAP : pMax
      const halfLen = Math.max((runMax - runMin) / 2, 0.3)
      const mid = (runMin + runMax) / 2
      // axisIsX === true means this side's FIXED coordinate is on X (an east/west
      // face) and the wall RUNS along Z; axisIsX === false means the fixed
      // coordinate is on Z (a north/south face) and the wall runs along X.
      const x = axisIsX ? fixedCoord : mid
      const z = axisIsX ? mid : fixedCoord
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + WALL_HEIGHT / 2 - 2, z)
      const body = world.createRigidBody(bodyDesc)
      const colliderDesc = (axisIsX
        ? RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, WALL_HEIGHT / 2, halfLen)
        : RAPIER.ColliderDesc.cuboid(halfLen, WALL_HEIGHT / 2, WALL_THICKNESS / 2)
      )
        .setRestitution(WALL_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      world.createCollider(colliderDesc, body)
      walls++
    }
  }

  // East face (x = max): wall runs along Z, gap = Road_East's own Z range.
  buildSide(junctionBox.max.x, [junctionBox.min.z, junctionBox.max.z], roadEast ? [roadEast.min.z, roadEast.max.z] : null, true)
  // West face (x = min): wall runs along Z, gap = Road_West's own Z range.
  buildSide(junctionBox.min.x, [junctionBox.min.z, junctionBox.max.z], roadWest ? [roadWest.min.z, roadWest.max.z] : null, true)
  // North face (z = min): wall runs along X, gap = Road_North's own X range.
  buildSide(junctionBox.min.z, [junctionBox.min.x, junctionBox.max.x], roadNorth ? [roadNorth.min.x, roadNorth.max.x] : null, false)
  // South face (z = max): wall runs along X, gap = Road_South's own X range.
  buildSide(junctionBox.max.z, [junctionBox.min.x, junctionBox.max.x], roadSouth ? [roadSouth.min.x, roadSouth.max.x] : null, false)

  return { walls, sidesProcessed }
}

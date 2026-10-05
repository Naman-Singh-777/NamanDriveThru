import * as THREE from 'three'

// City perimeter railing: seat the rails on the deck and put every lamp on a post.
// Runs once at load on the parsed GLB graph (the exported GLB / Blender source is
// never written to), same non-destructive pattern as portRailFix.ts.
//
// Measured on the real geometry (ray casts down onto Terrain_Base001):
//   - The flat deck (y 53.7) ends at x 224.5 on the east side, z -1077.5 on the
//     north side and z -183 on the south side (west edge is fine, x -222.5). The
//     rails stood on the slope beyond: east 20 units above the ground, north ~7,
//     south ~2, so they hung in the air.
//   - 6 mid-span lamps (East/West Q1, Q3 and Mid) stood between posts with
//     nothing under them, their foot hovering above the top bar.
//
// Fix (nothing is added, redrawn or resized other than the runs below):
//   - East run moves 13 units in (x 235 -> 222), north run 5.5 in (z -1080 ->
//     -1074.5), south run 4.5 in (z -180 -> -184.5). West run is unchanged in x.
//     Posts are re-spaced evenly along each run (the runs end at the new corners
//     and stay as long as before up to a 0.9-5.8% shrink), bars and balusters
//     are the same meshes, just moved and scaled along their own axis.
//   - Each lamp that was not on a post slides along the rail to the nearest post.
//     Lamps keep their height (foot on the post-top plane, y 67.01), model and
//     light; corner and NorthMid lamps move with their post.

const E_OLD = 235
const N_OLD = -1080
const S_OLD = -180
const W_X = -222
const GATE_X = 28 // south run is split by the road gate at |x| < 28

const E_NEW = 222
const N_NEW = -1074.5
const S_NEW = -184.5

const lerp = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  b0 + ((v - a0) * (b1 - b0)) / (a1 - a0)

type Side = { east: boolean; west: boolean; north: boolean; south: boolean }
const sideOf = (x: number, z: number): Side => ({
  east: Math.abs(x - E_OLD) < 1,
  west: Math.abs(x - W_X) < 1,
  north: Math.abs(z - N_OLD) < 1,
  south: Math.abs(z - S_OLD) < 1
})

// Old -> new position of a point that sits on the old perimeter.
function mapPoint(x: number, z: number): [number, number] {
  const s = sideOf(x, z)
  let nx = x
  let nz = z
  if (s.east) nx = E_NEW
  else if (s.north) nx = lerp(x, W_X, E_OLD, W_X, E_NEW)
  else if (s.south && x > 0) nx = lerp(x, GATE_X, E_OLD, GATE_X, E_NEW)
  if (s.east || s.west) nz = lerp(z, S_OLD, N_OLD, S_NEW, N_NEW)
  else if (s.north) nz = N_NEW
  else if (s.south) nz = S_NEW
  return [nx, nz]
}

interface AxisMap { a: number; b: number } // v' = a + b * v
const affine = (a0: number, a1: number, b0: number, b1: number): AxisMap => {
  const b = (b1 - b0) / (a1 - a0)
  return { a: b0 - a0 * b, b }
}

function remapMesh(m: THREE.Object3D, axis: 'x' | 'z', map: AxisMap, cross: 'x' | 'z', shift: number): void {
  // world = pos + scale * local  ->  new world = a + b * world  <=>  pos' = a + b*pos, scale' = b*scale
  m.position[axis] = map.a + map.b * m.position[axis]
  m.scale[axis] *= map.b
  m.position[cross] += shift
}

export interface CityRailFixResult { posts: number; runs: number; lampsSnapped: number; lampsMoved: number }

export function applyCityRailFix(root: THREE.Object3D): CityRailFixResult {
  const result: CityRailFixResult = { posts: 0, runs: 0, lampsSnapped: 0, lampsMoved: 0 }
  if (root.userData.cityRailFixApplied) return result

  const posts: THREE.Object3D[] = []
  const lamps: THREE.Object3D[] = []
  const runs: Array<{ o: THREE.Object3D; kind: string }> = []
  root.traverse((o) => {
    if (/^CityRail_Post_\d+$/.test(o.name)) posts.push(o)
    else if (/^CityRail_Lamp_(?!.*_(Glass|Light)$).+$/.test(o.name)) lamps.push(o)
    else {
      const m = /^CityRail_(?:TopRail|LowRail|Balusters)_(North|East|West|South_W|South_E)$/.exec(o.name)
      if (m) runs.push({ o, kind: m[1] as string })
    }
  })
  // Safety: only touch the perimeter if the whole expected set is present and
  // still in its exported place (idempotent, and a no-op on any other map).
  if (posts.length < 90 || lamps.length < 9 || runs.length < 15) return result
  if (!posts.every((p) => Math.abs(p.position.y - 53.85) < 0.05)) return result
  root.userData.cityRailFixApplied = true

  // 1. Lamps first (they read the OLD post positions): snap to the nearest post if they are not on one.
  const old = posts.map((p) => new THREE.Vector2(p.position.x, p.position.z))
  for (const lamp of lamps) {
    const lx = lamp.position.x
    const lz = lamp.position.z
    let best = 0
    let bestD = Infinity
    old.forEach((p, i) => {
      const d = Math.hypot(p.x - lx, p.y - lz)
      if (d < bestD) { bestD = d; best = i }
    })
    const tx = old[best]!.x
    const tz = old[best]!.y
    if (bestD > 0.5) result.lampsSnapped++
    const [nx, nz] = mapPoint(tx, tz)
    const dx = nx - lx
    const dz = nz - lz
    for (const n of [lamp.name, `${lamp.name}_Glass`, `${lamp.name}_Light`]) {
      const o = root.getObjectByName(n)
      if (o) o.position.set(o.position.x + dx, o.position.y, o.position.z + dz)
    }
    result.lampsMoved++
  }

  // 2. Posts: new position on the moved/re-spaced perimeter.
  for (const p of posts) {
    const [nx, nz] = mapPoint(p.position.x, p.position.z)
    p.position.x = nx
    p.position.z = nz
    result.posts++
  }

  // 3. Bars and balusters: move across, scale along.
  const zMap = affine(S_OLD, N_OLD, S_NEW, N_NEW)
  const xMapN = affine(W_X, E_OLD, W_X, E_NEW)
  const xMapSE = affine(GATE_X, E_OLD, GATE_X, E_NEW)
  for (const { o, kind } of runs) {
    if (kind === 'East') remapMesh(o, 'z', zMap, 'x', E_NEW - E_OLD)
    else if (kind === 'West') remapMesh(o, 'z', zMap, 'x', 0)
    else if (kind === 'North') remapMesh(o, 'x', xMapN, 'z', N_NEW - N_OLD)
    else if (kind === 'South_E') remapMesh(o, 'x', xMapSE, 'z', S_NEW - S_OLD)
    else o.position.z += S_NEW - S_OLD // South_W: only moves in
    result.runs++
  }

  root.updateMatrixWorld(true)
  return result
}

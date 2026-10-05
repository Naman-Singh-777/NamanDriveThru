import * as THREE from 'three'

// Port perimeter railing continuity + corner lamp mounting. Runs once at load,
// after the GLB is parsed, and only ever clones/moves objects in the loaded
// THREE graph -- the exported GLB / Blender source is never written to (same
// non-destructive pattern as the other fixes in environment.ts).
//
// Every existing Port rail run is one shared prototype (bar / bar / baluster
// set, plus individual posts) scaled along its axis and dropped onto its edge
// line. New sections are built the exact same way from those same prototypes,
// so profile, height, thickness, material and post style are identical by
// construction. New meshes keep the "PortRail_" name prefix so the existing
// name-based collision/camera classification treats them like their neighbours.
//
// What is restored (found by auditing the real geometry, not assumed):
//   - the 2.7-unit seam on the apron's north edge (between Upper_A_West/Upper_A)
//   - the two south-edge gaps (x -839..-806 and x -656..-640): level terrain
//     beyond, no road/crane/berth there, the run just stops
//   - the NE apron corner (north run stopped 6.5 short, east run 2.5 short)
//   - the lower quay's outer west/east edges and their two outer corners
// Deliberately NOT touched: the road entrance on the east edge, the two crane
// openings on the north edge, and everything facing the ship berth.
//
// The four corner lamps sit at the midpoint of each corner's post pair but
// were mounted 8.8 units too low, so their poles ran through the posts. The
// City and Platform lamps are mounted with their foot on the post-top plane;
// the Port lamps are raised to that same plane. The NE lamp also moves to the
// midpoint of the NE post pair (that corner was open before).

const APRON_DY = 0
const LOWER_DY = 10.44 - 53.94 // lower quay deck vs apron deck (-43.5), same offset the existing lower rails use

type Axis = 'x' | 'z'
interface RunSpec { id: string; axis: Axis; a: number; b: number; line: number; dy: number }
interface PostSpec { id: string; x: number; z: number; dy: number }

const RUNS: RunSpec[] = [
  // apron, south edge (z = 48.5): the two open bays between existing posts
  { id: 'S_Bay1', axis: 'x', a: -839, b: -806, line: 48.5, dy: APRON_DY },
  { id: 'S_Bay2', axis: 'x', a: -656, b: -640, line: 48.5, dy: APRON_DY },
  // apron, north edge (z = -124.5): seam between Upper_A_West and Upper_A
  { id: 'N_Seam', axis: 'x', a: -845.73, b: -843, line: -124.5, dy: APRON_DY },
  // apron NE corner, same post-pair pattern as the SE corner mirrored
  { id: 'NE_East', axis: 'z', a: -124, b: -122, line: -625.5, dy: APRON_DY },
  { id: 'NE_North', axis: 'x', a: -632, b: -627, line: -124.5, dy: APRON_DY },
  // lower quay, west arm: NW outer corner + outer west edge down to where the hillside meets the deck
  { id: 'LNW_North', axis: 'x', a: -874.8, b: -870, line: -218.3, dy: LOWER_DY },
  { id: 'LW_Side', axis: 'z', a: -217.8, b: -158.5, line: -875.3, dy: LOWER_DY },
  // lower quay, east arm: NE outer corner + outer east edge down to the apron wall
  { id: 'LNE_North', axis: 'x', a: -628, b: -625.2, line: -218.3, dy: LOWER_DY },
  { id: 'LE_Side', axis: 'z', a: -217.8, b: -131, line: -624.7, dy: LOWER_DY }
]

const POSTS: PostSpec[] = [
  { id: 'NE_East', x: -625.5, z: -124, dy: APRON_DY },
  { id: 'NE_North', x: -627, z: -124.5, dy: APRON_DY },
  { id: 'LNW_North', x: -874.8, z: -218.3, dy: LOWER_DY },
  { id: 'LW_0', x: -875.3, z: -217.8, dy: LOWER_DY },
  { id: 'LW_1', x: -875.3, z: -188.15, dy: LOWER_DY },
  { id: 'LW_2', x: -875.3, z: -158.5, dy: LOWER_DY },
  { id: 'LNE_North', x: -625.2, z: -218.3, dy: LOWER_DY },
  { id: 'LE_0', x: -624.7, z: -217.8, dy: LOWER_DY },
  { id: 'LE_1', x: -624.7, z: -188.87, dy: LOWER_DY },
  { id: 'LE_2', x: -624.7, z: -159.93, dy: LOWER_DY },
  { id: 'LE_3', x: -624.7, z: -131, dy: LOWER_DY }
]

// Corner lamps. NE is also re-seated onto the midpoint of its (new) post pair.
const LAMP_KEYS = ['SW', 'NW', 'NE', 'SE'] as const
const NE_LAMP_XZ: [number, number] = [(-627 + -625.5) / 2, (-124.5 + -124) / 2]

interface Template { bars: THREE.Mesh[]; balusters: THREE.Mesh; len: number }

function getMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
  const o = root.getObjectByName(name)
  return o && (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : null
}

function localBox(m: THREE.Mesh): THREE.Box3 {
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
  return m.geometry.boundingBox as THREE.Box3
}

function template(root: THREE.Object3D, base: string, axis: Axis): Template | null {
  const hi = getMesh(root, `${base}_Bar_High`)
  const lo = getMesh(root, `${base}_Bar_Low`)
  const bal = getMesh(root, `${base}_Balusters`)
  if (!hi || !lo || !bal) return null
  const size = localBox(hi).getSize(new THREE.Vector3())
  return { bars: [hi, lo], balusters: bal, len: axis === 'x' ? size.x : size.z }
}

function addRun(root: THREE.Object3D, t: Template, spec: RunSpec): THREE.Mesh[] {
  const { axis, a, b, line, dy, id } = spec
  const cross: Axis = axis === 'x' ? 'z' : 'x'
  const s = (b - a) / t.len
  const parts: Array<[THREE.Mesh, string]> = [
    [t.bars[0] as THREE.Mesh, 'Bar_High'],
    [t.bars[1] as THREE.Mesh, 'Bar_Low'],
    [t.balusters, 'Balusters']
  ]
  const out: THREE.Mesh[] = []
  for (const [src, suffix] of parts) {
    const m = src.clone() // geometry + material stay shared with the original run
    m.name = `PortRail_Fix_${id}_${suffix}`
    m.userData.portFix = true
    const lb = localBox(src).getCenter(new THREE.Vector3())
    m.scale[axis] = s
    m.position.copy(src.position)
    m.position[axis] = (a + b) / 2 - lb[axis] * s
    m.position[cross] = line - lb[cross]
    m.position.y = src.position.y + dy
    root.add(m)
    out.push(m)
  }
  return out
}

function addPost(root: THREE.Object3D, tpl: THREE.Mesh, spec: PostSpec): THREE.Mesh {
  const p = tpl.clone()
  p.name = `PortRail_Fix_${spec.id}_Post`
  p.userData.portFix = true
  p.position.set(spec.x, tpl.position.y + spec.dy, spec.z)
  root.add(p)
  return p
}

export interface PortRailFixResult { runs: number; posts: number; lamps: number }

export function applyPortRailFix(root: THREE.Object3D): PortRailFixResult {
  const result: PortRailFixResult = { runs: 0, posts: 0, lamps: 0 }
  if (root.userData.portRailFixApplied) return result
  const xT = template(root, 'PortRail_South_B', 'x')
  const zT = template(root, 'PortRail_West', 'z')
  const postT = getMesh(root, 'PortRail_South_A_Post_00')
  if (!xT || !zT || !postT) return result // prototypes missing: leave the Port exactly as exported
  root.userData.portRailFixApplied = true
  root.updateMatrixWorld(true)

  for (const spec of RUNS) {
    addRun(root, spec.axis === 'x' ? xT : zT, spec)
    result.runs++
  }
  for (const spec of POSTS) {
    addPost(root, postT, spec)
    result.posts++
  }

  // Lamps: foot onto the post-top plane (same mounting as the City/Platform lamps).
  const postTop = new THREE.Box3().setFromObject(postT).max.y
  for (const k of LAMP_KEYS) {
    const body = getMesh(root, `PortRail_Lamp_${k}`)
    if (!body) continue
    const footY = new THREE.Box3().setFromObject(body).min.y
    const dy = postTop - footY
    const dx = k === 'NE' ? NE_LAMP_XZ[0] - body.position.x : 0
    const dz = k === 'NE' ? NE_LAMP_XZ[1] - body.position.z : 0
    for (const n of [`PortRail_Lamp_${k}`, `PortRail_Lamp_${k}_Glass`, `PortRail_Lamp_${k}_Light`]) {
      const o = root.getObjectByName(n) // the _Light may already be stripped by the caller
      if (o) o.position.set(o.position.x + dx, o.position.y + dy, o.position.z + dz)
    }
    result.lamps++
  }

  root.updateMatrixWorld(true)
  return result
}
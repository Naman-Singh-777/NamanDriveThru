import * as THREE from 'three'

// WEB-PHASE-4 REDO: each of the three destination roads (Road_North -> City,
// Road_East -> Platform, Road_West -> Port) is a flat rectangular strip that
// stops abruptly where it meets its destination's open area -- Road_North in
// particular has nothing but raw terrain beyond its far edge (City has no
// separate ground mesh of its own, confirmed in roadBoundaries.ts), so that
// edge reads as a hard, unfinished cut. This adds a small semicircular "cap"
// of the SAME real road material at each of those three edges, radius = the
// road's own real measured half-width, so the rectangle appears to round off
// into a cul-de-sac bulb rather than stopping on a straight line. Purely
// additive geometry layered on top of the existing floor -- the locked
// Road_*/environment.glb meshes are never read from or written to here
// beyond copying MAT_ROAD's own real exported color/roughness/metalness
// (same technique already used for the cliff/concrete/glass material fixes
// in environment.ts), and nothing about collision/driving changes: the real
// road colliders (roadBoundaries.ts) are completely untouched.

export interface RoadEndCapDef {
  // World-space center of the straight edge being capped (on the floor).
  center: THREE.Vector3
  // Half the road's real measured width -- the semicircle's radius.
  radius: number
  // Which way the cap should bulge, as a world XZ direction (need not be
  // normalized here -- normalized internally).
  outward: THREE.Vector2
}

function roadMatchingMaterial(root: THREE.Object3D): THREE.MeshStandardMaterial {
  // Copy MAT_ROAD's own real exported appearance so the cap reads as more of
  // the same pavement, not a new invented color.
  let found: THREE.MeshStandardMaterial | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && !Array.isArray(mesh.material) && mat.name === 'MAT_ROAD') found = mat
  })
  if (found) {
    const src = found as THREE.MeshStandardMaterial
    return new THREE.MeshStandardMaterial({
      color: src.color.clone(),
      roughness: src.roughness,
      metalness: src.metalness
    })
  }
  // Fallback (should not happen -- MAT_ROAD is confirmed present on all three
  // destination roads): a plain dark asphalt tone, same ballpark as MAT_ROAD.
  return new THREE.MeshStandardMaterial({ color: 0x3f4248, roughness: 1, metalness: 0 })
}

// WEB-PHASE-4 REDO Phase 9: the cap's painted-line arc was originally a
// guessed bright off-white (0xf0f0f0), which the user flagged as not
// matching the real road's own lane-marking color. Probed the real
// environment.glb directly: every real RoadDetail_Center_*/Edge_* lane
// marking on all three destination roads uses the exact same material,
// MAT_LaneMark_PORT (a dark slate teal, #273f45, roughness 0.6, metalness 0)
// -- not white at all. This copies that real material the same way
// roadMatchingMaterial copies MAT_ROAD, so the cap's line reads as a literal
// continuation of the real lane marking, not an invented color.
function laneMarkingMaterial(root: THREE.Object3D): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && !Array.isArray(mesh.material) && mat.name === 'MAT_LaneMark_PORT') found = mat
  })
  if (found) {
    const src = found as THREE.MeshStandardMaterial
    return new THREE.MeshStandardMaterial({
      color: src.color.clone(),
      roughness: src.roughness,
      metalness: src.metalness
    })
  }
  // Fallback (should not happen -- MAT_LaneMark_PORT is confirmed present on
  // all three destination roads): the same real color, hardcoded.
  return new THREE.MeshStandardMaterial({ color: 0x273f45, roughness: 0.6, metalness: 0 })
}

function buildCapShape(radius: number): THREE.Shape {
  // Local space: flat diameter edge lies along local X at y=0 (from -r to r),
  // the arc bulges toward local -Y. After geo.rotateX(-PI/2) (same convention
  // as the checkpoint pads), local -Y becomes world +Z, so rotation.y=0
  // bulges toward world +Z -- callers pick rotation.y to match their real
  // `outward` direction (see addRoadEndCaps below).
  const s = new THREE.Shape()
  s.moveTo(-radius, 0)
  s.absarc(0, 0, radius, Math.PI, 2 * Math.PI, false)
  s.lineTo(-radius, 0)
  return s
}

// WEB-PHASE-4 REDO Phase 7: a thin painted-line arc tracing just inside the
// cap's own curve, so the road's lane marking reads as "completing" into the
// semicircle too, not just the pavement underneath it. Built with the exact
// same half-disc convention as buildCapShape (RingGeometry's thetaStart=PI,
// thetaLength=PI sweeps its local -Y half, which is the same half
// buildCapShape's Shape traces) so the same rotation.y formula below orients
// both pieces identically -- no separate derivation needed.
function buildCapLineGeometry(radius: number, lineWidth: number): THREE.RingGeometry {
  const inner = Math.max(radius - lineWidth, 0.01)
  const geo = new THREE.RingGeometry(inner, radius, 48, 1, Math.PI, Math.PI)
  geo.rotateX(-Math.PI / 2)
  return geo
}

export function addRoadEndCaps(scene: THREE.Scene, root: THREE.Object3D, defs: RoadEndCapDef[]): void {
  const mat = roadMatchingMaterial(root)
  // The cap's line now copies the real MAT_LaneMark_PORT lane-marking color
  // (see laneMarkingMaterial above) instead of a guessed white, so it reads
  // as the same lane marking continuing into the semicircle, not a new tone.
  const lineMat = laneMarkingMaterial(root)
  for (const def of defs) {
    const geo = new THREE.ShapeGeometry(buildCapShape(def.radius), 32)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(def.center)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // atan2(outward.x, outward.y) gives the rotation.y that makes the default
    // +Z bulge point along `outward` (see the derivation in buildCapShape).
    const dir = def.outward.clone().normalize()
    mesh.rotation.y = Math.atan2(dir.x, dir.y)
    mesh.name = 'RoadEndCap'
    scene.add(mesh)

    const lineWidth = Math.max(def.radius * 0.035, 0.4)
    const lineGeo = buildCapLineGeometry(def.radius * 0.92, lineWidth)
    const lineMesh = new THREE.Mesh(lineGeo, lineMat)
    lineMesh.position.copy(def.center)
    lineMesh.position.y += 0.03 // sit just above the cap -- avoids z-fighting
    lineMesh.rotation.y = mesh.rotation.y
    lineMesh.name = 'RoadEndCapLine'
    scene.add(lineMesh)
  }
}

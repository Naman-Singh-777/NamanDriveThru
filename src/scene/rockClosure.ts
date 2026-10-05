import * as THREE from 'three'

// Closes the open cut seams of the rock terrain.
//
// Terrain_Base001 is a single thin shell. Where the mesh was cut into chunks it simply ends in a
// straight edge with no wall under it, so from the road (and from the sea) you look straight into the
// hollow underside: a dark gap under the coast ledge near the junction, a thin sliver at the left of
// the road, and a handful of ledges along the shore. environment.glb is locked, so the missing walls
// are generated here instead. Each row below is one open lip segment (x,y,z of both ends, ordered so the
// segment's left-hand normal faces out of the rock). A vertical wall hangs from it down below the sea
// and uses the very same material as the terrain, so it takes the same colour, shading and wet-rock
// overlay and reads as part of the rock rather than as something added on.

const SEAMS = `-101.8,13.2,-1187.5,-111.9,15.2,-1187.5;
    -12.7,52.4,1437.5,-3.7,53.1,1437.5;
    -124.7,21.8,498,-125,27.4,532.8;
    -124.8,21.8,459.7,-124.9,23.9,477.5;
    -124.8,25.8,824.2,-125,29.9,870.3;
    -124.8,29.6,808.8,-124.8,25.8,824.2;
    -124.9,20.9,1008.1,-125,17.5,1039.8;
    -124.9,23.9,477.5,-124.7,21.8,498;
    -124.9,27.7,769.7,-124.8,29.6,808.8;
    -124.9,34.1,158,-124.9,34.8,172.3;
    -124.9,34.8,172.3,-125.1,33.4,204.9;
    -124.9,36.9,742,-124.9,27.7,769.7;
    -124.9,38.1,653.5,-125,34.8,670.2;
    -125,16.9,938.4,-125,20.2,959.5;
    -125,17.5,1039.8,-125,15,1072.6;
    -125,19.7,689.2,-125,19.8,708.2;
    -125,19.8,708.2,-125,34.4,726.7;
    -125,20.2,959.5,-124.9,20.9,1008.1;
    -125,21.7,919.2,-125,16.9,938.4;
    -125,22.3,420.4,-124.8,21.8,459.7;
    -125,27.4,532.8,-125.1,23.3,569.1;
    -125,29.9,870.3,-125,33.8,900.1;
    -125,32.3,631.5,-124.9,38.1,653.5;
    -125,33.7,598.8,-125,32.3,631.5;
    -125,33.8,900.1,-125,21.7,919.2;
    -125,34.4,726.7,-124.9,36.9,742;
    -125,34.8,670.2,-125,19.7,689.2;
    -125.1,23.3,569.1,-125,33.7,598.8;
    -125.1,33.4,204.9,-124.9,31.7,228.4;
    -135.5,34.6,156.2,-124.7,34.3,156.2;
    -147.9,36.8,156.2,-135.5,34.6,156.2;
    -23.5,54.4,1437.5,-12.7,52.4,1437.5;
    -249.9,12.7,-1125.3,-250,10.6,-1108.4;
    -249.9,4.8,-243.5,-250,6.8,-214.6;
    -250,10.1,-417.1,-250,8.5,-369.9;
    -250,10.2,-276.5,-249.9,4.8,-243.5;
    -250,10.4,-323.1,-250,10.2,-276.5;
    -250,10.6,-1065,-250,3.4,-1038;
    -250,10.6,-1108.4,-250,10.6,-1065;
    -250,11,-487,-250,6.9,-462.7;
    -250,11.6,-588.5,-250,7.4,-534;
    -250,3.1,-884.7,-250,7.4,-853.9;
    -250,3.9,-729.7,-250,5.5,-699.7;
    -250,4.7,-612.8,-250,11.6,-588.5;
    -250,5,-928.1,-250,3.1,-884.7;
    -250,5.5,-699.7,-250,4.7,-612.8;
    -250,6.5,-790.9,-250,8.1,-754.4;
    -250,6.9,-462.7,-250,10.1,-417.1;
    -250,7.4,-534,-250,11,-487;
    -250,7.4,-853.9,-250,6.5,-790.9;
    -250,8.1,-754.4,-250,3.9,-729.7;
    -250,8.5,-369.9,-250,10.4,-323.1;
    -269.9,10.5,-156.3,-297.5,9.7,-156.2;
    -293.9,8.7,156.2,-270,6.1,156.2;
    -297.5,9.7,-156.2,-335.8,10.1,-156.2;
    -3.7,53.1,1437.5,4.1,54.9,1437.5;
    -305.7,6.9,156.2,-293.9,8.7,156.2;
    -325.7,8.3,156.2,-305.7,6.9,156.2;
    -335.8,10.1,-156.2,-354.5,5,-156.2;
    -354.2,10.4,156.2,-325.7,8.3,156.2;
    -42.7,52.6,1437.5,-23.5,54.4,1437.5;
    -561,19,-156.2,-590.3,8.7,-156.2;
    -590.3,8.7,-156.2,-597.4,6.3,-156.2;
    -597.4,6.3,-156.2,-609.5,3.8,-156.2;
    -597.4,6.3,-156.2,-609.5,3.9,-156.2;
    -609.5,3.8,-156.2,-621.7,3.8,-156.2;
    -609.5,3.9,-156.2,-621.7,4,-156.2;
    -86.7,13,-1187.5,-101.8,13.2,-1187.5;
    123.4,41.1,187.5,135.3,36.6,187.3;
    124.6,11.4,1091.8,125.1,3.7,1072.1;
    124.9,10.6,1111.3,124.6,11.4,1091.8;
    124.9,5.9,1211.2,125,5.9,1169;
    124.9,5.9,1226.5,124.9,5.9,1211.2;
    124.9,7.9,1054.3,125,11.1,1002.8;
    124.9,8.4,1147.8,125,6.7,1130.4;
    125,11.1,1002.8,125,7.6,969.1;
    125,40.1,228.5,125,40.9,190;
    125,5.9,1169,124.9,8.4,1147.8;
    125,6.7,1130.4,124.9,10.6,1111.3;
    125,7.6,969.1,125.1,11.1,938.9;
    125.1,11.1,938.9,124.9,9,919.5;
    125.1,3.7,1072.1,124.9,7.9,1054.3;
    135.3,36.6,187.3,149.2,33.2,187.4;
    14.6,55.7,1437.5,20.9,54.2,1437.5;
    149.2,33.2,187.4,160.1,26.5,187.5;
    160.1,26.5,187.5,185.7,12.1,187.5;
    185.7,12.1,187.5,197.1,8.7,187.5;
    197.1,8.7,187.5,213.3,10.9,187.5;
    20.9,54.2,1437.5,39.9,56,1437.5;
    213.3,10.9,187.5,243.6,9.1,187.5;
    243.6,9.1,187.5,257.6,11.2,187.5;
    250,10,-1015.1,250,10,-1077.8;
    250,10,-184.7,250,10,-1015.1;
    257.2,10.9,-187.5,245.1,10,-187.5;
    257.6,11.2,187.5,269.6,41,187.5;
    269.6,41,187.5,293.3,39.5,187.4;
    273.3,18.3,-187.5,257.2,10.9,-187.5;
    293.3,39.5,187.4,303.7,41.7,187.4;
    294.4,30.7,-187.5,273.3,18.3,-187.5;
    303.7,41.7,187.4,317.9,40.3,187.4;
    306,33.2,-187.4,294.4,30.7,-187.5;
    317.9,40.3,187.4,333.2,41.7,187.5;
    333.2,41.7,187.5,354.2,43.6,187.3;
    338.7,31.1,-187.5,306,33.2,-187.4;
    353.6,32.8,-187.4,338.7,31.1,-187.5;
    354.2,43.6,187.3,366.6,5.2,187.4;
    366.6,5.2,187.4,378.4,5.5,187.4;
    378.4,5.5,187.4,388.7,4.3,187.4;
    4.1,54.9,1437.5,14.6,55.7,1437.5;
    499.6,4.8,187.5,511.1,9.2,187.4;
    511.1,9.2,187.4,526.3,7.2,187.5;
    526.3,7.2,187.5,536.6,7.9,187.5;
    536.6,7.9,187.5,548.8,10,187.5;
    548.8,10,187.5,828.2,10,187.5;
    828.2,10,-187.5,548.8,10,-187.5;
    840.3,10,-187.5,828.2,10,-187.5;
    876.8,10,187.5,888.9,10,187.5;
    937.5,10,-145.2,937.5,10,-187.5;
    937.5,10,18.5,937.5,10,13.2;
    937.5,10,23.8,937.5,10,18.5;
    937.5,10,81.9,937.5,10,76.6;
    937.5,10,87.1,937.5,10,81.9;
    937.5,10,92.4,937.5,10,87.1`

const BOTTOM_Y = -8 // below the lowest wave trough, hidden by the water
const INSET = 0.1 // wall sits just behind the lip so no sliver of the hollow shows at the top

export function applyRockClosure(root: THREE.Object3D): void {
  const src = root.getObjectByName('Terrain_Base001') as THREE.Mesh | undefined
  if (!src || !src.isMesh || Array.isArray(src.material)) return

  root.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const rows = SEAMS.split(';').map((s) => s.trim().split(',').map(Number))

  const pos = new Float32Array(rows.length * 6 * 3)
  const nor = new Float32Array(rows.length * 6 * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const d = new THREE.Vector3()
  const n = new THREE.Vector3()
  let o = 0
  const put = (v: THREE.Vector3): void => {
    // Normals are directions: only the rotation part matters (root has no scale or rotation here).
    v.applyMatrix4(toLocal)
    pos[o] = v.x
    pos[o + 1] = v.y
    pos[o + 2] = v.z
    nor[o] = n.x
    nor[o + 1] = n.y
    nor[o + 2] = n.z
    o += 3
  }

  let count = 0
  for (const r of rows) {
    if (r.length !== 6 || r.some((v) => !Number.isFinite(v))) continue
    const tx = r[3] - r[0]
    const tz = r[5] - r[2]
    const len = Math.hypot(tx, tz)
    if (len < 1e-4) continue
    n.set(-tz / len, 0, tx / len)
    const ix = -n.x * INSET
    const iz = -n.z * INSET
    a.set(r[0] + ix, r[1], r[2] + iz) // top, start
    b.set(r[3] + ix, r[4], r[5] + iz) // top, end
    c.set(r[3] + ix, BOTTOM_Y, r[5] + iz) // bottom, end
    d.set(r[0] + ix, BOTTOM_Y, r[2] + iz) // bottom, start
    // two triangles, wound so the face normal is the outward one
    put(a.clone()); put(c.clone()); put(b.clone())
    put(a.clone()); put(d.clone()); put(c.clone())
    count++
  }
  if (!count) return

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, count * 18), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, count * 18), 3))
  g.computeBoundingSphere()
  g.computeBoundingBox()

  const wall = new THREE.Mesh(g, src.material)
  wall.name = 'RockSeamClosure'
  wall.castShadow = src.castShadow
  wall.receiveShadow = src.receiveShadow
  root.add(wall)
}
import * as THREE from 'three'

// Covers rock faces around the port that show their hollow back side.
//
// The terrain and the west cliff are thin shells. A number of their triangles face away from the
// places a player can see them from, so the game draws their back side, lit as if from inside the rock,
// and they read as dark empty pockets. Each row below is one such triangle (x,y,z for three corners, in
// world space, found by checking every rock triangle around the port from outside). The module adds a
// copy of each one turned the right way round and a hair in front of the original, using the same
// material, so the face is drawn as ordinary rock. The original geometry is not touched and nothing
// here has a collider.

const TRIS = `-835.9,36.6,-114.6,-837.3,36.6,-135.4,-840.7,38.5,-135.4;-837.6,50.7,-113.6,-837.4,49.2,-134.6,-835.9,33.3,-135.5;-937.5,6.9,156.3,-930.8,8.7,156.3,-937.5,8.8,156.3;-904.2,5.8,156.3,-897.5,8.5,156.3,-904.2,7.7,156.3;-897.5,6.6,156.3,-890.8,8,156.3,-897.5,8.5,156.3;-877.5,1.9,156.3,-870.8,4.5,156.3,-877.5,3.8,156.3;-870.8,6.4,156.3,-864.2,7.4,156.3,-870.8,8.4,156.3;-844.2,4.6,156.3,-837.5,10.7,156.3,-844.2,6.5,156.3;-844.2,6.5,156.3,-837.5,12.7,156.3,-844.2,8.4,156.3;-937.5,23.3,-72.9,-930.8,24.9,-72.9,-930.8,26.5,-93.8;-930.8,24.9,-72.9,-924.2,29.5,-72.9,-924.2,30.7,-93.8;-930.8,24.9,-72.9,-924.2,30.7,-93.8,-930.8,26.5,-93.8;-924.2,32.9,-52.1,-917.5,37.7,-72.9,-924.2,29.5,-72.9;-924.2,32.3,-114.6,-917.5,36,-114.6,-917.5,34.3,-135.4;-917.5,36,-114.6,-910.8,38.2,-135.4,-917.5,34.3,-135.4;-937.5,-0.7,10.4,-930.8,2.3,10.4,-930.8,24.8,-10.4;-937.5,-0.7,10.4,-930.8,24.8,-10.4,-937.5,18.1,-10.4;-937.5,22.2,-93.7,-930.8,26.5,-93.8,-930.8,23.4,-114.6;-937.5,18.5,-114.6,-930.8,23.4,-114.6,-930.8,22.9,-135.4;-930.8,23.4,-114.6,-924.2,32.6,-114.6,-924.2,32.7,-135.4;-924.2,9.2,52.1,-917.5,24.3,31.2,-924.2,8.9,31.2;-910.8,42.7,-93.8,-904.2,43.9,-114.6,-910.8,41.8,-114.6;-910.8,41.8,-114.6,-904.2,43.9,-114.6,-904.2,42.8,-135.4;-910.8,41.8,-114.6,-904.2,42.8,-135.4,-910.8,38.2,-135.4;-904.2,43.9,-114.6,-897.5,47.4,-135.4,-904.2,42.8,-135.4;-937.5,18.6,-74.7,-937.5,19.6,-100.3,-962.8,-2.6,-95.8;-937.5,18.6,-74.7,-962.8,-2.6,-95.8,-962.8,-2.2,-79.2;-937.5,17.3,-101.6,-937.5,22.4,-123.4,-951.9,10,-119.6;-937.5,17.3,-101.6,-951.9,10,-119.6,-951.9,8.6,-105.4;-548.7,-26.2,-156,-561,19,-156.2,-560.5,25,-143.5;-836.3,3.7,-134.2,-828,3.8,-137.3,-840.3,50.8,-138.6;-937.5,19.8,-41.8,-917.8,34,-43.1,-937.5,18.9,-46.2;-921.9,30.9,-108.5,-937.5,19.3,-112.2,-937.5,18.1,-107.8;-937.5,17.9,-125.4,-915.3,37.5,-127.3,-937.5,17,-129.8;-909.6,42.5,-89.3,-900,47.5,-97.7,-919.9,34.7,-99.3;-937.5,21.3,-33,-937.5,18.2,-28.6,-925.4,28.8,-28.6;-937.5,21.3,-33,-925.4,28.8,-28.6,-915.6,38.6,-33.4;-937.5,20,-55,-937.5,19.6,-50.6,-916.5,39.1,-48.5;-937.5,19,-68.2,-937.5,19.4,-63.8,-925.4,28.4,-63.8;-925.4,31.7,-72.6,-937.5,20.7,-72.6,-937.5,19,-68.2;-937.5,21.3,-90.2,-937.5,18.2,-85.8,-925.4,32,-85.8;-937.5,17.4,-116.6,-937.5,19.3,-112.2,-921.9,30.9,-108.5;-915.3,37.5,-127.3,-937.5,19.2,-121,-926,32,-117.5;-937.5,17.3,-134.2,-937.5,17,-129.8,-915.3,37.5,-127.3;-913.2,39.1,-63.8,-925.4,28.4,-63.8,-926.2,30.9,-55.6;-925.4,34.3,-68.2,-925.4,28.4,-63.8,-913.2,39.1,-63.8;-925.4,34.3,-68.2,-913.2,39.1,-63.8,-901.3,48.8,-68.2;-925,34,-94.4,-902.3,45.4,-84.8,-909.6,42.5,-89.3;-925.4,33.9,-77,-914.6,38.2,-75.9,-910.2,42.8,-80.4;-926,32,-117.5,-921.9,30.9,-108.5,-913.2,39.9,-112.2;-921.9,30.9,-108.5,-918.3,37.6,-103.9,-913.2,39.9,-112.2;-918.3,37.6,-103.9,-919.9,34.7,-99.3,-900,47.5,-97.7;-898.1,48.4,-115.3,-913.2,39.9,-112.2,-918.3,37.6,-103.9;-901.6,46.2,-129.4,-915.3,37.5,-127.3,-913.9,37.2,-119;-840.3,46.7,-156.3,-828,3.8,-137.3,-828.2,3.8,-156.3`

const LIFT = 0.15 // how far the copy sits in front of the original face, in metres
const LEAN = 0.45 // upward lean of the shading normal, same as the rock closure walls

export function applyRockFaceFix(root: THREE.Object3D): void {
  const src = root.getObjectByName('Terrain_Base001') as THREE.Mesh | undefined
  if (!src || !src.isMesh || Array.isArray(src.material)) return

  root.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert()

  const pos: number[] = []
  const nor: number[] = []
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const N = new THREE.Vector3()
  const v = new THREE.Vector3()

  for (const row of TRIS.split(';')) {
    const r = row.trim().split(',').map(Number)
    if (r.length !== 9 || r.some((n) => !Number.isFinite(n))) continue
    for (let i = 0; i < 3; i++) P[i].set(r[i * 3], r[i * 3 + 1], r[i * 3 + 2])
    e1.subVectors(P[1], P[0])
    e2.subVectors(P[2], P[0])
    // the original winding faces away from the viewer, so the turned copy uses the opposite normal
    N.crossVectors(e1, e2)
    if (N.lengthSq() < 1e-8) continue
    N.normalize().negate()
    const sl = Math.hypot(N.x, N.y + LEAN, N.z)
    // swap two corners so the copy faces the way N points
    for (const i of [0, 2, 1]) {
      v.copy(P[i]).addScaledVector(N, LIFT).applyMatrix4(toLocal)
      pos.push(v.x, v.y, v.z)
      nor.push(N.x / sl, (N.y + LEAN) / sl, N.z / sl)
    }
  }
  if (!pos.length) return

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3))
  g.computeBoundingSphere()
  g.computeBoundingBox()

  const fix = new THREE.Mesh(g, src.material)
  fix.name = 'RockFaceFix'
  fix.castShadow = src.castShadow
  fix.receiveShadow = src.receiveShadow
  root.add(fix)
}
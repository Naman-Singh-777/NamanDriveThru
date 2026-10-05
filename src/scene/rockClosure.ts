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
    937.5,10,92.4,937.5,10,87.1;
    75,39.1,-81.8,75,53.8,-71.3;
    75,42.1,101.5,75,42.7,114.7;
    75,64.7,76.6,75,64.7,87.3;
    -112.7,42,75,-124.9,44.1,75;
    -75.7,59.5,75,-86.2,60.7,75;
    -72.2,53.8,75,-75.7,59.5,75;
    90.8,62,75,83.7,69.1,75;
    124.9,60.5,75,113.2,62.5,75;
    75.9,70.2,75,75.7,69.4,75;
    81,52.1,-75,90.1,46.1,-74.9;
    -75,52.9,121.3,-75,52.4,106.1;
    -75,54.6,91,-75,78.7,85.7;
    -75,52.4,106.1,-75,54.6,91;
    -75,76.6,77,-75,53.8,72.6;
    -75,78.7,85.7,-75,76.6,77;
    -75,49.6,-85.8,-75,37.4,-90.4;
    -75,53.8,-72.6,-75,50.5,-77;
    -75,50.5,-77,-75,49.6,-85.8;
    -75,37.4,-90.4,-75,38.2,-115.1;
    75,41.3,91.9,75,42.1,101.5;
    75,64.7,87.3,75,41.3,91.9;
    75,53.8,71.3,75,64.7,76.6;
    75,33.8,-89,75,39.1,-81.8;
    75,26.7,-92.3,75,33.8,-89;
    96.7,29.7,-103.3,75.1,27.2,-114.7;
    75.1,27.2,-114.7,75,26.7,-92.3;
    75,29.2,-120.9,75.1,27.2,-114.7;
    87.1,28.8,-108.3,96.7,29.7,-103.3;
    75.1,27.2,-114.7,87.1,28.8,-108.3;
    -89.9,47.3,75,-96.6,45,75;
    -96.6,45,75,-112.7,42,75;
    -86.2,60.7,75,-89.9,47.3,75;
    83.7,69.1,75,75.9,70.2,75;
    75.9,70.2,75,72.2,53.8,75;
    94.4,61.9,75,90.8,62,75;
    113.2,62.5,75,94.4,61.9,75;
    -110.4,42.9,-75,-88.5,43.8,-75;
    -88.5,43.8,-75,-81,59,-75;
    -81,59,-75,-73.9,53.8,-75;
    73.9,53.8,-75,81,52.1,-75;
    90.1,46.1,-74.9,97.2,47.6,-75;
    97.2,47.6,-75,119.5,45.7,-75`

const BOTTOM_Y = -8 // below the lowest wave trough, hidden by the water
const INSET = 0.1 // wall sits just behind the lip so no sliver of the hollow shows at the top
const CELL = 3.5 // grid size of the wall, in metres
const LEAN = 0.45 // upward lean of the shading normal
const BULGE = 2.4 // how far the rock face can push out of the wall plane, in metres

// Smooth value noise in 3D (deterministic, so neighbouring wall pieces always agree).
const rnd = (x: number, y: number, z: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
const fade = (t: number): number => t * t * (3 - 2 * t)
const vnoise = (x: number, y: number, z: number): number => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const fz = fade(z - iz)
  const l = (a: number, b: number, t: number): number => a + (b - a) * t
  return l(
    l(l(rnd(ix, iy, iz), rnd(ix + 1, iy, iz), fx), l(rnd(ix, iy + 1, iz), rnd(ix + 1, iy + 1, iz), fx), fy),
    l(l(rnd(ix, iy, iz + 1), rnd(ix + 1, iy, iz + 1), fx), l(rnd(ix, iy + 1, iz + 1), rnd(ix + 1, iy + 1, iz + 1), fx), fy),
    fz
  )
}

interface Seam {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  nx: number; nz: number // outward normal of the segment
  na: [number, number] // outward normal at the start, averaged with the neighbouring segments
  nb: [number, number] // ... and at the end, so the pieces meet without cracks
  bulge: number
}

export function applyRockClosure(root: THREE.Object3D): void {
  const src = root.getObjectByName('Terrain_Base001') as THREE.Mesh | undefined
  if (!src || !src.isMesh || Array.isArray(src.material)) return

  root.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert()

  // Parse, drop zero-length rows and the near-duplicate rows left by the doubled terrain triangles.
  const seams: Seam[] = []
  for (const s of SEAMS.split(';')) {
    const r = s.trim().split(',').map(Number)
    if (r.length !== 6 || r.some((v) => !Number.isFinite(v))) continue
    const tx = r[3] - r[0]
    const tz = r[5] - r[2]
    const len = Math.hypot(tx, tz)
    if (len < 1e-3) continue
    const dup = seams.some(
      (q) =>
        Math.abs(q.ax - r[0]) < 0.4 && Math.abs(q.az - r[2]) < 0.4 && Math.abs(q.ay - r[1]) < 1.5 &&
        Math.abs(q.bx - r[3]) < 0.4 && Math.abs(q.bz - r[5]) < 0.4 && Math.abs(q.by - r[4]) < 1.5
    )
    if (dup) continue
    // Around the road junction the rock must not push far over the road corners.
    const mx = (r[0] + r[3]) / 2
    const mz = (r[2] + r[5]) / 2
    const nearJunction = Math.abs(mx) < 125 && Math.abs(mz) < 125
    const nx = -tz / len
    const nz = tx / len
    seams.push({
      ax: r[0], ay: r[1], az: r[2], bx: r[3], by: r[4], bz: r[5],
      nx, nz, na: [nx, nz], nb: [nx, nz], bulge: nearJunction ? 0.9 : BULGE
    })
  }
  // Average the normal at shared end points.
  const avg = (x: number, z: number, y: number, self: Seam): [number, number] => {
    let sx = self.nx
    let sz = self.nz
    for (const q of seams) {
      if (q === self) continue
      for (const e of [[q.ax, q.ay, q.az], [q.bx, q.by, q.bz]]) {
        if (Math.abs(e[0] - x) < 0.4 && Math.abs(e[2] - z) < 0.4 && Math.abs(e[1] - y) < 1.5 && q.nx * self.nx + q.nz * self.nz > 0.2) {
          sx += q.nx
          sz += q.nz
        }
      }
    }
    const l = Math.hypot(sx, sz) || 1
    return [sx / l, sz / l]
  }
  for (const s of seams) {
    s.na = avg(s.ax, s.az, s.ay, s)
    s.nb = avg(s.bx, s.bz, s.by, s)
  }

  const pos: number[] = []
  const nor: number[] = []
  const v = new THREE.Vector3()
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  const C = new THREE.Vector3()
  const N = new THREE.Vector3()
  const tri = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, ox: number, oz: number): void => {
    A.subVectors(p1, p0)
    B.subVectors(p2, p0)
    N.crossVectors(A, B)
    if (N.lengthSq() < 1e-10) return
    N.normalize()
    // keep every face looking out of the rock
    const flip = N.x * ox + N.z * oz < -0.0
    const pts = flip ? [p0, p2, p1] : [p0, p1, p2]
    if (flip) N.negate()
    // Lit as a steep rock slope rather than a sheer cliff: the shading normal leans a little upwards,
    // so faces turned away from the moon do not turn into black holes.
    const sl = Math.hypot(N.x, N.y + LEAN, N.z)
    for (const p of pts) {
      v.copy(p).applyMatrix4(toLocal)
      pos.push(v.x, v.y, v.z)
      nor.push(N.x / sl, (N.y + LEAN) / sl, N.z / sl)
    }
  }

  const grid: THREE.Vector3[][] = []
  for (const s of seams) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
    const cols = Math.max(1, Math.ceil(len / CELL))
    const hMax = Math.max(s.ay, s.by) - BOTTOM_Y
    const rows = Math.max(2, Math.ceil(hMax / CELL))
    grid.length = 0
    for (let c = 0; c <= cols; c++) {
      const u = c / cols
      const x0 = s.ax + (s.bx - s.ax) * u
      const z0 = s.az + (s.bz - s.az) * u
      const yTop = s.ay + (s.by - s.ay) * u
      let ux = s.na[0] + (s.nb[0] - s.na[0]) * u
      let uz = s.na[1] + (s.nb[1] - s.na[1]) * u
      const ul = Math.hypot(ux, uz) || 1
      ux /= ul
      uz /= ul
      const col: THREE.Vector3[] = []
      for (let r = 0; r <= rows; r++) {
        const t = r / rows
        const y = yTop + (BOTTOM_Y - yTop) * t
        // rock-like push-out: none on the lip, growing down the face
        const w = fade(Math.min(1, t / 0.3))
        const n = 0.62 * vnoise(x0 / 7, y / 5.5, z0 / 7) + 0.38 * vnoise(x0 / 2.6 + 9.1, y / 2.3, z0 / 2.6)
        const d = INSET * -1 + s.bulge * w * Math.pow(n, 1.35) * 1.5
        col.push(new THREE.Vector3(x0 + ux * d, y, z0 + uz * d))
      }
      grid.push(col)
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const p00 = grid[c][r]
        const p10 = grid[c + 1][r]
        const p01 = grid[c][r + 1]
        const p11 = grid[c + 1][r + 1]
        if (rnd(c, r, s.ax + s.az) > 0.5) {
          tri(p00, p01, p11, s.nx, s.nz)
          tri(p00, p11, p10, s.nx, s.nz)
        } else {
          tri(p00, p01, p10, s.nx, s.nz)
          tri(p10, p01, p11, s.nx, s.nz)
        }
      }
    }
  }
  if (!pos.length) return

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3))
  g.computeBoundingSphere()
  g.computeBoundingBox()

  const wall = new THREE.Mesh(g, src.material)
  wall.name = 'RockSeamClosure'
  wall.castShadow = src.castShadow
  wall.receiveShadow = src.receiveShadow
  root.add(wall)
}
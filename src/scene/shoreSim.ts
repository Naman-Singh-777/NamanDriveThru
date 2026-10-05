import * as THREE from 'three'
import { sceneTime } from './glslCommon'
import { SWELL, swellEnvelope } from './swell'

// Rock wash simulation.
//
// The sea around the causeway is a baked, nearly flat mesh, so waves cannot be shown by moving
// it. What can be done, and what actually happens on a real shore, is the water running up the
// rock when a swell arrives. This module simulates that:
//
//  1. The waterline is read from the real rock meshes (their intersection with sea level),
//     stitched into chains and resampled every few metres. Each sample knows which way the
//     sea is (down the slope) and how steep the rock is there.
//  2. Each sample is driven by the same swell the water shader draws (swell.ts), but only by the
//     components travelling toward that piece of rock, so windward rock gets hit harder than
//     sheltered rock. Rising water at the wall (elevation rate above a threshold) is a strike.
//  3. A strike launches a tongue of water up the rock: a ballistic body with gravity and drag
//     (the standard swash model), so it climbs, stalls and runs back down. Strikes get a random
//     strength and a random cool-down, so they are not evenly spaced.
//  4. The highest point the water reached stays damp and dries slowly. That memory, the live
//     tongue and the foam left by the last strike are written to a texture that the rock and
//     water shaders read, and each strike throws a handful of spray droplets.
//
// Everything is a material or an extra object, no scene geometry is edited.

const WATER_LEVEL = 0 // baked sea level; the mesh wanders about +-1 m around it
const MAX_SAMPLES = 2000
const MAX_RANGE = 60 // metres from the waterline that the lookup texture covers
const THRESHOLD = 0.2 // m/s of rising water at the wall that counts as a strike
const GRAV = 5.4 // m/s^2 acting on the tongue (gravity, partly carried by the slope)
const DRY_RATE = 0.035 // m/s the damp line sinks when nothing wets it
const MAX_SPRAY = 900
const SPRAY_RANGE = 700

export interface ShoreSim {
  uniforms: {
    uShoreId: { value: THREE.Texture }
    uShoreDist: { value: THREE.Texture }
    uShoreState: { value: THREE.Texture }
    uShoreBox: { value: THREE.Vector4 } // minX, minZ, 1/width, 1/depth
    uShoreN: { value: number }
  }
  spray: THREE.Points
}

interface Seg {
  ax: number
  az: number
  bx: number
  bz: number
  nx: number
  nz: number
  tb: number
  used: boolean
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Height of the baked sea at x, z. The mesh is a regular grid, so this is a bilinear lookup.
function makeWaterSampler(ocean: THREE.Mesh | null): (x: number, z: number) => number {
  if (!ocean) return () => WATER_LEVEL
  ocean.updateMatrixWorld(true)
  const pos = ocean.geometry.getAttribute('position')
  const m = ocean.matrixWorld.elements
  const plain = Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[5] - 1) < 1e-6 && Math.abs(m[10] - 1) < 1e-6 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9
  if (!plain) return () => WATER_LEVEL
  const ox = m[12]
  const oy = m[13]
  const oz = m[14]
  const z0 = pos.getZ(0)
  let cols = 1
  while (cols < pos.count && Math.abs(pos.getZ(cols) - z0) < 1e-3) cols++
  if (cols < 2 || cols >= pos.count) return () => WATER_LEVEL
  const rows = Math.floor(pos.count / cols)
  const x0 = pos.getX(0)
  const dx = pos.getX(1) - x0
  const dz = pos.getZ(cols) - z0
  if (!dx || !dz) return () => WATER_LEVEL
  // verify the grid assumption on a few vertices
  for (const i of [cols + 3, Math.floor(pos.count / 2), pos.count - 1]) {
    const cx = i % cols
    const cz = Math.floor(i / cols)
    if (Math.abs(pos.getX(i) - (x0 + cx * dx)) > 0.05 || Math.abs(pos.getZ(i) - (z0 + cz * dz)) > 0.05) return () => WATER_LEVEL
  }
  return (x: number, z: number): number => {
    const gx = Math.min(Math.max((x - ox - x0) / dx, 0), cols - 1.001)
    const gz = Math.min(Math.max((z - oz - z0) / dz, 0), rows - 1.001)
    const ix = Math.floor(gx)
    const iz = Math.floor(gz)
    const fx = gx - ix
    const fz = gz - iz
    const y = (cx: number, cz: number): number => pos.getY(cz * cols + cx)
    const a = y(ix, iz) * (1 - fx) + y(ix + 1, iz) * fx
    const b = y(ix, iz + 1) * (1 - fx) + y(ix + 1, iz + 1) * fx
    return oy + a * (1 - fz) + b * fz
  }
}

export function buildShoreSim(root: THREE.Object3D): ShoreSim | null {
  root.updateMatrixWorld(true)
  const rocks: THREE.Mesh[] = []
  let ocean: THREE.Mesh | null = null
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const mat = mesh.material as THREE.Material | undefined
    if (mat && /water/i.test(mat.name)) ocean = mesh
    else if (/cliff|terrain|headland|bedrock|rock_master/i.test(mesh.name)) rocks.push(mesh)
  })
  if (!rocks.length) return null
  const waterAt = makeWaterSampler(ocean)

  // ---- 1. waterline: where each rock triangle crosses sea level ----
  const segs: Seg[] = []
  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  for (const mesh of rocks) {
    const pos = mesh.geometry.getAttribute('position')
    const idx = mesh.geometry.index
    const count = idx ? idx.count : pos.count
    const M = mesh.matrixWorld
    for (let t = 0; t + 2 < count; t += 3) {
      va.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(M)
      vb.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(M)
      vc.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(M)
      const da = va.y - WATER_LEVEL
      const db = vb.y - WATER_LEVEL
      const dc = vc.y - WATER_LEVEL
      if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue
      const pts: number[] = []
      const cross = (p: THREE.Vector3, dp: number, q: THREE.Vector3, dq: number): void => {
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
          const s = dp / (dp - dq)
          pts.push(p.x + (q.x - p.x) * s, p.z + (q.z - p.z) * s)
        }
      }
      cross(va, da, vb, db)
      cross(vb, db, vc, dc)
      cross(vc, dc, va, da)
      if (pts.length !== 4) continue
      e1.subVectors(vb, va)
      e2.subVectors(vc, va)
      nrm.crossVectors(e1, e2)
      if (nrm.y < 0) nrm.negate()
      const hz = Math.hypot(nrm.x, nrm.z)
      if (nrm.y < 1e-4 && hz < 1e-4) continue
      segs.push({
        ax: pts[0], az: pts[1], bx: pts[2], bz: pts[3],
        nx: hz > 1e-6 ? nrm.x / hz : 0, nz: hz > 1e-6 ? nrm.z / hz : 0,
        tb: Math.min(hz / Math.max(nrm.y, 1e-3), 8),
        used: false
      })
    }
  }
  if (segs.length < 8) return null
  // ---- 2. stitch the pieces into chains (shared end points) ----
  const key = (x: number, z: number): string => `${Math.round(x * 20)},${Math.round(z * 20)}`
  const ends = new Map<string, number[]>()
  const addEnd = (k: string, i: number): void => {
    const l = ends.get(k)
    if (l) l.push(i)
    else ends.set(k, [i])
  }
  segs.forEach((s, i) => {
    addEnd(key(s.ax, s.az), i)
    addEnd(key(s.bx, s.bz), i)
  })
  // next unused piece that touches (x, z), turned so it starts there
  const takeNext = (x: number, z: number): Seg | null => {
    const k = key(x, z)
    const l = ends.get(k)
    if (!l) return null
    for (const i of l) {
      const s = segs[i]
      if (s.used) continue
      s.used = true
      if (key(s.ax, s.az) !== k) {
        const tx = s.ax
        const tz = s.az
        s.ax = s.bx
        s.az = s.bz
        s.bx = tx
        s.bz = tz
      }
      return s
    }
    return null
  }
  const chains: Seg[][] = []
  for (const s0 of segs) {
    if (s0.used) continue
    s0.used = true
    const chain: Seg[] = [s0]
    for (;;) {
      const last = chain[chain.length - 1]
      const nx = takeNext(last.bx, last.bz)
      if (!nx) break
      chain.push(nx)
    }
    for (;;) {
      const first = chain[0]
      const pv = takeNext(first.ax, first.az) // starts at first.a, so it runs away from the chain
      if (!pv) break
      const tx = pv.ax
      const tz = pv.az
      pv.ax = pv.bx
      pv.az = pv.bz
      pv.bx = tx
      pv.bz = tz
      chain.unshift(pv)
    }
    chains.push(chain)
  }

  // ---- 3. resample every few metres ----
  let total = 0
  for (const ch of chains) for (const s of ch) total += Math.hypot(s.bx - s.ax, s.bz - s.az)
  const ds = Math.max(8, total / (MAX_SAMPLES - chains.length * 2))
  const sx: number[] = []
  const sz: number[] = []
  const snx: number[] = []
  const snz: number[] = []
  const stb: number[] = []
  const linkNext: boolean[] = [] // sample i and i+1 belong to the same chain
  for (const ch of chains) {
    let len = 0
    for (const s of ch) len += Math.hypot(s.bx - s.ax, s.bz - s.az)
    if (len < 1) continue
    const n = Math.max(2, Math.ceil(len / ds) + 1)
    let si = 0
    let acc = 0
    for (let k = 0; k < n; k++) {
      const target = (k / (n - 1)) * len
      while (si < ch.length - 1 && acc + Math.hypot(ch[si].bx - ch[si].ax, ch[si].bz - ch[si].az) < target) {
        acc += Math.hypot(ch[si].bx - ch[si].ax, ch[si].bz - ch[si].az)
        si++
      }
      const s = ch[si]
      const sl = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1
      const f = Math.min(Math.max((target - acc) / sl, 0), 1)
      sx.push(s.ax + (s.bx - s.ax) * f)
      sz.push(s.az + (s.bz - s.az) * f)
      snx.push(s.nx)
      snz.push(s.nz)
      stb.push(s.tb)
      linkNext.push(k < n - 1)
    }
  }
  const S = sx.length
  if (S < 4 || S > MAX_SAMPLES + 400) return null
  // a piece with no usable slope direction takes it from the nearest sample that has one
  for (let i = 0; i < S; i++) {
    if (Math.hypot(snx[i], snz[i]) > 0.5) continue
    for (let r = 1; r < 6; r++) {
      const j = [i - r, i + r].find((q) => q >= 0 && q < S && Math.hypot(snx[q], snz[q]) > 0.5)
      if (j !== undefined) {
        snx[i] = snx[j]
        snz[i] = snz[j]
        break
      }
    }
    if (Math.hypot(snx[i], snz[i]) < 0.5) {
      snx[i] = 1
      snz[i] = 0
    }
  }

  // ---- 4. lookup texture: for every ground cell, which sample is nearest and how far ----
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < S; i++) {
    minX = Math.min(minX, sx[i])
    maxX = Math.max(maxX, sx[i])
    minZ = Math.min(minZ, sz[i])
    maxZ = Math.max(maxZ, sz[i])
  }
  minX -= MAX_RANGE + 10
  minZ -= MAX_RANGE + 10
  maxX += MAX_RANGE + 10
  maxZ += MAX_RANGE + 10
  let cell = 4
  while (((maxX - minX) / cell) * ((maxZ - minZ) / cell) > 700000) cell *= 1.25
  const W = Math.ceil((maxX - minX) / cell)
  const H = Math.ceil((maxZ - minZ) / cell)
  const HC = 20 // hash cell for the nearest-piece search
  const hash = new Map<number, number[]>()
  const hk = (ix: number, iz: number): number => ix * 100003 + iz
  for (let i = 0; i < S - 1; i++) {
    if (!linkNext[i]) continue
    const x0 = Math.min(sx[i], sx[i + 1])
    const x1 = Math.max(sx[i], sx[i + 1])
    const z0 = Math.min(sz[i], sz[i + 1])
    const z1 = Math.max(sz[i], sz[i + 1])
    for (let ix = Math.floor(x0 / HC); ix <= Math.floor(x1 / HC); ix++) {
      for (let iz = Math.floor(z0 / HC); iz <= Math.floor(z1 / HC); iz++) {
        const k = hk(ix, iz)
        const l = hash.get(k)
        if (l) l.push(i)
        else hash.set(k, [i])
      }
    }
  }
  const idData = new Float32Array(W * H * 2)
  const distData = new Uint16Array(W * H)
  const reach = Math.ceil(MAX_RANGE / HC)
  for (let cz = 0; cz < H; cz++) {
    const z = minZ + (cz + 0.5) * cell
    for (let cx = 0; cx < W; cx++) {
      const x = minX + (cx + 0.5) * cell
      const o = (cz * W + cx) * 2
      let bestD = MAX_RANGE
      let bestU = -1
      const hx = Math.floor(x / HC)
      const hz = Math.floor(z / HC)
      for (let ix = hx - reach; ix <= hx + reach; ix++) {
        for (let iz = hz - reach; iz <= hz + reach; iz++) {
          const l = hash.get(hk(ix, iz))
          if (!l) continue
          for (const i of l) {
            const ax = sx[i]
            const az = sz[i]
            const bx = sx[i + 1] - ax
            const bz = sz[i + 1] - az
            const ll = bx * bx + bz * bz || 1
            const t = Math.min(Math.max(((x - ax) * bx + (z - az) * bz) / ll, 0), 1)
            const d = Math.hypot(x - (ax + bx * t), z - (az + bz * t))
            if (d < bestD) {
              bestD = d
              bestU = i + t
            }
          }
        }
      }
      idData[o] = bestU
      idData[o + 1] = bestU < 0 ? 999 : bestD
      distData[cz * W + cx] = THREE.DataUtils.toHalfFloat(bestU < 0 ? MAX_RANGE : bestD)
    }
  }
  const idTex = new THREE.DataTexture(idData, W, H, THREE.RGFormat, THREE.FloatType)
  idTex.minFilter = THREE.NearestFilter
  idTex.magFilter = THREE.NearestFilter
  idTex.generateMipmaps = false
  idTex.needsUpdate = true
  // distance to the waterline in its own texture so it can be filtered smoothly (no square cells)
  const distTex = new THREE.DataTexture(distData, W, H, THREE.RedFormat, THREE.HalfFloatType)
  distTex.minFilter = THREE.LinearFilter
  distTex.magFilter = THREE.LinearFilter
  distTex.generateMipmaps = false
  distTex.needsUpdate = true
  // ---- 5. per-sample constants for the swell that reaches each piece of rock ----
  const NC = SWELL.length
  const sp = new Float32Array(S * NC) // phase of component c at the wall
  const wt = new Float32Array(S * NC) // how directly component c runs into this wall
  const water = new Float32Array(S)
  const refl = new Float32Array(S)
  const luck = new Float32Array(S)
  const expo = new Float32Array(S)
  const rnd = rng(90210)
  let ampSum = 0
  for (const c of SWELL) ampSum += c.amp * c.amp
  for (let i = 0; i < S; i++) {
    water[i] = waterAt(sx[i] + snx[i] * 6, sz[i] + snz[i] * 6)
    refl[i] = 1 + 0.9 * Math.min(Math.max(stb[i] / 1.5, 0), 1) // steep rock reflects, a standing wave doubles the rise
    luck[i] = 0.7 + 0.6 * rnd()
    let ex = 0
    for (let c = 0; c < NC; c++) {
      const k = SWELL[c]
      sp[i * NC + c] = k.k * (k.dx * sx[i] + k.dz * sz[i]) + k.phi
      const w = 0.12 + 0.88 * Math.max(0, -(k.dx * snx[i] + k.dz * snz[i]))
      wt[i * NC + c] = w
      ex += w * w * k.amp * k.amp
    }
    expo[i] = Math.sqrt(ex / ampSum)
  }

  // ---- 6. state texture (what the shaders read) ----
  const N = S + 1
  const stateData = new Float32Array(N * 4)
  const hMem = new Float32Array(S)
  const exc = new Float32Array(S)
  const excV = new Float32Array(S)
  const cool = new Float32Array(S)
  const foam = new Float32Array(S)
  for (let i = 0; i < S; i++) {
    hMem[i] = water[i] + 0.2
    cool[i] = rnd() * 3
    stateData[i * 4] = water[i]
    stateData[i * 4 + 1] = hMem[i]
    stateData[i * 4 + 3] = water[i]
  }
  const stateTex = new THREE.DataTexture(stateData, N, 1, THREE.RGBAFormat, THREE.FloatType)
  stateTex.minFilter = THREE.NearestFilter
  stateTex.magFilter = THREE.NearestFilter
  stateTex.generateMipmaps = false
  stateTex.needsUpdate = true

  // ---- 7. spray droplets ----
  const sprayPos = new Float32Array(MAX_SPRAY * 3)
  const sprayVel = new Float32Array(MAX_SPRAY * 3)
  const sprayLife = new Float32Array(MAX_SPRAY)
  const sprayMax = new Float32Array(MAX_SPRAY)
  const sprayAlpha = new Float32Array(MAX_SPRAY)
  const spraySize = new Float32Array(MAX_SPRAY)
  for (let i = 0; i < MAX_SPRAY; i++) sprayPos[i * 3 + 1] = -9999
  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(sprayPos, 3)
  const alphaAttr = new THREE.BufferAttribute(sprayAlpha, 1)
  const sizeAttr = new THREE.BufferAttribute(spraySize, 1)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  alphaAttr.setUsage(THREE.DynamicDrawUsage)
  sizeAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('aAlpha', alphaAttr)
  geo.setAttribute('aSize', sizeAttr)
  const sprayUniforms = { uScale: { value: 600 } }
  const sprayMat = new THREE.ShaderMaterial({
    uniforms: sprayUniforms,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      uniform float uScale;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 1.0, 48.0);
        vA = aAlpha;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.78, 0.86, 0.96) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  })
  const spray = new THREE.Points(geo, sprayMat)
  spray.frustumCulled = false
  spray.renderOrder = 3
  let sprayCursor = 0

  const emit = (i: number, v0: number): void => {
    const n = 3 + Math.floor(v0 * 1.2)
    for (let q = 0; q < n; q++) {
      const s = sprayCursor
      sprayCursor = (sprayCursor + 1) % MAX_SPRAY
      const spread = 0.25 + 0.6 * rnd()
      const up = (0.55 + 0.6 * rnd()) * v0
      const tang = (rnd() - 0.5) * 0.9 * v0
      const o = s * 3
      const along = (rnd() - 0.5) * 6
      const out = 0.4 + rnd() * 1.6
      sprayPos[o] = sx[i] + snx[i] * out - snz[i] * along
      sprayPos[o + 1] = water[i] + 0.3 + rnd() * 0.8
      sprayPos[o + 2] = sz[i] + snz[i] * out + snx[i] * along
      sprayVel[o] = snx[i] * spread * v0 * 0.5 - snz[i] * tang * 0.35
      sprayVel[o + 1] = up
      sprayVel[o + 2] = snz[i] * spread * v0 * 0.5 + snx[i] * tang * 0.35
      sprayMax[s] = 0.9 + rnd() * 1.4
      sprayLife[s] = sprayMax[s]
      spraySize[s] = 0.7 + rnd() * 1.1
    }
    sizeAttr.needsUpdate = true
  }

  // ---- 8. the simulation step, run once per rendered frame ----
  let lastT = -1
  const camPos = new THREE.Vector3()
  const env = new Float32Array(NC)
  const step = (t: number, dt: number): void => {
    for (let c = 0; c < NC; c++) env[c] = swellEnvelope(SWELL[c], t)
    for (let i = 0; i < S; i++) {
      let eta = 0
      let etaD = 0
      for (let c = 0; c < NC; c++) {
        const k = SWELL[c]
        const a = k.amp * env[c] * wt[i * NC + c]
        const ph = sp[i * NC + c] - k.w * t
        eta += a * Math.cos(ph)
        etaD += a * k.w * Math.sin(ph)
      }
      const wl = water[i] + eta * refl[i]

      cool[i] -= dt
      if (etaD > THRESHOLD && cool[i] <= 0) {
        const strength = Math.min(etaD - THRESHOLD, 1.2)
        const v0 = (2 + 6 * strength) * luck[i] * Math.sqrt(expo[i]) * (0.7 + 0.6 * rnd())
        if (v0 > 1.6) {
          excV[i] = Math.max(excV[i], v0)
          exc[i] = Math.max(exc[i], 0.05)
          foam[i] = Math.min(1, foam[i] + v0 / 7)
          const ddx = sx[i] - camPos.x
          const ddz = sz[i] - camPos.z
          if (ddx * ddx + ddz * ddz < SPRAY_RANGE * SPRAY_RANGE) emit(i, v0)
        }
        cool[i] = 0.9 + rnd() * 2.1
      }
      if (exc[i] > 0 || excV[i] > 0) {
        excV[i] -= (GRAV + 0.12 * excV[i] * Math.abs(excV[i])) * dt
        exc[i] += excV[i] * dt
        if (exc[i] <= 0) {
          exc[i] = 0
          excV[i] = 0
        }
      }
      const hT = wl + exc[i]
      hMem[i] = Math.max(hMem[i] - DRY_RATE * dt, hT, water[i] + 0.2)
      foam[i] *= Math.exp(-dt * 0.9)
      stateData[i * 4] = hT
      stateData[i * 4 + 1] = hMem[i]
      stateData[i * 4 + 2] = foam[i]
      stateData[i * 4 + 3] = water[i]
    }
    stateTex.needsUpdate = true

    // droplets: gravity, a little air drag, fade out
    for (let s = 0; s < MAX_SPRAY; s++) {
      if (sprayLife[s] <= 0) {
        if (sprayAlpha[s] !== 0) {
          sprayAlpha[s] = 0
          sprayPos[s * 3 + 1] = -9999
        }
        continue
      }
      const o = s * 3
      sprayLife[s] -= dt
      sprayVel[o + 1] -= 9.81 * 0.8 * dt
      const drag = Math.exp(-dt * 0.35)
      sprayVel[o] *= drag
      sprayVel[o + 2] *= drag
      sprayPos[o] += sprayVel[o] * dt
      sprayPos[o + 1] += sprayVel[o + 1] * dt
      sprayPos[o + 2] += sprayVel[o + 2] * dt
      sprayAlpha[s] = Math.min(1, (Math.max(sprayLife[s], 0) / sprayMax[s]) * 2.2) * 0.8
      if (sprayPos[o + 1] < -0.5) sprayLife[s] = 0
    }
    posAttr.needsUpdate = true
    alphaAttr.needsUpdate = true
  }

  spray.onBeforeRender = (renderer, _scene, camera): void => {
    const t = sceneTime.value
    if (t === lastT) return // shadow pass or a second view in the same frame
    const dt = lastT < 0 ? 0.016 : Math.min(Math.max(t - lastT, 0), 0.05)
    lastT = t
    camPos.setFromMatrixPosition(camera.matrixWorld)
    const persp = camera as THREE.PerspectiveCamera
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y
    sprayUniforms.uScale.value = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad((persp.fov || 60) * 0.5))
    step(t, dt)
  }

  return {
    uniforms: {
      uShoreId: { value: idTex },
      uShoreDist: { value: distTex },
      uShoreState: { value: stateTex },
      uShoreBox: { value: new THREE.Vector4(minX, minZ, 1 / (W * cell), 1 / (H * cell)) },
      uShoreN: { value: N }
    },
    spray
  }
}

/**
 * GLSL for a shader that has the uniforms above. shore_lookup() finds the wash state under a
 * world position: x = height of the live tongue, y = height the water has reached lately
 * (damp line), z = foam left by the last strike, w = sea level there; dist is the metres to
 * the waterline. Returns false when the position is outside the covered area.
 */
export const SHORE_GLSL = /* glsl */ `
uniform sampler2D uShoreId;
uniform sampler2D uShoreDist;
uniform sampler2D uShoreState;
uniform vec4 uShoreBox;
uniform float uShoreN;
bool shore_lookup(vec2 xz, out vec4 st, out float dist) {
  vec2 uv = (xz - uShoreBox.xy) * uShoreBox.zw;
  st = vec4(0.0);
  dist = 999.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return false;
  vec2 idv = texture2D(uShoreId, uv).rg;
  if (idv.x < 0.0) return false;
  float i0 = floor(idv.x);
  float f = idv.x - i0;
  vec4 a = texture2D(uShoreState, vec2((i0 + 0.5) / uShoreN, 0.5));
  vec4 b = texture2D(uShoreState, vec2((i0 + 1.5) / uShoreN, 0.5));
  st = mix(a, b, f);
  dist = texture2D(uShoreDist, uv).r;
  return true;
}
`
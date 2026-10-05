import * as THREE from 'three'

// Ocean swell shared by the water shader (ocean.ts), the rock wash simulation (shoreSim.ts) and
// the wet-rock shading. One table drives the GLSL and the JS, so a swell crest that is drawn
// travelling toward a rock is the one that hits it.
//
// Nine deep-water components, omega = TIME_SCALE * sqrt(g k). Every one is a wave of the form
//     z = A * cos(k . x - w t + phi)
// but the shader does not draw them as clean plane waves. Each one is:
//   - bent by a second sine across its crests (nested FM: cos(k.x - w t + m sin(s2))), so crests
//     curve and split instead of running in straight lines,
//   - multiplied by a patchy amplitude field made of three unrelated travelling sines, so there
//     are groups of big waves and calm patches that never repeat,
//   - sampled through a slowly wandering domain warp (sin of sin), so the whole pattern drifts.
// Each component's amplitude also breathes on two slow, unrelated clocks.
//
// Gusts: a few cells placed at intervals along the roads. Each one swells up on its own clock
// (short bursts, long lulls). Inside a burst the waves get taller, more bent and whiter, so
// the sea along the road keeps changing in a way nobody can predict.
//
// The first SWELL_GEO_N components are long enough (hundreds of metres) for the 96 m grid of the
// water mesh to carry them, so the water surface itself rises and falls with them (ocean.ts moves
// the vertices). The short ones act on the shading, foam and rock wash.

export const SWELL_WIND = -0.9 // same heading as the ocean wind (ocean.ts)
const G = 9.81
const TIME_SCALE = 0.6 // slows deep-water dispersion a little so the big swell heaves instead of racing

interface Comp {
  lam: number
  ang: number // offset from the wind heading, radians
  amp: number // metres
  phi: number
  m1: number // slow amplitude clocks (rad/s) and their phases
  p1: number
  m2: number
  p2: number
}

const TABLE: Comp[] = [
  { lam: 820, ang: 0.1, amp: 1.3, phi: 1.1, m1: 0.047, p1: 0.6, m2: 0.089, p2: 2.2 },
  { lam: 520, ang: -0.4, amp: 1.1, phi: 3.7, m1: 0.061, p1: 3.9, m2: 0.103, p2: 5.1 },
  { lam: 310, ang: 0.35, amp: 0.78, phi: 0.7, m1: 0.071, p1: 1.3, m2: 0.113, p2: 4.1 },
  { lam: 205, ang: -0.6, amp: 0.64, phi: 2.9, m1: 0.083, p1: 5.2, m2: 0.137, p2: 0.4 },
  { lam: 140, ang: 0.9, amp: 0.5, phi: 4.4, m1: 0.097, p1: 2.2, m2: 0.151, p2: 3.3 },
  { lam: 96, ang: -1.0, amp: 0.38, phi: 1.8, m1: 0.109, p1: 0.9, m2: 0.173, p2: 5.9 },
  { lam: 66, ang: 1.6, amp: 0.28, phi: 5.5, m1: 0.127, p1: 4.6, m2: 0.191, p2: 2.7 },
  { lam: 45, ang: -1.9, amp: 0.2, phi: 3.6, m1: 0.139, p1: 3.1, m2: 0.211, p2: 1.1 },
  { lam: 30, ang: 2.6, amp: 0.14, phi: 0.2, m1: 0.157, p1: 5.7, m2: 0.233, p2: 4.8 }
]

export const SWELL_N = TABLE.length
/** The first components are long enough for the water mesh vertices to follow them. */
export const SWELL_GEO_N = 2
export const GUST_N = 24

export interface SwellComp {
  k: number
  w: number
  dx: number
  dz: number
  amp: number
  phi: number
  m1: number
  p1: number
  m2: number
  p2: number
}

export const SWELL: SwellComp[] = TABLE.map((c) => {
  const k = (Math.PI * 2) / c.lam
  const a = SWELL_WIND + c.ang
  return { k, w: TIME_SCALE * Math.sqrt(G * k), dx: Math.cos(a), dz: Math.sin(a), amp: c.amp, phi: c.phi, m1: c.m1, p1: c.p1, m2: c.m2, p2: c.p2 }
})

/** Slow amplitude envelope of one component at time t (about 0.45 .. 1.55). */
export function swellEnvelope(c: SwellComp, t: number): number {
  return 1 + 0.35 * Math.sin(c.m1 * t + c.p1) + 0.2 * Math.sin(c.m2 * t + c.p2)
}

/** Plain plane-wave elevation (metres) at world x, z: the backbone of sw_eval() in the shader. */
export function swellHeight(x: number, z: number, t: number): number {
  let h = 0
  for (const c of SWELL) h += c.amp * swellEnvelope(c, t) * Math.cos(c.k * (c.dx * x + c.dz * z) - c.w * t + c.phi)
  return h
}

/**
 * Gust cells at intervals along the roads: (x, z, phase 0..1, 1 / period in seconds). They sit
 * alternately left and right of each road so the sea on both sides gets its turn.
 */
export function makeGusts(root: THREE.Object3D): THREE.Vector4[] {
  const boxes: THREE.Box3[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /^road_/i.test(o.name)) boxes.push(new THREE.Box3().setFromObject(o))
  })
  let total = 0
  for (const b of boxes) total += Math.max(b.max.x - b.min.x, b.max.z - b.min.z)
  const step = Math.max(190, total / (GUST_N - 2))
  let seed = 7013
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const out: THREE.Vector4[] = []
  let n = 0
  for (const b of boxes) {
    const alongX = b.max.x - b.min.x >= b.max.z - b.min.z
    const len = alongX ? b.max.x - b.min.x : b.max.z - b.min.z
    const cx = (b.min.x + b.max.x) / 2
    const cz = (b.min.z + b.max.z) / 2
    for (let s = step * 0.5; s < len && out.length < GUST_N; s += step) {
      const lat = (n++ % 2 ? 1 : -1) * (45 + 45 * rnd())
      const x = alongX ? b.min.x + s : cx + lat
      const z = alongX ? cz + lat : b.min.z + s
      out.push(new THREE.Vector4(x, z, rnd(), 1 / (16 + 26 * rnd())))
    }
  }
  while (out.length < GUST_N) out.push(new THREE.Vector4(1e6, 1e6, 0, 0.05))
  return out
}

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v))
const arr = (name: string, pick: (c: SwellComp) => number): string =>
  `const float ${name}[${SWELL_N}] = float[${SWELL_N}](${SWELL.map((c) => f(+pick(c).toFixed(6))).join(', ')});`

/**
 * GLSL (vertex and fragment): sw_gust(p, t) gives 0..1 gust strength; sw_eval(p, t, gust, i0, i1,
 * h, grad) sums components i0 .. i1-1 into an elevation and its slope.
 */
export const SWELL_GLSL = /* glsl */ `
${arr('SW_K', (c) => c.k)}
${arr('SW_W', (c) => c.w)}
${arr('SW_DX', (c) => c.dx)}
${arr('SW_DZ', (c) => c.dz)}
${arr('SW_A', (c) => c.amp)}
${arr('SW_PHI', (c) => c.phi)}
${arr('SW_M1', (c) => c.m1)}
${arr('SW_P1', (c) => c.p1)}
${arr('SW_M2', (c) => c.m2)}
${arr('SW_P2', (c) => c.p2)}
uniform vec4 uGust[${GUST_N}];
float sw_gust(vec2 p, float t) {
  float g = 0.0;
  for (int i = 0; i < ${GUST_N}; i++) {
    vec4 u = uGust[i];
    vec2 d = p - u.xy;
    float pulse = 0.5 + 0.5 * sin(6.28318 * (t * u.w + u.z));
    pulse = pulse * pulse * pulse;
    g += exp(-dot(d, d) / 33800.0) * pulse;
  }
  return clamp(g, 0.0, 1.0);
}
void sw_eval(vec2 p, float t, float gust, int i0, int i1, out float h, out vec2 grad) {
  h = 0.0;
  grad = vec2(0.0);
  // the whole pattern wanders: sin of sin warps the sampling point by tens of metres
  vec2 wq = vec2(sin(p.y * 0.0113 + 1.7 * sin(p.x * 0.0071 + t * 0.09) + t * 0.05),
                 sin(p.x * 0.0097 + 1.9 * sin(p.y * 0.0083 - t * 0.07) - t * 0.04 + 2.0));
  vec2 q = p + wq * (14.0 + 34.0 * gust);
  float fm = 0.85 + 1.1 * gust;
  for (int i = i0; i < i1; i++) {
    float fi = float(i);
    float env = 1.0 + 0.35 * sin(SW_M1[i] * t + SW_P1[i]) + 0.2 * sin(SW_M2[i] * t + SW_P2[i]);
    vec2 d = vec2(SW_DX[i], SW_DZ[i]);
    vec2 d2 = vec2(-d.y, d.x);
    // nested FM: a second sine across the crests bends them
    float s2 = SW_K[i] * 0.41 * dot(d2, q) + SW_W[i] * 0.37 * t + SW_PHI[i] * 1.9;
    float ph = SW_K[i] * dot(d, q) - SW_W[i] * t + SW_PHI[i] + fm * sin(s2);
    // patchy amplitude: groups and calm patches from three unrelated travelling sines
    float m = 1.0
      + 0.55 * sin(dot(q, vec2(0.0043 + 0.0007 * fi, -0.0035 + 0.0009 * fi)) + t * (0.031 + 0.004 * fi) + SW_P1[i])
             * sin(dot(q, vec2(-0.0029 + 0.0006 * fi, 0.0049 - 0.0005 * fi)) - t * (0.023 + 0.003 * fi) + SW_P2[i])
      + 0.2 * sin(dot(q, vec2(0.011, 0.0087 + 0.001 * fi)) + t * 0.07 * (1.0 + 0.1 * fi) + fi);
    float a = SW_A[i] * env * m * (1.0 + 0.9 * gust);
    h += a * cos(ph);
    vec2 dph = SW_K[i] * d + fm * cos(s2) * SW_K[i] * 0.41 * d2;
    grad += dph * (-a * sin(ph));
  }
}
`
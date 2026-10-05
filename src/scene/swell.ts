// Long ocean swell shared by the water shader (ocean.ts), the rock wash simulation
// (shoreSim.ts) and the wet-rock shading. The same table drives the GLSL and the JS, so a
// swell crest that is drawn travelling toward a rock is the one that hits it.
//
// Seven deep-water components (omega = sqrt(g k)). Directions are spread around the wind
// direction, with a couple of cross seas, so every stretch of coast gets hit by something.
// Each component's amplitude also breathes on two slow, unrelated clocks, so the groups of
// big waves and the lulls between them never repeat.

export const SWELL_WIND = -0.9 // same heading as the ocean wind (ocean.ts)
const G = 9.81

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
  { lam: 310, ang: 0.0, amp: 0.55, phi: 0.7, m1: 0.071, p1: 1.3, m2: 0.113, p2: 4.1 },
  { lam: 205, ang: 0.35, amp: 0.46, phi: 2.9, m1: 0.083, p1: 5.2, m2: 0.137, p2: 0.4 },
  { lam: 140, ang: -0.5, amp: 0.38, phi: 4.4, m1: 0.097, p1: 2.2, m2: 0.151, p2: 3.3 },
  { lam: 96, ang: 1.1, amp: 0.3, phi: 1.8, m1: 0.109, p1: 0.9, m2: 0.173, p2: 5.9 },
  { lam: 66, ang: -1.2, amp: 0.24, phi: 5.5, m1: 0.127, p1: 4.6, m2: 0.191, p2: 2.7 },
  { lam: 45, ang: 2.2, amp: 0.18, phi: 3.6, m1: 0.139, p1: 3.1, m2: 0.211, p2: 1.1 },
  { lam: 30, ang: 3.4, amp: 0.13, phi: 0.2, m1: 0.157, p1: 5.7, m2: 0.233, p2: 4.8 }
]

export const SWELL_N = TABLE.length

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
  return { k, w: Math.sqrt(G * k), dx: Math.cos(a), dz: Math.sin(a), amp: c.amp, phi: c.phi, m1: c.m1, p1: c.p1, m2: c.m2, p2: c.p2 }
})

/** Slow amplitude envelope of one component at time t (about 0.45 .. 1.55). */
export function swellEnvelope(c: SwellComp, t: number): number {
  return 1 + 0.35 * Math.sin(c.m1 * t + c.p1) + 0.2 * Math.sin(c.m2 * t + c.p2)
}

/** Swell elevation (metres) at world x, z. CPU twin of sw_eval() in the shader. */
export function swellHeight(x: number, z: number, t: number): number {
  let h = 0
  for (const c of SWELL) h += c.amp * swellEnvelope(c, t) * Math.cos(c.k * (c.dx * x + c.dz * z) - c.w * t + c.phi)
  return h
}

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v))
const arr = (name: string, pick: (c: SwellComp) => number): string =>
  `const float ${name}[${SWELL_N}] = float[${SWELL_N}](${SWELL.map((c) => f(+pick(c).toFixed(6))).join(', ')});`

/** GLSL: sw_eval(p, t, h, grad) gives the same elevation as swellHeight() plus its slope. */
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
void sw_eval(vec2 p, float t, out float h, out vec2 grad) {
  h = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < ${SWELL_N}; i++) {
    float env = 1.0 + 0.35 * sin(SW_M1[i] * t + SW_P1[i]) + 0.2 * sin(SW_M2[i] * t + SW_P2[i]);
    float ph = SW_K[i] * (SW_DX[i] * p.x + SW_DZ[i] * p.y) - SW_W[i] * t + SW_PHI[i];
    float a = SW_A[i] * env;
    h += a * cos(ph);
    grad += vec2(SW_DX[i], SW_DZ[i]) * (-a * SW_K[i] * sin(ph));
  }
}
`
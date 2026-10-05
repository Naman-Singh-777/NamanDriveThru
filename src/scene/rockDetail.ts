import * as THREE from 'three'
import { NOISE_GLSL } from './glslCommon'
import { SHORE_GLSL, type ShoreSim } from './shoreSim'

// Extra surface on the rock: layered beds, cracks, lumpy relief with a matching normal bump,
// and the wash from shoreSim.ts (damp rock, a glossy wet band that follows the swell up and
// down, droplets above it, a thin foam edge on the running water).
//
// It is laid on top of whatever colour the material already had (the Blender cliff ramp, or the
// flat terrain / headland colour), as a multiplier that averages 1, so the colour scheme stays
// the same and only the texture changes. Every octave fades out once its features are only a
// few pixels wide, so far rock stays calm instead of shimmering.

const ROCK_GLSL = /* glsl */ `
varying vec3 vRkW;
float rk_vis(float size, float fp) { return smoothstep(7.0, 18.0, size / max(fp, 1e-4)); }

// Voronoi cells in 3D: edge = distance to the nearest cell border (in cell units), id = a random
// value per cell. Cell borders make rock-like fracture networks and blocky plates.
void rk_vor(vec3 x, out float edge, out float cid) {
  vec3 ip = floor(x);
  vec3 fp = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 c = ip + g;
        vec3 o = vec3(bn_hash13(c), bn_hash13(c + 19.1), bn_hash13(c + 47.3));
        vec3 r = g + o - fp;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; id = o.x; }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  edge = sqrt(f2) - sqrt(f1);
  cid = id;
}

// hm: relief height in metres, mul: brightness multiplier (mean about 1)
void rk_relief(vec3 p, float fp, out float hm, out float mul) {
  float n1 = bn_vnoise(p / 14.0);
  float n2 = bn_vnoise(p / 5.0 + 7.1);
  float n3 = bn_vnoise(p / 2.0 + 3.3);
  float n4 = bn_vnoise(p / 0.8 + 9.0);
  float n5 = bn_vnoise(p / 0.3 + 1.7);
  float v3 = rk_vis(2.0, fp);
  float v4 = rk_vis(0.8, fp);
  float v5 = rk_vis(0.3, fp);
  // bedding: layers that tilt a little and wobble with the big noise, each bed a slightly different tone
  float sy = p.y * 0.55 + p.x * 0.05 + (n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.5;
  float band = abs(fract(sy) - 0.5) * 2.0;
  float vS = rk_vis(1.8, fp);
  float joint = smoothstep(0.9, 1.0, band) * vS * 0.15;
  float bed = (bn_vnoise(vec3(floor(sy) * 3.7, 1.0, 2.0)) - 0.5) * vS;
  // fracture blocks: big plates, and a finer set close up. Borders are dark cracks, every block sits
  // a little proud or sunk and has its own tone.
  float e1, c1, e2 = 1.0, c2 = 0.5;
  // warp the space first so the cells are lopsided, not a honeycomb
  vec3 wp = p + (vec3(bn_vnoise(p / 3.1 + 1.0), bn_vnoise(p / 3.1 + 9.0), bn_vnoise(p / 3.1 + 17.0)) - 0.5) * 1.6;
  rk_vor(wp / 9.0, e1, c1);
  float vB = rk_vis(9.0, fp);
  float w1 = max(0.03, fp / 9.0 * 1.0);
  // cracks come and go along their length, they do not run unbroken round every block
  float broken = smoothstep(0.52, 0.8, bn_vnoise(p / 2.6 + 5.0));
  float crack1 = (1.0 - smoothstep(w1 * 0.4, w1, e1)) * vB * broken;
  float crack2 = 0.0;
  if (v3 > 0.5) {
    rk_vor(wp / 2.3 + 31.7, e2, c2);
    float w2 = max(0.04, fp / 2.3 * 1.0);
    crack2 = (1.0 - smoothstep(w2 * 0.4, w2, e2)) * v3 * smoothstep(0.55, 0.8, bn_vnoise(p / 1.7 + 2.0));
  }
  float crack = clamp(crack1 + crack2 * 0.45, 0.0, 1.0);
  float h = (n1 - 0.5) + (n2 - 0.5) * 0.45 + (n3 - 0.5) * 0.2 * v3 + (n4 - 0.5) * 0.14 * v4 + (n5 - 0.5) * 0.06 * v5;
  h += (c1 - 0.5) * 0.35 * vB + (c2 - 0.5) * 0.1 * v3 + smoothstep(0.0, 0.25, e1) * 0.08 * vB;
  hm = h - joint * 0.12 - crack * 0.25;
  float tone = 1.0 + (n2 - 0.5) * 0.5 + (n3 - 0.5) * 0.4 * v3 + (n4 - 0.5) * 0.5 * v4 + (n5 - 0.5) * 0.55 * v5 + bed * 0.2 + (c1 - 0.5) * 0.18 * vB + (c2 - 0.5) * 0.1 * v3;
  mul = tone * (1.0 - 0.32 * crack) * (1.0 - 0.2 * joint) * 1.03;
}
// Mikkelsen's screen-space bump: tilts the normal by the slope of height H (metres).
vec3 rk_bump(vec3 N, vec3 viewPos, float H, float strength, float faceDir) {
  vec3 sx = dFdx(viewPos);
  vec3 sy = dFdy(viewPos);
  vec3 r1 = cross(sy, N);
  vec3 r2 = cross(N, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
  return normalize(abs(det) * N - strength * grad);
}
`

const WET_GLSL = /* glsl */ `
// 0..1 wetness of rock at p from the wash simulation, and the foam edge of the running water.
float rk_wet(vec3 p, float fp, out float edgeFoam) {
  edgeFoam = 0.0;
  vec4 st;
  float d;
  if (!shore_lookup(p.xz, st, d)) return 0.0;
  float mask = 1.0 - smoothstep(30.0, 60.0, d);
  if (mask <= 0.0) return 0.0;
  // ragged edge: streaks running down the rock, never a straight band
  float col = bn_vnoise(vec3(p.x * 0.35, 1.7, p.z * 0.35)) - 0.5;
  float fine = bn_vnoise(vec3(p.x * 1.3, p.y * 0.25, p.z * 1.3)) - 0.5;
  float edge = col * 0.9 + fine * 0.45;
  float tongue = 1.0 - smoothstep(st.x - 0.7 + edge, st.x + 0.1 + edge, p.y);
  float damp = (1.0 - smoothstep(st.y - 1.4 + edge, st.y + 0.4 + edge, p.y)) * 0.45;
  // droplets thrown above the damp line, thicker after a strike
  float reach = 2.5 + 5.0 * st.z;
  float drops = smoothstep(0.64, 0.82, bn_vnoise(p * 2.7)) * (1.0 - smoothstep(st.y, st.y + reach, p.y)) * 0.55 * rk_vis(0.37, fp);
  float wet = clamp(max(tongue, max(damp, drops)), 0.0, 1.0);
  // foam on the leading edge of the running water, only while it is above the sea
  float live = smoothstep(0.1, 0.6, st.x - st.w);
  float line = 1.0 - smoothstep(0.0, 0.45, abs(p.y - (st.x + edge) + 0.2));
  edgeFoam = line * smoothstep(0.35, 0.65, bn_vnoise(p * 1.6 + 5.0)) * live * mask;
  return wet * mask;
}
`

export function applyRockOverlay(mat: THREE.MeshStandardMaterial, shore: ShoreSim | null, key: string): void {
  const previous = mat.onBeforeCompile
  mat.customProgramCacheKey = () => key
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer)
    if (shore) Object.assign(shader.uniforms, shore.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRkW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${shore ? SHORE_GLSL : ''}\n${ROCK_GLSL}\n${shore ? WET_GLSL : ''}`)
      .replace(
        '#include <alphamap_fragment>',
        `float rkFp = max(length(dFdx(vRkW)), length(dFdy(vRkW)));
        float rkHm;
        float rkMul;
        rk_relief(vRkW, rkFp, rkHm, rkMul);
        diffuseColor.rgb *= clamp(rkMul, 0.45, 1.55);
        float rkFoam = 0.0;
        float rkWet = 0.0;
        ${shore ? 'rkWet = rk_wet(vRkW, rkFp, rkFoam);' : ''}
        diffuseColor.rgb *= mix(1.0, 0.74, rkWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.53, 0.56), rkFoam * 0.55);
        #include <alphamap_fragment>`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `roughnessFactor = mix(roughnessFactor, 0.14, rkWet);
        roughnessFactor = mix(roughnessFactor, 0.92, rkFoam * 0.6);
        #include <metalnessmap_fragment>`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `normal = rk_bump(normal, -vViewPosition, rkHm, 1.6, faceDirection);
        #include <emissivemap_fragment>`
      )
  }
  mat.needsUpdate = true
}
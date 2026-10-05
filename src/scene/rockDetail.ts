import * as THREE from 'three'
import { NOISE_GLSL } from './glslCommon'
import { SHORE_GLSL, type ShoreSim } from './shoreSim'

// Wash on the rock from shoreSim.ts: damp rock, a glossy wet band that follows the swell up and
// down, droplets above it, and a thin foam edge on the running water. The rock keeps its own
// colour and surface; this only darkens and glosses it where the sea has reached.

const ROCK_GLSL = /* glsl */ `
varying vec3 vRkW;
float rk_vis(float size, float fp) { return smoothstep(7.0, 18.0, size / max(fp, 1e-4)); }
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

  }
  mat.needsUpdate = true
}
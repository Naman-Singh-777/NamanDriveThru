import * as THREE from 'three'
import { NOISE_GLSL, sceneTime } from './glslCommon'
import { SWELL_GLSL, SWELL_N, SWELL_GEO_N, GUST_N } from './swell'
import { SHORE_GLSL, type ShoreSim } from './shoreSim'

// Ocean water for the baked Ocean_Near mesh.
//
// What the Blender file has: an Ocean modifier (wave scale 1.4, choppiness 1.35, wind 9 m/s,
// direction 0.9 rad, damping 0.32, foam on) and MAT_WATER: base colour (0.0115, 0.0528, 0.0726),
// roughness 0.05..0.13, IOR 1.33, four stacked noise bumps, and a foam mix. The GLB only carries
// the modifier's single baked frame: 75k vertices roughly 96 m apart, so it is nearly flat, and
// the flat white/grey material swallowed everything else.
//
// What this does, in the spirit of the CG Geek recipe (IOR 1.333, near-zero roughness, noise
// ripples through a bump, volume absorption tinting the body):
//  - IOR 1.333 gives the physical Fresnel F0 of 0.02, so the sea is dark and deep when looked
//    down on and turns into a mirror of the sky and moon at grazing angles.
//  - Nine travelling waves from the deep-water dispersion relation w = sqrt(g k), wavelengths 60 m
//    down to 0.9 m, spread around the wind direction. Crests are sharpened with an exponential
//    profile (what Blender's choppiness does to the surface). Their slopes are summed
//    analytically per pixel, so the water moves without touching any vertex.
//  - Waves smaller than a pixel are filtered out by distance. The slope variance they held is
//    added to the roughness instead, so far water blurs into a soft sky reflection, not noise.
//  - Two fine capillary ripple layers (the "noise through a bump" step) for close-up glitter.
//  - Whitecaps where the baked foam channel (COLOR_1 on the mesh) and the wave crests agree.
//  - The body colour is Blender's own, so night colour matches the render.

const OCEAN_GLSL = /* glsl */ `
${NOISE_GLSL}
uniform float uTime;
varying vec3 vOcPos;
varying float vOcFoam;
varying float vOcGust;

const float OC_LAM[9] = float[9](60.0, 36.0, 21.0, 12.5, 7.4, 4.4, 2.6, 1.55, 0.9);
const float OC_ANG[9] = float[9](0.0, 0.20, -0.25, 0.38, -0.42, 0.15, -0.18, 0.50, -0.55);
const float OC_PHI[9] = float[9](0.3, 2.1, 4.0, 1.2, 5.3, 3.3, 0.7, 2.8, 4.6);
const float OC_WIND = -0.9;      // Blender wind direction 0.9 rad, mapped to the three.js x/z plane
const float OC_CHOP = 1.35;      // Blender choppiness
const float OC_STEEP = 0.052;    // a*k per wave (slope), sets the sea state for a 9 m/s wind

// Sum of the travelling waves at ground position p.
//   grad  : surface slope (dh/dx, dh/dz)
//   crest : 0..1 measure of how close to a crest this point is
//   lost  : slope variance of waves too small for this pixel (turned into roughness)
void oc_waves(vec2 p0, float fp, out vec2 grad, out float crest, out float lost) {
  grad = vec2(0.0);
  float h = 0.0;
  float hn = 0.0;
  lost = 0.0;
  // A real sea is not a stack of perfect plane waves. Warp the phase and let each wave's height
  // and heading drift with slow noise, otherwise the surface reads as regular stripes.
  vec2 warp = (vec2(bn_vnoise(vec3(p0 * 0.03, 3.1 + uTime * 0.05)), bn_vnoise(vec3(p0 * 0.03, 9.7 + uTime * 0.05))) - 0.5) * 6.0;
  vec2 p = p0 + warp;
  vec3 nz = vec3(bn_vnoise(vec3(p0 * 0.021, 1.7)), bn_vnoise(vec3(p0 * 0.047, 5.3)), bn_vnoise(vec3(p0 * 0.11, 8.9)));
  for (int i = 0; i < 9; i++) {
    float lam = OC_LAM[i];
    float k = 6.28318 / lam;
    float w = sqrt(9.81 * k);
    float pick = i % 3 == 0 ? nz.x : (i % 3 == 1 ? nz.y : nz.z);
    float am = 0.6 + 0.8 * fract(pick * (1.0 + 0.37 * float(i)) + 0.21 * float(i));
    float a = OC_WIND + OC_ANG[i] + (pick - 0.5) * 0.7;
    vec2 dir = vec2(cos(a), sin(a));
    float vis = clamp((lam / max(fp, 1e-4) - 5.0) / 10.0, 0.0, 1.0);   // gone below 5 px, full above 15 px
    float th = k * dot(dir, p) - w * uTime + OC_PHI[i];
    float e = exp(OC_CHOP * (sin(th) - 1.0));
    float s = OC_STEEP * (1.0 + 0.4 * float(i) / 8.0) * am;
    grad += dir * (s * OC_CHOP * cos(th) * e * vis);
    h += e * lam * s * vis;
    hn += lam * s * vis;
    lost += (1.0 - vis) * 0.5 * s * s * OC_CHOP * OC_CHOP * 0.35;
  }
  crest = hn > 1e-4 ? clamp(h / hn * 1.9 - 0.45, 0.0, 1.0) : 0.0;
}

// Wind ripples: two scales of drifting noise, central differences for the slope. The noise is
// stretched across the wind (short along it, long across it) and slides downwind, so the surface
// shows lanes of ripples running before the wind, not round blobs and rings.
vec2 oc_ripples(vec2 p, float fp) {
  vec2 g = vec2(0.0);
  vec2 wd = vec2(cos(OC_WIND), sin(OC_WIND));
  vec2 wn = vec2(-wd.y, wd.x);
  for (int o = 0; o < 2; o++) {
    float sc = o == 0 ? 1.25 : 2.7;
    float amp = o == 0 ? 0.060 : 0.038;
    float vis = clamp((1.0 / sc / max(fp, 1e-4) - 5.0) / 10.0, 0.0, 1.0);
    if (vis <= 0.001) continue;                 // far water: no ripple cost at all
    vec3 q = vec3(dot(p, wd) * sc - uTime * (o == 0 ? 1.1 : 1.9), dot(p, wn) * sc * 0.3, uTime * 0.12 + float(o) * 11.0);
    float e = 0.12;
    float n0 = bn_vnoise(q);
    float nx = bn_vnoise(q + vec3(e, 0.0, 0.0)) - n0;
    float nz = bn_vnoise(q + vec3(0.0, e, 0.0)) - n0;
    g += (wd * nx + wn * (nz * 0.3)) * (amp * vis / e);
  }
  return g;
}
`

export function applyOceanMaterial(mesh: THREE.Mesh, envMap: THREE.Texture | null, shore: ShoreSim | null = null, gusts: THREE.Vector4[] = []): void {
  const old = mesh.material as THREE.MeshStandardMaterial
  const mat = new THREE.MeshPhysicalMaterial({
    name: old.name || 'MAT_WATER',
    // Blender's MAT_WATER body colour is (0.0115, 0.0528, 0.0726) under Blender's lighting. The web
    // has no bounced light and a hemisphere tinted blue, so the value that reproduces the same
    // rendered colour (measured against the Blender frame, about 6/42/58) is a little greener.
    color: new THREE.Color().setRGB(0.007, 0.017, 0.03),
    roughness: 0.08, // Blender 0.05..0.13
    metalness: 0,
    ior: 1.333, // water, as in the CG Geek recipe (F0 = 0.02)
    side: old.side
  })
  // The sky reflection comes from the night-sky environment. (A material only uses
  // envMapIntensity when it has its own envMap, so it is set explicitly here.)
  mat.envMap = envMap
  mat.envMapIntensity = 0.35
  mat.customProgramCacheKey = () => (shore ? 'MAT_WATER_OCEAN_V3_SHORE' : 'MAT_WATER_OCEAN_V3')
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneTime
    shader.uniforms.uGust = {
      value: gusts.length === GUST_N ? gusts : Array.from({ length: GUST_N }, () => new THREE.Vector4(1e6, 1e6, 0, 0.05))
    }
    if (shore) Object.assign(shader.uniforms, shore.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 color_1;
varying vec3 vOcPos;
varying float vOcFoam;
varying float vOcGust;
uniform float uTime;
${SWELL_GLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  // the long swell lifts and drops the water itself; the shorter waves are painted in the fragment shader
  vec2 ocW = (modelMatrix * vec4(transformed, 1.0)).xz;
  float ocG = sw_gust(ocW, uTime);
  float ocH; vec2 ocS;
  sw_eval(ocW, uTime, ocG, 0, ${SWELL_GEO_N}, ocH, ocS);
  transformed.y += ocH;
  vOcGust = ocG;
}
vOcPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vOcFoam = color_1.r;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SWELL_GLSL}\n${shore ? SHORE_GLSL : ''}\n${OCEAN_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 ocP = vOcPos.xz;
        float ocFp = max(length(dFdx(vOcPos)), length(dFdy(vOcPos)));
        vec2 ocGrad; float ocCrest; float ocLost;
        oc_waves(ocP, ocFp, ocGrad, ocCrest, ocLost);
        ocGrad += oc_ripples(ocP, ocFp);
        // Long swell: seven deep-water waves that drift in and out of step (swell.ts). Their slope
        // tilts the whole surface, so big moving bands of moon glint roll toward the rocks.
        float swH; vec2 swG;
        float swGust = vOcGust;
        sw_eval(ocP, uTime, swGust, 0, ${SWELL_N}, swH, swG);
        ocGrad += swG * 2.3;
        float swN = clamp(swH / 3.4, -1.0, 1.0);        // whitecaps: baked foam channel x crest x a slow breakup noise, thinner with distance
        float ocFoam = smoothstep(0.55, 0.85, vOcFoam) * smoothstep(0.55, 0.9, ocCrest) * (1.0 - smoothstep(30.0, 160.0, ocFp * 900.0));
        if (ocFoam > 0.002) ocFoam *= smoothstep(0.38, 0.7, bn_fbm(vec3(ocP * 0.45, uTime * 0.07), 3, 0.6));
        // Foam rides the highest swell crests, in broken patches that drift with the wave group.
        // Calm stretches between groups stay clean.
        vec2 swWd = vec2(0.62, -0.78);
        vec2 swStreak = vec2(dot(ocP, swWd) * 0.22 + uTime * 0.7, dot(ocP, vec2(-swWd.y, swWd.x)) * 0.9);
        float swBreak = smoothstep(0.64 - 0.08 * swGust, 0.95, swN)
          * smoothstep(0.5 - 0.1 * swGust, 0.78, bn_fbm(vec3(ocP * 0.09 + vec2(uTime * 0.9, uTime * -0.6), uTime * 0.05), 3, 0.6))
          * smoothstep(0.42, 0.72, bn_vnoise(vec3(swStreak, uTime * 0.35)))
          * (1.0 - smoothstep(30.0, 200.0, ocFp * 900.0));
        ocFoam = max(ocFoam, swBreak * (0.45 + 0.2 * swGust));
        diffuseColor.rgb += vec3(0.002, 0.008, 0.014) * smoothstep(0.05, 0.9, swN); // light through thin crests
${shore ? `
        {
          vec4 shSt; float shD;
          if (shore_lookup(ocP, shSt, shD)) {
            // Where the swell is running up the rock the water at its foot churns white: a thin
            // lapping line all the time, a wide boiling band right after a strike.
            float run = clamp((shSt.x - shSt.w) / 2.5, 0.0, 1.0);
            float band = 2.2 + 6.0 * shSt.z + 3.0 * run;
            float shn = bn_fbm(vec3(ocP * 0.55 + vec2(uTime * 0.5, uTime * -0.35), uTime * 0.3), 3, 0.6);
            float lap = (1.0 - smoothstep(band * 0.3, band, shD)) * smoothstep(0.30, 0.62, shn + 0.5 * shSt.z + 0.35 * run);
            ocFoam = max(ocFoam, lap * (0.55 + 0.4 * max(shSt.z, run)));
          }
        }` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.37, 0.42), ocFoam * 0.85);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float r0 = 0.05 + 0.08 * bn_vnoise(vec3(ocP * 0.011, 3.0));   // Blender 0.05..0.13
          float r4 = r0 * r0 * r0 * r0 + 2.0 * ocLost;
          roughnessFactor = mix(clamp(pow(r4, 0.25), 0.0, 0.6), 0.85, ocFoam);
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 ocN = normalize(vec3(-ocGrad.x, 1.0, -ocGrad.y));
          normal = normalize((viewMatrix * vec4(ocN, 0.0)).xyz) * faceDirection;
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // faint turquoise light scattered through thin crests (volume scatter of the body colour)
        totalEmissiveRadiance += vec3(0.0, 0.002, 0.005) * ocCrest * ocCrest;`
      )
  }
  mesh.material = mat
  old.dispose()
}

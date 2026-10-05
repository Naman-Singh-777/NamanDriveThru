import * as THREE from 'three'
import { NOISE_GLSL, sceneTime } from './glslCommon'

// Web recreation of the Blender night sky (MAT_SKY_DOME). The dome mesh is not in the GLB
// because its Voronoi star graph does not survive glTF export, so it is rebuilt here from
// the values read out of the .blend:
//  - base: Emission 0.25 of a Z gradient (0.02,0.035,0.13) -> (0.015,0.025,0.10)
//  - cloud-like tint: Noise (scale 1.6, detail 4) pushed through a 0.38..0.62 ramp into (0.02,0.035,0.14)
//  - glow: a broad region toward the MOONLIGHT_KEY light, (0.015,0.03,0.11)
//  - stars: two Voronoi layers (scale 200 bright, scale 350 faint), about 12.5k + 38k points
//    on the full sphere, so about half of that above the horizon.
// The Blender dome has no visible moon and a dark horizon; the web keeps a soft horizon haze
// and adds the moon disc at the real Light_Moon direction so the sky and the lighting agree.

// Directions in three.js axes (Blender x,y,z -> three x,z,-y).
export const MOON_DIR = new THREE.Vector3(0.47, 0.574, 0.67).normalize() // Light_Moon (sun lamp)
export const KEY_DIR = new THREE.Vector3(0.1606, 0.9638, 0.2142).normalize() // MOONLIGHT_KEY area light

export const SKY_GLSL = /* glsl */ `
vec3 nightSky(vec3 d) {
  // Blender "Generated" coordinates of a unit sphere: x, y(-z), z(y), remapped to 0..1
  vec3 g = vec3(d.x, -d.z, d.y) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.02, 0.035, 0.13), vec3(0.015, 0.025, 0.10), g.z);
  float n = bn_fbm(vec3(g.x * 0.9, g.y * 0.9, g.z * 0.6) * 1.6, 5, 0.55);
  c = mix(c, vec3(0.02, 0.035, 0.14), smoothstep(0.38, 0.62, n));
  float dg = dot(g, vec3(0.16059, -0.21412, 0.96352));
  c += vec3(0.015, 0.03, 0.11) * clamp((dg - 0.55) / 0.42, 0.0, 1.0);
  c *= 0.25;
  // soft horizon haze (kept from the earlier web sky, much quieter)
  float up = max(d.y, 0.0);
  c += vec3(0.010, 0.020, 0.048) * exp(-up * 5.5);
  // moon at the Light_Moon direction: halo + disc
  float cm = dot(d, normalize(vec3(0.47, 0.574, 0.67)));
  c += vec3(0.03, 0.052, 0.11) * exp(-(1.0 - cm) * 160.0);
  c += vec3(0.80, 0.88, 1.0) * smoothstep(0.99935, 0.99975, cm);
  return c;
}
`

function makeDomeMaterial(boost: number, dither: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uBoost: { value: boost }, uDither: { value: dither } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uBoost;
      uniform float uDither;
      ${NOISE_GLSL}
      ${SKY_GLSL}
      void main() {
        gl_FragColor = vec4(nightSky(normalize(vDir)) * uBoost, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += (bn_hash12(gl_FragCoord.xy) - 0.5) * (uDither / 255.0);
      }
    `
  })
}

// Image-based light built from the same sky, so metals, glass and the water reflect the real
// night colours instead of a grey studio room.
export function createNightEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene()
  const mat = makeDomeMaterial(1.0, 0)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat)
  envScene.add(dome)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(envScene, 0.02, 0.1, 200).texture
  pmrem.dispose()
  dome.geometry.dispose()
  mat.dispose()
  return tex
}

// Deterministic PRNG so the star field is the same every visit.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BRIGHT_STARS = 6300 // ~12.5k over the whole sphere in Blender, half above the horizon
const FAINT_STARS = 19000 // ~38k over the whole sphere
const STAR_RADIUS = 8400

function buildStars(): THREE.Points {
  const rand = mulberry32(777)
  const total = BRIGHT_STARS + FAINT_STARS
  const pos = new Float32Array(total * 3)
  const size = new Float32Array(total)
  const mag = new Float32Array(total)
  const seed = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    const bright = i < BRIGHT_STARS
    // uniform on the sphere, keep the part above (and just below) the horizon
    let y = 0
    do { y = rand() * 2 - 1 } while (y < -0.06)
    const th = rand() * Math.PI * 2
    const rr = Math.sqrt(1 - y * y)
    pos[i * 3] = Math.cos(th) * rr * STAR_RADIUS
    pos[i * 3 + 1] = y * STAR_RADIUS
    pos[i * 3 + 2] = Math.sin(th) * rr * STAR_RADIUS
    const m = rand()
    if (bright) {
      size[i] = 1.7 + m * m * 1.6
      mag[i] = 0.9 + m * m * 2.6
    } else {
      size[i] = 1.0 + m * 0.6
      mag[i] = 0.28 + m * m * 0.9
    }
    seed[i] = rand()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uTime: sceneTime, uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aMag;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPx;
      varying float vB;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float tw = 0.84 + 0.16 * sin(uTime * (0.7 + aSeed * 2.6) + aSeed * 60.0);
        // stars fade out just above the horizon haze
        float hz = smoothstep(-0.02, 0.10, normalize(position).y);
        vB = aMag * tw * hz;
        gl_PointSize = aSize * uPx;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, r);
        gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * vB * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
  const stars = new THREE.Points(geo, mat)
  stars.frustumCulled = false
  stars.renderOrder = -1
  return stars
}

export function createSky(scene: THREE.Scene): { update: (t: number, camera?: THREE.Camera) => void } {
  const group = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), makeDomeMaterial(0.62, 1.0))
  dome.renderOrder = -2
  dome.frustumCulled = false
  group.add(dome)
  group.add(buildStars())
  scene.add(group)

  // Distance haze so far terrain and water settle into the horizon colour. The colour and
  // density match the far sea in the Blender frames (about 27/38/47 at the horizon).
  scene.fog = new THREE.FogExp2(0x1b2630, 0.00028)

  return {
    update(t: number, camera?: THREE.Camera) {
      sceneTime.value = t
      // the sky is infinitely far: it travels with the camera so there is no parallax
      if (camera) group.position.copy(camera.position)
    }
  }
}

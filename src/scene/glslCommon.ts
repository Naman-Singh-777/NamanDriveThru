// Shared helpers for the web recreations of the Blender procedural shaders.
// Blender's Noise / Voronoi nodes cannot be exported to glTF, so each material below
// re-builds the same node graph (same scales, ramps and colours read from the .blend)
// with a plain value-noise FBM. It is not bit-identical noise, but the same structure.

// One clock for every animated shader (sky stars, ocean, building lights).
// sky.update() writes it once per frame; the materials read the same object.
export const sceneTime = { value: 0 }

export const NOISE_GLSL = /* glsl */ `
float bn_hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float bn_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bn_vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(bn_hash13(i), bn_hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(bn_hash13(i + vec3(0.0, 1.0, 0.0)), bn_hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(bn_hash13(i + vec3(0.0, 0.0, 1.0)), bn_hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(bn_hash13(i + vec3(0.0, 1.0, 1.0)), bn_hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
// Normalised FBM, 0..1, like Blender's Noise Texture with Normalize on.
float bn_fbm(vec3 p, int octaves, float rough) {
  float a = 1.0;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * bn_vnoise(p);
    n += a;
    a *= rough;
    p = p * 2.0 + vec3(17.1, 3.7, 9.3);
  }
  return s / n;
}
float bn_ramp(float x, float a, float b) {
  return clamp((x - a) / (b - a), 0.0, 1.0);
}
`

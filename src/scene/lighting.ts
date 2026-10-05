import * as THREE from 'three'
import { KEY_DIR, MOON_DIR } from './sky'

// Web version of the Blender moonlight rig, without relying on exported punctual lights
// (the Blender point lights export with extreme candela values and blow the scene out).
// Blender has three moon sources: Light_Moon (sun, strength 3, colour 0.55/0.68/1.0, 35 degrees
// up), MOONLIGHT_KEY (large area light almost overhead, 0.62/0.70/0.88) and MOONLIGHT_FILL.
// The sun (Light_Moon) casts the shadows, as it does in the Blender frames: long shadows from the
// canopy, cranes and buildings toward the far side. The key light fills from overhead; the
// hemisphere and ambient terms stand in for the world colour
// (0.55/0.68/1.0 at 0.03) and the bounce light. Levels were tuned against Blender renders of
// the same cameras, not guessed.
export function createLighting(scene: THREE.Scene): void {
  const key = new THREE.DirectionalLight(0xbfd4ff, 0.4)
  key.position.copy(KEY_DIR).multiplyScalar(934)
  scene.add(key)
  scene.add(key.target)

  const sun = new THREE.DirectionalLight(0xc2d6ff, 2.0)
  sun.position.copy(MOON_DIR).multiplyScalar(1000)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 4000
  sun.shadow.camera.left = -1200
  sun.shadow.camera.right = 1200
  sun.shadow.camera.top = 1200
  sun.shadow.camera.bottom = -1200
  sun.shadow.bias = -0.0008
  sun.shadow.normalBias = 0.6
  scene.add(sun)
  scene.add(sun.target)

  const hemi = new THREE.HemisphereLight(0x3a5aa0, 0x0a0d14, 0.35)
  scene.add(hemi)

  const ambient = new THREE.AmbientLight(0x24325c, 0.2)
  scene.add(ambient)
}

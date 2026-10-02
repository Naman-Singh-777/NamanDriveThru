import * as THREE from 'three'

// Approximates the Blender Light_Moon + ambient night fill without relying on
// exported punctual lights (some Blender light types don't survive glTF export 1:1).
export function createLighting(scene: THREE.Scene): void {
  const moon = new THREE.DirectionalLight(0xbfd4ff, 3.2)
  moon.position.set(-400, 900, -200)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  moon.shadow.camera.near = 10
  moon.shadow.camera.far = 4000
  moon.shadow.camera.left = -1200
  moon.shadow.camera.right = 1200
  moon.shadow.camera.top = 1200
  moon.shadow.camera.bottom = -1200
  moon.shadow.bias = -0.0008
  scene.add(moon)
  scene.add(moon.target)

  const hemi = new THREE.HemisphereLight(0x33487a, 0x0a0d14, 1.4)
  scene.add(hemi)

  const ambient = new THREE.AmbientLight(0x24325c, 0.9)
  scene.add(ambient)
}

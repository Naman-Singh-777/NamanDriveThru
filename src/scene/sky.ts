import * as THREE from 'three'

// Web-only equivalent of the Blender procedural night sky (dark navy, star field).
// The SKY_DOME mesh/material is intentionally excluded from the GLB export because
// its Voronoi star shader graph and volumetrics do not survive glTF export.
export function createSky(scene: THREE.Scene): { update: (t: number) => void } {
  // Gradient sky dome (simple vertex-colored sphere, cheap to render)
  const skyGeo = new THREE.SphereGeometry(9000, 24, 16)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0a1530) },
      bottomColor: { value: new THREE.Color(0x24345f) },
      offset: { value: 200 },
      exponent: { value: 0.7 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `
  })
  const skyMesh = new THREE.Mesh(skyGeo, skyMat)
  skyMesh.renderOrder = -2
  scene.add(skyMesh)

  // Star field: single Points object, cheap, no per-star meshes.
  const STAR_COUNT = 3500
  const positions = new Float32Array(STAR_COUNT * 3)
  const sizes = new Float32Array(STAR_COUNT)
  for (let i = 0; i < STAR_COUNT; i++) {
    // distribute on upper hemisphere of a large sphere
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(1 - Math.random() * 0.85) // bias toward upper sky
    const r = 8500
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 50
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    sizes[i] = Math.random() * 2.0 + 0.4
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTwinkle: { value: 0 } },
    vertexShader: `
      attribute float size;
      varying float vAlpha;
      uniform float uTwinkle;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * (300.0 / -mvPosition.z);
        vAlpha = 0.6 + 0.4 * sin(uTwinkle + position.x * 0.01);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(0.85, 0.9, 1.0, a);
      }
    `
  })
  const stars = new THREE.Points(starGeo, starMat)
  stars.renderOrder = -1
  scene.add(stars)

  scene.fog = new THREE.FogExp2(0x0a1020, 0.00018)

  return {
    update(t: number) {
      starMat.uniforms.uTwinkle.value = t * 0.5
    }
  }
}

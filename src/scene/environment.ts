import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { applyPortRailFix } from './portRailFix'
import { applyCityRailFix } from './cityRailFix'
import { applyOceanMaterial } from './ocean'
import { applyProceduralMaterials } from './proceduralMaterials'
import { applyBuildingLights } from './buildingLights'
import { buildShoreSim } from './shoreSim'
import { applyRockOverlay } from './rockDetail'

// WEB-FIX-07: MAT_CLIFF/MAT_CLIFF.002 (76 exported meshes -- the dominant terrain
// material) are procedural Blender node materials, confirmed by read-only inspection
// of the live Blender source (not guessed): a 3D noise (Scale 2.2) drives a
// brightening color ramp that's multiplied over a flat "dry" base color, and a
// second, separate world-height gradient (real calibration: Blender Z 12 -> dry,
// Z -3 -> fully wet, linear, clamped -- Blender Z is glTF/Three.js world Y after the
// standard up-axis export conversion) blends that toward a lighter "wet" tint near
// the waterline, with a matching roughness gradient (dry noise-modulated
// 0.75-0.98, wet flat 0.28). None of this survives glTF export (only flat
// baseColorFactor/roughnessFactor fields do), which is why the WEB-FIX-06B flat-
// color substitute still reads as visibly flatter than Blender's terrain. This
// reproduces the same node graph structure in GLSL via onBeforeCompile -- not
// pixel-identical noise (Three.js can't run Blender's Noise Texture node), but the
// same real, calibrated color/roughness values and the same two-factor (surface
// noise + height wetness) mixing logic, applied at the actual per-fragment world
// position rather than one flat average.
function applyCliffProceduralShader(mat: THREE.MeshStandardMaterial): void {
  // WEB-FIX-08 ROOT CAUSE: this material has NO baseColorFactor/roughnessFactor in
  // the exported GLB at all (verified against the raw glTF JSON) -- per spec, a
  // missing baseColorFactor defaults to pure WHITE and a missing roughnessFactor
  // defaults to fully-matte 1.0. The onBeforeCompile shader below was the ONLY thing
  // ever setting this material's actual appearance -- there was no uniform-level
  // color/roughness fallback. That is fragile: Three.js's WebGLPrograms shader cache
  // keys a compiled program primarily off each material's defines/parameters PLUS
  // `material.customProgramCacheKey()`, which defaults to an empty string for every
  // material that doesn't override it. This GLB has ~60 other texture-less
  // MeshStandardMaterials sharing an essentially identical defines fingerprint (no
  // maps of any kind anywhere in this file), so without a unique cache key here,
  // Three.js can legally reuse an already-compiled, UNMODIFIED program for this
  // material's draw calls -- silently skipping the onBeforeCompile GLSL injection
  // entirely, with no error, on some material-compile orderings. That failure mode
  // reproduces exactly what real-browser video evidence showed: 77 meshes (MAT_CLIFF
  // + MAT_CLIFF.002) rendering as a single flat, uniform, washed-out tone with zero
  // noise/wetness variation -- i.e. falling through to the glTF white/roughness-1.0
  // default, not a partially-working shader. Two fixes, both real (not invented
  // values -- same dry-base/roughness figures already used inside the shader below):
  // (1) a dedicated customProgramCacheKey so this material can never share a cached
  // program with anything else, guaranteeing the modified shader is what's actually
  // bound; (2) setting .color/.roughness as a uniform-level fallback so that even in
  // a worst case the material shows the correct dark rock tone instead of glTF-
  // default white, rather than depending on onBeforeCompile alone.
  mat.color.setRGB(0.085, 0.088, 0.098)
  mat.roughness = 0.85
  mat.customProgramCacheKey = () => 'MAT_CLIFF_PROCEDURAL_V1'
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCliffWorldPos;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCliffWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCliffWorldPos;
        float cliffHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float cliffNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(cliffHash(i + vec3(0.0,0.0,0.0)), cliffHash(i + vec3(1.0,0.0,0.0)), f.x),
                mix(cliffHash(i + vec3(0.0,1.0,0.0)), cliffHash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
            mix(mix(cliffHash(i + vec3(0.0,0.0,1.0)), cliffHash(i + vec3(1.0,0.0,1.0)), f.x),
                mix(cliffHash(i + vec3(0.0,1.0,1.0)), cliffHash(i + vec3(1.0,1.0,1.0)), f.x), f.y),
            f.z);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 dryBase = vec3(0.085, 0.088, 0.098);
          vec3 wetTint = vec3(0.35, 0.37, 0.40);
          float nVar = cliffNoise(vCliffWorldPos * 2.2);
          vec3 rampColor = mix(vec3(0.55, 0.55, 0.60), vec3(1.05, 1.05, 1.08), nVar);
          vec3 variedColor = mix(dryBase, dryBase * rampColor, 0.55);
          float wetness = clamp((12.0 - vCliffWorldPos.y) / 15.0, 0.0, 1.0);
          diffuseColor.rgb = mix(variedColor, wetTint, wetness);
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float nRough = cliffNoise(vCliffWorldPos * 14.0);
          float roughDry = mix(0.75, 0.98, nRough);
          float wetnessR = clamp((12.0 - vCliffWorldPos.y) / 15.0, 0.0, 1.0);
          roughnessFactor = mix(roughDry, 0.28, wetnessR);
        }`
      )
  }
  mat.needsUpdate = true
}

export interface LoadedEnvironment {
  root: THREE.Group
  vehicleRoot: THREE.Object3D
  vehicleBody: THREE.Object3D
  wheels: { FL: THREE.Object3D; FR: THREE.Object3D; RL: THREE.Object3D; RR: THREE.Object3D }
}

export function loadEnvironment(
  scene: THREE.Scene,
  onProgress: (pct: number) => void
): Promise<LoadedEnvironment> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      'assets/environment.glb',
      (gltf) => {
        const root = gltf.scene
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) {
            mesh.castShadow = true
            mesh.receiveShadow = true
          }
        })
        scene.add(root)

        // Strip lights imported from the GLB itself (Blender's exported streetlamp
        // point lights, converted to extreme candela values) — they are not part of
        // the deliberate web lighting rig in lighting.ts and were overexposing the
        // whole scene to white. Emissive lamp-glass materials still glow visually.
        const importedLights: THREE.Object3D[] = []
        root.traverse((obj) => {
          if ((obj as THREE.Light).isLight) importedLights.push(obj)
        })
        for (const l of importedLights) l.parent?.remove(l)

        // WEB-PHASE-4 REDO: 11 small "RoadDetail_Barrier_Road_{North,South,
        // East,West}_N" props (thin, low, ~7.5-unit road-edge blocks) read as
        // a stray dark bar from the driving camera and the user asked for
        // them gone map-wide. Confirmed read-only (grep) that neither
        // staticColliders.ts nor roadBoundaries.ts reference "Barrier" or
        // "RoadDetail" in any collision logic -- these are purely decorative,
        // so removing them from the render graph changes nothing about
        // driving/collision. Same non-destructive pattern as the imported-
        // light strip above: detached from the loaded THREE graph, the
        // locked GLB/Blender source itself is never written to.
        const strayBarriers: THREE.Object3D[] = []
        root.traverse((obj) => {
          if (/^RoadDetail_Barrier_/i.test(obj.name)) strayBarriers.push(obj)
        })
        for (const b of strayBarriers) b.parent?.remove(b)

        // Port: the road-side street lamp StreetLight_Road_West_0 stands inside the
        // Container_Group_02 cargo stack (bounding boxes overlap). Removed from the render
        // graph at load, same non-destructive pattern as above. staticColliders.ts builds
        // its colliders from this graph afterwards, so the lamp's collider goes with it
        // instead of leaving an invisible post. The locked GLB is never written to.
        const cargoLamp = root.getObjectByName('StreetLight_Road_West_0')
        if (cargoLamp) cargoLamp.parent?.remove(cargoLamp)

        // Port edge railings: restore the missing sections and re-seat the four corner
        // lamps (see portRailFix.ts). Runs after the light strip above so the lamp
        // lights are already gone and only the lamp meshes move.
        applyPortRailFix(root)

        // City perimeter railing: seat the rails on the deck and put every lamp on a
        // post (see cityRailFix.ts). Same load-time, graph-only pattern.
        applyCityRailFix(root)

        // Rock wash simulation (shoreSim.ts): swell running up the rocks, spray, foam. It reads the
        // rock meshes only, and feeds the water and rock materials below plus one spray object.
        const shore = buildShoreSim(root)
        if (shore) scene.add(shore.spray)

        // MAT_WATER exported with no base colour, so it defaulted to flat white. It is rebuilt as
        // real ocean water (see ocean.ts): Blender's body colour, IOR 1.333, animated waves,
        // foam. Material only, the baked ocean mesh itself is untouched.
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || Array.isArray(mesh.material)) return
          const mat = mesh.material as THREE.MeshStandardMaterial | undefined
          if (!mat) return
          if (/ocean|water/i.test(obj.name) || /water/i.test(mat.name ?? '')) applyOceanMaterial(mesh, scene.environment, shore)
        })

        // BodyPaint (the car's main paint shell) exported with only metallicFactor=0
        // surviving — no roughness/color, so it defaulted to glTF's flat white +
        // fully-rough (roughness=1) values. That combination reads as chalky matte
        // primer, not glossy automotive paint, which is the dominant reason the car
        // reads as washed-out white. Fixing only what's missing (roughness/sheen) —
        // its actual authored color is left exactly as exported, nothing invented.
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || !mesh.material) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial
            if (mat.name === 'BodyPaint') {
              mat.roughness = 0.28
              mat.metalness = 0.12
              mat.envMapIntensity = 1.1
              mat.needsUpdate = true
            }
          }
        })

        // The Blender procedural materials (wet/pillar/quay/city concrete, rusted steel, tarnished
        // bronze, building facade) are rebuilt from their real node graphs in
        // proceduralMaterials.ts; the cliff rock keeps its own shader above.
        const CLIFF_PROCEDURAL = new Set(['MAT_CLIFF', 'MAT_CLIFF.002'])
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || !mesh.material) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial
            if (CLIFF_PROCEDURAL.has(mat.name)) {
              mat.envMapIntensity = 1.0
              applyCliffProceduralShader(mat)
            }
            // MAT_ROAD exported without a roughness (glTF default 1.0, fully matte). In Blender its
            // roughness ramp runs 0.12 to 0.40, a wet-looking asphalt. roadEndCaps.ts copies this
            // value, so the caps stay in step.
            if (mat.name === 'MAT_ROAD') {
              mat.roughness = 0.3
              mat.needsUpdate = true
            }
          }
        })
        applyProceduralMaterials(root)

        // Extra rock texture and the wet band from the wash simulation, on top of the existing rock
        // colours: the cliff ramp above, and the flat terrain / headland colours.
        const ROCK_OVERLAY: Record<string, string> = {
          'MAT_CLIFF': 'ROCK_OVERLAY_CLIFF_V1',
          'MAT_CLIFF.002': 'ROCK_OVERLAY_CLIFF2_V1',
          'MAT_TERRAIN.004': 'ROCK_OVERLAY_TERRAIN_V1',
          'MAT_HEADLAND_ROCK_PORT': 'ROCK_OVERLAY_HEADLAND_V1'
        }
        const overlaid = new Set<THREE.Material>()
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (!mesh.isMesh || !mesh.material) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of mats) {
            const key = ROCK_OVERLAY[m.name]
            if (!key || overlaid.has(m)) continue
            overlaid.add(m)
            applyRockOverlay(m as THREE.MeshStandardMaterial, shore, key)
          }
        })
        // Windows that switch on and off over time (see buildingLights.ts).
        applyBuildingLights(root)

        const find = (name: string): THREE.Object3D => {
          const o = root.getObjectByName(name)
          if (!o) throw new Error(`Required node "${name}" missing from environment.glb`)
          return o
        }

        const env: LoadedEnvironment = {
          root,
          vehicleRoot: find('Vehicle_ROOT'),
          vehicleBody: find('Vehicle_Body'),
          wheels: {
            FL: find('Vehicle_Wheel_FL'),
            FR: find('Vehicle_Wheel_FR'),
            RL: find('Vehicle_Wheel_RL'),
            RR: find('Vehicle_Wheel_RR')
          }
        }
        resolve(env)
      },
      (evt) => {
        if (evt.total) onProgress(evt.loaded / evt.total)
      },
      (err) => reject(err)
    )
  })
}

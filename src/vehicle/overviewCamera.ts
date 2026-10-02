import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// WEB-PHASE-2/3F: new, additive full-map overview camera, toggled by the O key
// in main.ts (confirmed unbound -- see controls.ts/main.ts's existing keydown
// handler, which only used F/L/R/Shift+L/Shift+R). Does not modify or reuse any
// existing camera class -- VehicleCamera/DiagnosticCamera/SideDiagnosticCamera/
// HeroCamera are untouched.
//
// WEB-PHASE-2/3H: per explicit user correction, this is now a FIXED, true
// top-down camera -- not a diagonal angle, and not one that follows the car
// (the car is confined to the drivable area by collision anyway, so a fixed
// frame around that area always keeps it in view). Framing is derived purely
// from real measured geometry, never guessed:
//  - left/right edges: the drivable network's own X-extent (the same
//    DRIVABLE_RE classification staticColliders.ts already uses for what the
//    car can drive on).
//  - front (top-of-screen) edge: City's own real extent (CITY_RE below),
//    which reaches slightly past where Road_North's own mesh ends -- using
//    the city's own geometry, not just the connecting road, so the city is
//    never cropped.
//  - back (bottom-of-screen) edge: the car's own spawn position, captured
//    once at construction (before any driving), per the explicit instruction
//    to align the bottom edge with the starting point.
// The camera sits directly above the center of that rectangle and looks
// straight down (perpendicular to the ground plane) -- camera.up is set to
// -Z so the city (negative Z) renders at the top of the frame and the spawn
// (positive Z) at the bottom, matching a conventional north-up map. Height is
// recomputed from the camera's live fov/aspect each update() (not cached) so
// a window resize can't leave the fit stale.
export class OverviewCamera {
  private camera: THREE.PerspectiveCamera

  // Fixed world-space rectangle this camera frames, computed once from real
  // geometry at construction (see class comment).
  private readonly centerX: number
  private readonly centerZ: number
  private readonly halfSpanX: number
  private readonly halfSpanZ: number
  private readonly groundY: number

  constructor(camera: THREE.PerspectiveCamera, mapRoot: THREE.Object3D, vehicleRoot: THREE.Object3D, vehicle: Vehicle) {
    this.camera = camera

    const DRIVABLE_RE = /^(road_|intersection|openplatform_pad|port_dock|port_structure|port_quayextension|port_quaypilings|roaddetail_strip)/i
    const CITY_RE = /^(city_|cityrail_|citydetail_)/i

    mapRoot.updateWorldMatrix(true, true)
    function boxOf(re: RegExp): THREE.Box2 {
      const b = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity))
      mapRoot.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || !re.test(o.name)) return
        let p: THREE.Object3D | null = o
        while (p) {
          if (p === vehicleRoot) return // skip the vehicle's own hierarchy
          p = p.parent
        }
        const wb = new THREE.Box3().expandByObject(mesh)
        b.min.x = Math.min(b.min.x, wb.min.x)
        b.min.y = Math.min(b.min.y, wb.min.z)
        b.max.x = Math.max(b.max.x, wb.max.x)
        b.max.y = Math.max(b.max.y, wb.max.z)
      })
      return b
    }
    const drivable = boxOf(DRIVABLE_RE)
    const city = boxOf(CITY_RE)
    const spawn = vehicle.position.clone() // captured once, before any driving

    const zFront = Math.min(drivable.min.y, city.min.y) // city side (more negative Z)
    const zBack = spawn.z // starting-point side

    this.centerX = (drivable.min.x + drivable.max.x) / 2
    this.centerZ = (zFront + zBack) / 2
    this.halfSpanX = (drivable.max.x - drivable.min.x) / 2
    this.halfSpanZ = Math.abs(zBack - zFront) / 2
    this.groundY = spawn.y
  }

  update(_vehicle: Vehicle, _dt: number): void {
    // Static frame -- recomputed from the camera's live fov/aspect (not
    // cached) so a window resize never leaves a stale fit, but the world-space
    // rectangle itself (centerX/centerZ/halfSpanX/halfSpanZ) never changes.
    const vFovHalf = THREE.MathUtils.degToRad(this.camera.fov / 2)
    // WEB-PHASE-2/3H: a hairline 1.5% margin -- not a visible-looking
    // margin, just enough that the exact city/spawn/drivable-edge points
    // this frame is aligned to don't land precisely on the clip-plane
    // boundary, where floating-point rounding could clip a pixel of them.
    const EDGE_MARGIN = 1.015
    const heightForZ = (this.halfSpanZ * EDGE_MARGIN) / Math.tan(vFovHalf)
    const heightForX = (this.halfSpanX * EDGE_MARGIN) / (Math.tan(vFovHalf) * this.camera.aspect)
    const height = Math.max(heightForZ, heightForX)

    this.camera.position.set(this.centerX, this.groundY + height, this.centerZ)
    // -Z (toward the city) renders at the top of the frame, +Z (toward spawn)
    // at the bottom -- a conventional north-up map orientation.
    this.camera.up.set(0, 0, -1)
    this.camera.lookAt(this.centerX, this.groundY, this.centerZ)
  }

  // No persistent lerp state to reset (the frame is fixed), kept only so
  // main.ts's existing "reset whichever camera is switched to" dispatch stays
  // uniform across every camera class.
  reset(): void {
    /* no-op */
  }
}

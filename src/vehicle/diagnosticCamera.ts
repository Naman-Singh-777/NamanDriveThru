import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// WEB-FIX-08: temporary wheel-diagnostic camera, toggled with the F key (see main.ts).
// Purpose only: give a camera angle that actually keeps both front wheels on screen
// through a steering maneuver, so wheel behavior can be visually verified -- the
// normal third-person chase camera (vehicleCamera.ts) sits close behind the car and
// is fully occluded by the car's own rear bodywork, which is why the PASS_1.mp4
// review could not evaluate the wheels at all.
//
// This class does not touch physics, vehicle transforms, wheel transforms, controls,
// or VehicleCamera in any way -- it only reads Vehicle.position/quaternion (the same
// public read-only getters VehicleCamera already uses) and writes to the shared
// THREE.PerspectiveCamera. main.ts calls either this or VehicleCamera per frame,
// never both, so toggling F cannot affect gameplay, collisions, or the normal camera.
export class DiagnosticCamera {
  private camera: THREE.PerspectiveCamera
  private currentPos = new THREE.Vector3()
  private currentLookAt = new THREE.Vector3()
  private initialized = false

  private readonly frontDistance: number
  private readonly lateralOffset: number
  private readonly height: number

  constructor(camera: THREE.PerspectiveCamera, vehicleLength: number) {
    this.camera = camera
    // Front 3/4 elevated view: ahead of the car (opposite side from the normal chase
    // cam), offset to one side so the near-side front wheel doesn't fill the frame
    // and the far-side front wheel isn't hidden behind the body, and elevated to
    // just above wheel-hub height (not a flat, wheel-hiding straight-on front shot).
    this.frontDistance = vehicleLength * 1.6
    this.lateralOffset = vehicleLength * 1.35
    this.height = vehicleLength * 0.55
  }

  // Called every frame diagnostic mode is active, in place of VehicleCamera.update().
  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position
    const quat = vehicle.quaternion
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat)
    const up = new THREE.Vector3(0, 1, 0)

    const desired = pos
      .clone()
      .add(forward.clone().multiplyScalar(this.frontDistance))
      .add(right.clone().multiplyScalar(this.lateralOffset))
      .add(up.clone().multiplyScalar(this.height))

    // Look back at the front-wheel area of the car (slightly ahead of center, low),
    // not the car's geometric center, so both front wheels stay framed together.
    const lookTarget = pos
      .clone()
      .add(forward.clone().multiplyScalar(this.frontDistance * 0.25))
      .add(up.clone().multiplyScalar(this.height * 0.25))

    if (!this.initialized) {
      this.currentPos.copy(desired)
      this.currentLookAt.copy(lookTarget)
      this.initialized = true
    } else {
      // Same smoothing approach as VehicleCamera, tuned slightly snappier so the
      // wheels don't lag out of frame during a quick steering test.
      const posLerp = 1 - Math.pow(0.0005, dt)
      const lookLerp = 1 - Math.pow(0.0003, dt)
      this.currentPos.lerp(desired, posLerp)
      this.currentLookAt.lerp(lookTarget, lookLerp)
    }

    this.camera.position.copy(this.currentPos)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.currentLookAt)
  }

  // Called once when switching back to the normal camera, so the chase cam doesn't
  // snap-lerp across the map from wherever the diagnostic camera was.
  reset(): void {
    this.initialized = false
  }
}

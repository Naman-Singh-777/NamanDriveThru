import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// Fixed third-person chase camera: above/behind the car, looking forward along
// its travel direction. No orbit, no free look — only smooth follow + a simple
// obstruction check so it doesn't clip through pillars/railings/terrain.
export class VehicleCamera {
  private camera: THREE.PerspectiveCamera
  private raycaster = new THREE.Raycaster()
  private currentPos = new THREE.Vector3()
  private currentLookAt = new THREE.Vector3()
  private initialized = false

  private readonly rearDistance: number
  private readonly height: number
  private readonly lookAhead: number

  constructor(camera: THREE.PerspectiveCamera, vehicleLength: number) {
    this.camera = camera
    // Pulled back further than the original "6-9m behind" figure — at the tighter
    // distance the car filled almost the whole frame and hid the road ahead. This
    // keeps the same fixed rear/above framing, just further out.
    this.rearDistance = vehicleLength * 1.7
    this.height = vehicleLength * 0.95
    this.lookAhead = vehicleLength * 2.4
  }

  update(vehicle: Vehicle, colliders: THREE.Object3D[], dt: number): void {
    // Follow the pose the car is actually drawn at (interpolated), not the stepped physics pose.
    const pos = vehicle.visualPosition
    const quat = vehicle.visualQuaternion
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
    const up = new THREE.Vector3(0, 1, 0)

    const desired = pos
      .clone()
      .sub(forward.clone().multiplyScalar(this.rearDistance))
      .add(up.clone().multiplyScalar(this.height))

    // obstruction check: ray from just above the car (not the car's own center,
    // which sits right at/near road height and was causing false-positive hits on
    // ground/road geometry) toward the desired camera position.
    const rayOrigin = pos.clone().add(up.clone().multiplyScalar(this.height * 0.35))
    const toCam = desired.clone().sub(rayOrigin)
    const dist = toCam.length()
    // never let an obstruction pull the camera closer than this — keeps us outside the car
    const minDist = Math.max(this.rearDistance * 0.6, this.height * 0.6)
    if (dist > 0.01 && colliders.length) {
      this.raycaster.set(rayOrigin, toCam.clone().normalize())
      this.raycaster.far = dist
      const hits = this.raycaster.intersectObjects(colliders, true)
      if (hits.length && hits[0].distance < dist) {
        const pullback = Math.max(hits[0].distance - 1.5, minDist)
        desired.copy(rayOrigin).add(toCam.normalize().multiplyScalar(pullback))
      }
    }

    const lookTarget = pos.clone().add(forward.clone().multiplyScalar(this.lookAhead)).add(up.clone().multiplyScalar(this.height * 0.25))

    if (!this.initialized) {
      this.currentPos.copy(desired)
      this.currentLookAt.copy(lookTarget)
      this.initialized = true
    } else {
      const posLerp = 1 - Math.pow(0.0001, dt)
      const lookLerp = 1 - Math.pow(0.00005, dt)
      this.currentPos.lerp(desired, posLerp)
      this.currentLookAt.lerp(lookTarget, lookLerp)
    }

    this.camera.position.copy(this.currentPos)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.currentLookAt)
  }

  // WEB-FIX-08: called once when switching back from the diagnostic camera (see
  // diagnosticCamera.ts) so this camera re-anchors at its current desired position
  // instead of lerping across the map from wherever it was last left off. Does not
  // change update()'s normal per-frame behavior at all.
  reset(): void {
    this.initialized = false
  }
}

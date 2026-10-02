import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// WEB-FIX-09: temporary wheel-diagnostic side cameras, toggled with the L and R
// keys (see main.ts). Purpose: PASS_2.mp4 (reviewed with the WEB-FIX-08 F camera)
// gave the first direct visual confirmation of a periodic front-left (FL, wheel
// index 0) transform glitch -- the wheel briefly snaps to a displaced, tipped-over
// pose every ~0.35-0.4s. The F camera's front-3/4 framing is good at keeping both
// front wheels on screen, but it can't show whether the glitch is a lateral
// translation, a longitudinal translation, a rotation about the chassis, a rotation
// about the wheel's own axle, or a suspension-point detachment -- a near-perpendicular
// side view, which keeps that side's FRONT AND REAR wheel in frame together, is what
// can actually distinguish those. One instance of this class is used for the left
// side (near the FL/RL wheels) and a mirrored instance for the right side (near the
// FR/RR wheels), selected by the `side` constructor argument.
//
// Exactly like DiagnosticCamera (diagnosticCamera.ts), this class is READ-ONLY with
// respect to the simulation: it only reads Vehicle.position/quaternion (the same
// public getters VehicleCamera and DiagnosticCamera already use) and writes to the
// shared THREE.PerspectiveCamera. It never touches physics, vehicle transforms, wheel
// transforms, controls, or collision in any way. main.ts's animate() loop calls at
// most one of {chaseCam, diagnosticCam, leftCam, rightCam} per frame, so toggling
// L/R cannot affect gameplay any more than the existing F toggle can.
export class SideDiagnosticCamera {
  private camera: THREE.PerspectiveCamera
  private currentPos = new THREE.Vector3()
  private currentLookAt = new THREE.Vector3()
  private initialized = false

  // +1 = left side of the car (local +X, the FL/RL side -- see vehicle.ts's GLB
  // node data: Vehicle_Wheel_FL sits at local x=+1.195, Vehicle_Wheel_FR at
  // x=-1.195). -1 = right side (FR/RR).
  private readonly sideSign: 1 | -1

  private readonly lateralOffset: number
  private readonly height: number

  constructor(camera: THREE.PerspectiveCamera, vehicleLength: number, side: 'left' | 'right') {
    this.camera = camera
    this.sideSign = side === 'left' ? 1 : -1
    // Exactly parallel to the car: purely lateral + vertical offset, zero
    // forward/backward offset, so the camera sits directly abeam the car and looks
    // straight across at its flank (not at a 3/4 angle) -- with enough lateral
    // distance to fit the full front-to-rear wheel span of that side in frame at
    // once, which the F camera's tighter, front-biased framing does not attempt to do.
    this.lateralOffset = vehicleLength * 2.0
    this.height = vehicleLength * 0.6
  }

  // Called every frame this side's diagnostic mode is active, in place of either
  // VehicleCamera.update() or DiagnosticCamera.update().
  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position
    const quat = vehicle.quaternion
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat)
    const up = new THREE.Vector3(0, 1, 0)

    const desired = pos
      .clone()
      .add(right.clone().multiplyScalar(this.lateralOffset * this.sideSign))
      .add(up.clone().multiplyScalar(this.height))

    // Look at the car's own center (not biased toward the front like the F camera
    // is), so both the front and rear wheel on this side stay framed together.
    const lookTarget = pos.clone().add(up.clone().multiplyScalar(this.height * 0.3))

    if (!this.initialized) {
      this.currentPos.copy(desired)
      this.currentLookAt.copy(lookTarget)
      this.initialized = true
    } else {
      // Same smoothing approach as DiagnosticCamera.
      const posLerp = 1 - Math.pow(0.0005, dt)
      const lookLerp = 1 - Math.pow(0.0003, dt)
      this.currentPos.lerp(desired, posLerp)
      this.currentLookAt.lerp(lookTarget, lookLerp)
    }

    this.camera.position.copy(this.currentPos)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.currentLookAt)
  }

  // Called once when switching to/away from this camera, so it re-anchors instead
  // of lerping across the map from a stale position (same pattern as
  // DiagnosticCamera.reset() / VehicleCamera.reset()).
  reset(): void {
    this.initialized = false
  }
}

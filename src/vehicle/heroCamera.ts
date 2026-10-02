import * as THREE from 'three'
import type { Vehicle } from './vehicle'

// L1/R1 cameras: SIDE-INSPECTION cameras, not hero/3-4 shots. Their purpose is
// to let front vs. rear wheel alignment be judged reliably, which requires the
// camera to sit at the car's longitudinal midpoint and look straight across
// (perpendicular to the car's length) -- any forward/backward bias foreshortens
// the shot and lets whichever wheel is nearer the camera's forward offset
// dominate the frame, hiding the other wheel's alignment. That is exactly what
// WEB-FIX-14's oblique framing did wrong (confirmed against the uploaded in-game
// screenshot: front wheel dominant, rear wheel comparison unreliable) and what
// this WEB-FIX-14B correction fixes.
//
// AXLE_MIDPOINT_FRACTION below is not eyeballed: it was measured directly from
// the real, loaded environment.glb (same read-only headless-GLTFLoader-in-Node
// technique validated in WEB-FIX-11E/12 -- real GLTFLoader, real node data, no
// placeholder geometry), replicating vehicle.ts's own constructor math exactly
// (chassisBox = body+all four wheels -> bbox center = vehicle.position; each
// wheel's world position minus that center, un-rotated by the chassis quaternion,
// gives its position in the same chassis-local axes this camera's forward/right
// vectors use) and main.ts's own vehicleLength formula (vehicleBody bbox diagonal
// * 0.55). Measured result: front-axle local Z (avg FL/FR) = +8.5450, rear-axle
// local Z (avg RL/RR) = -11.8139, midpoint Z = -1.6344, vehicleLength = 22.0362
// -- so the axle midpoint sits 1.6344 world units BEHIND vehicle.position (the
// combined body+wheel bounding-box center is not exactly the axle midpoint),
// which is -1.6344 / 22.0362 = -0.0742 * vehicleLength. This is applied as
// forwardOffset below, and (new in this fix) to the look-at target too, so the
// camera's position and its aim point share the same longitudinal coordinate --
// the defining property of a perpendicular side view.
//
// lateralOffset/height are tuned to keep both wheels, the arches/fenders, and
// the lower body/side-skirt uncropped in frame from that same perpendicular
// angle, closer than SideDiagnosticCamera's pure-profile L/R (side.ts,
// lateralOffset 2.0L, wheel-hub height, also zero forward offset but not
// axle-midpoint-corrected) -- that camera is untouched by this fix.
//
// Exactly like the other diagnostic cameras: read-only with respect to the
// simulation -- only reads Vehicle.position/quaternion and writes to the shared
// THREE.PerspectiveCamera. Never touches physics, vehicle transforms, wheel
// transforms, controls, or collision.
const AXLE_MIDPOINT_FRACTION = -0.0742

export class HeroCamera {
  private camera: THREE.PerspectiveCamera
  private currentPos = new THREE.Vector3()
  private currentLookAt = new THREE.Vector3()
  private initialized = false

  private readonly sideSign: 1 | -1
  private readonly forwardOffset: number
  private readonly lateralOffset: number
  private readonly height: number
  // WEB-FIX-14C: look-at vertical target, independent of `height` -- lets the
  // camera position stay low (near-road) while the AIM point is set
  // separately (see WEB-FIX-14D below: retargeted from mid/upper-body down to
  // the tyre centers).
  private readonly lookAtHeight: number

  constructor(camera: THREE.PerspectiveCamera, vehicleLength: number, side: 'left' | 'right') {
    this.camera = camera
    this.sideSign = side === 'left' ? 1 : -1
    // WEB-FIX-14B: forwardOffset is the measured axle midpoint (see file-header
    // comment), not a guessed forward bias -- this is what makes the shot
    // perpendicular instead of oblique/front-3-4. NOT touched by WEB-FIX-14C
    // below (the longitudinal position was confirmed correct).
    this.forwardOffset = vehicleLength * AXLE_MIDPOINT_FRACTION
    // WEB-FIX-14C: the 14B height/lateralOffset put the camera high enough
    // above the car (0.4L) that it looked DOWN at a shallow angle. Pulled both
    // in: height down to near-road level, lateralOffset in slightly for a
    // closer shot, while still comfortably clearing both wheels/arches.
    // camera POSITION untouched by WEB-FIX-14D below (confirmed correct).
    this.lateralOffset = vehicleLength * 0.85
    this.height = vehicleLength * 0.12
    // WEB-FIX-14D: 14C's lookAtHeight (0.28L, aimed at the mid/upper body)
    // over-corrected the tilt -- the resulting screenshot showed the roofline/
    // spoiler/streetlamp/sky, with both tyres cropped out of frame at the
    // bottom entirely. Retargeted to the actual measured tyre-center height
    // instead: the same real-GLB headless measurement used for
    // AXLE_MIDPOINT_FRACTION (see file-header comment) gives each wheel's
    // local Y relative to vehicle.position as -4.5750 world units (identical
    // for FL/FR/RL/RR -- front and rear sit at the same height), which is
    // -4.5750 / 22.0362 (vehicleLength) = -0.2076 * vehicleLength. Aiming here
    // instead of above the car tilts the camera DOWN onto the tyres/wheel
    // centers (the front/rear tyre-center midpoint, since front and rear are
    // the same height) while the lower body/side-skirt -- which sits above
    // wheel-center height -- still falls in the upper part of the frame.
    this.lookAtHeight = vehicleLength * -0.2076
  }

  update(vehicle: Vehicle, dt: number): void {
    const pos = vehicle.position
    const quat = vehicle.quaternion
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat)
    const up = new THREE.Vector3(0, 1, 0)

    const desired = pos
      .clone()
      .add(forward.clone().multiplyScalar(this.forwardOffset))
      .add(right.clone().multiplyScalar(this.lateralOffset * this.sideSign))
      .add(up.clone().multiplyScalar(this.height))

    // WEB-FIX-14B: the look-at target shares the SAME forwardOffset as the
    // camera position above (it previously had none), so the camera looks
    // straight across the car's longitudinal midpoint rather than obliquely
    // toward the whole-car center from a forward-shifted position -- this is
    // the fix for the front-wheel-dominant framing seen in the WEB-FIX-14
    // screenshot. Untouched by WEB-FIX-14C.
    //
    // WEB-FIX-14C/14D: vertical look-at component uses the independent
    // lookAtHeight constant, set (14D) to the measured tyre-center height so
    // the camera tilts DOWN onto the wheels -- see lookAtHeight's declaration
    // and the constructor comment above for the exact measurement.
    const lookTarget = pos
      .clone()
      .add(forward.clone().multiplyScalar(this.forwardOffset))
      .add(up.clone().multiplyScalar(this.lookAtHeight))

    if (!this.initialized) {
      this.currentPos.copy(desired)
      this.currentLookAt.copy(lookTarget)
      this.initialized = true
    } else {
      // Same smoothing approach as the other diagnostic cameras.
      const posLerp = 1 - Math.pow(0.0005, dt)
      const lookLerp = 1 - Math.pow(0.0003, dt)
      this.currentPos.lerp(desired, posLerp)
      this.currentLookAt.lerp(lookTarget, lookLerp)
    }

    this.camera.position.copy(this.currentPos)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.currentLookAt)
  }

  reset(): void {
    this.initialized = false
  }
}

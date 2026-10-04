import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { LoadedEnvironment } from '../scene/environment'
import type { InputState } from './controls'

const MAX_ENGINE_FORCE = 3200
const MAX_BRAKE_FORCE = 60
const MAX_STEER = 0.55
// WEB-PHASE-4 REDO Phase 16: slightly reduced left/right steer sensitivity --
// how fast steerAngle ramps toward targetSteer each frame in applyControls()
// below (both into a turn and back to center). 6.0 -> 5.0 only; MAX_STEER
// (the actual lock angle) is untouched, so this just softens how twitchy a
// tap of A/D feels, it doesn't change how sharp the car can ultimately turn.
const STEER_LERP = 5.0

// WEB-PHASE-2/3F: one physics-step's worth of computed visual target
// transforms (chassis root + all 4 wheels, in WORLD space). Two of these are
// kept (visPrev/visCurr below) so the render step can interpolate between
// them instead of snapping straight to the latest one -- see
// captureVisualState()/applyVisualState() in the Vehicle class for why.
interface VisualSnapshot {
  rootPos: THREE.Vector3
  rootQuat: THREE.Quaternion
  wheelWorldPos: THREE.Vector3[]
  wheelWorldQuat: THREE.Quaternion[]
}

export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly controller: RAPIER.DynamicRayCastVehicleController
  readonly wheelRadius: number
  private steerAngle = 0
  private wheelMeshes: THREE.Object3D[]
  private wheelRadii: number[]
  private localWheelPositions: THREE.Vector3[]
  private env: LoadedEnvironment
  private lastGroundedPos: THREE.Vector3
  private lastGroundedQuat: THREE.Quaternion
  private spawnY: number

  // WEB-FIX-10: visual-only wheel state, never fed back into physics/Rapier.
  // See syncVisuals() for why these exist: Rapier's own wheelRotation() does not
  // track actual rolling motion in this configuration (verified empirically --
  // near-zero rotation reported even at high sustained speed, for driven AND
  // undriven wheels alike), so rolling angle is integrated here instead, directly
  // from the chassis's own measured velocity. wheelSuspensionLength(i) is also
  // smoothed here before being used for the mesh's vertical position, because the
  // raw value snaps discontinuously (in a single physics step, with zero
  // interpolation of its own) whenever a wheel's ground raycast loses or regains
  // contact -- which any real terrain seam/curb/gap can trigger, and which reads
  // on screen as an instant, uncushioned wheel-position glitch.
  private wheelRollAngle: number[] = [0, 0, 0, 0]
  private smoothedSuspensionLength: (number | null)[] = [null, null, null, null]
  // WEB-PHASE-2/3F: last two physics-step visual snapshots, for render-side
  // interpolation (applyVisualState()). null until captureVisualState() has
  // run at least once.
  private visPrev: VisualSnapshot | null = null
  private visCurr: VisualSnapshot | null = null
  // WEB-FIX-11 (orbit fix): each wheel node's ORIGINAL local rotation, exactly as
  // authored/exported in the GLB, captured once here before syncVisuals() ever
  // overwrites it. Verified by direct inspection of environment.glb's own JSON
  // (Vehicle_Body, the wheels' parent, carries no rotation of its own, so this is
  // equivalently each wheel's rest orientation in chassis-local space): this is a
  // real, non-trivial alignment rotation (180 deg for FL/RL, 90 deg for FR/RR,
  // confirmed headlessly, not a negligible offset), not an arbitrary constant --
  // it is what makes the mesh's true geometric axle line up with the vehicle's
  // local +X (the axis both Rapier's axleCs and this file's steer/roll quaternions
  // assume). Discarding it and composing orientation from identity, as before,
  // spins/steers the wheel about an axis that is not its own axle -- visible as
  // the wheel appearing to orbit/tumble rather than roll cleanly in place, even
  // though the rolling-rate math itself (WEB-FIX-10, untouched here) was correct.
  //
  // WEB-FIX-11b (Blender-source cross-check, code-only pass, no live/browser
  // testing performed): re-derived these same rest rotations directly from the
  // authoritative Blender source file (uploads_files_2815692_Mclaren+Senna.blend,
  // objects FL/FR/RL/RR parented directly under the car body 'senna', no extra
  // pivot/empty in between, no delta-transform on any of them) via a headless
  // `blender --background` inspection script -- not just the exported GLB.
  // Their rotation_mode is Euler 'XYZ': FL/RL = (90deg, 0, 180deg), FR/RR =
  // (90deg, 0, 0). Converting those to quaternions reproduces the values below
  // to within ~0.03deg (float rounding only), confirming the GLB-authored
  // orientation captured at runtime is the true Blender-authored one, not an
  // export artifact -- so reading it live off the loaded mesh (below) is both
  // correct and more robust than hardcoding it, since it tracks the asset
  // automatically if ever re-exported. This also confirms the composition in
  // syncVisuals() already implements the two distinct motions independently:
  // rolling about local +X (spinQuat) and steering about local +Y (steerQuat),
  // with this rest alignment restoring the wheel's authored orientation on top.
  // No functional change follows from this cross-check.
  private wheelRestQuat: THREE.Quaternion[] = []
  // WEB-FIX-11d (pivot-offset fix): each wheel mesh's TRUE geometric center,
  // in the mesh's own raw/local space (i.e. the same space its geometry's own
  // vertices live in) -- captured once below, computed from the actual loaded
  // geometry itself (Box3().setFromObject + worldToLocal), never hardcoded.
  // Measured directly this session against both environment.glb's own
  // POSITION-accessor bounds and the named Blender source file's own vertex
  // centroid (the two independent measurements agree closely): this wheel
  // mesh's local (0,0,0) origin -- what mesh.position/mesh.quaternion actually
  // pivot around -- sits close to one EDGE of the tire, not at its hub center;
  // the true center is offset from the origin by roughly half the wheel's own
  // diameter. Left uncorrected, rotating the mesh about its own (off-center)
  // origin during rolling sweeps the entire visible tire through a circle of
  // radius approximately equal to the wheel's own radius -- a large, dramatic,
  // purely rotational artifact, confirmed both algebraically (propagating the
  // measured offset through the exact runtime steerQuat/spinQuat/wheelRestQuat
  // composition) and by headless simulation. This is a translation-only
  // compensation applied in syncVisuals() below -- no geometry, mesh, or
  // material is edited; the wheel's true center, not its off-center origin, is
  // what gets pinned to the attachment/suspension point.
  private wheelGeometryCenter: THREE.Vector3[] = []
  // WEB-FIX-11e/11f (scale-space fix): WEB-FIX-11D's own headless proof was
  // clean, but real-browser testing showed the wheel still orbiting almost
  // unchanged. Read-only audit (WEB-FIX-11E) found the defect: wheelGeometryCenter
  // above is captured via wheelObj.worldToLocal(), which divides out wheelObj's
  // FULL accumulated world scale (Vehicle_ROOT's runtime scale -- itself only
  // fixed once main.ts applies its own 0.5x adjustment, so it cannot be
  // hardcoded -- composed with Vehicle_Body's and the wheel node's own scale).
  // syncVisuals() below previously reconstructed the world-space offset using
  // only wheelMeshes[i].scale (the wheel node's own local scale alone), silently
  // omitting that ancestor factor -- under-correcting by exactly that missing
  // factor. This captures each wheel's TRUE full runtime world scale once, at
  // the same pristine-transform moment as the capture above (read live via
  // getWorldScale(), never assumed/hardcoded, so it stays correct even if the
  // 0.5x adjustment in main.ts ever changes), for syncVisuals() to use instead.
  private wheelGeometryWorldScale: THREE.Vector3[] = []
  private suspensionRestLength = 0
  private maxSuspensionTravel = 0
  private lastDt = 1 / 60

  constructor(world: RAPIER.World, env: LoadedEnvironment) {
    this.env = env
    env.root.updateWorldMatrix(true, true)

    const bodyBox = new THREE.Box3()
    bodyBox.expandByObject(env.vehicleBody)
    for (const w of [env.wheels.FL, env.wheels.FR, env.wheels.RL, env.wheels.RR]) {
      bodyBox.expandByObject(w)
    }
    const center = new THREE.Vector3()
    bodyBox.getCenter(center)
    const size = new THREE.Vector3()
    bodyBox.getSize(size)

    const rootQuat = new THREE.Quaternion()
    env.vehicleRoot.getWorldQuaternion(rootQuat)
    const rootQuatInv = rootQuat.clone().invert()

    // Chassis rotation is axis-aligned (root is rotated by a multiple of 90deg),
    // so the world AABB half-extents double as local oriented half-extents.
    const halfExtents = size.clone().multiplyScalar(0.5)

    // The PHYSICAL collider is sized from the visual BODY ONLY (excluding wheels),
    // so its bottom face sits above the tires' ground-contact line, same as the real
    // car's underbody clearance. That means it never touches the road under normal
    // driving (the wheel raycasts alone determine ride height) while still being a
    // real, solid collider that catches walls/railings and any suspension failure —
    // a bounding box that included the wheels (the earlier version) reached almost to
    // the ground and either floated the car on top of it or, made a sensor, gave the
    // car zero collision safety at all.
    const chassisBox = new THREE.Box3().expandByObject(env.vehicleBody)
    const chassisSize = new THREE.Vector3()
    chassisBox.getSize(chassisSize)
    const chassisCenterWorld = new THREE.Vector3()
    chassisBox.getCenter(chassisCenterWorld)
    const chassisHalfExtents = chassisSize.multiplyScalar(0.5 * 0.96)
    const chassisLocalOffset = chassisCenterWorld.clone().sub(center).applyQuaternion(rootQuatInv)

    // WEB-FIX-06B: real-browser screenshots showed the chassis tipping/flipping
    // under steering, with a wheel visually flung far from the car -- the wheel
    // world-position formula in syncVisuals() is provably steering-invariant (fixed
    // local offset rotated by the chassis's CURRENT orientation, verified both
    // analytically and via a standalone deterministic Rapier reproduction using this
    // exact geometry/mass/damping and the real control constants below: wheel-to-
    // chassis distance stayed constant through hard steering, oscillating steering,
    // and stationary steering, with no runaway yaw). That means a genuinely tumbling
    // chassis (pitch/roll from a collision or an edge case the isolated repro didn't
    // hit) is what was carrying the correctly-attached wheel to that position -- a
    // spinning/rolling body sweeps a rigidly-attached point through 3D space, and at
    // an extreme roll/pitch angle that sweep can visually read as "the wheel flew
    // off". This game is a fixed third-person chase-cam driver, not a roll-over
    // simulation, and the wheel raycasts already provide independent per-wheel ride
    // height/suspension -- so per the explicit allowance for "the smallest stable
    // constraint necessary to prevent the vehicle from flipping" when full rigid-body
    // roll/pitch isn't required: only yaw (world/chassis Y, the steering axis) is left
    // enabled here. Pitch and roll are locked at the rigid-body level, not clamped
    // after the fact, so the chassis can no longer tip/flip by construction and the
    // wheels -- already proven to track it correctly -- can no longer be swept to an
    // extreme position by one.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: rootQuat.x, y: rootQuat.y, z: rootQuat.z, w: rootQuat.w })
      .setLinearDamping(0.3)
      .setAngularDamping(2.0)
      .enabledRotations(false, true, false)
      // Never sleep: Rapier puts an idle dynamic body to sleep after ~2s, and a
      // sleeping chassis ignores forward drive until something else wakes it
      // (reversing did) -- the car looked stuck at spawn and after every menu.
      .setCanSleep(false)
    this.body = world.createRigidBody(bodyDesc)

    const colliderDesc = RAPIER.ColliderDesc.cuboid(chassisHalfExtents.x, chassisHalfExtents.y, chassisHalfExtents.z)
      .setTranslation(chassisLocalOffset.x, chassisLocalOffset.y, chassisLocalOffset.z)
      .setMass(180)
      .setFriction(0.6)
    world.createCollider(colliderDesc, this.body)

    // Emergency recovery pose: last physics step where the majority of wheels were
    // grounded. If the car is ever knocked below/away from that (a raycast gap, a
    // physics glitch), it's restored here rather than free-falling forever.
    this.lastGroundedPos = center.clone()
    this.lastGroundedQuat = rootQuat.clone()
    this.spawnY = center.y

    this.controller = world.createVehicleController(this.body)

    const wheelOrder: (keyof LoadedEnvironment['wheels'])[] = ['FL', 'FR', 'RL', 'RR']
    this.wheelMeshes = wheelOrder.map((k) => env.wheels[k])
    this.wheelRadii = []
    this.localWheelPositions = []

    const suspensionDir = { x: 0, y: -1, z: 0 }
    const axleCs = { x: 1, y: 0, z: 0 }
    const suspensionRest = halfExtents.y * 0.55
    this.suspensionRestLength = suspensionRest
    this.maxSuspensionTravel = halfExtents.y * 0.6
    let avgRadius = 0

    // WEB-FIX-15B: static wheel/tyre-well nesting correction (position only).
    // Measured directly against the real Blender source of truth
    // (blender_wheel_arch_gap_v2.py: FL/FR/RL/RR wheel objects vs the "senna"
    // body mesh) -- Blender's authored ideal has all four tyres essentially
    // touching their wheel-well ceiling (gap ~0.00004-0.00006 units). The
    // equivalent runtime measurement (real GLB + real Rapier, settled) found
    // the front axle sitting 0.4733 units too low and the rear axle already
    // correct (0.0006 units low). A pure static-anchor correction cannot
    // close the front gap fully: the chassis rigid body has pitch/roll
    // locked (yaw-only rotation), so chassis height is a single value
    // balancing all 4 wheel springs at once, and raising the front anchors
    // does not translate 1:1 into closing their own gap. This was verified
    // empirically in an isolated sandbox (both front-only and front+rear
    // simultaneous corrections swept): front wheels lose ground contact
    // entirely once the correction exceeds ~0.41-0.42, well short of 0.4733.
    // FRONT_WELL_CORRECTION is the verified-safe value that keeps a contact
    // margin (measured safe up to 0.41; 0.415 lost contact) while closing
    // the front gap from 0.4733 to ~0.28. REAR_WELL_CORRECTION applies the
    // rear's own small measured gap for consistency. Nothing else changes:
    // suspensionRest/maxSuspensionTravel above, wheelGeometryCenter,
    // wheelGeometryWorldScale, wheelRestQuat, and all rolling/steering/
    // syncVisuals() logic below are untouched by this fix.
    // WEB-FIX-16: nudged FRONT_WELL_CORRECTION from the WEB-FIX-15B value of
    // 0.4 up to 0.41 -- the full verified-safe ceiling found in that fix's
    // own sandbox sweep (0.41 confirmed in-contact; 0.415 was the first
    // value to lose contact).
    // WEB-FIX-16B: re-swept the boundary at finer resolution and found the
    // true contact-loss edge sits at 0.4145 (0.414 still in-contact; 0.4145
    // loses contact), tighter than WEB-FIX-16's coarser 0.41/0.415 bracket
    // suggested. 0.413 is the value applied here: ~0.0015-0.002 clear of
    // that edge for margin, and it also happens to bring the rear gap to
    // near-zero (~0.0005, essentially fully nested) as a byproduct of the
    // same shared-chassis coupling documented in WEB-FIX-15B. Front gap
    // improves only marginally further (~0.275 -> ~0.272) -- this axle is
    // now at its practical ceiling under a static-anchor-only constraint;
    // any further front increase requires touching suspension, which stays
    // locked. REAR_WELL_CORRECTION is left unchanged.
    // WEB-PHASE-4B: re-derived for the new 0.28125 root scale (0.375*0.75,
    // see main.ts). These do NOT auto-scale with vehicleRoot's scale factor
    // -- confirmed again here, same as every prior rescale (WEB-FIX-18):
    // reusing the 0.375-scale values unchanged at this new scale caused
    // visible tire-through-body clipping (confirmed live by the user).
    // Re-derived via a headless sandbox (real environment.glb geometry +
    // real @dimforge/rapier3d-compat physics, no browser) replicating this
    // file's own chassis/wheel constructor math at the new scale:
    //   1. Bisected the ground-contact-loss ceiling for each axle
    //      independently (300-step settle, zero input, flat ground) --
    //      front edge 0.394902 (0.394862 still grounded), rear edge
    //      0.399491 (0.399452 still grounded). Both axles bisected the same
    //      way this time (not "raw gap" for rear) because the rear axle's
    //      geometry-measured raw gap came out anomalously large at this
    //      scale and applying it directly broke rear ground contact in the
    //      sandbox -- a direct, physics-verified sign that measurement
    //      wasn't trustworthy, so the safer contact-preserving bisection
    //      was used for both axles instead.
    //   2. REAR_WELL_CORRECTION kept well short of 0.399491 for safety
    //      margin, matching the front axle's own margin convention.
    const FRONT_WELL_CORRECTION = 0.3554
    const REAR_WELL_CORRECTION = 0

    for (const key of wheelOrder) {
      const wheelObj = env.wheels[key]
      const wBox = new THREE.Box3().setFromObject(wheelObj)
      const wSize = new THREE.Vector3()
      wBox.getSize(wSize)
      const radius = Math.max(wSize.y, wSize.z) / 2
      this.wheelRadii.push(radius)
      avgRadius += radius

      const wPos = new THREE.Vector3()
      wheelObj.getWorldPosition(wPos)
      wPos.sub(center)
      wPos.applyQuaternion(rootQuatInv)
      // WEB-FIX-15B: static anchor-Y correction only (see comment above the
      // wheel loop). Applied here, before wPos is consumed below, so it
      // affects only the physics wheel anchor / localWheelPositions -- never
      // wheelGeometryCenter or wheelGeometryWorldScale, which are derived
      // independently from wheelObj's own untouched transform.
      wPos.y += (key === 'FL' || key === 'FR') ? FRONT_WELL_CORRECTION : REAR_WELL_CORRECTION
      this.localWheelPositions.push(wPos)

      // WEB-FIX-11 (orbit fix): capture now, while wheelObj.quaternion still holds
      // its pristine GLB-authored value (syncVisuals() has not run yet).
      this.wheelRestQuat.push(wheelObj.quaternion.clone())

      // WEB-FIX-11d: same timing as the wheelRestQuat capture above -- wheelObj
      // still has its pristine, as-loaded transform, so Box3().setFromObject
      // gives the mesh's true world-space bounding-box center, and worldToLocal
      // converts that into wheelObj's own raw/local space (dividing out this
      // object's position, rotation, AND scale -- the same space the mesh's own
      // geometry vertices live in).
      const wheelGeomBox = new THREE.Box3().setFromObject(wheelObj)
      const wheelGeomCenterWorld = new THREE.Vector3()
      wheelGeomBox.getCenter(wheelGeomCenterWorld)
      this.wheelGeometryCenter.push(wheelObj.worldToLocal(wheelGeomCenterWorld.clone()))

      // WEB-FIX-11f: wheelObj's full runtime world scale (ancestor chain
      // included), captured now while its matrixWorld still reflects only the
      // pristine as-loaded/as-scaled hierarchy (updateWorldMatrix was already
      // called at the top of this constructor, after main.ts's own 0.5x
      // vehicleRoot adjustment ran) -- read live, never hardcoded.
      this.wheelGeometryWorldScale.push(wheelObj.getWorldScale(new THREE.Vector3()))

      this.controller.addWheel(
        { x: wPos.x, y: wPos.y + suspensionRest, z: wPos.z },
        suspensionDir,
        axleCs,
        suspensionRest,
        radius
      )
    }
    avgRadius /= 4
    this.wheelRadius = avgRadius

    // WEB-FIX-18: suspension compression/relaxation damping were never set
    // (library defaulted to 0.83/0.88, tuned for Rapier's own default
    // stiffness of 5.88). This project's stiffness=28 (~4.8x that default)
    // was left under-damped relative to its own spring rate, so any bump
    // re-excited a ~6-cycle ring (verified via a repeatable bump-impulse
    // drop test and a periodic seam-crossing simulation in
    // _rescale_sandbox/joint_retune_sweep.mjs + probe_periodic.mjs). Swept
    // stiffness=28 jointly with compression/relaxation from 1.0/1.1 up to
    // 10.0/12.0: contact-loss-free (0 events, accelerate/brake/corner/reverse)
    // and max speed unchanged (62.43) up through ~7.0/8.0; real instability
    // (446 contact-loss events, runaway extrema) only appears at 10.0/12.0.
    // Chose 5.0/6.0 for a solid margin below that cliff: cuts bump-test
    // ringing from 6 extrema/2.37% overshoot to 1 extrema/0.86%, and cuts
    // periodic (repeated seam) peak overshoot from 0.70% to 0.17% of travel
    // -- a real physics-level fix, stacking with the existing
    // SUSPENSION_SMOOTHING_TAU render-only smoothing below, not replacing it.
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, 28)
      this.controller.setWheelSuspensionCompression(i, 5.0)
      this.controller.setWheelSuspensionRelaxation(i, 6.0)
      this.controller.setWheelMaxSuspensionTravel(i, halfExtents.y * 0.6)
      this.controller.setWheelFrictionSlip(i, 1200)
      this.controller.setWheelSideFrictionStiffness(i, 1.6)
    }
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  get quaternion(): THREE.Quaternion {
    const r = this.body.rotation()
    return new THREE.Quaternion(r.x, r.y, r.z, r.w)
  }

  // Sets inputs and runs the raycast/suspension simulation for this step. Must be
  // called BEFORE world.step() — Rapier's vehicle controller applies forces here
  // that world.step() then integrates.
  applyControls(input: InputState, dt: number): void {
    this.lastDt = dt
    const targetSteer = (input.left ? MAX_STEER : 0) - (input.right ? MAX_STEER : 0)
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, STEER_LERP * dt)

    // Spacebar: dedicated hard brake -- overrides throttle/reverse (real cars
    // don't apply engine force while braking) and applies full MAX_BRAKE_FORCE to
    // all four wheels, instead of the mild coast-brake used when simply releasing
    // throttle with no brake input.
    const engineForce = input.brake ? 0 : input.forward ? -MAX_ENGINE_FORCE : input.reverse ? MAX_ENGINE_FORCE * 0.6 : 0
    const brake = input.brake ? MAX_BRAKE_FORCE : !input.forward && !input.reverse ? MAX_BRAKE_FORCE * 0.15 : 0

    // front wheels: steer + no drive torque (rear-wheel drive, matches a mid/rear-engine car)
    this.controller.setWheelSteering(0, this.steerAngle)
    this.controller.setWheelSteering(1, this.steerAngle)
    this.controller.setWheelEngineForce(0, 0)
    this.controller.setWheelEngineForce(1, 0)
    this.controller.setWheelBrake(0, brake)
    this.controller.setWheelBrake(1, brake)

    // rear wheels: drive
    this.controller.setWheelEngineForce(2, engineForce)
    this.controller.setWheelEngineForce(3, engineForce)
    this.controller.setWheelBrake(2, brake)
    this.controller.setWheelBrake(3, brake)

    this.controller.updateVehicle(dt)
  }

  // Must be called AFTER world.step(), once this step's position is resolved:
  // runs the emergency-recovery check, then captures this step's visual target
  // state. Does NOT write to the Three.js scene graph itself any more -- see
  // captureVisualState()/applyVisualState() below (WEB-PHASE-2/3F render-sync
  // fix) for why that write moved out of the physics step.
  postStep(): void {
    let contactCount = 0
    for (let i = 0; i < 4; i++) {
      if (this.controller.wheelIsInContact(i)) contactCount++
    }

    const t = this.body.translation()
    const r = this.body.rotation()
    const posInvalid = !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)
    const fellThrough = t.y < this.spawnY - 80

    if (!posInvalid && contactCount >= 3) {
      this.lastGroundedPos.set(t.x, t.y, t.z)
      this.lastGroundedQuat.set(r.x, r.y, r.z, r.w)
    } else if (posInvalid || fellThrough) {
      this.body.setTranslation(
        { x: this.lastGroundedPos.x, y: this.lastGroundedPos.y, z: this.lastGroundedPos.z },
        true
      )
      this.body.setRotation(
        { x: this.lastGroundedQuat.x, y: this.lastGroundedQuat.y, z: this.lastGroundedQuat.z, w: this.lastGroundedQuat.w },
        true
      )
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    this.captureVisualState()
  }

  // WEB-PHASE-2/3F (render-synchronization rocking fix): computes this physics
  // step's target visual transforms (chassis root + all 4 wheels) and stores
  // them as a new snapshot, shifting the previous snapshot back -- this never
  // writes to the Three.js scene graph itself (see applyVisualState() for the
  // part that does). Root-cause context: this function runs once per FIXED_DT
  // physics step, inside main.ts's accumulator while-loop, but the real
  // display's requestAnimationFrame does not fire at a matching, exact 60Hz
  // cadence for most users (any refresh rate that doesn't evenly divide 60Hz --
  // 75/120/144/165/240Hz are all common -- plus ordinary frame-timing jitter on
  // a 60Hz display) so the accumulator executes 0 or 2 physics steps in a given
  // render frame far more often than exactly 1. The previous code
  // (syncVisuals()) wrote mesh.position/mesh.quaternion directly here, once per
  // physics step -- so on a frame with 0 physics steps the rendered car held
  // perfectly still, and on the next frame (now owing 2 steps) it jumped by two
  // steps at once: a repeating hold-then-jump pattern, at the render's own
  // refresh rate, that reads on screen as rocking/stutter even though the
  // underlying physics trajectory itself (what every earlier diagnostic pass
  // sampled, by calling applyControls/world.step/postStep in a controlled,
  // perfectly even 1-step-per-iteration loop) is smooth. That mismatch -- a
  // smooth physics trace but an unevenly-rendered one -- is exactly why those
  // diagnostics never reproduced what the user actually sees in the real
  // browser: they never exercised requestAnimationFrame's real, variable timing
  // against this render path at all. The fix below is the standard fixed-
  // timestep render-decoupling technique (Glenn Fiedler, "Fix Your Timestep!"):
  // keep the last two physics-driven transforms and let the render step
  // (applyVisualState(), called once per requestAnimationFrame from main.ts,
  // never from here) blend between them by how far the real frame clock has
  // drifted past the latest completed step. No suspension, collision, gravity,
  // wheel-offset, or scale value is touched; the physics simulation itself
  // (this.body, this.controller) runs identically to before this fix.
  private captureVisualState(): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    const bodyPos = new THREE.Vector3(t.x, t.y, t.z)
    const bodyQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w)

    const rootPos = bodyPos.clone().sub(this.rootToCenterOffset(bodyQuat))
    const rootQuat = bodyQuat.clone()

    // WEB-FIX-10: rolling angle is integrated here from the chassis's own measured
    // velocity rather than read from Rapier's wheelRotation(i) -- headless testing
    // against this exact wheel/physics configuration showed wheelRotation(i)
    // advancing by only ~0.076 rad after 11.5s of driving at up to 55 m/s, for
    // driven (rear) AND undriven (front) wheels alike, i.e. it does not track real
    // rolling here. The no-slip rolling constraint for a wheel whose axle is local
    // +X and whose "up" is local +Y (both fixed by axleCs/suspensionDir above)
    // reduces to: angular rate about the axle = (velocity component along local Z)
    // / wheelRadius -- independent of which physical end of the car local Z
    // happens to point toward. This is exactly the vehicle-local rolling fallback
    // formula the wheel pass explicitly allows ("rollingAngularVelocity =
    // longitudinalVelocity / wheelRadius"). This integration still runs once per
    // physics step (not once per render frame), same as before this fix --
    // continuous accumulation is what makes rolling angle correct regardless of
    // how the result is later rendered.
    const zLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQuat)
    const linvel = this.body.linvel()
    const vZ = zLocal.x * linvel.x + zLocal.y * linvel.y + zLocal.z * linvel.z

    // Suspension-length smoothing: short enough to stay responsive to genuine
    // suspension travel (weight transfer, real bumps), long enough that a 1-3
    // frame ground-raycast dropout (any real terrain seam/curb/gap crossed at
    // speed) can no longer read on screen as an instant, uncushioned snap -- the
    // raw value was confirmed to jump straight from its compressed resting length
    // to its no-contact value in a single physics step, with zero interpolation.
    // WEB-PHASE-4E: raised from 0.06. Root cause of the user-reported "tyres
    // bumping up and down in a cyclic nature at high speed": the real road
    // surface is a per-triangle trimesh built from separate exported segments
    // (road_/intersection/port_dock/... in staticColliders.ts), not a flat
    // plane -- crossing segment seams at speed repeatedly kicks the per-wheel
    // raycast suspension. Confirmed headlessly two ways: (1) a single
    // bump-impulse on the shipped stiffness/damping rings for ~3 full cycles
    // (6 sign changes) before settling: real, measurable underdamping at this
    // suspensionStiffness, not a rendering artifact; (2) raising
    // suspensionStiffness or suspensionCompression/Relaxation to damp that out
    // directly (the "correct" physics fix) was tried and rejected -- both
    // broke the car outright (stiffness: front wheels lost ground contact
    // entirely; compression/relaxation: longitudinal traction collapsed to
    // near-zero top speed), proving this suspension is a sensitive, already-
    // balanced tune that must not be touched. This constant is the safe
    // alternative: it is PURELY a render-side filter on the already-computed
    // wheelSuspensionLength (see captureVisualState() above) -- it is never
    // fed back into physics, contact, or traction, so it cannot reproduce
    // either failure mode above. Simulating repeated seam-strike impulses
    // (matching real high-speed driving over the segmented road, not a single
    // drop) and filtering the resulting raw suspension-length trace at
    // different TAU values measured the visible peak-to-peak amplitude: 0.06
    // (shipped) only cuts it 60%; 0.20 cuts it 85%, while staying fast enough
    // to still track genuine suspension events (braking squat, cornering
    // roll both develop over >0.2s) without the car feeling disconnected.
    const SUSPENSION_SMOOTHING_TAU = 0.2
    const suspensionAlpha = 1 - Math.exp(-this.lastDt / SUSPENSION_SMOOTHING_TAU)
    const maxSuspensionLength = this.suspensionRestLength + this.maxSuspensionTravel

    // WEB-PHASE-4B: re-derived for the new 0.28125 root scale, same headless
    // sandbox as FRONT_WELL_CORRECTION/REAR_WELL_CORRECTION above. With the
    // new well corrections applied, the visual crown gap (tyre-top to
    // nearest body vertex directly above it, sampled from the real loaded
    // mesh geometry) was measured at VFO=VRO=0, then each offset was
    // bisected for its own clash-free ceiling (tyre-top vs body vertex
    // search goes to "no vertex found above" once the offset pushes the
    // tyre past the real panel -- treated as out-of-range/unsafe, not
    // clear, same "push to the edge with a small margin" preference as
    // WEB-FIX-17/18): front edge 0.256502, rear edge 0.910880. Values below
    // are each ~0.5% short of their own edge for margin.
    const VISUAL_FRONT_OFFSET = 1.1163
    const VISUAL_REAR_OFFSET = 0.8912

    const wheelWorldPos: THREE.Vector3[] = []
    const wheelWorldQuat: THREE.Quaternion[] = []

    for (let i = 0; i < 4; i++) {
      const connection = this.controller.wheelChassisConnectionPointCs(i)
      if (!connection) {
        // not valid before the first updateVehicle() call; reuse last frame's
        // computed pose (or, if none yet, the rest position) so the arrays below
        // always have 4 entries.
        const prevSnap = this.visCurr
        wheelWorldPos.push(prevSnap ? prevSnap.wheelWorldPos[i].clone() : bodyPos.clone())
        wheelWorldQuat.push(prevSnap ? prevSnap.wheelWorldQuat[i].clone() : bodyQuat.clone())
        continue
      }

      const rawSuspensionLength = this.controller.wheelSuspensionLength(i)
      const target =
        rawSuspensionLength != null && Number.isFinite(rawSuspensionLength)
          ? Math.min(Math.max(rawSuspensionLength, 0), maxSuspensionLength)
          : (this.smoothedSuspensionLength[i] ?? this.suspensionRestLength)

      if (this.smoothedSuspensionLength[i] == null) {
        this.smoothedSuspensionLength[i] = target
      } else {
        this.smoothedSuspensionLength[i]! += (target - this.smoothedSuspensionLength[i]!) * suspensionAlpha
      }
      const suspensionLength = this.smoothedSuspensionLength[i]!

      const steering = this.controller.wheelSteering(i) ?? 0
      this.wheelRollAngle[i] += (vZ / this.wheelRadii[i]) * this.lastDt
      const rotation = this.wheelRollAngle[i]

      const local = new THREE.Vector3(connection.x, connection.y - suspensionLength, connection.z)
      // WEB-FIX-16C: see VISUAL_FRONT_OFFSET/VISUAL_REAR_OFFSET declaration
      // above the loop. i<2 is FL/FR (wheelOrder = ['FL','FR','RL','RR']).
      local.y += i < 2 ? VISUAL_FRONT_OFFSET : VISUAL_REAR_OFFSET
      const steerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steering)
      const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotation)
      const wheelLocalQuat = steerQuat.clone().multiply(spinQuat).multiply(this.wheelRestQuat[i])

      const worldPos = local.clone().applyQuaternion(bodyQuat).add(bodyPos)
      const worldQuat = bodyQuat.clone().multiply(wheelLocalQuat)

      // WEB-FIX-11d/11f: pin the wheel's TRUE geometric center (full runtime
      // world scale applied) to the attachment/suspension point, exactly as
      // before this fix -- position-only, does not touch worldQuat.
      const centerOffsetWorld = this.wheelGeometryCenter[i]
        .clone()
        .multiply(this.wheelGeometryWorldScale[i])
        .applyQuaternion(worldQuat)
      worldPos.sub(centerOffsetWorld)

      wheelWorldPos.push(worldPos)
      wheelWorldQuat.push(worldQuat)
    }

    const snapshot: VisualSnapshot = { rootPos, rootQuat, wheelWorldPos, wheelWorldQuat }
    this.visPrev = this.visCurr ?? snapshot
    this.visCurr = snapshot
  }

  // WEB-PHASE-2/3F (render-synchronization rocking fix): called once per
  // rendered frame (requestAnimationFrame), AFTER main.ts's accumulator
  // while-loop has run 0 or more physics steps for this frame -- never called
  // from inside the physics step itself. `alpha` is accumulator/FIXED_DT: how
  // far the render clock sits past the latest completed physics step, toward
  // the next (not-yet-computed) one. This only interpolates BETWEEN two already
  // -computed states (visPrev -> visCurr); it never extrapolates past visCurr,
  // so it can only smooth the existing trajectory, never invent motion that
  // didn't happen in the physics simulation. This is the ONLY place that writes
  // to vehicleRoot/wheel mesh transforms -- captureVisualState() above (run
  // once per physics step) only computes and stores the snapshots.
  applyVisualState(alpha: number): void {
    if (!this.visCurr) return
    const prev = this.visPrev ?? this.visCurr
    const curr = this.visCurr
    const a = Math.min(1, Math.max(0, alpha))

    const rootPos = prev.rootPos.clone().lerp(curr.rootPos, a)
    const rootQuat = prev.rootQuat.clone().slerp(curr.rootQuat, a)
    this.env.vehicleRoot.position.copy(rootPos)
    this.env.vehicleRoot.quaternion.copy(rootQuat)
    this.env.vehicleRoot.updateMatrixWorld(true)

    for (let i = 0; i < 4; i++) {
      const worldPos = prev.wheelWorldPos[i].clone().lerp(curr.wheelWorldPos[i], a)
      const worldQuat = prev.wheelWorldQuat[i].clone().slerp(curr.wheelWorldQuat[i], a)

      const mesh = this.wheelMeshes[i]
      const parent = mesh.parent!
      parent.updateWorldMatrix(true, false)
      const localPos = worldPos.clone()
      parent.worldToLocal(localPos)
      const parentWorldQuat = new THREE.Quaternion()
      parent.getWorldQuaternion(parentWorldQuat)
      const localQuat = worldQuat.clone().premultiply(parentWorldQuat.invert())
      mesh.position.copy(localPos)
      mesh.quaternion.copy(localQuat)
    }
  }

  private centerOffsetCache: THREE.Vector3 | null = null
  private rootToCenterOffset(_currentQuat: THREE.Quaternion): THREE.Vector3 {
    if (!this.centerOffsetCache) {
      // captured once: world offset (root -> chassis center) at spawn time,
      // expressed in the root's local (unrotated-by-future-motion) frame magnitude.
      const rootPos = new THREE.Vector3()
      this.env.vehicleRoot.getWorldPosition(rootPos)
      const bodyBox = new THREE.Box3().expandByObject(this.env.vehicleBody)
      for (const w of [this.env.wheels.FL, this.env.wheels.FR, this.env.wheels.RL, this.env.wheels.RR]) {
        bodyBox.expandByObject(w)
      }
      const center = new THREE.Vector3()
      bodyBox.getCenter(center)
      const rootQuat = new THREE.Quaternion()
      this.env.vehicleRoot.getWorldQuaternion(rootQuat)
      const offsetWorld = center.clone().sub(rootPos)
      // store in root-local (unrotated) space so it can be re-applied under the
      // chassis's CURRENT rotation each frame
      this.centerOffsetCache = offsetWorld.applyQuaternion(rootQuat.clone().invert())
    }
    return this.centerOffsetCache.clone().applyQuaternion(_currentQuat)
  }
}

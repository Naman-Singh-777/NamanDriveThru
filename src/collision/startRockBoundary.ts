import RAPIER from '@dimforge/rapier3d-compat'

// Hard boundary around the rocky headland behind the spawn point (the dead-end ridge the
// start road runs onto, z 1250 to 1437). Without it a car could drive off the ridge's
// sides or back edge and fall into the sea. Purely additive: it only adds invisible
// static walls to the physics world. The exported map, staticColliders.ts and
// roadBoundaries.ts are not touched, and the walls follow the rock's own top edge, not the
// flat shelf/slab that lies below and behind it.
//
// The outline was measured from the real geometry (downward rays over the ridge): the
// plateau is about 100 wide with a top height of 52 to 59, and its sides fall away
// steeply below ~48. Each wall sits ~2 units inside that shoulder so the car stops before
// the drop. Same wall recipe as the road-edge walls: 1.6 thick, mild bounce-back.

const WALL_THICKNESS = 1.6
const WALL_HALF_HEIGHT = 25
const WALL_CENTER_Y = 55 // spans y 30 to 80, well above the 54 to 59 ridge top
const WALL_RESTITUTION = 0.4

type Pt = [number, number] // [x, z]

// Each polyline is a chain of walls between consecutive points.
const OUTLINES: Pt[][] = [
  // front-left: closes the gap between the road's own wall (inner face x -24.2) and the ridge's left edge
  [[-53, 1250.5], [-25, 1250.5]],
  // front-right
  [[25, 1250.5], [45, 1250.5]],
  // left edge, front to back
  [[-52, 1250.5], [-52, 1300], [-49, 1340], [-48, 1380], [-48, 1420], [-48, 1433]],
  // back edge
  [[-48, 1433], [48, 1433]],
  // right edge, back to front
  [[48, 1433], [48, 1420], [50, 1380], [50, 1340], [46, 1300], [44, 1250.5]]
]

export function buildStartRockBoundary(world: RAPIER.World): number {
  let walls = 0
  for (const line of OUTLINES) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, z0] = line[i]
      const [x1, z1] = line[i + 1]
      const dx = x1 - x0
      const dz = z1 - z0
      const len = Math.hypot(dx, dz)
      if (len < 0.5) continue
      const yaw = Math.atan2(dx, dz) // local +Z follows the segment
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation((x0 + x1) / 2, WALL_CENTER_Y, (z0 + z1) / 2)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      )
      // a little extra length so neighbouring segments overlap at the corners (no gaps)
      const desc = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, WALL_HALF_HEIGHT, len / 2 + WALL_THICKNESS / 2)
        .setRestitution(WALL_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      world.createCollider(desc, body)
      walls++
    }
  }
  return walls
}
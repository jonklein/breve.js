import { flooredInertia, quatFromEuler, resolvePhysics, type PhysicsSettings, type BodyDef, type HeightfieldDef, type JointDef, type PartDef } from '@breve/core'

/**
 * Our body format as MuJoCo's XML (MJCF). Pure text in, text out: nothing here touches MuJoCo, so it is testable without the wasm.
 *
 * We stay in our own coordinates (y up, x forward) and tell MuJoCo that gravity points down y, so no axis is swapped anywhere:
 * the positions, sizes and axes in a scene's body mean the same here as they do for Rapier.
 */

export interface MjcfOptions {
  /** Gravity strength, metres per second squared, pulling toward -y. */
  gravity: number
  /** A floor on each part's rotational inertia (see `physics.minGyration`); 0 leaves it to MuJoCo to work out from the shape. */
  minGyration: number
  /** The standing-pose body is turned by `yaw` about y and its origin placed at (x, y, z). */
  at: { x: number; y: number; z: number; yaw: number }
  terrain: HeightfieldDef | null
  /** The scene's other physics settings (damping, ground friction, solver iterations); left out, the stdlib's defaults. MuJoCo has no restitution or sleeping of this kind, so those are not used. */
  settings?: Partial<PhysicsSettings>
}

/** Defaults that stand in for Rapier's own body damping and a motor's rotor: tuned in one place. */
export const TUNING = {
  /** The free root joint has one damping number for moving and turning (force per speed, not a fraction per second like Rapier's `linearDamping`): this many times `physics.linearDamping`. 2 gives 0.1 for the default 0.05. */
  rootDampingPerLinear: 2,
  /** Passive damping on every hinge, torque per radian per second. */
  hingeDamping: 0.1,
  /** Rotor inertia added to every hinge (kg m^2): it steadies the solver for light limbs. */
  hingeArmature: 0.001,
  /** Contact softness: [time constant, damping ratio]. MuJoCo's default is [0.02, 1]. */
  contactSolref: [0.02, 1] as [number, number],
  /** Never limited: a motor with no `maxTorque` may push as hard as it likes. */
  noLimit: 1e9,
}

export interface Mjcf {
  xml: string
  /** MJCF body name of each part, in the body's part order. */
  parts: string[]
  /** For each joint of the body (in order): its MJCF joint name, or null for a fixed joint (which has none). */
  joints: (string | null)[]
  /** For each joint of the body: its actuator index, or -1 when it has no motor. */
  actuators: number[]
  /** The actuator names, in order. */
  actuatorNames: string[]
}

const f = (v: ArrayLike<number>) => Array.from(v, (n) => +n.toFixed(7)).join(' ')

type Quat = [number, number, number, number] // w, x, y, z (MuJoCo's order)
const IDENTITY: Quat = [1, 0, 0, 0]
const fromXyzw = ([x, y, z, w]: [number, number, number, number]): Quat => [w, x, y, z]
const mulQ = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
]
/** The turn that takes MuJoCo's default capsule/cylinder axis (z) onto ours (y). */
const Z_TO_Y: Quat = [Math.SQRT1_2, -Math.SQRT1_2, 0, 0]

function geomXml(p: PartDef, minGyration: number, meshes: string[]): string {
  const turn = p.rotation ? fromXyzw(quatFromEuler(p.rotation as [number, number, number])) : IDENTITY
  const common = `friction="${p.friction ?? 1} 0.005 0.0001" contype="2" conaffinity="1" solref="${TUNING.contactSolref.join(' ')}"`
  const mass = minGyration > 0 ? '' : ` mass="${p.mass}"`
  const s = p.size
  let geom: string
  if (p.shape === 'box') geom = `<geom type="box" size="${f([s[0] / 2, s[1] / 2, s[2] / 2])}" quat="${f(turn)}" ${common}${mass}/>`
  else if (p.shape === 'mesh') {
    // the engine takes the convex hull of the vertices (it recenters the mesh and moves the geom to match)
    const name = `mesh${meshes.length}`
    meshes.push(`<mesh name="${name}" vertex="${f(p.points ?? [])}"/>`)
    geom = `<geom type="mesh" mesh="${name}" quat="${f(turn)}" ${common}${mass}/>`
  } else if (p.shape === 'sphere') geom = `<geom type="sphere" size="${s[0]}" ${common}${mass}/>`
  else geom = `<geom type="${p.shape === 'capsule' ? 'capsule' : 'cylinder'}" size="${f([s[1], s[0] / 2])}" quat="${f(mulQ(turn, Z_TO_Y))}" ${common}${mass}/>`
  if (minGyration <= 0) return geom
  // the same mass, but never easier to spin than a body with this radius of gyration; the geom then carries no mass of its own
  return `<inertial pos="0 0 0" mass="${p.mass}" diaginertia="${f(flooredInertia(p, minGyration))}" quat="${f(turn)}"/>${geom}`
}

/** Heightfield as an MJCF asset and the geom that stands it in our y-up world. */
function terrainXml(t: HeightfieldDef, friction: number): { asset: string; geom: string } {
  const m = t.n + 1
  let lo = Infinity, hi = -Infinity
  for (const h of t.heights) { lo = Math.min(lo, h); hi = Math.max(hi, h) }
  const span = Math.max(hi - lo, 1e-3)
  // MuJoCo's field is rows along its y and columns along its x, standing in the x-y plane with z as height. Turned -90 degrees about x
  // it lies in our x-z plane with height along +y, and its rows run toward +z (checked against the terrain: see the engine test).
  // Ours is heights[ix * m + iz], x first, so MuJoCo's (row, column) is our (iz, ix).
  const elevation: number[] = new Array(m * m)
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) elevation[r * m + c] = +((t.heights[c * m + r] - lo) / span).toFixed(6)
  return {
    asset: `<hfield name="ground" nrow="${m}" ncol="${m}" size="${t.size / 2} ${t.size / 2} ${span} 1" elevation="${elevation.join(' ')}"/>`,
    geom: `<geom name="ground" type="hfield" hfield="ground" pos="0 ${+lo.toFixed(7)} 0" quat="${f(fromXyzw([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]))}" contype="1" conaffinity="2" friction="${friction} 0.005 0.0001" solref="${TUNING.contactSolref.join(' ')}"/>`,
  }
}

/** Build the MJCF for one creature (and the terrain it stands on). Each creature is its own MuJoCo world, so adding and removing creatures never rebuilds the others. */
export function buildMjcf(body: BodyDef, opts: MjcfOptions): Mjcf {
  const cfg = resolvePhysics({ gravity: opts.gravity, minGyration: opts.minGyration, ...opts.settings })
  const parts = body.parts
  const joints = body.joints ?? []
  const byName = new Map(parts.map((p, i) => [p.name, i]))
  const kids = new Map<number, JointDef[]>(parts.map((_, i) => [i, []]))
  for (const j of joints) kids.get(byName.get(j.parent)!)!.push(j)
  const partName = parts.map((_, i) => `p${i}`)
  const jointName: (string | null)[] = joints.map((j, i) => ((j.type ?? 'hinge') === 'fixed' ? null : `j${i}`))
  const jointIndex = new Map(joints.map((j, i) => [j, i]))
  // one position actuator per motorized hinge, numbered in the body's joint order (the order they are written in the XML)
  const actuatorNames: string[] = []
  const actuators: number[] = joints.map((j, i) => {
    if ((j.type ?? 'hinge') !== 'hinge' || !j.motor) return -1
    actuatorNames.push(`a${i}`)
    return actuatorNames.length - 1
  })

  const meshes: string[] = []
  const walk = (i: number, inbound: JointDef | null): string => {
    const p = parts[i]
    let pos: number[], quat: Quat = IDENTITY, joint = ''
    if (!inbound) {
      // the root: where the creature stands, turned about the vertical axis like the Rapier adapter turns it
      const s = Math.sin(opts.at.yaw / 2), c = Math.cos(opts.at.yaw / 2)
      const cosY = Math.cos(opts.at.yaw), sinY = Math.sin(opts.at.yaw)
      const [px, py, pz] = p.position
      pos = [opts.at.x + px * cosY + pz * sinY, opts.at.y + py, opts.at.z - px * sinY + pz * cosY]
      quat = [c, 0, s, 0]
      joint = `<joint name="root" type="free" damping="${+(cfg.linearDamping * TUNING.rootDampingPerLinear).toFixed(6)}"/>`
    } else {
      const parent = parts[byName.get(inbound.parent)!]
      pos = p.position.map((v, k) => v - parent.position[k])
      const anchor = inbound.anchor.map((v, k) => v - p.position[k])
      const type = inbound.type ?? 'hinge'
      const name = jointName[jointIndex.get(inbound)!]
      if (type === 'hinge') {
        const range = inbound.limits ? ` limited="true" range="${f(inbound.limits)}"` : ''
        joint = `<joint name="${name}" type="hinge" pos="${f(anchor)}" axis="${f(inbound.axis ?? [0, 0, 1])}"${range} armature="${TUNING.hingeArmature}" damping="${TUNING.hingeDamping}"/>`
      } else if (type === 'ball') joint = `<joint name="${name}" type="ball" pos="${f(anchor)}" armature="${TUNING.hingeArmature}"/>`
      // a fixed joint is no joint: a body without one is welded to its parent
    }
    return `<body name="${partName[i]}" pos="${f(pos)}" quat="${f(quat)}">${joint}${geomXml(p, opts.minGyration, meshes)}${kids.get(i)!.map((j) => walk(byName.get(j.child)!, j)).join('')}</body>`
  }

  const ground = opts.terrain ? terrainXml(opts.terrain, cfg.friction) : null
  const actuator = joints
    .map((j, i) => (actuators[i] >= 0 ? `<position name="a${i}" joint="${jointName[i]}" kp="100" kv="8" forcelimited="true" forcerange="${-TUNING.noLimit} ${TUNING.noLimit}"/>` : ''))
    .join('')
  const tree = walk(0, null) // building the tree collects the mesh assets, so it goes before the assets are written
  const assets = (ground ? ground.asset : '') + meshes.join('')
  const xml = `<mujoco model="creature"><compiler angle="radian"/>`
    + `<option timestep="${1 / 240}" integrator="implicitfast" iterations="${cfg.solverIterations}" gravity="0 ${-opts.gravity} 0"/>`
    + `${assets ? `<asset>${assets}</asset>` : ''}`
    + `<worldbody>${ground?.geom ?? ''}${tree}</worldbody>`
    + `${actuator ? `<actuator>${actuator}</actuator>` : ''}</mujoco>`
  return { xml, parts: partName, joints: jointName, actuators, actuatorNames }
}

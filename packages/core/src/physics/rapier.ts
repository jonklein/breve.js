import { flooredInertia } from './inertia'
import { quatFromEuler } from '../rot'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { BodyDef, JointDef, PartDef } from '../body'
import type { Articulation, HeightfieldDef, PhysicsEngine, PhysicsWorld } from './types'

// The deterministic build of Rapier: same inputs give bit-identical results on every machine and browser.
// The wasm is embedded in the JS file (the "compat" build), so Vite and node need no wasm setup.

let ready: Promise<PhysicsEngine> | null = null

/** Load Rapier once. Async because the wasm module compiles asynchronously. */
export function loadRapier(): Promise<PhysicsEngine> {
  ready ??= RAPIER.init().then(() => engine)
  return ready
}

const TERRAIN = 0x0001
const CREATURE = 0x0002
// creatures always touch the terrain. Touching each other is the `collide` option; a creature never
// touches its own parts (a contact hook below), or jointed limbs would fight their own joints.
const WITH_TERRAIN = (CREATURE << 16) | TERRAIN
const WITH_CREATURES = (CREATURE << 16) | TERRAIN | CREATURE

const engine: PhysicsEngine = {
  name: 'rapier3d-deterministic',
  createWorld: ({ gravity, collide, minGyration }) => new RapierWorld(gravity, collide, minGyration ?? 0),
}

class RapierWorld implements PhysicsWorld {
  private world: RAPIER.World
  private terrain: RAPIER.Collider | null = null
  private bodies: RAPIER.RigidBody[] = []
  private articulations = new Set<RapierArticulation>()
  /** Which creature each body belongs to, so a creature's own parts can ignore each other. */
  private owner = new Map<number, number>()
  private nextId = 0
  private events = new RAPIER.EventQueue(false)
  private hooks: RAPIER.PhysicsHooks

  constructor(gravity: number, private collide: boolean, private minGyration: number) {
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 })
    this.world.integrationParameters.numSolverIterations = 8
    const owner = this.owner
    this.hooks = {
      filterContactPair: (_c1, _c2, b1, b2) => {
        const a = owner.get(b1)
        return a !== undefined && a === owner.get(b2) ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE
      },
      filterIntersectionPair: () => true,
    }
  }

  setTerrain(t: HeightfieldDef | null): void {
    if (this.terrain) this.world.removeCollider(this.terrain, false)
    this.terrain = null
    if (!t) return
    const desc = RAPIER.ColliderDesc.heightfield(t.n, t.n, t.heights, { x: t.size, y: 1, z: t.size }).setFriction(1)
    this.terrain = this.world.createCollider(desc)
  }

  addArticulation(body: BodyDef, at: { x: number; y: number; z: number; yaw: number }): Articulation {
    const s = Math.sin(at.yaw / 2), c = Math.cos(at.yaw / 2)
    const rot = { x: 0, y: s, z: 0, w: c }
    const id = this.nextId++
    const cosY = Math.cos(at.yaw), sinY = Math.sin(at.yaw)
    const parts = body.parts.map((p) => {
      // rotate the standing-pose offset about y (right-handed: x toward -z as yaw grows)
      const [px, py, pz] = p.position
      const x = at.x + px * cosY + pz * sinY
      const z = at.z - px * sinY + pz * cosY
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, at.y + py, z).setRotation(rot).setCanSleep(false).setLinearDamping(0.05).setAngularDamping(0.3),
      )
      this.world.createCollider(colliderFor(p, this.collide ? WITH_CREATURES : WITH_TERRAIN, this.minGyration), rb)
      this.owner.set(rb.handle, id)
      this.bodies.push(rb)
      return rb
    })
    const index = new Map(body.parts.map((p, i) => [p.name, i]))
    const joints = (body.joints ?? []).map((j) => {
      const pi = index.get(j.parent)!, ci = index.get(j.child)!
      const pp = body.parts[pi].position, cp = body.parts[ci].position
      const a1 = { x: j.anchor[0] - pp[0], y: j.anchor[1] - pp[1], z: j.anchor[2] - pp[2] }
      const a2 = { x: j.anchor[0] - cp[0], y: j.anchor[1] - cp[1], z: j.anchor[2] - cp[2] }
      const type = j.type ?? 'hinge'
      let data: RAPIER.JointData
      if (type === 'hinge') {
        const ax = unit(j.axis ?? [0, 0, 1])
        data = RAPIER.JointData.revolute(a1, a2, { x: ax[0], y: ax[1], z: ax[2] })
        if (j.limits) {
          data.limitsEnabled = true
          data.limits = [j.limits[0], j.limits[1]]
        }
      } else if (type === 'ball') {
        data = RAPIER.JointData.spherical(a1, a2)
      } else {
        const q = { x: 0, y: 0, z: 0, w: 1 }
        data = RAPIER.JointData.fixed(a1, q, a2, q)
      }
      const joint = this.world.createImpulseJoint(data, parts[pi], parts[ci], true)
      // force-based: stiffness is torque per radian, so the same gains hold up a heavy torso or a light foot
      if (j.motor && type === 'hinge') (joint as RAPIER.RevoluteImpulseJoint).configureMotorModel(RAPIER.MotorModel.ForceBased)
      return { def: j, joint, parent: pi, child: ci }
    })
    const a = new RapierArticulation(parts, joints)
    this.articulations.add(a)
    return a
  }

  removeArticulation(a: Articulation): void {
    const art = a as RapierArticulation
    if (!this.articulations.delete(art)) return
    for (const rb of art.bodies) {
      this.owner.delete(rb.handle)
      this.world.removeRigidBody(rb) // removes its colliders and joints too
      this.bodies.splice(this.bodies.indexOf(rb), 1)
    }
  }

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step(this.events, this.hooks)
  }

  snapshot(arts: Articulation[]): unknown {
    return {
      bytes: this.world.takeSnapshot(),
      arts: (arts as RapierArticulation[]).map((a) => ({ bodies: a.bodies.map((b) => b.handle), joints: a.joints.map((j) => j.joint.handle) })),
      order: this.bodies.map((b) => b.handle),
      owner: [...this.owner],
      nextId: this.nextId,
      terrain: this.terrain?.handle ?? null,
    }
  }

  restore(snapshot: unknown, arts: Articulation[]): void {
    const s = snapshot as { bytes: Uint8Array; arts: { bodies: number[]; joints: number[] }[]; order: number[]; owner: [number, number][]; nextId: number; terrain: number | null }
    this.world.free()
    this.world = RAPIER.World.restoreSnapshot(s.bytes)
    this.owner.clear()
    for (const [k, v] of s.owner) this.owner.set(k, v)
    this.nextId = s.nextId
    this.terrain = s.terrain === null ? null : this.world.getCollider(s.terrain)
    this.bodies = s.order.map((h) => this.world.getRigidBody(h))
    this.articulations.clear()
    ;(arts as RapierArticulation[]).forEach((a, i) => {
      a.rebind(s.arts[i].bodies.map((h) => this.world.getRigidBody(h)), s.arts[i].joints.map((h) => this.world.getImpulseJoint(h)))
      this.articulations.add(a)
    })
  }

  hash(): string {
    let h = 0x811c9dc5
    const buf = new Float32Array(13)
    const bytes = new Uint8Array(buf.buffer)
    for (const rb of this.bodies) {
      const t = rb.translation(), r = rb.rotation(), v = rb.linvel(), w = rb.angvel()
      buf.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z])
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i]
        h = Math.imul(h, 0x01000193)
      }
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  dispose(): void {
    this.world.free()
  }
}

interface BuiltJoint {
  def: JointDef
  joint: RAPIER.ImpulseJoint
  parent: number
  child: number
}

class RapierArticulation implements Articulation {
  readonly partCount: number
  readonly jointCount: number
  private axes: [number, number, number][]

  constructor(public bodies: RAPIER.RigidBody[], public joints: BuiltJoint[]) {
    this.partCount = bodies.length
    this.jointCount = joints.length
    this.axes = joints.map((j) => unit(j.def.axis ?? [0, 0, 1]))
  }

  /** Point at the same bodies and joints in a restored world. */
  rebind(bodies: RAPIER.RigidBody[], joints: RAPIER.ImpulseJoint[]): void {
    this.bodies = bodies
    this.joints = this.joints.map((j, i) => ({ ...j, joint: joints[i] }))
  }

  readPoses(out: Float32Array, offset: number): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const t = this.bodies[i].translation(), r = this.bodies[i].rotation()
      const o = offset + i * 7
      out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z
      out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w
    }
  }

  readRootVelocity(out: Float32Array | number[], offset: number): void {
    const v = this.bodies[0].linvel()
    out[offset] = v.x; out[offset + 1] = v.y; out[offset + 2] = v.z
  }

  readAngles(out: Float32Array | number[], offset: number): void {
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i]
      if ((j.def.type ?? 'hinge') !== 'hinge') { out[offset + i] = 0; continue }
      // relative rotation child-in-parent; both start unrotated, so it is a turn about the hinge axis
      const p = this.bodies[j.parent].rotation(), c = this.bodies[j.child].rotation()
      const qx = p.w * c.x - p.x * c.w - p.y * c.z + p.z * c.y
      const qy = p.w * c.y - p.y * c.w - p.z * c.x + p.x * c.z
      const qz = p.w * c.z - p.z * c.w - p.x * c.y + p.y * c.x
      const qw = p.w * c.w + p.x * c.x + p.y * c.y + p.z * c.z
      const [ax, ay, az] = this.axes[i]
      let ang = 2 * Math.atan2(qx * ax + qy * ay + qz * az, qw)
      if (ang > Math.PI) ang -= 2 * Math.PI
      else if (ang < -Math.PI) ang += 2 * Math.PI
      out[offset + i] = ang
    }
  }

  setMotors(targets: ArrayLike<number>, stiffness: ArrayLike<number>, damping: ArrayLike<number>, maxTorque?: ArrayLike<number>): void {
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i]
      if (!j.def.motor || (j.def.type ?? 'hinge') !== 'hinge') continue
      const joint = j.joint as RAPIER.RevoluteImpulseJoint
      joint.configureMotorPosition(targets[i], stiffness[i], damping[i])
      if (maxTorque && Number.isFinite(maxTorque[i])) joint.setMotorMaxForce(maxTorque[i])
    }
  }
}

function colliderFor(p: PartDef, groups: number, minGyration: number): RAPIER.ColliderDesc {
  const s = p.size
  let d: RAPIER.ColliderDesc
  switch (p.shape) {
    case 'box': d = RAPIER.ColliderDesc.cuboid(s[0] / 2, s[1] / 2, s[2] / 2); break
    case 'sphere': d = RAPIER.ColliderDesc.ball(s[0]); break
    case 'capsule': d = RAPIER.ColliderDesc.capsule(s[0] / 2, s[1]); break
    case 'mesh': {
      const hull = p.points && RAPIER.ColliderDesc.convexHull(Float32Array.from(p.points))
      if (!hull) throw new Error(`part "${p.name}": the mesh has no usable convex hull (is the model flat, or a single point?)`)
      d = hull
      break
    }
    default: d = RAPIER.ColliderDesc.cylinder(s[0] / 2, s[1])
  }
  if (p.rotation) { const [x, y, z, w] = quatFromEuler(p.rotation); d.setRotation({ x, y, z, w }) }
  if (minGyration > 0) {
    // the same mass, but never easier to spin than a body with this radius of gyration (keeps tiny parts from whipping around under joint forces)
    const [x, y, z] = flooredInertia(p, minGyration)
    d.setMassProperties(p.mass, { x: 0, y: 0, z: 0 }, { x, y, z }, { x: 0, y: 0, z: 0, w: 1 })
  } else d.setMass(p.mass)
  return d.setFriction(p.friction ?? 1).setRestitution(0).setCollisionGroups(groups).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS)
}

function unit(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

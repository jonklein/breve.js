import { MOTOR_DEFAULTS, type BodyDef, type PartDef } from './body'
import { resolve } from './scene'
import { Table } from './store'
import { Terrain } from './terrain'
import { Nums, Vec3, Vecs } from '@breve/stdlib'
import type { Articulation, PhysicsEngine, PhysicsWorld } from './physics/types'
import type { RigidFrame } from './rigid-frame'
import type { FrameData, Host, MetricInput, World } from './world'

const SCHEMA = {
  px: 'f32', py: 'f32', pz: 'f32',
  vx: 'f32', vy: 'f32', vz: 'f32',
  qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32',
  /** Horizontal distance the torso has covered. f64 so long walks keep their precision. */
  travelled: 'f64',
  /** Oscillator phase in cycles, so changing the frequency never makes the legs jump. */
  phase: 'f64',
  /** Ticks spent flipped over or flat on the ground. */
  down: 'f32',
} as const

type Cols = Record<keyof typeof SCHEMA, Float64Array>

const DT = 1 / 60
const MAX_CREATURES = 200
const DEFAULT_PHYSICS = { gravity: 9.81, substeps: 4 }
const TOUCH_MARGIN = 0.04
const TAU = Math.PI * 2
/** The default reset rule: below this height (world units) a creature has fallen off the terrain, and one that stays flipped or collapsed for 3 s is put back on its feet. Both can be set (or turned off) with `physics.respawn`. */
const DEFAULT_RESPAWN = { after: 3, fallBelow: 20 }
const TICKS_PER_SECOND = 60
/** Torso height above the ground that counts as collapsed (standing is about 0.6). */
const DOWN_HEIGHT = 0.22

/** Readable view of one creature. Only valid for the duration of a decide() call. */
export class Creature {
  constructor(private world: RigidWorld, readonly row: number) {}
  private get c() { return this.world.cols }
  get x() { return this.c.px[this.row] }
  get y() { return this.c.py[this.row] }
  get z() { return this.c.pz[this.row] }
  get vx() { return this.c.vx[this.row] }
  get vy() { return this.c.vy[this.row] }
  get vz() { return this.c.vz[this.row] }
  get position(): Vec3 { return new Vec3(this.x, this.y, this.z) }
  get velocity(): Vec3 { return new Vec3(this.vx, this.vy, this.vz) }
  /** Horizontal speed. */
  get speed(): number { return Math.hypot(this.vx, this.vz) }
  /** Horizontal distance covered since the start. */
  get travelled(): number { return this.c.travelled[this.row] }
  /** The way the torso faces (its local x axis). */
  get forward(): Vec3 {
    const { qx, qy, qz, qw } = this.quat()
    return new Vec3(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy))
  }
  /** Compass heading in radians: 0 faces +x, and it grows toward -z (a turn counter-clockwise seen from above). */
  get yaw(): number {
    const f = this.forward
    return Math.atan2(-f.z, f.x)
  }
  /** Joint angles by name, if the body declares a `joints` sensor. */
  get joints(): Record<string, number> { return this.world.jointAngles(this.row) }
  /** Which feet touch the ground by name, if the body declares a `touch` sensor. */
  get touch(): Record<string, boolean> { return this.world.touching(this.row) }
  /** What the built-in oscillator wants each motor to do right now, by joint name. Scale it, mix it, or ignore it. */
  get gait(): Record<string, number> { return this.world.gaitTargets(this.row) }
  private quat() {
    const c = this.c, r = this.row
    return { qx: c.qx[r], qy: c.qy[r], qz: c.qz[r], qw: c.qw[r] }
  }
}

/** A group of creatures: `creatures.travelled.average()`. */
export class Creatures extends Array<Creature> {
  static get [Symbol.species]() { return Array }
  get position(): Vecs { return Vecs.from(this, (c) => c.position) as Vecs }
  get velocity(): Vecs { return Vecs.from(this, (c) => c.velocity) as Vecs }
  get speed(): Nums { return Nums.from(this, (c) => c.speed) as Nums }
  get travelled(): Nums { return Nums.from(this, (c) => c.travelled) as Nums }
  isEmpty(): boolean { return this.length === 0 }
}

interface JointRuntime {
  name: string
  motor: boolean
  limits: [number, number] | null
}

/** Articulated creatures walking on a noise terrain, simulated by a physics engine behind the adapter interface. */
export class RigidWorld implements World {
  readonly table = new Table(SCHEMA, 64)
  private physics!: PhysicsWorld
  private terrain!: Terrain
  private arts: Articulation[] = []
  private handles: Creature[] = []
  private key = ''
  private modelPending = true
  private joints: JointRuntime[] = []
  private jointIndex = new Map<string, number>()
  private poses = new Float32Array(0)
  private angles = new Float32Array(0)
  /** Oscillator output and the final targets, `jointCount` numbers per creature. */
  private gait = new Float32Array(0)
  private targets = new Float32Array(0)
  private leaves: number[] = []
  private lastBody: BodyDef

  constructor(private host: Host, private engine: PhysicsEngine) {
    this.lastBody = host.def.body!
    this.build()
  }

  get cols(): Cols {
    return this.table.cols as unknown as Cols
  }

  /** The body in the scene, or the last good one if an edit just removed it (a scene cannot change kind while running). */
  private get body(): BodyDef {
    return this.host.def.body ?? this.lastBody
  }

  /** Everything that needs the creatures rebuilt when it changes: the terrain, the physics settings and the body's structure. */
  private structureKey(): string {
    const { scene } = this.host
    const b = this.body
    return JSON.stringify([
      scene.seed, scene.terrain, scene.physics, b.parts,
      (b.joints ?? []).map((j) => ({ ...j, drive: undefined, motor: !!j.motor })),
    ])
  }

  private build(): void {
    this.physics?.dispose()
    const { scene } = this.host
    this.physics = this.engine.createWorld({ gravity: scene.physics?.gravity ?? DEFAULT_PHYSICS.gravity, collide: scene.physics?.collide ?? true })
    this.terrain = new Terrain(scene.terrain, scene.seed)
    this.physics.setTerrain({ size: this.terrain.size, n: this.terrain.n, heights: this.terrain.heights })
    this.key = this.structureKey()
    this.modelPending = true

    const body = this.body
    const joints = body.joints ?? []
    this.joints = joints.map((j) => ({ name: j.name, motor: !!j.motor && (j.type ?? 'hinge') === 'hinge', limits: j.limits ?? null }))
    this.jointIndex = new Map(joints.map((j, i) => [j.name, i]))
    const parents = new Set(joints.map((j) => j.parent))
    this.leaves = body.parts.map((_, i) => i).filter((i) => !parents.has(body.parts[i].name))

    while (this.table.size > 0) this.table.despawn(this.table.idAt(this.table.size - 1))
    this.arts = []
    this.sceneChanged(true)
  }

  sceneChanged(fresh = false): void {
    const edited = this.host.def.body
    if (edited) this.lastBody = edited
    if (!fresh && this.structureKey() !== this.key) return this.build()
    const def = this.host.def
    const target = Math.max(0, Math.min(MAX_CREATURES, Math.round(resolve(def.count, this.host.params, 0))))
    while (this.table.size > target) {
      this.table.despawn(this.table.idAt(this.table.size - 1))
      this.physics.removeArticulation(this.arts.pop()!)
    }
    while (this.table.size < target) this.spawn()
    while (this.handles.length < this.table.size) this.handles.push(new Creature(this, this.handles.length))
    const J = this.joints.length, parts = this.body.parts.length, n = this.table.size
    if (this.poses.length !== n * parts * 7) this.poses = new Float32Array(n * parts * 7)
    if (this.angles.length !== n * J) {
      this.angles = new Float32Array(n * J)
      this.gait = new Float32Array(n * J)
      this.targets = new Float32Array(n * J)
    }
    this.record(false)
  }

  private spawnPoint(): { x: number; y: number; z: number; yaw: number } {
    const { rng } = this.host
    const half = this.terrain.size / 2
    const x = rng.range(-1, 1) * half * 0.6
    const z = rng.range(-1, 1) * half * 0.6
    const yaw = rng.range(0, TAU)
    // stand the body on the highest ground under it so no foot starts buried
    let ground = -Infinity
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) ground = Math.max(ground, this.terrain.heightAt(x + dx, z + dz))
    return { x, y: ground + 0.05, z, yaw }
  }

  private spawn(): void {
    this.table.spawn()
    this.arts.push(this.physics.addArticulation(this.body, this.spawnPoint()))
  }

  step(): void {
    const { scene, params: p } = this.host
    const n = this.table.size
    const J = this.joints.length
    const body = this.body
    const c = this.cols
    const bj = body.joints ?? []

    // sense: joint angles come back from the physics engine
    for (let i = 0; i < n; i++) this.arts[i].readAngles(this.angles, i * J)

    // oscillator settings, resolved once per tick so sliders act live
    const freq = resolve(this.host.def.oscillator?.frequency, p, 1)
    const amp = new Float64Array(J), off = new Float64Array(J), pha = new Float64Array(J)
    const kp = new Float64Array(J), kd = new Float64Array(J)
    for (let j = 0; j < J; j++) {
      const d = bj[j].drive
      amp[j] = resolve(d?.amplitude, p, 0)
      off[j] = resolve(d?.offset, p, 0)
      pha[j] = resolve(d?.phase, p, 0) - resolve(d?.lag, p, 0)
      kp[j] = resolve(bj[j].motor?.stiffness, p, MOTOR_DEFAULTS.stiffness)
      kd[j] = resolve(bj[j].motor?.damping, p, MOTOR_DEFAULTS.damping)
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < J; j++) {
        const t = off[j] + amp[j] * Math.sin(TAU * (c.phase[i] + pha[j]))
        this.gait[i * J + j] = this.clampToLimits(j, t)
      }

    // decide: a script may set any motor target by joint name; the rest follow the oscillator
    this.targets.set(this.gait)
    const ctrl = this.host.controller()
    if (ctrl) {
      const ctx = this.host.ctx()
      const none = new Creatures()
      for (let i = 0; i < n; i++) {
        try {
          const out = ctrl.decide!({ self: this.handles[i], neighbors: none }, p, ctx) as { joints?: Record<string, number> } | void
          if (out && out.joints) {
            for (const [name, v] of Object.entries(out.joints)) {
              const j = this.jointIndex.get(name)
              if (j === undefined) throw new Error(`decide returned a target for "${name}", but the body has no joint with that name`)
              if (Number.isFinite(v)) this.targets[i * J + j] = this.clampToLimits(j, v)
            }
          }
        } catch (e) {
          this.host.fail('decide', e)
        }
      }
    }

    // act: point the motors
    for (let i = 0; i < n; i++) {
      const t = this.targets.subarray(i * J, (i + 1) * J)
      this.arts[i].setMotors(t, kp, kd)
      c.phase[i] = (c.phase[i] + freq * DT) % 1
    }

    // physics
    const sub = Math.max(1, Math.round(scene.physics?.substeps ?? DEFAULT_PHYSICS.substeps))
    for (let s = 0; s < sub; s++) this.physics.step(DT / sub)

    // record
    this.record(true)
  }

  private clampToLimits(j: number, v: number): number {
    const l = this.joints[j].limits
    return l ? Math.min(l[1], Math.max(l[0], v)) : v
  }

  /** Copy poses out of the physics engine into the columns. */
  private record(accumulate: boolean): void {
    const n = this.table.size
    const P = this.body.parts.length
    const c = this.cols
    const v = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const o = i * P * 7
      this.arts[i].readPoses(this.poses, o)
      if (accumulate) c.travelled[i] += Math.hypot(this.poses[o] - c.px[i], this.poses[o + 2] - c.pz[i])
      c.px[i] = this.poses[o]; c.py[i] = this.poses[o + 1]; c.pz[i] = this.poses[o + 2]
      c.qx[i] = this.poses[o + 3]; c.qy[i] = this.poses[o + 4]; c.qz[i] = this.poses[o + 5]; c.qw[i] = this.poses[o + 6]
      this.arts[i].readRootVelocity(v, 0)
      c.vx[i] = v[0]; c.vy[i] = v[1]; c.vz[i] = v[2]
      // walked off the edge of the world, or lying down for good: stand it up somewhere else
      const rule = this.respawnRule
      if (accumulate && rule && c.py[i] < -rule.fallBelow) this.respawn(i)
      if (accumulate && rule) {
        const up = 1 - 2 * (c.qx[i] * c.qx[i] + c.qz[i] * c.qz[i])
        const low = c.py[i] - this.terrain.heightAt(c.px[i], c.pz[i]) < DOWN_HEIGHT
        c.down[i] = up < 0.3 || low ? c.down[i] + 1 : 0
        if (c.down[i] > rule.after * TICKS_PER_SECOND) this.respawn(i)
      }
    }
  }

  /** The reset rule from `physics.respawn`: `false` turns it off, otherwise missing fields use the defaults. */
  private get respawnRule(): { after: number; fallBelow: number } | null {
    const r = this.host.scene.physics?.respawn
    return r === false ? null : { ...DEFAULT_RESPAWN, ...r }
  }

  private respawn(i: number): void {
    this.physics.removeArticulation(this.arts[i])
    const { x, y, z, yaw } = this.spawnPoint()
    this.arts[i] = this.physics.addArticulation(this.body, { x, y, z, yaw })
    this.arts[i].readPoses(this.poses, i * this.body.parts.length * 7)
    const c = this.cols
    c.px[i] = x; c.pz[i] = z // keep the distance walked; the next tick measures from here
    c.down[i] = 0
  }

  // ---- sensors, read by Creature handles ----

  private declares(type: 'joints' | 'touch'): boolean {
    return !!this.body.sensors?.some((s) => s.type === type)
  }

  jointAngles(row: number): Record<string, number> {
    const out: Record<string, number> = {}
    if (!this.declares('joints')) return out
    this.joints.forEach((j, k) => { out[j.name] = this.angles[row * this.joints.length + k] })
    return out
  }

  gaitTargets(row: number): Record<string, number> {
    const out: Record<string, number> = {}
    this.joints.forEach((j, k) => { if (j.motor) out[j.name] = this.gait[row * this.joints.length + k] })
    return out
  }

  touching(row: number): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    const sensor = this.body.sensors?.find((s) => s.type === 'touch')
    if (!sensor) return out
    const P = this.body.parts.length
    const wanted = sensor.type === 'touch' && sensor.parts ? sensor.parts : this.leaves.map((i) => this.body.parts[i].name)
    for (const name of wanted) {
      const i = this.body.parts.findIndex((p) => p.name === name)
      if (i < 0) continue
      const o = (row * P + i) * 7
      const x = this.poses[o], y = this.poses[o + 1], z = this.poses[o + 2]
      out[name] = lowestPoint(this.body.parts[i], y, this.poses[o + 3], this.poses[o + 4], this.poses[o + 5], this.poses[o + 6]) - this.terrain.heightAt(x, z) < TOUCH_MARGIN
    }
    return out
  }

  frame(): FrameData {
    const n = this.table.size
    const c = this.cols
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = c.px[i]; pos[i * 3 + 1] = c.py[i]; pos[i * 3 + 2] = c.pz[i]
      vel[i * 3] = c.vx[i]; vel[i * 3 + 1] = c.vy[i]; vel[i * 3 + 2] = c.vz[i]
    }
    const rigid: RigidFrame = { partCount: this.body.parts.length, poses: this.poses.slice() }
    if (this.modelPending) {
      this.modelPending = false
      const t = this.terrain
      rigid.model = {
        parts: this.body.parts.map((p) => ({ shape: p.shape, size: p.size, color: p.color })),
        terrain: { size: t.size, n: t.n, heights: t.heights.slice(), color: t.color, texture: t.texture },
      }
    }
    return { kind: 'bodies', count: n, size: this.terrain.size / 2, unit: 1, pos, vel, attr: null, rigid }
  }

  metricInput(): MetricInput {
    const creatures = new Creatures()
    for (let i = 0; i < this.table.size; i++) creatures.push(this.handles[i])
    return { creatures, count: this.table.size, cols: this.table.cols }
  }

  hash(): string {
    return `${this.physics.hash()}:${this.table.hash()}`
  }

  dispose(): void {
    this.physics.dispose()
  }
}

/** Lowest world-space y of a part, from its center height and orientation. */
function lowestPoint(p: PartDef, y: number, qx: number, qy: number, qz: number, qw: number): number {
  const s = p.size
  const ay = 1 - 2 * (qx * qx + qz * qz) // y component of the part's own y axis
  switch (p.shape) {
    case 'sphere': return y - s[0]
    case 'box': {
      const r0 = 2 * (qx * qy + qw * qz), r2 = 2 * (qy * qz - qw * qx)
      return y - (Math.abs(r0) * s[0] + Math.abs(ay) * s[1] + Math.abs(r2) * s[2]) / 2
    }
    case 'capsule': return y - (Math.abs(ay) * s[0]) / 2 - s[1]
    default: return y - (Math.abs(ay) * s[0]) / 2 - s[1] * Math.sqrt(Math.max(0, 1 - ay * ay))
  }
}

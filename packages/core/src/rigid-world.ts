import { buildBody, MOTOR_DEFAULTS, type BodyDef, type PartDef } from './body'
import { initResult } from './init-shape'
import { defineGroupGetters, defineStateGetters, writeState } from './state-columns'
import { resolve, type StateField } from './scene'
import { spawnPosition } from './spawn'
import { Table, type ColumnType, type TableSnapshot } from './store'
import { Terrain } from './terrain'
import { Nums, Vec3, Vecs } from '@breve/stdlib'
import type { Articulation, PhysicsEngine, PhysicsWorld } from './physics/types'
import type { RigidFrame } from './rigid-frame'
import { type FrameData, type Host, type MetricInput, type World } from './world'

const SCHEMA = {
  px: 'f32', py: 'f32', pz: 'f32',
  vx: 'f32', vy: 'f32', vz: 'f32',
  qx: 'f32', qy: 'f32', qz: 'f32', qw: 'f32',
} as const

type Cols = Record<keyof typeof SCHEMA, Float64Array> & Record<string, Float64Array>

const DT = 1 / 60
const MAX_CREATURES = 200
const DEFAULT_PHYSICS = { gravity: 9.81, substeps: 4 }
const TOUCH_MARGIN = 0.04

/** Readable view of one creature. Only valid for the duration of an act() call. */
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
  /** The way the torso faces (its local x axis). */
  get forward(): Vec3 {
    const { qx, qy, qz, qw } = this.quat()
    return new Vec3(1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz), 2 * (qx * qz - qw * qy))
  }
  /** Which way is up for the torso (its local y axis): `up.y` is 1 standing, 0 on its side, -1 upside down. */
  get up(): Vec3 {
    const { qx, qy, qz, qw } = this.quat()
    return new Vec3(2 * (qx * qy - qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qw * qx))
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
  private quat() {
    const c = this.c, r = this.row
    return { qx: c.qx[r], qy: c.qy[r], qz: c.qz[r], qw: c.qw[r] }
  }
}

/** A group of creatures: `creatures.speed.average()`. */
export class Creatures extends Array<Creature> {
  static get [Symbol.species]() { return Array }
  get position(): Vecs { return Vecs.from(this, (c) => c.position) as Vecs }
  get velocity(): Vecs { return Vecs.from(this, (c) => c.velocity) as Vecs }
  get speed(): Nums { return Nums.from(this, (c) => c.speed) as Nums }
  isEmpty(): boolean { return this.length === 0 }
}

interface JointRuntime {
  name: string
  motor: boolean
  limits: [number, number] | null
}

/** Articulated creatures walking on a noise terrain, simulated by a physics engine behind the adapter interface. */
export class RigidWorld implements World {
  readonly table: Table<string>
  private fields: StateField[]
  private CreatureClass: new (world: RigidWorld, row: number) => Creature
  private GroupClass: new () => Creatures
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
  /** What the script asked each motor to do this tick, `jointCount` numbers per creature (0 unless it said). */
  private targets = new Float32Array(0)
  /** Where each motor's target actually is after `maxSpeed` has eased it toward what the script asked for, and whether it has started yet. */
  private applied = new Float32Array(0)
  private appliedReady = false
  private leaves: number[] = []
  private lastBody: BodyDef
  /** The flat body worked out from the scene's body and the current params, remembered until either changes. */
  private builtFrom: { raw: unknown; params: string; body: BodyDef } | null = null

  constructor(private host: Host, private engine: PhysicsEngine) {
    this.fields = host.fields
    const schema: Record<string, ColumnType> = { ...SCHEMA }
    const strides: Record<string, number> = {}
    for (const f of this.fields) { schema[f.name] = f.type as ColumnType; strides[f.name] = f.length }
    this.table = new Table(schema, 64, strides)
    const table = this.table
    class Stateful extends Creature {}
    defineStateGetters(Stateful.prototype, table, this.fields)
    class Group extends Creatures {}
    defineGroupGetters(Group.prototype, this.fields)
    this.CreatureClass = Stateful
    this.GroupClass = Group as unknown as new () => Creatures
    this.lastBody = this.body
    this.build()
  }

  get cols(): Cols {
    return this.table.cols as unknown as Cols
  }

  /** The body in the scene, or the last good one if an edit just removed it (a scene cannot change kind while running). */
  private get body(): BodyDef {
    const raw = this.host.def.body
    if (!raw) return this.lastBody
    const params = JSON.stringify(this.host.params)
    if (this.builtFrom?.raw === raw && this.builtFrom.params === params) return this.builtFrom.body
    const built = buildBody(raw, this.host.params, 'body', null)
    if (built.errors.length) {
      this.host.fail('body', new Error(built.errors[0]))
      return this.lastBody // a bad edit keeps the last good creature
    }
    this.builtFrom = { raw, params, body: built.body }
    return built.body
  }

  /** Everything that needs the creatures rebuilt when it changes: the terrain, the physics settings and the body's structure. */
  private structureKey(): string {
    const { scene } = this.host
    const b = this.body
    return JSON.stringify([
      scene.seed, scene.terrain, scene.physics, b.parts,
      (b.joints ?? []).map((j) => ({ ...j, motor: !!j.motor })),
    ])
  }

  private build(): void {
    this.physics?.dispose()
    const { scene } = this.host
    this.physics = this.engine.createWorld({ gravity: scene.physics?.gravity ?? DEFAULT_PHYSICS.gravity, collide: scene.physics?.collide ?? true, minGyration: scene.physics?.minGyration })
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
    if (this.host.def.body) this.lastBody = this.body
    if (!fresh && this.structureKey() !== this.key) return this.build()
    const def = this.host.def
    const target = Math.max(0, Math.min(MAX_CREATURES, Math.round(resolve(def.count, this.host.params, 0))))
    while (this.table.size > target) {
      this.table.despawn(this.table.idAt(this.table.size - 1))
      this.physics.removeArticulation(this.arts.pop()!)
    }
    const from = this.table.size
    while (this.table.size < target) this.spawn()
    if (this.table.size > from) this.applyInit(from)
    while (this.handles.length < this.table.size) this.handles.push(new this.CreatureClass(this, this.handles.length))
    const J = this.joints.length, parts = this.body.parts.length, n = this.table.size
    if (this.poses.length !== n * parts * 7) this.poses = new Float32Array(n * parts * 7)
    if (this.angles.length !== n * J) {
      this.angles = new Float32Array(n * J)
      this.targets = new Float32Array(n * J)
      this.applied = new Float32Array(n * J)
      this.appliedReady = false
    }
    this.record()
  }

  /** Stand the body on the highest ground under it so no foot starts buried. */
  private groundAt(x: number, z: number): number {
    let ground = -Infinity
    for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) ground = Math.max(ground, this.terrain.heightAt(x + dx, z + dz))
    return ground
  }

  private spawnPoint(): { x: number; y: number; z: number; yaw: number } {
    const { rng } = this.host
    const half = this.terrain.size / 2
    const x = rng.range(-1, 1) * half * 0.6
    const z = rng.range(-1, 1) * half * 0.6
    const yaw = rng.range(0, Math.PI * 2)
    const set = spawnPosition(this.host.def.spawn, rng)
    if (set) return { x: set[0], y: this.groundAt(set[0], set[2]) + 0.05, z: set[2], yaw }
    return { x, y: this.groundAt(x, z) + 0.05, z, yaw }
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

    const kp = new Float64Array(J), kd = new Float64Array(J)
    const maxTorque = new Float64Array(J).fill(Infinity), maxStep = new Float64Array(J).fill(Infinity)
    for (let j = 0; j < J; j++) {
      kp[j] = resolve(bj[j].motor?.stiffness, p, MOTOR_DEFAULTS.stiffness)
      kd[j] = resolve(bj[j].motor?.damping, p, MOTOR_DEFAULTS.damping)
      maxTorque[j] = resolve(bj[j].motor?.maxTorque, p, Infinity)
      maxStep[j] = resolve(bj[j].motor?.maxSpeed, p, Infinity) * DT
    }
    // act: a script sets motor targets by joint name; any it leaves out go to the joint's rest angle (0)
    for (let j = 0; j < J; j++) { const rest = this.clampToLimits(j, 0); for (let i = 0; i < n; i++) this.targets[i * J + j] = rest }
    const writes: { row: number; state: Record<string, unknown> }[] = []
    const ctrl = this.host.controller()
    const act = ctrl?.act
    if (act) {
      const ctx = this.host.ctx()
      const none = new this.GroupClass()
      for (let i = 0; i < n; i++) {
        try {
          const out = act({ self: this.handles[i], neighbors: none }, p, ctx) as { joints?: Record<string, number>; state?: Record<string, unknown>; place?: { x: number; z: number; yaw?: number } } | void
          if (out?.place && typeof out.place === 'object') this.queuePlace(i, out.place) // stand it somewhere new at the end of the tick
          if (out && out.state && typeof out.state === 'object') writes.push({ row: i, state: out.state })
          if (out && out.joints) {
            for (const [name, v] of Object.entries(out.joints)) {
              const j = this.jointIndex.get(name)
              if (j === undefined) throw new Error(`act returned a target for "${name}", but the body has no joint with that name`)
              if (Number.isFinite(v)) this.targets[i * J + j] = this.clampToLimits(j, v)
            }
          }
        } catch (e) {
          this.host.fail('act', e)
        }
      }
      // state returned by act lands now, after every creature has read the old values
      for (const w of writes) writeState(this.table, this.fields, w.row, w.state, 'act', (where, e) => this.host.fail(where, e))
    }

    // act: ease each target toward what was asked (at most `maxSpeed`), then point the motors, which push no harder than `maxTorque`
    if (!this.appliedReady) { this.applied.set(this.angles); this.appliedReady = true } // start from where the joints are
    for (let k = 0; k < n * J; k++) {
      const step = maxStep[k % J]
      const d = this.targets[k] - this.applied[k]
      this.applied[k] = Math.abs(d) <= step ? this.targets[k] : this.applied[k] + Math.sign(d) * step
    }
    for (let i = 0; i < n; i++) {
      const t = this.applied.subarray(i * J, (i + 1) * J)
      this.arts[i].setMotors(t, kp, kd, maxTorque)
    }

    // physics
    const sub = Math.max(1, Math.round(scene.physics?.substeps ?? DEFAULT_PHYSICS.substeps))
    for (let s = 0; s < sub; s++) this.physics.step(DT / sub)

    // record
    this.record()
    this.placeQueued()
  }

  private clampToLimits(j: number, v: number): number {
    const l = this.joints[j].limits
    return l ? Math.min(l[1], Math.max(l[0], v)) : v
  }

  /** Copy poses out of the physics engine into the columns. */
  private record(): void {
    const n = this.table.size
    const P = this.body.parts.length
    const c = this.cols
    const v = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const o = i * P * 7
      this.arts[i].readPoses(this.poses, o)
      c.px[i] = this.poses[o]; c.py[i] = this.poses[o + 1]; c.pz[i] = this.poses[o + 2]
      c.qx[i] = this.poses[o + 3]; c.qy[i] = this.poses[o + 4]; c.qz[i] = this.poses[o + 5]; c.qw[i] = this.poses[o + 6]
      this.arts[i].readRootVelocity(v, 0)
      c.vx[i] = v[0]; c.vy[i] = v[1]; c.vz[i] = v[2]
    }
  }

  private places = new Map<number, { x: number; z: number; yaw: number }>()

  queuePlace(row: number, at: { x: number; z: number; yaw?: number }): void {
    if (![at.x, at.z].every(Number.isFinite)) { this.host.fail('place', new Error('place needs x and z as numbers')); return }
    this.places.set(row, { x: at.x, z: at.z, yaw: Number.isFinite(at.yaw) ? at.yaw! : 0 })
  }

  /** Carry out the `place` calls scripts made this tick: a fresh body at the pose, on the ground there. Everything else about the creature stays. */
  private placeQueued(): void {
    for (const [i, at] of [...this.places].sort((a, b) => a[0] - b[0])) {
      if (i >= this.table.size) continue
      this.physics.removeArticulation(this.arts[i])
      this.arts[i] = this.physics.addArticulation(this.body, { x: at.x, y: this.groundAt(at.x, at.z) + 0.05, z: at.z, yaw: at.yaw })
      this.arts[i].readPoses(this.poses, i * this.body.parts.length * 7)
      this.cols.px[i] = at.x; this.cols.pz[i] = at.z
      this.appliedReady = false // new joints start from where they are
    }
    this.places.clear()
  }

  /** The script's `init` (a creature at a time) or `initAll` (every one at once) for the creatures from row `from` on: what their state starts as. */
  private applyInit(from: number): void {
    const ctrl = this.host.controller()
    if (!ctrl?.init && !ctrl?.initAll) return
    const ctx = this.host.ctx(), { params } = this.host
    const n = this.table.size - from
    const write = (row: number, state: Record<string, unknown>) => writeState(this.table, this.fields, row, state, 'init', (where, e) => this.host.fail(where, e))
    try {
      if (ctrl.initAll) {
        const out = (ctrl.initAll({ count: n }, params, ctx) ?? {}) as Record<string, unknown>
        for (const [name, v] of Object.entries(out)) {
          const data = (v && typeof v === 'object' && 'data' in v ? (v as { data: ArrayLike<unknown> }).data : v) as ArrayLike<unknown>
          if (!data || data.length !== n) { this.host.fail('init', new Error(`"${name}" must have one value per creature (${n}), got ${data?.length ?? 'none'}`)); continue }
          for (let i = 0; i < n; i++) write(from + i, { [name]: data[i] })
        }
      } else {
        for (let i = 0; i < n; i++) write(from + i, initResult(ctrl.init!({ index: i, count: n }, params, ctx)))
      }
    } catch (e) {
      this.host.fail('init', e)
    }
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
        parts: this.body.parts.map((p) => ({ shape: p.shape, size: p.size, rotation: p.rotation, visual: p.visual, color: p.color })),
        terrain: { size: t.size, n: t.n, heights: t.heights.slice(), color: t.color, texture: t.texture, palette: t.palette, shading: t.shading },
      }
    }
    return { kind: 'bodies', count: n, size: this.terrain.size / 2, unit: 1, pos, vel, rigid }
  }

  metricInput(): MetricInput {
    const creatures = new this.GroupClass()
    for (let i = 0; i < this.table.size; i++) creatures.push(this.handles[i])
    return { creatures, count: this.table.size, cols: this.table.cols }
  }

  hash(): string {
    return `${this.physics.hash()}:${this.table.hash()}`
  }

  snapshot(): unknown {
    return { count: this.arts.length, table: this.table.snapshot(), physics: this.physics.snapshot(this.arts), applied: this.applied.slice(), appliedReady: this.appliedReady }
  }

  restore(s: unknown): void {
    const x = s as { count: number; table: TableSnapshot; physics: unknown; applied?: Float32Array; appliedReady?: boolean }
    if (x.count !== this.arts.length) throw new Error(`cannot restore: the snapshot has ${x.count} creatures and this sim has ${this.arts.length}`)
    this.table.restore(x.table)
    this.physics.restore(x.physics, this.arts)
    if (x.applied && x.applied.length === this.applied.length) { this.applied.set(x.applied); this.appliedReady = !!x.appliedReady }
    this.record() // refresh the pose buffers the renderer reads
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
    case 'mesh': {
      // the lowest vertex once the part is turned: the y row of the rotation matrix applied to each point
      const r0 = 2 * (qx * qy + qw * qz), r2 = 2 * (qy * qz - qw * qx)
      let low = Infinity
      const pts = p.points ?? []
      for (let i = 0; i + 2 < pts.length; i += 3) low = Math.min(low, r0 * pts[i] + ay * pts[i + 1] + r2 * pts[i + 2])
      return y + (Number.isFinite(low) ? low : -s[1] / 2)
    }
    default: return y - (Math.abs(ay) * s[0]) / 2 - s[1] * Math.sqrt(Math.max(0, 1 - ay * ay))
  }
}

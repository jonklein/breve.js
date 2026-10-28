import load_mujoco from '@mujoco/mujoco'
import { resolvePhysics, type Articulation, type BodyDef, type HeightfieldDef, type PhysicsEngine, type PhysicsSettings, type PhysicsWorld } from '@breve/core'
import { buildMjcf, TUNING, type Mjcf } from './mjcf'

// MuJoCo behind the engine-neutral adapter in @breve/core. This file and mjcf.ts are the only places that know MuJoCo exists.
//
// Shape of the adapter: every creature is its own small MuJoCo world (an MjModel and an MjData). Adding or removing a creature is then
// cheap and leaves the others untouched, at the price that creatures never touch each other; a scene's `collide` is ignored (see `limits`).

// The wasm is typed loosely by its own package; this is the little of it that is used.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Mj = any

let ready: Promise<PhysicsEngine> | null = null

/** Load MuJoCo once (async: the wasm compiles). */
export function loadMujoco(): Promise<PhysicsEngine> {
  ready ??= (load_mujoco() as Promise<Mj>).then((mj) => makeEngine(mj))
  return ready
}

function makeEngine(mj: Mj): PhysicsEngine {
  return {
    name: 'mujoco-wasm',
    limits: { creatureCollisions: false },
    createWorld: (opts) => new MujocoWorld(mj, resolvePhysics(opts)),
  }
}

/** What a snapshot keeps of one creature: positions, velocities, actuator state and the solver's warm start (its next answer depends on its last). */
interface Saved { time: number; qpos: number[]; qvel: number[]; act: number[]; warm: number[] }

class MujocoWorld implements PhysicsWorld {
  private terrain: HeightfieldDef | null = null
  private arts = new Set<MujocoArticulation>()
  private dt = 0

  constructor(private mj: Mj, private cfg: PhysicsSettings) {}

  setTerrain(t: HeightfieldDef | null): void {
    if (this.arts.size) throw new Error('mujoco: set the terrain before adding creatures')
    this.terrain = t
  }

  addArticulation(body: BodyDef, at: { x: number; y: number; z: number; yaw: number }): Articulation {
    const built = buildMjcf(body, { gravity: this.cfg.gravity, minGyration: this.cfg.minGyration, settings: this.cfg, at, terrain: this.terrain })
    let model: Mj
    try {
      model = this.mj.MjModel.from_xml_string(built.xml)
    } catch (e) {
      throw new Error(`mujoco: could not build the body (${e instanceof Error ? e.message : String(e)})`)
    }
    const a = new MujocoArticulation(this.mj, model, new this.mj.MjData(model), body, built)
    this.arts.add(a)
    return a
  }

  removeArticulation(a: Articulation): void {
    if (this.arts.delete(a as MujocoArticulation)) (a as MujocoArticulation).dispose()
  }

  step(dt: number): void {
    for (const a of this.arts) a.step(dt)
  }

  snapshot(arts: Articulation[]): unknown {
    return (arts as MujocoArticulation[]).map((a) => a.save())
  }

  restore(snapshot: unknown, arts: Articulation[]): void {
    ;(arts as MujocoArticulation[]).forEach((a, i) => a.load((snapshot as Saved[])[i]))
  }

  hash(): string {
    let h = 0x811c9dc5
    for (const a of this.arts) h = a.hashInto(h)
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  dispose(): void {
    for (const a of this.arts) a.dispose()
    this.arts.clear()
  }
}

class MujocoArticulation implements Articulation {
  readonly partCount: number
  readonly jointCount: number
  private bodyIds: number[]
  /** Where each body joint's angle lives in qpos, or -1 (fixed and ball joints read as 0, as with the other engine). */
  private qposAdr: number[]
  private rootVel: number
  private lastDt = 0
  /** Gains last written to each actuator, so the model is only touched when a slider moves them. */
  private gains: { kp: number; kd: number; max: number }[]

  constructor(private mj: Mj, private model: Mj, private data: Mj, private body: BodyDef, private built: Mjcf) {
    this.partCount = body.parts.length
    this.jointCount = (body.joints ?? []).length
    const OBJ_BODY = mj.mjtObj.mjOBJ_BODY.value, OBJ_JOINT = mj.mjtObj.mjOBJ_JOINT.value
    this.bodyIds = built.parts.map((n) => mj.mj_name2id(model, OBJ_BODY, n))
    this.qposAdr = (body.joints ?? []).map((j, i) => ((j.type ?? 'hinge') === 'hinge' ? model.jnt_qposadr[mj.mj_name2id(model, OBJ_JOINT, built.joints[i]!)] : -1))
    this.rootVel = 0 // the free root joint is the first dof
    this.gains = built.actuatorNames.map(() => ({ kp: NaN, kd: NaN, max: NaN }))
    mj.mj_kinematics(model, data) // poses are readable before the first step
  }

  step(dt: number): void {
    if (dt !== this.lastDt) { this.model.opt.timestep = dt; this.lastDt = dt }
    this.mj.mj_step(this.model, this.data)
    this.mj.mj_kinematics(this.model, this.data) // mj_step leaves body poses one step behind the joint positions; bring them up to date
  }

  readPoses(out: Float32Array, offset: number): void {
    const xpos = this.data.xpos, xquat = this.data.xquat // read afresh: the wasm heap can move
    for (let i = 0; i < this.bodyIds.length; i++) {
      const b = this.bodyIds[i], o = offset + i * 7
      out[o] = xpos[b * 3]; out[o + 1] = xpos[b * 3 + 1]; out[o + 2] = xpos[b * 3 + 2]
      out[o + 3] = xquat[b * 4 + 1]; out[o + 4] = xquat[b * 4 + 2]; out[o + 5] = xquat[b * 4 + 3]; out[o + 6] = xquat[b * 4] // (w, x, y, z) becomes (x, y, z, w)
    }
  }

  readRootVelocity(out: Float32Array | number[], offset: number): void {
    const v = this.data.qvel
    out[offset] = v[this.rootVel]; out[offset + 1] = v[this.rootVel + 1]; out[offset + 2] = v[this.rootVel + 2]
  }

  readVelocities(out: Float32Array | number[], offset: number): void {
    // cvel is [angular, linear] about the body's subtree center of mass; the linear part is moved to the body's own center
    const cvel = this.data.cvel, sub = this.data.subtree_com, com = this.data.xipos
    for (let i = 0; i < this.bodyIds.length; i++) {
      const b = this.bodyIds[i], w0 = cvel[b * 6], w1 = cvel[b * 6 + 1], w2 = cvel[b * 6 + 2]
      const rx = com[b * 3] - sub[b * 3], ry = com[b * 3 + 1] - sub[b * 3 + 1], rz = com[b * 3 + 2] - sub[b * 3 + 2]
      const o = offset + i * 6
      out[o] = cvel[b * 6 + 3] + w1 * rz - w2 * ry
      out[o + 1] = cvel[b * 6 + 4] + w2 * rx - w0 * rz
      out[o + 2] = cvel[b * 6 + 5] + w0 * ry - w1 * rx
      out[o + 3] = w0; out[o + 4] = w1; out[o + 5] = w2
    }
  }

  applyForces(f: ArrayLike<number>): void {
    const x = this.data.xfrc_applied // read afresh: the wasm heap can move
    for (let i = 0; i < this.bodyIds.length; i++) {
      const b = this.bodyIds[i] * 6, o = i * 6
      for (let k = 0; k < 6; k++) x[b + k] = f[o + k]
    }
  }

  readAngles(out: Float32Array | number[], offset: number): void {
    const q = this.data.qpos
    for (let i = 0; i < this.qposAdr.length; i++) out[offset + i] = this.qposAdr[i] < 0 ? 0 : q[this.qposAdr[i]]
  }

  setMotors(targets: ArrayLike<number>, stiffness: ArrayLike<number>, damping: ArrayLike<number>, maxTorque?: ArrayLike<number>): void {
    const ctrl = this.data.ctrl
    let gainprm: any = null, biasprm: any = null, forcerange: any = null
    this.built.actuators.forEach((a, i) => {
      if (a < 0) return
      ctrl[a] = targets[i]
      const max = maxTorque && Number.isFinite(maxTorque[i]) ? maxTorque[i] : TUNING.noLimit
      const g = this.gains[a]
      if (g.kp === stiffness[i] && g.kd === damping[i] && g.max === max) return
      gainprm ??= this.model.actuator_gainprm; biasprm ??= this.model.actuator_biasprm; forcerange ??= this.model.actuator_forcerange
      const gstride = gainprm.length / this.built.actuatorNames.length, bstride = biasprm.length / this.built.actuatorNames.length
      gainprm[a * gstride] = stiffness[i]
      biasprm[a * bstride + 1] = -stiffness[i]
      biasprm[a * bstride + 2] = -damping[i]
      forcerange[a * 2] = -max; forcerange[a * 2 + 1] = max
      this.gains[a] = { kp: stiffness[i], kd: damping[i], max }
    })
  }

  save(): Saved {
    const d = this.data
    return { time: d.time, qpos: Array.from(d.qpos), qvel: Array.from(d.qvel), act: Array.from(d.act), warm: Array.from(d.qacc_warmstart) }
  }

  load(s: Saved): void {
    const d = this.data
    d.time = s.time
    d.qpos.set(s.qpos); d.qvel.set(s.qvel); d.act.set(s.act); d.qacc_warmstart.set(s.warm)
    this.mj.mj_kinematics(this.model, d) // poses are readable again
  }

  hashInto(h: number): number {
    for (const arr of [this.data.qpos, this.data.qvel] as Float64Array[]) {
      const bytes = new Uint8Array(new Float64Array(arr).buffer)
      for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
    }
    return h
  }

  dispose(): void {
    this.data.delete()
    this.model.delete()
  }
}

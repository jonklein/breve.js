import { Picture } from './image'
import { Agent, type AgentCols } from './agents'
import { looksOf } from './display'
import { initResult } from './init-shape'
import { actOf, type Controller } from './world'
import { Agents } from '@breve/stdlib'
import { resolve, stateFields } from './scene'
import { Table, type ColumnType, type TableSnapshot } from './store'
import { Nums, toVec } from '@breve/stdlib'
import { spawnPosition } from './spawn'
import type { FrameData, Host, MetricInput, World } from './world'

const SCHEMA = {
  px: 'f32', py: 'f32', pz: 'f32',
  vx: 'f32', vy: 'f32', vz: 'f32',
  ax: 'f32', ay: 'f32', az: 'f32',
  out: 'f32',
} as const

type Cols = Record<keyof typeof SCHEMA, Float32Array>

const DT = 1 / 60
const SOFT_START = 0.85
const SOFT_STRENGTH = 4
const MAX_GRID_AXIS = 32
const DEFAULT_BOUNDS = { size: 30, mode: 'soft' as const }

/** Free-moving agents in continuous 3D space with a neighbor sensor. */
export class AgentWorld implements World {
  readonly table: Table<string>
  private handles: Agent[] = []
  private extra: ReturnType<typeof stateFields>
  private AgentClass: new (cols: AgentCols, row: number) => Agent
  /** Groups of these agents, with a list for every declared state field (`neighbors.energy.average()`). */
  private GroupClass: new (origin: Agent | null) => Agents
  private gridN = 1
  private gridCell = 1
  private gridStart = new Int32Array(2)
  private gridItems = new Int32Array(0)
  private cellOf = new Int32Array(0)
  /** Bumped whenever positions change, so the grid knows when it is out of date. */
  resets = new Set<number>()
  private moved = 1
  private builtAt = 0

  constructor(private host: Host) {
    this.extra = stateFields(host.def.state)
    const schema: Record<string, ColumnType> = { ...SCHEMA }
    const strides: Record<string, number> = {}
    for (const f of this.extra) { schema[f.name] = f.type as ColumnType; strides[f.name] = f.length }
    this.table = new Table(schema, 256, strides)
    this.AgentClass = this.makeClass()
    this.GroupClass = this.makeGroupClass()
    this.sceneChanged()
  }

  private get bounds() {
    return { ...DEFAULT_BOUNDS, ...this.host.scene.bounds }
  }

  private get cols(): Cols {
    return this.table.cols as Cols
  }

  /** Give an agent its starting position, heading and state: random through the bounds unless `spawn` or `init` say otherwise. */
  private place(r: number, count: number): void {
    const def = this.host.def
    const c = this.cols
    const { params, rng } = this.host
    const size = this.bounds.size
    const maxSpeed = resolve(def.motion?.maxSpeed, params, 1)
    c.px[r] = rng.range(-size, size) * 0.5
    c.py[r] = def.motion?.plane === 'xz' ? 0 : rng.range(-size, size) * 0.5
    c.pz[r] = rng.range(-size, size) * 0.5
    const th = rng.range(0, Math.PI * 2)
    const u = rng.range(-1, 1)
    const s = Math.sqrt(1 - u * u)
    const sp = maxSpeed * 0.6
    c.vx[r] = Math.cos(th) * s * sp
    c.vy[r] = def.motion?.plane === 'xz' ? 0 : u * sp
    c.vz[r] = Math.sin(th) * s * sp
    c.out[r] = 0
    for (const f of this.extra) this.table.cols[f.name].fill((f.kind === 'string' ? '' : 0) as never, r * f.length, (r + 1) * f.length)
    this.initState(r)
    this.placeNew(r, count)
  }

  sceneChanged(): void {
    const def = this.host.def
    if (def.count === undefined) return
    const { params } = this.host
    const target = Math.max(0, Math.min(5000, Math.round(resolve(def.count, params, 0))))
    const c = this.cols
    while (this.table.size > target) this.table.despawn(this.table.idAt(this.table.size - 1))
    while (this.table.size < target) {
      this.table.spawn()
      this.place(this.table.size - 1, target)
    }
    while (this.handles.length < this.table.size) this.handles.push(new this.AgentClass(c, this.handles.length))
    this.moved++
  }

  /** One class per scene, with a getter for every declared state field (a number, or a view of its array). */
  private makeClass(): new (cols: AgentCols, row: number) => Agent {
    const table = this.table
    const world = this
    class Stateful extends Agent {
      /** What the controller's last `think` decided for this agent (anything JSON), or undefined before the first. */
      /** This agent's id: what relations store (`ctx.relations.get('follows').add(self.id, other.id)`). */
      get id(): number { return table.idAt(this.row) }
      get decision(): unknown { return world.decisions.get(table.idAt(this.row)) }
      /** True while beyond the set's `fence`. */
      get outside(): boolean { return table.cols.out[this.row] !== 0 }
      /** Put it back at its starting place and state. Happens at the end of the tick. */
      reset(): void { world.resets.add(this.row) }
      /** The cell of the first lattice layer under this agent, or null when it is outside the grid or there is no layer. */
      /** The cell at an offset from this agent (a vector), or null off the grid: `self.patchAt(heading.times(3))`. */
      patchAt(offset: Parameters<typeof toVec>[0]): unknown | null { const o = toVec(offset); return world.layer()?.patchAt(this.x + o.x, this.y + o.y, this.z + o.z) ?? null }
      get patch(): unknown | null { return world.layer()?.patchAt(this.x, this.y, this.z) ?? null }
    }
    for (const f of this.extra) {
      const n = f.length
      Object.defineProperty(Stateful.prototype, f.name, {
        get(this: Agent) {
          const col = table.cols[f.name]
          if (f.array) return col.subarray(this.row * n, (this.row + 1) * n)
          return f.kind === 'boolean' ? col[this.row] !== 0 : col[this.row]
        },
        enumerable: true,
      })
    }
    return Stateful
  }

  /** The lattice layer agents stand on (the first one in the scene). */
  layer() {
    for (const w of this.host.worlds()) if (w.patches) return w.patches
    return undefined
  }

  /** `add: { food: 1 }` adds to the cell under the agent; `add: { Patch: { food: 1 } }` names the layer. */
  private applyAdd(row: number, add: Record<string, unknown>): void {
    const c = this.cols
    const named = this.host.worlds().filter((w) => w.patches).map((w) => w.patches!)
    const plain: Record<string, number> = {}
    for (const [k, v] of Object.entries(add)) {
      if (v && typeof v === 'object') {
        const layer = named.find((l) => l.name === k)
        if (!layer) this.host.fail('act', new Error(`add: there is no layer called "${k}" (layers: ${named.map((l) => l.name).join(', ') || 'none'})`))
        else layer.addAt(c.px[row], c.py[row], c.pz[row], v as Record<string, number>)
      } else plain[k] = Number(v)
    }
    if (Object.keys(plain).length) {
      const layer = named[0]
      if (!layer) this.host.fail('act', new Error('add: the scene has no lattice for agents to add to'))
      else layer.addAt(c.px[row], c.py[row], c.pz[row], plain)
    }
  }

  private writeState(row: number, state: Record<string, unknown>, where = 'act'): void {
    for (const [name, v] of Object.entries(state)) {
      const f = this.extra.find((x) => x.name === name)
      if (!f) { this.host.fail(where, new Error(`state "${name}" does not exist: a set's state is what its init returns (or the scene's "state")`)); continue }
      const col = this.table.cols[name]
      if (f.kind === 'string') { (col as unknown as string[])[row] = String(v); continue }
      if (f.kind === 'boolean') { col[row] = v ? 1 : 0; continue }
      const vals = typeof v === 'number' ? [v] : Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v as ArrayLike<number>) : null
      if (!vals || vals.length !== f.length || vals.some((x) => !Number.isFinite(x))) {
        this.host.fail(where, new Error(`state "${name}" needs ${f.length} finite number${f.length === 1 ? '' : 's'}`))
        continue
      }
      for (let k = 0; k < f.length; k++) col[row * f.length + k] = f.type === 'i32' ? Math.round(vals[k]) : vals[k]
    }
  }

  private makeGroupClass(): new (origin: Agent | null) => Agents {
    class Group extends Agents {}
    for (const f of this.extra)
      Object.defineProperty(Group.prototype, f.name, {
        get(this: Agents) { const out = new Nums(); for (const a of this) out.push((a as never)[f.name]); return out },
        enumerable: true,
      })
    return Group
  }

  /** Apply the scene's `spawn` and the script's `init` to a freshly made agent. */
  private placeNew(r: number, count: number): void {
    const def = this.host.def
    const c = this.cols
    const flat = def.motion?.plane === 'xz'
    const at = spawnPosition(def.spawn, this.host.rng, flat)
    if (at) { c.px[r] = at[0]; c.py[r] = at[1]; c.pz[r] = at[2] }
    if (def.spawn?.velocity) { c.vx[r] = def.spawn.velocity[0]; c.vy[r] = flat ? 0 : def.spawn.velocity[1]; c.vz[r] = def.spawn.velocity[2] }
    const init = this.host.controller()?.init
    if (!init) return
    try {
      const out = init({ index: r, count }, this.host.params, this.host.ctx()) as { position?: Parameters<typeof toVec>[0]; velocity?: Parameters<typeof toVec>[0]; state?: Record<string, unknown> } | void
      if (out?.position) { const p = toVec(out.position); c.px[r] = p.x; c.py[r] = flat ? 0 : p.y; c.pz[r] = p.z }
      if (out?.velocity) { const v = toVec(out.velocity); c.vx[r] = v.x; c.vy[r] = flat ? 0 : v.y; c.vz[r] = v.z }
      const state = initResult(out)
      if (Object.keys(state).length) this.writeState(r, state, 'init')
    } catch (e) {
      this.host.fail('init', e)
    }
  }

  private initState(r: number): void {
    const rng = this.host.rng
    for (const f of this.extra) {
      const col = this.table.cols[f.name]
      const init = f.init
      if (init === undefined) continue
      for (let k = 0; k < f.length; k++) {
        const i = r * f.length + k
        if (typeof init === 'number') col[i] = init
        else if (typeof init === 'boolean') col[i] = init ? 1 : 0
        else if (typeof init === 'string') (col as unknown as string[])[i] = init
        else if ('normal' in init) col[i] = init.normal * Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next())
        else col[i] = rng.range(init.uniform[0], init.uniform[1])
      }
    }
  }

  step(): void {
    const { scene, params: p } = this.host
    const def = this.host.def
    const n = this.table.size
    const c = this.cols
    // the sensor with no `of` looks at this set's own agents and shows up as `neighbors`; the rest are named
    const sensors = (def.sensors ?? []).filter((s) => s.type !== 'camera')
    const cameras = (def.sensors ?? []).filter((s) => s.type === 'camera')
    const own = sensors.find((s) => !s.of || s.of === def.name)
    const others = sensors.filter((s) => s !== own).map((s) => ({ name: s.name!, radius: resolve(s.radius, p, 0), via: s.via, world: this.agentWorld(s.of!) }))
    const radius = resolve(own?.radius, p, 0)
    const ownVia = own?.via

    // sense: build the neighbor index from current positions
    this.ensureGrid(radius)

    // act: controllers read state and write only the action columns
    const ctx = this.host.ctx()
    const setCtrl = this.host.controller()
    // an agent with a non-empty `controller` field runs that export instead of the set's own
    const pick = this.extra.some((f) => f.name === 'controller' && f.kind === 'string') ? (this.table.cols.controller as unknown as string[]) : null
    const writes: { row: number; state: Record<string, unknown>; add?: Record<string, unknown> }[] = []
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0, az = 0
      const ctrl = pick && pick[i] ? this.host.controllerNamed(pick[i]) : setCtrl
      const act = actOf(ctrl)
      if (act) {
        try {
          const obs: Record<string, unknown> = { self: this.handles[i], neighbors: ownVia ? this.linkedTo(i, ownVia, this) : this.neighborsOf(i, radius) }
          for (const o of others) obs[o.name] = o.via ? this.linkedTo(i, o.via, o.world) : o.world?.around(this.handles[i], o.radius) ?? new this.GroupClass(this.handles[i])
          this.attachCameras(obs, i, cameras)
          const out = act(obs as { self: unknown; neighbors: unknown }, p, ctx) as { steer?: Parameters<typeof toVec>[0]; state?: Record<string, unknown>; add?: Record<string, unknown> } | void
          if (out && ((out.state && typeof out.state === 'object') || (out.add && typeof out.add === 'object'))) writes.push({ row: i, state: out.state ?? {}, add: out.add })
          if (out && out.steer) {
            const s = toVec(out.steer)
            if (Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)) { ax = s.x; ay = s.y; az = s.z }
          }
        } catch (e) {
          this.host.fail('act', e)
        }
      }
      c.ax[i] = ax; c.ay[i] = ay; c.az[i] = az
    }

    // state returned by act lands now, after every agent has read the old values
    for (const w of writes) { this.writeState(w.row, w.state); if (w.add) this.applyAdd(w.row, w.add) }

    // act: integrate steering into velocity, with entity-level limits
    const maxSpeed = resolve(def.motion?.maxSpeed, p, Infinity)
    const minSpeed = resolve(def.motion?.minSpeed, p, 0)
    const maxAccel = resolve(def.motion?.maxAccel, p, Infinity)
    const flat = def.motion?.plane === 'xz'
    for (let i = 0; i < n; i++) {
      let ax = c.ax[i], ay = c.ay[i], az = c.az[i]
      const am = Math.hypot(ax, ay, az)
      if (am > maxAccel) { const k = maxAccel / am; ax *= k; ay *= k; az *= k }
      let vx = c.vx[i] + ax * DT, vy = flat ? 0 : c.vy[i] + ay * DT, vz = c.vz[i] + az * DT
      const sp = Math.hypot(vx, vy, vz)
      if (sp > maxSpeed) { const k = maxSpeed / sp; vx *= k; vy *= k; vz *= k }
      else if (sp < minSpeed && sp > 1e-9) { const k = minSpeed / sp; vx *= k; vy *= k; vz *= k }
      c.vx[i] = vx; c.vy[i] = vy; c.vz[i] = vz
    }

    // rules: soft bounds push agents back toward the middle
    const { size, mode } = this.bounds
    if (mode !== 'clamp') {
      const start = size * SOFT_START
      for (let i = 0; i < n; i++) {
        const px = c.px[i], py = c.py[i], pz = c.pz[i]
        if (Math.abs(px) > start) c.vx[i] -= Math.sign(px) * (Math.abs(px) - start) * SOFT_STRENGTH * DT
        if (Math.abs(py) > start) c.vy[i] -= Math.sign(py) * (Math.abs(py) - start) * SOFT_STRENGTH * DT
        if (Math.abs(pz) > start) c.vz[i] -= Math.sign(pz) * (Math.abs(pz) - start) * SOFT_STRENGTH * DT
      }
    }

    // physics: kinematic integration (stands in for a physics adapter)
    const clamp = mode === 'clamp'
    for (let i = 0; i < n; i++) {
      c.px[i] += c.vx[i] * DT
      c.py[i] = flat ? 0 : c.py[i] + c.vy[i] * DT
      c.pz[i] += c.vz[i] * DT
      if (clamp) {
        if (Math.abs(c.px[i]) > size) { c.px[i] = Math.sign(c.px[i]) * size; c.vx[i] = -c.vx[i] }
        if (Math.abs(c.py[i]) > size) { c.py[i] = Math.sign(c.py[i]) * size; c.vy[i] = -c.vy[i] }
        if (Math.abs(c.pz[i]) > size) { c.pz[i] = Math.sign(c.pz[i]) * size; c.vz[i] = -c.vz[i] }
      }
    }
    this.moved++
    this.fence(setCtrl)
  }

  /** Fire `onLeave` for agents that just crossed the fence, then carry out queued resets. */
  private fence(ctrl: Controller | undefined): void {
    const f = this.host.def.fence
    const c = this.cols
    if (f) {
      const { params } = this.host
      const size = resolve(f.size, params, Infinity), floor = resolve(f.floor, params, -Infinity)
      const ctx = this.host.ctx()
      for (let i = 0; i < this.table.size; i++) {
        const out = Math.abs(c.px[i]) > size || Math.abs(c.pz[i]) > size || Math.abs(c.py[i]) > size || c.py[i] < floor
        if (out && !c.out[i] && ctrl?.onLeave) {
          try { ctrl.onLeave({ self: this.handles[i] }, params, ctx) } catch (e) { this.host.fail('onLeave', e) }
        }
        c.out[i] = out ? 1 : 0
      }
    }
    for (const i of [...this.resets].sort((a, b) => a - b)) if (i < this.table.size) this.place(i, this.table.size)
    this.resets.clear()
    if (this.resets.size === 0) this.moved++
  }

  frame(): FrameData {
    const n = this.table.size
    const c = this.cols
    // a script's `display` colors each agent; it runs once per drawn frame, not every tick
    const display = this.host.controller()?.display
    const colors = display ? looksOf(n, (i) => display({ self: this.handleAt(i) }, this.host.params, this.host.ctx()), (e) => this.host.fail('display', e)).rgb : null
    return {
      kind: 'agents',
      count: n,
      size: this.bounds.size,
      unit: 1,
      pos: interleave(n, c.px, c.py, c.pz),
      vel: interleave(n, c.vx, c.vy, c.vz),
      attr: null,
      ...(colors ? { colors } : {}),
    }
  }

  /** What each agent was last told to do by a `think` (keyed by agent id so it follows the agent when rows move). */
  readonly decisions = new Map<number, unknown>()

  /** The agents a `think` is due for right now, with what each should see. Empty when the controller does not think. */
  thinkers(): { row: number; obs: { self: unknown; neighbors: unknown } }[] {
    const ctrl = this.host.controller()
    const every = this.host.def.think?.every ?? 60
    if (!(ctrl?.think || ctrl?.thinkAll) || this.host.tick % every !== 0) return []
    const own = this.host.def.sensors?.find((s) => !s.of && s.type !== 'camera')
    const cameras = (this.host.def.sensors ?? []).filter((s) => s.type === 'camera')
    const radius = resolve(own?.radius, this.host.params, 0)
    this.ensureGrid(radius)
    return Array.from({ length: this.table.size }, (_, row) => {
      const obs: Record<string, unknown> = { self: this.handles[row], neighbors: own?.via ? this.linkedTo(row, own.via, this) : this.neighborsOf(row, radius) }
      this.attachCameras(obs, row, cameras)
      return { row, obs: obs as { self: unknown; neighbors: unknown } }
    })
  }

  /**
   * What a `think` answered. An object whose keys are all state fields is state: it is written to those fields, and `act`
   * reads it as `self.dx`. Anything else is kept as `self.decision` (the older way, which still works).
   */
  setDecision(row: number, decision: unknown): void {
    if (row >= this.table.size) return
    const isState = decision && typeof decision === 'object' && !Array.isArray(decision) && Object.keys(decision).length > 0
      && Object.keys(decision).every((k) => this.extra.some((f) => f.name === k))
    if (isState) this.writeState(row, decision as Record<string, unknown>, 'think')
    else this.decisions.set(this.table.idAt(row), decision)
  }

  snapshot(): unknown {
    return { table: this.table.snapshot(), decisions: [...this.decisions] }
  }

  restore(s: unknown): void {
    const x = s as { table: TableSnapshot; decisions: [number, unknown][] }
    this.table.restore(x.table)
    this.decisions.clear()
    for (const [k, v] of x.decisions) this.decisions.set(k, structuredClone(v))
    this.moved++
    while (this.handles.length < this.table.size) this.handles.push(new this.AgentClass(this.cols, this.handles.length))
  }

  metricInput(): MetricInput {
    const agents = new this.GroupClass(null)
    for (let i = 0; i < this.table.size; i++) agents.push(this.handles[i])
    return { agents, count: this.table.size, cols: this.table.cols }
  }

  /** Another set of agents in this scene, by name (null if it is not one). */
  private agentWorld(name: string): AgentWorld | null {
    const i = this.host.scene.entities.findIndex((e) => e.name === name)
    const w = this.host.worlds()[i]
    return w instanceof AgentWorld ? w : null
  }

  /** Agents of this set within `radius` of another agent (one from any set), nearest to nobody in particular. */
  around(origin: Agent, radius: number): Agents {
    this.ensureGrid(0)
    const out = new this.GroupClass(origin)
    this.collect(out, origin.x, origin.y, origin.z, radius, -1)
    return out
  }

  /** The grid is rebuilt when positions have changed since it was last built. */
  private ensureGrid(radius: number): void {
    if (this.builtAt === this.moved) return
    this.builtAt = this.moved
    this.buildGrid(radius)
  }

  private buildGrid(radius: number): void {
    const size = this.bounds.size
    const n = this.table.size
    const c = this.cols
    const cell = Math.max(radius, (2 * size) / MAX_GRID_AXIS, 1e-3)
    const axis = Math.max(1, Math.ceil((2 * size) / cell))
    this.gridCell = cell
    this.gridN = axis
    const cells = axis * axis * axis
    if (this.gridStart.length < cells + 1) this.gridStart = new Int32Array(cells + 1)
    else this.gridStart.fill(0, 0, cells + 1)
    if (this.cellOf.length < n) this.cellOf = new Int32Array(n * 2)
    if (this.gridItems.length < n) this.gridItems = new Int32Array(n * 2)
    const idx = (v: number) => Math.min(axis - 1, Math.max(0, Math.floor((v + size) / cell)))
    for (let i = 0; i < n; i++) {
      const ci = idx(c.px[i]) + axis * (idx(c.py[i]) + axis * idx(c.pz[i]))
      this.cellOf[i] = ci
      this.gridStart[ci + 1]++
    }
    for (let k = 0; k < cells; k++) this.gridStart[k + 1] += this.gridStart[k]
    const fill = this.gridStart.slice(0, cells)
    for (let i = 0; i < n; i++) this.gridItems[fill[this.cellOf[i]]++] = i
  }

  /** Cameras are read like any other sensor (`obs.view`) but the picture is only drawn when a script asks for it. */
  private attachCameras(obs: Record<string, unknown>, i: number, cameras: NonNullable<typeof this.host.def.sensors>): void {
    for (const cam of cameras) {
      let picture: Picture | null = null
      Object.defineProperty(obs, cam.name!, { enumerable: true, get: () => (picture ??= this.look(i, cam.size ?? 32, resolve(cam.radius, this.host.params, 20))) })
    }
  }

  /**
   * A top-down picture centered on agent `i`, turned so that "up" is the way it is heading (north when it is standing still).
   * Every agent of every set within `range` is a dot in its set's color, the agent itself is white with a tick showing forward,
   * and ground beyond the world's bounds is dark. Drawn from the state alone, so it is the same in every run.
   */
  private look(i: number, size: number, range: number): Picture {
    const c = this.cols
    const x = c.px[i], z = c.pz[i]
    let fx = c.vx[i], fz = c.vz[i]
    const speed = Math.hypot(fx, fz)
    if (speed < 1e-3) { fx = 0; fz = -1 } else { fx /= speed; fz /= speed }
    const rx = -fz, rz = fx // right of forward, seen from above with x to the east and z to the south
    const half = this.host.scene.bounds?.size ?? Infinity
    const pic = new Picture(size, size, [14, 18, 28])
    const scale = size / (2 * range) // pixels per world unit
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const right = ((px + 0.5) / size * 2 - 1) * range, fwd = (1 - (py + 0.5) / size * 2) * range
      const wx = x + rx * right + fx * fwd, wz = z + rz * right + fz * fwd
      if (Math.abs(wx) > half || Math.abs(wz) > half) pic.set(px, py, [52, 56, 64])
    }
    this.host.worlds().forEach((w, set) => {
      if (!(w instanceof AgentWorld)) return
      const look = hexRgb(this.host.scene.entities[set].color) ?? PALETTE[set % PALETTE.length]
      const wc = w.cols, radius = Math.max(1, ((this.host.scene.entities[set].size ?? 1) / 2) * scale)
      for (let j = 0; j < w.table.size; j++) {
        if (w === this && j === i) continue
        const dx = wc.px[j] - x, dz = wc.pz[j] - z
        const right = dx * rx + dz * rz, fwd = dx * fx + dz * fz
        if (Math.abs(right) > range + radius / scale || Math.abs(fwd) > range + radius / scale) continue
        pic.dot((right / range + 1) / 2 * size, (1 - fwd / range) / 2 * size, radius, look)
      }
    })
    const mid = size / 2
    pic.dot(mid, mid, Math.max(1, ((this.host.def.size ?? 1) / 2) * scale), [255, 255, 255])
    pic.dot(mid, mid - Math.max(2, ((this.host.def.size ?? 1) / 2) * scale + 1), 0.8, [255, 255, 255]) // forward tick
    return pic
  }

  /** The agents of `world` that agent `i` points at in the named relation: declared neighbors instead of nearby ones. */
  private linkedTo(i: number, relation: string, world: AgentWorld | null): Agents {
    const out = new this.GroupClass(this.handles[i])
    if (!world || !this.host.relations.has(relation)) return out
    for (const id of this.host.relations.get(relation).targets(this.table.idAt(i))) {
      const row = world.table.row(id)
      if (row >= 0) out.push(world.handleAt(row))
    }
    return out
  }

  /** The handle for a row, created if the set has grown since handles were last made. */
  handleAt(row: number): Agent {
    while (this.handles.length < this.table.size) this.handles.push(new this.AgentClass(this.cols, this.handles.length))
    return this.handles[row]
  }

  private neighborsOf(i: number, radius: number): Agents {
    const out = new this.GroupClass(this.handles[i])
    if (radius > 0) this.collect(out, this.cols.px[i], this.cols.py[i], this.cols.pz[i], radius, i)
    return out
  }

  /** Add to `out` every agent within `radius` of a point, except row `skip`. */
  private collect(out: Agents, x: number, y: number, z: number, radius: number, skip: number): void {
    if (radius <= 0) return
    const axis = this.gridN
    const c = this.cols
    const size = this.bounds.size
    const idx = (v: number) => Math.min(axis - 1, Math.max(0, Math.floor((v + size) / this.gridCell)))
    const cx = idx(x), cy = idx(y), cz = idx(z)
    const reach = Math.max(1, Math.ceil(radius / this.gridCell))
    const r2 = radius * radius
    for (let dz = Math.max(0, cz - reach); dz <= Math.min(axis - 1, cz + reach); dz++)
      for (let dy = Math.max(0, cy - reach); dy <= Math.min(axis - 1, cy + reach); dy++)
        for (let dx = Math.max(0, cx - reach); dx <= Math.min(axis - 1, cx + reach); dx++) {
          const cell = dx + axis * (dy + axis * dz)
          for (let k = this.gridStart[cell]; k < this.gridStart[cell + 1]; k++) {
            const j = this.gridItems[k]
            if (j === skip) continue
            const ex = c.px[j] - x, ey = c.py[j] - y, ez = c.pz[j] - z
            if (ex * ex + ey * ey + ez * ez <= r2) out.push(this.handles[j])
          }
        }
  }
}

function interleave(n: number, a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { out[i * 3] = a[i]; out[i * 3 + 1] = b[i]; out[i * 3 + 2] = c[i] }
  return out
}

const PALETTE: [number, number, number][] = [[255, 207, 107], [123, 228, 149], [255, 107, 107], [107, 168, 255], [214, 140, 255]]

function hexRgb(c: string | undefined): [number, number, number] | null {
  const m = c?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

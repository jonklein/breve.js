import { Agent, Agents } from './agents'
import { resolve } from './scene'
import { Table, type TableSnapshot } from './store'
import { toVec } from './vec'
import type { FrameData, Host, MetricInput, World } from './world'

const SCHEMA = {
  px: 'f32', py: 'f32', pz: 'f32',
  vx: 'f32', vy: 'f32', vz: 'f32',
  ax: 'f32', ay: 'f32', az: 'f32',
} as const

type Cols = Record<keyof typeof SCHEMA, Float32Array>

const DT = 1 / 60
const SOFT_START = 0.85
const SOFT_STRENGTH = 4
const MAX_GRID_AXIS = 32
const DEFAULT_BOUNDS = { size: 30, mode: 'soft' as const }

/** Free-moving agents in continuous 3D space with a neighbor sensor. */
export class AgentWorld implements World {
  readonly table = new Table(SCHEMA, 256)
  private handles: Agent[] = []
  private gridN = 1
  private gridCell = 1
  private gridStart = new Int32Array(2)
  private gridItems = new Int32Array(0)
  private cellOf = new Int32Array(0)

  constructor(private host: Host) {
    this.sceneChanged()
  }

  private get bounds() {
    return { ...DEFAULT_BOUNDS, ...this.host.scene.bounds }
  }

  private get cols(): Cols {
    return this.table.cols as Cols
  }

  sceneChanged(): void {
    const def = this.host.scene.entities[0]
    if (def.count === undefined) return
    const { params, rng } = this.host
    const target = Math.max(0, Math.min(5000, Math.round(resolve(def.count, params, 0))))
    const c = this.cols
    const size = this.bounds.size
    const maxSpeed = resolve(def.motion?.maxSpeed, params, 1)
    while (this.table.size > target) this.table.despawn(this.table.idAt(this.table.size - 1))
    while (this.table.size < target) {
      this.table.spawn()
      const r = this.table.size - 1
      c.px[r] = rng.range(-size, size) * 0.5
      c.py[r] = rng.range(-size, size) * 0.5
      c.pz[r] = rng.range(-size, size) * 0.5
      const th = rng.range(0, Math.PI * 2)
      const u = rng.range(-1, 1)
      const s = Math.sqrt(1 - u * u)
      const sp = maxSpeed * 0.6
      c.vx[r] = Math.cos(th) * s * sp
      c.vy[r] = u * sp
      c.vz[r] = Math.sin(th) * s * sp
    }
    while (this.handles.length < this.table.size) this.handles.push(new Agent(c, this.handles.length))
  }

  step(): void {
    const { scene, params: p, script } = this.host
    const def = scene.entities[0]
    const n = this.table.size
    const c = this.cols
    const radius = resolve(def.sensors?.find((s) => s.type === 'neighbors')?.radius, p, 0)

    // sense: build the neighbor index from current positions
    this.buildGrid(radius)

    // decide: controllers read state and write only the action columns
    const ctx = this.host.ctx()
    const ctrl = script?.default
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0, az = 0
      if (ctrl) {
        try {
          const out = ctrl.decide!({ self: this.handles[i], neighbors: this.neighborsOf(i, radius) }, p, ctx) as { steer?: Parameters<typeof toVec>[0] } | void
          if (out && out.steer) {
            const s = toVec(out.steer)
            if (Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)) { ax = s.x; ay = s.y; az = s.z }
          }
        } catch (e) {
          this.host.fail('decide', e)
        }
      }
      c.ax[i] = ax; c.ay[i] = ay; c.az[i] = az
    }

    // act: integrate steering into velocity, with entity-level limits
    const maxSpeed = resolve(def.motion?.maxSpeed, p, Infinity)
    const minSpeed = resolve(def.motion?.minSpeed, p, 0)
    const maxAccel = resolve(def.motion?.maxAccel, p, Infinity)
    for (let i = 0; i < n; i++) {
      let ax = c.ax[i], ay = c.ay[i], az = c.az[i]
      const am = Math.hypot(ax, ay, az)
      if (am > maxAccel) { const k = maxAccel / am; ax *= k; ay *= k; az *= k }
      let vx = c.vx[i] + ax * DT, vy = c.vy[i] + ay * DT, vz = c.vz[i] + az * DT
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
      c.py[i] += c.vy[i] * DT
      c.pz[i] += c.vz[i] * DT
      if (clamp) {
        if (Math.abs(c.px[i]) > size) { c.px[i] = Math.sign(c.px[i]) * size; c.vx[i] = -c.vx[i] }
        if (Math.abs(c.py[i]) > size) { c.py[i] = Math.sign(c.py[i]) * size; c.vy[i] = -c.vy[i] }
        if (Math.abs(c.pz[i]) > size) { c.pz[i] = Math.sign(c.pz[i]) * size; c.vz[i] = -c.vz[i] }
      }
    }
  }

  frame(): FrameData {
    const n = this.table.size
    const c = this.cols
    return {
      kind: 'agents',
      count: n,
      size: this.bounds.size,
      unit: 1,
      pos: interleave(n, c.px, c.py, c.pz),
      vel: interleave(n, c.vx, c.vy, c.vz),
      attr: null,
    }
  }

  snapshot(): unknown {
    return this.table.snapshot()
  }

  restore(s: unknown): void {
    this.table.restore(s as TableSnapshot)
    while (this.handles.length < this.table.size) this.handles.push(new Agent(this.cols, this.handles.length))
  }

  metricInput(): MetricInput {
    const agents = new Agents(null)
    for (let i = 0; i < this.table.size; i++) agents.push(this.handles[i])
    return { agents, count: this.table.size, cols: this.table.cols }
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

  private neighborsOf(i: number, radius: number): Agents {
    const out = new Agents(this.handles[i])
    if (radius <= 0) return out
    const axis = this.gridN
    const c = this.cols
    const ci = this.cellOf[i]
    const cx = ci % axis, cy = Math.floor(ci / axis) % axis, cz = Math.floor(ci / (axis * axis))
    const reach = Math.max(1, Math.ceil(radius / this.gridCell))
    const r2 = radius * radius
    const x = c.px[i], y = c.py[i], z = c.pz[i]
    for (let dz = Math.max(0, cz - reach); dz <= Math.min(axis - 1, cz + reach); dz++)
      for (let dy = Math.max(0, cy - reach); dy <= Math.min(axis - 1, cy + reach); dy++)
        for (let dx = Math.max(0, cx - reach); dx <= Math.min(axis - 1, cx + reach); dx++) {
          const cell = dx + axis * (dy + axis * dz)
          for (let k = this.gridStart[cell]; k < this.gridStart[cell + 1]; k++) {
            const j = this.gridItems[k]
            if (j === i) continue
            const ex = c.px[j] - x, ey = c.py[j] - y, ez = c.pz[j] - z
            if (ex * ex + ey * ey + ez * ez <= r2) out.push(this.handles[j])
          }
        }
    return out
  }
}

function interleave(n: number, a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { out[i * 3] = a[i]; out[i * 3 + 1] = b[i]; out[i * 3 + 2] = c[i] }
  return out
}

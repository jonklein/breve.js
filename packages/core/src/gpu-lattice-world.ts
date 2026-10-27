/**
 * A lattice whose state lives on a graphics card (see `@breve/gpu`): the script gives `initFormula` and `actFormula` (and may give
 * `displayFormula`), each tick is one dispatch, and nothing comes back to the processor until it is asked for. What a viewer or a
 * metric needs is fetched by `refresh()` (a picture of the part of the grid on screen, and the metrics' totals); the whole state is
 * fetched by `sync()`, which a snapshot, a hash or a fork needs. Between the two, the columns of an ordinary lattice do not exist.
 *
 * Like every world, every cell reads the old state and the new one lands at the end of the tick; results are the same as the CPU's
 * interpreter for rules made of whole numbers (Life), and can differ in the last bits for rules that divide or average.
 */
import { programOf } from './formula-run'
import { resolve } from './scene'
import type { FormulaLattice, Grid, Program } from '@breve/stdlib'
import { trace, traceMetrics } from '@breve/stdlib'
import type { Table } from './store'
import type { Formula } from '@breve/stdlib'
import type { FrameData, Host, MetricInput, World } from './world'

/** Which part of the grid to draw, and how many pixels to draw it in. */
export interface FieldView {
  /** left, top, right and bottom edges, in cells. Default: the whole grid. */
  window?: [number, number, number, number]
  width?: number
  height?: number
}

const MAX_SIDE = 1024

/** The shape of the whole-numbers test: a rule is exact on any machine if it only adds, compares and picks whole numbers. */
export function isExactProgram(p: Program): boolean {
  return p.nodes.every((n) => (n.k === 'num' ? Number.isInteger(n.v) : n.k === 'bin' ? n.op !== 'div' : n.k === 'un' ? ['abs', 'neg', 'floor'].includes(n.op) : n.k === 'nbr' ? n.op !== 'avg' : n.k !== 'clamp' || (Number.isInteger(n.lo) && Number.isInteger(n.hi))))
}

export class GpuLatticeWorld implements World {
  private readonly dims: [number, number, number]
  private readonly n: number
  private readonly grid: Grid
  private readonly fields: string[]
  private view: FieldView = {}
  /** The picture and totals as of the last `refresh`. */
  private picture: { pixels: Uint8Array; width: number; height: number; window: [number, number, number, number] } | null = null
  private totalsNow: Record<string, number> = {}
  private viewStale = true
  /** The whole state, as of the last `sync` (valid until the next step). */
  private state: Record<string, Float32Array> | null = null
  private metricPrograms = new WeakMap<object, Program>()
  private fallbackLook: { fields: string; program: Program } | null = null

  constructor(private host: Host, private lattice: FormulaLattice, fields: string[]) {
    const L = host.def.lattice!
    this.dims = L.size
    this.n = L.size[0] * L.size[1] * L.size[2]
    this.fields = fields
    this.grid = { size: L.size, wrap: L.edges === 'wrap', neighborhood: L.neighborhood }
    const ctrl = host.controller()
    try {
      lattice.init(this.program(ctrl!.initFormula as Formula, []), this.run(0))
    } catch (e) {
      host.fail('initFormula', e)
    }
  }

  /** The device-less part of what a world needs to know: is a controller one that can run here? */
  static eligible(def: { lattice?: { size: [number, number, number]; compute?: string } }, ctrl: { actFormula?: unknown; initFormula?: unknown } | undefined): boolean {
    return !!def.lattice && def.lattice.compute !== 'cpu' && def.lattice.size[2] === 1 && !!ctrl?.actFormula && !!ctrl?.initFormula
  }

  private run(tick: number) {
    return { params: this.host.params, tick, seed: this.host.scene.seed }
  }

  private program(fn: Formula, fields: string[]): Program {
    return programOf(fn, fields, Object.keys(this.host.params), { size: this.dims, data: this.host.scene.data })
  }

  /** Compile what the script has now and report anything wrong in words (the sim keeps going without the failing part). */
  async prepare(): Promise<void> {
    const ctrl = this.host.controller()
    if (!ctrl) return
    const programs: Program[] = []
    try {
      programs.push(this.program(ctrl.initFormula as Formula, []), this.program(ctrl.actFormula as Formula, this.fields))
    } catch (e) {
      this.host.fail('actFormula', e)
      return
    }
    for (const problem of await this.lattice.check(programs)) this.host.fail('formula', new Error(problem))
  }

  get table(): Table<never> {
    throw new Error(`"${this.host.def.name}" keeps its cells on the graphics card, so there is no table of them: use \`await sim.sync()\` and then \`sim.snapshot()\`, or its metrics and frames`)
  }

  setView(view: FieldView): void {
    this.view = view
    this.viewStale = true
  }

  step(): void {
    const ctrl = this.host.controller()
    if (!ctrl?.actFormula) {
      this.host.fail('actFormula', new Error('this lattice runs on the graphics card, which needs the script to have an `actFormula`'))
      return
    }
    try {
      const program = this.program(ctrl.actFormula as Formula, this.fields)
      const substeps = Math.max(1, Math.min(256, Math.round(resolve(this.host.def.lattice!.substeps, this.host.params, 1))))
      for (let i = 0; i < substeps; i++) this.lattice.step(program, this.run(this.host.tick * substeps + i))
    } catch (e) {
      this.host.fail('actFormula', e)
      return
    }
    this.viewStale = true
    this.state = null
  }

  sceneChanged(): void {
    this.viewStale = true
  }

  /** The picture for the current view, from `displayFormula` (or, without one, a white dot for every cell whose first field is not 0). */
  private lookProgram(): Program {
    const ctrl = this.host.controller()
    if (ctrl?.displayFormula) return this.program(ctrl.displayFormula as Formula, this.fields)
    const first = this.fields[0]
    if (this.fallbackLook?.fields !== first) this.fallbackLook = { fields: first, program: trace(((f: Record<string, never>) => ({ visible: (f[first] as { ne(n: number): unknown }).ne(0), r: 1, g: 1, b: 1 })) as unknown as Formula, this.fields, []) }
    return this.fallbackLook.program
  }

  private totalsProgram(): Program | null {
    const metrics = this.host.script?.metrics
    if (!metrics) return null
    const want = new Set(this.host.scene.metrics ?? [])
    const fns = Object.fromEntries(Object.entries(metrics).filter(([k]) => want.has(k)))
    const key = metrics as object
    let p = this.metricPrograms.get(key)
    if (!p) this.metricPrograms.set(key, (p = traceMetrics(fns as Record<string, (input: unknown) => unknown>, this.fields).program))
    return p
  }

  /** Bring the picture and the totals up to date: what frames and metrics show. Cheap compared with `sync`. */
  async refresh(): Promise<void> {
    if (!this.viewStale && this.picture) return
    this.viewStale = false
    const [nx, ny] = this.dims
    const window = this.view.window ?? [0, 0, nx, ny]
    const w = Math.max(1, Math.round(this.view.width ?? Math.min(nx, MAX_SIDE)))
    const h = Math.max(1, Math.round(this.view.height ?? Math.min(ny, MAX_SIDE)))
    const run = this.run(this.host.tick)
    try {
      const pixels = await this.lattice.image(this.lookProgram(), { width: w, height: h, window, background: [0.02, 0.03, 0.06] }, run)
      this.picture = { pixels, width: w, height: h, window }
      const totals = this.totalsProgram()
      if (totals && Object.keys(totals.reduce ?? {}).length) this.totalsNow = await this.lattice.totals(totals, run)
    } catch (e) {
      this.host.fail('display', e)
    }
  }

  /** True when the rule gives the same cells on any graphics card (it only adds, compares and picks whole numbers). */
  isExact(): boolean {
    const ctrl = this.host.controller()
    try {
      return !!ctrl?.actFormula && isExactProgram(this.program(ctrl.actFormula as Formula, this.fields)) && (!ctrl.initFormula || isExactProgram(this.program(ctrl.initFormula as Formula, [])))
    } catch {
      return true
    }
  }

  get needsRefresh(): boolean { return this.viewStale || !this.picture }

  /** The totals the script's metrics asked for, as of the last `refresh`. */
  totals(): Record<string, number> { return this.totalsNow }

  /** Bring the whole state back to the processor (a snapshot, a hash and a fork need it). */
  async sync(): Promise<void> {
    if (!this.state) this.state = await this.lattice.download()
  }

  frame(): FrameData {
    const [nx, ny] = this.dims
    const sp = this.host.def.lattice!.spacing ?? 1.2
    const p = this.picture
    return {
      kind: 'field',
      count: this.n,
      size: (Math.max(nx, ny) * sp) / 2,
      unit: sp,
      pos: new Float32Array(0),
      vel: null,
      field: { dims: [nx, ny], spacing: sp, width: p?.width ?? 0, height: p?.height ?? 0, pixels: p?.pixels ?? new Uint8Array(0), window: p?.window ?? [0, 0, nx, ny] },
    }
  }

  metricInput(): MetricInput {
    const none = new Proxy({}, { get: (_, k) => { throw new Error(`the cells of "${this.host.def.name}" are on the graphics card: a metric there must be a total of a field, such as cells.${String(k)}.sum() or cells.${String(k)}.average()`) } })
    return { count: this.n, cols: {}, cells: none } as unknown as MetricInput
  }

  private needState(): Record<string, Float32Array> {
    if (!this.state) throw new Error(`"${this.host.def.name}" keeps its cells on the graphics card: \`await sim.sync()\` before a snapshot, a hash or a fork`)
    return this.state
  }

  snapshot(): unknown {
    const s = this.needState()
    return { gpu: true, state: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.slice()])) }
  }

  restore(s: unknown): void {
    const x = s as { state?: Record<string, Float32Array> }
    if (!x.state) throw new Error('this snapshot is not from a lattice kept on a graphics card')
    this.lattice.upload(x.state)
    this.state = Object.fromEntries(Object.entries(x.state).map(([k, v]) => [k, v.slice()]))
    this.viewStale = true
  }

  hash(): string {
    const s = this.needState()
    let h = 0x811c9dc5
    for (const k of Object.keys(s).sort()) {
      const words = new Uint32Array(s[k].buffer, s[k].byteOffset, s[k].length)
      for (let i = 0; i < words.length; i++) { h ^= words[i]; h = Math.imul(h, 0x01000193) }
    }
    return (h >>> 0).toString(16)
  }

  dispose(): void {
    this.lattice.dispose()
  }
}

/**
 * The graphics-card backend for formulas: the only package that knows WebGPU. It keeps the state of a lattice in two buffers on the
 * card (one holds the state, the other receives the next one, and they swap every tick), runs a formula program as one compute pass,
 * and hands numbers back only when asked. The shaders are written by `@breve/stdlib` (`toWgsl` and friends); this package creates
 * the buffers and pipelines, runs them, and reads results back. See docs/decisions/gpu-fields.md.
 */
import { toWgsl, toWgslImage, toWgslCells, toWgslReduce, type FormulaBackend, type FormulaLattice, type Grid, type ImageRequest, type Program, type RunArgs } from '@breve/stdlib'

const STORAGE = 0x80 | 0x4 | 0x8 // STORAGE | COPY_SRC | COPY_DST
const COMPUTE = 4

interface Compiled { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout; uniform: GPUBuffer; paramsOffset: number; uniformSize: number; params: string[] }

/** A WebGPU backend, or null where the browser has none (the caller falls back to the processor). */
export async function loadWebGpu(): Promise<FormulaBackend | null> {
  const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu
  if (!gpu) return null
  let adapter: GPUAdapter | null = null
  try { adapter = await gpu.requestAdapter() } catch { return null }
  if (!adapter) return null
  // a big grid needs big buffers: ask for everything the card offers
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } })
  return new WebGpuBackend(device)
}

class WebGpuBackend implements FormulaBackend {
  readonly name = 'webgpu'
  constructor(private device: GPUDevice) {}
  lattice(grid: Grid, fields: string[]): FormulaLattice { return new GpuLattice(this.device, grid, fields) }
}

class GpuLattice implements FormulaLattice {
  readonly cells: number
  private bytes: number
  private buf: GPUBuffer[]
  private flip = 0
  private compiled = new WeakMap<Program, Map<string, Compiled>>()
  private errors: string[] = []

  constructor(private device: GPUDevice, private grid: Grid, private fields: string[]) {
    this.cells = grid.size[0] * grid.size[1] * grid.size[2]
    this.bytes = Math.max(4, fields.length * this.cells * 4)
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    if (this.bytes > limit) {
      throw new Error(`this grid needs ${(this.bytes / 1048576).toFixed(0)} MB of state (${this.cells.toLocaleString()} cells, ${fields.length} fields), and this graphics device allows ${(limit / 1048576).toFixed(0)} MB in one buffer`)
    }
    this.buf = [0, 1].map(() => device.createBuffer({ size: this.bytes, usage: STORAGE }))
    device.addEventListener('uncapturederror', (e) => { this.errors.push((e as GPUUncapturedErrorEvent).error.message) })
  }

  /** The compiled pipeline for a program in one role ("step", "image", "reduce"), made once. */
  private compile(program: Program, role: 'step' | 'image' | 'cells' | 'reduce'): { c: Compiled; module: ReturnType<typeof toWgsl> | ReturnType<typeof toWgslImage> | ReturnType<typeof toWgslCells> | ReturnType<typeof toWgslReduce> } {
    let roles = this.compiled.get(program)
    if (!roles) this.compiled.set(program, (roles = new Map()))
    const made = role === 'step' ? toWgsl(program, this.grid, this.fields) : role === 'image' ? toWgslImage(program, this.grid, this.fields) : role === 'cells' ? toWgslCells(program, this.grid, this.fields) : toWgslReduce(program, this.grid, this.fields)
    let c = roles.get(role)
    if (!c) {
      const module = this.device.createShaderModule({ code: made.code })
      const layout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: COMPUTE, buffer: { type: 'storage' } },
      ] })
      const pipeline = this.device.createComputePipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: 'main' } })
      const uniform = this.device.createBuffer({ size: made.uniform.size, usage: 0x40 | 0x8 }) // UNIFORM | COPY_DST
      c = { pipeline, layout, uniform, paramsOffset: made.uniform.paramsOffset, uniformSize: made.uniform.size, params: made.uniform.params }
      roles.set(role, c)
    }
    return { c, module: made }
  }

  async check(programs: Program[]): Promise<string[]> {
    const problems: string[] = []
    this.device.pushErrorScope('validation')
    const modules: [string, GPUShaderModule][] = []
    for (const p of programs) {
      for (const role of ['step', 'reduce'] as const) {
        if (role === 'reduce' && !p.reduce) continue
        if (role === 'step' && !Object.keys(p.out).length) continue
        const made = role === 'step' ? toWgsl(p, this.grid, this.fields) : toWgslReduce(p, this.grid, this.fields)
        modules.push([role, this.device.createShaderModule({ code: made.code })])
      }
    }
    for (const [role, m] of modules) {
      const info = await m.getCompilationInfo()
      for (const msg of info.messages) if (msg.type === 'error') problems.push(`the ${role} shader did not compile (line ${msg.lineNum}): ${msg.message}`)
    }
    const failure = await this.device.popErrorScope()
    if (failure && !problems.length) problems.push(failure.message)
    return problems
  }

  /** Fill the program's uniform buffer: tick, seed, whatever the role puts at byte 8 on (`extra`), then the parameters. */
  private write(c: Compiled, extra: ArrayBuffer | null, run: RunArgs): void {
    const u = new ArrayBuffer(c.uniformSize)
    new Uint32Array(u, 0, 2).set([run.tick >>> 0, run.seed >>> 0])
    if (extra) new Uint8Array(u, 8, extra.byteLength).set(new Uint8Array(extra))
    const params = new Float32Array(u, c.paramsOffset, c.params.length)
    c.params.forEach((name, i) => {
      const v = run.params[name]
      if (typeof v !== 'number') throw new Error(`the program needs a value for the parameter "${name}"`)
      params[i] = v
    })
    this.device.queue.writeBuffer(c.uniform, 0, u)
  }

  private dispatch(c: Compiled, src: GPUBuffer, dst: GPUBuffer, groups: [number, number, number]): void {
    const group = this.device.createBindGroup({ layout: c.layout, entries: [
      { binding: 0, resource: { buffer: c.uniform } }, { binding: 1, resource: { buffer: src } }, { binding: 2, resource: { buffer: dst } },
    ] })
    const enc = this.device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(c.pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(groups[0], groups[1], groups[2])
    pass.end()
    this.device.queue.submit([enc.finish()])
  }

  private run(program: Program, run: RunArgs): void {
    const { c, module } = this.compile(program, 'step')
    this.write(c, null, run)
    this.dispatch(c, this.buf[this.flip], this.buf[1 - this.flip], (module as ReturnType<typeof toWgsl>).dispatch)
    this.flip = 1 - this.flip
  }

  init(program: Program, run: RunArgs): void { this.run(program, run) }
  step(program: Program, run: RunArgs): void { this.run(program, run) }

  upload(state: Record<string, ArrayLike<number>>): void {
    const all = new Float32Array(this.fields.length * this.cells)
    this.fields.forEach((f, i) => { if (state[f]) all.set(state[f], i * this.cells) })
    this.device.queue.writeBuffer(this.buf[this.flip], 0, all)
  }

  private async read(buffer: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
    const rb = this.device.createBuffer({ size: bytes, usage: 0x1 | 0x8 }) // MAP_READ | COPY_DST
    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(buffer, 0, rb, 0, bytes)
    this.device.queue.submit([enc.finish()])
    await rb.mapAsync(1)
    const out = rb.getMappedRange().slice(0)
    rb.unmap()
    rb.destroy()
    if (this.errors.length) throw new Error(`the graphics device reported: ${this.errors.splice(0).join('; ')}`)
    return out
  }

  async download(): Promise<Record<string, Float32Array>> {
    const all = new Float32Array(await this.read(this.buf[this.flip], this.fields.length * this.cells * 4))
    return Object.fromEntries(this.fields.map((f, i) => [f, all.slice(i * this.cells, (i + 1) * this.cells)]))
  }

  async totals(program: Program, run: RunArgs): Promise<Record<string, number>> {
    const { c, module } = this.compile(program, 'reduce')
    const m = module as ReturnType<typeof toWgslReduce>
    if (!m.totals.length) return {}
    const bytes = m.totals.length * m.groups * 4
    const partials = this.device.createBuffer({ size: bytes, usage: STORAGE })
    this.write(c, null, run)
    this.dispatch(c, this.buf[this.flip], partials, m.dispatch)
    const values = new Float32Array(await this.read(partials, bytes))
    partials.destroy()
    const out: Record<string, number> = {}
    m.totals.forEach((t, i) => {
      let s = 0
      for (let g = 0; g < m.groups; g++) s += values[i * m.groups + g] // added in 64-bit: each partial is exact for counts
      out[t.name] = t.op === 'average' ? s / this.cells : s
    })
    return out
  }

  async image(program: Program, req: ImageRequest, run: RunArgs): Promise<Uint8Array> {
    const { c, module } = this.compile(program, 'image')
    const m = module as ReturnType<typeof toWgslImage>
    const pixels = this.device.createBuffer({ size: req.width * req.height * 4, usage: STORAGE })
    const head = new ArrayBuffer(40)
    new Uint32Array(head, 0, 2).set([req.width, req.height])
    new Float32Array(head, 8, 8).set([...req.window, ...(req.background ?? [0, 0, 0]), req.layer ?? 0])
    this.write(c, head, run)
    this.dispatch(c, this.buf[this.flip], pixels, m.dispatchFor(req.width, req.height))
    const out = new Uint8Array(await this.read(pixels, req.width * req.height * 4))
    pixels.destroy()
    return out
  }

  async looks(program: Program, run: RunArgs): Promise<Uint8Array> {
    const { c, module } = this.compile(program, 'cells')
    const m = module as ReturnType<typeof toWgslCells>
    const pixels = this.device.createBuffer({ size: this.cells * 4, usage: STORAGE })
    this.write(c, null, run)
    this.dispatch(c, this.buf[this.flip], pixels, m.dispatch)
    const out = new Uint8Array(await this.read(pixels, this.cells * 4))
    pixels.destroy()
    return out
  }

  dispose(): void {
    for (const b of this.buf) b.destroy()
  }
}

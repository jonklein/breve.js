/**
 * A `FormulaBackend` that runs on the processor with the interpreter. It is what a host without a graphics card could register to give
 * a scene the same lattice interface (state held apart from the columns, pictures and totals on request), and it is what tests of code
 * that uses the interface run against. The card's backend is checked against this one.
 */
import { interpret, interpretTotals, type Grid, type Program } from './formula'
import type { FormulaBackend, FormulaLattice, ImageRequest, RunArgs } from './formula-backend'

class CpuLattice implements FormulaLattice {
  readonly cells: number
  private state: Record<string, Float32Array> = {}

  constructor(private grid: Grid, private fields: string[]) {
    this.cells = grid.size[0] * grid.size[1] * grid.size[2]
    for (const f of fields) this.state[f] = new Float32Array(this.cells)
  }

  async check(): Promise<string[]> { return [] }

  private run(program: Program, run: RunArgs): void {
    const out = interpret(program, this.grid, { state: this.state, params: run.params, tick: run.tick, seed: run.seed })
    // every cell read the old state; the results replace it together
    const next: Record<string, Float32Array> = {}
    for (const f of this.fields) next[f] = out[f] ?? this.state[f]
    this.state = next
  }

  init(program: Program, run: RunArgs): void { this.run(program, run) }
  step(program: Program, run: RunArgs): void { this.run(program, run) }

  upload(state: Record<string, ArrayLike<number>>): void {
    for (const f of this.fields) this.state[f] = state[f] ? Float32Array.from(state[f]) : new Float32Array(this.cells)
  }

  async download(): Promise<Record<string, Float32Array>> {
    return Object.fromEntries(this.fields.map((f) => [f, this.state[f].slice()]))
  }

  async totals(program: Program, run: RunArgs): Promise<Record<string, number>> {
    return interpretTotals(program, this.grid, { state: this.state, params: run.params, tick: run.tick, seed: run.seed })
  }

  async image(program: Program, req: ImageRequest, run: RunArgs): Promise<Uint8Array> {
    const out = interpret(program, this.grid, { state: this.state, params: run.params, tick: run.tick, seed: run.seed })
    const [nx, ny, nz] = this.grid.size
    const layer = Math.min(nz - 1, Math.max(0, Math.floor(req.layer ?? 0)))
    const [x0, y0, x1, y1] = req.window
    const bg = req.background ?? [0, 0, 0]
    const byte = (v: number) => Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5)
    const pixels = new Uint8Array(req.width * req.height * 4)
    for (let py = 0; py < req.height; py++) {
      for (let px = 0; px < req.width; px++) {
        const fx = x0 + ((px + 0.5) * (x1 - x0)) / req.width, fy = y0 + ((py + 0.5) * (y1 - y0)) / req.height
        const inside = fx >= 0 && fy >= 0 && fx < nx && fy < ny
        const c = Math.min(ny - 1, Math.max(0, Math.floor(fy))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(fx))) + layer * nx * ny
        const shown = inside && (out.visible ? out.visible[c] !== 0 : true)
        const o = (py * req.width + px) * 4
        pixels[o] = byte(shown ? (out.r ? out.r[c] : 1) : bg[0]); pixels[o + 1] = byte(shown ? (out.g ? out.g[c] : 1) : bg[1]); pixels[o + 2] = byte(shown ? (out.b ? out.b[c] : 1) : bg[2]); pixels[o + 3] = 255
      }
    }
    return pixels
  }

  async looks(program: Program, run: RunArgs): Promise<Uint8Array> {
    const out = interpret(program, this.grid, { state: this.state, params: run.params, tick: run.tick, seed: run.seed })
    const byte = (v: number) => Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5)
    const pixels = new Uint8Array(this.cells * 4)
    for (let c = 0; c < this.cells; c++) {
      pixels[c * 4] = byte(out.r ? out.r[c] : 1); pixels[c * 4 + 1] = byte(out.g ? out.g[c] : 1); pixels[c * 4 + 2] = byte(out.b ? out.b[c] : 1)
      pixels[c * 4 + 3] = out.visible && out.visible[c] === 0 ? 0 : 255
    }
    return pixels
  }

  dispose(): void { this.state = {} }
}

export const cpuFormulaBackend: FormulaBackend = {
  name: 'cpu',
  lattice: (grid, fields) => new CpuLattice(grid, fields),
}

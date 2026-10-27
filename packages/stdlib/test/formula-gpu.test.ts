import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { trace, interpret, toWgsl, type Formula, type Grid, type Program } from '../src/index'

// These run the generated shader on a real WebGPU device (a software one is enough) and compare it with the interpreter.
// They need Playwright's Chromium, which is not a dependency of the repository: without it the tests are skipped.
const require_ = createRequire(import.meta.url)
let chromium: { launch(o: object): Promise<any> } | undefined
try { chromium = require_('playwright').chromium } catch { /* skipped below */ }

// Runs inside the page. Two state buffers swap roles each step, as the engine will run them.
const RUN = async (a: { code: string; layout: string[]; cells: number; uniform: { binding: number; size: number; paramsOffset: number }; dispatch: number[]; state: Record<string, number[]>; params: number[]; tick: number; seed: number; steps: number }) => {
  const adapter = await (navigator as any).gpu?.requestAdapter()
  if (!adapter) return { skip: 'no WebGPU adapter' }
  const device = await adapter.requestDevice()
  device.pushErrorScope('validation')
  const mod = device.createShaderModule({ code: a.code })
  const info = await mod.getCompilationInfo()
  const errors = info.messages.filter((m: any) => m.type === 'error').map((m: any) => `line ${m.lineNum}: ${m.message}`)
  if (errors.length) return { errors }
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 4, buffer: { type: 'uniform' } }, { binding: 1, visibility: 4, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: 4, buffer: { type: 'storage' } }] })
  const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: mod, entryPoint: 'main' } })
  const bytes = a.layout.length * a.cells * 4
  const buf = [0, 1].map(() => device.createBuffer({ size: bytes, usage: 0x80 | 0x4 | 0x8 })) // STORAGE | COPY_SRC | COPY_DST
  const start = new Float32Array(a.layout.length * a.cells)
  a.layout.forEach((f, i) => { if (a.state[f]) start.set(a.state[f], i * a.cells) })
  device.queue.writeBuffer(buf[0], 0, start)
  const ub = device.createBuffer({ size: a.uniform.size, usage: 0x40 | 0x8 }) // UNIFORM | COPY_DST
  const group = [0, 1].map((i) => device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: buf[i] } }, { binding: 2, resource: { buffer: buf[1 - i] } }] }))
  for (let s = 0; s < a.steps; s++) {
    const u = new ArrayBuffer(a.uniform.size)
    new Uint32Array(u, 0, 2).set([a.tick + s, a.seed])
    new Float32Array(u, a.uniform.paramsOffset).set(a.params)
    device.queue.writeBuffer(ub, 0, u)
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group[s % 2]); pass.dispatchWorkgroups(a.dispatch[0], a.dispatch[1], a.dispatch[2]); pass.end()
    device.queue.submit([enc.finish()])
  }
  const problem = await device.popErrorScope()
  if (problem) return { errors: [problem.message] }
  const rb = device.createBuffer({ size: bytes, usage: 0x1 | 0x8 }) // MAP_READ | COPY_DST
  const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buf[a.steps % 2], 0, rb, 0, bytes); device.queue.submit([enc.finish()])
  await rb.mapAsync(1)
  const all = new Float32Array(rb.getMappedRange().slice(0))
  rb.unmap()
  const result: Record<string, number[]> = {}
  a.layout.forEach((f, i) => { result[f] = Array.from(all.subarray(i * a.cells, (i + 1) * a.cells)) })
  return { result }
}

let browser: any, page: any
async function gpu(program: Program, grid: Grid, state: Record<string, ArrayLike<number>>, opts: { params?: Record<string, number>; tick?: number; seed?: number; steps?: number; fields?: string[] } = {}) {
  const m = toWgsl(program, grid, opts.fields)
  const r = await page.evaluate(RUN, { code: m.code, layout: m.layout, cells: m.cells, uniform: m.uniform, dispatch: m.dispatch, state: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, Array.from(v)])), params: program.params.map((p) => opts.params?.[p] ?? 0), tick: opts.tick ?? 0, seed: opts.seed ?? 0, steps: opts.steps ?? 1 })
  if (r.skip) return null
  assert.ok(!r.errors, `the shader does not compile:\n${r.errors?.join('\n')}\n${m.code}`)
  return Object.fromEntries(Object.entries(r.result as Record<string, number[]>).map(([k, v]) => [k, Float32Array.from(v)]))
}

const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
const life: Formula = ({ alive, age }) => {
  const crowd = alive.neighborSum()
  const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
  return { alive: next, age: next.where(age.add(1), 0) }
}

test.before(async () => {
  if (!chromium) return
  browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage()
  await page.route('http://localhost/**', (r: any) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>gpu</title>' }))
  await page.goto('http://localhost/') // a secure origin, which is what exposes navigator.gpu
  await page.evaluate('window.__name = (f) => f') // the test runner's compiler wraps functions in this helper, which the page does not have
})
test.after(async () => { await browser?.close() })

const skipIf = (t: { skip(m: string): void }) => { if (!chromium) { t.skip('Playwright is not installed'); return true } return false }

test('Life on the GPU matches the interpreter cell for cell over several generations (wrapped and bounded grids)', async (t) => {
  if (skipIf(t)) return
  for (const grid of [{ size: [45, 30, 1], wrap: true }, { size: [33, 21, 1], wrap: false }] as Grid[]) {
    const n = grid.size[0] * grid.size[1]
    const r = lcg(3)
    let state = { alive: Float32Array.from({ length: n }, () => (r() < 0.35 ? 1 : 0)), age: new Float32Array(n) }
    const program = trace(life, ['alive', 'age'], [])
    const got = await gpu(program, grid, state, { steps: 12 })
    if (!got) return t.skip('no WebGPU adapter')
    for (let s = 0; s < 12; s++) state = interpret(program, grid, { state }) as typeof state
    assert.deepEqual(got.alive, state.alive, `alive on ${JSON.stringify(grid)}`)
    assert.deepEqual(got.age, state.age, `age on ${JSON.stringify(grid)}`)
    assert.ok(state.alive.some((v) => v === 1))
  }
})

test('hash, coordinates, tick and parameters come out of the shader exactly as the interpreter makes them', async (t) => {
  if (skipIf(t)) return
  const grid: Grid = { size: [10, 7, 3], wrap: true }
  const program = trace((f, p, k) => ({ h: k.hash('fill'), h0: k.hash(), x: k.x, y: k.y, z: k.z, i: k.index, t: k.tick, lit: k.hash('fill').lt(p.density), mix: k.x.mul(p.gain).add(k.tick) }), [], ['density', 'gain'])
  const params = { density: 0.4, gain: 1.5 }
  const got = await gpu(program, grid, {}, { params, tick: 9, seed: 123456789 })
  if (!got) return t.skip('no WebGPU adapter')
  const want = interpret(program, grid, { state: {}, params, tick: 9, seed: 123456789 })
  const wrong = Object.keys(want).filter((k) => got[k].some((v, i) => v !== want[k][i]))
  assert.deepEqual(wrong, [], `these results differ from the interpreter: ${wrong.map((k) => `${k} gpu ${Array.from(got[k].slice(0, 4))} cpu ${Array.from(want[k].slice(0, 4))}`).join('; ')}`)
})

test('every neighbor and arithmetic operation matches the interpreter on 2D and 3D grids, wrapped and bounded', async (t) => {
  if (skipIf(t)) return
  const OPS = ['add', 'sub', 'mul', 'min', 'max', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'where', 'clamp', 'sum', 'count', 'avg', 'nmax', 'not', 'div'] as const
  const grids: Grid[] = [{ size: [9, 7, 1], wrap: true }, { size: [9, 7, 1], wrap: false }, { size: [5, 4, 3], wrap: true }, { size: [5, 4, 3], wrap: false, neighborhood: 'von-neumann' }]
  for (let trial = 0; trial < 24; trial++) {
    const grid = grids[trial % grids.length]
    const n = grid.size[0] * grid.size[1] * grid.size[2]
    const r = lcg(500 + trial)
    const steps = Array.from({ length: 7 }, () => ({ op: OPS[Math.floor(r() * OPS.length)], a: r(), b: r(), use: Math.floor(r() * 3), num: Math.round((r() * 6 - 3) * 4) / 4 }))
    const formula = ((f: Record<string, any>, p: Record<string, any>) => {
      const pool: any[] = [f.a, f.b]
      for (const s of steps) {
        const x = pool[Math.floor(s.a * pool.length)]
        const y = s.use === 0 ? s.num : s.use === 1 ? p.gain : pool[Math.floor(s.b * pool.length)]
        pool.push(s.op === 'where' ? x.where(y, pool[0]) : s.op === 'clamp' ? x.clamp(-2, 2) : s.op === 'sum' ? x.neighborSum() : s.op === 'count' ? x.neighborCount()
          : s.op === 'avg' ? x.neighborAverage() : s.op === 'nmax' ? x.neighborMax() : s.op === 'not' ? x.not() : x[s.op](y))
      }
      return { out: pool[pool.length - 1] }
    }) as unknown as Formula
    const state = { a: Float32Array.from({ length: n }, () => Math.floor(r() * 3)), b: Float32Array.from({ length: n }, () => r() * 4 - 1) }
    const program = trace(formula, ['a', 'b'], ['gain'])
    const got = await gpu(program, grid, state, { params: { gain: 0.3 } })
    if (!got) return t.skip('no WebGPU adapter')
    const want = interpret(program, grid, { state, params: { gain: 0.3 } }).out
    for (let i = 0; i < n; i++) {
      const g: number = (got.out as Float32Array)[i], w: number = want[i]
      if (!Number.isFinite(g) || !Number.isFinite(w)) continue // infinities and NaN are allowed to differ in sign or kind
      assert.ok(Math.abs(g - w) <= 1e-3 * Math.max(1, Math.abs(w)), `trial ${trial} cell ${i}: gpu ${g}, interpreter ${w} (${steps.map((s) => s.op).join(',')}) on ${JSON.stringify(grid)}`)
    }
  }
})

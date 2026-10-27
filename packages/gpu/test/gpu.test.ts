import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { trace, traceMetrics, interpret, interpretTotals, type Formula, type Grid } from '@breve/stdlib'

// Runs the real backend (bundled for the browser) on a real WebGPU device, a software one in headless Chromium, and compares it with
// the CPU interpreter. Needs Playwright's Chromium and esbuild, which are not dependencies of this package: skipped without them.
const require_ = createRequire(import.meta.url)
let chromium: { launch(o: object): Promise<any> } | undefined
let esbuild: { buildSync(o: object): { outputFiles: { text: string }[] } } | undefined
try { chromium = require_('playwright').chromium; esbuild = require_('esbuild') } catch { /* skipped below */ }

let browser: any, page: any
test.before(async () => {
  if (!chromium || !esbuild) return
  const bundle = esbuild.buildSync({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))], bundle: true, format: 'iife', globalName: 'breveGpu', write: false, target: 'es2022' }).outputFiles[0].text
  browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] })
  page = await browser.newPage()
  await page.route('http://localhost/**', (r: any) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>gpu</title>' }))
  await page.goto('http://localhost/')
  await page.evaluate('window.__name = (f) => f') // the test runner wraps functions in this helper, which the page does not have
  await page.addScriptTag({ content: bundle })
})
test.after(async () => { await browser?.close() })
const skip = (t: { skip(m: string): void }) => { if (!chromium || !esbuild) { t.skip('Playwright or esbuild is not installed'); return true } return false }

// what runs in the page: make a lattice, init it, step it, then read everything back
const RUN = async (a: { grid: Grid; fields: string[]; init: unknown; step: unknown; metrics: unknown; look: unknown; params: Record<string, number>; steps: number; seed: number; window: number[]; size: number[] }) => {
  const backend = await (window as any).breveGpu.loadWebGpu()
  if (!backend) return { skip: true }
  const lat = backend.lattice(a.grid, a.fields)
  const problems = await lat.check([a.init, a.step, a.metrics])
  const run = (tick: number) => ({ params: a.params, tick, seed: a.seed })
  lat.init(a.init, run(0))
  for (let t = 0; t < a.steps; t++) lat.step(a.step, run(t))
  const state = await lat.download()
  const totals = await lat.totals(a.metrics, run(a.steps))
  const whole = await lat.image(a.look, { width: a.grid.size[0], height: a.grid.size[1], window: [0, 0, a.grid.size[0], a.grid.size[1]], background: [0, 0, 1] }, run(a.steps))
  const zoom = await lat.image(a.look, { width: a.size[0], height: a.size[1], window: a.window, background: [0, 0, 1] }, run(a.steps))
  lat.dispose()
  return { problems, state: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, Array.from(v as Float32Array)])), totals, whole: Array.from(whole as Uint8Array), zoom: Array.from(zoom as Uint8Array) }
}

const lifeInit: Formula = (f, p, k) => ({ alive: k.hash('start').lt(p.density), age: 0 })
const lifeStep: Formula = ({ alive, age }) => {
  const crowd = alive.neighborSum()
  const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
  return { alive: next, age: next.where(age.add(1), 0) }
}
const lifeLook: Formula = ({ alive, age }) => {
  const old = age.div(30).clamp(0, 1)
  return { visible: alive, r: old.mul(-0.949).add(1), g: old.mul(0.949).add(0.051), b: 0.051 }
}

test('Life on the graphics card: init, steps, state, totals and a picture all match the CPU interpreter', async (t) => {
  if (skip(t)) return
  for (const wrap of [true, false]) {
    const grid: Grid = { size: [37, 23, 1], wrap }
    const [nx, ny] = grid.size
    const fields = ['alive', 'age']
    const init = trace(lifeInit, [], ['density']), step = trace(lifeStep, fields, ['density']), look = trace(lifeLook, fields, ['density'])
    const { program: metrics } = traceMetrics({ population: ({ cells }) => cells.alive.sum(), meanAge: ({ cells }) => cells.age.average() }, fields)
    const params = { density: 0.3 }, seed = 77, steps = 9
    const got: any = await page.evaluate(RUN, { grid, fields, init, step, metrics, look, params, steps, seed, window: [4, 3, 12, 11], size: [16, 16] })
    if (got.skip) return t.skip('no WebGPU adapter')
    assert.deepEqual(got.problems, [], 'the shaders compile')

    // the CPU's answer
    let state = interpret(init, grid, { state: {}, params, tick: 0, seed }) as Record<string, Float32Array>
    for (let tick = 0; tick < steps; tick++) state = interpret(step, grid, { state, params, tick, seed }) as typeof state
    assert.deepEqual(got.state.alive, Array.from(state.alive), `alive, wrap ${wrap}`)
    assert.deepEqual(got.state.age, Array.from(state.age), `age, wrap ${wrap}`)
    const want = interpretTotals(metrics, grid, { state })
    assert.equal(got.totals.population, want.population)
    assert.ok(Math.abs(got.totals.meanAge - want.meanAge) < 1e-4, `${got.totals.meanAge} vs ${want.meanAge}`)
    assert.ok(want.population > 0)

    // the picture, one pixel to a cell: each pixel is the cell's color, or the background (blue) where it is dead
    const look_ = interpret(look, grid, { state, params, tick: steps, seed })
    const byte = (v: number) => Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5)
    const pixel = (img: number[], i: number) => img.slice(i * 4, i * 4 + 4)
    const expect = (c: number) => (look_.visible[c] !== 0 ? [byte(look_.r[c]), byte(look_.g[c]), byte(look_.b[c]), 255] : [0, 0, 255, 255])
    for (let c = 0; c < nx * ny; c++) {
      const g = pixel(got.whole, c), e = expect(c)
      assert.ok(g.every((v, k) => Math.abs(v - e[k]) <= 1), `pixel of cell ${c}: ${g} vs ${e}`)
    }
    // zoomed in: a window of 8 x 8 cells drawn at 16 x 16 pixels shows each cell as a 2 x 2 block
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      const c = (3 + Math.floor(py / 2)) * nx + 4 + Math.floor(px / 2)
      const g = pixel(got.zoom, py * 16 + px), e = expect(c)
      assert.ok(g.every((v, k) => Math.abs(v - e[k]) <= 1), `zoomed pixel ${px},${py}`)
    }
  }
})

test('a window that reaches past the grid shows the background there', async (t) => {
  if (skip(t)) return
  const grid: Grid = { size: [8, 8, 1], wrap: true }
  const fields = ['alive']
  const init = trace(() => ({ alive: 1 }), [], []), step = trace(({ alive }) => ({ alive }), fields, []), look = trace(({ alive }) => ({ visible: alive, r: 1, g: 0, b: 0 }), fields, [])
  const { program: metrics } = traceMetrics({ n: ({ cells }) => cells.alive.sum() }, fields)
  const got: any = await page.evaluate(RUN, { grid, fields, init, step, metrics, look, params: {}, steps: 1, seed: 1, window: [-4, -4, 4, 4], size: [8, 8] })
  if (got.skip) return t.skip('no WebGPU adapter')
  const at = (x: number, y: number) => got.zoom.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)
  assert.deepEqual(at(0, 0), [0, 0, 255, 255], 'outside the grid is background')
  assert.deepEqual(at(5, 5), [255, 0, 0, 255], 'inside is the cell color')
  assert.equal(got.totals.n, 64)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { hash01, interpret, saltOf, trace } from '@breve/stdlib'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const example = async (id: string, file: string) => (await import(pathToFileURL(new URL(`../../../examples/${id}/${file}`, import.meta.url).pathname).href)) as ScriptModule
const sceneOf = (id: string) => { const p = parseScene(readFileSync(new URL(`../../../examples/${id}/scene.json`, import.meta.url), 'utf8')); assert.ok(p.ok); return p.scene }
const cols = (sim: Sim) => (sim.snapshot().worlds[0] as { table: { cols: Record<string, Float32Array> } }).table.cols

test('a life written as formulas runs the same cells as the whole-field version, tick for tick', async () => {
  const scene = sceneOf('life2d-formula')
  scene.entities[0].lattice!.size = [40, 30, 1]
  const formulas = await example('life2d-formula', 'life.js')
  const n = 40 * 30
  // the same starting cells as the formula's `k.hash('start')`, given to the whole-field version by hand
  const plain: ScriptModule = {
    default: {
      initAll: ({ count }: { count: number }, p: Record<string, number>) => ({ alive: Float32Array.from({ length: count }, (_, i) => (hash01(i, 0, scene.seed, saltOf('start')) < p.density ? 1 : 0)), age: new Float32Array(count) }),
      actAll: (await example('life2d', 'life.js')).default!.actAll,
    },
  }
  const a = new Sim(structuredClone(scene), formulas)
  const b = new Sim(structuredClone(scene), plain)
  assert.deepEqual(cols(a).alive.slice(0, n), cols(b).alive.slice(0, n), 'the same start')
  assert.ok(cols(a).alive.some((v) => v === 1) && cols(a).alive.some((v) => v === 0))
  for (let t = 1; t <= 30; t++) {
    a.step(); b.step()
    assert.deepEqual(cols(a).alive.slice(0, n), cols(b).alive.slice(0, n), `alive differs at tick ${t}`)
    assert.deepEqual(cols(a).age.slice(0, n), cols(b).age.slice(0, n), `age differs at tick ${t}`)
  }
  assert.equal(a.takeErrors().length + b.takeErrors().length, 0)
})

test('a formula run is the same every time, and a forked copy keeps in step', async () => {
  const scene = sceneOf('life2d-formula')
  scene.entities[0].lattice!.size = [32, 32, 1]
  const script = await example('life2d-formula', 'life.js')
  const a = new Sim(structuredClone(scene), script), b = new Sim(structuredClone(scene), script)
  for (let t = 0; t < 20; t++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
  const fork = a.fork()
  for (let t = 0; t < 15; t++) { a.step(); fork.step() }
  assert.equal(fork.hash(), a.hash())
})

test('the formula\'s display gives each living cell a color (young red, old green) and hides the dead', async () => {
  const scene = sceneOf('life2d-formula')
  scene.entities[0].lattice!.size = [16, 16, 1]
  const sim = new Sim(scene, await example('life2d-formula', 'life.js'))
  for (let t = 0; t < 12; t++) sim.step()
  const f = sim.frames()[0] as { lattice: { show: Uint8Array; rgb: Uint8Array | null } }
  const alive = cols(sim).alive
  for (let i = 0; i < 256; i++) assert.equal(f.lattice.show[i], alive[i] ? 1 : 0)
  assert.ok(f.lattice.rgb, 'colors were given')
  const i = alive.findIndex((v) => v === 1)
  assert.ok(f.lattice.rgb![i * 3] > f.lattice.rgb![i * 3 + 1], 'a young cell is more red than green')
})

test('a formula that uses operators instead of expression methods is reported in words, not run', async () => {
  const scene = sceneOf('life2d-formula')
  scene.entities[0].lattice!.size = [8, 8, 1]
  const sim = new Sim(scene, { default: { initFormula: () => ({ alive: 1 }), actFormula: ({ alive }: Record<string, any>) => ({ alive: alive + 1 }) } })
  sim.step()
  const errors = sim.takeErrors().map(String)
  assert.ok(errors.some((m) => /expression has no number/.test(m)), errors.join(' | '))
})

test('a grid too big for the processor path is refused with a reason, and the giant example says it needs WebGPU', async () => {
  const scene = sceneOf('life-giant')
  assert.deepEqual(scene.entities[0].lattice!.size, [4096, 4096, 1])
  const script = await example('life-giant', 'life.js')
  await assert.rejects(Sim.create(scene, script), /graphics card with WebGPU/)
})

test('lattice compute accepts auto and cpu and rejects anything else', async () => {
  const scene = sceneOf('life2d-formula')
  for (const compute of ['auto', 'cpu']) {
    const s = structuredClone(scene); s.entities[0].lattice!.compute = compute as 'auto'
    assert.ok(parseScene(JSON.stringify(s)).ok, compute)
  }
  const bad = structuredClone(scene); (bad.entities[0].lattice as { compute?: string }).compute = 'gpu'
  const r = parseScene(JSON.stringify(bad))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /lattice\.compute/)
})

test('Gray-Scott written as formulas gives the same chemistry as the whole-field version (substeps run the rule several times a tick)', async () => {
  const gpuScene = sceneOf('gray-scott-gpu')
  gpuScene.entities[0].lattice!.size = [48, 48, 1]
  const formulas = await example('gray-scott-gpu', 'gray-scott.js')
  const a = new Sim(structuredClone(gpuScene), formulas) // no backend with `new Sim`: the processor runs the formulas
  const plain = parseScene(readFileSync(new URL('../../../examples/gray-scott/scene.json', import.meta.url), 'utf8'))
  assert.ok(plain.ok)
  plain.scene.entities[0].lattice!.size = [48, 1, 48]
  const start = { u: Float32Array.from(cols(a).u.slice(0, 2304)), v: Float32Array.from(cols(a).v.slice(0, 2304)) }
  assert.ok(start.v.some((x) => x > 0) && start.u.some((x) => x === 1), 'blobs of v on a field of u')
  const original = await example('gray-scott', 'gray-scott.js')
  const b = new Sim(structuredClone(plain.scene), { default: { ...original.default, initAll: () => start }, metrics: original.metrics } as ScriptModule)
  const speed = 4
  for (const sim of [a, b]) { sim.params.speed = speed }
  for (let t = 0; t < 12; t++) { a.step(); b.step() }
  const close = (x: Float32Array, y: Float32Array) => x.every((v, i) => Math.abs(v - y[i]) < 1e-3)
  assert.ok(close(cols(a).u.slice(0, 2304), cols(b).u.slice(0, 2304)), 'u matches')
  assert.ok(close(cols(a).v.slice(0, 2304), cols(b).v.slice(0, 2304)), 'v matches')
  assert.equal(a.takeErrors().length + b.takeErrors().length, 0)
  const before = start.v.reduce((s, v) => s + v, 0), after = cols(a).v.slice(0, 2304).reduce((s, v) => s + v, 0)
  assert.ok(after > before * 0.3, `the chemistry is still going (v ${before.toFixed(1)} -> ${after.toFixed(1)}): the blobs are blobs, not noise`)
})

test('the unary operations and a gradient trace and run', () => {
  const program = trace(({ a }, p, k) => ({ abs: a.abs(), neg: a.neg(), sqrt: a.abs().sqrt(), floor: a.floor(), sin: a.sin(), cos: a.cos(), ...(({ r, g, b }) => ({ r, g, b }))(k.gradient(['#000000', '#ff0000', '#ffffff'], a.abs().mul(0.5))) }), ['a'], [])
  const out = interpret(program, { size: [4, 1, 1], wrap: true }, { state: { a: [-2.5, -0.5, 0.25, 1.75] } })
  assert.deepEqual(Array.from(out.abs), [2.5, 0.5, 0.25, 1.75])
  assert.deepEqual(Array.from(out.neg), [2.5, 0.5, -0.25, -1.75])
  assert.deepEqual(Array.from(out.floor), [-3, -1, 0, 1])
  assert.ok(Math.abs(out.sin[2] - Math.sin(0.25)) < 1e-6 && Math.abs(out.cos[3] - Math.cos(1.75)) < 1e-6)
  assert.deepEqual(Array.from(out.sqrt), Array.from([2.5, 0.5, 0.25, 1.75], (v) => Math.fround(Math.sqrt(v))))
  // a gradient from black through red to white, at |a| * 0.5 = 1.25 (past the end: white), 0.25, 0.125 and 0.875
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-5
  assert.ok(near(out.r[0], 1) && near(out.g[0], 1) && near(out.b[0], 1), 'white past the end')
  assert.ok(near(out.r[1], 0.5) && near(out.g[1], 0), 'half way to red')
  assert.ok(near(out.r[2], 0.25) && near(out.g[2], 0), 'a quarter of the way to red')
  assert.ok(near(out.r[3], 1) && near(out.g[3], 0.75) && near(out.b[3], 0.75), 'three quarters of the way from red to white')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { hash01, saltOf } from '@breve/stdlib'
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

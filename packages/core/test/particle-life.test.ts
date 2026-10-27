import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, withParams, type ScriptModule } from '../src/index'

const load = async () => {
  const p = parseScene(readFileSync(new URL('../../../examples/particle-life/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('../../../examples/particle-life/life.js', import.meta.url).pathname).href)) as ScriptModule
  return { scene: withParams(p.scene, { count: 200 }), script }
}

test('particle life runs without errors, repeats exactly, and a different table gives a different world', async () => {
  const { scene, script } = await load()
  const run = async (s: typeof scene) => { const sim = await Sim.create(structuredClone(s), script); for (let t = 0; t < 150; t++) sim.step(); return sim }
  const a = await run(scene), b = await run(scene), c = await run(withParams(scene, { matrixSeed: 8 }))
  assert.deepEqual(a.takeErrors(), [])
  assert.equal(a.hash(), b.hash())
  assert.notEqual(a.hash(), c.hash())
  assert.ok(Number.isFinite(a.metrics().energy), 'the energy metric is a number')
})

test('the dots stay in the box and keep to the flat plane', async () => {
  const { scene, script } = await load()
  const sim = await Sim.create(scene, script)
  for (let t = 0; t < 300; t++) sim.step()
  const f = sim.frame()
  const size = scene.bounds!.size
  for (let i = 0; i < f.count; i++) {
    assert.ok(Math.abs(f.pos[i * 3]) <= size + 1 && Math.abs(f.pos[i * 3 + 2]) <= size + 1, `dot ${i} is inside`)
    assert.equal(f.pos[i * 3 + 1], 0, 'flat')
  }
})

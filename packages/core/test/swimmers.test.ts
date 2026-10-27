import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const load = async (params: Record<string, number> = {}) => {
  const p = parseScene(readFileSync(new URL('../../../examples/swimmers/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  for (const [k, v] of Object.entries(params)) (p.scene.params[k] as { value: number }).value = v
  p.scene.params.count = { value: 3, min: 1, max: 30, step: 1 }
  const script = (await import(pathToFileURL(new URL('../../../examples/swimmers/swimmer.js', import.meta.url).pathname).href)) as ScriptModule
  return Sim.create(p.scene, script)
}
const run = async (params: Record<string, number>, ticks = 900) => {
  const sim = await load(params)
  const at = () => (sim.worlds[0] as unknown as { handles: { x: number; z: number }[] }).handles.map((h) => [h.x, h.z])
  const start = at()
  for (let t = 0; t < ticks; t++) sim.step()
  assert.deepEqual(sim.takeErrors(), [])
  // net progress, not path length: a waggling head covers ground without going anywhere
  const moved = at().map((e, i) => Math.hypot(e[0] - start[i][0], e[1] - start[i][1])).reduce((a, b) => a + b, 0) / start.length
  const m = { ...sim.metrics(), moved }
  const hash = sim.hash()
  sim.dispose()
  return { ...m, hash }
}

test('the bending wave swims the fish forward through water, and with no drag the same wave goes nowhere', async () => {
  const water = await run({})
  const none = await run({ drag: 0 })
  assert.ok(water.moved > 3, `swam ${water.moved.toFixed(1)} m`)
  assert.ok(none.moved < water.moved / 3, `without drag ${none.moved.toFixed(1)} m vs ${water.moved.toFixed(1)} m`)
})

test('neutral fish hang in the water, heavy ones sink, and a run repeats exactly', async () => {
  const neutral = await run({}), sinking = await run({ buoyancy: 0.85 })
  assert.ok(neutral.depth > 1 && neutral.depth < 2.5, `neutral fish at ${neutral.depth.toFixed(2)} m`)
  assert.ok(sinking.depth < neutral.depth - 0.5, `sinking fish at ${sinking.depth.toFixed(2)} m`)
  assert.equal((await run({})).hash, neutral.hash)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const load = async (params: Record<string, number> = {}) => {
  const p = parseScene(readFileSync(new URL('../../../examples/swimmers/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  for (const k of ['minnows', 'tuna', 'eels']) (p.scene.params[k] as { value: number }).value = 2
  for (const [k, v] of Object.entries(params)) (p.scene.params[k] as { value: number }).value = v
  const script = (await import(pathToFileURL(new URL('../../../examples/swimmers/swimmer.js', import.meta.url).pathname).href)) as ScriptModule
  return Sim.create(p.scene, script)
}
const run = async (params: Record<string, number>, ticks = 900) => {
  const sim = await load(params)
  // where each fish's centre of mass is (the head alone swings about as the body bends and tilts)
  const at = () => sim.worlds.flatMap((w) => {
    const world = w as unknown as { handles: unknown[]; partStates(row: number): Record<string, { mass: number; position: { x: number; z: number } }> }
    return world.handles.map((_, row) => {
      const parts = Object.values(world.partStates(row)), mass = parts.reduce((a, q) => a + q.mass, 0)
      return [parts.reduce((a, q) => a + q.mass * q.position.x, 0) / mass, parts.reduce((a, q) => a + q.mass * q.position.z, 0) / mass]
    })
  })
  const start = at()
  for (let t = 0; t < ticks; t++) sim.step()
  assert.deepEqual(sim.takeErrors(), [])
  // net progress of the centre of mass, not path length: a waggling head covers ground without going anywhere
  const moved = at().map((e, i) => Math.hypot(e[0] - start[i][0], e[1] - start[i][1])).reduce((a, b) => a + b, 0) / start.length
  const m: Record<string, number> = { ...sim.metrics(), moved }
  const hash = sim.hash()
  sim.dispose()
  return { ...m, hash } as Record<string, number> & { hash: string }
}

test('the bending wave swims the fish forward through water, and with no drag the same wave goes nowhere', async () => {
  // (at one fixed depth, so nothing touches the floor: a fish that scrapes along the bottom can push off it)
  const minnows = { depthRange: 0, minnows: 4, tuna: 0, eels: 0 }
  const water = await run(minnows)
  const none = await run({ ...minnows, drag: 0 })
  assert.ok(water.moved > 2, `swam ${water.moved.toFixed(1)} m`)
  assert.ok(none.moved < water.moved / 2, `without drag ${none.moved.toFixed(1)} m vs ${water.moved.toFixed(1)} m`)
})

test('neutral fish hang in the water, fish that are too heavy sink, and a run repeats exactly', async () => {
  const neutral = await run({}), sinking = await run({ buoyancy: 0.85 })
  assert.ok(neutral.depth > 1 && neutral.depth < 2.5, `neutral fish at ${neutral.depth.toFixed(2)} m`)
  assert.ok(sinking.depth < neutral.depth - 0.5, `sinking fish at ${sinking.depth.toFixed(2)} m`)
  assert.equal((await run({})).hash, neutral.hash)
})

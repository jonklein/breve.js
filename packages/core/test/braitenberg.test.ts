import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const load = async () => {
  const p = parseScene(readFileSync(new URL('../../../examples/braitenberg/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('../../../examples/braitenberg/vehicles.js', import.meta.url).pathname).href)) as ScriptModule
  return { scene: p.scene, script }
}

test('the wirings give the carts different characters: one that swerves away from lights stays farther from them than one that slows as it nears', async () => {
  const { scene, script } = await load()
  const sim = await Sim.create(scene, script)
  const seen: Record<string, number[]> = {}
  for (let t = 0; t <= 3600; t++) {
    if (t >= 1200 && t % 120 === 0) for (const [k, v] of Object.entries(sim.metrics())) (seen[k] ??= []).push(v)
    sim.step()
  }
  const mean = (k: string) => seen[k].reduce((a, b) => a + b, 0) / seen[k].length
  assert.deepEqual(sim.takeErrors(), [])
  assert.ok(mean('fear') > mean('love') + 1, `fear ${mean('fear').toFixed(1)} m, love ${mean('love').toFixed(1)} m`)
  assert.ok(mean('fear') > mean('explorer') + 1, `fear ${mean('fear').toFixed(1)} m, explorer ${mean('explorer').toFixed(1)} m`)
})

test('the carts really drive: wheels on the floor turn motor commands into motion, and a run repeats exactly', async () => {
  const { scene, script } = await load()
  const run = async () => {
    const sim = await Sim.create(structuredClone(scene), script)
    const start = (sim.worlds[0] as unknown as { handles: { x: number; z: number }[] }).handles.map((h) => [h.x, h.z])
    for (let t = 0; t < 600; t++) sim.step()
    const end = (sim.worlds[0] as unknown as { handles: { x: number; z: number }[] }).handles.map((h) => [h.x, h.z])
    return { sim, moved: end.map((e, i) => Math.hypot(e[0] - start[i][0], e[1] - start[i][1])) }
  }
  const a = await run(), b = await run()
  assert.ok(a.moved.filter((d) => d > 1).length >= 5, `most carts moved: ${a.moved.map((d) => d.toFixed(1)).join(', ')} m`)
  assert.equal(a.sim.hash(), b.sim.hash(), 'the same seed gives the same run')
})

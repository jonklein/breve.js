import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { trace, interpret, type Formula } from '@breve/stdlib'
import { Sim, parseScene, type ScriptModule } from '../src/index'

// The life2d example's own rule, written for whole fields, is also a formula: run once on expressions it gives a program,
// and the program must give the same cells as the engine's CPU path, tick after tick.
test('life2d traced as a formula and interpreted matches the engine running the same rule, tick for tick', async () => {
  const parsed = parseScene(readFileSync(new URL('../../../examples/life2d/scene.json', import.meta.url), 'utf8'))
  assert.ok(parsed.ok)
  parsed.scene.entities[0].lattice!.size = [48, 40, 1]
  const script = (await import(pathToFileURL(new URL('../../../examples/life2d/life.js', import.meta.url).pathname).href)) as ScriptModule
  const sim = new Sim(structuredClone(parsed.scene), script)
  const cols = () => (sim.snapshot().worlds[0] as { table: { cols: Record<string, Float32Array> } }).table.cols

  const program = trace(script.default!.actAll as unknown as Formula, ['alive', 'age'], [])
  const grid = { size: parsed.scene.entities[0].lattice!.size, wrap: true }
  let state = { alive: Float32Array.from(cols().alive), age: Float32Array.from(cols().age) }
  for (let t = 1; t <= 30; t++) {
    sim.step()
    state = interpret(program, grid, { state, tick: t - 1, seed: parsed.scene.seed }) as typeof state
    assert.deepEqual(state.alive, cols().alive.slice(0, 48 * 40), `alive diverged at tick ${t}`)
    assert.deepEqual(state.age, cols().age.slice(0, 48 * 40), `age diverged at tick ${t}`)
  }
  assert.ok(state.alive.some((v) => v === 1), 'something is still alive')
  assert.equal(sim.takeErrors().length, 0)
})

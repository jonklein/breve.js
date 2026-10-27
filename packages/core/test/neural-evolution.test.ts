import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ParentRun, parentOf, parseScene, withParams, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/neural/', import.meta.url)

async function load() {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('brain.js', dir).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script }
}

const small = { population: 10, ticks: 200, keep: 2, team: 6 }

async function evolve(generations: number) {
  const { scene, script } = await load()
  const r = new ParentRun(parentOf(script)!, withParams(scene, small), script)
  await r.start()
  const means: number[] = []
  let gen = 1
  for (let t = 0; t < generations * small.ticks; t++) {
    await r.step()
    const g = Number(/^generation (\d+)/.exec(r.status())?.[1])
    if (g !== gen) { gen = g; means.push(Number(/average ([\d.]+)/.exec(r.status())?.[1])) }
  }
  const errors = [...r.group.sims.values()].flatMap((s) => s.takeErrors())
  return { r, means, errors }
}

test('neural: a population runs as tiles, the goal moves, and the same seed evolves the same brains', async () => {
  const a = await evolve(2), b = await evolve(2)
  assert.deepEqual(a.errors, [])
  assert.equal(a.r.group.sims.size, small.population)
  assert.equal(a.r.group.hash(), b.r.group.hash())
  assert.equal(a.r.status(), b.r.status())
  const first = [...a.r.group.sims.values()][0]
  assert.equal(first.metrics().near >= 0, true)
  a.r.dispose(); b.r.dispose()
})

test('neural: evolution makes the crowds home in on the goal (the average score rises)', async () => {
  const { r, means, errors } = await evolve(14)
  assert.deepEqual(errors, [])
  const early = means.slice(0, 2).reduce((x, y) => x + y, 0) / 2
  const late = means.slice(-3).reduce((x, y) => x + y, 0) / 3
  assert.ok(late > early + 0.05, `average score went from ${early.toFixed(3)} to ${late.toFixed(3)}: ${means.map((m) => m.toFixed(2)).join(' ')}`)
  r.dispose()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/herding/', import.meta.url)
const load = async () => {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('herding.js', dir).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script }
}

test('the dog runs where the keys say, sheep flee it, and the metrics work', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  const dog = s.tableOf('dog').cols as Record<string, Float32Array>
  const x0 = dog.px[0]
  s.setInput(['d'])
  for (let i = 0; i < 240; i++) s.step()
  s.setInput([])
  for (let i = 0; i < 120; i++) s.step()
  assert.ok(dog.px[0] > x0 + 10, `dog moved ${dog.px[0] - x0}`)
  assert.ok(Math.abs(dog.pz[0]) < 1, 'and stayed on its line')
  assert.equal(s.takeErrors().length, 0, s.takeErrors().join('\n'))
  const m = s.metrics()
  assert.ok(Number.isFinite(m.together) && m.together > 0)
  assert.ok(Number.isInteger(m.penned))
  assert.deepEqual(s.nondeterministic(), ['dog'])
})

test('without anyone at the keyboard the run is repeatable', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script), b = new Sim(scene, script)
  for (let i = 0; i < 200; i++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
})

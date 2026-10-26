import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ParentRun, Rng, parentOf, parseScene, withParams, type Scene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/evolved-creatures/', import.meta.url)

async function load() {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('creatures.js', dir).pathname).href)) as ScriptModule & Record<string, any>
  return { scene: p.ok ? p.scene : (null as never), script }
}

const normalOf = (r: Rng) => () => Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next())
const tiny = (scene: Scene): Scene => withParams(scene, { population: 4, ticks: 150, keep: 2 })

test('every genome the example can make is a valid body, and mutation and crossover keep it valid', async () => {
  const { scene, script } = await load()
  const r = new Rng(3), normal = normalOf(r)
  let g = script.randomGenome(() => r.next(), normal)
  for (let i = 0; i < 60; i++) {
    const other = script.randomGenome(() => r.next(), normal)
    g = script.mutate(r.next() < 0.5 ? g : script.crossover(g, other, () => r.next()), 1, () => r.next(), normal)
    const s = structuredClone(scene)
    s.entities[0].body = script.bodyOf(g)
    s.data = { genome: g }
    const parsed = parseScene(JSON.stringify(s))
    assert.ok(parsed.ok, parsed.ok ? '' : `genome ${i}: ${parsed.errors.join('\n')}`)
    assert.ok(g.pairs[0].on, 'the first pair of limbs is never switched off by mutation')
  }
})

test('a population runs as sub-simulations side by side, and the same seed evolves the same creatures', async () => {
  const { scene, script } = await load()
  const run = async () => {
    const r = new ParentRun(parentOf(script)!, tiny(scene), script)
    await r.start()
    assert.equal(r.group.sims.size, 4, 'one sub-sim per creature')
    for (let t = 0; t < 300; t++) await r.step() // two generations
    const errors = [...r.group.sims.values()].flatMap((s) => s.takeErrors())
    assert.deepEqual(errors, [])
    return r
  }
  const a = await run(), b = await run()
  assert.match(a.status(), /^generation 3 /)
  assert.equal(a.group.hash(), b.group.hash())
  assert.equal(a.status(), b.status())
  a.dispose(); b.dispose()
})

test('the best walker of each generation is kept, so the best score never goes down', async () => {
  const { scene, script } = await load()
  const r = new ParentRun(parentOf(script)!, tiny(scene), script)
  await r.start()
  const best: number[] = []
  for (let t = 0; t < 600; t++) {
    await r.step()
    const m = r.status().match(/last best ([\d.]+)/)
    if (m && r.tick % 150 === 0) best.push(+m[1])
  }
  assert.equal(best.length, 4)
  for (let i = 1; i < best.length; i++) assert.ok(best[i] >= best[i - 1] - 1e-6, `generation ${i + 1}: ${best.join(' → ')}`)
  r.dispose()
})

test('a scene hands its scripts structured data as ctx.data, and the schema accepts it', async () => {
  const { Sim } = await import('../src/index')
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 5 }, data: { genome: { a: [1, 2, 3] } }, entities: [{ name: 'a', count: 1 }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  let seen: unknown
  const sim = new Sim(r.ok ? r.scene : (null as never), { default: { act: (_o, _p, ctx) => { seen = ctx.data } } })
  sim.step()
  assert.deepEqual(seen, { genome: { a: [1, 2, 3] } })
  assert.equal(parseScene(JSON.stringify({ seed: 1, params: {}, data: 5, entities: [], metrics: [] })).ok, false)
})

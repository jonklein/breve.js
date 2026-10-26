import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeDims, mutate, crossover, randomGenome, SearchRng } from '../src/index'
import type { Scene } from '@breve/core'

const scene = { seed: 1, bounds: { size: 10 }, entities: [], params: {
  leg: { value: 0.5, min: 0.2, max: 1.2 },
  legs: { value: 4, min: 2, max: 8, step: 2 },
  gait: { value: 1, min: 0, max: 3 },
} } as unknown as Scene
const dims = makeDims(['leg', 'legs', 'gait'], scene)

test('mutation stays inside the annotated ranges and steps, and is repeatable from a seed', () => {
  const run = () => {
    const rng = new SearchRng(7)
    let g: Record<string, number> = { leg: 0.5, legs: 4, gait: 1 }
    const seen = new Set<number>()
    for (let i = 0; i < 300; i++) {
      g = mutate(g, dims, rng, { rate: 1, sigma: 0.4 })
      assert.ok(g.leg >= 0.2 && g.leg <= 1.2 && g.gait >= 0 && g.gait <= 3, JSON.stringify(g))
      assert.ok([2, 4, 6, 8].includes(g.legs), `legs ${g.legs} is not a step of the param`)
      seen.add(g.legs)
    }
    assert.ok(seen.size > 1, 'a stepped param should move')
    return g
  }
  assert.deepEqual(run(), run())
})

test('mutation always changes a stepped param it was told to change, and leaves the others when rate is 0', () => {
  const rng = new SearchRng(3)
  for (let i = 0; i < 50; i++) assert.notEqual(mutate({ leg: 0.5, legs: 4, gait: 1 }, [dims[1]], rng, { rate: 1, sigma: 0.01 }).legs, 4)
  assert.deepEqual(mutate({ leg: 0.5, legs: 4, gait: 1 }, dims, rng, { rate: 0 }), { leg: 0.5, legs: 4, gait: 1 })
})

test('crossover mixes parents and a blend stays between them', () => {
  const rng = new SearchRng(5)
  const a = { leg: 0.3, legs: 2, gait: 0.5 }
  const b = { leg: 1.1, legs: 8, gait: 2.5 }
  for (let i = 0; i < 100; i++) {
    const u = crossover(a, b, dims, rng)
    for (const d of dims) assert.ok(u[d.name] === a[d.name as keyof typeof a] || u[d.name] === b[d.name as keyof typeof b])
    const m = crossover(a, b, dims, rng, 'blend')
    assert.ok(m.leg >= 0.3 - 1e-9 && m.leg <= 1.1 + 1e-9 && [2, 4, 6, 8].includes(m.legs))
  }
  const r = randomGenome(dims, rng)
  assert.ok(r.leg >= 0.2 && r.leg <= 1.2)
})

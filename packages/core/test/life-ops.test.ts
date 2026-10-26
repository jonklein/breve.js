import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

// the same rule written with a closure per cell (the way it used to be) and with whole-field operations
const withClosures: ScriptModule = {
  default: {
    update: ({ alive, age }: Record<string, any>) => {
      const crowd = alive.neighborSum()
      const next = alive.zip(crowd, (a: number, n: number) => ((a ? n === 2 || n === 3 : n === 3) ? 1 : 0))
      return { alive: next, age: next.zip(age, (now: number, old: number) => (now ? old + 1 : 0)) }
    },
  },
}

test('life written with field operations matches life written with a closure per cell, tick for tick', async () => {
  const p = parseScene(readFileSync(new URL('../../../examples/life2d/scene.json', import.meta.url), 'utf8'))
  assert.ok(p.ok)
  p.scene.entities[0].lattice!.size = [64, 64, 1]
  const ops = (await import(pathToFileURL(new URL('../../../examples/life2d/life.js', import.meta.url).pathname).href)) as ScriptModule
  withClosures.default!.initAll = ops.default!.initAll // the same starting cells
  const a = new Sim(structuredClone(p.scene), withClosures)
  const b = new Sim(structuredClone(p.scene), ops)
  for (let t = 0; t < 40; t++) {
    a.step(); b.step()
    assert.equal(b.hash(), a.hash(), `diverged at tick ${t + 1}`)
  }
  assert.equal(a.takeErrors().length + b.takeErrors().length, 0)
  assert.ok((b.metrics().population as number) > 0, 'something is still alive')
})

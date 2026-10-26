import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const scene = (topology: string, n: number) => {
  const r = parseScene(JSON.stringify({
    seed: 3, params: {}, bounds: { size: 10 },
    entities: [{ name: 'n', count: n, network: { topology, degree: 4, layout: 'circle' } }],
    metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

// one rule, written two ways: each node moves a quarter of the way toward its neighbors' average
const init = ({ index }: { index: number }) => ({ heat: index === 0 ? 100 : 0 }) // one hot node
const perNode: ScriptModule = { default: { init, act: ({ self, neighbors }) => ({ heat: self.heat + 0.25 * (neighbors.heat.average() - self.heat) }) } }
const wholeNetwork: ScriptModule = { default: { init, actAll: ({ heat }) => ({ heat: heat.zip(heat.neighborAverage(), (h: number, avg: number) => h + 0.25 * (avg - h)) }) } }

test('a whole-network update gives the same result as the same rule written per node', () => {
  const heat = (s: Sim) => Array.from(s.worlds[0].table.cols.heat as Float64Array).slice(0, 12)
  const a = new Sim(scene('ring', 12), perNode)
  const b = new Sim(scene('ring', 12), wholeNetwork)
  for (let i = 0; i < 30; i++) { a.step(); b.step() }
  assert.equal(a.takeErrors().length + b.takeErrors().length, 0, [...a.takeErrors(), ...b.takeErrors()].join('\n'))
  heat(a).forEach((v, i) => assert.ok(Math.abs(v - heat(b)[i]) < 1e-3, `node ${i}: ${v} vs ${heat(b)[i]}`))
  assert.ok(heat(b).every((v) => v > 0), 'the heat has spread all the way around')
})

test('whole-network fields cope with hubs: a complete graph of 300 nodes has 299 neighbors each', () => {
  const sim = new Sim(scene('complete', 300), { default: { init, actAll: ({ heat }) => ({ heat: heat.neighborSum() }) } })
  sim.step()
  assert.equal(sim.takeErrors().length, 0)
  const h = sim.worlds[0].table.cols.heat as Float64Array
  // the one hot node has only cold neighbors; everyone else sums to its 100
  const values = Array.from(h).slice(0, 300)
  assert.equal(values.filter((v) => v === 0).length, 1)
  assert.equal(values.filter((v) => v === 100).length, 299)
})

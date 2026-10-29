import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'
import { adjacency, makeEdges } from '../src/graph'
import { Rng } from '../src/rng'

const load = async (dir: string, scene = 'scene.json', script = 'contagion.js') => {
  const base = new URL(`../../../examples/${dir}/`, import.meta.url)
  const p = parseScene(readFileSync(new URL(scene, base), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const mod = (await import(pathToFileURL(new URL(script, base).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script: mod }
}

test('graph generators make the right kind of graph', () => {
  const n = 200
  const deg = (edges: [number, number][]) => { const a = adjacency(n, edges); return Array.from({ length: n }, (_, i) => a.offsets[i + 1] - a.offsets[i]) }
  const ring = makeEdges({ topology: 'ring', degree: 4 }, n, new Rng(1))
  assert.ok(deg(ring).every((d) => d === 4))
  const sw = makeEdges({ topology: 'smallworld', degree: 6, rewire: 0.1 }, n, new Rng(1))
  assert.equal(sw.length, 600)
  assert.equal(new Set(sw.map((e) => e.join())).size, 600, 'no repeated links')
  assert.ok(sw.every(([a, b]) => a !== b))
  const sf = deg(makeEdges({ topology: 'scalefree', degree: 4 }, n, new Rng(1)))
  assert.ok(Math.max(...sf) > 3 * (sf.reduce((a, b) => a + b, 0) / n), 'a few hubs have many more links than average')
  const er = makeEdges({ topology: 'random', degree: 4 }, n, new Rng(1))
  assert.ok(Math.abs(er.length * 2 / n - 4) < 1)
  assert.equal(makeEdges({ topology: 'complete' }, 10, new Rng(1)).length, 45)
  assert.deepEqual(makeEdges({ topology: 'edges', edges: [[0, 1], [1, 0], [2, 2], [1, 9]] }, 3, new Rng(1)), [[0, 1]])
  assert.deepEqual(makeEdges({ topology: 'smallworld', degree: 6 }, n, new Rng(7)), makeEdges({ topology: 'smallworld', degree: 6 }, n, new Rng(7)))
})

test('an epidemic runs through a network: infected rises then falls, everyone ends susceptible or recovered', async () => {
  const { scene, script } = await load('epidemic')
  const sim = new Sim(scene, script)
  let peak = 0
  for (let t = 0; t < 400; t++) { sim.step(); peak = Math.max(peak, sim.metrics().infected) }
  const m = sim.metrics()
  assert.equal(sim.takeErrors().length, 0)
  assert.ok(peak > 100, `peak ${peak}`)
  assert.equal(m.infected, 0)
  assert.equal(m.susceptible + m.infected + m.recovered, scene.entities[0].count)
  assert.ok(m.recovered > 500)
})

test('the very same script file runs on a network and on a grid', async () => {
  const net = await load('epidemic')
  const grid = await load('epidemic-grid', 'scene.json', '../epidemic/contagion.js')
  assert.equal(net.scene.entities[0].controller, 'contagion.js')
  assert.equal(grid.scene.entities[0].controller, '../epidemic/contagion.js')
  assert.equal(net.script.default, grid.script.default, 'one module, two worlds')
  const sim = new Sim(grid.scene, grid.script)
  let peak = 0
  for (let t = 0; t < 300; t++) { sim.step(); peak = Math.max(peak, sim.metrics().infected) }
  assert.equal(sim.takeErrors().length, 0)
  assert.ok(peak > 10 && sim.metrics().recovered > 30, `peak ${peak}, recovered ${sim.metrics().recovered}`)
})

test('network runs are repeatable and can be forked and snapshotted', async () => {
  const { scene, script } = await load('epidemic')
  const a = new Sim(scene, script), b = new Sim(scene, script)
  for (let t = 0; t < 60; t++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
  const f = a.fork()
  for (let t = 0; t < 60; t++) { a.step(); f.step() }
  assert.equal(a.hash(), f.hash())
})

test('exchange moves things between linked nodes whole or not at all, and never overdraws', () => {
  const r = parseScene(JSON.stringify({
    seed: 3, params: {}, entities: [{ name: 'p', count: 2, network: { topology: 'edges', edges: [[0, 1]], layout: 'circle' } }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const sim = new Sim(r.ok ? r.scene : (null as never), {
    default: {
      // node 0 buys goods from node 1 at 4 cash each, but node 1 has none; then node 1 buys from 0 (also none)
      init: () => ({ cash: 10, goods: 0 }),
      act: ({ self, neighbors }) => (self.row === 0 ? { exchange: [{ with: neighbors[0], give: { cash: 4 }, get: { goods: 1 } }] } : {}),
    },
  })
  sim.step()
  const c = sim.table.cols as Record<string, Float64Array>
  assert.deepEqual([c.cash[0], c.cash[1], c.goods[0], c.goods[1]], [10, 10, 0, 0], 'the seller had no goods: nothing moved')
  c.goods[1] = 1
  sim.step()
  assert.deepEqual([c.cash[0], c.cash[1], c.goods[0], c.goods[1]], [6, 14, 1, 0])
  for (let i = 0; i < 5; i++) sim.step()
  assert.equal(c.cash[0] + c.cash[1], 20, 'cash is conserved')
  assert.ok(c.cash[0] >= 0 && c.goods[1] >= 0)
})

test('market example: trades happen, prices move, and trades alone never create cash', async () => {
  const { scene, script } = await load('market', 'scene.json', 'market.js')
  scene.params.wages = 0
  scene.params.costs = 0 // with no wages or costs the only thing that moves cash is trades
  const sim = new Sim(scene, script)
  const total = () => (sim.table.cols.cash as Float64Array).reduce((a, b) => a + b, 0)
  const start = total()
  for (let t = 0; t < 600; t++) sim.step()
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  assert.ok(Math.abs(total() - start) < 1e-6, `cash ${total()} vs ${start}`)
  assert.ok(Array.from(sim.table.cols.bought as Float64Array).reduce((a, b) => a + b, 0) > 20, 'trading happened')
  assert.ok(Array.from(sim.table.cols.ask as Float64Array).some((a) => a !== 10), 'prices moved')
})

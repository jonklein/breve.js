import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/life2d/', import.meta.url)
const load = async () => {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('life.js', dir).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script }
}

test('a glider on a flat wrapped grid moves one cell diagonally every 4 ticks', async () => {
  const { scene, script } = await load()
  scene.entities[0].lattice!.size = [12, 12, 1]
  delete scene.entities[0].fill
  const sim = new Sim(scene, script)
  const alive = sim.table.cols.alive
  for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) alive[x + 12 * y] = 1
  for (let i = 0; i < 4; i++) sim.step()
  const cells = [...alive].map((v, i) => (v ? [i % 12, Math.floor(i / 12)] : null)).filter(Boolean)
  assert.deepEqual(cells.sort().map(String), [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]].sort().map(String))
  assert.equal(sim.takeErrors().length, 0)
})

test('a whole-grid rule gives the same result as a per-cell rule', async () => {
  const { scene, script } = await load()
  scene.entities[0].lattice!.size = [20, 20, 1]
  const perCell: ScriptModule = {
    default: { decide: ({ self, neighbors }) => { const n = neighbors.alive.sum(); return { alive: (self.alive ? n === 2 || n === 3 : n === 3) ? 1 : 0, age: 0 } } },
  }
  const a = new Sim(scene, script)
  const b = new Sim(scene, perCell)
  for (let i = 0; i < 30; i++) { a.step(); b.step() }
  assert.deepEqual([...a.table.cols.alive], [...b.table.cols.alive])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule, type Scene } from '../src/index'

const dir = new URL('../../../examples/life3d/', import.meta.url)

async function load() {
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('life.js', dir).pathname).href)) as ScriptModule
  return { scene: parsed.ok ? parsed.scene : (null as never), script }
}

/** A small empty grid with hard edges, so tests can place cells by hand. */
function small(scene: Scene, n = 5): Scene {
  const s = structuredClone(scene)
  s.entities[0].lattice!.size = [n, n, n]
  s.entities[0].lattice!.edges = 'dead'
  s.entities[0].fill = undefined
  return s
}

const at = (n: number, x: number, y: number, z: number) => x + n * (y + n * z)

/** Make `count` of the centre cell's neighbors alive. */
function surround(s: Sim, count: number, n = 5) {
  const around = [[1, 1, 1], [1, 1, 2], [1, 1, 3], [1, 2, 1], [1, 2, 2], [1, 2, 3], [1, 3, 1]]
  for (const [x, y, z] of around.slice(0, count)) s.table.cols.alive[at(n, x, y, z)] = 1
}

test('the example scene is valid and builds a 20x20x20 wrapping lattice', async () => {
  const { scene, script } = await load()
  assert.equal(scene.entities[0].lattice!.edges, 'wrap')
  const s = new Sim(scene, script)
  assert.equal(s.table.size, 20 * 20 * 20)
  const pop = s.metrics().population
  assert.ok(pop > 1000 && pop < 2200, `about 20% of 8000 cells start alive, got ${pop}`)
})

test('life is deterministic', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script)
  const b = new Sim(scene, script)
  for (let i = 0; i < 5; i++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
})

test('a dead cell is born with exactly 5 live neighbors, not 4 or 6', async () => {
  const { scene, script } = await load()
  for (const [count, expected] of [[4, 0], [5, 1], [6, 0]]) {
    const s = new Sim(small(scene), script)
    surround(s, count)
    s.step()
    assert.equal(s.table.cols.alive[at(5, 2, 2, 2)], expected, `${count} neighbors`)
  }
})

test('a living cell survives with 4 or 5 neighbors, and dies with 3, 6 or 7', async () => {
  const { scene, script } = await load()
  for (const [count, expected] of [[3, 0], [4, 1], [5, 1], [6, 0], [7, 0]]) {
    const s = new Sim(small(scene), script)
    s.table.cols.alive[at(5, 2, 2, 2)] = 1
    surround(s, count)
    s.step()
    assert.equal(s.table.cols.alive[at(5, 2, 2, 2)], expected, `${count} neighbors`)
  }
})

test('cells that keep surviving get older, and a newborn starts at age 0', async () => {
  const { scene, script } = await load()
  const s = new Sim(small(scene), script)
  s.table.cols.alive[at(5, 2, 2, 2)] = 1
  surround(s, 4)
  // pin the neighbors in place by keeping them in a state that survives: just check the first tick
  s.step()
  assert.equal(s.table.cols.age[at(5, 2, 2, 2)], 1, 'survivor aged')
  const fresh = new Sim(small(scene), script)
  surround(fresh, 5)
  fresh.step()
  assert.equal(fresh.table.cols.age[at(5, 2, 2, 2)], 0, 'newborn')
})

test('writing to a cell inside act() explains what to do instead', async () => {
  const { scene } = await load()
  const bad: ScriptModule = { default: { act({ self }: { self: { alive: number } }) { self.alive = 1 } } }
  const s = new Sim(small(scene), bad)
  s.step()
  assert.match(s.takeErrors()[0], /read-only inside act\(\)/)
})

test('wrap makes edge cells neighbors of the opposite edge', async () => {
  const { scene } = await load()
  const sc = small(scene, 3)
  sc.entities[0].lattice!.edges = 'wrap'
  let seen = -1
  const spy: ScriptModule = { default: { act({ self, neighbors }: { self: { x: number; y: number; z: number }; neighbors: { length: number } }) { if (self.x === 0 && self.y === 0 && self.z === 0) seen = neighbors.length } } }
  new Sim(sc, spy).step()
  assert.equal(seen, 26)
  sc.entities[0].lattice!.edges = 'dead'
  new Sim(sc, spy).step()
  assert.equal(seen, 7)
})

test('a lattice scene needs a valid show field', async () => {
  const { scene } = await load()
  const bad = structuredClone(scene)
  bad.entities[0].lattice!.show = 'missing'
  const r = parseScene(JSON.stringify(bad))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /"missing" is not a state field/)
})

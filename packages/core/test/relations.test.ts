import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Table, Relation, Relations } from '../src/index'

test('object columns hold free-form values, snapshot by value, and hash independent of key order', () => {
  const t = new Table({ x: 'f64', memory: 'obj' }, 2)
  const a = t.spawn()
  const b = t.spawn()
  const mem = t.cols.memory as unknown as unknown[]
  mem[t.row(a)] = { seen: [1, 2], mood: 'calm' }
  assert.equal(mem[t.row(b)], null)
  const snap = t.snapshot()
  ;(mem[t.row(a)] as { seen: number[] }).seen.push(3)
  t.restore(snap)
  assert.deepEqual((t.cols.memory as unknown as { seen: number[] }[])[t.row(a)].seen, [1, 2])

  const u = new Table({ memory: 'obj' }, 2)
  const v = new Table({ memory: 'obj' }, 2)
  u.spawn(); v.spawn()
  ;(u.cols.memory as unknown as unknown[])[0] = { a: 1, b: 2 }
  ;(v.cols.memory as unknown as unknown[])[0] = { b: 2, a: 1 }
  assert.equal(u.hash(), v.hash())
  ;(v.cols.memory as unknown as unknown[])[0] = { b: 3, a: 1 }
  assert.notEqual(u.hash(), v.hash())
})

test('relations: directed edges with attributes, neighbors both ways, removal', () => {
  const nodes = new Table({ x: 'f64' })
  const [a, b, c] = [nodes.spawn(), nodes.spawn(), nodes.spawn()]
  const r = new Relation('trades_with', { weight: 'f64' })
  const ab = r.add(a, b, { weight: 2 })
  r.add(a, c, { weight: 5 })
  r.add(c, a, { weight: 1 })
  assert.deepEqual(r.targets(a), [b, c])
  assert.deepEqual(r.sources(a), [c])
  assert.equal(r.attr(ab, 'weight'), 2)
  assert.ok(r.has(a, b) && !r.has(b, a))
  assert.equal(r.removeBetween(a, b), 1)
  assert.deepEqual(r.targets(a), [c])
  assert.equal(r.removeEntity(a), 2)
  assert.equal(r.size, 0)
  r.add(b, c, {}, true)
  assert.ok(r.has(b, c) && r.has(c, b))
})

test('relations snapshot, restore and hash like any other state', () => {
  const rs = new Relations()
  const r = rs.get('follows', { since: 'i32' })
  r.add(1, 2, { since: 5 })
  r.add(2, 3, { since: 6 })
  const snap = rs.snapshot()
  const h = rs.hash()
  r.add(3, 1)
  r.remove(r.outEdges(1)[0])
  assert.notEqual(rs.hash(), h)
  rs.restore(snap)
  assert.equal(rs.hash(), h)
  assert.deepEqual(rs.get('follows').targets(1), [2])
  assert.equal(rs.get('follows').attr(rs.get('follows').outEdges(2)[0], 'since'), 6)
  const fresh = new Relations() // a fork never declared the relation
  fresh.restore(snap)
  assert.equal(fresh.hash(), h)
})

test('a sim owns its relations: they fork, restore and show up in the hash', async () => {
  const { Sim, parseScene } = await import('../src/index')
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 5 }, entities: [{ name: 'a', count: 3 }], metrics: [] }))
  assert.ok(r.ok)
  const sim = new Sim(r.scene)
  const h0 = sim.hash()
  sim.relations.get('knows', { trust: 'f64' }).add(1, 2, { trust: 0.5 })
  assert.notEqual(sim.hash(), h0)
  const copy = sim.fork()
  assert.equal(copy.hash(), sim.hash())
  copy.relations.get('knows').add(2, 1)
  assert.equal(sim.relations.get('knows').size, 1)
  sim.restore(copy.snapshot())
  assert.equal(sim.relations.get('knows').size, 2)
})

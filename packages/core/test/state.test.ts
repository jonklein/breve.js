import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Table } from '../src/index'
import { Mlp } from '../src/nn'

test('strided columns hold an array per row, and move whole on despawn, snapshot and restore', () => {
  const t = new Table({ w: 'f32', n: 'i32' }, 2, { w: 3 })
  const ids = [0, 1, 2, 3].map(() => t.spawn()) // forces a grow past capacity 2
  ;(t.cols.w as Float32Array).set([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])
  const snap = t.snapshot()
  t.despawn(ids[0])
  assert.deepEqual(Array.from((t.cols.w as Float32Array).slice(0, 9)), [4, 4, 4, 2, 2, 2, 3, 3, 3])
  t.restore(snap)
  assert.equal(t.size, 4)
  assert.deepEqual(Array.from((t.cols.w as Float32Array).slice(0, 12)), [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])
  assert.equal(t.row(ids[0]), 0)
})

test('mlp: counts weights, checks sizes, and computes a known case', () => {
  const net = new Mlp([2, 3, 1])
  assert.equal(net.weightCount, 2 * 3 + 3 + 3 * 1 + 1)
  assert.throws(() => net.run([1, 2], [0, 0]), /needs 13 weights/)
  const one = new Mlp([1, 1])
  assert.ok(Math.abs(one.run([2, 0.5], [1])[0] - Math.tanh(2.5)) < 1e-12)
  assert.throws(() => new Mlp([3]), /at least two/)
})

test('state types are inferred from what a field starts as', async () => {
  const { stateFields, Sim, parseScene } = await import('../src/index')
  const f = Object.fromEntries(stateFields({ energy: 10, hungry: false, mood: 'calm', n: 'int', w: { length: 3, init: 1 }, label: { type: 'string', init: 'x' } }).map((x) => [x.name, x]))
  assert.deepEqual([f.energy.kind, f.energy.type], ['number', 'f64'])
  assert.equal(f.hungry.kind, 'boolean')
  assert.deepEqual([f.mood.kind, f.mood.init], ['string', 'calm'])
  assert.equal(f.n.type, 'i32')
  assert.deepEqual([f.w.kind, f.w.array, f.w.length], ['number', true, 3])
  assert.equal(f.label.kind, 'string')

  const r = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 5 }, entities: [{ name: 'a', count: 3, state: { energy: 10, hungry: false, mood: 'calm' } }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const seen: unknown[] = []
  const sim = new Sim(r.ok ? r.scene : (null as never), {
    default: { decide: ({ self }) => { seen.push([self.energy, self.hungry, self.mood]); return { state: { energy: self.energy - 1, hungry: true, mood: 'tense' } } } },
  })
  sim.step(); sim.step()
  assert.deepEqual(seen[0], [10, false, 'calm'])
  assert.deepEqual(seen[3], [9, true, 'tense'])
  const snap = sim.snapshot()
  sim.step()
  sim.restore(snap)
  assert.equal(sim.table.cols.mood[0], 'tense')
})

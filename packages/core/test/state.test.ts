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

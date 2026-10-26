import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Field } from '../src/index'

const table = { nbr: new Int32Array(0), count: new Uint8Array(4), stride: 1 }
const f = (...v: number[]) => new Field(Float32Array.from(v), table)
const vals = (x: Field) => Array.from(x.data)

test('field arithmetic and comparisons work on fields and on plain numbers', () => {
  const a = f(1, 2, 3, 4), b = f(4, 3, 2, 1)
  assert.deepEqual(vals(a.add(b)), [5, 5, 5, 5])
  assert.deepEqual(vals(a.sub(1)), [0, 1, 2, 3])
  assert.deepEqual(vals(a.mul(b)), [4, 6, 6, 4])
  assert.deepEqual(vals(a.div(2)), [0.5, 1, 1.5, 2])
  assert.deepEqual(vals(a.min(b)), [1, 2, 2, 1])
  assert.deepEqual(vals(a.max(3)), [3, 3, 3, 4])
  assert.deepEqual(vals(a.eq(b)), [0, 0, 0, 0])
  assert.deepEqual(vals(a.eq(2)), [0, 1, 0, 0])
  assert.deepEqual(vals(a.ne(2)), [1, 0, 1, 1])
  assert.deepEqual(vals(a.lt(3)), [1, 1, 0, 0])
  assert.deepEqual(vals(a.le(3)), [1, 1, 1, 0])
  assert.deepEqual(vals(a.gt(b)), [0, 0, 1, 1])
  assert.deepEqual(vals(a.ge(3)), [0, 0, 1, 1])
  assert.deepEqual(vals(a.lt(3).and(a.gt(1))), [0, 1, 0, 0])
  assert.deepEqual(vals(a.lt(2).or(a.gt(3))), [1, 0, 0, 1])
  assert.deepEqual(vals(a.eq(2).not()), [1, 0, 1, 1])
  assert.deepEqual(vals(a.gt(2).where(10, 0)), [0, 0, 10, 10])
  assert.deepEqual(vals(a.gt(2).where(a, b)), [4, 3, 3, 4])
  assert.deepEqual(vals(a.clamp(2, 3)), [2, 2, 3, 3])
  assert.deepEqual(vals(a), [1, 2, 3, 4], 'fields are never changed in place')
  assert.throws(() => a.add(f(1, 2)), /same size/)
})

// a plain, eager version of the operations, to check the lazy, blockwise one against
const eager = (a: ArrayLike<number>, b: ArrayLike<number> | number, f: (x: number, y: number) => number) => Float32Array.from({ length: a.length }, (_, i) => f(a[i], typeof b === 'number' ? b : b[i]))

test('chains of operations give the same numbers as doing each step on its own, across block boundaries', () => {
  const n = 5000 // more than two blocks, and not a multiple of one
  const raw = Float32Array.from({ length: n }, (_, i) => (i * 7919) % 11)
  const raw2 = Float32Array.from({ length: n }, (_, i) => (i * 104729) % 7)
  const a = new Field(raw, { nbr: new Int32Array(0), count: new Uint8Array(n), stride: 1 })
  const b = new Field(raw2, { nbr: new Int32Array(0), count: new Uint8Array(n), stride: 1 })
  // born on 3, alive on 2: the Life rule, written as a chain
  const chain = a.eq(3).or(b.and(a.eq(2)))
  const want = eager(eager(raw, 3, (x, y) => (x === y ? 1 : 0)), eager(raw2, eager(raw, 2, (x, y) => (x === y ? 1 : 0)), (x, y) => (x !== 0 && y !== 0 ? 1 : 0)), (x, y) => (x !== 0 || y !== 0 ? 1 : 0))
  assert.deepEqual(Array.from(chain.data), Array.from(want))
  // arithmetic, where, clamp, map and zip mixed in one chain, with a scalar at both ends
  const mixed = a.sub(5).mul(b).where(a.map((v, i) => v + i % 3), 100).clamp(-2, 50).zip(b, (x, y, i) => x * 2 + y - (i & 1)).add(1)
  const w = Float32Array.from({ length: n }, (_, i) => {
    const t = (raw[i] - 5) * raw2[i]
    const pick = t !== 0 ? raw[i] + (i % 3) : 100
    const c = Math.min(50, Math.max(-2, pick))
    return Math.fround(c * 2 + raw2[i] - (i & 1)) + 1
  })
  assert.deepEqual(Array.from(mixed.data), Array.from(w))
  // a field used twice is worked out once and gives both users the same values
  const shared = a.add(1)
  const x = shared.mul(2), y = shared.mul(3)
  assert.deepEqual([x.data[7], y.data[7]], [(raw[7] + 1) * 2, (raw[7] + 1) * 3])
  assert.equal(new Field(Float32Array.of(1, 2, 3), table).add(0).length, 3)
})

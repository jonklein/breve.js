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

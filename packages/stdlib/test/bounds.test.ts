import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bounds, Gait, Vec3 } from '../src/index'

test('soft bounds push nothing inside the margin and push back toward the middle past it', () => {
  assert.deepEqual(Bounds.soft(new Vec3(10, -10, 5), 30).toArray(), [0, 0, 0])
  const push = Bounds.soft(new Vec3(29, -29, 0), 30) // the line is at 25.5: 3.5 past it
  assert.ok(Math.abs(push.x + 14) < 1e-9 && Math.abs(push.y - 14) < 1e-9 && push.z === 0, push.toArray().join())
  assert.equal(Bounds.soft([29, 29, 29], 30, { flat: true }).y, 0, 'a flat world leaves the vertical axis alone')
  assert.ok(Bounds.soft([29, 0, 0], 30, { strength: 8 }).x < Bounds.soft([29, 0, 0], 30).x, 'a stronger wall pushes harder')
})

test('bounce gives null inside, and puts an entity back on the wall it crossed with that velocity reversed', () => {
  assert.equal(Bounds.bounce([1, 2, 3], [4, 5, 6], 10), null)
  const hit = Bounds.bounce([12, 0, -3], [5, 1, -2], 10)!
  assert.deepEqual(hit.position.toArray(), [10, 0, -3])
  assert.deepEqual(hit.velocity.toArray(), [-5, 1, -2])
  const corner = Bounds.bounce([11, 0, -13], [1, 2, 3], 10)!
  assert.deepEqual(corner.position.toArray(), [10, 0, -10])
  assert.deepEqual(corner.velocity.toArray(), [-1, 2, -3])
})

test('a gait is a sine per joint, and advancing the cycle wraps and survives a changed frequency', () => {
  assert.equal(Gait.wave(0, { amplitude: 1, offset: 0.5 }), 0.5)
  assert.ok(Math.abs(Gait.wave(0.25, { amplitude: 1 }) - 1) < 1e-12)
  assert.ok(Math.abs(Gait.wave(0, { amplitude: 1, phase: 0.25 }) - 1) < 1e-12)
  assert.ok(Math.abs(Gait.wave(0.25, { amplitude: 1, lag: 0.25 })) < 1e-12)
  const t = Gait.targets({ a: { amplitude: 2 }, b: { offset: -1 } }, 0.25)
  assert.ok(Math.abs(t.a - 2) < 1e-12 && t.b === -1)
  assert.ok(Math.abs(Gait.advance(0.9, 3, 0.1) - 0.2) < 1e-12)
  assert.equal(Gait.advance(0.5, 0, 1), 0.5)
})

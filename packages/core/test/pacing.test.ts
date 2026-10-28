import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pacer, stepsPerSecond } from '../src/pacing'

test('pace is simulated time per real second: 10 s a second at a step of 0.025 is 400 steps a second', () => {
  assert.equal(stepsPerSecond({ step: 0.025, pace: 10 }), 400)
  assert.equal(stepsPerSecond({ step: 1, pace: 100 }), 100)
  assert.equal(stepsPerSecond({ step: 1, pace: 'max' }), Infinity)
})

test('a viewer speed multiplies the scene pace, "max" removes the limit, and a scene with no pace counts from one unit a second', () => {
  assert.equal(stepsPerSecond({ step: 1, pace: 20 }, 2), 40)
  assert.equal(stepsPerSecond({ step: 1, pace: 20 }, 'max'), Infinity)
  assert.equal(stepsPerSecond({ step: 1 / 60, pace: 'max' }, 1), 60)
  assert.equal(stepsPerSecond({ step: 1 / 60, pace: 'max' }, 5), 300)
})

test('the pacer carries fractions: 100 steps a second at 60 frames a second averages 1.67 a frame', () => {
  const p = new Pacer()
  let total = 0
  const seen = new Set<number>()
  for (let f = 0; f < 600; f++) { const n = p.steps(100, 1 / 60); total += n; seen.add(n) }
  assert.ok(Math.abs(total - 1000) <= 1, `${total} steps in ten seconds`)
  assert.deepEqual([...seen].sort(), [1, 2])
})

test('after a long stall the pacer does not owe a flood of steps, and an unlimited pace has no limit', () => {
  const p = new Pacer()
  assert.ok(p.steps(100, 5) <= 4, 'a five second stall is not made up')
  assert.equal(p.steps(Infinity, 0.016), Infinity)
})

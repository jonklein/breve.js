import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Fluid, type FluidPart } from '../src/fluid'

const still = { x: 0, y: 0, z: 0 }
const upright = { x: 0, y: 0, z: 0, w: 1 }
const box = (over: Partial<FluidPart> = {}): FluidPart => ({ shape: 'box', size: [1, 1, 1], mass: 1000, position: { x: 0, y: -5, z: 0 }, rotation: upright, velocity: still, angularVelocity: still, ...over })

test('a part fully under water is lifted by the weight of the water it displaces', () => {
  const { force } = Fluid.push(box(), { level: 0, gravity: 10 })
  assert.ok(Math.abs(force[1] - 10000) < 1e-6)
})

test('a part above the surface feels almost nothing, and one half under feels half', () => {
  assert.ok(Fluid.push(box({ position: { x: 0, y: 5, z: 0 } }), { level: 0 }).force[1] === 0)
  const half = Fluid.push(box({ position: { x: 0, y: 0, z: 0 } }), { level: 0, gravity: 10 }).force[1]
  assert.ok(Math.abs(half - 5000) < 1e-6, `${half}`)
})

test('drag opposes motion, grows with speed squared, and is larger across a flat plate than along it', () => {
  const plate = (v: [number, number, number]) => Fluid.push(box({ size: [2, 0.05, 2], mass: 5000, velocity: { x: v[0], y: v[1], z: v[2] } }), { level: 0, gravity: 0 }).force
  const broadside = plate([0, 1, 0]), edge = plate([1, 0, 0])
  assert.ok(broadside[1] < 0 && edge[0] < 0)
  assert.ok(Math.abs(broadside[1]) > 20 * Math.abs(edge[0]), `${broadside[1]} vs ${edge[0]}`)
  assert.ok(Math.abs(plate([0, 2, 0])[1] / broadside[1] - 4) < 1e-6)
})

test('drag never reverses a part in one tick, however fast it moves', () => {
  const m = 1, v = 1000
  const { force } = Fluid.push(box({ mass: m, velocity: { x: v, y: 0, z: 0 } }), { level: 0, gravity: 0, dt: 1 / 60 })
  assert.ok(Math.abs(force[0] * (1 / 60) / m) < v)
})

test('a current carries a part along with it', () => {
  const { force } = Fluid.push(box(), { level: 0, gravity: 0, current: [2, 0, 0] })
  assert.ok(force[0] > 0)
})

test('spin is resisted, and a rotated part resists along its own axes', () => {
  const { torque } = Fluid.push(box({ size: [1, 1, 1], angularVelocity: { x: 0, y: 3, z: 0 } }), { level: 0, gravity: 0 })
  assert.ok(torque[1] < 0 && torque[0] === 0)
  const turned = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } // a quarter turn about z: local x points up
  const { force } = Fluid.push(box({ size: [4, 0.05, 1], mass: 5000, rotation: turned, velocity: { x: 1, y: 0, z: 0 } }), { level: 0, gravity: 0 })
  assert.ok(force[0] < -1900 && Math.abs(force[1]) < 1e-6, `face-on along world x: ${force}`)
})

test('forces covers every part by name', () => {
  const out = Fluid.forces({ a: box(), b: box() }, { level: 0 })
  assert.deepEqual(Object.keys(out), ['a', 'b'])
})

test('lift above the center rights a tilted part; at the center it does not', () => {
  const tilt = { x: Math.sin(0.2), y: 0, z: 0, w: Math.cos(0.2) } // rolled about x: local up leans toward +z
  const high = Fluid.push(box({ rotation: tilt }), { level: 0, gravity: 10, buoyancyHeight: 0.3 }).torque
  const centered = Fluid.push(box({ rotation: tilt }), { level: 0, gravity: 10 }).torque
  assert.ok(Math.abs(high[0]) > 100, `${high}`)
  assert.equal(centered[0], 0)
})

test('lengthwise streamlining cuts drag along a part\'s length and leaves the drag across it alone', () => {
  const moving = (v: { x: number; y: number; z: number }) => box({ size: [2, 0.5, 0.5], mass: 5000, velocity: v })
  const along = (k: number) => Fluid.push(moving({ x: 1, y: 0, z: 0 }), { level: 0, gravity: 0, lengthwise: k }).force[0]
  const across = (k: number) => Fluid.push(moving({ x: 0, y: 0, z: 1 }), { level: 0, gravity: 0, lengthwise: k }).force[2]
  assert.ok(Math.abs(along(0.2) / along(1) - 0.2) < 1e-6, 'a fifth of the drag head-on')
  assert.equal(across(0.2), across(1), 'sideways is unchanged')
})

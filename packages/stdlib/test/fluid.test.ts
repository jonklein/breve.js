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
  assert.ok(Math.abs(force[0] * (1 / 60) / m) <= v + 1e-9) // at most enough to stop it
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

test('skin friction acts on the surfaces the flow slides over: a long thin part pays more head-on than a short one of the same frontal area', () => {
  const head = (size: [number, number, number], cf: number) => Fluid.push(box({ size, mass: 5000, velocity: { x: 1, y: 0, z: 0 } }), { level: 0, gravity: 0, skinFriction: cf }).force[0]
  const frictionless = head([2, 0.5, 0.5], 0), withFriction = head([2, 0.5, 0.5], 0.01)
  assert.ok(withFriction < frictionless, 'more drag (more negative) with friction')
  const long = head([4, 0.5, 0.5], 0.01) - head([4, 0.5, 0.5], 0), short = head([1, 0.5, 0.5], 0.01) - head([1, 0.5, 0.5], 0)
  assert.ok(long < 3 * short && long < short, `the longer part gains more friction drag (${long.toFixed(1)} vs ${short.toFixed(1)})`)
})

test('a sphere and a rounded nose slip through the water far better than a flat face of the same size', () => {
  const sphere = Fluid.push({ ...box(), shape: 'sphere', size: [0.5], mass: 5000, velocity: { x: 1, y: 0, z: 0 } }, { level: 0, gravity: 0, skinFriction: 0 }).force[0]
  const plate = Fluid.push({ ...box({ size: [0.05, 1, 1], mass: 5000, velocity: { x: 1, y: 0, z: 0 } }) }, { level: 0, gravity: 0, skinFriction: 0 }).force[0]
  assert.ok(Math.abs(sphere) < Math.abs(plate) * 0.5, `${sphere} vs ${plate}`)
})

test('added mass: a plate pushed face-on carries a lot of water, a plate pushed edge-on almost none, and the force opposes the acceleration', () => {
  // a 1 x 1 x 0.1 m plate of 100 kg, accelerating from rest to 0.5 m/s in one tick, with nothing remembered but that it was still
  const still = [1, 0, 0, 0, 0, 0, 0]
  const part = (v: { x: number; y: number; z: number }) => box({ size: [1, 1, 0.1], mass: 100, velocity: v })
  const calm = { level: 0, gravity: 0, drag: 0, skinFriction: 0 }
  const face = Fluid.forces({ plate: part({ x: 0, y: 0, z: 0.5 }) }, calm, still).plate
  const heavy = ((Math.PI / 4) * 1000 * 1 * 1) / (1 + (2 * 0.1) / 1) // the textbook plate, a little reduced for its thickness
  const other = (100 * 0.5) * 60
  assert.ok(Math.abs(face.added[2] + (heavy / (100 + heavy)) * other) < 1e-6, `${face.added}`)
  const edge = Fluid.forces({ plate: part({ x: 0.5, y: 0, z: 0 }) }, calm, still).plate
  assert.ok(Math.abs(edge.added[0]) < 0.4 * Math.abs(face.added[2]), `edge-on ${edge.added[0]}, face-on ${face.added[2]}`)
  assert.equal(Fluid.forces({ plate: part({ x: 0, y: 0, z: 0.5 }) }, calm).plate.added[2], 0, 'with nothing remembered there is nothing to go on')
  assert.deepEqual(Fluid.remember({ plate: part({ x: 1, y: 2, z: 3 }) }, { plate: { force: [0, 0, 0], torque: [0, 0, 0], added: [4, 5, 6] } }), [1, 1, 2, 3, 4, 5, 6])
})

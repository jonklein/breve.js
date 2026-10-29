import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type BodyDef, type Controller } from '../src/index'

// a 1 x 1 x 0.1 m plate of 100 kg (neutral in water), pushed along its thin axis with a steady 200 N, in water with no drag and no gravity
const plate: BodyDef = { parts: [{ name: 'plate', shape: 'box', size: [1, 1, 0.1], mass: 100, position: [0, 0, 0] }], sensors: [{ type: 'parts' }] }
const run = async (withWater: boolean) => {
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, terrain: { size: 40, resolution: 8, amplitude: 0 }, physics: { gravity: 0, linearDamping: 0, angularDamping: 0 },
    entities: [{ name: 'a', count: 1, spawn: { lift: 10 }, body: plate }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const control: Controller = {
    act: ({ self }, _p, ctx) => {
      const water = { level: 100, gravity: 0, drag: 0, skinFriction: 0, dt: ctx.dt }
      const forces = ctx.fluid.forces(self.parts, { ...water, addedMass: withWater ? 1 : 0 })
      forces.plate.force[2] += 200
      return { forces }
    },
  }
  const sim = await Sim.create(r.ok ? r.scene : (null as never), { default: control })
  for (let t = 0; t < 60; t++) sim.step()
  const v = (sim.worlds[0] as unknown as { partStates(row: number): Record<string, { velocity: { z: number } }> }).partStates(0).plate.velocity.z
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
  return v
}

test('added mass slows a part down by the mass of the water it carries: the same push gives m / (m + added) of the speed', async () => {
  const free = await run(false), carried = await run(true)
  const heavy = ((Math.PI / 4) * 1000) / 1.2 // the plate's added mass face-on, kg
  assert.ok(Math.abs(free - 2) < 0.05, `without added mass 200 N on 100 kg for a second is 2 m/s, got ${free}`)
  assert.ok(Math.abs(carried / free - 100 / (100 + heavy)) < 0.04, `${carried.toFixed(3)} m/s is ${(carried / free).toFixed(3)} of ${free.toFixed(2)}; expected ${(100 / (100 + heavy)).toFixed(3)}`)
})

test('added mass survives a fork: a branch taken mid-run gives the same speeds as the run that carried on (the past it looks back on is part of the creature\'s state)', async () => {
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, terrain: { size: 40, resolution: 8, amplitude: 0 }, physics: { gravity: 0, linearDamping: 0, angularDamping: 0 },
    entities: [{ name: 'a', count: 1, spawn: { lift: 10 }, body: plate }], metrics: [],
  }))
  assert.ok(r.ok)
  const control: Controller = { act: ({ self }, _p, ctx) => {
    const forces = ctx.fluid.forces(self.parts, { level: 100, gravity: 0, drag: 0, skinFriction: 0, dt: ctx.dt })
    forces.plate.force[2] += 150 * Math.sin(ctx.tick / 9)
    return { forces }
  } }
  const a = await Sim.create(r.ok ? r.scene : (null as never), { default: control })
  for (let t = 0; t < 40; t++) a.step()
  const b = a.fork()
  for (let t = 0; t < 40; t++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
  const v = (s: Sim) => (s.worlds[0] as unknown as { partStates(row: number): Record<string, { velocity: { z: number } }> }).partStates(0).plate.velocity.z
  assert.equal(v(a), v(b))
  a.dispose(); b.dispose()
})

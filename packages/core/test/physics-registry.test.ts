import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, loadPhysicsEngine, physicsEngineNames, registerPhysicsEngine, partInertia, flooredInertia, type PhysicsEngine } from '../src/index'

const body = { parts: [{ name: 'a', shape: 'box' as const, size: [1, 1, 1], mass: 2, position: [0, 1, 0] as [number, number, number] }] }
const scene = (physics: object) => {
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, physics, terrain: { size: 10, resolution: 4, amplitude: 0 }, entities: [{ name: 'a', count: 1, body }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

test('rapier is the default engine, and a registered engine is used when the scene names it', async () => {
  assert.deepEqual(physicsEngineNames().includes('rapier'), true)
  assert.equal((await loadPhysicsEngine()).name, 'rapier3d-deterministic')
  let built = 0
  const fake: PhysicsEngine = { name: 'fake', createWorld: () => { built++; throw new Error('the fake engine was asked for a world') } }
  registerPhysicsEngine('fake', async () => fake)
  await assert.rejects(Sim.create(scene({ engine: 'fake' })), /the fake engine was asked for a world/)
  assert.equal(built, 1)
  await Sim.create(scene({})).then((s) => s.dispose()) // no engine named: Rapier, untouched by the fake
})

test('a scene that names an unknown engine is told which are available', async () => {
  await assert.rejects(Sim.create(scene({ engine: 'nope' })), /no engine called "nope" is registered \(available: .*rapier/)
})

test('inertia helpers: a box, and a floor that only ever raises it', () => {
  const p = { name: 'a', shape: 'box' as const, size: [0.2, 0.4, 0.6], mass: 3, position: [0, 0, 0] as [number, number, number] }
  assert.deepEqual(partInertia(p).map((v) => +v.toFixed(6)), [3 * (0.16 + 0.36) / 12, 3 * (0.04 + 0.36) / 12, 3 * (0.04 + 0.16) / 12].map((v) => +v.toFixed(6)))
  const floor = 3 * 0.5 * 0.5
  assert.ok(flooredInertia(p, 0.5).every((v) => v >= floor - 1e-12))
  assert.deepEqual(flooredInertia(p, 0), partInertia(p))
})

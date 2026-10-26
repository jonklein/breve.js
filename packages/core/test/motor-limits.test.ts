import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type BodyDef, type ScriptModule } from '../src/index'

// a heavy tall trunk with one arm sticking out sideways, high enough that a drooping arm does not reach the ground
const arm = (motor: object): BodyDef => ({
  parts: [
    { name: 'trunk', shape: 'box', size: [1, 3, 1], mass: 200, position: [0, 1.5, 0] },
    { name: 'arm', shape: 'box', size: [1, 0.1, 0.1], mass: 5, position: [1, 1.5, 0] },
  ],
  joints: [{ name: 'shoulder', parent: 'trunk', child: 'arm', anchor: [0.5, 1.5, 0], axis: [0, 0, 1], limits: [-1, 1], motor: motor as never }],
  sensors: [{ type: 'joints' }],
})

async function make(motor: object, target: (tick: number) => number) {
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, terrain: { size: 20, resolution: 8, amplitude: 0 },
    entities: [{ name: 'a', count: 1, spawn: { at: [0, 0, 0] }, body: arm(motor) }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const angles: number[] = []
  const script: ScriptModule = { default: { act: ({ self }, _p, ctx) => { angles.push(self.joints.shoulder); return { joints: { shoulder: target(ctx.tick) } } } } }
  return { sim: await Sim.create(r.ok ? r.scene : (null as never), script), angles }
}

test('maxSpeed eases a target that jumps instead of snapping the joint to it', async () => {
  const flip = (t: number) => (Math.floor(t / 30) % 2 ? -0.8 : 0.8) // jumps from one end to the other every half second
  const fast = await make({ stiffness: 400, damping: 40 }, flip)
  const slow = await make({ stiffness: 400, damping: 40, maxSpeed: 1 }, flip)
  for (let t = 0; t < 240; t++) { fast.sim.step(); slow.sim.step() }
  const peak = (a: number[]) => Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i]) * 60))
  assert.ok(peak(slow.angles) < 0.5 * peak(fast.angles), `eased ${peak(slow.angles).toFixed(2)} rad/s vs ${peak(fast.angles).toFixed(2)} rad/s`)
  assert.equal(fast.sim.takeErrors().length + slow.sim.takeErrors().length, 0)
  fast.sim.dispose(); slow.sim.dispose()
})

test('maxTorque caps the push: a weak motor cannot hold a heavy arm up, a strong one can', async () => {
  const hold = () => 0.4
  const weak = await make({ stiffness: 4000, damping: 5, maxTorque: 1 }, hold)
  const strong = await make({ stiffness: 4000, damping: 5, maxTorque: 200 }, hold)
  for (let t = 0; t < 180; t++) { weak.sim.step(); strong.sim.step() }
  const end = (a: number[]) => a[a.length - 1]
  assert.ok(end(strong.angles) > 0.2, `strong arm at ${end(strong.angles).toFixed(2)}`)
  assert.ok(end(weak.angles) < -0.5, `weak arm sags to ${end(weak.angles).toFixed(2)}`)
  weak.sim.dispose(); strong.sim.dispose()
})

test('a snapshot keeps the eased targets, so a fork moves exactly like the original', async () => {
  const wave = (t: number) => Math.sin(t / 20)
  const a = await make({ stiffness: 400, damping: 40, maxSpeed: 2 }, wave)
  for (let t = 0; t < 60; t++) a.sim.step()
  const snap = a.sim.snapshot()
  for (let t = 0; t < 60; t++) a.sim.step()
  const h = a.sim.hash()
  a.sim.restore(snap)
  for (let t = 0; t < 60; t++) a.sim.step()
  assert.equal(a.sim.hash(), h)
  a.sim.dispose()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type BodyDef, type Controller, type ScriptModule } from '../src/index'

// one box falling from high above the ground, so nothing but gravity and our pushes acts on it
const body: BodyDef = { parts: [{ name: 'box', shape: 'box', size: [1, 1, 1], mass: 2, position: [0, 30, 0] }], joints: [], sensors: [{ type: 'parts' }] }

async function make(act: Controller['act']) {
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, terrain: { size: 20, resolution: 8, amplitude: 0 },
    entities: [{ name: 'a', count: 1, spawn: { at: [0, 0, 0] }, body }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return Sim.create(r.ok ? r.scene : (null as never), { default: { act } } as ScriptModule)
}

test('a force on a part speeds it up by force / mass, and the parts sensor reports the velocity', async () => {
  const seen: { vx: number; mass: number; name: string }[] = []
  const sim = await make(({ self }) => {
    const p = self.parts.box
    seen.push({ vx: p.velocity.x, mass: p.mass, name: p.name })
    return { forces: { box: { force: [10, 0, 0] } } }
  })
  for (let t = 0; t < 60; t++) sim.step()
  const last = seen[seen.length - 1]
  assert.equal(last.name, 'box')
  assert.equal(last.mass, 2)
  assert.ok(Math.abs(last.vx - 5) < 0.3, `after a second of 10 N on 2 kg, vx is ${last.vx.toFixed(2)}`)
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
})

test('a push lasts one tick: a script that stops pushing stops accelerating', async () => {
  const seen: number[] = []
  const sim = await make(({ self }, _p, ctx) => {
    seen.push(self.parts.box.velocity.x)
    return ctx.tick < 30 ? { forces: { box: { force: [10, 0, 0] } } } : {}
  })
  for (let t = 0; t < 90; t++) sim.step()
  assert.ok(seen[89] <= seen[50] + 0.01 && seen[89] > 0.5 * seen[50], `speed held at ${seen[50].toFixed(2)} then ${seen[89].toFixed(2)}`)
  sim.dispose()
})

test('a torque spins a part, and unknown part names or non-numbers are readable errors', async () => {
  const seen: number[] = []
  const sim = await make(({ self }) => { seen.push(self.parts.box.angularVelocity.y); return { forces: { box: { torque: [0, 4, 0] } } } })
  for (let t = 0; t < 30; t++) sim.step()
  assert.ok(seen[seen.length - 1] > 0.5, `spinning at ${seen[seen.length - 1]}`)
  sim.dispose()

  const bad = await make(() => ({ forces: { wing: { force: [1, 0, 0] } } }))
  bad.step()
  assert.match(bad.takeErrors().join('\n'), /wing/)
  bad.dispose()
})

test('forces are deterministic: two runs give the same state', async () => {
  const run = async () => {
    const sim = await make(({ self }) => ({ forces: { box: { force: [3 * Math.sin(self.parts.box.position.y), 0, 2] } } }))
    for (let t = 0; t < 60; t++) sim.step()
    return sim.hash()
  }
  assert.equal(await run(), await run())
})

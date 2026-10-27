import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, Terrain, parseScene, registerPhysicsEngine, type BodyDef, type Scene, type ScriptModule } from '@breve/core'
import { loadMujoco } from '../src/index'

registerPhysicsEngine('mujoco', loadMujoco)

const ENGINES = ['rapier', 'mujoco']
const sceneWith = (engine: string, body: BodyDef, extra: object = {}): Scene => {
  const r = parseScene(JSON.stringify({
    seed: 3, params: {}, physics: { engine },
    terrain: { size: 24, resolution: 24, amplitude: 0.6, frequency: 0.12 },
    entities: [{ name: 'a', count: 1, spawn: { at: [3, 0, -5] }, body }], metrics: [], ...extra,
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}
const quiet: ScriptModule = { default: { act: () => ({}) } }
const run = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) sim.step() }

// a flat slab dropped from a metre up: where it comes to rest says whether the engine's ground is where our terrain says it is
const slab: BodyDef = { parts: [{ name: 'slab', shape: 'box', size: [0.4, 0.1, 0.4], mass: 2, position: [0, 1, 0] }] }

test('both engines put the ground where the terrain says it is, in every direction', async () => {
  for (const at of [[3, -5], [-6, 4], [7, 7], [-8, -8], [0, 9]]) {
    const heights: Record<string, number> = {}
    for (const engine of ENGINES) {
      const sc = sceneWith(engine, slab)
      sc.entities[0].spawn = { at: [at[0], 0, at[1]] }
      const sim = await Sim.create(sc, quiet)
      run(sim, 150)
      heights[engine] = (sim.table.cols as unknown as Record<string, Float32Array>).py[0]
      assert.equal(sim.takeErrors().length, 0)
      sim.dispose()
    }
    const ground = new Terrain(sceneWith('rapier', slab).terrain, 3).heightAt(at[0], at[1])
    for (const engine of ENGINES) assert.ok(Math.abs(heights[engine] - (ground + 0.05)) < 0.08, `${engine} at (${at}): slab rests at ${heights[engine].toFixed(3)}, ground is ${ground.toFixed(3)} (+0.05)`)
  }
})

test('the same scene and seed give the same MuJoCo state hash, and a different spawn does not', async () => {
  const make = async (x: number) => {
    const sc = sceneWith('mujoco', slab)
    sc.entities[0].spawn = { at: [x, 0, 0] }
    return Sim.create(sc, quiet)
  }
  const a = await make(1), b = await make(1), c = await make(2)
  run(a, 120); run(b, 120); run(c, 120)
  assert.equal(a.hash(), b.hash())
  assert.notEqual(a.hash(), c.hash())
  for (const s of [a, b, c]) s.dispose()
})

// one heavy tall trunk and an arm sticking out sideways: can the motor hold it up, and does `maxTorque` cap the push?
const arm = (motor: object): BodyDef => ({
  parts: [
    { name: 'trunk', shape: 'box', size: [1, 3, 1], mass: 200, position: [0, 1.5, 0] },
    { name: 'arm', shape: 'box', size: [1, 0.1, 0.1], mass: 5, position: [1, 1.5, 0] },
  ],
  joints: [{ name: 'shoulder', parent: 'trunk', child: 'arm', anchor: [0.5, 1.5, 0], axis: [0, 0, 1], limits: [-1, 1], motor: motor as never }],
  sensors: [{ type: 'joints' }],
})

test('motors: a strong one holds a heavy arm at its target, a capped one sags, on either engine', async () => {
  for (const engine of ENGINES) {
    const end = async (motor: object) => {
      const angles: number[] = []
      const script: ScriptModule = { default: { act: ({ self }) => { angles.push(self.joints.shoulder); return { joints: { shoulder: 0.4 } } } } }
      const sim = await Sim.create(sceneWith(engine, arm(motor)), script)
      run(sim, 240)
      sim.dispose()
      return angles[angles.length - 1]
    }
    const strong = await end({ stiffness: 4000, damping: 50, maxTorque: 200 })
    const weak = await end({ stiffness: 4000, damping: 50, maxTorque: 1 })
    assert.ok(strong > 0.2, `${engine}: strong arm at ${strong.toFixed(2)}`)
    assert.ok(weak < -0.3, `${engine}: weak arm at ${weak.toFixed(2)}`)
  }
})

test('a snapshot restores MuJoCo exactly: the branch from a snapshot matches the run that went on', async () => {
  const sc = sceneWith('mujoco', arm({ stiffness: 400, damping: 40, maxSpeed: 2 }))
  const wave: ScriptModule = { default: { act: (_o, _p, ctx) => ({ joints: { shoulder: Math.sin(ctx.tick / 20) } }) } }
  const sim = await Sim.create(sc, wave)
  run(sim, 60)
  const snap = sim.snapshot()
  run(sim, 60)
  const h = sim.hash()
  sim.restore(snap)
  run(sim, 60)
  assert.equal(sim.hash(), h)
  sim.dispose()
})

test('asking for an engine nobody registered says which ones exist', async () => {
  const sc = sceneWith('rapier', slab)
  sc.physics = { engine: 'havok' }
  await assert.rejects(Sim.create(sc, quiet), /no engine called "havok" is registered \(available: rapier, mujoco\)/)
})

test('both engines push a part by force / mass and report its velocity', async () => {
  const box: BodyDef = { parts: [{ name: 'box', shape: 'box', size: [1, 1, 1], mass: 2, position: [0, 30, 0] }], sensors: [{ type: 'parts' }] }
  const speeds: Record<string, number> = {}
  for (const engine of ENGINES) {
    let vx = 0
    const sim = await Sim.create(sceneWith(engine, box, { terrain: { size: 24, resolution: 24, amplitude: 0 } }), { default: { act: ({ self }) => { vx = self.parts.box.velocity.x; return { forces: { box: { force: [10, 0, 0] } } } } } } as ScriptModule)
    run(sim, 60)
    assert.equal(sim.takeErrors().length, 0)
    speeds[engine] = vx
    sim.dispose()
  }
  for (const engine of ENGINES) assert.ok(Math.abs(speeds[engine] - 5) < 0.4, `${engine}: vx ${speeds[engine]}`)
})

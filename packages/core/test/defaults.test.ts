import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Defaults } from '@breve/stdlib'
import { Sim, parseScene, resolvePhysics, type BodyDef, type ScriptModule } from '../src/index'

const box: BodyDef = { parts: [{ name: 'box', shape: 'box', size: [1, 1, 1], mass: 2, position: [0, 0.5, 0] }], sensors: [{ type: 'pose' }] }
const quiet: ScriptModule = { default: { act: () => ({}) } }
const make = async (extra: object, entity: object = {}, script: ScriptModule = quiet) => {
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, terrain: { size: 40, resolution: 16, amplitude: 0 }, entities: [{ name: 'a', count: 1, body: box, ...entity }], metrics: [], ...extra }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return Sim.create(r.ok ? r.scene : (null as never), script)
}
const handle = (sim: Sim) => (sim.worlds[0] as unknown as { handles: { x: number; y: number; z: number; yaw: number; vx: number }[] }).handles

test('physics settings left out come from the stdlib defaults, and the scene overrides them', () => {
  assert.equal(resolvePhysics(undefined).linearDamping, Defaults.physics.linearDamping)
  assert.equal(resolvePhysics({ linearDamping: 0 }).linearDamping, 0)
  assert.equal(resolvePhysics({ gravity: 3 }).gravity, 3)
  assert.equal(resolvePhysics({}).substeps, Defaults.physics.substeps)
})

test('linearDamping in the scene changes how far a thrown body coasts', async () => {
  const coast = async (physics: object) => {
    const sim = await make({ physics }, { spawn: { lift: 20 } }, { default: { act: (_o, _p, ctx) => (ctx.tick === 0 ? { forces: { box: { force: [200, 0, 0] } } } : {}) } })
    let v = 0
    for (let t = 0; t < 120; t++) { sim.step(); v = Math.max(v, handle(sim)[0].vx) }
    const x = handle(sim)[0].x
    sim.dispose()
    return x
  }
  const none = await coast({ linearDamping: 0, gravity: 0 }), heavy = await coast({ linearDamping: 3, gravity: 0 })
  assert.ok(none > heavy * 1.5, `no damping coasts to ${none.toFixed(1)}, heavy damping to ${heavy.toFixed(1)}`)
})

test('spawn.lift and the y of spawn.at set the starting height, and spawn.yaw the heading', async () => {
  const at = async (spawn: object) => {
    const sim = await make({ physics: { gravity: 0 } }, { spawn })
    const h = handle(sim)[0]
    const out = { y: h.y, yaw: h.yaw }
    sim.dispose()
    return out
  }
  const a = await at({ at: [0, 0, 0], lift: 0 }), b = await at({ at: [0, 0, 0], lift: 3 }), c = await at({ at: [0, 4, 0], lift: 0 })
  assert.ok(Math.abs(b.y - a.y - 3) < 0.05, `lift 3 raises it by ${(b.y - a.y).toFixed(2)}`)
  assert.ok(Math.abs(c.y - a.y - 4) < 0.05, `at y 4 raises it by ${(c.y - a.y).toFixed(2)}`)
  const d = await at({ at: [0, 0, 0], yaw: 1.2 })
  assert.ok(Math.abs(d.yaw - 1.2) < 0.01, `yaw ${d.yaw}`)
})

test('asking for more than a limit is reported and capped, and the scene can raise the limit', async () => {
  const sim = await make({ limits: { creatures: 3 } }, { count: 5 })
  assert.equal(sim.table.size, 3)
  assert.match(sim.takeErrors().join('\n'), /asks for 5 creatures and the limit is 3.*"limits": \{ "creatures": 5 \}/)
  sim.dispose()
  const raised = await make({ limits: { creatures: 6 } }, { count: 5 })
  assert.equal(raised.table.size, 5)
  assert.deepEqual(raised.takeErrors(), [])
  raised.dispose()
  const agents = parseScene(JSON.stringify({ seed: 1, params: {}, entities: [{ name: 'a', count: 5001 }], metrics: [] }))
  assert.ok(agents.ok)
  const s = new Sim(agents.ok ? agents.scene : (null as never))
  assert.equal(s.table.size, Defaults.limits.agents)
  assert.match(s.takeErrors().join('\n'), /5,001 agents/)
})

test('compute "gpu" says why it cannot start; "cpu" and "auto" run anywhere', async () => {
  const lattice = (compute: string, size = [8, 8, 1]) => ({ seed: 1, params: {}, entities: [{ name: 'g', lattice: { size, compute }, controller: 'x' }], metrics: [] })
  const formula: ScriptModule = { default: { initFormula: () => ({ a: 0 }), actFormula: ({ a }: { a: never }) => ({ a }) } as never }
  const parse = (o: object) => { const r = parseScene(JSON.stringify(o)); assert.ok(r.ok, r.ok ? '' : r.errors.join('\n')); return r.ok ? r.scene : (null as never) }
  await assert.rejects(Sim.create(parse(lattice('gpu', [8, 8, 2])), formula), /needs a flat grid/)
  await assert.rejects(Sim.create(parse(lattice('gpu')), { default: { act: () => ({}) } } as ScriptModule), /initFormula and actFormula/)
  await assert.rejects(Sim.create(parse(lattice('gpu')), formula), /no WebGPU/) // node has none
  for (const c of ['cpu', 'auto']) { const s = await Sim.create(parse(lattice(c)), formula); s.step(); s.dispose() }
})

test('the new physics fields validate', () => {
  const ok = parseScene(JSON.stringify({ seed: 1, params: {}, physics: { linearDamping: 0, angularDamping: 0, friction: 0.4, restitution: 0.5, solverIterations: 12, sleep: true }, entities: [{ name: 'a', count: 1 }], metrics: [] }))
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('\n'))
  const bad = parseScene(JSON.stringify({ seed: 1, params: {}, physics: { restitution: 2, linearDamping: -1 }, entities: [{ name: 'a', count: 1 }], metrics: [] }))
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.errors.join('\n'), /physics\.(restitution|linearDamping)/)
})

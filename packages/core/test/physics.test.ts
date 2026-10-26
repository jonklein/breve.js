import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, Terrain, parseScene, type Scene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/creature/', import.meta.url)

async function load(params: Record<string, number> = {}) {
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  const scene = (parsed.ok ? parsed.scene : null) as Scene
  Object.assign(scene.params, params)
  const script = (await import(pathToFileURL(new URL('creature.js', dir).pathname).href)) as ScriptModule
  return { scene, script }
}

const run = (sim: Sim, ticks: number) => { for (let i = 0; i < ticks; i++) sim.step() }
const cols = (sim: Sim) => sim.table.cols as unknown as Record<string, Float64Array>

test('a scene with a physics body needs Sim.create, and says so', async () => {
  const { scene } = await load()
  assert.throws(() => new Sim(scene), /await Sim\.create/)
})

test('same scene and seed give the same physics state hash after N ticks (and a new seed does not)', async () => {
  const { scene, script } = await load({ count: 4 })
  const a = await Sim.create(scene, script)
  const b = await Sim.create(structuredClone(scene), script)
  run(a, 300)
  run(b, 300)
  assert.equal(a.hash(), b.hash())
  assert.deepEqual(Buffer.from(cols(a).px.buffer), Buffer.from(cols(b).px.buffer))
  const other = structuredClone(scene)
  other.seed = 12
  const c = await Sim.create(other, script)
  run(c, 300)
  assert.notEqual(a.hash(), c.hash())
  for (const s of [a, b, c]) s.dispose()
})

test('the hash is sensitive to the creatures and to a script changing a joint', async () => {
  const { scene, script } = await load({ count: 2 })
  const a = await Sim.create(scene, script)
  const b = await Sim.create(scene, { default: { act: () => ({ joints: { 'FL.hip': 0.5 } }) } })
  run(a, 60)
  run(b, 60)
  assert.notEqual(a.hash(), b.hash())
  a.dispose(); b.dispose()
})

test('creatures stand on the terrain and walk: they cover ground, stay upright and above the surface', async () => {
  const { scene, script } = await load({ count: 6 })
  const sim = await Sim.create(scene, script)
  const terrain = new Terrain(scene.terrain, scene.seed)
  const c = cols(sim)
  const start = Array.from({ length: 6 }, (_, i) => [c.px[i], c.pz[i]])
  run(sim, 600) // 10 seconds
  let upright = 0, covered = 0
  for (let i = 0; i < 6; i++) {
    assert.ok(c.py[i] > terrain.heightAt(c.px[i], c.pz[i]), `creature ${i} is below the ground`)
    if (1 - 2 * (c.qx[i] ** 2 + c.qz[i] ** 2) > 0.8) upright++
    covered += Math.hypot(c.px[i] - start[i][0], c.pz[i] - start[i][1])
  }
  assert.ok(upright >= 5, `${upright}/6 upright`)
  assert.ok(covered / 6 > 3, `creatures should walk several meters in 10 s, got ${(covered / 6).toFixed(1)}`)
  const m = sim.metrics()
  assert.ok(m.distance > 3, `distance metric ${m.distance}`)
  assert.ok(m.speed > 0.2, `speed metric ${m.speed}`)
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
})

test('without the oscillator drive a creature just stands', async () => {
  const { scene } = await load({ count: 1, stride: 0, lift: 0 })
  const sim = await Sim.create(scene)
  const c = cols(sim)
  run(sim, 240)
  const [x, z] = [c.px[0], c.pz[0]]
  run(sim, 240)
  assert.ok(Math.hypot(c.px[0] - x, c.pz[0] - z) < 0.15, 'it should be standing still')
  assert.ok(c.py[0] > 0.3 + new Terrain(scene.terrain, scene.seed).heightAt(x, z) - 1, 'and still be up on its legs')
  sim.dispose()
})

test('act() can return joint targets; unknown joint names are reported', async () => {
  const { scene } = await load({ count: 1 })
  const bad = await Sim.create(scene, { default: { act: () => ({ joints: { wing: 1 } }) } })
  run(bad, 2)
  assert.match(bad.takeErrors().join(), /no joint with that name/)
  bad.dispose()

  // pin one hip far away from its rhythm and it must show in the joint sensor
  let seen = 0
  const pin = await Sim.create(scene, { default: { act: ({ self }) => { seen = self.joints['FR.hip']; return { joints: { 'FR.hip': 0.6 } } } } })
  run(pin, 120)
  assert.ok(Math.abs(seen - 0.6) < 0.25, `FR.hip reads ${seen}`)
  pin.dispose()
})

test('the script sees the oscillator output and the declared sensors', async () => {
  const { scene } = await load({ count: 1 })
  let gait: Record<string, number> = {}
  let touch: Record<string, boolean> = {}
  const sim = await Sim.create(scene, { default: { act: ({ self }) => { gait = self.gait; touch = self.touch } } })
  run(sim, 90)
  assert.deepEqual(Object.keys(gait).sort(), ['FL.hip', 'FR.hip', 'HL.hip', 'HR.hip', 'FL.knee', 'FR.knee', 'HL.knee', 'HR.knee'].sort())
  assert.ok(Math.abs(gait['FL.hip']) <= 0.7 + 1e-9)
  assert.deepEqual(Object.keys(touch).sort(), ['FL.lower', 'FR.lower', 'HL.lower', 'HR.lower'].sort())
  assert.ok(Object.values(touch).some(Boolean), 'a standing creature has a foot on the ground')
  sim.dispose()
})

test('steering by stride works: more stride on one side turns the creature that way', async () => {
  const { scene } = await load({ count: 8 })
  const meanTurn = async (sign: number) => {
    const sim = await Sim.create(structuredClone(scene), {
      default: { act: ({ self }) => ({ joints: Object.fromEntries(Object.entries(self.gait as Record<string, number>).filter(([n]) => n.endsWith('.hip')).map(([n, a]) => [n, a * (1 + 0.5 * sign * (n.split('.')[0].endsWith('R') ? 1 : -1))])) }) },
    })
    const c = cols(sim)
    const yaw = (i: number) => Math.atan2(-2 * (c.qx[i] * c.qz[i] - c.qw[i] * c.qy[i]), 1 - 2 * (c.qy[i] ** 2 + c.qz[i] ** 2))
    let last = Array.from({ length: 8 }, (_, i) => yaw(i)), total = 0
    for (let t = 0; t < 600; t++) {
      sim.step()
      for (let i = 0; i < 8; i++) { let d = yaw(i) - last[i]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); total += d; last[i] = yaw(i) }
    }
    sim.dispose()
    return total / 8
  }
  const biggerRight = await meanTurn(1), biggerLeft = await meanTurn(-1)
  assert.ok(biggerRight - biggerLeft > 2, `longer right stride should turn left (positive yaw): ${biggerRight.toFixed(2)} vs ${biggerLeft.toFixed(2)}`)
})

test('the shipped example script keeps creatures near home when told to', async () => {
  const { scene, script } = await load({ count: 8, radius: 3 })
  const sim = await Sim.create(scene, script)
  const c = cols(sim)
  const mean = () => Array.from({ length: 8 }, (_, i) => Math.hypot(c.px[i], c.pz[i])).reduce((a, b) => a + b) / 8
  const before = mean()
  run(sim, 1500)
  assert.ok(mean() < before * 0.6, `mean distance from the middle went ${before.toFixed(1)} -> ${mean().toFixed(1)}`)
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
})

test('editing the creature count or a param on a running sim keeps it going; editing the body respawns it', async () => {
  const { scene, script } = await load({ count: 3 })
  const sim = await Sim.create(scene, script)
  run(sim, 30)
  const more = structuredClone(scene)
  more.params.count = 5
  sim.setScene(more)
  assert.equal(sim.table.size, 5)
  run(sim, 30)
  const fewer = structuredClone(scene)
  fewer.params.count = 2
  fewer.params.frequency = 2
  sim.setScene(fewer)
  assert.equal(sim.table.size, 2)
  run(sim, 30)
  const taller = structuredClone(fewer)
  taller.entities[0].body!.parts[0].size = [1.2, 0.25, 0.45]
  sim.setScene(taller)
  assert.equal(sim.table.size, 2)
  assert.equal(cols(sim).travelled[0], 0, 'a new body means new creatures')
  run(sim, 30)
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
})

test('frames for the renderer: poses for every part, and the model only on the first frame', async () => {
  const { scene } = await load({ count: 3 })
  const sim = await Sim.create(scene)
  const f1 = sim.frame()
  assert.equal(f1.kind, 'bodies')
  assert.equal(f1.count, 3)
  assert.equal(f1.rigid!.partCount, 9)
  assert.equal(f1.rigid!.poses.length, 3 * 9 * 7)
  assert.equal(f1.rigid!.model!.parts.length, 9)
  assert.equal(f1.rigid!.model!.terrain!.heights.length, 65 * 65)
  run(sim, 5)
  const f2 = sim.frame()
  assert.equal(f2.rigid!.model, undefined)
  assert.ok(f2.rigid!.poses.every(Number.isFinite))
  sim.dispose()
})

test('a physics sim can be snapshotted, restored and forked, and the branches stay identical', async () => {
  const { scene, script } = await load({ count: 3 })
  const a = await Sim.create(scene, script)
  for (let i = 0; i < 40; i++) a.step()
  const snap = a.snapshot()
  for (let i = 0; i < 40; i++) a.step()
  const later = a.hash()
  a.restore(snap)
  for (let i = 0; i < 40; i++) a.step()
  assert.equal(a.hash(), later, 'restoring replays the same future')
  const b = a.fork()
  assert.equal(a.hash(), b.hash())
  for (let i = 0; i < 40; i++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash(), 'a fork carries on identically')
  a.dispose(); b.dispose()
})

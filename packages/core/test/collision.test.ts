import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRapier } from '../src/physics/rapier'
import { parseScene, type BodyDef } from '../src/index'

const parsed = parseScene(readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8'))
assert.ok(parsed.ok)
const body = (parsed.ok ? parsed.scene.entities[0].body : null) as BodyDef

/** Drop two creatures almost on top of each other on flat ground; report how far apart the torsos end up. */
async function separation(collide: boolean): Promise<number> {
  const engine = await loadRapier()
  const world = engine.createWorld({ gravity: 9.81, collide })
  const n = 8
  world.setTerrain({ size: 20, n, heights: new Float32Array((n + 1) * (n + 1)) })
  const a = world.addArticulation(body, { x: 0, y: 0.1, z: 0, yaw: 0 })
  const b = world.addArticulation(body, { x: 0.15, y: 0.1, z: 0, yaw: 0 })
  for (let i = 0; i < 180; i++) world.step(1 / 60)
  const pa = new Float32Array(7 * a.partCount), pb = new Float32Array(7 * b.partCount)
  a.readPoses(pa, 0)
  b.readPoses(pb, 0)
  world.dispose()
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
}

test('creatures that overlap push each other apart when collisions are on', async () => {
  const together = await separation(false)
  const apart = await separation(true)
  assert.ok(apart > together + 0.1, `with collisions ${apart.toFixed(2)} m apart, without ${together.toFixed(2)} m`)
})

test('a creature does not collide with its own parts (its joints would fight it)', async () => {
  // if self-contact were on, an articulated body dropped on the ground would jitter apart; check it stays together
  const engine = await loadRapier()
  const world = engine.createWorld({ gravity: 9.81, collide: true })
  const n = 8
  world.setTerrain({ size: 20, n, heights: new Float32Array((n + 1) * (n + 1)) })
  const a = world.addArticulation(body, { x: 0, y: 0.1, z: 0, yaw: 0 })
  for (let i = 0; i < 180; i++) world.step(1 / 60)
  const p = new Float32Array(7 * a.partCount)
  a.readPoses(p, 0)
  assert.ok(Math.hypot(p[0], p[2]) < 0.3, `a creature just standing there should not skitter around: it moved ${Math.hypot(p[0], p[2]).toFixed(2)} m`)
  const parts = body.parts.length
  for (let k = 1; k < parts; k++) {
    const d = Math.hypot(p[k * 7] - p[0], p[k * 7 + 1] - p[1], p[k * 7 + 2] - p[2])
    assert.ok(d < 2, `part ${k} drifted ${d.toFixed(2)} m from the torso`)
  }
  world.dispose()
})

test('nothing resets a creature on its own; a fence plus onLeave and self.reset() do', async () => {
  const { Sim: S } = await import('../src/index')
  const base = structuredClone(parsed.ok ? parsed.scene : (null as never))
  // limp legs: no muscle strength, so the creature slumps and never gets up on its own
  base.params.count = { value: 1 }
  base.params.strength = { value: 0 }
  base.terrain = { size: 60, amplitude: 0 }
  // a reset is a jump: it puts the creature down somewhere random, far from where it lay
  const jumps = async (script: unknown, fence?: unknown) => {
    const scene = structuredClone(base)
    scene.entities[0].fence = fence as never
    const sim = await S.create(scene, script as never)
    const c = sim.table.cols as Record<string, Float64Array>
    let n = 0, x = c.px[0], z = c.pz[0]
    for (let i = 0; i < 900; i++) {
      sim.step()
      if (Math.hypot(c.px[0] - x, c.pz[0] - z) > 1.5) n++
      x = c.px[0]; z = c.pz[0]
    }
    sim.dispose()
    return n
  }
  assert.equal(await jumps({ default: { decide: () => ({}) } }), 0, 'a collapsed creature is left alone')
  assert.ok((await jumps({ default: { decide: ({ self }: { self: { downFor: number; reset(): void } }) => { if (self.downFor > 0.3) self.reset() } } })) >= 2, 'a script can stand it up again and again')
  assert.ok((await jumps({ default: { onLeave: ({ self }: { self: { reset(): void } }) => self.reset(), decide: () => ({}) } }, { size: 1 })) >= 1, 'crossing the fence calls onLeave')
})

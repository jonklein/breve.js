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

test('nothing resets a creature on its own; a script can stand it somewhere new with self.place()', async () => {
  const { Sim: S } = await import('../src/index')
  const base = structuredClone(parsed.ok ? parsed.scene : (null as never))
  // limp legs: no muscle strength, so the creature slumps and never gets up on its own
  base.params.count = { value: 1 }
  base.params.strength = { value: 0 }
  base.terrain = { size: 60, amplitude: 0 }
  const jumps = async (script: unknown) => {
    const sim = await S.create(structuredClone(base), script as never)
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
  assert.equal(await jumps({ default: { act: () => ({}) } }), 0, 'a collapsed creature is left alone')
  // the script watches how long it has been flipped (state) and stands it up somewhere else, again and again
  const standsUp = { default: {
    init: () => ({ flipped: 0 }),
    act: ({ self }: { self: { y: number; up: { y: number }; flipped: number; place(at: object): void } }, _p: unknown, ctx: { random(): number }) => {
      const flipped = self.up.y < 0.3 || self.y < 0.4 ? self.flipped + 1 : 0 // flipped over, or collapsed low to the ground
      if (flipped > 18) self.place({ x: (ctx.random() * 2 - 1) * 20, z: (ctx.random() * 2 - 1) * 20, yaw: ctx.random() * 6 })
      return { state: { flipped: flipped > 18 ? 0 : flipped } }
    },
  } }
  assert.ok((await jumps(standsUp)) >= 2, 'a script can stand it up again and again')
  // and it lands where it was told, on the ground, keeping its state
  const sim = await S.create(structuredClone(base), { default: { init: () => ({ kept: 7 }), act: ({ self }: { self: { place(at: object): void } }, _p: unknown, ctx: { tick: number }) => { if (ctx.tick === 5) self.place({ x: 20, z: -15, yaw: 1 }) } } } as never)
  for (let i = 0; i < 30; i++) sim.step()
  const c = sim.table.cols as Record<string, Float64Array>
  assert.ok(Math.hypot(c.px[0] - 20, c.pz[0] + 15) < 1.5 && c.py[0] > 0.05 && c.py[0] < 1.5, `at (${c.px[0].toFixed(1)}, ${c.py[0].toFixed(2)}, ${c.pz[0].toFixed(1)})`)
  assert.equal(c.kept[0], 7)
  sim.dispose()
})

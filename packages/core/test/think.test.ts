import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const scene = () => {
  const r = parseScene(JSON.stringify({
    seed: 2, params: {}, bounds: { size: 20 },
    entities: [{ name: 'a', count: 5, think: { every: 30 }, motion: { maxSpeed: 6, plane: 'xz' } }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

// a controller that asks a "model" where to go; the model's answer steers the agent until the next answer
const script: ScriptModule = {
  default: {
    init: () => ({ dx: 0, dz: 0 }),
    think: async ({ self }, _p, ctx) => JSON.parse(await ctx.ask(`you are agent ${self.row} at ${self.x.toFixed(1)}, ${self.z.toFixed(1)}: where to?`, { json: true })),
    act: ({ self }) => ({ steer: [self.dx * 10, 0, self.dz * 10] }),
  },
}

// a stand-in model: a fixed answer that depends only on the prompt
let calls = 0
const model = async (prompt: string) => {
  calls++
  const n = [...prompt].reduce((s, c) => s + c.charCodeAt(0), 0)
  return JSON.stringify({ dx: Math.cos(n), dz: Math.sin(n) })
}

test('lockstep thinking asks the model, applies the answers, and logs each one', async () => {
  const s = new Sim(scene(), script)
  s.provider = model
  for (let i = 0; i < 100; i++) { await s.think(); s.step() }
  assert.equal(s.takeErrors().length, 0, s.takeErrors().join('\n'))
  assert.equal(calls, 5 * 4, 'five agents, thinking at ticks 0, 30, 60, 90')
  assert.equal(s.decisionLog.length, 20)
  assert.deepEqual([...new Set(s.decisionLog.map((d) => d.tick))], [0, 30, 60, 90])
})

test('a run can be replayed from its decision log without asking the model again', async () => {
  const live = new Sim(scene(), script)
  live.provider = model
  for (let i = 0; i < 150; i++) { await live.think(); live.step() }

  calls = 0
  const again = new Sim(scene(), script)
  again.provider = async () => { throw new Error('the model must not be asked during a replay') }
  again.replay(live.decisionLog)
  for (let i = 0; i < 150; i++) { await again.think(); again.step() }
  assert.equal(again.takeErrors().length, 0)
  assert.equal(calls, 0)
  assert.equal(again.hash(), live.hash())
})

test('realtime thinking applies answers when they arrive, and the log still replays exactly', async () => {
  const slow = async (prompt: string) => { await new Promise((r) => setTimeout(r, 15)); return model(prompt) }
  const live = new Sim(scene(), script)
  live.provider = slow
  for (let i = 0; i < 90; i++) {
    live.thinkInBackground()
    live.step()
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 20)) // the sim keeps going while the model is slow
  }
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(live.decisionLog.length > 0)
  assert.ok(live.decisionLog.some((d) => d.tick > 0), 'some answers landed after the tick that asked')
  const again = new Sim(scene(), script)
  again.replay(live.decisionLog)
  for (let i = 0; i < 90; i++) again.step()
  assert.equal(again.hash(), live.hash())
})

test('decisions survive a fork, and a failing model is reported without stopping the sim', async () => {
  const s = new Sim(scene(), script)
  s.provider = model
  await s.think(); s.step()
  const f = s.fork()
  for (let i = 0; i < 20; i++) { s.step(); f.step() }
  assert.equal(s.hash(), f.hash())
  const broken = new Sim(scene(), script)
  broken.provider = async () => { throw new Error('model offline') }
  await broken.think(); broken.step()
  assert.match(broken.takeErrors().join('\n'), /think: model offline/)
  const none = new Sim(scene(), script)
  await none.think()
  assert.match(none.takeErrors().join('\n'), /no language model is connected/)
})

test('the llm-wanderers example runs with a stand-in model and closes in on the food', async () => {
  const { readFileSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  const dir = new URL('../../../examples/llm-wanderers/', import.meta.url)
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const mod = (await import(pathToFileURL(new URL('wanderers.js', dir).pathname).href)) as ScriptModule
  const s = new Sim(p.ok ? p.scene : (null as never), mod)
  // a sensible model: always says "head east" (toward the food at x = 14)
  s.provider = async () => JSON.stringify({ dx: 1, dz: 0 })
  const start = (await (async () => s.metrics())()).distanceToFood
  for (let i = 0; i < 400; i++) { await s.think(); s.step() }
  assert.equal(s.takeErrors().length, 0, s.takeErrors().join('\n'))
  assert.ok(s.metrics().distanceToFood < start - 8, `${start} -> ${s.metrics().distanceToFood}`)
})

test('a think that returns state writes those fields, and act reads them as self.name', async () => {
  const s = new Sim(scene(), {
    default: {
      init: () => ({ dx: 0, dz: 0 }),
      think: async () => ({ dx: 1, dz: -1 }),
      act: ({ self }: { self: { dx: number; dz: number } }) => ({ steer: [self.dx * 10, 0, self.dz * 10] }),
    },
  })
  s.provider = model
  await s.think()
  const c = s.worlds[0].table.cols as unknown as Record<string, Float64Array>
  assert.deepEqual([c.dx[0], c.dz[0]], [1, -1])
  assert.equal(s.decisionLog.length, 5, 'still logged')
  s.step()
  assert.ok(c.vx[0] !== 0, 'act used it')
  assert.equal(s.takeErrors().length, 0, s.takeErrors().join('\n'))
  // replay: the log alone reproduces the state
  const again = new Sim(scene(), { default: { init: () => ({ dx: 0, dz: 0 }), act: ({ self }: { self: { dx: number; dz: number } }) => ({ steer: [self.dx * 10, 0, self.dz * 10] }) } })
  again.replay(s.decisionLog)
  await again.think(); again.step()
  assert.equal(again.hash(), s.hash())
  // an answer that is not state is an error, with a hint
  const bad = new Sim(scene(), { default: { init: () => ({ dx: 0 }), think: async () => 'north', act: () => ({}) } })
  await bad.think()
  assert.match(bad.takeErrors().join('\n'), /think must return state/)
})

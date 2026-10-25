import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, SimGroup, parseScene, type Message, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/boids/', import.meta.url)
const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
assert.ok(parsed.ok)
const scene = parsed.ok ? parsed.scene : (null as never)
const flock = (await import(pathToFileURL(new URL('flock.js', dir).pathname).href)) as ScriptModule

// boids that report in on tick 5 and, when they hear "calm", stop steering
const chatty: ScriptModule = {
  default: {
    decide({ self, neighbors }, p, ctx) {
      if (self.row === 0 && ctx.tick === 5) ctx.send('hello', { tick: ctx.tick })
      const calm = ctx.inbox.some((m: Message) => m.topic === 'calm')
      return calm ? { steer: [0, 0, 0] } : flock.default.decide!({ self, neighbors }, p, ctx)
    },
  },
}

const small = () => { const s = structuredClone(scene); s.params.count = 30; return s }

test('a sweep gives each sim its own param value and the same seed', () => {
  const g = SimGroup.sweep(small(), flock, 'separation', [0, 10, 20])
  assert.deepEqual([...g.sims.keys()], ['separation=0', 'separation=10', 'separation=20'])
  assert.equal(g.get('separation=10').params.separation, 10)
  assert.throws(() => SimGroup.sweep(small(), flock, 'nope', [1]), /there is no param "nope"/)
  for (let i = 0; i < 30; i++) g.step()
  const hashes = new Set([...g.sims.values()].map((s) => s.hash()))
  assert.equal(hashes.size, 3, 'different params, different futures')
})

test('sims talk only to the parent, which decides who hears what', () => {
  const g = new SimGroup()
  for (const n of ['a', 'b', 'c']) g.add(n, new Sim(small(), chatty))
  const heard: string[] = []
  g.parent = (m, group) => {
    heard.push(`${m.sim}:${m.topic}`)
    if (m.topic === 'hello') group.send(m.sim === 'a' ? 'b' : 'c', 'calm') // the parent picks b and c, nobody addressed them
  }
  for (let i = 0; i < 12; i++) g.step()
  assert.deepEqual(heard.slice(0, 3), ['a:hello', 'b:hello', 'c:hello'])
  const down = g.log.filter((m) => m.direction === 'down')
  assert.equal(down.length, 3)
  // only b and c were told to calm down, so a runs exactly as it would alone
  const alone = new Sim(small(), chatty)
  for (let i = 0; i < 12; i++) alone.step()
  assert.equal(g.get('a').hash(), alone.hash())
  assert.notEqual(g.get('b').hash(), alone.hash())
})

test('replaying the logged messages without the parent reproduces the run', () => {
  const live = new SimGroup()
  for (const n of ['a', 'b']) live.add(n, new Sim(small(), chatty))
  live.parent = (m, group) => { if (m.topic === 'hello') group.send(m.sim === 'a' ? 'b' : 'a', 'calm') }
  for (let i = 0; i < 40; i++) live.step()

  const replay = new SimGroup()
  for (const n of ['a', 'b']) replay.add(n, new Sim(small(), chatty))
  const down = live.log.filter((m) => m.direction === 'down')
  for (let i = 0; i < 40; i++) {
    for (const m of down) if (m.tick === i) replay.get(m.sim).deliver(m.topic, m.data)
    replay.step()
  }
  assert.equal(replay.hash(), live.hash())
})

test('a message already on its way survives a fork', () => {
  const a = new Sim(small(), chatty)
  a.deliver('calm')
  const b = a.fork()
  a.step(); b.step()
  assert.equal(a.hash(), b.hash())
})

test('messages are copied, so a sim cannot reach into the parent by reference', () => {
  const data = { n: 1 }
  const s = new Sim(small(), flock)
  s.deliver('x', data)
  data.n = 2
  let got: unknown
  s.setScript({ default: { decide: (_o, _p, ctx) => { got = ctx.inbox[0]?.data } } })
  s.step()
  assert.deepEqual(got, { n: 1 })
})

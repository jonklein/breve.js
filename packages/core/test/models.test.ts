import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type Model, type ScriptModule } from '../src/index'

const scene = (extra: object = {}) => {
  const r = parseScene(JSON.stringify({
    seed: 2, params: {}, bounds: { size: 20, mode: 'clamp' },
    models: { policy: { url: 'policy.onnx' } },
    entities: [{ name: 'a', count: 6, think: { every: 1 }, motion: { maxSpeed: 6, plane: 'xz' } }],
    metrics: [], ...extra,
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

// a stand-in for a trained network: two outputs per row, from the first two inputs
const fake = (calls: { rows: number }[], deterministic = true): Model => ({
  inputWidth: 2, outputWidth: 2, deterministic,
  async run(input, rows) {
    calls.push({ rows })
    const out = new Float32Array(rows * 2)
    for (let i = 0; i < rows; i++) { out[i * 2] = input[i * 2] * 0.5; out[i * 2 + 1] = -input[i * 2 + 1] * 0.5 }
    return out
  },
})

// the controller gathers every agent's observation and asks the model once
const script: ScriptModule = {
  default: {
    thinkAll: async (obs, _p, ctx) => {
      const out = await ctx.model('policy').runBatch(obs.map(({ self }) => [self.x / 20, self.z / 20]))
      return out.map(([dx, dz]) => ({ dx, dz }))
    },
    act: ({ self }) => { const d = self.decision as { dx: number; dz: number } | undefined; return d ? { steer: [d.dx * 10, 0, d.dz * 10] } : {} },
  },
}

test('thinkAll gives a model the whole set as one batch, and each answer is logged per agent', async () => {
  const calls: { rows: number }[] = []
  const sim = new Sim(scene(), script)
  sim.models.policy = fake(calls)
  for (let t = 0; t < 5; t++) { await sim.think(); sim.step() }
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  assert.deepEqual(calls, Array(5).fill({ rows: 6 }), 'one call a tick, with all six agents in it')
  assert.equal(sim.decisionLog.length, 30)
  assert.deepEqual(new Set(sim.decisionLog.map((d) => d.row)), new Set([0, 1, 2, 3, 4, 5]))
})

test('a run with a model replays from its log with no model loaded at all', async () => {
  const sim = new Sim(scene(), script)
  sim.models.policy = fake([])
  for (let t = 0; t < 20; t++) { await sim.think(); sim.step() }
  const again = new Sim(scene(), script) // nothing in again.models
  again.replay(sim.decisionLog)
  for (let t = 0; t < 20; t++) { await again.think(); again.step() }
  assert.equal(again.takeErrors().length, 0, again.takeErrors().join('\n'))
  assert.equal(again.hash(), sim.hash())
})

test('a missing model, a wrong width and a wrong count of answers are each reported plainly', async () => {
  const none = new Sim(scene(), script)
  await none.think()
  assert.match(none.takeErrors().join(), /no model called "policy" is loaded \(the scene declares: policy/)
  const wide = new Sim(scene(), { default: { thinkAll: async (obs, _p, ctx) => (await ctx.model('policy').runBatch(obs.map(() => [1, 2, 3]))).map(() => 0) } })
  wide.models.policy = fake([])
  await wide.think()
  assert.match(wide.takeErrors().join(), /takes 2 numbers per observation, got 3/)
  const short = new Sim(scene(), { default: { thinkAll: async () => [1] } })
  await short.think()
  assert.match(short.takeErrors().join(), /one decision per entity \(6\), got 1/)
})

test('a model whose math can differ marks the thinking set as not repeatable; the scene schema checks "models"', () => {
  const s = new Sim(scene(), script)
  assert.deepEqual(s.nondeterministic(), [])
  s.models.policy = fake([], false)
  assert.deepEqual(s.nondeterministic(), ['a'])
  const bad = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 5 }, models: { p: { device: 'tpu' } }, entities: [{ name: 'a', count: 1 }], metrics: [] }))
  assert.ok(!bad.ok)
})

test('only sets that asked a language model are flagged, and a very long decision log keeps its newest part and says so', async () => {
  const s = new Sim(scene(), script)
  s.models.policy = fake([])
  await s.think()
  assert.deepEqual(s.nondeterministic(), [], 'a CPU model alone does not make a run unrepeatable')
  const talker = new Sim(scene(), { default: { think: async (_o, _p, ctx) => ctx.ask('hi').catch(() => 0) } })
  await talker.think()
  assert.deepEqual(talker.nondeterministic(), ['a'])
  talker.replay([])
  assert.deepEqual(talker.nondeterministic(), [], 'nothing is unrepeatable while replaying a log')

  const long = new Sim(scene(), script)
  long.models.policy = fake([])
  long.decisionLogLimit = 40
  for (let t = 0; t < 20; t++) { await long.think(); long.step() }
  assert.ok(long.decisionLog.length <= 40 && long.decisionLog.length >= 36)
  assert.equal(long.decisionLogComplete, false)
  assert.equal(long.decisionLog[long.decisionLog.length - 1].tick, 19, 'the newest decisions are the ones kept')
})

test('disposing a sim lets go of its models (sockets, runtime sessions)', () => {
  let closed = 0
  const s = new Sim(scene(), script)
  s.models.policy = { ...fake([]), dispose: () => { closed++ } }
  s.dispose()
  assert.equal(closed, 1)
})

test('restoring an earlier snapshot also forgets the decisions (and inputs) made after it, so a saved log matches the new branch', async () => {
  const sim = new Sim(scene(), script)
  sim.models.policy = fake([])
  for (let t = 0; t < 10; t++) { await sim.think(); sim.step() }
  const snap = sim.snapshot() // tick 10
  const kept = sim.decisionLog.length
  for (let t = 0; t < 20; t++) { await sim.think(); sim.step() }
  sim.setInput(['w'])
  assert.ok(sim.decisionLog.length > kept)
  sim.restore(snap)
  assert.equal(sim.decisionLog.length, kept)
  assert.ok(sim.decisionLog.every((d) => d.tick <= 10))
  assert.equal(sim.inputLog.length, 0, 'the key press after tick 10 is forgotten too')
  // the branch carries on and its log is replayable from the start
  for (let t = 0; t < 20; t++) { await sim.think(); sim.step() }
  const again = new Sim(scene(), script)
  again.replay(sim.decisionLog)
  for (let t = 0; t < 30; t++) { await again.think(); again.step() }
  assert.equal(again.hash(), sim.hash())
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseScene, type Scene, type ScriptModule } from '@breve/core'
import { sampleCandidates, plannedRuns, CmaEs, GridStrategy, RandomStrategy, CmaStrategy, makeDims, parseExperiment, runExperiment, toCsv, type ExperimentSpec } from '../src/index'

const dir = new URL('../../../examples/boids/', import.meta.url)
async function boids() {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok)
  const scene: Scene = p.ok ? p.scene : (null as never)
  scene.params.count = 60
  const script = (await import(pathToFileURL(new URL('flock.js', dir).pathname).href)) as ScriptModule
  return { scene, script }
}

test('CMA-ES finds the minimum of a smooth function inside the unit cube', () => {
  const target = [0.8, 0.2, 0.6]
  const f = (x: number[]) => x.reduce((s, v, i) => s + (v - target[i]) ** 2, 0)
  const cma = new CmaEs(3, { sigma: 0.3, seed: 4 })
  let best = Infinity
  for (let g = 0; g < 60; g++) {
    const xs = cma.sample()
    const fit = xs.map(f)
    best = Math.min(best, ...fit)
    cma.update(xs, fit)
  }
  assert.ok(best < 1e-4, `best ${best}`)
  assert.ok(cma.currentMean.every((m, i) => Math.abs(m - target[i]) < 0.02), cma.currentMean.join())
})

test('CMA-ES copes with a stretched, rotated valley (it learns the covariance)', () => {
  const f = ([x, y]: number[]) => { const u = (x - 0.5 + (y - 0.5)) / Math.SQRT2, v = (x - 0.5 - (y - 0.5)) / Math.SQRT2; return 100 * u * u + 0.1 * v * v }
  const cma = new CmaEs(2, { sigma: 0.25, seed: 2 })
  let best = Infinity
  for (let g = 0; g < 120; g++) { const xs = cma.sample(); const fit = xs.map(f); best = Math.min(best, ...fit); cma.update(xs, fit) }
  assert.ok(best < 1e-6, `best ${best}`)
})

test('strategies: grid visits every combination, random is seeded, all report done', () => {
  const dims = makeDims({ a: { min: 0, max: 1 }, b: [10, 20, 30] }, { params: { a: 0, b: 0 } } as unknown as Scene)
  const g = new GridStrategy(dims, 3)
  assert.equal(g.size, 9)
  const pts = g.ask(100)
  assert.equal(pts.length, 9)
  assert.ok(g.done())
  assert.deepEqual([...new Set(pts.map((p) => dims[1].decode(p[1])))].sort(), [10, 20, 30])
  assert.deepEqual([...new Set(pts.map((p) => dims[0].decode(p[0])))].sort(), [0, 0.5, 1])
  const r1 = new RandomStrategy(2, 5, 3).ask(10), r2 = new RandomStrategy(2, 5, 3).ask(10)
  assert.deepEqual(r1, r2)
  assert.equal(r1.length, 5)
  const c = new CmaStrategy(2, { runs: 8, population: 4 })
  assert.equal(c.ask(100).length, 4)
})

test('the experiment file is validated with readable messages, against the scene too', async () => {
  const { scene } = await boids()
  const ok = parseExperiment({ strategy: { type: 'grid', steps: 3 }, space: ['separation'], objective: { metric: 'polarization' }, ticks: 50 }, scene)
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('\n'))
  const bad = parseExperiment({ strategy: { type: 'annealing' }, space: ['nope'], objective: { metric: 'speed' }, ticks: 0, extra: 1 }, scene)
  assert.equal(bad.ok, false)
  const msg = bad.ok ? '' : bad.errors.join('\n')
  assert.match(msg, /unknown property "extra"/)
  assert.match(msg, /ticks/)
  const bad2 = parseExperiment({ strategy: { type: 'grid' }, space: ['nope'], objective: { metric: 'speed' }, ticks: 10 }, scene)
  assert.match(bad2.ok ? '' : bad2.errors.join('\n'), /no param "nope"/)
  assert.match(bad2.ok ? '' : bad2.errors.join('\n'), /does not declare a metric called "speed"/)
})

test('three strategies run the same scene and experiment shape with no change to the core', async () => {
  const base = await boids()
  const common = { space: { alignment: {}, cohesion: {} }, objective: { metric: 'polarization', goal: 'max' as const, aggregate: 'final' as const }, ticks: 240 }
  const specs: ExperimentSpec[] = [
    { ...common, strategy: { type: 'grid', steps: 3 } },
    { ...common, strategy: { type: 'random', runs: 8 }, seed: 5 },
    { ...common, strategy: { type: 'cmaes', runs: 12, population: 4 }, seed: 5 },
  ]
  const results = []
  for (const s of specs) {
    const parsed = parseExperiment(s, base.scene)
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
    results.push(await runExperiment(s, base))
  }
  assert.deepEqual(results.map((r) => r.trials.length), [9, 8, 12])
  for (const r of results) {
    assert.ok(r.best && Number.isFinite(r.best.value))
    assert.equal(r.ranked[0], r.best)
    assert.ok(r.ranked.every((t, i) => i === 0 || r.ranked[i - 1].score >= t.score))
  }
  // more alignment makes a flock fly together: the grid's best run has high alignment
  assert.ok(results[0].best!.params.alignment >= 3, JSON.stringify(results[0].best))
  assert.match(toCsv(results[0]), /^rank,trial,alignment,cohesion,polarization\n1,/)
})

test('a run of an experiment is repeatable, and replicates average over seeds', async () => {
  const base = await boids()
  const spec: ExperimentSpec = { strategy: { type: 'random', runs: 3 }, space: { alignment: {} }, objective: { metric: 'polarization' }, ticks: 100, seed: 9 }
  const a = await runExperiment(spec, base), b = await runExperiment(spec, base)
  assert.deepEqual(a.trials.map((t) => [t.params, t.value]), b.trials.map((t) => [t.params, t.value]))
  const c = await runExperiment({ ...spec, replicates: 2 }, base)
  assert.notEqual(c.trials[0].value, a.trials[0].value)
})

test('sampleCandidates picks an even spread of a grid for watching, and plannedRuns counts the budget', async () => {
  const { scene } = await boids()
  const spec: ExperimentSpec = { strategy: { type: 'grid', steps: 5 }, space: { alignment: {}, cohesion: {} }, objective: { metric: 'polarization' }, ticks: 10 }
  assert.equal(plannedRuns(spec, scene), 25)
  const some = sampleCandidates(spec, scene, 9)
  assert.equal(some.length, 9)
  assert.match(some[0].name, /^alignment=0, cohesion=0$/)
  assert.equal(new Set(some.map((r) => r.name)).size, 9)
  assert.equal(sampleCandidates({ ...spec, strategy: { type: 'random', runs: 4 } }, scene, 12).length, 4)
  assert.equal(plannedRuns({ ...spec, strategy: { type: 'cmaes' } }, scene), 60)
})
